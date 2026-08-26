// deliberia-backend — backend real de DeliberIA (Worker + D1 + Workers AI)
//
// /test-db, /test-ai        → pruebas de humo (dejarlas por ahora, no molestan).
// POST /grupos               → crea un grupo nuevo.
// GET  /grupos/:codigo       → devuelve los datos públicos de un grupo (nunca los PIN).
// GET  /test-crear-grupo     → atajo para probar la creación de un grupo desde el navegador,
//                              sin necesitar herramientas para mandar un POST a mano.
//                              (Esto es temporal, solo para esta etapa de pruebas.)

function slugify(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'grupo';
}

async function hashPin(pin) {
  const enc = new TextEncoder().encode(pin);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function crearGrupo(env, body) {
  const nombre = (body.nombre || '').trim();
  const pin = (body.pin || '').trim();
  const pinAcceso = (body.pinAcceso || '').trim();
  const publico = !!body.publico;

  if (!nombre || !pin) {
    return { error: 'Falta el nombre del grupo o el PIN.' };
  }

  const existente = await env.DB.prepare(
    "SELECT codigo FROM grupos WHERE lower(nombre) = lower(?)"
  ).bind(nombre).first();
  if (existente) {
    return { error: 'Ya existe un grupo con ese nombre.' };
  }

  const base = slugify(nombre);
  let codigo = base;
  let intento = 0;
  while (await env.DB.prepare("SELECT codigo FROM grupos WHERE codigo = ?").bind(codigo).first()) {
    intento++;
    codigo = base + '-' + Math.random().toString(36).slice(2, 6);
    if (intento > 6) break;
  }

  const pinHash = await hashPin(pin);
  const pinAccesoHash = pinAcceso ? await hashPin(pinAcceso) : null;
  const creado = Date.now();

  await env.DB.prepare(
    "INSERT INTO grupos (codigo, nombre, pin_hash, pin_acceso_hash, publico, creado) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(codigo, nombre, pinHash, pinAccesoHash, publico ? 1 : 0, creado).run();

  return { codigo, nombre, publico, creado };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/test-db') {
      await env.DB.exec(
        "CREATE TABLE IF NOT EXISTS test_ping (id INTEGER PRIMARY KEY, mensaje TEXT, creado INTEGER)"
      );
      await env.DB.prepare("INSERT INTO test_ping (mensaje, creado) VALUES (?, ?)")
        .bind('hola desde el test', Date.now())
        .run();
      const { results } = await env.DB.prepare(
        "SELECT * FROM test_ping ORDER BY id DESC LIMIT 5"
      ).all();
      return Response.json({ ok: true, filas: results });
    }

    if (url.pathname === '/test-ai') {
      const respuesta = await env.AI.run('@cf/qwen/qwen3.8-27b', {
        messages: [
          { role: 'user', content: 'Respondé en una sola oración, en español: ¿qué es la deliberación colectiva?' }
        ]
      });
      return Response.json({ ok: true, respuesta });
    }

    if (url.pathname === '/test-crear-grupo') {
      const resultado = await crearGrupo(env, {
        nombre: 'Grupo de prueba',
        pin: '1234',
        pinAcceso: '',
        publico: false
      });
      return Response.json(resultado);
    }

    if (url.pathname === '/grupos' && request.method === 'POST') {
      const body = await request.json();
      const resultado = await crearGrupo(env, body);
      if (resultado.error) return Response.json(resultado, { status: 400 });
      return Response.json(resultado, { status: 201 });
    }

    if (url.pathname.startsWith('/grupos/') && request.method === 'GET') {
      const codigo = url.pathname.split('/')[2];
      const grupo = await env.DB.prepare(
        "SELECT codigo, nombre, publico, creado FROM grupos WHERE codigo = ?"
      ).bind(codigo).first();
      if (!grupo) return Response.json({ error: 'No existe ese grupo.' }, { status: 404 });
      return Response.json(grupo);
    }

    return new Response('DeliberIA backend — probá /test-db, /test-ai, /test-crear-grupo, o /grupos/<codigo>');
  }
};
