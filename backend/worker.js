// deliberia-backend — prueba mínima de conexión (Worker + D1 + Workers AI)
//
// Este archivo todavía NO es el backend real de DeliberIA — es solo una
// prueba de humo para confirmar que las tres piezas de infraestructura
// (el Worker, la base de datos D1 llamada "DB", y Workers AI llamada "AI")
// están correctamente conectadas entre sí antes de construir la lógica real
// de la app encima.
//
// /test-db → escribe una fila en una tabla de prueba y la vuelve a leer.
// /test-ai → le hace una pregunta simple al modelo de IA y devuelve la respuesta.

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

    return new Response('DeliberIA backend — probá /test-db o /test-ai');
  }
};
