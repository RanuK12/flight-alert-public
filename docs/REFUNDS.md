# Reembolsos de pagos de prueba (runbook)

> Solo documentación. Ninguno de estos pasos se ejecutó. Usar solo con pagos de **prueba** y con credenciales de test.
> Nunca pegar tokens en la terminal ni en logs: usar variables de entorno cargadas desde el gestor de secretos.

## 1. Telegram Stars (`refundStarPayment`)
1. Buscar el pago en los logs o en la DB: `user_id` y `telegram_payment_charge_id`. Ambos vienen en `successful_payment`.
2. Llamar a la Bot API con el bot de **prueba**:
   `POST https://api.telegram.org/bot$TELEGRAM_TOKEN/refundStarPayment`, body `{"user_id": <id>, "telegram_payment_charge_id": "<charge_id>"}`.
3. Telegram devuelve `true` y las Stars vuelven al usuario.
4. En la DB, marcar la suscripción Pro como `refunded` y bajar al usuario a Free.
5. Si el pago era de una suscripción, cancelar además la renovación con `editUserStarSubscription` (`is_canceled: true`).

## 2. Stripe
**Dashboard (modo Test):** Payments → elegir el pago → **Refund** → monto total o parcial → motivo → Confirm.
**API:** `stripe refunds create --payment-intent pi_...`. También se puede hacer `POST /v1/refunds` con `payment_intent=pi_...`, usando la `sk_test_` desde el entorno.
- Si es una suscripción, cancelarla: `DELETE /v1/subscriptions/sub_...`.
- Revisar que el webhook `charge.refunded` llegue y que el usuario baje a Free.

## 3. Mercado Pago
**Panel:** Tu negocio → Ventas → elegir el pago → **Devolver dinero** (total o parcial).
**API:** `POST https://api.mercadopago.com/v1/payments/{payment_id}/refunds`, con header `Authorization: Bearer $MP_ACCESS_TOKEN` (TEST-...) y `X-Idempotency-Key: <uuid>`. Si el body va vacío, la devolución es total; con `{"amount": X}` es parcial.
- Revisar la notificación del webhook (`payment` con status `refunded`) y bajar al usuario a Free.

## Checklist
- [ ] Confirmar que el pago es de test (livemode=false / TEST- / bot de staging).
- [ ] Reembolso hecho y estado verificado en el proveedor.
- [ ] Usuario en Free y alertas Pro desactivadas.
- [ ] Anotarlo en /admin/logs.
