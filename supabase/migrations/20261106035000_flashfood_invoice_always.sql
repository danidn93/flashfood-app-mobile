-- Every FlashFood mobile order needs a merchant electronic invoice, independently of
-- merchant opt-in to the automated Multicomercios connector.
-- IMPORTANT: queue is not fiscal authorization; unconfigured issuers remain blocked.
create or replace function public.flashfood_mobile_attach_billing(
  p_order_id uuid, p_billing jsonb
) returns void language plpgsql security definer set search_path='' as $$
declare v_order public.flashfood_mobile_orders%rowtype;
declare v_merchant public.flashfood_merchant_fiscal_settings%rowtype;
begin
  select * into v_order from public.flashfood_mobile_orders where id=p_order_id for update;
  if not found then raise exception 'Pedido FlashFood no encontrado'; end if;
  insert into public.flashfood_mobile_order_billing(
    order_id,consumer_final,customer_name,customer_identification,customer_email,customer_phone
  ) values (
    p_order_id,coalesce((p_billing->>'consumer_final')::boolean,true),
    nullif(p_billing->>'nombre',''),nullif(p_billing->>'identificacion',''),
    nullif(p_billing->>'correo',''),nullif(p_billing->>'telefono','')
  ) on conflict(order_id) do nothing;
  select * into v_merchant from public.flashfood_merchant_fiscal_settings where local_id=v_order.business_id;
  insert into public.flashfood_invoice_jobs(
    order_id,issuer_type,source_local_id,remote_erp_business_id,status
  ) values(
    p_order_id,'merchant_products',v_order.business_id,
    case when v_merchant.origen='multicomercios' and v_merchant.facturacion_flashfood_habilitada
      then v_merchant.negocio_origen_id else null end,
    'awaiting_configuration'
  ) on conflict(order_id,issuer_type) do nothing;
  if v_order.service_fee>0 then
    insert into public.flashfood_invoice_jobs(order_id,issuer_type,status)
    values (p_order_id,'platform_service','awaiting_configuration')
    on conflict(order_id,issuer_type) do nothing;
  end if;
end;
$$;
revoke all on function public.flashfood_mobile_attach_billing(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.flashfood_mobile_attach_billing(uuid,jsonb) to service_role;
