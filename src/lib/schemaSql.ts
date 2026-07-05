// Runtime-safe copy of db/schema.sql, as an array of statements.
//
// Why this duplicates db/schema.sql instead of reading the file at runtime:
// Vercel's serverless function bundler traces imports/requires statically to
// decide which files ship with the function. A `fs.readFileSync` call built
// from a dynamic path (`path.join(process.cwd(), "db", "schema.sql")`) isn't
// reliably traced, so the .sql file can end up missing from the deployed
// bundle. A plain TS import is always included. Keep both files in sync when
// changing the schema — db/schema.sql stays the canonical, human-readable
// version (also usable by copy-pasting into the Postgres query console).
export const SCHEMA_STATEMENTS: string[] = [
  `create table if not exists matches (
  id                serial primary key,
  fd_match_id       integer unique,
  competition_code  text not null,
  competition_name  text not null,
  home_team         text not null,
  away_team         text not null,
  home_team_elo_id  text,
  away_team_elo_id  text,
  kickoff_utc       timestamptz not null,
  status            text not null default 'SCHEDULED',
  home_score        integer,
  away_score        integer,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
)`,
  `create index if not exists idx_matches_kickoff on matches (kickoff_utc)`,
  `create index if not exists idx_matches_status on matches (status)`,
  `create table if not exists raw_predictions (
  id            serial primary key,
  match_id      integer not null references matches(id) on delete cascade,
  source        text not null,
  home_prob     numeric(5,4) not null,
  draw_prob     numeric(5,4) not null,
  away_prob     numeric(5,4) not null,
  meta          jsonb,
  fetched_at    timestamptz not null default now()
)`,
  `create index if not exists idx_raw_predictions_match on raw_predictions (match_id)`,
  `create unique index if not exists uq_raw_predictions_match_source
  on raw_predictions (match_id, source)`,
  `create table if not exists aggregated_predictions (
  id            serial primary key,
  match_id      integer not null unique references matches(id) on delete cascade,
  home_prob     numeric(5,4) not null,
  draw_prob     numeric(5,4) not null,
  away_prob     numeric(5,4) not null,
  weights_used  jsonb not null,
  computed_at   timestamptz not null default now()
)`,
];
