/* Verifica el despliegue en producción sin necesitar la clave.
   Uso:  node scripts/verificar-produccion.mjs https://libro-clases.libroclases.workers.dev */

const BASE = (process.argv[2] || 'https://libro-clases.libroclases.workers.dev').replace(/\/$/, '');

let fallos = 0;
const comprobar = (nombre, condicion, detalle = '') => {
  if (condicion) console.log('  ok    ' + nombre);
  else { console.log('  FALLA ' + nombre + (detalle ? '  -> ' + detalle : '')); fallos++; }
};

const pagina = await fetch(BASE + '/');
const html = await pagina.text();
const h = (n) => pagina.headers.get(n) || '';

console.log('\n— Página —');
comprobar('responde 200', pagina.status === 200, 'estado=' + pagina.status);
comprobar('es la aplicación', /Libro de clases/.test(html));
comprobar('pide clave antes de mostrar nada', /id="portada"/.test(html));

console.log('\n— Cabeceras de seguridad —');
comprobar('CSP sin unsafe-inline',
  h('content-security-policy').includes("script-src 'self'") && !h('content-security-policy').includes('unsafe-inline'));
comprobar('HSTS', h('strict-transport-security').includes('max-age=31536000'));
comprobar('nosniff', h('x-content-type-options') === 'nosniff');
comprobar('sin enmarcado', h('x-frame-options') === 'DENY');
comprobar('sin referrer', h('referrer-policy') === 'no-referrer');

console.log('\n— HTTPS —');
comprobar('la dirección es https', BASE.startsWith('https://'));

console.log('\n— API cerrada —');
const sesion = await fetch(BASE + '/api/sesion');
const cuerpoSesion = await sesion.json().catch(() => ({}));
const secretosListos = sesion.status === 200;
comprobar('el estado de sesión responde', [200, 500].includes(sesion.status), 'estado=' + sesion.status);
comprobar('nadie tiene sesión iniciada', cuerpoSesion.activa !== true);

const datos = await fetch(BASE + '/api/datos');
comprobar('los datos no se sirven sin sesión', [401, 500].includes(datos.status), 'estado=' + datos.status);

const csrf = await fetch(BASE + '/api/sesion', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ clave: 'loquesea' }),
});
comprobar('rechaza peticiones de otro origen', [403, 500].includes(csrf.status), 'estado=' + csrf.status);

console.log('\n— Secretos —');
if (secretosListos) {
  console.log('  ok    CLAVE_HASH y SECRETO_SESION están cargados');
  const mala = await fetch(BASE + '/api/sesion', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Libro': '1' },
    body: JSON.stringify({ clave: 'clave-que-no-es' }),
  });
  comprobar('rechaza una clave incorrecta', mala.status === 401, 'estado=' + mala.status);
} else {
  console.log('  --    faltan los secretos todavía (la API devuelve 500, que es lo correcto)');
  console.log('        carga CLAVE_HASH y SECRETO_SESION y vuelve a ejecutar esto');
}

console.log(fallos ? `\nFALLOS: ${fallos}\n` : '\nTodo correcto\n');
process.exit(fallos ? 1 : 0);
