// GYVRA Procuración — backend (Google Apps Script)
// Copiar este archivo completo al editor de Apps Script (archivo Code.gs).
//
// Funciones para correr UNA sola vez desde el editor:
//   - migrar(): agrega columnas/encabezados nuevos, IDs y mueve calificaciones a su hoja.

var MAX_CUPOS = 5;

// Hoja Rotaciones — índices de columna (0 = A). A–G ya existían; H–Q son nuevas.
var C = {
  NOMBRE: 0, ESP: 1, INICIO: 2, FIN: 3, MES: 4, CEL: 5, TS: 6,
  DNI: 7, PROV: 8, HOSP: 9, ID: 10, ESTADO: 11, INI_CONF: 12, FIN_CONF: 13,
  F_SOLICITUD: 14, F_APROBACION: 15, FILE_ID: 16
};
var NCOLS = 17;
var ENCABEZADOS = ['Nombre', 'Especialidad', 'Inicio', 'Fin', 'Mes', 'Celular', 'Timestamp',
  'DNI', 'Provincia', 'Hospital de origen', 'ID', 'Estado constancia', 'Inicio confirmado',
  'Fin confirmado', 'Fecha solicitud', 'Fecha aprobación', 'PDF fileId'];

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
function doGet(e) {
  var p = (e && e.parameter) || {};
  var action = p.action;
  var d = p.data ? JSON.parse(p.data) : {};
  try {
    if (action === 'getRotaciones') return getRotaciones();
    if (action === 'getMisRotaciones') return getMisRotaciones(d);
    if (action === 'addRotacion') return addRotacion(d);
    if (action === 'cancelarRotacion') {
      // Compatibilidad con la versión vieja de la app: [nombre, inicio]
      if (Array.isArray(d)) d = { nombre: d[0], inicio: d[1] };
      return cancelarRotacion(d);
    }
    if (action === 'actualizarDatos') return actualizarDatos(d);
    if (action === 'addRating') return addRating(d);
    if (action === 'getActividades') return getActividades();
    if (action === 'saveActividades') {
      if (Array.isArray(d)) d = { nombre: d[0], ids: d[1], nombres: d[2], pct: d[3] };
      return saveActividades(d);
    }
  } catch (err) {
    return buildResponse({ status: 'error', message: String(err && err.message || err) });
  }
  return HtmlService.createHtmlOutputFromFile('Index.html')
    .setTitle('GYVRA Procuracion')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
function formatearFecha(cell) {
  if (cell instanceof Date) {
    var y = cell.getFullYear();
    var m = cell.getMonth()+1 < 10 ? '0'+(cell.getMonth()+1) : ''+(cell.getMonth()+1);
    var d = cell.getDate() < 10 ? '0'+cell.getDate() : ''+cell.getDate();
    return y+'-'+m+'-'+d;
  }
  return String(cell).trim();
}

function esFechaKey(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s)); }
function norm(s) { return String(s == null ? '' : s).trim().toLowerCase(); }
function soloDigitos(s) { return String(s == null ? '' : s).replace(/\D/g, ''); }
function dniValido(s) { return /^\d{7,8}$/.test(soloDigitos(s)); }
function hoyKey() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }
function ahora() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm'); }
function nuevoId() { return Utilities.getUuid().replace(/-/g, '').slice(0, 12); }

function hoja(nombre) { return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nombre); }

function asegurarColumnas(sheet, n) {
  if (sheet.getMaxColumns() < n) sheet.insertColumnsAfter(sheet.getMaxColumns(), n - sheet.getMaxColumns());
}

// Lee todas las filas de Rotaciones (A–Q) con fechas ya formateadas.
function leerRotaciones() {
  var sheet = hoja('Rotaciones');
  asegurarColumnas(sheet, NCOLS);
  var lastRow = sheet.getLastRow();
  if (lastRow === 0) return { sheet: sheet, rows: [] };
  var rows = sheet.getRange(1, 1, lastRow, NCOLS).getValues().map(function (r) {
    return r.map(function (cell) { return formatearFecha(cell); });
  });
  return { sheet: sheet, rows: rows };
}

// Una fila es una rotación si tiene nombre y la fecha de inicio es una fecha (descarta encabezado y RATING).
function esRotacion(r) {
  return r[C.NOMBRE] !== '' && r[C.NOMBRE] !== 'RATING' && esFechaKey(r[C.INICIO]);
}

// ¿Esta fila pertenece a esta persona? Por DNI; si la fila es vieja y no tiene DNI, por nombre.
function esDeLaPersona(r, dni, nombre) {
  var filaDni = soloDigitos(r[C.DNI]);
  if (filaDni) return !!dni && filaDni === soloDigitos(dni);
  return !!nombre && norm(r[C.NOMBRE]) === norm(nombre);
}

