/* Punto de entrada del Worker.
   Orden: cabeceras de seguridad -> sesión -> API o archivo estático. */

import { manejarApi, ErrorPeticion, json } from './api.js';
import {
  blindar, cookieBorrada, cookieSesion, crearSesion, intentoBloqueado,
  leerCookie, limpiarIntentos, registrarFallo, sesionValida, verificarClave, COOKIE,
} from './seguridad.js';

const MUTA = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

/** Rechaza peticiones que no vengan de la propia página (defensa CSRF). */
function mismoOrigen(peticion) {
  if (peticion.headers.get('X-Libro') !== '1') return false;
  const origen = peticion.headers.get('Origin');
  if (!origen) return true;                       // navegación directa, sin CORS
  try {
    return new URL(origen).host === new URL(peticion.url).host;
  } catch {
    return false;
  }
}

async function manejarSesion(peticion, env, metodo) {
  if (metodo === 'GET') {
    const activa = await sesionValida(env.SECRETO_SESION, leerCookie(peticion, COOKIE));
    return json({ activa });
  }

  if (metodo === 'DELETE') {
    const respuesta = json({ activa: false });
    respuesta.headers.append('Set-Cookie', cookieBorrada());
    return respuesta;
  }

  if (metodo !== 'POST') throw new ErrorPeticion(405, 'Método no permitido.');

  const ip = peticion.headers.get('CF-Connecting-IP') || 'desconocida';
  const espera = await intentoBloqueado(env.DB, ip);
  if (espera !== null) {
    return json(
      { error: `Demasiados intentos. Vuelve a probar en ${Math.ceil(espera / 60)} minutos.` },
      429,
    );
  }

  let clave = '';
  try {
    ({ clave = '' } = await peticion.json());
  } catch {
    throw new ErrorPeticion(400, 'Petición inválida.');
  }

  if (typeof clave !== 'string' || clave.length > 200 || !(await verificarClave(clave, env.CLAVE_HASH))) {
    await registrarFallo(env.DB, ip);
    return json({ error: 'La clave no es correcta.' }, 401);
  }

  await limpiarIntentos(env.DB, ip);
  const respuesta = json({ activa: true });
  respuesta.headers.append('Set-Cookie', cookieSesion(await crearSesion(env.SECRETO_SESION)));
  return respuesta;
}

async function enrutar(peticion, env) {
  const { pathname } = new URL(peticion.url);

  if (!pathname.startsWith('/api/')) {
    // Solo lectura de archivos estáticos. Reenviar un PUT/POST con cuerpo sin
    // consumir al binding de assets aborta la petición dentro del runtime.
    if (peticion.method !== 'GET' && peticion.method !== 'HEAD') {
      return json({ error: 'Método no permitido.' }, 405);
    }
    return env.ASSETS.fetch(peticion);
  }

  if (!env.CLAVE_HASH || !env.SECRETO_SESION) {
    return json({ error: 'Faltan los secretos CLAVE_HASH y SECRETO_SESION.' }, 500);
  }
  if (MUTA.has(peticion.method) && !mismoOrigen(peticion)) {
    return json({ error: 'Petición rechazada.' }, 403);
  }

  if (pathname === '/api/sesion') return manejarSesion(peticion, env, peticion.method);

  if (!(await sesionValida(env.SECRETO_SESION, leerCookie(peticion, COOKIE)))) {
    return json({ error: 'Sesión no iniciada.' }, 401);
  }
  return manejarApi(peticion, env, pathname);
}

export default {
  async fetch(peticion, env) {
    try {
      return blindar(await enrutar(peticion, env));
    } catch (error) {
      if (error instanceof ErrorPeticion) {
        return blindar(json({ error: error.message }, error.estado));
      }
      console.error('Error no controlado:', error?.message);
      return blindar(json({ error: 'Error interno.' }, 500));
    }
  },
};
