-- Private authoritative game state: accessed only by the server after session/seat authorization.
create table public.catan_games (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade,
 title text not null check (char_length(title) between 1 and 80),
 state jsonb not null check (jsonb_typeof(state)='object' and octet_length(state::text)<524288),
 revision bigint not null default 1,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 archived_at timestamptz
);
create index catan_games_owner on public.catan_games(owner_id,updated_at desc);
create table public.catan_game_seats (
 game_id uuid not null references public.catan_games(id) on delete cascade,
 seat smallint not null check(seat between 1 and 3),
 token_hash text not null unique,
 expires_at timestamptz not null,
 revoked_at timestamptz,
 last_seen_at timestamptz,
 primary key(game_id,seat)
);
alter table public.catan_games enable row level security;
alter table public.catan_game_seats enable row level security;
revoke all on public.catan_games,public.catan_game_seats from anon,authenticated;
grant all on public.catan_games,public.catan_game_seats to service_role;
