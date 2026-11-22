// GYVRA Procuración — backend (Google Apps Script)
// Copiar este archivo completo al editor de Apps Script (archivo Code.gs).

var MAX_CUPOS = 5;

function doGet(e) {
  var action = e.parameter.action;
  if (action === 'getRotaciones') return getRotaciones();
  if (action === 'getActividades') return getActividades();
  if (action === 'addRotacion') {
    return addRotacion(JSON.parse(e.parameter.data));
  }
  if (action === 'saveActividades') {
    var d = JSON.parse(e.parameter.data);
    return saveActividades(d[0], d[1], d[2], d[3]);
  }
  if (action === 'cancelarRotacion') {
    var d = JSON.parse(e.parameter.data);
    return cancelarRotacion(d[0], d[1]);
  }
  return HtmlService.createHtmlOutputFromFile('Index.html')
    .setTitle('GYVRA Procuracion')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function formatearFecha(cell) {
  if (cell instanceof Date) {
    var y = cell.getFullYear();
    var m = cell.getMonth()+1 < 10 ? '0'+(cell.getMonth()+1) : ''+(cell.getMonth()+1);
    var d = cell.getDate() < 10 ? '0'+cell.getDate() : ''+cell.getDate();
    return y+'-'+m+'-'+d;
  }
  return String(cell).trim();
}

function getRotaciones() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Rotaciones');
  var lastRow = sheet.getLastRow();
  if (lastRow === 0) return buildResponse([]);
  var data = sheet.getRange(1, 1, lastRow, 7).getValues().filter(function(r){ return r[0] !== ''; });
  return buildResponse(data.map(function(row) {
    return row.map(function(cell) { return formatearFecha(cell); });
  }));
}

function addRotacion(row) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return buildResponse({status:'busy'});
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Rotaciones');
    if (row[0] !== 'RATING') {
      // Cupo: máximo MAX_CUPOS por fecha de inicio (validado dentro del lock)
      var inicio = String(row[2]).trim();
      var lastRow = sheet.getLastRow();
      var ocupados = 0;
      if (lastRow > 0) {
        var data = sheet.getRange(1, 1, lastRow, 3).getValues();
        for (var i = 0; i < data.length; i++) {
          if (data[i][0] !== '' && data[i][0] !== 'RATING' && formatearFecha(data[i][2]) === inicio) ocupados++;
        }
      }
      if (ocupados >= MAX_CUPOS) return buildResponse({status:'full'});
    }
    sheet.appendRow(row);
    return buildResponse({status:'ok'});
  } finally {
    lock.releaseLock();
  }
}

function cancelarRotacion(nombre, startKey) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return buildResponse({status:'busy'});
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Rotaciones');
    var lastRow = sheet.getLastRow();
    if (lastRow === 0) return buildResponse({status:'not_found'});
    var data = sheet.getRange(1, 1, lastRow, 7).getValues();
    for (var i = data.length - 1; i >= 0; i--) {
      var rowNombre = String(data[i][0]).toLowerCase().trim();
      var rowStart = formatearFecha(data[i][2]);
      if (rowNombre === nombre.toLowerCase().trim() && rowStart === startKey.trim()) {
        sheet.deleteRow(i + 1);
        return buildResponse({status:'ok'});
      }
    }
    return buildResponse({status:'not_found'});
  } finally {
    lock.releaseLock();
  }
}

function getActividades() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Actividades');
  var lastRow = sheet.getLastRow();
  if (lastRow === 0) return buildResponse([]);
  return buildResponse(sheet.getRange(1, 1, lastRow, 5).getValues().filter(function(r){ return r[0] !== ''; }));
}

function saveActividades(nombre, ids, nombres, pct) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return buildResponse({status:'busy'});
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Actividades');
    var lastRow = sheet.getLastRow();
    var found = -1;
    if (lastRow > 0) {
      var data = sheet.getRange(1, 1, lastRow, 1).getValues();
      for (var i = 0; i < data.length; i++) {
        if (data[i][0].toString().toLowerCase() === nombre.toLowerCase()) {
          found = i + 1;
          break;
        }
      }
    }
    var now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm");
    var row = [nombre, ids, nombres, pct+'%', now];
    if (found > 0) {
      sheet.getRange(found, 1, 1, 5).setValues([row]);
    } else {
      sheet.appendRow(row);
    }
    return buildResponse({status:'ok'});
  } finally {
    lock.releaseLock();
  }
}

function buildResponse(data) {
  var output = ContentService.createTextOutput(JSON.stringify(data));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}
