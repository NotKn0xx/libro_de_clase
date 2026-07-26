-- Permite marcar una asignatura como terminada sin perder su diario.
-- Aplicar una sola vez sobre una base ya creada:
--   npx wrangler d1 execute libro-clases --local  --file=./migraciones/001-archivar-asignaturas.sql
--   npx wrangler d1 execute libro-clases --remote --file=./migraciones/001-archivar-asignaturas.sql
--
-- En bases nuevas no hace falta: la columna ya viene en schema.sql.

ALTER TABLE asignaturas ADD COLUMN archivada INTEGER NOT NULL DEFAULT 0;
