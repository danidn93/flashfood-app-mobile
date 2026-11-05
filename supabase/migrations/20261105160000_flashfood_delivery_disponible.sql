-- Read-only availability signal for FlashFood mobile.
-- Apply to Supabase before enabling the delivery option in the application.
-- A user account with the delivery role is NOT sufficient to be available:
-- the linked driver must be verified, active, and marked available.
create or replace function public.flashfood_delivery_disponible()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.flashfood_drivers as d
    inner join public.flashfood_user_roles as r
      on r.user_id = d.auth_user_id
      and r.role = 'delivery'
      and r.active = true
    where d.active = true
      and d.verified = true
      and d.availability = 'available'
  );
$$;

revoke all on function public.flashfood_delivery_disponible() from public;
grant execute on function public.flashfood_delivery_disponible() to anon, authenticated;
