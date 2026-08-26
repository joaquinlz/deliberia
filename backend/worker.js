// deliberia-backend — backend real de DeliberIA (Worker + D1 + Workers AI)
//
// /test-db, /test-ai            → pruebas de humo (dejarlas por ahora, no molestan).
// POST /grupos                   → crea un grupo nuevo.
// GET  /grupos/:codigo           → devuelve los datos públicos de un grupo (nunca los PIN).
// POST /grupos/:codigo/verificar-pin → compara un PIN contra el hash guardado, del lado
//                                  del servidor — nunca le manda el hash al navegador.
// POST /grupos/:codigo/temas     → crea un tema nuevo dentro de un grupo.
// GET  /grupos/:codigo/temas     → lista los temas aprobados de un grupo.
// POST /grupos/:codigo/participantes → registra un participante nuevo (nombre único por grupo).
// GET  /test-crear-grupo         → atajo para probar la creación de un grupo desde el navegador.
// GET  /test-verificar-pin       → atajo para probar la verificación de PIN desde el navegador
//                                  (ej: /test-verificar-pin?codigo=grupo-de-prueba&pin=1234).
// GET  /test-crear-tema          → atajo para probar la creación de un tema desde el navegador
//                                  (ej: /test-crear-tema?codigo=grupo-de-prueba).
// GET  /test-crear-participante  → atajo para probar el registro de un participante
//                                  (ej: /test-crear-participante?codigo=grupo-de-prueba&nombre=Juan).
//                                  (Estos atajos "/test-*" son temporales, solo para esta etapa.)

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

async function verificarPin(env, codigo, pin) {
  const grupo = await env.DB.prepare(
    "SELECT pin_hash FROM grupos WHERE codigo = ?"
  ).bind(codigo).first();
  if (!grupo) return { error: 'No existe ese grupo.' };
  const hash = await hashPin(pin || '');
  return { correcto: hash === grupo.pin_hash };
}

async function crearTema(env, codigo, body) {
  const grupo = await env.DB.prepare("SELECT codigo FROM grupos WHERE codigo = ?").bind(codigo).first();
  if (!grupo) return { error: 'No existe ese grupo.' };

  const titulo = (body.titulo || '').trim();
  if (!titulo) return { error: 'Falta el título del tema.' };
  const descripcion = (body.descripcion || '').trim();

  let encuestaPregunta = null, encuestaOpciones = null, encuestaMultiple = 0;
  if (body.encuesta && body.encuesta.pregunta && Array.isArray(body.encuesta.opciones) && body.encuesta.opciones.length >= 2) {
    encuestaPregunta = body.encuesta.pregunta;
    encuestaOpciones = JSON.stringify(body.encuesta.opciones);
    encuestaMultiple = body.encuesta.multiple ? 1 : 0;
  }

  const id = crypto.randomUUID();
  const creado = Date.now();

  await env.DB.prepare(
    `INSERT INTO temas (id, grupo_codigo, titulo, descripcion, estado, fijado, aprobado, encuesta_pregunta, encuesta_opciones, encuesta_multiple, creado, ultima_actividad)
     VALUES (?, ?, ?, ?, 'activo', 0, 1, ?, ?, ?, ?, ?)`
  ).bind(id, codigo, titulo, descripcion, encuestaPregunta, encuestaOpciones, encuestaMultiple, creado, creado).run();

  return { id, grupo_codigo: codigo, titulo, descripcion, estado: 'activo', creado };
}

async function crearParticipante(env, codigo, body) {
  const grupo = await env.DB.prepare("SELECT codigo FROM grupos WHERE codigo = ?").bind(codigo).first();
  if (!grupo) return { error: 'No existe ese grupo.' };

  const nombre = (body.nombre || '').trim();
  if (!nombre) return { error: 'Falta el nombre.' };

  const existente = await env.DB.prepare(
    "SELECT id FROM participantes WHERE grupo_codigo = ? AND lower(nombre) = lower(?)"
  ).bind(codigo, nombre).first();
  if (existente) return { error: 'Ese nombre ya está en uso en este grupo.' };

  const id = crypto.randomUUID();
  const creado = Date.now();

  await env.DB.prepare(
    "INSERT INTO participantes (id, grupo_codigo, nombre, creado) VALUES (?, ?, ?, ?)"
  ).bind(id, codigo, nombre, creado).run();

  return { id, nombre, grupo_codigo: codigo, creado };
}

