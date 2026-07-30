/**
 * Panorama IA — Worker de almacenamiento compartido (Cloudflare KV).
 *
 * Reemplaza a window.storage para las claves "shared" (datos de grupo:
 * temas, conversaciones, votos, síntesis, etc). Las claves "no shared"
 * (perfil local, últimos grupos visitados) se manejan en el propio HTML
 * con localStorage y nunca llegan hasta acá — no necesitan viajar por red
 * ni sincronizarse entre dispositivos.
 *
 * Requiere un binding de KV llamado PANORAMA_KV (Settings > Variables >
 * KV Namespace Bindings en el dashboard del Worker).
 */

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '*';

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(origin) });
    }
    if (request.method !== 'POST') {
      return json({ error: 'method_not_allowed' }, 405, origin);
    }

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return json({ error: 'invalid_json' }, 400, origin);
    }

    const { op, key, value, prefix } = body || {};

    try {
      if (op === 'get') {
        if (typeof key !== 'string') return json({ error: 'missing_key' }, 400, origin);
        const v = await env.PANORAMA_KV.get(key);
        return json({ value: v }, 200, origin);
      }

      if (op === 'set') {
        if (typeof key !== 'string') return json({ error: 'missing_key' }, 400, origin);
        await env.PANORAMA_KV.put(key, String(value ?? ''));
        return json({ ok: true }, 200, origin);
      }

      if (op === 'delete') {
        if (typeof key !== 'string') return json({ error: 'missing_key' }, 400, origin);
        await env.PANORAMA_KV.delete(key);
        return json({ ok: true }, 200, origin);
      }

      if (op === 'list') {
        const p = typeof prefix === 'string' ? prefix : '';
        const keys = [];
        let cursor;
        do {
          const r = await env.PANORAMA_KV.list({ prefix: p, cursor, limit: 1000 });
          for (const k of r.keys) keys.push(k.name);
          cursor = r.list_complete ? undefined : r.cursor;
        } while (cursor);
        return json({ keys }, 200, origin);
      }

      return json({ error: 'unknown_op' }, 400, origin);
    } catch (e) {
      return json({ error: 'worker_error', detail: String((e && e.message) || e) }, 500, origin);
    }
  },
};
