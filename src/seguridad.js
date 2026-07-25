/* Seguridad: codificación, contraseñas, sesiones firmadas, límite de intentos
   y cabeceras HTTP. Sin dependencias externas: solo WebCrypto. */

const codificador = new TextEncoder();

/* ------------------------------------------------------------------ base64url */

export const b64u = {
  cifrar(bytes) {
    let cadena = '';
    for (const b of new Uint8Array(bytes)) cadena += String.fromCharCode(b);
    return btoa(cadena).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  descifrar(texto) {
    const normalizado = texto.replace(/-/g, '+').replace(/_/g, '/');
    const relleno = '==='.slice((normalizado.length + 3) % 4);
    const binario = atob(normalizado + relleno);
    const salida = new Uint8Array(binario.length);
    for (let i = 0; i < binario.length; i++) salida[i] = binario.charCodeAt(i);
    return salida;
  },
};

/**
 * Comparación en tiempo constante: no revela dónde difieren los bytes.
 *
 * Compara SIEMPRE sobre bytes. Con cadenas de texto, `a[i] ^ b[i]` opera entre
 * dos strings de un carácter, que JavaScript convierte a 0 antes del XOR: la
 * función devolvería `true` para cualquier par de cadenas de la misma longitud.
 */
export function iguales(a, b) {
  const bytesA = typeof a === 'string' ? codificador.encode(a) : a;
  const bytesB = typeof b === 'string' ? codificador.encode(b) : b;
  if (bytesA.length !== bytesB.length) return false;
  let diferencia = 0;
  for (let i = 0; i < bytesA.length; i++) diferencia |= bytesA[i] ^ bytesB[i];
  return diferencia === 0;
}

/* ------------------------------------------------------------------ contraseña */

/* El plan gratuito de Workers limita cada petición a 10 ms de CPU, así que el
   número de iteraciones es moderado a propósito. Eso es aceptable aquí porque
   el hash se guarda como *secreto* de Cloudflare —no en la base de datos— y por
   tanto no hay un escenario realista de descifrado sin conexión. La defensa
   principal contra adivinación es el límite de intentos de más abajo. */
export const ITERACIONES = 30000;

export async function derivar(clave, sal, iteraciones) {
  const material = await crypto.subtle.importKey(
    'raw', codificador.encode(clave), 'PBKDF2', false, ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: sal, iterations: iteraciones },
    material, 256,
  );
  return new Uint8Array(bits);
}

/** Formato almacenado:  pbkdf2$<iteraciones>$<sal_b64u>$<hash_b64u> */
export async function verificarClave(clave, almacenado) {
  if (typeof almacenado !== 'string') return false;
  const partes = almacenado.split('$');
  if (partes.length !== 4 || partes[0] !== 'pbkdf2') return false;

  const iteraciones = Number(partes[1]);
  if (!Number.isInteger(iteraciones) || iteraciones < 1000 || iteraciones > 1000000) return false;

  try {
    const sal = b64u.descifrar(partes[2]);
    const esperado = b64u.descifrar(partes[3]);
    return iguales(await derivar(clave, sal, iteraciones), esperado);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ sesión */

const NOMBRE_COOKIE = 'sesion';
const DURACION_MS = 30 * 24 * 60 * 60 * 1000;   // 30 días

async function llaveHmac(secreto) {
  return crypto.subtle.importKey(
    'raw', b64u.descifrar(secreto), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
}

export async function crearSesion(secreto) {
  const cuerpo = b64u.cifrar(codificador.encode(JSON.stringify({ exp: Date.now() + DURACION_MS })));
  const firma = await crypto.subtle.sign('HMAC', await llaveHmac(secreto), codificador.encode(cuerpo));
  return `${cuerpo}.${b64u.cifrar(firma)}`;
}

export async function sesionValida(secreto, token) {
  if (typeof token !== 'string') return false;
  const punto = token.indexOf('.');
  if (punto < 1) return false;

  const cuerpo = token.slice(0, punto);
  try {
    const esperada = new Uint8Array(
      await crypto.subtle.sign('HMAC', await llaveHmac(secreto), codificador.encode(cuerpo)),
    );
    if (!iguales(esperada, b64u.descifrar(token.slice(punto + 1)))) return false;
    const { exp } = JSON.parse(new TextDecoder().decode(b64u.descifrar(cuerpo)));
    return typeof exp === 'number' && exp > Date.now();
  } catch {
    return false;
  }
}

export function leerCookie(peticion, nombre) {
  const cabecera = peticion.headers.get('Cookie');
  if (!cabecera) return null;
  for (const trozo of cabecera.split(';')) {
    const igual = trozo.indexOf('=');
    if (igual > 0 && trozo.slice(0, igual).trim() === nombre) return trozo.slice(igual + 1).trim();
  }
  return null;
}

export const cookieSesion = (token) =>
  `${NOMBRE_COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${DURACION_MS / 1000}`;

export const cookieBorrada = () =>
  `${NOMBRE_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;

export const COOKIE = NOMBRE_COOKIE;

/* ------------------------------------------------------------------ fuerza bruta */

const VENTANA_MS = 15 * 60 * 1000;
const MAX_POR_IP = 8;     // intentos fallidos de una misma IP
const MAX_GLOBAL = 30;    // total, para frenar ataques repartidos entre muchas IP

/**
 * Comprueba si se permite intentar iniciar sesión.
 * Devuelve null si se permite, o los segundos que faltan para reintentar.
 */
export async function intentoBloqueado(db, ip) {
  const desde = Date.now() - VENTANA_MS;
  const fila = await db
    .prepare(`SELECT COUNT(*) AS total,
                     SUM(CASE WHEN ip = ?1 THEN 1 ELSE 0 END) AS propios
              FROM intentos WHERE ts > ?2`)
    .bind(ip, desde)
    .first();

  const propios = Number(fila?.propios || 0);
  const total = Number(fila?.total || 0);
  if (propios < MAX_POR_IP && total < MAX_GLOBAL) return null;

  const masAntiguo = await db
    .prepare('SELECT MIN(ts) AS ts FROM intentos WHERE ts > ?1')
    .bind(desde)
    .first();
  const libreEn = Number(masAntiguo?.ts || desde) + VENTANA_MS;
  return Math.max(1, Math.ceil((libreEn - Date.now()) / 1000));
}

export async function registrarFallo(db, ip) {
  await db.batch([
    db.prepare('INSERT INTO intentos (ip, ts) VALUES (?1, ?2)').bind(ip, Date.now()),
    db.prepare('DELETE FROM intentos WHERE ts < ?1').bind(Date.now() - VENTANA_MS * 4),
  ]);
}

export const limpiarIntentos = (db, ip) =>
  db.prepare('DELETE FROM intentos WHERE ip = ?1').bind(ip).run();

/* ------------------------------------------------------------------ cabeceras */

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "object-src 'none'",
].join('; ');

/** Aplica las cabeceras de seguridad a cualquier respuesta. */
export function blindar(respuesta) {
  const cabeceras = new Headers(respuesta.headers);
  cabeceras.set('Content-Security-Policy', CSP);
  cabeceras.set('X-Content-Type-Options', 'nosniff');
  cabeceras.set('Referrer-Policy', 'no-referrer');
  cabeceras.set('X-Frame-Options', 'DENY');
  cabeceras.set('Permissions-Policy', 'geolocation=(), camera=(), microphone=(), interest-cohort=()');
  cabeceras.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  cabeceras.set('Cross-Origin-Opener-Policy', 'same-origin');
  return new Response(respuesta.body, { status: respuesta.status, headers: cabeceras });
}
