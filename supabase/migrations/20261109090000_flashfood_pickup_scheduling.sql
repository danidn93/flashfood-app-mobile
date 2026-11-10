-- FlashFood Locales: retiros programados (solo pickup).
-- No altera las facturas ni los pedidos anteriores.
ALTER TABLE public.flashfood_orders
 ADD COLUMN IF NOT EXISTS scheduled_pickup_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS ff_orders_scheduled_pickup_idx
 ON public.flashfood_orders(scheduled_pickup_at)
 WHERE scheduled_pickup_at IS NOT NULL AND fulfillment='pickup';

COMMENT ON COLUMN public.flashfood_orders.scheduled_pickup_at IS
 'Hora programada solicitada por el cliente para recoger su pedido (UTC/timestamptz). NULL significa retiro inmediato.';

-- Retiro finalizado es distinto de entrega a domicilio.
ALTER TABLE public.flashfood_order_progress
 DROP CONSTRAINT IF EXISTS flashfood_order_progress_stage_check;
ALTER TABLE public.flashfood_order_progress
 ADD CONSTRAINT flashfood_order_progress_stage_check
 CHECK (stage IN ('recibido','preparando','listo','asignando',
   'retirando','reparto','entregado','retirado','cancelado'));
