/* Pruebas de la API contra el servidor local (npx wrangler dev --port 8788).
   Uso:  node scripts/probar.mjs                                            */

const BASE = process.env.BASE || 'http://127.0.0.1:8788';
const CLAVE = 'clave-de-prueba-local-2026';

let cookie = '';
let fallos = 0;
let total = 0;

function comprobar(nombre, condicion, detalle = '') {
  total++;
  if (condicion) console.log('  ok    ' + nombre);
  else { console.log('  FALLA ' + nombre + (detalle ? '  -> ' + detalle : '')); fallos++; }
}

async function pedir(ruta, { metodo = 'GET', cuerpo, conCookie = true, csrf = true } = {}) {
  const cabeceras = {};
  if (csrf) cabeceras['X-Libro'] = '1';
  if (cuerpo) cabeceras['Content-Type'] = 'application/json';
  if (conCookie && cookie) cabeceras.Cookie = cookie;

  const r = await fetch(BASE + ruta, {
    method: metodo,
    headers: cabeceras,
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    redirect: 'manual',
  });
  const definida = r.headers.get('set-cookie');
  if (definida) cookie = definida.split(';')[0];
  let datos = null;
  try { datos = await r.json(); } catch { /* respuesta sin JSON */ }
  return { estado: r.status, datos, cabeceras: r.headers, definida };
}

const uuid = () => crypto.randomUUID();

console.log('\n— Página y cabeceras —');
{
  const r = await fetch(BASE + '/');
  const csp = r.headers.get('content-security-policy') || '';
  comprobar('sirve la página', r.status === 200);
  comprobar('CSP sin unsafe-inline', csp.includes("script-src 'self'") && !csp.includes('unsafe-inline'), csp);
  comprobar('nosniff', r.headers.get('x-content-type-options') === 'nosniff');
  comprobar('sin enmarcado', r.headers.get('x-frame-options') === 'DENY');
  comprobar('HSTS', (r.headers.get('strict-transport-security') || '').includes('max-age=31536000'));
  comprobar('referrer', r.headers.get('referrer-policy') === 'no-referrer');
}

console.log('\n— Acceso sin sesión —');
comprobar('sesión inactiva', (await pedir('/api/sesion')).datos?.activa === false);
comprobar('datos bloqueados sin sesión', (await pedir('/api/datos')).estado === 401);
comprobar('escritura bloqueada sin sesión',
  (await pedir('/api/asignaturas/' + uuid(), { metodo: 'PUT', cuerpo: { nombre: 'X' } })).estado === 401);

console.log('\n— Protección CSRF —');
comprobar('rechaza POST sin cabecera propia',
  (await pedir('/api/sesion', { metodo: 'POST', cuerpo: { clave: CLAVE }, csrf: false })).estado === 403);

console.log('\n— Inicio de sesión —');
comprobar('clave incorrecta rechazada',
  (await pedir('/api/sesion', { metodo: 'POST', cuerpo: { clave: 'incorrecta' } })).estado === 401);
{
  const r = await pedir('/api/sesion', { metodo: 'POST', cuerpo: { clave: CLAVE } });
  comprobar('clave correcta aceptada', r.estado === 200 && r.datos?.activa === true);
  const c = r.definida || '';
  comprobar('cookie HttpOnly', /HttpOnly/i.test(c), c);
  comprobar('cookie Secure', /Secure/i.test(c), c);
  comprobar('cookie SameSite=Strict', /SameSite=Strict/i.test(c), c);
}
comprobar('ahora hay sesión', (await pedir('/api/sesion')).datos?.activa === true);

