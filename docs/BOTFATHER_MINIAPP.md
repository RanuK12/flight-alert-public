# Mini App en BotFather (short name para `startapp`)

> **No hecho todavía.** Esto lo hace Emilio a mano en Telegram, después de mergear y desplegar el PR de la Mini App.
> Hace falta solo para los links directos `https://t.me/<bot>/<short_name>?startapp=...` (por ejemplo «Editar techo» desde el chat → `alert_<id>`).
> El botón **Menu** y el botón **🔎 Buscar vuelo** del teclado ya funcionan sin esto (usan `web_app` con la URL).

## Antes
- PR mergeado y desplegado; `https://<PUBLIC_BASE_URL>/app` abre (200) y `MINIAPP_ENABLED` no está en `false`.
- Tener a mano una imagen 640×360 (PNG/JPG) y, opcional, un GIF demo.

## Pasos
1. Abrir **@BotFather** → `/newapp`.
2. Elegir el bot (`@flightalertpro_bot`).
3. **Título**: `Flight Alert`.
4. **Descripción** (corta): `Buscá vuelos a Europa con precios en caché y creá alertas de baja.`
   Sin «en vivo», «24/7», «tiempo real» ni «al instante».
5. **Foto** 640×360.
6. **GIF demo**: `/empty` si no hay.
7. **URL de la Web App**: `https://<PUBLIC_BASE_URL>/app` (https, sin query).
8. **Short name**: `app` (o `buscar`; 3–30 caracteres, a-z 0-9 _). Queda `https://t.me/flightalertpro_bot/app`.
9. Opcional: `/myapps` → el app → **Edit Web App URL** si cambia el dominio.

## Después (en código, PR aparte)
- Variable `MINIAPP_SHORT_NAME=app` en Render (sin auto-deploy; deploy manual).
- Usar `https://t.me/<bot>/<short_name>?startapp=alert_<id>` / `search_COR_MAD` en los mensajes del chat. La Mini App ya lee `start_param` (`alerts`, `alert_<id>`, `search_XXX_YYY`).

## Verificar
- Abrir `https://t.me/flightalertpro_bot/app` en el celular → abre la Mini App.
- `https://t.me/flightalertpro_bot/app?startapp=alerts` → abre en «Mis alertas».
- `GET /health` sigue en 200.

## Volver atrás
- `MINIAPP_ENABLED=false` en Render → `/app` y `/app/api/*` dan 404 y el teclado vuelve al flujo por chat.
- En BotFather: `/myapps` → el app → **Delete** (no afecta al bot).
