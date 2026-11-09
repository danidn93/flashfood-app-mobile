-- FlashFood Locales: retiros programados (solo pickup).
-- No altera las facturas ni los pedidos anteriores.
ALTER TABLE public.flashfood_orders
 ADD COLUMN IF NOT EXISTS scheduled_pickup_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS ff_orders_scheduled_pickup_idx
 ON public.flashfood_orders(scheduled_pickup_at)
 WHERE scheduled_pickup_at IS NOT NULL AND fulfillment='pickup';

COMMENT ON COLUMN public.flashfood_orders.scheduled_pickup_at IS
 'Hora programada solicitada por el cliente para recoger su pedido (UTC/timestamptz). NULL significa retiro inmediato.';