console.log('\n— Datos —');
const idAsig = uuid();
{
  const r = await pedir('/api/asignaturas/' + idAsig, {
    metodo: 'PUT', cuerpo: { nombre: 'Programación I', sigla: 'TIPR01', seccion: '001V' },
  });
  comprobar('crea asignatura', r.estado === 200 && r.datos?.nombre === 'Programación I', JSON.stringify(r.datos));
}
{
  const r = await pedir('/api/asignaturas/' + idAsig, { metodo: 'PUT', cuerpo: { nombre: 'Programación II' } });
  comprobar('actualiza la misma asignatura', r.estado === 200 && r.datos?.nombre === 'Programación II');
  const d = (await pedir('/api/datos')).datos;
  comprobar('no duplica al actualizar', d.asignaturas.length === 1, 'n=' + d.asignaturas.length);
}

const idClase = uuid();
{
  const r = await pedir('/api/clases/' + idClase, {
    metodo: 'PUT',
    cuerpo: { asignatura_id: idAsig, fecha: '2026-07-25', unidad: 'U2', impartido: 'if/else', proximo: 'ciclos', notas: '' },
  });
  comprobar('crea clase', r.estado === 200);
}

console.log('\n— Validación —');
comprobar('rechaza campo desconocido',
  (await pedir('/api/asignaturas/' + uuid(), { metodo: 'PUT', cuerpo: { nombre: 'X', hacker: 1 } })).estado === 400);
comprobar('rechaza id que no es UUID',
  (await pedir('/api/asignaturas/1;DROP', { metodo: 'PUT', cuerpo: { nombre: 'X' } })).estado === 400);
comprobar('no sirve archivos con métodos de escritura',
  (await pedir('/app.js', { metodo: 'PUT', cuerpo: { nombre: 'X' } })).estado === 405);
comprobar('rechaza falta de campo requerido',
  (await pedir('/api/asignaturas/' + uuid(), { metodo: 'PUT', cuerpo: { sigla: 'X' } })).estado === 400);
comprobar('rechaza texto demasiado largo',
  (await pedir('/api/asignaturas/' + uuid(), { metodo: 'PUT', cuerpo: { nombre: 'a'.repeat(200) } })).estado === 400);
comprobar('rechaza fecha inexistente',
  (await pedir('/api/clases/' + uuid(), { metodo: 'PUT', cuerpo: { asignatura_id: idAsig, fecha: '2026-02-31' } })).estado === 400);
comprobar('rechaza fecha mal formada',
  (await pedir('/api/clases/' + uuid(), { metodo: 'PUT', cuerpo: { asignatura_id: idAsig, fecha: '25-07-2026' } })).estado === 400);
comprobar('rechaza opción no permitida',
  (await pedir('/api/fechas/' + uuid(), {
    metodo: 'PUT', cuerpo: { asignatura_id: idAsig, tipo: 'Inventado', descripcion: 'x', fecha: '2026-08-01', estado: 'Pendiente' },
  })).estado === 400);
comprobar('rechaza asignatura inexistente',
  (await pedir('/api/clases/' + uuid(), { metodo: 'PUT', cuerpo: { asignatura_id: uuid(), fecha: '2026-07-25' } })).estado === 400);
comprobar('rechaza recurso inexistente',
  (await pedir('/api/usuarios/' + uuid(), { metodo: 'PUT', cuerpo: {} })).estado === 404);

console.log('\n— Archivar asignaturas —');
{
  const d = (await pedir('/api/datos')).datos;
  const a = d.asignaturas.find((x) => x.id === idAsig);
  comprobar('una asignatura nueva nace sin archivar', Number(a?.archivada) === 0, JSON.stringify(a));

  await pedir('/api/asignaturas/' + idAsig, {
    metodo: 'PUT', cuerpo: { nombre: 'Programación II', archivada: '1' },
  });
  const tras = (await pedir('/api/datos')).datos.asignaturas.find((x) => x.id === idAsig);
  comprobar('se puede archivar', Number(tras?.archivada) === 1);
  comprobar('archivar no borra sus clases',
    (await pedir('/api/datos')).datos.clases.some((c) => c.asignatura_id === idAsig));

  await pedir('/api/asignaturas/' + idAsig, {
    metodo: 'PUT', cuerpo: { nombre: 'Programación II', archivada: '0' },
  });
  comprobar('se puede desarchivar',
    Number((await pedir('/api/datos')).datos.asignaturas.find((x) => x.id === idAsig)?.archivada) === 0);

  comprobar('rechaza un valor que no sea 0 o 1',
    (await pedir('/api/asignaturas/' + idAsig, {
      metodo: 'PUT', cuerpo: { nombre: 'X', archivada: 'si' },
    })).estado === 400);
}

