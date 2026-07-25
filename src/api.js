/* API de datos. Un único motor CRUD dirigido por la tabla RECURSOS:
   añadir un campo o una entidad no requiere escribir otro manejador. */

const TIPOS_FECHA = ['Prueba', 'Presentación', 'Entrega', 'Examen', 'Taller', 'Salida a terreno', 'Otro'];
const ESTADOS = ['Pendiente', 'Realizada', 'Reprogramada'];

const RECURSOS = {
  asignaturas: {
    tope: 40,
    campos: {
      nombre:  { texto: 120, requerido: true },
      sigla:   { texto: 40 },
      seccion: { texto: 40 },
    },
  },
  clases: {
    tope: 3000,
    campos: {
      asignatura_id: { referencia: 'asignaturas', requerido: true },
      fecha:         { fecha: true, requerido: true },
      unidad:        { texto: 200 },
      impartido:     { texto: 4000 },
      proximo:       { texto: 4000 },
      notas:         { texto: 4000 },
    },
  },
  fechas: {
    tope: 1500,
    campos: {
      asignatura_id: { referencia: 'asignaturas', requerido: true },
      tipo:          { opciones: TIPOS_FECHA, requerido: true },
      descripcion:   { texto: 300, requerido: true },
      fecha:         { fecha: true, requerido: true },
      estado:        { opciones: ESTADOS, requerido: true },
    },
  },
};

/** Filas que hay que borrar junto con su asignatura. */
const DEPENDIENTES = { asignaturas: ['clases', 'fechas'] };

const ES_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ES_FECHA = /^\d{4}-\d{2}-\d{2}$/;

const fechaReal = (valor) => {
  if (!ES_FECHA.test(valor)) return false;
  const [a, m, d] = valor.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31 || a < 2000 || a > 2100) return false;
  const fecha = new Date(Date.UTC(a, m - 1, d));
  return fecha.getUTCFullYear() === a && fecha.getUTCMonth() === m - 1 && fecha.getUTCDate() === d;
};

class ErrorPeticion extends Error {
  constructor(estado, mensaje) { super(mensaje); this.estado = estado; }
}

/** Valida el cuerpo contra la definición del recurso y devuelve solo campos conocidos. */
function validar(definicion, cuerpo) {
  if (!cuerpo || typeof cuerpo !== 'object' || Array.isArray(cuerpo)) {
    throw new ErrorPeticion(400, 'Los datos enviados no son válidos.');
  }
  for (const clave of Object.keys(cuerpo)) {
    if (!(clave in definicion.campos)) throw new ErrorPeticion(400, `Campo desconocido: ${clave}`);
  }

  const limpio = {};
  for (const [clave, regla] of Object.entries(definicion.campos)) {
    const bruto = cuerpo[clave];

    if (bruto === undefined || bruto === null || bruto === '') {
      if (regla.requerido) throw new ErrorPeticion(400, `Falta el campo ${clave}.`);
      limpio[clave] = '';
      continue;
    }
    if (typeof bruto !== 'string') throw new ErrorPeticion(400, `El campo ${clave} debe ser texto.`);

    const valor = bruto.trim();
    if (regla.texto !== undefined) {
      if (valor.length > regla.texto) {
        throw new ErrorPeticion(400, `El campo ${clave} supera ${regla.texto} caracteres.`);
      }
    } else if (regla.opciones) {
      if (!regla.opciones.includes(valor)) throw new ErrorPeticion(400, `Valor no permitido en ${clave}.`);
    } else if (regla.fecha) {
      if (!fechaReal(valor)) throw new ErrorPeticion(400, `La fecha de ${clave} no es válida.`);
    } else if (regla.referencia) {
      if (!ES_ID.test(valor)) throw new ErrorPeticion(400, `Referencia inválida en ${clave}.`);
    }
    limpio[clave] = valor;
  }
  return limpio;
}

