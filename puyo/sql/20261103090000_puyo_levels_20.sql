-- Puyo Puyo 2: the computer has 20 levels now; the record takes levels 1-20.
-- One finished game (a whole match) for the token's player: p_kind 'cpu' (p_level 1-20) or
-- 'online'. Returns the record before and after.
create or replace function public.puyo_record_game(p_token uuid, p_kind text, p_level int, p_won boolean, p_chain int, p_score int, p_clears int) returns json
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
  if p_kind = 'cpu' and (p_level is null or p_level < 1 or p_level > 20) then raise exception 'bad_level'; end if;
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