console.log('\n— Inyección SQL —');
{
  const id = uuid();
  const veneno = "'; DROP TABLE asignaturas; --";
  await pedir('/api/asignaturas/' + id, { metodo: 'PUT', cuerpo: { nombre: veneno } });
  const d = (await pedir('/api/datos')).datos;
  comprobar('guarda el texto tal cual, sin ejecutarlo',
    d.asignaturas.some((a) => a.nombre === veneno) && d.asignaturas.length === 2,
    'n=' + d.asignaturas.length);
  await pedir('/api/asignaturas/' + id, { metodo: 'DELETE' });
}

console.log('\n— Borrado en cascada —');
{
  await pedir('/api/asignaturas/' + idAsig, { metodo: 'DELETE' });
  const d = (await pedir('/api/datos')).datos;
  comprobar('al borrar la asignatura desaparecen sus clases',
    d.asignaturas.length === 0 && d.clases.length === 0,
    `asig=${d.asignaturas.length} clases=${d.clases.length}`);
}

console.log('\n— Sesión manipulada —');
{
  const buena = cookie;
  cookie = buena.slice(0, -3) + 'AAA';
  comprobar('firma alterada rechazada', (await pedir('/api/datos')).estado === 401);

  // Firma inventada pero con la longitud exacta de una real: este es el caso
  // que una comparación sobre cadenas (en vez de bytes) dejaría pasar.
  const [nombreCookie, valor] = buena.split('=');
  const [cuerpo, firma] = valor.split('.');
  cookie = `${nombreCookie}=${cuerpo}.${'A'.repeat(firma.length)}`;
  comprobar('firma falsa de la misma longitud rechazada', (await pedir('/api/datos')).estado === 401);

  // Sesión caducada firmada por otro: el cuerpo cambia, la firma ya no cuadra.
  const caducado = Buffer.from(JSON.stringify({ exp: Date.now() - 1000 })).toString('base64url');
  cookie = `${nombreCookie}=${caducado}.${firma}`;
  comprobar('sesión caducada rechazada', (await pedir('/api/datos')).estado === 401);

  cookie = 'sesion=' + Buffer.from(JSON.stringify({ exp: Date.now() + 1e9 })).toString('base64url') + '.falsa';
  comprobar('cookie inventada rechazada', (await pedir('/api/datos')).estado === 401);
  cookie = buena;
  comprobar('la cookie buena sigue sirviendo', (await pedir('/api/datos')).estado === 200);
}

console.log('\n— Cierre de sesión —');
{
  const r = await pedir('/api/sesion', { metodo: 'DELETE' });
  comprobar('borra la cookie', /Max-Age=0/.test(r.definida || ''), r.definida || '');
  cookie = '';
  comprobar('ya no hay acceso', (await pedir('/api/datos')).estado === 401);
}

console.log('\n— Fuerza bruta —');
{
  let bloqueado = false;
  for (let i = 0; i < 12; i++) {
    const r = await pedir('/api/sesion', { metodo: 'POST', cuerpo: { clave: 'mala' + i } });
    if (r.estado === 429) { bloqueado = true; console.log(`        bloqueado en el intento ${i + 1}`); break; }
  }
  comprobar('bloquea tras varios intentos fallidos', bloqueado);
  comprobar('el bloqueo también aplica a la clave correcta',
    (await pedir('/api/sesion', { metodo: 'POST', cuerpo: { clave: CLAVE } })).estado === 429);
}

console.log(`\n${fallos ? `FALLOS: ${fallos} de ${total}` : `Todo correcto — ${total} comprobaciones`}\n`);
process.exit(fallos ? 1 : 0);
