# flight-alert-public

Producto público de búsqueda y alertas de vuelos Argentina–Europa. La única fuente de precios es Travelpayouts. El bot privado de Emilio no vive en este repo.

Sin variables de producto, el proceso responde `/health` y no hace polling. Los flags nacen apagados. `FEATURE_CHANNELS` queda para la fase 2.

Los nombres de las variables están en `render.yaml`. Los valores no van en el repo. El pase a cobros reales está en `docs/GO_LIVE.md`.

El chequeo de cobertura (`node scripts/coverageCheck.js`) se corre a mano y no forma parte del arranque.
