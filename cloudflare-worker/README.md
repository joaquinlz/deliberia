# Worker de almacenamiento — Panorama IA

Backend mínimo que reemplaza a `window.storage` para los datos compartidos
del grupo (temas, conversaciones, votos, síntesis). Corre en Cloudflare
Workers + KV, plan gratuito.

## Deploy (desde el dashboard, sin instalar nada)

1. Creá una cuenta en https://dash.cloudflare.com/sign-up
2. **Workers & Pages → KV → Create namespace** → nombralo `panorama_kv`.
3. **Workers & Pages → Create → Create Worker** → nombralo `panorama-storage` → Deploy (con el código de ejemplo, después lo reemplazamos).
4. Entrá al Worker → **Edit code** (o "Quick edit") → borrá todo → pegá el contenido de `worker.js` de esta carpeta → **Deploy**.
5. Volvé a la página del Worker → **Settings → Variables → KV Namespace Bindings → Add binding**:
   - Variable name: `PANORAMA_KV`
   - KV namespace: `panorama_kv`
   - Guardar (puede pedir un nuevo deploy).
6. Copiá la URL pública del Worker (arriba de todo, tipo `https://panorama-storage.<tu-subdominio>.workers.dev`).

## Conectarlo con la app

En `panorama v 1.0.html`, reemplazar:

```js
const STORAGE_WORKER_URL = "https://REEMPLAZAR-CON-TU-WORKER.workers.dev";
```

por la URL real copiada en el paso 6.

## Probar que funciona

Con la URL ya puesta, abrir la consola del navegador en cualquier página y correr:

```js
fetch("https://TU-WORKER.workers.dev", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ op: "set", key: "test", value: "hola" })
}).then(r => r.json()).then(console.log);
```

y después:

```js
fetch("https://TU-WORKER.workers.dev", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ op: "get", key: "test" })
}).then(r => r.json()).then(console.log);
```

Debería devolver `{ value: "hola" }`.

## Nota sobre CORS

El Worker responde `Access-Control-Allow-Origin` reflejando el origen que
hizo el pedido (sin lista fija), porque el artifact de claude.ai corre en un
subdominio distinto cada vez que se vuelve a publicar. Esto es un
compromiso deliberado: no hay datos sensibles de por medio (nombres,
usuarios, permisos), es el mismo nivel de exposición que ya tenía la app
antes con `window.storage`.
