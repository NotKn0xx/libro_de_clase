# Libro de clases

Panel personal para docentes: qué se pasó en cada clase, qué sigue la próxima, y las
fechas de pruebas y presentaciones. Los datos viven en el servidor, así que se ven
igual desde el computador y desde el teléfono.

- **Frontend**: HTML, CSS y JavaScript sin dependencias ni compilación.
- **Backend**: Cloudflare Worker + base de datos D1 (SQLite).
- **Coste**: $0. Entra dentro del plan gratuito de Cloudflare (100.000 peticiones al día).

Se eligió Cloudflare y no Render porque los servicios web gratuitos de Render se
duermen tras 15 minutos sin uso y tardan ~50 segundos en despertar. Un Worker
responde siempre al instante.

---

## Despliegue (unos 15 minutos, una sola vez)

Necesitas [Node.js](https://nodejs.org) y una cuenta gratuita en
[Cloudflare](https://dash.cloudflare.com/sign-up).

### 1. Instalar dependencias

```bash
cd libro-clases-app
npm install
```

### 2. Entrar en tu cuenta de Cloudflare

```bash
npx wrangler login
```

Se abre el navegador y te pide autorizar. Es la única vez.

### 3. Crear la base de datos

```bash
npx wrangler d1 create libro-clases
```

Devuelve un `database_id`. **Cópialo y pégalo en `wrangler.toml`**, reemplazando
el valor de ejemplo:

```toml
[[d1_databases]]
binding = "DB"
database_name = "libro-clases"
database_id = "aquí-va-el-id-que-te-dio"
```

### 4. Crear las tablas

```bash
npm run esquema:remoto
```

### 5. Generar la clave de acceso

```bash
npm run clave
```

Sin argumentos propone una frase fácil de recordar (por ejemplo `nube-roble-faro-trigo`).
Si prefieres elegirla tú:

```bash
npm run clave -- "la clave que quieras"
```

El script imprime la clave y dos valores. Ejecuta los dos comandos que te indica
y pega cada valor cuando lo pida:

```bash
npx wrangler secret put CLAVE_HASH
npx wrangler secret put SECRETO_SESION
```

> La clave en sí **no se guarda en ninguna parte**: el servidor solo conserva su
> huella criptográfica. Si se pierde, se genera otra repitiendo este paso.

### 6. Publicar

```bash
npm run deploy
```

Wrangler imprime la dirección, del estilo
`https://libro-clases.TU-USUARIO.workers.dev`. Esa es la página. Ábrela en el
teléfono y guárdala en la pantalla de inicio.

---

## Actualizar la página más adelante

```bash
npm run deploy
```

Los datos no se tocan: el despliegue solo reemplaza el código.

---

## Migraciones de la base de datos

`schema.sql` siempre refleja el estado actual, así que una **instalación nueva** solo
necesita `npm run esquema:remoto`. Las bases **ya creadas** necesitan además las
migraciones de la carpeta `migraciones/`, en orden y una sola vez cada una:

```bash
npx wrangler d1 execute libro-clases --local  --file=./migraciones/001-archivar-asignaturas.sql
npx wrangler d1 execute libro-clases --remote --file=./migraciones/001-archivar-asignaturas.sql
```

| Migración | Qué hace | Aplicada en producción |
|---|---|---|
| `001-archivar-asignaturas.sql` | Añade `asignaturas.archivada` para marcar semestres terminados | 26-07-2026 |

Para saber si una base ya la tiene:

```bash
npx wrangler d1 execute libro-clases --remote --command "SELECT name FROM pragma_table_info('asignaturas');"
```

Las migraciones usan `ALTER TABLE ... ADD COLUMN` con valor por defecto, así que **no
borran ni modifican datos existentes**.

---

## Cambiar la clave

Se puede cambiar las veces que quieras. Genera una nueva y súbela:

```bash
npm run clave                      # o:  npm run clave -- "la nueva clave"
npx wrangler secret put CLAVE_HASH
```

Surte efecto en segundos. **No hay que volver a desplegar** y **no se pierde ningún dato**.

### Cuidado con las sesiones ya abiertas

Cambiar `CLAVE_HASH` afecta a quien intente **entrar de nuevo**, pero **no cierra las
sesiones que ya están abiertas**: la cookie va firmada con `SECRETO_SESION` y dura
30 días. Un dispositivo que ya entró sigue dentro aunque cambies la clave.

Para uso normal (por ejemplo, "quiero una clave más fácil de recordar") eso da igual.

Pero si el motivo del cambio es que **alguien pudo ver la clave**, o **perdiste un
teléfono con la sesión abierta**, hay que rotar también el secreto de sesión:

```bash
npm run clave                          # apunta el nuevo SECRETO_SESION
npx wrangler secret put CLAVE_HASH
npx wrangler secret put SECRETO_SESION
```

Al cambiar `SECRETO_SESION`, **todas las cookies existentes dejan de valer al instante**
y cualquier dispositivo tiene que volver a escribir la clave. Es el botón de
«echar a todos», y también sirve si simplemente quieres cerrar sesión en un
dispositivo al que ya no tienes acceso.

---

## Desarrollo local

```bash
npm run esquema:local
npm run dev            # http://127.0.0.1:8788
```

En local los secretos se leen de `.dev.vars` (no se sube a git, no se despliega).
La clave que trae ese archivo es **solo de pruebas**: no la uses en producción.

Para pasar la batería de pruebas con el servidor local levantado:

```bash
node scripts/probar.mjs
```

---

## Cómo está protegida

| Riesgo | Medida |
|---|---|
| Que alguien entre con la dirección | Clave obligatoria; sin sesión válida la API devuelve 401 |
| Adivinar la clave por fuerza bruta | Máximo 8 fallos por IP y 30 en total cada 15 minutos; después se bloquea |
| Robar la clave desde la base de datos | No está: solo se guarda un hash PBKDF2-SHA256 con sal, y como secreto de Cloudflare, no en D1 |
| Falsificar una sesión | Cookie firmada con HMAC-SHA256 y comparada byte a byte en tiempo constante |
| Robar la cookie con JavaScript | `HttpOnly`, `Secure`, `SameSite=Strict`, caduca a los 30 días |
| Que otra web haga peticiones en tu nombre (CSRF) | `SameSite=Strict`, cabecera propia obligatoria, verificación de `Origin`, sin CORS |
| Inyección SQL | Todas las consultas usan sentencias preparadas con parámetros |
| Inyección de HTML o scripts (XSS) | Todo texto se escapa al pintarlo, y la CSP prohíbe scripts y estilos en línea |
| Enviar basura o datos gigantes | Validación por campo (tipo, largo, opciones, fecha real), cuerpo máximo de 64 KB y tope de filas |
| Espionaje de la conexión | HTTPS obligatorio con HSTS |

Sobre el número de iteraciones del hash: el plan gratuito de Workers limita cada
petición a 10 ms de CPU, así que PBKDF2 usa 30.000 iteraciones en lugar de las
600.000 que recomienda OWASP. Es una decisión consciente y aceptable aquí, porque
el hash **no está en la base de datos** sino en un secreto de Cloudflare: no existe
el escenario de "se filtró la base y la descifran sin conexión". Contra la
adivinación en línea —que sí es el riesgo real— protege el límite de intentos.

---

## Estructura

```
libro-clases-app/
├── wrangler.toml          configuración del Worker y la base de datos
├── schema.sql             tablas e índices
├── src/
│   ├── index.js           enrutado, sesión y cabeceras de seguridad
│   ├── seguridad.js       contraseñas, cookies firmadas, límite de intentos
│   └── api.js             CRUD dirigido por la tabla RECURSOS
├── public/
│   ├── index.html         la página
│   ├── app.css            estilos (claro y oscuro)
│   └── app.js             lógica de la interfaz
└── scripts/
    ├── generar-clave.mjs  genera los secretos
    └── probar.mjs         41 pruebas de la API
```

Para añadir un campo nuevo a una clase o a una fecha basta con tocar tres sitios:
la tabla en `schema.sql`, la definición en `RECURSOS` (`src/api.js`) y el
formulario correspondiente en `public/index.html` y `FORMULARIOS` (`public/app.js`).
