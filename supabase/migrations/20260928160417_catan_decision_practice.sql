-- Locked, owner-scoped commitments for decision practice. Reveals are one-time CAS writes.
create table public.catan_decision_attempts (
 id uuid primary key default gen_random_uuid(),
 game_id uuid not null references public.catan_games(id) on delete cascade,
 owner_id uuid not null references auth.users(id) on delete cascade,
 revision bigint not null check (revision >= 1),
 option_id text not null check (char_length(option_id) between 1 and 500),
 reason text not null check (char_length(reason) between 1 and 2000),
 probability double precision not null check (probability between 0 and 1),
 horizon smallint not null check (horizon between 1 and 6),
 seed bigint not null check (seed between 1 and 4294967295),
 evaluation jsonb check (evaluation is null or jsonb_typeof(evaluation)='object'),
 revealed_at timestamptz,
 created_at timestamptz not null default now(),
 constraint reveal_pair check ((evaluation is null) = (revealed_at is null))
);
create index catan_decision_attempts_owner on public.catan_decision_attempts(owner_id,created_at desc);
create index catan_decision_attempts_game on public.catan_decision_attempts(game_id,revision);
alter table public.catan_decision_attempts enable row level security;
revoke all on public.catan_decision_attempts from anon,authenticated;
grant all on public.catan_decision_attempts to service_role;

create function public.catan_guard_decision_attempt()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='INSERT' then
  if not exists(select 1 from public.catan_games g where g.id=new.game_id and g.owner_id=new.owner_id) then
   raise exception 'Attempt owner must own the game' using errcode='23514';
  end if;
  if new.evaluation is not null or new.revealed_at is not null then
   raise exception 'Attempt must begin unrevealed' using errcode='23514';
  end if;
 else
  if row(new.id,new.game_id,new.owner_id,new.revision,new.option_id,new.reason,new.probability,new.horizon,new.seed,new.created_at)
      is distinct from row(old.id,old.game_id,old.owner_id,old.revision,old.option_id,old.reason,old.probability,old.horizon,old.seed,old.created_at) then
   raise exception 'Committed decision is immutable' using errcode='23514';
  end if;
  if old.revealed_at is not null or new.revealed_at is null or new.evaluation is null then
   raise exception 'Reveal can be written only once' using errcode='23514';
  end if;
 end if;
 return new;
end $$;
revoke all on function public.catan_guard_decision_attempt() from public,anon,authenticated;
create trigger catan_decision_attempt_guard before insert or update on public.catan_decision_attempts
 for each row execute function public.catan_guard_decision_attempt();
