-- Football Forecast — database schema
-- Target: Vercel Postgres (Neon). Run once via `npm run db:migrate`
-- or paste into the Vercel Postgres query console.

create table if not exists matches (
  id                serial primary key,
  fd_match_id       integer unique,              -- football-data.org match id
  competition_code  text not null,                -- e.g. 'PL', 'CL', 'WC'
  competition_name  text not null,
  home_team         text not null,
  away_team         text not null,
  home_team_elo_id  text,                         -- ClubElo team name/slug used for lookup
  away_team_elo_id  text,
  kickoff_utc       timestamptz not null,
  status            text not null default 'SCHEDULED', -- SCHEDULED | LIVE | FINISHED | POSTPONED
  home_score        integer,
  away_score        integer,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_matches_kickoff on matches (kickoff_utc);
create index if not exists idx_matches_status on matches (status);

-- Raw output from each individual source/collector, kept for transparency
-- (the match detail page shows "what each source said").
create table if not exists raw_predictions (
  id            serial primary key,
  match_id      integer not null references matches(id) on delete cascade,
  source        text not null,                   -- 'odds_api' | 'poisson_elo_model'
  home_prob     numeric(5,4) not null,
  draw_prob     numeric(5,4) not null,
  away_prob     numeric(5,4) not null,
  meta          jsonb,                            -- source-specific extra data (odds, elo, lambdas, etc.)
  fetched_at    timestamptz not null default now()
);

create index if not exists idx_raw_predictions_match on raw_predictions (match_id);
create unique index if not exists uq_raw_predictions_match_source
  on raw_predictions (match_id, source);

-- Final combined prediction, one row per match, overwritten on each cron run.
create table if not exists aggregated_predictions (
  id            serial primary key,
  match_id      integer not null unique references matches(id) on delete cascade,
  home_prob     numeric(5,4) not null,
  draw_prob     numeric(5,4) not null,
  away_prob     numeric(5,4) not null,
  weights_used  jsonb not null,                   -- {"odds_api": 0.5, "poisson_elo_model": 0.5}
  computed_at   timestamptz not null default now()
);