function conLock(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return buildResponse({ status: 'busy' });
  try { return fn(); } finally { lock.releaseLock(); }
}

// Ventana habilitada (misma regla que fechas.js)
function ventanaHabilitada(inicio, fin) {
  if (inicio < '2027-01-01') return inicio >= '2026-01-01' && inicio <= '2026-12-14';
  return inicio >= '2027-03-01' && (fin || inicio) <= '2027-12-11';
}

// ---------------------------------------------------------------------------
// Rotaciones
// ---------------------------------------------------------------------------

// Público (calendario): nunca devuelve DNI, celular ni el archivo de la constancia.
function getRotaciones() {
  var rows = leerRotaciones().rows.filter(esRotacion).map(function (r) {
    var x = r.slice();
    x[C.CEL] = '';
    x[C.DNI] = '';
    x[C.FILE_ID] = '';
    return x;
  });
  return buildResponse(rows);
}

// "Mi perfil": filas completas de la persona.
function getMisRotaciones(d) {
  var rows = leerRotaciones().rows.filter(function (r) {
    return esRotacion(r) && esDeLaPersona(r, d.dni, d.nombre);
  });
  return buildResponse({ status: 'ok', rows: rows });
}

function addRotacion(d) {
  // Compatibilidad con la versión vieja de la app (array de 7 columnas / calificaciones)
  if (Array.isArray(d)) {
    if (d[0] === 'RATING') return addRating({ nombre: d[1], estrellas: parseInt(d[2], 10) || '', comentario: d[3] });
    d = { nombre: d[0], esp: d[1], inicio: d[2], fin: d[3], mes: d[4], cel: d[5] };
  }
  var nombre = String(d.nombre || '').trim();
  var inicio = String(d.inicio || '').trim();
  var fin = String(d.fin || '').trim();
  var dni = soloDigitos(d.dni);
  if (!nombre || !esFechaKey(inicio) || !esFechaKey(fin)) return buildResponse({ status: 'error', message: 'Datos incompletos' });
  if (dni && !dniValido(dni)) return buildResponse({ status: 'error', message: 'DNI inválido' });
  if (!ventanaHabilitada(inicio, fin)) return buildResponse({ status: 'cerrada' });

  return conLock(function () {
    var info = leerRotaciones();
    var rows = info.rows.filter(esRotacion);
    var hoy = hoyKey();
    var ocupados = 0;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (r[C.INICIO] === inicio) ocupados++;
      // Una sola rotación activa (futura o en curso) por persona
      if (esDeLaPersona(r, dni, nombre) && r[C.FIN] >= hoy) {
        return buildResponse({ status: 'ya_tiene', inicio: r[C.INICIO], fin: r[C.FIN], mes: r[C.MES] });
      }
    }
    if (ocupados >= MAX_CUPOS) return buildResponse({ status: 'full' });

    var id = nuevoId();
    var fila = [nombre, d.esp || '', inicio, fin, d.mes || '', d.cel || '', new Date().toISOString(),
      dni, d.provincia || '', d.hospital || '', id, '', '', '', '', '', ''];
    info.sheet.appendRow(fila);
    return buildResponse({ status: 'ok', id: id });
  });
}

// Cancela por DNI + fecha de inicio. Filas viejas sin DNI: por nombre + fecha de inicio.
function cancelarRotacion(d) {
  var inicio = String(d.inicio || '').trim();
  return conLock(function () {
    var info = leerRotaciones();
    for (var i = info.rows.length - 1; i >= 0; i--) {
      var r = info.rows[i];
      if (!esRotacion(r) || r[C.INICIO] !== inicio) continue;
      if (!esDeLaPersona(r, d.dni, d.nombre)) continue;
      if (r[C.ESTADO]) return buildResponse({ status: 'no_permitido' }); // ya pidió la constancia
      info.sheet.deleteRow(i + 1);
      return buildResponse({ status: 'ok' });
    }
    return buildResponse({ status: 'not_found' });
  });
}

// Completa DNI, provincia y hospital (y el ID si falta) en todas las filas con ese nombre.
// Solo completa celdas vacías: nunca pisa datos que ya estaban.
function actualizarDatos(d) {
  var dni = soloDigitos(d.dni);
  if (!d.nombre || !dniValido(dni)) return buildResponse({ status: 'error', message: 'Datos inválidos' });
  return conLock(function () {
    var info = leerRotaciones();
    var n = 0;
    for (var i = 0; i < info.rows.length; i++) {
      var r = info.rows[i];
      if (!esRotacion(r) || norm(r[C.NOMBRE]) !== norm(d.nombre)) continue;
      var filaDni = soloDigitos(r[C.DNI]);
      if (filaDni && filaDni !== dni) continue; // es otra persona con el mismo nombre
      var nuevos = [
        filaDni || dni,
        r[C.PROV] || d.provincia || '',
        r[C.HOSP] || d.hospital || '',
        r[C.ID] || nuevoId()
      ];
      info.sheet.getRange(i + 1, C.DNI + 1, 1, 4).setValues([nuevos]);
      n++;
    }
    return buildResponse({ status: 'ok', actualizadas: n });
  });
}

