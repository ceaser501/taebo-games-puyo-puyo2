-- Puyo Puyo 2: players sign in with a name (their id) and a password, once per phone; each
-- phone keeps a session token. Records are kept per name. Only the functions below touch the
-- players and sessions tables; records can be read by anyone (for the ranking).

create table public.puyo_players (
  name text primary key check (char_length(name) between 1 and 10),
  pass_hash text not null,
  fails int not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now()
);
alter table public.puyo_players enable row level security;
comment on table public.puyo_players is '뿌요뿌요2 로그인: 이름이 아이디, 비밀번호는 bcrypt 해시. 함수로만 접근.';

create table public.puyo_sessions (
  token uuid primary key default gen_random_uuid(),
  name text not null references public.puyo_players(name) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);
create index puyo_sessions_name on public.puyo_sessions(name);
alter table public.puyo_sessions enable row level security;
comment on table public.puyo_sessions is '뿌요뿌요2: 폰마다 남는 로그인 표. 함수로만 접근.';

create table public.puyo_records (
  name text primary key references public.puyo_players(name) on delete cascade,
  best_level int not null default 0,
  best_chain int not null default 0,
  best_score int not null default 0,
  cpu jsonb not null default '{}'::jsonb,
  cpu_games int not null default 0,
  cpu_wins int not null default 0,
  online_games int not null default 0,
  online_wins int not null default 0,
  all_clears int not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.puyo_records enable row level security;
create policy "anyone reads puyo records" on public.puyo_records for select to anon, authenticated using (true);
comment on table public.puyo_records is '뿌요뿌요2 이름별 기록. cpu = {"레벨": {"w": 승, "l": 패}}. puyo_record_game으로만 바뀜.';

-- Sign in, or sign up when the name is new. Returns { name, token, new }, or { error:
-- 'wrong_pass' } (returned, so the failure count sticks), or raises bad_name / bad_pass / locked.
create function public.puyo_login(p_name text, p_pass text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_player public.puyo_players;
  v_token uuid;
  v_new boolean := false;
begin
  if char_length(v_name) < 1 or char_length(v_name) > 10 then raise exception 'bad_name'; end if;
  if p_pass is null or char_length(p_pass) < 4 or char_length(p_pass) > 64 then raise exception 'bad_pass'; end if;
  select * into v_player from public.puyo_players where name = v_name for update;
  if not found then
    insert into public.puyo_players(name, pass_hash) values (v_name, crypt(p_pass, gen_salt('bf')));
    insert into public.puyo_records(name) values (v_name) on conflict do nothing;
    v_new := true;
  else
    if v_player.locked_until is not null and v_player.locked_until > now() then raise exception 'locked'; end if;
    if crypt(p_pass, v_player.pass_hash) <> v_player.pass_hash then
      update public.puyo_players
        set fails = fails + 1,
            locked_until = case when fails + 1 >= 5 then now() + interval '1 minute' else null end
        where name = v_name;
      return json_build_object('error', 'wrong_pass');
    end if;
    update public.puyo_players set fails = 0, locked_until = null where name = v_name;
  end if;
  insert into public.puyo_sessions(name) values (v_name) returning token into v_token;
  return json_build_object('name', v_name, 'token', v_token, 'new', v_new);
end $$;

-- Who a phone's token belongs to, with their record; null when the token is unknown.
create function public.puyo_me(p_token uuid) returns json
language plpgsql security definer set search_path = public as $$
declare v_name text; v_rec public.puyo_records;
begin
  update public.puyo_sessions set last_seen = now() where token = p_token returning name into v_name;
  if v_name is null then return null; end if;
  select * into v_rec from public.puyo_records where name = v_name;
  return json_build_object('name', v_name, 'record', row_to_json(v_rec));
end $$;

-- Signing out on this phone forgets its token.
create function public.puyo_logout(p_token uuid) returns void
language sql security definer set search_path = public as $$
  delete from public.puyo_sessions where token = p_token;
$$;

-- One finished game (a whole match) for the token's player: p_kind 'cpu' (p_level 1-10) or
-- 'online'. Returns the record before and after.
create function public.puyo_record_game(p_token uuid, p_kind text, p_level int, p_won boolean, p_chain int, p_score int, p_clears int) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_name text;
  v_before public.puyo_records;
  v_after public.puyo_records;
  v_key text;
  v_cell jsonb;
begin
  select name into v_name from public.puyo_sessions where token = p_token;
  if v_name is null then raise exception 'not_signed_in'; end if;
  if p_kind not in ('cpu', 'online') then raise exception 'bad_kind'; end if;
  if p_kind = 'cpu' and (p_level is null or p_level < 1 or p_level > 10) then raise exception 'bad_level'; end if;
  p_chain := least(greatest(coalesce(p_chain, 0), 0), 19);
  p_score := least(greatest(coalesce(p_score, 0), 0), 99999999);
  p_clears := least(greatest(coalesce(p_clears, 0), 0), 50);
  insert into public.puyo_records(name) values (v_name) on conflict do nothing;
  select * into v_before from public.puyo_records where name = v_name for update;
  if p_kind = 'cpu' then
    v_key := p_level::text;
    v_cell := coalesce(v_before.cpu -> v_key, '{"w":0,"l":0}'::jsonb);
    v_cell := jsonb_build_object('w', (v_cell->>'w')::int + case when p_won then 1 else 0 end, 'l', (v_cell->>'l')::int + case when p_won then 0 else 1 end);
    update public.puyo_records set
      cpu = cpu || jsonb_build_object(v_key, v_cell),
      cpu_games = cpu_games + 1,
      cpu_wins = cpu_wins + case when p_won then 1 else 0 end,
      best_level = case when p_won then greatest(best_level, p_level) else best_level end,
      best_chain = greatest(best_chain, p_chain),
      best_score = greatest(best_score, p_score),
      all_clears = all_clears + p_clears,
      updated_at = now()
    where name = v_name returning * into v_after;
  else
    update public.puyo_records set
      online_games = online_games + 1,
      online_wins = online_wins + case when p_won then 1 else 0 end,
      best_chain = greatest(best_chain, p_chain),
      best_score = greatest(best_score, p_score),
      all_clears = all_clears + p_clears,
      updated_at = now()
    where name = v_name returning * into v_after;
  end if;
  update public.puyo_sessions set last_seen = now() where token = p_token;
  return json_build_object('before', row_to_json(v_before), 'after', row_to_json(v_after));
end $$;

revoke all on function public.puyo_login(text, text) from public;
revoke all on function public.puyo_me(uuid) from public;
revoke all on function public.puyo_logout(uuid) from public;
revoke all on function public.puyo_record_game(uuid, text, int, boolean, int, int, int) from public;
grant execute on function public.puyo_login(text, text) to anon, authenticated;
grant execute on function public.puyo_me(uuid) to anon, authenticated;
grant execute on function public.puyo_logout(uuid) to anon, authenticated;
grant execute on function public.puyo_record_game(uuid, text, int, boolean, int, int, int) to anon, authenticated;
