create table public.math_reviews (
 user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 card_id text not null check(length(card_id)<120),
 record jsonb not null check(jsonb_typeof(record)='object'),
 primary key(user_id,card_id)
);
create table public.guide_state (
 user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
 state jsonb not null check(jsonb_typeof(state)='object'),
 revision bigint not null default 1,
 updated_at timestamptz not null default now()
);
alter table public.math_reviews enable row level security;
alter table public.guide_state enable row level security;
create policy own_reviews on public.math_reviews for all to authenticated
 using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy own_guide on public.guide_state for all to authenticated
 using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
revoke all on public.math_reviews,public.guide_state from anon;
grant select,insert,update on public.math_reviews,public.guide_state to authenticated;

create function public.save_math_review(p_card_id text,p_previous_last bigint,p_record jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 insert into public.math_reviews(user_id,card_id,record) values(auth.uid(),p_card_id,p_record)
 on conflict(user_id,card_id) do update set record=case
  when math_reviews.record->>'reviewId'=p_record->>'reviewId' then math_reviews.record else excluded.record end
 where math_reviews.record->>'reviewId'=p_record->>'reviewId'
    or coalesce((math_reviews.record->>'last')::bigint,0)=p_previous_last
 returning record into result;
 if result is null then raise exception 'Review conflict'; end if;
 return result;
end $$;
create function public.save_guide_state(p_expected_revision bigint,p_state jsonb)
returns bigint language plpgsql security invoker set search_path='' as $$
declare result bigint;
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 insert into public.guide_state(user_id,state,revision) values(auth.uid(),p_state,1)
 on conflict(user_id) do update set state=excluded.state,revision=guide_state.revision+1,updated_at=now()
 where guide_state.revision=p_expected_revision
 returning revision into result;
 if result is null then raise exception 'State conflict'; end if;
 return result;
end $$;
revoke execute on function public.save_math_review(text,bigint,jsonb),public.save_guide_state(bigint,jsonb) from public,anon;
grant execute on function public.save_math_review(text,bigint,jsonb),public.save_guide_state(bigint,jsonb) to authenticated;
