(function (global) {
  'use strict';

  const ACTIONS = Object.freeze({
    reportesSummary: 'v1.reportes.summary',
    reportesList: 'v1.reportes.list',
    reportesPorParque: 'v1.reportes.porParque',
    actividadesSummary: 'v1.actividades.summary',
    actividadesList: 'v1.actividades.list',
    actividadesPorParque: 'v1.actividades.porParque'
  });

  function validarConfiguracion() {
    const url = global.SIGT_CONFIG.API_BASE_URL;
    if (!url || url.indexOf('REEMPLAZAR_') === 0) {
      throw new Error('Configure la URL del deployment público en js/config.js.');
    }
    return url;
  }

  function construirUrl(action, parametros) {
    const url = new URL(validarConfiguracion());
    url.searchParams.set('action', action);
    Object.entries(parametros || {}).forEach(function ([clave, valor]) {
      if (valor !== '' && valor !== null && typeof valor !== 'undefined') {
        url.searchParams.set(clave, String(valor));
      }
    });
    return url;
  }

  async function consultar(action, parametros) {
    const respuesta = await fetch(construirUrl(action, parametros), {
      method: 'GET',
      redirect: 'follow',
      headers: { Accept: 'application/json' }
    });
    if (!respuesta.ok) {
      throw new Error('La API pública respondió con HTTP ' + respuesta.status + '.');
    }
    const json = await respuesta.json();
    if (!json || json.ok !== true) {
      throw new Error('La API pública no pudo completar la consulta.');
    }
    return json.data;
  }

  global.SIGT_API = Object.freeze({
    obtenerResumenReportes: function (filtros) { return consultar(ACTIONS.reportesSummary, filtros); },
    listarReportes: function (filtros) { return consultar(ACTIONS.reportesList, filtros); },
    obtenerReportesPorParque: function (filtros) { return consultar(ACTIONS.reportesPorParque, filtros); },
    obtenerResumenActividades: function (filtros) { return consultar(ACTIONS.actividadesSummary, filtros); },
    listarActividades: function (filtros) { return consultar(ACTIONS.actividadesList, filtros); },
    obtenerActividadesPorParque: function (filtros) { return consultar(ACTIONS.actividadesPorParque, filtros); }
  });
}(window));
