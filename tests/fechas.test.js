// Pruebas de la lógica de fechas. Correr con: node tests/fechas.test.js
var assert = require("assert");
var F = require("../fechas.js");

var ok = 0;
function test(nombre, fn) {
  try { fn(); ok++; console.log("  ✓ " + nombre); }
  catch (e) { console.error("  ✗ " + nombre + "\n    " + e.message); process.exitCode = 1; }
}

var todas = F.semanasDisponibles(new Date(2026, 0, 1));
var de2026 = todas.filter(function (w) { return w.start < "2027-01-01"; });
var de2027 = todas.filter(function (w) { return w.start >= "2027-01-01"; });

test("La última semana habilitada de 2026 empieza el 8/12/2026", function () {
  assert.strictEqual(de2026[de2026.length - 1].start, "2026-12-08");
  assert.strictEqual(de2026[de2026.length - 1].end, "2026-12-14");
});

test("No hay semanas habilitadas del 15/12/2026 al 28/02/2027", function () {
  var enReceso = todas.filter(function (w) {
    return w.start >= "2026-12-15" && w.start <= "2027-02-28" || w.end >= "2026-12-15" && w.end <= "2027-02-28";
  });
  assert.deepStrictEqual(enReceso, []);
});

test("Semana normal de 2027: lunes 1/3 a viernes 5/3", function () {
  assert.strictEqual(de2027[0].start, "2027-03-01");
  assert.strictEqual(de2027[0].end, "2027-03-05");
  assert.strictEqual(F.parseKey(de2027[0].start).getDay(), 1);
  assert.strictEqual(F.parseKey(de2027[0].end).getDay(), 5);
  assert.deepStrictEqual(F.rangoRotacion("2027-03-01", "2027-03-05"), { desde: "2027-03-01", hasta: "2027-03-05" });
});

test("Última semana habilitada: lunes 6/12 a viernes 10/12/2027", function () {
  assert.strictEqual(de2027[de2027.length - 1].start, "2027-12-06");
  assert.strictEqual(de2027[de2027.length - 1].end, "2027-12-10");
  assert.strictEqual(F.ULTIMO_DIA_2027, "2027-12-10");
  assert.ok(F.semanaHabilitada("2027-12-06", "2027-12-10"));
  assert.ok(!F.semanaHabilitada("2027-12-06", "2027-12-11"), "un fin en sábado 11/12 ya queda fuera");
  assert.ok(!F.semanaHabilitada("2027-12-13", "2027-12-17"));
});

test("Semanas de 2027: clave el lunes, 5 días (lun-vie, o mar-sáb si el lunes es feriado), consecutivas", function () {
  de2027.forEach(function (w, i) {
    assert.strictEqual(F.parseKey(w.start).getDay(), 1, w.start);
    var dias = F.esFeriado(w.start) ? 5 : 4;
    assert.strictEqual(F.dateKey(F.addDays(F.parseKey(w.start), dias)), w.end, w.start);
    var rg = F.rangoRotacion(w.start, w.end);
    var n = (F.parseKey(rg.hasta) - F.parseKey(rg.desde)) / 864e5 + 1;
    assert.strictEqual(Math.round(n), 5, "la rotación dura 5 días: " + w.start);
    if (i > 0) assert.strictEqual(F.dateKey(F.addDays(F.parseKey(de2027[i - 1].start), 7)), w.start);
  });
  assert.strictEqual(de2027.length, 41);
});

test("Lunes feriado 2027: rotación de martes a sábado (21/6, 16/8 y 11/10)", function () {
  var esperado = {
    "2027-06-21": { end: "2027-06-26", desde: "2027-06-22" },
    "2027-08-16": { end: "2027-08-21", desde: "2027-08-17" },
    "2027-10-11": { end: "2027-10-16", desde: "2027-10-12" }
  };
  Object.keys(esperado).forEach(function (k) {
    var w = de2027.filter(function (x) { return x.start === k; })[0];
    assert.ok(w, "falta la semana " + k);
    assert.strictEqual(w.end, esperado[k].end);
    assert.strictEqual(F.parseKey(w.end).getDay(), 6);
    assert.deepStrictEqual(F.rangoRotacion(w.start, w.end), { desde: esperado[k].desde, hasta: esperado[k].end });
    assert.strictEqual(F.parseKey(F.rangoRotacion(w.start, w.end).desde).getDay(), 2);
  });
});

test("Un lunes feriado nuevo cargado en FERIADOS también pasa a martes a sábado", function () {
  F.FERIADOS.push("2027-09-13");
  try {
    assert.strictEqual(F.finRotacion("2027-09-13"), "2027-09-18");
    var w = F.semanasDelMes(2027, 8).filter(function (x) { return x.start === "2027-09-13"; })[0];
    assert.strictEqual(w.end, "2027-09-18");
    assert.deepStrictEqual(F.rangoRotacion("2027-09-13", w.end), { desde: "2027-09-14", hasta: "2027-09-18" });
  } finally { F.FERIADOS.pop(); }
});

test("Filas viejas de 2027 con fin en sábado se muestran con la regla de 5 días (sin tocar la fila)", function () {
  assert.deepStrictEqual(F.rangoRotacion("2027-03-01", "2027-03-06"), { desde: "2027-03-01", hasta: "2027-03-05" });
  assert.strictEqual(F.diaIngreso("2027-03-01", "2027-03-06"), "2027-03-01");
});

test("No hay semanas duplicadas en la lista de 2027", function () {
  var vistos = {};
  de2027.forEach(function (w) {
    assert.ok(!vistos[w.start], "duplicada: " + w.start);
    vistos[w.start] = true;
  });
});

