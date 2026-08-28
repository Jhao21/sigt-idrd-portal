(function (global) {
  'use strict';
  const formato = new Intl.NumberFormat('es-CO');
  const mapas = {};
  const graficos = {};
  const cacheCentrosParques = new Map();
  const cacheTerritorioParques = new Map();
  const cacheNombresUpl = new Map();
  const GIS_PARQUES_URL = 'https://visorsrv.idrd.gov.co/srv/rest/services/ParquesIDRD/Parques/MapServer/0/query';
  const GIS_UPL_URL = 'https://visorsrv.idrd.gov.co/srv/rest/services/ParquesIDRD/ENTIDAD_TERRITORIAL/MapServer/0/query';
  let reportes;
  let actividades;
  let reportesMapa = [];
  let actividadesMapa = [];
  let actividadesPorParque = [];
  let capaMantenimiento;
  let capaActividades;
  let solicitudMapaMantenimiento = 0;
  let solicitudMapaActividades = 0;

  function mapa(id) {
    const instancia = global.L.map(id, { scrollWheelZoom: false }).setView(global.SIGT_CONFIG.MAP_CENTER, global.SIGT_CONFIG.MAP_ZOOM);
    global.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(instancia);
    global.L.control.scale({ imperial: false }).addTo(instancia);
    return instancia;
  }
  function iniciarVisuales() {
    mapas.reportes = mapa('reports-map'); mapas.actividades = mapa('activities-map');
    capaMantenimiento = global.L.layerGroup().addTo(mapas.reportes);
    capaActividades = global.L.layerGroup().addTo(mapas.actividades);
    graficos.categoria = global.echarts.init(document.getElementById('reports-category-chart'));
    graficos.novedad = global.echarts.init(document.getElementById('reports-type-chart'));
    graficos.programa = global.echarts.init(document.getElementById('activities-program-chart'));
    graficos.tipo = global.echarts.init(document.getElementById('activities-type-chart'));
    graficos.linea = global.echarts.init(document.getElementById('activities-line-chart'));
  }
  function escaparValorWhere(valor) { return String(valor).replace(/'/g, "''"); }
  function territorioVacio() { return { Codigo_UPL: '', Nombre_UPL: 'Sin territorialización pública', Codigo_Localidad: '', Localidad: 'Sin territorialización pública' }; }
  function normalizarCodigoLocalidad(valor) {
    const texto = valor === null || typeof valor === 'undefined' ? '' : String(valor).trim();
    if (!texto) return '';
    const codigo = Number(texto);
    return Number.isInteger(codigo) ? String(codigo).padStart(2, '0') : texto;
  }
  async function consultarNombreUpl(codigoUpl) {
    const codigo = String(codigoUpl || '').trim();
    if (!codigo) return '';
    if (cacheNombresUpl.has(codigo)) return cacheNombresUpl.get(codigo);
    const consulta = (async function () {
      const url = new URL(GIS_UPL_URL);
      url.search = new URLSearchParams({ where: "CODIGO_UPL='" + escaparValorWhere(codigo) + "'", outFields: 'NOMBRE', returnGeometry: 'false', f: 'json' }).toString();
      const respuesta = await fetch(url.toString(), { method: 'GET' });
      if (!respuesta.ok) return '';
      const datos = await respuesta.json();
      const entidad = datos.features && datos.features[0];
      return entidad && entidad.attributes ? String(entidad.attributes.NOMBRE || '').trim() : '';
    }()).catch(function () { return ''; });
    cacheNombresUpl.set(codigo, consulta);
    consulta.then(function (nombre) { cacheNombresUpl.set(codigo, nombre); });
    return consulta;
  }
  async function consultarTerritorioParque(idParque) {
    const codigo = String(idParque || '').trim();
    if (!codigo) return territorioVacio();
    if (cacheTerritorioParques.has(codigo)) return cacheTerritorioParques.get(codigo);
    const consulta = (async function () {
      const url = new URL(GIS_PARQUES_URL);
      url.search = new URLSearchParams({ where: "ID_PARQUE='" + escaparValorWhere(codigo) + "'", outFields: 'ID_UPL,LOCNOMBRE,ID_LOCALIDAD', returnGeometry: 'false', f: 'json' }).toString();
      const respuesta = await fetch(url.toString(), { method: 'GET' });
      if (!respuesta.ok) return territorioVacio();
      const datos = await respuesta.json();
      const entidad = datos.features && datos.features[0];
      if (!entidad || !entidad.attributes) return territorioVacio();
      const atributos = entidad.attributes;
      const codigoUpl = String(atributos.ID_UPL || '').trim();
      return {
        Codigo_UPL: codigoUpl,
        Nombre_UPL: await consultarNombreUpl(codigoUpl),
        Codigo_Localidad: normalizarCodigoLocalidad(atributos.ID_LOCALIDAD),
        Localidad: String(atributos.LOCNOMBRE || '').trim()
      };
    }()).catch(function () { return territorioVacio(); });
    cacheTerritorioParques.set(codigo, consulta);
    consulta.then(function (territorio) { cacheTerritorioParques.set(codigo, territorio); });
    return consulta;
  }
  async function territorializarItems(items) {
    return Promise.all(items.map(async function (item) {
      const territorio = await consultarTerritorioParque(item.ID_Parque);
      return Object.assign({}, item, territorio);
    }));
  }
  function poblarSelect(selector, opciones) {
    const select = document.querySelector(selector);
    const fragmento = document.createDocumentFragment();
    opciones.forEach(function (opcion) {
      const elemento = document.createElement('option');
      elemento.value = opcion.valor;
      elemento.textContent = opcion.etiqueta;
      fragmento.appendChild(elemento);
    });
    select.appendChild(fragmento);
  }
  function poblarSelectsTerritoriales(territorios) {
    const localidades = new Map();
    const upls = new Map();
    territorios.forEach(function (territorio) {
      const localidad = String(territorio.Localidad || '').trim();
      const codigoLocalidad = String(territorio.Codigo_Localidad || '').trim();
      const nombreUpl = String(territorio.Nombre_UPL || '').trim();
      const codigoUpl = String(territorio.Codigo_UPL || '').trim();
      if (localidad) localidades.set(normalizarFiltro(localidad), { valor: codigoLocalidad || localidad, etiqueta: codigoLocalidad ? codigoLocalidad + ' · ' + localidad : localidad });
      if (nombreUpl) upls.set(normalizarFiltro(nombreUpl), { valor: codigoUpl || nombreUpl, etiqueta: codigoUpl ? codigoUpl + ' · ' + nombreUpl : nombreUpl });
    });
    const ordenar = function (a, b) { return a.etiqueta.localeCompare(b.etiqueta, 'es', { sensitivity: 'base' }); };
    const opcionesLocalidad = Array.from(localidades.values()).sort(ordenar);
    const opcionesUpl = Array.from(upls.values()).sort(ordenar);
    ['#report-filters select[name="localidad"]', '#activity-filters select[name="localidad"]'].forEach(function (selector) { poblarSelect(selector, opcionesLocalidad); });
    ['#report-filters select[name="upl"]', '#activity-filters select[name="upl"]'].forEach(function (selector) { poblarSelect(selector, opcionesUpl); });
  }
  async function cargarOpcionesTerritoriales() {
    const grupos = (reportes.porParque || []).concat(actividades.porParque || []);
    const ids = Array.from(new Set(grupos.map(function (parque) { return String(parque.idParque || '').trim(); }).filter(Boolean)));
    const territorios = await Promise.all(ids.map(consultarTerritorioParque));
    const existeSinParque = grupos.some(function (parque) { return !String(parque.idParque || '').trim(); });
    if (existeSinParque) territorios.push(territorioVacio());
    poblarSelectsTerritoriales(territorios);
  }
  function cargarOpcionesCategoricas() {
    const opciones = function (grupos) {
      return (grupos || [])
        .map(function (grupo) { return String(grupo.valor || '').trim(); })
        .filter(Boolean)
        .sort(function (a, b) { return a.localeCompare(b, 'es', { sensitivity: 'base' }); })
        .map(function (valor) { return { valor: valor, etiqueta: valor }; });
    };
    poblarSelect('#report-filters select[name="categoria"]', opciones(reportes.porCategoria));
    poblarSelect('#report-filters select[name="tipoNovedad"]', opciones(reportes.porTipoNovedad));
    poblarSelect('#activity-filters select[name="tipoActividad"]', opciones(actividades.porTipoActividad));
    poblarSelect('#activity-filters select[name="programa"]', opciones(actividades.porPrograma));
    poblarSelect('#activity-filters select[name="linea"]', opciones(actividades.porLinea));
  }
  async function consultarCentroParque(idParque) {
    const codigo = String(idParque || '').trim();
    if (!codigo) return null;
    if (cacheCentrosParques.has(codigo)) return cacheCentrosParques.get(codigo);
    const url = new URL(GIS_PARQUES_URL);
    url.search = new URLSearchParams({
      where: "ID_PARQUE='" + escaparValorWhere(codigo) + "'",
      returnExtentOnly: 'true',
      returnGeometry: 'false',
      outSR: '4326',
      f: 'json'
    }).toString();
    try {
      const respuesta = await fetch(url.toString(), { method: 'GET' });
      if (!respuesta.ok) return null;
      const datos = await respuesta.json();
      const extension = datos.extent;
      if (!extension || ![extension.xmin, extension.xmax, extension.ymin, extension.ymax].every(Number.isFinite)) return null;
      const centro = [(extension.ymin + extension.ymax) / 2, (extension.xmin + extension.xmax) / 2];
      cacheCentrosParques.set(codigo, centro);
      return centro;
    } catch (_) {
      return null;
    }
  }
  function escaparHtml(valor) {
    return String(valor === null || typeof valor === 'undefined' ? '' : valor)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }
  function itemsDelParque(items, idParque) {
    const codigo = String(idParque || '').trim();
    return (items || []).filter(function (item) { return String(item.ID_Parque || '').trim() === codigo; });
  }
  function itemsRecientes(items) {
    return items.slice().sort(function (a, b) {
      return (String(b.Fecha || '') + ' ' + String(b.Hora || '')).localeCompare(String(a.Fecha || '') + ' ' + String(a.Hora || ''));
    }).slice(0, 5);
  }
  function resumenPopup(items, campo) {
    const grupos = agrupar(items, campo);
    if (!grupos.length) return '<span>Sin datos</span>';
    return '<ul>' + grupos.map(function (grupo) { return '<li>' + escaparHtml(grupo.valor) + ': <strong>' + formato.format(grupo.total) + '</strong></li>'; }).join('') + '</ul>';
  }
  function contenidoPopupMantenimiento(parque, items) {
    const recientes = itemsRecientes(items);
    const registros = recientes.length ? '<ol>' + recientes.map(function (item) {
      return '<li><strong>' + escaparHtml(item.Fecha || 'Sin fecha') + '</strong> · ' + escaparHtml(item.Elemento || 'Sin elemento') + ' · ' + escaparHtml(item.Tipo_Novedad || 'Sin tipo') + '</li>';
    }).join('') + '</ol>' : '<p>Sin registros disponibles en la muestra.</p>';
    return '<div class="map-popup"><strong>' + escaparHtml(parque.nombreParque || 'Parque sin nombre') + '</strong>' +
      '<p>Código: ' + escaparHtml(parque.idParque || 'Sin dato') + '<br>Acciones: <strong>' + formato.format(Number(parque.total) || 0) + '</strong></p>' +
      '<h4>Por categoría</h4>' + resumenPopup(items, 'Categoria') + '<h4>Por tipo de novedad</h4>' + resumenPopup(items, 'Tipo_Novedad') +
      '<h4>Registros recientes</h4>' + registros + '</div>';
  }
  async function actualizarMapaMantenimiento(parques, items) {
    const numeroSolicitud = ++solicitudMapaMantenimiento;
    const validos = (parques || []).filter(function (parque) { return String(parque.idParque || '').trim(); });
    const ubicados = [];
    for (let inicio = 0; inicio < validos.length; inicio += 6) {
      const lote = validos.slice(inicio, inicio + 6);
      const resultados = await Promise.all(lote.map(async function (parque) {
        return { parque: parque, centro: await consultarCentroParque(parque.idParque) };
      }));
      ubicados.push.apply(ubicados, resultados.filter(function (item) { return item.centro; }));
      if (numeroSolicitud !== solicitudMapaMantenimiento) return;
    }
    capaMantenimiento.clearLayers();
    ubicados.forEach(function (item) {
      const total = Number(item.parque.total) || 0;
      const radio = Math.max(6, Math.min(24, 5 + Math.sqrt(total) * 2.2));
      const registrosParque = itemsDelParque(items, item.parque.idParque);
      global.L.circleMarker(item.centro, { radius: radio, color: '#075543', weight: 2, fillColor: '#ee9c36', fillOpacity: 0.68 })
        .bindPopup(contenidoPopupMantenimiento(item.parque, registrosParque), { maxWidth: 390, maxHeight: 430 })
        .addTo(capaMantenimiento);
    });
    if (ubicados.length) mapas.reportes.fitBounds(global.L.latLngBounds(ubicados.map(function (item) { return item.centro; })), { padding: [28, 28], maxZoom: 14 });
  }
  function agruparParquesItems(items) {
    const grupos = new Map();
    items.forEach(function (item) {
      const idParque = String(item.ID_Parque || '').trim();
      if (!idParque) return;
      const clave = idParque + '\u0000' + String(item.Nombre_Parque || '').trim();
      if (!grupos.has(clave)) grupos.set(clave, { idParque: idParque, nombreParque: String(item.Nombre_Parque || '').trim(), total: 0 });
      grupos.get(clave).total += 1;
    });
    return Array.from(grupos.values());
  }
  function contenidoPopupActividad(parque, items) {
    const recientes = itemsRecientes(items);
    const registros = recientes.length ? '<ol>' + recientes.map(function (item) {
      return '<li><strong>' + escaparHtml(item.Fecha || 'Sin fecha') + '</strong> · ' + escaparHtml(item.Tipo_Actividad || 'Sin tipo') + ' · ' + escaparHtml(item.Programa || 'Sin programa') + ' · ' + formato.format(Number(item.Asistentes) || 0) + ' asistentes</li>';
    }).join('') + '</ol>' : '<p>Sin registros disponibles en la muestra.</p>';
    return '<div class="map-popup"><strong>' + escaparHtml(parque.nombreParque || 'Parque sin nombre') + '</strong>' +
      '<p>Código: ' + escaparHtml(parque.idParque || 'Sin dato') + '<br>Total participantes: <strong>' + formato.format(parque.totalAsistentes) + '</strong><br>Número de actividades: <strong>' + formato.format(parque.totalActividades) + '</strong></p>' +
      '<h4>Por programa</h4>' + resumenPopup(items, 'Programa') + '<h4>Por línea</h4>' + resumenPopup(items, 'Linea') +
      '<h4>Registros recientes</h4>' + registros + '</div>';
  }
  async function actualizarMapaActividades(parques, items) {
    const numeroSolicitud = ++solicitudMapaActividades;
    const unicos = new Map();
    (parques || []).forEach(function (parque) {
      const idParque = String(parque.idParque || '').trim();
      if (idParque && !unicos.has(idParque)) unicos.set(idParque, parque);
    });
    const grupos = Array.from(unicos.values());
    const ubicados = [];
    for (let inicio = 0; inicio < grupos.length; inicio += 6) {
      const lote = grupos.slice(inicio, inicio + 6);
      const resultados = await Promise.all(lote.map(async function (parque) {
        return { parque: parque, centro: await consultarCentroParque(parque.idParque) };
      }));
      ubicados.push.apply(ubicados, resultados.filter(function (item) { return item.centro; }));
      if (numeroSolicitud !== solicitudMapaActividades) return;
    }
    capaActividades.clearLayers();
    const maximoAsistentes = ubicados.reduce(function (maximo, item) {
      const total = Number(item.parque.totalAsistentes);
      return Number.isFinite(total) && total >= 0 ? Math.max(maximo, total) : maximo;
    }, 0);
    ubicados.forEach(function (item) {
      const totalAsistentes = Number(item.parque.totalAsistentes);
      const totalValido = Number.isFinite(totalAsistentes) && totalAsistentes >= 0 ? totalAsistentes : 0;
      const proporcion = maximoAsistentes > 0 ? totalValido / maximoAsistentes : 0;
      const radio = Math.sqrt((7 * 7) + (((26 * 26) - (7 * 7)) * proporcion));
      const registrosParque = itemsDelParque(items, item.parque.idParque);
      global.L.circleMarker(item.centro, { radius: radio, color: '#6a3f96', weight: 2, fillColor: '#7651a8', fillOpacity: 0.66 })
        .bindPopup(contenidoPopupActividad(item.parque, registrosParque), { maxWidth: 390, maxHeight: 430 })
        .addTo(capaActividades);
    });
    if (ubicados.length) mapas.actividades.fitBounds(global.L.latLngBounds(ubicados.map(function (item) { return item.centro; })), { padding: [28, 28], maxZoom: 14 });
  }
  function navegar(nombre) {
    document.querySelectorAll('.page-section').forEach(function (nodo) { nodo.hidden = nodo.id !== nombre; });
    document.querySelectorAll('.nav-tab').forEach(function (boton) { const activo = boton.dataset.section === nombre; boton.classList.toggle('active', activo); boton.setAttribute('aria-selected', String(activo)); });
    global.location.hash = nombre;
    global.setTimeout(function () { Object.values(mapas).forEach(function (m) { m.invalidateSize(); }); Object.values(graficos).forEach(function (g) { g.resize(); }); }, 0);
  }
  function kpi(id, valor) { document.getElementById(id).textContent = formato.format(Number(valor) || 0); }
  function parquesGrupos(grupos) { return (grupos || []).filter(function (x) { return String(x.idParque || '').trim(); }).length; }
  function parquesItems(items) { return new Set(items.map(function (x) { return String(x.ID_Parque || '').trim(); }).filter(Boolean)).size; }
  function parquesTotales() { const ids = new Set(); [reportes.porParque, actividades.porParque].forEach(function (grupos) { (grupos || []).forEach(function (x) { const id = String(x.idParque || '').trim(); if (id) ids.add(id); }); }); return ids.size; }
  function agrupar(items, campo) { const datos = new Map(); items.forEach(function (x) { const valor = String(x[campo] || '').trim() || 'Sin dato'; datos.set(valor, (datos.get(valor) || 0) + 1); }); return Array.from(datos, function (x) { return { valor: x[0], total: x[1] }; }).sort(function (a, b) { return b.total - a.total; }); }
  function sumar(items, campo) { return items.reduce(function (total, x) { const valor = Number(x[campo]); return Number.isFinite(valor) ? total + valor : total; }, 0); }
  function barras(grafico, datos, color) { const grupos = (datos || []).slice(0, 8).reverse(); grafico.setOption({ grid: { left: 8, right: 16, top: 8, bottom: 8, containLabel: true }, tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } }, xAxis: { type: 'value', minInterval: 1, splitLine: { lineStyle: { color: '#e8ede8' } } }, yAxis: { type: 'category', data: grupos.map(function (x) { return x.valor; }), axisTick: { show: false }, axisLine: { show: false }, axisLabel: { width: 145, overflow: 'truncate' } }, series: [{ type: 'bar', data: grupos.map(function (x) { return x.total; }), barMaxWidth: 18, itemStyle: { color: color, borderRadius: [0, 6, 6, 0] } }] }, true); }
  function parametros(formulario) { const salida = { limit: global.SIGT_CONFIG.DEFAULT_LIMIT }; new FormData(formulario).forEach(function (valor, clave) { if (String(valor).trim()) salida[clave] = String(valor).trim(); }); return salida; }
  function parametrosApi(parametrosFormulario) {
    const salida = {};
    Object.keys(parametrosFormulario).forEach(function (clave) {
      if (clave !== 'localidad' && clave !== 'upl') salida[clave] = parametrosFormulario[clave];
    });
    return salida;
  }
  function normalizarFiltro(valor) { return String(valor || '').trim().toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
  function aplicarFiltrosTerritoriales(items, parametrosFormulario) {
    const localidad = normalizarFiltro(parametrosFormulario.localidad);
    const upl = normalizarFiltro(parametrosFormulario.upl);
    return items.filter(function (item) {
      const coincideLocalidad = !localidad || normalizarFiltro(item.Localidad) === localidad || normalizarFiltro(item.Codigo_Localidad) === localidad;
      const coincideUpl = !upl || normalizarFiltro(item.Nombre_UPL) === upl || normalizarFiltro(item.Codigo_UPL) === upl;
      return coincideLocalidad && coincideUpl;
    });
  }
  function filtrado(p) { return Object.keys(p).some(function (clave) { return clave !== 'limit'; }); }
  function estado(texto, error) { const nodo = document.getElementById('status'); nodo.textContent = texto; nodo.classList.toggle('error', Boolean(error)); }
  function reportesGlobales() { kpi('reports-total', reportes.total); kpi('reports-parks', parquesGrupos(reportes.porParque)); barras(graficos.categoria, reportes.porCategoria, '#ee9c36'); barras(graficos.novedad, reportes.porTipoNovedad, '#3186a5'); actualizarMapaMantenimiento(reportes.porParque, reportesMapa); document.getElementById('report-scope').textContent = 'Totales generales; detalle de mapa basado en hasta 100 registros públicos.'; }
  function actividadesGlobales() { kpi('activities-total', actividades.totalActividades); kpi('activities-attendees', actividades.totalAsistentes); kpi('activities-parks', parquesGrupos(actividades.porParque)); barras(graficos.programa, actividades.porPrograma, '#7651a8'); barras(graficos.tipo, actividades.porTipoActividad, '#d52b36'); barras(graficos.linea, actividades.porLinea, '#d6a900'); actualizarMapaActividades(actividadesPorParque, actividadesMapa); document.getElementById('activity-scope').textContent = 'Totales generales; mapa agregado sobre todas las actividades públicas.'; }
  async function filtrarReportes(formulario) { const p = parametros(formulario); if (!filtrado(p)) { reportesGlobales(); return; } try { estado('Consultando acciones de mantenimiento…'); const respuesta = await global.SIGT_API.listarReportes(parametrosApi(p)); const territorializados = await territorializarItems(respuesta.items || []); const items = aplicarFiltrosTerritoriales(territorializados, p); kpi('reports-total', items.length); kpi('reports-parks', parquesItems(items)); barras(graficos.categoria, agrupar(items, 'Categoria'), '#ee9c36'); barras(graficos.novedad, agrupar(items, 'Tipo_Novedad'), '#3186a5'); actualizarMapaMantenimiento(agruparParquesItems(items), items); document.getElementById('report-scope').textContent = 'Vista territorializada: ' + items.length + ' registros visibles de una muestra de hasta 100.'; estado('Acciones de mantenimiento actualizadas.'); } catch (e) { estado(e.message || 'No fue posible consultar las acciones de mantenimiento.', true); } }
  async function filtrarActividades(formulario) { const p = parametros(formulario); if (!filtrado(p)) { actividadesGlobales(); return; } try { estado('Consultando actividades…'); const filtrosApi = parametrosApi(p); const respuestas = await Promise.all([global.SIGT_API.listarActividades(filtrosApi), global.SIGT_API.obtenerActividadesPorParque(filtrosApi)]); const respuesta = respuestas[0]; const territorializados = await territorializarItems(respuesta.items || []); const items = aplicarFiltrosTerritoriales(territorializados, p); const parquesTerritorializados = await Promise.all((respuestas[1].items || []).map(async function (parque) { return Object.assign({}, parque, await consultarTerritorioParque(parque.idParque)); })); const parquesMapa = aplicarFiltrosTerritoriales(parquesTerritorializados, p); kpi('activities-total', items.length); kpi('activities-attendees', sumar(items, 'Asistentes')); kpi('activities-parks', parquesItems(items)); barras(graficos.programa, agrupar(items, 'Programa'), '#7651a8'); barras(graficos.tipo, agrupar(items, 'Tipo_Actividad'), '#d52b36'); barras(graficos.linea, agrupar(items, 'Linea'), '#d6a900'); actualizarMapaActividades(parquesMapa, items); document.getElementById('activity-scope').textContent = 'Vista territorializada: ' + items.length + ' registros visibles de una muestra de hasta 100; mapa agregado completo.'; estado('Actividades actualizadas.'); } catch (e) { estado(e.message || 'No fue posible consultar actividades.', true); } }
  function conectarFormulario(id, accion, restaurar) { const form = document.getElementById(id); form.addEventListener('submit', function (e) { e.preventDefault(); accion(form); }); form.addEventListener('reset', function () { global.setTimeout(restaurar, 0); }); }
  async function cargar() { try { estado('Consultando información pública…'); const datos = await Promise.all([global.SIGT_API.obtenerResumenReportes(), global.SIGT_API.obtenerResumenActividades(), global.SIGT_API.listarReportes({ limit: global.SIGT_CONFIG.DEFAULT_LIMIT }), global.SIGT_API.listarActividades({ limit: global.SIGT_CONFIG.DEFAULT_LIMIT }), global.SIGT_API.obtenerActividadesPorParque()]); reportes = datos[0]; actividades = datos[1]; reportesMapa = datos[2].items || []; actividadesMapa = datos[3].items || []; actividadesPorParque = datos[4].items || []; cargarOpcionesCategoricas(); await cargarOpcionesTerritoriales(); kpi('summary-reportes', reportes.total); kpi('summary-actividades', actividades.totalActividades); kpi('summary-asistentes', actividades.totalAsistentes); kpi('summary-parques', parquesTotales()); reportesGlobales(); actividadesGlobales(); estado('Información actualizada.'); } catch (e) { estado(e.message || 'No fue posible cargar el portal.', true); } }
  document.addEventListener('DOMContentLoaded', function () {
    iniciarVisuales(); document.querySelectorAll('.nav-tab').forEach(function (b) { b.addEventListener('click', function () { navegar(b.dataset.section); }); });
    const inicial = global.location.hash.slice(1); if (['resumen', 'novedades', 'actividades'].includes(inicial)) navegar(inicial);
    conectarFormulario('report-filters', filtrarReportes, reportesGlobales); conectarFormulario('activity-filters', filtrarActividades, actividadesGlobales);
    global.addEventListener('resize', function () { Object.values(mapas).forEach(function (m) { m.invalidateSize(); }); Object.values(graficos).forEach(function (g) { g.resize(); }); }); cargar();
  });
}(window));