async function listarTemas(env, codigo) {
  const { results } = await env.DB.prepare(
    `SELECT id, titulo, descripcion, estado, fijado, creado, ultima_actividad, encuesta_pregunta, encuesta_opciones, encuesta_multiple
     FROM temas WHERE grupo_codigo = ? AND aprobado = 1
     ORDER BY fijado DESC, ultima_actividad DESC, creado DESC`
  ).bind(codigo).all();

  return results.map(t => ({
    id: t.id,
    titulo: t.titulo,
    descripcion: t.descripcion,
    estado: t.estado,
    fijado: !!t.fijado,
    creado: t.creado,
    ultima_actividad: t.ultima_actividad,
    encuesta: t.encuesta_pregunta
      ? { pregunta: t.encuesta_pregunta, opciones: JSON.parse(t.encuesta_opciones || '[]'), multiple: !!t.encuesta_multiple }
      : null
  }));
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

    if (url.pathname.startsWith('/grupos/') && url.pathname.endsWith('/verificar-pin') && request.method === 'POST') {
      const codigo = url.pathname.split('/')[2];
      const body = await request.json();
      const resultado = await verificarPin(env, codigo, body.pin);
      if (resultado.error) return Response.json(resultado, { status: 404 });
      return Response.json(resultado);
    }

    if (url.pathname.startsWith('/grupos/') && url.pathname.endsWith('/participantes') && request.method === 'POST') {
      const codigo = url.pathname.split('/')[2];
      const body = await request.json();
      const resultado = await crearParticipante(env, codigo, body);
      if (resultado.error) return Response.json(resultado, { status: 400 });
      return Response.json(resultado, { status: 201 });
    }

    if (url.pathname.startsWith('/grupos/') && url.pathname.endsWith('/temas') && request.method === 'POST') {
      const codigo = url.pathname.split('/')[2];
      const body = await request.json();
      const resultado = await crearTema(env, codigo, body);
      if (resultado.error) return Response.json(resultado, { status: 400 });
      return Response.json(resultado, { status: 201 });
    }

    if (url.pathname.startsWith('/grupos/') && url.pathname.endsWith('/temas') && request.method === 'GET') {
      const codigo = url.pathname.split('/')[2];
      const temas = await listarTemas(env, codigo);
      return Response.json(temas);
    }

    if (url.pathname.startsWith('/grupos/') && request.method === 'GET') {
      const codigo = url.pathname.split('/')[2];
      const grupo = await env.DB.prepare(
        "SELECT codigo, nombre, publico, creado FROM grupos WHERE codigo = ?"
      ).bind(codigo).first();
      if (!grupo) return Response.json({ error: 'No existe ese grupo.' }, { status: 404 });
      return Response.json(grupo);
    }

    if (url.pathname === '/test-verificar-pin') {
      const codigo = url.searchParams.get('codigo') || '';
      const pin = url.searchParams.get('pin') || '';
      const resultado = await verificarPin(env, codigo, pin);
      return Response.json(resultado);
    }

    if (url.pathname === '/test-crear-tema') {
      const codigo = url.searchParams.get('codigo') || '';
      const resultado = await crearTema(env, codigo, {
        titulo: 'Tema de prueba',
        descripcion: 'Un tema creado para probar el circuito.'
      });
      return Response.json(resultado);
    }

    if (url.pathname === '/test-crear-participante') {
      const codigo = url.searchParams.get('codigo') || '';
      const nombre = url.searchParams.get('nombre') || '';
      const resultado = await crearParticipante(env, codigo, { nombre });
      return Response.json(resultado);
    }

    return new Response('DeliberIA backend — probá /test-db, /test-ai, /test-crear-grupo, /test-verificar-pin, /test-crear-tema, /test-crear-participante, /grupos/<codigo>, o /grupos/<codigo>/temas');
  }
};
