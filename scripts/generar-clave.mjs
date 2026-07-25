/* Genera los dos secretos que necesita el Worker.
   Uso:  node scripts/generar-clave.mjs  ["mi clave secreta"]
   Sin argumento, propone una frase de paso fácil de recordar y difícil de adivinar. */

import { webcrypto as crypto } from 'node:crypto';

const ITERACIONES = 30000;   // debe coincidir con src/seguridad.js

const PALABRAS = [
  'arena','arbol','avion','barco','bosque','brisa','cabra','camino','campo','canto',
  'carta','cerro','cielo','ciervo','cobre','cuerda','desierto','duna','estrella','faro',
  'fuego','fruta','glaciar','grano','hierro','hoja','humo','invierno','isla','jardin',
  'lago','lampara','lluvia','luna','madera','maiz','manzana','mapa','mar','miel',
  'monte','nieve','nube','oceano','otoño','pajaro','panal','piedra','pino','playa',
  'pluma','puente','puerto','rama','rio','roble','roca','sal','selva','semilla',
  'sendero','sol','sombra','trigo','trueno','valle','vela','viento','volcan','zorro',
];

const b64u = (bytes) =>
  Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const aleatorio = (n) => crypto.getRandomValues(new Uint8Array(n));

function fraseDePaso(palabras = 4) {
  const elegidas = [];
  for (let i = 0; i < palabras; i++) {
    const bytes = new Uint32Array(1);
    crypto.getRandomValues(bytes);
    elegidas.push(PALABRAS[bytes[0] % PALABRAS.length]);
  }
  return elegidas.join('-');
}

async function hashear(clave) {
  const sal = aleatorio(16);
  const material = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(clave), 'PBKDF2', false, ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: sal, iterations: ITERACIONES }, material, 256,
  );
  return `pbkdf2$${ITERACIONES}$${b64u(sal)}$${b64u(new Uint8Array(bits))}`;
}

const clave = process.argv[2] || fraseDePaso();
const propuesta = !process.argv[2];

if (clave.length < 10) {
  console.error('\nLa clave es muy corta. Usa al menos 10 caracteres.\n');
  process.exit(1);
}

const hash = await hashear(clave);
const secretoSesion = b64u(aleatorio(32));

console.log(`
──────────────────────────────────────────────────────────────
 CLAVE PARA ENTRAR${propuesta ? ' (generada automáticamente)' : ''}

     ${clave}

 ${propuesta ? 'Anótala. Es fácil de recordar y muy difícil de adivinar.' : ''}
 No vuelve a mostrarse: el servidor solo guarda su huella.
──────────────────────────────────────────────────────────────

Ahora ejecuta estos dos comandos y pega el valor cuando te lo pida:

  npx wrangler secret put CLAVE_HASH
${hash}

  npx wrangler secret put SECRETO_SESION
${secretoSesion}
`);
