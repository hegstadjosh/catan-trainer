-- Match history: private full-state snapshots per revision, owner notes tied to a position, branch lineage.
-- Forward-only. Existing rows are not rewritten; games gain snapshots from their next state change.

-- Branch lineage: a practice game copied from another game's snapshot.
alter table public.catan_games
 add column branched_from uuid references public.catan_games(id) on delete set null,
 add column branched_from_revision bigint check (branched_from_revision is null or branched_from_revision >= 1);

-- One row per game revision. state is the complete engine state (every hand, deck order, RNG) minus its
-- rolling log. log_added holds only the entries that revision appended; when the log was rewritten
-- instead (a director deleted or edited lines, the first snapshot of a game older than this migration,
-- or a same-revision rewrite) log_reset is true and log_added holds the whole log. Readers rebuild a
-- revision's log by concatenating log_added from the last reset at or before it, keeping the last 200.
-- Never exposed to seat or sidekick tokens. Rows live exactly as long as their game (cascade delete).
create table public.catan_game_snapshots (
 game_id uuid not null references public.catan_games(id) on delete cascade,
 revision bigint not null,
 state jsonb not null check (jsonb_typeof(state)='object'),
 log_added jsonb not null default '[]'::jsonb check (jsonb_typeof(log_added)='array'),
 log_reset boolean not null default false,
 created_at timestamptz not null default now(),
 primary key(game_id,revision)
);
alter table public.catan_game_snapshots enable row level security;
revoke all on public.catan_game_snapshots from anon,authenticated;
grant all on public.catan_game_snapshots to service_role;

-- Captures a snapshot inside the same transaction as the state write (insert, catan_commit_move, or any
-- direct state update), so a revision's state, its event and its snapshot commit or fail together.
-- A delta is stored only when (previous log ++ delta), trimmed to the engine's 200-entry window, equals
-- the new log exactly: the new log must start with the longest possible suffix of the old log, and
-- either keep all of it or be a full 200-entry window. Anything else stores the whole log as a reset.
create function public.catan_capture_snapshot()
returns trigger language plpgsql security invoker set search_path='' as $$
declare
 log_keep constant int := 200;
 new_log jsonb := case when jsonb_typeof(new.state->'log')='array' then new.state->'log' else '[]'::jsonb end;
 old_log jsonb := '[]'::jsonb;
 n_new int; n_old int; k int;
 added jsonb; reset boolean := true;
begin
 if tg_op='UPDATE' then
  if new.state is not distinct from old.state and new.revision=old.revision then return new; end if;
  if jsonb_typeof(old.state->'log')='array' then old_log := old.state->'log'; end if;
  if new.revision>old.revision and exists(select 1 from public.catan_game_snapshots s where s.game_id=old.id and s.revision=old.revision) then
   n_new := jsonb_array_length(new_log); n_old := jsonb_array_length(old_log);
   k := least(n_old,n_new);
   while k>=0 loop
    exit when (select coalesce(jsonb_agg(t.e order by t.i),'[]'::jsonb) from jsonb_array_elements(new_log) with ordinality t(e,i) where t.i<=k)
            = (select coalesce(jsonb_agg(t.e order by t.i),'[]'::jsonb) from jsonb_array_elements(old_log) with ordinality t(e,i) where t.i>n_old-k);
    k := k-1;
   end loop;
   reset := not (k=n_old or n_new=log_keep);
  end if;
 end if;
 if reset then added := new_log;
 else select coalesce(jsonb_agg(t.e order by t.i),'[]'::jsonb) into added from jsonb_array_elements(new_log) with ordinality t(e,i) where t.i>k;
 end if;
 insert into public.catan_game_snapshots(game_id,revision,state,log_added,log_reset)
  values(new.id,new.revision,new.state-'log',added,reset)
  on conflict (game_id,revision) do update set state=excluded.state,log_added=excluded.log_added,log_reset=excluded.log_reset,created_at=now();
 return new;
end $$;
revoke all on function public.catan_capture_snapshot() from public,anon,authenticated;
create trigger catan_games_capture_snapshot
 after insert or update of state on public.catan_games
 for each row execute function public.catan_capture_snapshot();

-- Owner notes, bookmarks and predictions tied to one revision of one game. version is the CAS token.
create table public.catan_game_notes (
 id uuid primary key default gen_random_uuid(),
 game_id uuid not null references public.catan_games(id) on delete cascade,
 owner_id uuid not null references auth.users(id) on delete cascade,
 revision bigint not null check (revision >= 1),
 kind text not null check (kind in ('note','bookmark','prediction')),
 body text not null default '' check (char_length(body) <= 4000),
 version integer not null default 1,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index catan_game_notes_game on public.catan_game_notes(game_id,revision);
create index catan_game_notes_owner on public.catan_game_notes(owner_id);
alter table public.catan_game_notes enable row level security;
revoke all on public.catan_game_notes from anon,authenticated;
grant all on public.catan_game_notes to service_role;
