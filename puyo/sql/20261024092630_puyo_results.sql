-- One row per player per online Puyo Puyo 2 match (1:1). Names identify players (no accounts).
create table public.puyo_results (
  id bigint generated always as identity primary key,
  match_id text not null,
  played_at timestamptz not null default now(),
  name text not null check (char_length(name) between 1 and 10),
  char smallint not null check (char between 0 and 34),
  won boolean not null,
  points smallint not null check (points between 0 and 3),
  rounds smallint not null check (rounds between 0 and 5),
  score integer not null check (score between 0 and 99999999),
  max_chain smallint not null check (max_chain between 0 and 19),
  unique (match_id, name)
);

create index puyo_results_played_at on public.puyo_results (played_at);
create index puyo_results_name on public.puyo_results (name);

alter table public.puyo_results enable row level security;

-- Anyone can read the scores and add results; nobody can change or delete them through the API.
create policy "puyo results are public" on public.puyo_results for select to anon, authenticated using (true);
create policy "anyone records a puyo result" on public.puyo_results for insert to anon, authenticated
  with check (played_at > now() - interval '5 minutes' and played_at < now() + interval '5 minutes');

-- Totals per name: all time, and the current month (Korea time).
create view public.puyo_ranking with (security_invoker = true) as
select name,
       sum(points)::int as points,
       count(*)::int as games,
       count(*) filter (where won)::int as wins,
       max(max_chain)::int as best_chain,
       max(score)::int as best_score
from public.puyo_results
group by name;

create view public.puyo_ranking_month with (security_invoker = true) as
select name,
       sum(points)::int as points,
       count(*)::int as games,
       count(*) filter (where won)::int as wins,
       max(max_chain)::int as best_chain,
       max(score)::int as best_score
from public.puyo_results
where played_at >= date_trunc('month', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul'
group by name;

grant select on public.puyo_ranking, public.puyo_ranking_month to anon, authenticated;
grant select, insert on public.puyo_results to anon, authenticated;
