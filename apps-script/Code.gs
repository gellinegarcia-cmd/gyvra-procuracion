// GYVRA Procuración — backend (Google Apps Script)
// Copiar este archivo completo al editor de Apps Script (archivo Code.gs).
//
// Funciones para correr UNA sola vez desde el editor:
//   - configurar(): crea la carpeta "GYVRA Constancias", la plantilla y el token de aprobación.
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
    if (action === 'getMisActividades') return getMisActividades(d);
    if (action === 'solicitarConstancia') return solicitarConstancia(d);
    if (action === 'getConstancia') return getConstancia(d);
    if (action === 'aprobar') return aprobar(p.id, p.token);
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

// Hoja Actividades: A nombre · B ids · C nombres · D % · E fecha (sin cambios)
//                   F DNI · G multiorgánicos · H asistolias · I córneas (nuevas)
var NCOLS_ACT = 9;

function leerActividades() {
  var sheet = hoja('Actividades');
  asegurarColumnas(sheet, NCOLS_ACT);
  var lastRow = sheet.getLastRow();
  var data = lastRow > 0 ? sheet.getRange(1, 1, lastRow, NCOLS_ACT).getValues() : [];
  return { sheet: sheet, data: data };
}

// Busca la fila por DNI (columna F). Si no está, una fila vieja sin DNI con ese nombre.
function filaActividades(data, dni, nombre) {
  dni = soloDigitos(dni);
  var i;
  if (dni) for (i = 0; i < data.length; i++) if (soloDigitos(data[i][5]) === dni) return i;
  for (i = 0; i < data.length; i++) {
    if (!soloDigitos(data[i][5]) && data[i][0] !== '' && norm(data[i][0]) === norm(nombre)) return i;
  }
  return -1;
}

function getMisActividades(d) {
  var info = leerActividades();
  var i = filaActividades(info.data, d.dni, d.nombre);
  if (i < 0) return buildResponse({ status: 'ok', ids: '', multi: 0, asistolias: 0, corneas: 0 });
  var r = info.data[i];
  return buildResponse({ status: 'ok', ids: String(r[1]), multi: Number(r[6]) || 0, asistolias: Number(r[7]) || 0, corneas: Number(r[8]) || 0 });
}

