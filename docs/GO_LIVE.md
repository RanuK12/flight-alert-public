# Cobros reales

Checklist para pasar `PAYMENTS_MODE` de `test` a `live`. Los valores se cargan en el dashboard. No van en el repo, en los logs ni en el chat. Este documento no despliega ni toca Render.

`PAYMENTS_MODE` vacío o ausente queda en `test`. Si el modo y la clave no coinciden, el proceso falla al arrancar.

## Claves

Cargar en el dashboard, todas con `sync: false` (ver `render.yaml`):

- `PAYMENTS_MODE` = `live` solo cuando las claves de abajo sean del mismo modo.
- `STRIPE_SECRET_KEY`: secret key de Stripe del mismo modo. En live el prefijo es `sk_` + `live`. En test, `sk_` + `test`.
- `STRIPE_WEBHOOK_SECRET`: signing secret del endpoint de **test**.
- `STRIPE_WEBHOOK_SECRET_LIVE`: signing secret del endpoint de **live**. En live no se reutiliza el de test.
- `STRIPE_PRICE_EUR` y `STRIPE_PRICE_USD`: ids de precio de Stripe (abajo).
- `MP_ACCESS_TOKEN`: en live, access token de producción (prefijo `APP_` + `USR-`). En test, el que empieza con `TEST-`.
- `MP_WEBHOOK_SECRET`: secreto de la firma de Mercado Pago.
- `DEVICE_COOKIE_SECRET`: obligatorio en producción, igual que `STARS_PAYLOAD_SECRET`. Sin eso el proceso no arranca.
- `STARS_PAYLOAD_SECRET`: obligatorio en producción.
- `OWNER_TELEGRAM_IDS`: chats que reciben la alerta de cada cobro real.
- `PUBLIC_BASE_URL`: origen público, con esquema y sin barra final.

## Webhooks

Rutas exactas. El host es el de `PUBLIC_BASE_URL`.

- Stripe, endpoint del modo live: `POST {PUBLIC_BASE_URL}/webhooks/stripe`
- Mercado Pago: `POST {PUBLIC_BASE_URL}/webhooks/mp`

Ejemplo de forma, sin valor real: `https://tu-dominio/webhooks/stripe` y `https://tu-dominio/webhooks/mp`.

Eventos de Stripe en el endpoint live:

- `checkout.session.completed`
- `invoice.paid`
- `invoice.payment_failed`
- `customer.subscription.deleted`

El signing secret de ese endpoint va en `STRIPE_WEBHOOK_SECRET_LIVE`.

Mercado Pago tiene que notificar pagos (`payment`) y suscripciones (`subscription_preapproval`). El cobro mensual puede llegar como `payment` sin `external_reference`. Se resuelve con el id de la suscripción (`preapproval_id` o `subscription_id`) y el `external_reference` de esa suscripción.

## Precios

- EUR: precio mensual de €4,50 en Stripe, con IVA incluido (`tax_behavior` inclusive). El id va en `STRIPE_PRICE_EUR`. En live, un checkout EUR enciende Stripe Tax aunque `STRIPE_TAX_ENABLED` esté apagado.
- USD: precio mensual de USD 5. El id va en `STRIPE_PRICE_USD`. El impuesto de USD sigue a `STRIPE_TAX_ENABLED`.
- ARS: lo publica la cotización guardada. No hay precio fijo en Stripe.

En test, Stripe sigue armando el monto en el checkout. Los ids de arriba se usan en live.

## Alerta de cada cobro real

Con `PAYMENTS_MODE=live`, cada cobro nuevo deja un log `cobro real` y un mensaje de Telegram a `OWNER_TELEGRAM_IDS`. El texto lleva monto, moneda y proveedor (`stripe`, `mp` o `stars`). No lleva email, nombre ni id de quien pagó. En `test` no se avisa.

## Prueba con un pago real chico y reembolso

1. Confirmar en el log de arranque `payments: live` y que el proceso no murió por mezcla de claves.
2. Hacer un solo cobro real, el más chico que el proveedor permita (EUR, USD o ARS). Una sola vez.
3. Verificar el log y el Telegram del owner: monto, moneda y proveedor. Confirmar que no aparecen datos de la persona.
4. Reembolsar ese cobro en el panel de Stripe o de Mercado Pago antes de dar por cerrado el pase.
5. Si la alerta no llega, o el modo no coincide con la clave, no dejar el servicio cobrando. El arranque tiene que fallar en ese caso.
