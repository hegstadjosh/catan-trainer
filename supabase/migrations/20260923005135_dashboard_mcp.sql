-- Dashboard pages and agent "show" state. Access only through the user's own JWT (browser session
-- or Supabase OAuth access token); RLS scopes every row to auth.uid(). No service-role paths.

create table public.dashboard_pages (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 title text not null check (char_length(title) between 1 and 80),
 components jsonb not null default '[]'::jsonb check (
  jsonb_typeof(components)='array' and jsonb_array_length(components)<=24 and octet_length(components::text)<=262144),
 component_count int generated always as (jsonb_array_length(components)) stored,
 revision bigint not null default 1 check (revision>=1),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 deleted_at timestamptz,
 unique (id,user_id)
);
create index dashboard_pages_active on public.dashboard_pages(user_id,updated_at desc) where deleted_at is null;
create index dashboard_pages_archived on public.dashboard_pages(user_id,deleted_at desc) where deleted_at is not null;

create table public.dashboard_view (
 user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
 page_id uuid,
 component_id text check (component_id ~ '^[A-Za-z0-9_-]{1,40}$'),
 actor text not null default 'user' check (actor in ('user','agent')),
 seq bigint not null default 0 check (seq>=0),
 issued_at timestamptz not null default now(),
 -- composite FK: the view can never point at another account's page
 foreign key (page_id,user_id) references public.dashboard_pages(id,user_id) on delete set null (page_id)
);

alter table public.dashboard_pages enable row level security;
alter table public.dashboard_view enable row level security;
create policy own_pages_select on public.dashboard_pages for select to authenticated using ((select auth.uid())=user_id);
create policy own_pages_insert on public.dashboard_pages for insert to authenticated with check ((select auth.uid())=user_id);
create policy own_pages_update on public.dashboard_pages for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy own_view_select on public.dashboard_view for select to authenticated using ((select auth.uid())=user_id);
create policy own_view_insert on public.dashboard_view for insert to authenticated with check ((select auth.uid())=user_id);
create policy own_view_update on public.dashboard_view for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);

-- No DELETE grant: pages are archived (deleted_at) and recoverable; account deletion cascades.
revoke all on public.dashboard_pages,public.dashboard_view from anon,authenticated;
grant select on public.dashboard_pages to authenticated;
grant insert (title,components) on public.dashboard_pages to authenticated;
grant update (title,components,deleted_at) on public.dashboard_pages to authenticated;
grant select on public.dashboard_view to authenticated;
grant insert (page_id,component_id,actor,seq,issued_at),update (page_id,component_id,actor,seq,issued_at) on public.dashboard_view to authenticated;

-- Server-owned columns and limits. Revision always advances by one per write, so a client
-- compare-and-swap is `update ... where id=$id and revision=$expected` (row lock re-checks it).
create function public.dashboard_pages_guard() returns trigger
language plpgsql security invoker set search_path='' as $$
declare active int; total int;
begin
 if tg_op='INSERT' then
  new.revision:=1; new.created_at:=now(); new.updated_at:=now(); new.deleted_at:=null;
 else
  new.id:=old.id; new.user_id:=old.user_id; new.created_at:=old.created_at;
  new.revision:=old.revision+1; new.updated_at:=now();
 end if;
 if tg_op='INSERT' or (old.deleted_at is not null and new.deleted_at is null) then
  perform pg_advisory_xact_lock(hashtextextended('dashboard_pages'||new.user_id::text,0));
  select count(*) filter (where deleted_at is null),count(*) into active,total
   from public.dashboard_pages where user_id=new.user_id;
  if active>=20 then raise exception 'Page limit reached: at most 20 pages. Delete one first.' using errcode='CT429'; end if;
  if tg_op='INSERT' and total>=200 then raise exception 'Too many pages including archived ones.' using errcode='CT429'; end if;
 end if;
 return new;
end $$;
create trigger dashboard_pages_guard before insert or update on public.dashboard_pages
 for each row execute function public.dashboard_pages_guard();

-- Atomic agent/user "show this page" signal. Caller identity comes only from auth.uid().
create function public.dashboard_show(p_page_id uuid,p_component_id text,p_actor text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare uid uuid:=auth.uid(); result public.dashboard_view;
begin
 if uid is null then raise exception 'Sign in required' using errcode='42501'; end if;
 if p_actor is null or p_actor not in ('user','agent') then raise exception 'Invalid actor' using errcode='22023'; end if;
 if not exists (select 1 from public.dashboard_pages p
   where p.id=p_page_id and p.user_id=uid and p.deleted_at is null
   and (p_component_id is null or exists (select 1 from jsonb_array_elements(p.components) c where c->>'id'=p_component_id))) then
  raise exception 'Page or component not found' using errcode='CT404';
 end if;
 insert into public.dashboard_view as v (page_id,component_id,actor,seq,issued_at)
 values (p_page_id,p_component_id,p_actor,1,now())
 on conflict (user_id) do update set page_id=excluded.page_id,component_id=excluded.component_id,
  actor=excluded.actor,seq=v.seq+1,issued_at=now()
 returning * into result;
 return jsonb_build_object('seq',result.seq,'issuedAt',result.issued_at);
end $$;

revoke execute on function public.dashboard_pages_guard() from public,anon,authenticated;
revoke execute on function public.dashboard_show(uuid,text,text) from public,anon;
grant execute on function public.dashboard_show(uuid,text,text) to authenticated;
