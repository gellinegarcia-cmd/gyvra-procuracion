// fechas.js — Lógica de semanas, ventana de rotación y feriados.
// Funciones puras: las usa index.html (window.Fechas) y los tests de Node (require).
(function (root) {
  "use strict";

  // ---------------------------------------------------------------------------
  // FERIADOS nacionales (Ley 27.399). Solo importan para calcular el día de ingreso.
  // Formato "YYYY-MM-DD". Incluye trasladables ya trasladados y días no laborables.
  // ---------------------------------------------------------------------------
  var FERIADOS_2026 = [
    "2026-11-23", // Soberanía Nacional (trasladado del viernes 20/11) — LUNES
    "2026-12-07", // Día no laborable con fines turísticos (Res. 164/2025) — LUNES
    "2026-12-08", // Inmaculada Concepción de María
    "2026-12-25"  // Navidad
  ];

  var FERIADOS_2027 = [
    "2027-03-24", // miércoles — Día Nacional de la Memoria por la Verdad y la Justicia
    "2027-03-25", // jueves — Jueves Santo (día no laborable)
    "2027-03-26", // viernes — Viernes Santo
    "2027-04-02", // viernes — Día del Veterano y de los Caídos en Malvinas
    "2027-05-01", // sábado — Día del Trabajador
    "2027-05-25", // martes — Revolución de Mayo
    "2027-06-20", // domingo — Paso a la Inmortalidad del Gral. Belgrano
    "2027-06-21", // LUNES — Paso a la Inmortalidad del Gral. Güemes (17/6 jueves → lunes siguiente)
    "2027-07-09", // viernes — Día de la Independencia
    "2027-08-16", // LUNES — Paso a la Inmortalidad del Gral. San Martín (17/8 martes → lunes anterior)
    "2027-10-11", // LUNES — Día del Respeto a la Diversidad Cultural (12/10 martes → lunes anterior)
    "2027-11-20", // sábado — Día de la Soberanía Nacional. VERIFICAR con decreto 2027 (el Decreto 614/2025 permite pasarlo al lunes 22/11)
    "2027-12-08", // miércoles — Inmaculada Concepción de María
    "2027-12-25"  // sábado — Navidad
    // VERIFICAR con decreto 2027: días no laborables con fines turísticos (todavía no decretados).
  ];

  var FERIADOS = FERIADOS_2026.concat(FERIADOS_2027);

  // ---------------------------------------------------------------------------
  // Ventana habilitada para anotarse
  // ---------------------------------------------------------------------------
  var ULTIMO_INICIO_2026 = "2026-12-14"; // semanas 2026 con inicio <= esta fecha
  var PRIMER_LUNES_2027 = "2027-03-01";
  var ULTIMO_SABADO_2027 = "2027-12-11";
  var MAX_CUPOS = 5;

  var MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
  var MESES_MIN = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  var DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function dateKey(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function parseKey(k) { var p = String(k).split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function addDays(d, n) { var r = new Date(d.getFullYear(), d.getMonth(), d.getDate()); r.setDate(r.getDate() + n); return r; }
  function esKey(k) { return /^\d{4}-\d{2}-\d{2}$/.test(String(k)); }

  function esFeriado(key) { return FERIADOS.indexOf(key) >= 0; }
  function esHabil(d) { var w = d.getDay(); return w >= 1 && w <= 5 && !esFeriado(dateKey(d)); }

  // Semanas que se muestran en un mes del calendario.
  // 2026 (lógica original): bloques de 7 días desde el día 1, cortados a fin de mes.
  // 2027+: semanas lunes a sábado que tocan el mes (una semana que cruza meses aparece en ambos meses).
  function semanasDelMes(year, month) {
    var weeks = [];
    if (year <= 2026) {
      var d = new Date(year, month, 1);
      while (d.getMonth() === month) {
        var end = addDays(d, 6);
        if (end.getMonth() !== month) end = new Date(year, month + 1, 0);
        weeks.push({ start: dateKey(d), end: dateKey(end) });
        d = addDays(d, 7);
      }
    } else {
      var first = new Date(year, month, 1);
      var last = new Date(year, month + 1, 0);
      var dow = first.getDay();
      var cur = addDays(first, dow === 0 ? -6 : 1 - dow);
      while (cur <= last) {
        var sab = addDays(cur, 5);
        if (sab >= first) weeks.push({ start: dateKey(cur), end: dateKey(sab) });
        cur = addDays(cur, 7);
      }
    }
    return weeks;
  }

  // ¿Se puede anotar alguien nuevo en esta semana?
  function semanaHabilitada(startKey, endKey) {
    if (startKey < "2027-01-01") return startKey >= "2026-01-01" && startKey <= ULTIMO_INICIO_2026;
    return startKey >= PRIMER_LUNES_2027 && endKey <= ULTIMO_SABADO_2027;
  }

  function enReceso(key) {
    return (key >= "2026-12-15" && key <= "2027-02-28") || key >= "2027-12-12";
  }

  // ¿El mes tiene días de receso? (para mostrar la tarjeta de receso en el calendario)
  function mesConReceso(year, month) {
    var last = new Date(year, month + 1, 0).getDate();
    for (var d = 1; d <= last; d++) if (enReceso(dateKey(new Date(year, month, d)))) return true;
    return false;
  }

  // Lista para anotarse: semanas habilitadas que no terminaron, sin duplicados, ordenadas.
  function semanasDisponibles(hoy) {
    var hoyKey = dateKey(hoy);
    var y = hoy.getFullYear(), m = hoy.getMonth();
    var vistas = {}, lista = [];
    while (y < 2027 || (y === 2027 && m <= 11)) {
      semanasDelMes(y, m).forEach(function (w) {
        if (vistas[w.start]) return;
        if (!semanaHabilitada(w.start, w.end)) return;
        if (w.end < hoyKey) return;
        vistas[w.start] = true;
        lista.push(w);
      });
      m++;
      if (m > 11) { m = 0; y++; }
    }
    lista.sort(function (a, b) { return a.start < b.start ? -1 : a.start > b.start ? 1 : 0; });
    return lista;
  }

  // Día de ingreso: primer día hábil (lunes a viernes, no feriado) de la semana.
  function diaIngreso(startKey, endKey) {
    var d = parseKey(startKey), fin = parseKey(endKey || startKey);
    while (d <= fin) {
      if (esHabil(d)) return dateKey(d);
      d = addDays(d, 1);
    }
    return startKey;
  }

  // Cupo de una semana. Legacy 2026: si ya hay 6 anotados se muestra 6/6.
  function cuposMax(ocupados, year) {
    if (year <= 2026 && ocupados >= 6) return 6;
    return MAX_CUPOS;
  }

  // Formatos
  function fmtCorto(key) { var d = parseKey(key); return d.getDate() + "/" + (d.getMonth() + 1); }
  function fmtDiaCorto(key) { return DIAS[parseKey(key).getDay()] + " " + fmtCorto(key); }
  function fmtDiaCompleto(key) { var d = parseKey(key); return DIAS[d.getDay()] + " " + pad(d.getDate()) + "/" + pad(d.getMonth() + 1) + "/" + d.getFullYear(); }
  function fmtLargo(key) { var d = parseKey(key); return d.getDate() + " de " + MESES_MIN[d.getMonth()] + " de " + d.getFullYear(); }
  function nombreMes(key) { var d = parseKey(key); return MESES[d.getMonth()] + " " + d.getFullYear(); }

  var Fechas = {
    FERIADOS: FERIADOS, FERIADOS_2026: FERIADOS_2026, FERIADOS_2027: FERIADOS_2027,
    ULTIMO_INICIO_2026: ULTIMO_INICIO_2026, PRIMER_LUNES_2027: PRIMER_LUNES_2027, ULTIMO_SABADO_2027: ULTIMO_SABADO_2027,
    MAX_CUPOS: MAX_CUPOS, MESES: MESES, DIAS: DIAS,
    pad: pad, dateKey: dateKey, parseKey: parseKey, addDays: addDays, esKey: esKey,
    esFeriado: esFeriado, esHabil: esHabil,
    semanasDelMes: semanasDelMes, semanaHabilitada: semanaHabilitada, semanasDisponibles: semanasDisponibles,
    enReceso: enReceso, mesConReceso: mesConReceso, diaIngreso: diaIngreso, cuposMax: cuposMax,
    fmtCorto: fmtCorto, fmtDiaCorto: fmtDiaCorto, fmtDiaCompleto: fmtDiaCompleto, fmtLargo: fmtLargo, nombreMes: nombreMes
  };

  if (typeof module !== "undefined" && module.exports) module.exports = Fechas;
  else root.Fechas = Fechas;
})(this);