function saveActividades(d) {
  var nombre = String(d.nombre || '');
  var dni = soloDigitos(d.dni);
  return conLock(function () {
    var info = leerActividades();
    var i = filaActividades(info.data, dni, nombre);
    var prev = i >= 0 ? info.data[i] : [];
    function contador(v, anterior) { return v === undefined || v === null ? (Number(anterior) || 0) : Math.max(0, parseInt(v, 10) || 0); }
    var row = [nombre, d.ids || '', d.nombres || '', (d.pct || 0) + '%', ahora(),
      dni || prev[5] || '',
      contador(d.multi, prev[6]), contador(d.asistolias, prev[7]), contador(d.corneas, prev[8])];
    if (i >= 0) info.sheet.getRange(i + 1, 1, 1, NCOLS_ACT).setValues([row]);
    else info.sheet.appendRow(row);
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

// ---------------------------------------------------------------------------
// Constancias
// ---------------------------------------------------------------------------
var ADMIN_EMAIL = 'gellinegarcia@gmail.com';
// El link del mail usa ScriptApp.getService().getUrl(): siempre la implementación actual.
var MESES_LARGO = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function props() { return PropertiesService.getScriptProperties(); }

// "2027-08-16" -> "16 de agosto de 2027"
function fechaLarga(key) {
  var p = String(key).split('-');
  return parseInt(p[2], 10) + ' de ' + MESES_LARGO[parseInt(p[1], 10) - 1] + ' de ' + p[0];
}
function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function buscarPorId(rows, id) {
  for (var i = 0; i < rows.length; i++) if (esRotacion(rows[i]) && String(rows[i][C.ID]) === String(id) && id) return i;
  return -1;
}
// "María José Pérez" -> "Pérez_María_José" (Apellido = última palabra)
function nombreArchivo(nombre) {
  var partes = String(nombre).trim().split(/\s+/);
  var apellido = partes.length > 1 ? partes.pop() : partes[0];
  var limpio = function (s) { return s.replace(/[^\wÁÉÍÓÚÜÑáéíóúüñ-]+/g, '_'); };
  return 'Constancia_Rotacion_' + limpio(apellido) + '_' + limpio(partes.join('_'));
}

// El rotante confirma fechas y pide la constancia: guarda M, N, O, pone L = solicitada y avisa por mail.
function solicitarConstancia(d) {
  var inicio = String(d.inicio || '').trim(), fin = String(d.fin || '').trim();
  if (!esFechaKey(inicio) || !esFechaKey(fin) || inicio > fin) return buildResponse({ status: 'error', message: 'Fechas inválidas' });
  if (!dniValido(d.dni)) return buildResponse({ status: 'error', message: 'DNI inválido' });
  var token = props().getProperty('ADMIN_TOKEN');
  if (!token) return buildResponse({ status: 'error', message: 'Falta correr configurar()' });

  var fila;
  var res = conLock(function () {
    var info = leerRotaciones();
    var i = buscarPorId(info.rows, d.id);
    if (i < 0) return buildResponse({ status: 'not_found' });
    var r = info.rows[i];
    var filaDni = soloDigitos(r[C.DNI]);
    if (filaDni && filaDni !== soloDigitos(d.dni)) return buildResponse({ status: 'not_found' });
    if (!filaDni && norm(r[C.NOMBRE]) !== norm(d.nombre)) return buildResponse({ status: 'not_found' });
    if (r[C.FIN] >= hoyKey()) return buildResponse({ status: 'no_terminada' });
    if (r[C.ESTADO] === 'aprobada') return buildResponse({ status: 'ya_aprobada' });
    // Completa DNI/provincia/hospital si la fila no los tenía
    var dni = filaDni || soloDigitos(d.dni);
    var prov = r[C.PROV] || d.provincia || '';
    var hosp = r[C.HOSP] || d.hospital || '';
    info.sheet.getRange(i + 1, C.DNI + 1, 1, 3).setValues([[dni, prov, hosp]]);
    info.sheet.getRange(i + 1, C.ESTADO + 1, 1, 4).setValues([['solicitada', inicio, fin, ahora()]]);
    fila = { nombre: r[C.NOMBRE], dni: dni, prov: prov, hosp: hosp, cel: r[C.CEL], id: r[C.ID] };
    return null;
  });
  if (res) return res;

  var link = ScriptApp.getService().getUrl() + '?action=aprobar&id=' + encodeURIComponent(fila.id) + '&token=' + encodeURIComponent(token);
  var html =
    '<div style="font-family:Arial,sans-serif;font-size:15px;color:#1a1a1a;max-width:520px">' +
    '<h2 style="color:#0a2a5e">Solicitud de constancia de rotación</h2>' +
    '<table style="border-collapse:collapse;font-size:15px">' +
    filaMail('Nombre', fila.nombre) + filaMail('DNI', fila.dni) + filaMail('Hospital de origen', fila.hosp) +
    filaMail('Provincia', fila.prov) + filaMail('Celular', fila.cel) +
    filaMail('Desde', fechaLarga(inicio)) + filaMail('Hasta', fechaLarga(fin)) +
    '</table>' +
    '<p style="margin:28px 0"><a href="' + link + '" style="background:#16a34a;color:#fff;text-decoration:none;padding:16px 28px;border-radius:10px;font-weight:bold;font-size:17px;display:inline-block">CONFIRMAR ROTACIÓN</a></p>' +
    '<p style="font-size:12px;color:#888">Al confirmar se genera el PDF y el rotante lo puede descargar desde la app.</p></div>';
  MailApp.sendEmail({ to: ADMIN_EMAIL, subject: 'Constancia de rotación — ' + fila.nombre, htmlBody: html });
  return buildResponse({ status: 'ok' });
}
function filaMail(k, v) {
  return '<tr><td style="padding:4px 14px 4px 0;color:#666">' + escHtml(k) + '</td><td style="padding:4px 0"><strong>' + escHtml(v) + '</strong></td></tr>';
}

// Link del mail: valida el token, genera el PDF y marca la constancia como aprobada.
function aprobar(id, token) {
  function pagina(msg) {
    return HtmlService.createHtmlOutput('<div style="font-family:Arial,sans-serif;font-size:20px;padding:40px;text-align:center">' + msg + '</div>')
      .setTitle('GYVRA — Constancias');
  }
  var adminToken = props().getProperty('ADMIN_TOKEN');
  if (!adminToken || String(token) !== adminToken) return pagina('❌ Link inválido.');

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return pagina('Hay otra operación en curso. Volvé a tocar el botón en unos segundos.');
  try {
    var info = leerRotaciones();
    var i = buscarPorId(info.rows, id);
    if (i < 0) return pagina('❌ No se encontró la rotación (¿fue cancelada?).');
    var r = info.rows[i];
    if (r[C.ESTADO] === 'aprobada' && r[C.FILE_ID]) {
      return pagina('ℹ️ La constancia de <strong>' + escHtml(r[C.NOMBRE]) + '</strong> ya estaba aprobada. No se generó de nuevo.');
    }
    var fileId = generarPdf(r);
    info.sheet.getRange(i + 1, C.ESTADO + 1).setValue('aprobada');
    info.sheet.getRange(i + 1, C.F_APROBACION + 1, 1, 2).setValues([[ahora(), fileId]]);
    return pagina('✅ Constancia de <strong>' + escHtml(r[C.NOMBRE]) + '</strong> aprobada.<br><br><span style="font-size:15px;color:#666">Ya la puede descargar desde la app.</span>');
  } catch (err) {
    return pagina('❌ Error al generar la constancia: ' + escHtml(err && err.message || err));
  } finally {
    lock.releaseLock();
  }
}

// Copia la plantilla, reemplaza los marcadores, exporta a PDF, lo guarda en la carpeta y borra la copia.
function generarPdf(r) {
  var tplId = props().getProperty('TEMPLATE_ID');
  var folderId = props().getProperty('FOLDER_ID');
  if (!tplId || !folderId) throw new Error('Falta correr configurar()');
  var folder = DriveApp.getFolderById(folderId);
  var nombre = nombreArchivo(r[C.NOMBRE]);
  var copia = DriveApp.getFileById(tplId).makeCopy(nombre, folder);
  try {
    var doc = DocumentApp.openById(copia.getId());
    var body = doc.getBody();
    var hoy = hoyKey();
    var valores = {
      NOMBRE: r[C.NOMBRE],
      DNI: soloDigitos(r[C.DNI]),
      HOSPITAL: r[C.HOSP],
      PROVINCIA: r[C.PROV],
      INICIO: fechaLarga(r[C.INI_CONF] || r[C.INICIO]),
      FIN: fechaLarga(r[C.FIN_CONF] || r[C.FIN]),
      FECHA: fechaLarga(hoy)
    };
    Object.keys(valores).forEach(function (k) {
      var v = String(valores[k] == null ? '' : valores[k]).replace(/[$\\]/g, '');
      body.replaceText('\\{\\{' + k + '\\}\\}', v);
    });
    doc.saveAndClose();
    var pdf = copia.getAs(MimeType.PDF).setName(nombre + '.pdf');
    return folder.createFile(pdf).getId();
  } finally {
    copia.setTrashed(true);
  }
}

// El rotante descarga su constancia: valida DNI y devuelve el PDF en base64 (sin links públicos de Drive).
function getConstancia(d) {
  var info = leerRotaciones();
  var i = buscarPorId(info.rows, d.id);
  if (i < 0) return buildResponse({ status: 'not_found' });
  var r = info.rows[i];
  if (!soloDigitos(r[C.DNI]) || soloDigitos(r[C.DNI]) !== soloDigitos(d.dni)) return buildResponse({ status: 'not_found' });
  if (r[C.ESTADO] !== 'aprobada' || !r[C.FILE_ID]) return buildResponse({ status: 'no_aprobada' });
  var blob = DriveApp.getFileById(r[C.FILE_ID]).getBlob();
  return buildResponse({ status: 'ok', filename: nombreArchivo(r[C.NOMBRE]) + '.pdf', base64: Utilities.base64Encode(blob.getBytes()) });
}

// ---------------------------------------------------------------------------
// configurar() — correr UNA vez desde el editor. Crea la carpeta, la plantilla y el token.
// ---------------------------------------------------------------------------
function configurar() {
  var p = props();
  if (!p.getProperty('ADMIN_TOKEN')) p.setProperty('ADMIN_TOKEN', Utilities.getUuid().replace(/-/g, ''));

  var folder = null;
  try { if (p.getProperty('FOLDER_ID')) folder = DriveApp.getFolderById(p.getProperty('FOLDER_ID')); } catch (e) { folder = null; }
  if (!folder) {
    folder = DriveApp.createFolder('GYVRA Constancias');
    p.setProperty('FOLDER_ID', folder.getId());
  }

  var tpl = null;
  try { if (p.getProperty('TEMPLATE_ID')) tpl = DocumentApp.openById(p.getProperty('TEMPLATE_ID')); } catch (e) { tpl = null; }
  if (!tpl) {
    tpl = DocumentApp.create('Plantilla Constancia GYVRA');
    armarPlantilla(tpl);
    tpl.saveAndClose();
    DriveApp.getFileById(tpl.getId()).moveTo(folder);
    p.setProperty('TEMPLATE_ID', tpl.getId());
  }

  Logger.log('Listo.');
  Logger.log('Carpeta: ' + folder.getUrl());
  Logger.log('Plantilla (abrila y pegá tu firma): https://docs.google.com/document/d/' + p.getProperty('TEMPLATE_ID') + '/edit');
}

function armarPlantilla(doc) {
  var body = doc.getBody();
  body.setMarginTop(72).setMarginBottom(72).setMarginLeft(72).setMarginRight(72);
  var J = DocumentApp.HorizontalAlignment;

  function parrafo(texto, alin, negrita, tam) {
    var par = body.appendParagraph(texto);
    par.setAlignment(alin || J.JUSTIFY).setLineSpacing(1.5).setSpacingAfter(6);
    var t = par.editAsText();
    t.setFontFamily('Arial').setFontSize(tam || 12).setBold(!!negrita);
    return par;
  }
  function negritas(par, marcadores) {
    var t = par.editAsText(), s = t.getText();
    marcadores.forEach(function (m) {
      var i = s.indexOf(m);
      if (i >= 0) t.setBold(i, i + m.length - 1, true);
    });
  }

  var titulo = body.getParagraphs()[0];
  titulo.setText('CONSTANCIA DE ROTACIÓN');
  titulo.setAlignment(J.CENTER).setSpacingAfter(24);
  titulo.editAsText().setFontFamily('Arial').setFontSize(16).setBold(true);

  parrafo('');
  var p1 = parrafo('Por medio de la presente se deja constancia que {{NOMBRE}}, DNI {{DNI}}, proveniente del {{HOSPITAL}}, provincia de {{PROVINCIA}}, realizó la rotación del Fellowship de Procuración y Trasplante en la Unidad de Terapia Intensiva del Hospital de Alta Complejidad del Bicentenario Esteban Echeverría, desde el {{INICIO}} hasta el {{FIN}}.');
  negritas(p1, ['{{NOMBRE}}', '{{DNI}}', '{{HOSPITAL}}', '{{PROVINCIA}}', '{{INICIO}}', '{{FIN}}']);
  parrafo('Se extiende la presente a pedido del interesado para ser presentada ante quien corresponda.');
  parrafo('Monte Grande, {{FECHA}}.', J.RIGHT);
  // Espacio para la firma
  parrafo(''); parrafo(''); parrafo(''); parrafo('');
  parrafo('Dr. Javier García', J.CENTER, true);
  parrafo('Coordinador de la rotación de Fellows de Procuración y Trasplante', J.CENTER);
  parrafo('Hospital de Alta Complejidad del Bicentenario Esteban Echeverría', J.CENTER);
}

function buildResponse(data) {
  var output = ContentService.createTextOutput(JSON.stringify(data));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}