// ---------------------------------------------------------------------------
// Calificaciones
// ---------------------------------------------------------------------------
function hojaCalificaciones() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('Calificaciones');
  if (!sh) {
    sh = ss.insertSheet('Calificaciones');
    sh.appendRow(['Tipo', 'Nombre', 'Calificación', 'Comentario', 'Fecha', 'DNI']);
  }
  return sh;
}

function addRating(d) {
  var estrellas = parseInt(d.estrellas, 10);
  return conLock(function () {
    hojaCalificaciones().appendRow(['RATING', d.nombre || '', (estrellas ? estrellas + ' estrellas' : ''),
      d.comentario || '', new Date().toISOString(), soloDigitos(d.dni)]);
    return buildResponse({ status: 'ok' });
  });
}

// ---------------------------------------------------------------------------
// Actividades
// ---------------------------------------------------------------------------
function getActividades() {
  var sheet = hoja('Actividades');
  var lastRow = sheet.getLastRow();
  if (lastRow === 0) return buildResponse([]);
  return buildResponse(sheet.getRange(1, 1, lastRow, 5).getValues().filter(function(r){ return r[0] !== ''; }));
}

function saveActividades(d) {
  var nombre = String(d.nombre || '');
  return conLock(function () {
    var sheet = hoja('Actividades');
    var lastRow = sheet.getLastRow();
    var found = -1;
    if (lastRow > 0) {
      var data = sheet.getRange(1, 1, lastRow, 1).getValues();
      for (var i = 0; i < data.length; i++) {
        if (norm(data[i][0]) === norm(nombre)) { found = i + 1; break; }
      }
    }
    var row = [nombre, d.ids, d.nombres, d.pct + '%', ahora()];
    if (found > 0) sheet.getRange(found, 1, 1, 5).setValues([row]);
    else sheet.appendRow(row);
    return buildResponse({ status: 'ok' });
  });
}

// ---------------------------------------------------------------------------
// migrar() — correr UNA vez desde el editor (es seguro volver a correrla)
// ---------------------------------------------------------------------------
function migrar() {
  var sheet = hoja('Rotaciones');
  asegurarColumnas(sheet, NCOLS);

  // 1) Encabezados
  var lastRow = sheet.getLastRow();
  if (lastRow === 0) {
    sheet.getRange(1, 1, 1, NCOLS).setValues([ENCABEZADOS]);
  } else {
    var primera = sheet.getRange(1, 1, 1, NCOLS).getValues()[0];
    var esEncabezado = primera[0] !== 'RATING' && !esFechaKey(formatearFecha(primera[C.INICIO]));
    if (!esEncabezado) {
      sheet.insertRowBefore(1);
      sheet.getRange(1, 1, 1, NCOLS).setValues([ENCABEZADOS]);
    } else {
      // Ya hay encabezado: solo completar los que faltan (H–Q), sin tocar A–G
      for (var c = 7; c < NCOLS; c++) {
        if (primera[c] === '') sheet.getRange(1, c + 1).setValue(ENCABEZADOS[c]);
      }
    }
  }

  // 2) Mover calificaciones (RATING en columna A) a la hoja Calificaciones
  lastRow = sheet.getLastRow();
  var datos = sheet.getRange(1, 1, lastRow, NCOLS).getValues();
  var ratings = [];
  for (var i = datos.length - 1; i >= 1; i--) {
    if (datos[i][0] === 'RATING') {
      ratings.unshift(datos[i].slice(0, 5).concat(['']));
      sheet.deleteRow(i + 1);
    }
  }
  if (ratings.length) {
    var cal = hojaCalificaciones();
    cal.getRange(cal.getLastRow() + 1, 1, ratings.length, 6).setValues(ratings);
  }

  // 3) Generar ID en K para cada rotación sin ID
  lastRow = sheet.getLastRow();
  var ids = 0;
  if (lastRow > 1) {
    var filas = sheet.getRange(2, 1, lastRow - 1, NCOLS).getValues();
    var colK = filas.map(function (r) {
      if (r[C.NOMBRE] !== '' && !r[C.ID]) { ids++; return [nuevoId()]; }
      return [r[C.ID]];
    });
    sheet.getRange(2, C.ID + 1, colK.length, 1).setValues(colK);
  }

  Logger.log('Migración lista. Calificaciones movidas: ' + ratings.length + '. IDs generados: ' + ids + '.');
}

function buildResponse(data) {
  var output = ContentService.createTextOutput(JSON.stringify(data));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}
