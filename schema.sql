-- Libro de clases — esquema D1 (SQLite)
-- Ejecutar con:  npx wrangler d1 execute libro-clases --local  --file=./schema.sql
--                npx wrangler d1 execute libro-clases --remote --file=./schema.sql

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS asignaturas (
  id          TEXT PRIMARY KEY,
  nombre      TEXT NOT NULL,
  sigla       TEXT NOT NULL DEFAULT '',
  seccion     TEXT NOT NULL DEFAULT '',
  archivada   INTEGER NOT NULL DEFAULT 0,   -- 1 = semestre terminado
  creado      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS clases (
  id             TEXT PRIMARY KEY,
  asignatura_id  TEXT NOT NULL REFERENCES asignaturas(id) ON DELETE CASCADE,
  fecha          TEXT NOT NULL,               -- AAAA-MM-DD
  unidad         TEXT NOT NULL DEFAULT '',
  impartido      TEXT NOT NULL DEFAULT '',
  proximo        TEXT NOT NULL DEFAULT '',
  notas          TEXT NOT NULL DEFAULT '',
  creado         INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS fechas (
  id             TEXT PRIMARY KEY,
  asignatura_id  TEXT NOT NULL REFERENCES asignaturas(id) ON DELETE CASCADE,
  tipo           TEXT NOT NULL,
  descripcion    TEXT NOT NULL,
  fecha          TEXT NOT NULL,               -- AAAA-MM-DD
  estado         TEXT NOT NULL,
  creado         INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ajustes (
  clave  TEXT PRIMARY KEY,
  valor  TEXT NOT NULL
);

-- Intentos fallidos de inicio de sesión, para frenar ataques de fuerza bruta.
CREATE TABLE IF NOT EXISTS intentos (
  id  INTEGER PRIMARY KEY AUTOINCREMENT,
  ip  TEXT NOT NULL,
  ts  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_clases_asig   ON clases(asignatura_id, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_fechas_asig   ON fechas(asignatura_id, fecha);
CREATE INDEX IF NOT EXISTS idx_fechas_fecha  ON fechas(fecha);
CREATE INDEX IF NOT EXISTS idx_intentos_ts   ON intentos(ts);
CREATE INDEX IF NOT EXISTS idx_intentos_ip   ON intentos(ip, ts);
