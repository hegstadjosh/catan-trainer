create table public.catan_game_observers (
 game_id uuid primary key references public.catan_games(id) on delete cascade,
 token_hash text not null unique,
 expires_at timestamptz not null,
 revoked_at timestamptz
);
create table public.catan_game_events (
 game_id uuid not null references public.catan_games(id) on delete cascade,
 revision bigint not null,
 payload jsonb not null,
 created_at timestamptz not null default now(),
 primary key(game_id,revision)
);
alter table public.catan_game_observers enable row level security;
alter table public.catan_game_events enable row level security;
revoke all on public.catan_game_observers,public.catan_game_events from anon,authenticated;
grant all on public.catan_game_observers,public.catan_game_events to service_role;
create function public.catan_commit_move(p_game_id uuid,p_expected_revision bigint,p_state jsonb,p_event jsonb)
returns setof public.catan_games language plpgsql security invoker set search_path='' as $$
declare updated public.catan_games;
begin
 update public.catan_games set state=p_state,revision=revision+1,updated_at=now()
 where id=p_game_id and revision=p_expected_revision and archived_at is null returning * into updated;
 if not found then return; end if;
 insert into public.catan_game_events(game_id,revision,payload) values(p_game_id,updated.revision,p_event);
 return next updated;
end $$;
revoke all on function public.catan_commit_move(uuid,bigint,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.catan_commit_move(uuid,bigint,jsonb,jsonb) to service_role;