test("Una semana que cruza de mes aparece en el calendario de ambos meses", function () {
  // 29/3 al 3/4/2027
  var marzo = F.semanasDelMes(2027, 2).map(function (w) { return w.start; });
  var abril = F.semanasDelMes(2027, 3).map(function (w) { return w.start; });
  assert.ok(marzo.indexOf("2027-03-29") >= 0 && abril.indexOf("2027-03-29") >= 0);
});

test("Cada lunes feriado de 2027 da como ingreso el siguiente día hábil", function () {
  var lunes = F.FERIADOS_2027.filter(function (k) { return F.parseKey(k).getDay() === 1; });
  assert.deepStrictEqual(lunes, ["2027-06-21", "2027-08-16", "2027-10-11"]);
  lunes.forEach(function (k) {
    var w = de2027.filter(function (x) { return x.start === k; })[0];
    assert.ok(w, "no hay semana que empiece " + k);
    var esperado = F.parseKey(k);
    do { esperado = F.addDays(esperado, 1); } while (F.esFeriado(F.dateKey(esperado)));
    assert.strictEqual(F.diaIngreso(w.start, w.end), F.dateKey(esperado));
    assert.strictEqual(F.parseKey(F.diaIngreso(w.start, w.end)).getDay(), 2); // martes
  });
  assert.strictEqual(F.fmtDiaCorto(F.diaIngreso("2027-08-16", "2027-08-21")), "martes 17/8");
});

test("Si lunes y martes son feriado, el ingreso es el miércoles", function () {
  // Caso sintético: agregamos temporalmente el martes 17/8 como feriado.
  F.FERIADOS.push("2027-08-17");
  try { assert.strictEqual(F.diaIngreso("2027-08-16", "2027-08-21"), "2027-08-18"); }
  finally { F.FERIADOS.pop(); }
});

test("Un feriado en mitad de la semana no cambia el ingreso", function () {
  assert.strictEqual(F.diaIngreso("2027-03-22", "2027-03-26"), "2027-03-22"); // 24, 25 y 26/3 feriados
  assert.strictEqual(F.diaIngreso("2027-05-24", "2027-05-28"), "2027-05-24"); // martes 25/5
  assert.strictEqual(F.diaIngreso("2027-12-06", "2027-12-10"), "2027-12-06"); // miércoles 8/12
  // y el fin sigue siendo viernes
  assert.strictEqual(F.finRotacion("2027-03-22"), "2027-03-26");
  assert.strictEqual(F.finRotacion("2027-05-24"), "2027-05-28");
});

test("Las semanas de 2026 no cambian", function () {
  var nov = F.semanasDelMes(2026, 10).map(function (w) { return w.start + ">" + w.end; });
  assert.deepStrictEqual(nov, ["2026-11-01>2026-11-07", "2026-11-08>2026-11-14", "2026-11-15>2026-11-21", "2026-11-22>2026-11-28", "2026-11-29>2026-11-30"]);
  var dic = F.semanasDelMes(2026, 11).map(function (w) { return w.start + ">" + w.end; });
  assert.deepStrictEqual(dic, ["2026-12-01>2026-12-07", "2026-12-08>2026-12-14", "2026-12-15>2026-12-21", "2026-12-22>2026-12-28", "2026-12-29>2026-12-31"]);
  assert.deepStrictEqual(F.rangoRotacion("2026-11-22", "2026-11-28"), { desde: "2026-11-22", hasta: "2026-11-28" });
});

test("Semanas 2026 habilitadas: ingreso con feriados 2026", function () {
  assert.strictEqual(F.diaIngreso("2026-11-22", "2026-11-28"), "2026-11-24"); // dom 22, lun 23 feriado
  assert.strictEqual(F.diaIngreso("2026-12-08", "2026-12-14"), "2026-12-09"); // mar 8 feriado
  assert.strictEqual(F.diaIngreso("2026-12-01", "2026-12-07"), "2026-12-01");
});

test("Receso y tarjeta de receso", function () {
  assert.ok(F.enReceso("2026-12-15") && F.enReceso("2027-02-28") && F.enReceso("2027-12-12"));
  assert.ok(!F.enReceso("2026-12-14") && !F.enReceso("2027-03-01") && !F.enReceso("2027-12-11"));
  assert.ok(F.mesConReceso(2026, 11) && F.mesConReceso(2027, 0) && F.mesConReceso(2027, 1) && F.mesConReceso(2027, 11));
  assert.ok(!F.mesConReceso(2027, 2) && !F.mesConReceso(2026, 10));
});

test("Cupos: 5 por semana, legacy 6/6 en 2026", function () {
  assert.strictEqual(F.cuposMax(3, 2026), 5);
  assert.strictEqual(F.cuposMax(6, 2026), 6);
  assert.strictEqual(F.cuposMax(6, 2027), 5);
});

test("Formato largo en español", function () {
  assert.strictEqual(F.fmtLargo("2027-08-16"), "16 de agosto de 2027");
  assert.strictEqual(F.fmtDiaCompleto("2027-03-01"), "lunes 01/03/2027");
});

test("Desde hoy (22/11/2026) se ofrecen semanas 2026 hasta el 8/12 y luego desde el 1/3/2027", function () {
  var l = F.semanasDisponibles(new Date(2026, 10, 22));
  var starts = l.map(function (w) { return w.start; });
  assert.deepStrictEqual(starts.slice(0, 5), ["2026-11-22", "2026-11-29", "2026-12-01", "2026-12-08", "2027-03-01"]);
});

console.log("\n" + ok + " pruebas OK" + (process.exitCode ? " — HAY FALLAS" : ""));
