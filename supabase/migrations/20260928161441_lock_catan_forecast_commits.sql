-- The browser can call save_guide_state directly with its authenticated token. Protect
-- forecast commitments at the table boundary, including direct table updates and that RPC.
-- Only the server's service-role route can create or append a resolution history entry.
create function public.catan_guard_forecast_commitments()
returns trigger language plpgsql security invoker set search_path='' as $$
declare
 before_forecasts jsonb := '[]'::jsonb;
 after_forecasts jsonb := coalesce(new.state #> '{opponents,forecasts}','[]'::jsonb);
begin
 if current_user='service_role' then return new; end if;
 if tg_op='UPDATE' then
  before_forecasts := coalesce(old.state #> '{opponents,forecasts}','[]'::jsonb);
 else
  -- save_guide_state uses INSERT ... ON CONFLICT UPDATE. Its BEFORE INSERT trigger
  -- fires even for an existing row; compare with that row before the conflict path.
  select coalesce(g.state #> '{opponents,forecasts}','[]'::jsonb)
   into before_forecasts from public.guide_state g where g.user_id=new.user_id;
  before_forecasts := coalesce(before_forecasts,'[]'::jsonb);
 end if;
 if before_forecasts is distinct from after_forecasts then
  raise exception 'Forecast commitments can only be changed through the server forecast API' using errcode='23514';
 end if;
 return new;
end $$;
revoke all on function public.catan_guard_forecast_commitments() from public,anon,authenticated;
create trigger catan_guard_forecasts before insert or update of state on public.guide_state
 for each row execute function public.catan_guard_forecast_commitments();
-- A client must not delete a committed row and reinsert it without forecasts.
revoke delete on public.guide_state from anon,authenticated;