const json = (datos, estado = 200) =>
  new Response(JSON.stringify(datos), {
    status: estado,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

/* ------------------------------------------------------------------ operaciones */

async function leerTodo(db) {
  const [asignaturas, clases, fechas, ajustes] = await db.batch([
    db.prepare('SELECT id, nombre, sigla, seccion FROM asignaturas ORDER BY creado'),
    db.prepare('SELECT id, asignatura_id, fecha, unidad, impartido, proximo, notas FROM clases ORDER BY fecha DESC'),
    db.prepare('SELECT id, asignatura_id, tipo, descripcion, fecha, estado FROM fechas ORDER BY fecha'),
    db.prepare('SELECT clave, valor FROM ajustes'),
  ]);

  const mapaAjustes = {};
  for (const fila of ajustes.results) mapaAjustes[fila.clave] = fila.valor;

  return {
    asignaturas: asignaturas.results,
    clases: clases.results,
    fechas: fechas.results,
    docente: mapaAjustes.docente || '',
  };
}

async function guardar(db, nombre, id, cuerpo) {
  const definicion = RECURSOS[nombre];
  const datos = validar(definicion, cuerpo);

  const existe = await db.prepare(`SELECT 1 FROM ${nombre} WHERE id = ?1`).bind(id).first();

  if (!existe) {
    const { total } = await db.prepare(`SELECT COUNT(*) AS total FROM ${nombre}`).first();
    if (total >= definicion.tope) {
      throw new ErrorPeticion(409, `Se alcanzó el máximo de ${definicion.tope} registros.`);
    }
  }
  if (datos.asignatura_id) {
    const padre = await db.prepare('SELECT 1 FROM asignaturas WHERE id = ?1').bind(datos.asignatura_id).first();
    if (!padre) throw new ErrorPeticion(400, 'La asignatura indicada no existe.');
  }

  const columnas = Object.keys(datos);
  const marcadores = columnas.map((_, i) => `?${i + 2}`);
  const valores = columnas.map((c) => datos[c]);

  await db
    .prepare(
      `INSERT INTO ${nombre} (id, ${columnas.join(', ')}, creado)
       VALUES (?1, ${marcadores.join(', ')}, ?${columnas.length + 2})
       ON CONFLICT(id) DO UPDATE SET ${columnas.map((c, i) => `${c} = ?${i + 2}`).join(', ')}`,
    )
    .bind(id, ...valores, Date.now())
    .run();

  return { id, ...datos };
}

/* ------------------------------------------------------------------ enrutado */

export async function manejarApi(peticion, env, ruta) {
  const db = env.DB;
  const metodo = peticion.method;
  const partes = ruta.split('/').filter(Boolean);   // ['api', recurso, id?]

  if (partes.length === 2 && partes[1] === 'datos' && metodo === 'GET') {
    return json(await leerTodo(db));
  }

  if (partes.length === 2 && partes[1] === 'ajustes' && metodo === 'PUT') {
    const cuerpo = await cuerpoJson(peticion);
    const docente = typeof cuerpo?.docente === 'string' ? cuerpo.docente.trim().slice(0, 80) : '';
    await db
      .prepare(`INSERT INTO ajustes (clave, valor) VALUES ('docente', ?1)
                ON CONFLICT(clave) DO UPDATE SET valor = ?1`)
      .bind(docente)
      .run();
    return json({ docente });
  }

  if (partes.length === 3 && RECURSOS[partes[1]]) {
    const [, nombre, id] = partes;
    if (!ES_ID.test(id)) throw new ErrorPeticion(400, 'Identificador inválido.');

    if (metodo === 'PUT') return json(await guardar(db, nombre, id, await cuerpoJson(peticion)));

    if (metodo === 'DELETE') {
      // Se borran los hijos explícitamente en lugar de confiar en ON DELETE
      // CASCADE: así el resultado no depende de que D1 tenga activadas las
      // claves foráneas en la conexión.
      const sentencias = (DEPENDIENTES[nombre] ?? []).map((hijo) =>
        db.prepare(`DELETE FROM ${hijo} WHERE asignatura_id = ?1`).bind(id));
      sentencias.push(db.prepare(`DELETE FROM ${nombre} WHERE id = ?1`).bind(id));
      await db.batch(sentencias);
      return json({ eliminado: id });
    }
  }

  throw new ErrorPeticion(404, 'Recurso no encontrado.');
}

async function cuerpoJson(peticion) {
  const largo = Number(peticion.headers.get('Content-Length') || 0);
  if (largo > 64 * 1024) throw new ErrorPeticion(413, 'El contenido es demasiado grande.');
  try {
    return await peticion.json();
  } catch {
    throw new ErrorPeticion(400, 'El contenido no es JSON válido.');
  }
}

export { ErrorPeticion, json };
