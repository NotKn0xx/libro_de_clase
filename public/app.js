/* Libro de clases — lógica de la interfaz.
   Los tres formularios (asignatura, clase, fecha) comparten un mismo motor
   descrito en FORMULARIOS: abrir, guardar y eliminar se escriben una sola vez. */

(() => {
  'use strict';

  const $ = (sel, raiz = document) => raiz.querySelector(sel);
  const $$ = (sel, raiz = document) => Array.from(raiz.querySelectorAll(sel));

  let datos = { asignaturas: [], clases: [], fechas: [], docente: '' };
  let asignaturaAbierta = null;
  let editando = null;               // { recurso, id } o null

  /* ------------------------------------------------------------ servidor */

  async function api(ruta, opciones = {}) {
    const respuesta = await fetch('/api' + ruta, {
      ...opciones,
      credentials: 'same-origin',
      headers: {
        'X-Libro': '1',
        ...(opciones.cuerpo ? { 'Content-Type': 'application/json' } : {}),
      },
      body: opciones.cuerpo ? JSON.stringify(opciones.cuerpo) : undefined,
    });

    if (respuesta.status === 401 && ruta !== '/sesion') { mostrarEntrar(); throw new Error('sesion'); }

    const carga = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok) throw new Error(carga.error || 'No se pudo completar la operación.');
    return carga;
  }

  const cargarDatos = async () => { datos = await api('/datos'); };

  /* ------------------------------------------------------------ utilidades */

  const pad = (n) => String(n).padStart(2, '0');
  const hoyISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

  const desdeISO = (iso) => {
    if (!iso) return null;
    const [a, m, d] = iso.split('-').map(Number);
    return new Date(a, m - 1, d);
  };

  function diasHasta(iso) {
    const f = desdeISO(iso);
    if (!f) return null;
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    return Math.round((f - hoy) / 86400000);
  }

  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
    'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

  function fechaLarga(iso) {
    const f = desdeISO(iso);
    return f ? `${DIAS[f.getDay()]} ${f.getDate()} de ${MESES[f.getMonth()]}` : '';
  }
  function fechaCorta(iso) {
    const f = desdeISO(iso);
    return f ? `${pad(f.getDate())} ${MESES[f.getMonth()].slice(0, 3)}` : '';
  }

  function estadoDias(n) {
    if (n === null) return { texto: '—', clase: 'gris' };
    if (n < -1) return { texto: `hace ${Math.abs(n)} días`, clase: 'rojo' };
    if (n === -1) return { texto: 'ayer', clase: 'rojo' };
    if (n === 0) return { texto: 'hoy', clase: 'rojo' };
    if (n === 1) return { texto: 'mañana', clase: 'ambar' };
    if (n <= 7) return { texto: `en ${n} días`, clase: 'ambar' };
    return { texto: `en ${n} días`, clase: 'ok' };
  }

  const esc = (t) => String(t ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const asigPorId = (id) => datos.asignaturas.find((a) => a.id === id) || null;

  const archivada = (a) => Number(a?.archivada) === 1;
  const activas = () => datos.asignaturas.filter((a) => !archivada(a));

  const ultimaClase = (asigId) => datos.clases
    .filter((c) => c.asignatura_id === asigId && c.fecha)
    .sort((a, b) => b.fecha.localeCompare(a.fecha))[0] || null;

  const fechasDe = (asigId) => datos.fechas
    .filter((f) => !asigId || f.asignatura_id === asigId)
    .sort((a, b) => a.fecha.localeCompare(b.fecha));

  let temporizador = null;
  function avisar(texto, malo = false) {
    const el = $('#aviso');
    el.textContent = texto;
    el.classList.toggle('malo', malo);
    el.classList.add('visible');
    clearTimeout(temporizador);
    temporizador = setTimeout(() => el.classList.remove('visible'), malo ? 4200 : 2600);
  }

  /* ------------------------------------------------------------ pintado */

  function pintarCabecera() {
    const d = new Date();
    $('#fechaHoy').textContent =
      `${DIAS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
    $('#nombreDocente').textContent = datos.docente ? `· ${datos.docente}` : '';
    $('#inputDocente').value = datos.docente || '';
  }

  const sinAsignaturas = (mensaje) =>
    `<div class="vacio-estado"><p>${mensaje}</p>
     <button class="primario" data-accion="nueva-asignatura">Agregar mi primera asignatura</button></div>`;

  function pintarHoy() {
    const enCurso = activas();
    $('#siguientes').innerHTML = enCurso.length
      ? enCurso.map((a) => {
        const u = ultimaClase(a.id);
        const sigue = u?.proximo ? esc(u.proximo) : '';
        return `<article class="tarjeta siguiente">
            <div class="ramo">${esc(a.nombre)}</div>
            <div>
              <span class="etiqueta">Toca la próxima clase</span>
              <div class="contenido${sigue ? '' : ' vacio'}">${sigue || 'Sin anotar todavía'}</div>
            </div>
            <div class="pie">${u ? `Última clase: ${fechaLarga(u.fecha)}` : 'Aún no registras clases'}
              · <button class="enlace" data-abrir="${a.id}">ver diario</button></div>
          </article>`;
      }).join('')
      : sinAsignaturas(datos.asignaturas.length
        ? 'Todas tus asignaturas están archivadas.'
        : 'Todavía no hay asignaturas cargadas.');

    const pendientes = fechasDe()
      .filter((f) => f.estado !== 'Realizada' && !archivada(asigPorId(f.asignatura_id)))
      .slice(0, 6);
    $('#fechasProximas').innerHTML = pendientes.length
      ? pendientes.map(filaFecha).join('')
      : '<p class="sin-datos">No hay fechas pendientes anotadas.</p>';
  }

  function filaFecha(f) {
    const info = estadoDias(diasHasta(f.fecha));
    const clase = f.estado === 'Realizada' ? 'gris' : info.clase;
    const a = asigPorId(f.asignatura_id);
    return `<div class="fila-fecha">
        <div class="franja ${clase}"></div>
        <div class="desc">
          <strong>${esc(f.descripcion)}</strong>
          <small>${esc(f.tipo)}${a ? ` · ${esc(a.nombre)}` : ''} · ${fechaLarga(f.fecha)}${
            f.estado === 'Realizada' ? ' · realizada' : ''}</small>
        </div>
        <div class="lado">
          <span class="chip ${clase}">${f.estado === 'Realizada' ? 'lista' : info.texto}</span>
          <button class="enlace" data-editar="fechas:${f.id}">editar</button>
        </div>
      </div>`;
  }

  function tarjetaAsignatura(a) {
    const nClases = datos.clases.filter((c) => c.asignatura_id === a.id).length;
    const nPend = datos.fechas.filter((f) => f.asignatura_id === a.id && f.estado !== 'Realizada').length;
    const meta = [a.sigla, a.seccion].filter(Boolean).join(' · ');
    const fin = archivada(a);
    return `<article class="tarjeta siguiente${fin ? ' archivada' : ''}">
        <div class="ramo">${esc(a.nombre)}</div>
        ${meta ? `<div class="meta">${esc(meta)}</div>` : ''}
        ${fin ? '<div><span class="marca-archivada">semestre terminado</span></div>' : ''}
        <div class="contenido">${nClases} ${nClases === 1 ? 'clase anotada' : 'clases anotadas'}${
      fin ? '' : ` · ${nPend} ${nPend === 1 ? 'fecha pendiente' : 'fechas pendientes'}`}</div>
        <div class="pie">
          <button class="enlace" data-abrir="${a.id}">abrir diario →</button>
          · <button class="enlace" data-editar="asignaturas:${a.id}">editar o eliminar</button>
        </div>
      </article>`;
  }

  function pintarAsignaturas() {
    const enCurso = activas();
    const terminadas = datos.asignaturas.filter(archivada);

    $('#listaAsignaturas').innerHTML = enCurso.length
      ? enCurso.map(tarjetaAsignatura).join('')
      : sinAsignaturas(terminadas.length
        ? 'No tienes asignaturas en curso.'
        : 'Aquí van los ramos que dictas este semestre.');

    $('#archivadas').classList.toggle('oculto', terminadas.length === 0);
    $('#listaArchivadas').innerHTML = terminadas.map(tarjetaAsignatura).join('');
  }

  function pintarDetalle() {
    const a = asigPorId(asignaturaAbierta);
    if (!a) { irA('asignaturas'); return; }

    $('#detalleTitulo').textContent = a.nombre;
    $('#detalleSub').textContent = [a.sigla, a.seccion].filter(Boolean).join(' · ');

    const clases = datos.clases
      .filter((c) => c.asignatura_id === a.id)
      .sort((x, y) => y.fecha.localeCompare(x.fecha));

    $('#detalleClases').innerHTML = clases.length
      ? clases.map((c) => {
        const campos = [
          ['Unidad o tema', c.unidad], ['Lo que pasé', c.impartido],
          ['Lo que sigue', c.proximo], ['Observaciones', c.notas],
        ].filter(([, v]) => v);
        const f = desdeISO(c.fecha);
        return `<div class="entrada">
            <div class="cuando">
              <b>${fechaCorta(c.fecha)}</b>${f ? DIAS[f.getDay()] : ''}
              <span class="acciones-fila"><button class="enlace" data-editar="clases:${c.id}">editar</button></span>
            </div>
            <div>${campos.length
          ? campos.map(([k, v]) => `<div class="campo"><span class="k">${k}</span><span class="v">${esc(v)}</span></div>`).join('')
          : '<span class="apagado">Sin detalle</span>'}</div>
          </div>`;
      }).join('')
      : '<p class="sin-datos">Todavía no anotas clases en este ramo.</p>';

    const fs = fechasDe(a.id);
    $('#detalleFechas').innerHTML = fs.length
      ? fs.map(filaFecha).join('')
      : '<p class="sin-datos">Sin fechas anotadas.</p>';
  }

  function pintarFechas() {
    const fs = fechasDe();
    $('#todasFechas').innerHTML = fs.length
      ? fs.map(filaFecha).join('')
      : '<p class="sin-datos">No hay fechas anotadas todavía.</p>';
  }

  function pintar() {
    pintarCabecera();
    pintarHoy();
    pintarAsignaturas();
    pintarFechas();
    if (asignaturaAbierta) pintarDetalle();
  }

  /* ------------------------------------------------------------ navegación */

  const VISTAS = ['hoy', 'asignaturas', 'detalle', 'fechas', 'ajustes'];

  function irA(vista) {
    VISTAS.forEach((v) => $(`#vista-${v}`)?.classList.toggle('oculto', v !== vista));
    $$('.pestana').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.vista === vista)));
    window.scrollTo(0, 0);
  }

  /* ------------------------------------------------------------ formularios */

  const FORMULARIOS = {
    asignaturas: {
      dialogo: 'dlgAsignatura', titulo: 'dlgAsigTitulo', foco: 'asigNombre',
      botones: { guardar: 'asigGuardar', eliminar: 'asigEliminar' },
      rotulos: ['Nueva asignatura', 'Editar asignatura'],
      campos: {
        nombre: 'asigNombre', sigla: 'asigSigla',
        seccion: 'asigSeccion', archivada: 'asigArchivada',
      },
      requeridos: { nombre: 'Escribe el nombre de la asignatura' },
      confirmar: (o) => `¿Eliminar "${o.nombre}" y todas sus clases y fechas?`,
    },
    clases: {
      dialogo: 'dlgClase', titulo: 'dlgClaseTitulo', foco: 'claseImpartido',
      botones: { guardar: 'claseGuardar', eliminar: 'claseEliminar' },
      rotulos: ['Anotar una clase', 'Editar clase'],
      campos: {
        asignatura_id: 'claseAsig', fecha: 'claseFecha', unidad: 'claseUnidad',
        impartido: 'claseImpartido', proximo: 'claseProximo', notas: 'claseNotas',
      },
      requeridos: { fecha: 'Falta la fecha de la clase' },
      predeterminados: () => ({ fecha: hoyISO() }),
      confirmar: () => '¿Eliminar esta clase del diario?',
    },
    fechas: {
      dialogo: 'dlgFecha', titulo: 'dlgFechaTitulo', foco: 'fechaDesc',
      botones: { guardar: 'fechaGuardar', eliminar: 'fechaEliminar' },
      rotulos: ['Agregar fecha importante', 'Editar fecha'],
      campos: {
        asignatura_id: 'fechaAsig', tipo: 'fechaTipo', descripcion: 'fechaDesc',
        fecha: 'fechaCuando', estado: 'fechaEstado',
      },
      requeridos: { descripcion: 'Escribe de qué se trata', fecha: 'Falta la fecha' },
      predeterminados: () => ({ tipo: 'Prueba', estado: 'Pendiente' }),
      confirmar: () => '¿Eliminar esta fecha?',
    },
  };

  const SELECTORES_ASIGNATURA = ['claseAsig', 'fechaAsig'];

  function rellenarSelects(preferida) {
    const opciones = datos.asignaturas
      .map((a) => `<option value="${a.id}">${esc(a.nombre)}</option>`).join('');
    SELECTORES_ASIGNATURA.forEach((id) => {
      const sel = $('#' + id);
      sel.innerHTML = opciones;
      if (preferida) sel.value = preferida;
    });
  }

  function abrirFormulario(recurso, id = null, asigPreferida = null) {
    const def = FORMULARIOS[recurso];

    if (recurso !== 'asignaturas' && !datos.asignaturas.length) {
      avisar('Primero agrega una asignatura');
      irA('asignaturas');
      return;
    }

    editando = id ? { recurso, id } : null;
    const objeto = id ? datos[recurso].find((o) => o.id === id) : null;
    const valores = { ...(def.predeterminados?.() ?? {}), ...(objeto ?? {}) };

    rellenarSelects(objeto ? objeto.asignatura_id : asigPreferida);
    $('#' + def.titulo).textContent = def.rotulos[objeto ? 1 : 0];
    for (const [campo, elemento] of Object.entries(def.campos)) {
      const el = $('#' + elemento);
      if (el.type === 'checkbox') { el.checked = String(valores[campo] ?? '0') === '1'; continue; }
      if (valores[campo] !== undefined) el.value = valores[campo];
      else if (!SELECTORES_ASIGNATURA.includes(elemento)) el.value = '';
    }
    $('#' + def.botones.eliminar).classList.toggle('oculto', !objeto);

    if (recurso === 'clases') mostrarRecordatorio();
    $('#' + def.dialogo).showModal();
    setTimeout(() => $('#' + def.foco).focus(), 40);
  }

  async function guardarFormulario(recurso) {
    const def = FORMULARIOS[recurso];
    const cuerpo = {};
    for (const [campo, elemento] of Object.entries(def.campos)) {
      const el = $('#' + elemento);
      cuerpo[campo] = el.type === 'checkbox' ? (el.checked ? '1' : '0') : el.value.trim();
    }
    for (const [campo, mensaje] of Object.entries(def.requeridos)) {
      if (!cuerpo[campo]) { $('#' + def.campos[campo]).focus(); avisar(mensaje, true); return; }
    }

    const id = editando?.id ?? crypto.randomUUID();
    await conBoton($('#' + def.botones.guardar), async () => {
      await api(`/${recurso}/${id}`, { method: 'PUT', cuerpo });
      await cargarDatos();
      $('#' + def.dialogo).close();
      pintar();
      avisar('Guardado');
    });
  }

  async function eliminarFormulario(recurso) {
    if (!editando) return;
    const def = FORMULARIOS[recurso];
    const objeto = datos[recurso].find((o) => o.id === editando.id);
    if (!confirm(def.confirmar(objeto ?? {}))) return;

    await conBoton($('#' + def.botones.eliminar), async () => {
      await api(`/${recurso}/${editando.id}`, { method: 'DELETE' });
      if (recurso === 'asignaturas' && asignaturaAbierta === editando.id) {
        asignaturaAbierta = null;
        irA('asignaturas');
      }
      await cargarDatos();
      $('#' + def.dialogo).close();
      pintar();
      avisar('Eliminado');
    });
  }

  /** Desactiva el botón mientras corre la operación y muestra el error si falla. */
  async function conBoton(boton, tarea) {
    boton.disabled = true;
    try {
      await tarea();
    } catch (error) {
      if (error.message !== 'sesion') avisar(error.message, true);
    } finally {
      boton.disabled = false;
    }
  }

  function mostrarRecordatorio() {
    const caja = $('#claseRecordatorio');
    const u = editando ? null : ultimaClase($('#claseAsig').value);
    if (u?.proximo) {
      caja.innerHTML = `<b>La vez pasada anotaste que seguía:</b><br>${esc(u.proximo)}`;
      caja.classList.remove('oculto');
    } else {
      caja.classList.add('oculto');
    }
  }

  /* ------------------------------------------------------------ sesión */

  function mostrarEntrar() {
    $('#aplicacion').classList.add('oculto');
    $('#portada').classList.remove('oculto');
    $('#clave').value = '';
  }

  async function mostrarAplicacion() {
    $('#portada').classList.add('oculto');
    $('#aplicacion').classList.remove('oculto');
    $('#cargando').classList.remove('oculto');
    try {
      await cargarDatos();
      pintar();
      irA('hoy');
    } catch (error) {
      if (error.message !== 'sesion') avisar('No se pudieron cargar los datos.', true);
    } finally {
      $('#cargando').classList.add('oculto');
    }
  }

  $('#formEntrar').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const error = $('#errorEntrar');
    error.classList.add('oculto');
    await conBoton($('#botonEntrar'), async () => {
      try {
        await api('/sesion', { method: 'POST', cuerpo: { clave: $('#clave').value } });
        await mostrarAplicacion();
      } catch (e) {
        error.textContent = e.message;
        error.classList.remove('oculto');
      }
    });
  });

  /* ------------------------------------------------------------ copia */

  function exportar() {
    const texto = JSON.stringify(datos, null, 2);
    const url = URL.createObjectURL(new Blob([texto], { type: 'application/json' }));
    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = `libro-de-clases-${hoyISO()}.json`;
    document.body.appendChild(enlace);
    enlace.click();
    enlace.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    avisar('Copia descargada');
  }

  /* ------------------------------------------------------------ eventos */

  $$('.pestana').forEach((b) =>
    b.addEventListener('click', () => { asignaturaAbierta = null; irA(b.dataset.vista); }));

  $('#claseAsig').addEventListener('change', mostrarRecordatorio);

  for (const [recurso, def] of Object.entries(FORMULARIOS)) {
    $('#' + def.botones.guardar).addEventListener('click', () => guardarFormulario(recurso));
    $('#' + def.botones.eliminar).addEventListener('click', () => eliminarFormulario(recurso));
  }

  $$('[data-cerrar]').forEach((b) =>
    b.addEventListener('click', () => b.closest('dialog').close()));

  const ACCIONES = {
    'nueva-asignatura': () => abrirFormulario('asignaturas'),
    'editar-asignatura': () => abrirFormulario('asignaturas', asignaturaAbierta),
    'nueva-clase': () => abrirFormulario('clases'),
    'nueva-clase-aqui': () => abrirFormulario('clases', null, asignaturaAbierta),
    'nueva-fecha': () => abrirFormulario('fechas'),
    'nueva-fecha-aqui': () => abrirFormulario('fechas', null, asignaturaAbierta),
    'volver-asignaturas': () => { asignaturaAbierta = null; irA('asignaturas'); },
    exportar,
    'guardar-docente': async (boton) => conBoton(boton, async () => {
      const docente = $('#inputDocente').value.trim();
      await api('/ajustes', { method: 'PUT', cuerpo: { docente } });
      datos.docente = docente;
      pintarCabecera();
      avisar('Nombre guardado');
    }),
    salir: async (boton) => conBoton(boton, async () => {
      await api('/sesion', { method: 'DELETE' });
      datos = { asignaturas: [], clases: [], fechas: [], docente: '' };
      mostrarEntrar();
    }),
  };

  document.addEventListener('click', (ev) => {
    const boton = ev.target.closest('[data-accion],[data-abrir],[data-editar]');
    if (!boton) return;

    if (boton.dataset.abrir) {
      asignaturaAbierta = boton.dataset.abrir;
      irA('detalle');
      pintarDetalle();
      return;
    }
    if (boton.dataset.editar) {
      const [recurso, id] = boton.dataset.editar.split(':');
      abrirFormulario(recurso, id);
      return;
    }
    ACCIONES[boton.dataset.accion]?.(boton);
  });

  /* ------------------------------------------------------------ arranque */

  api('/sesion')
    .then(({ activa }) => (activa ? mostrarAplicacion() : mostrarEntrar()))
    .catch(mostrarEntrar);
})();
