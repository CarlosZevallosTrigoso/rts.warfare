// Pruebas de la simulación de drone.warfare. Ejecutar: node drone/tests/sim.test.js
const assert = require('node:assert'), path = require('node:path');
for (const f of ['datos', 'mapa', 'ruta', 'mundo']) require(path.join(__dirname, '..', 'src', 'sim', f + '.js'));
const D = globalThis.D, T = D.T;
let ok = 0;
function prueba(nombre, fn) { if (process.env.SOLO && !nombre.includes(process.env.SOLO)) return; fn(); ok++; console.log('  ok  ' + nombre); }

prueba('el mapa sale de la semilla: misma semilla, mismo sector; otra semilla u otro escenario, otro sector', () => {
  const a = D.generarMapa(7, 'mixto'), b = D.generarMapa(7, 'mixto'), c = D.generarMapa(8, 'mixto'), u = D.generarMapa(7, 'urbano');
  assert.deepStrictEqual(Array.from(a.terreno), Array.from(b.terreno)); assert.deepStrictEqual(a.bases, b.bases);
  assert.notDeepStrictEqual(Array.from(a.terreno), Array.from(c.terreno)); assert.notDeepStrictEqual(Array.from(a.terreno), Array.from(u.terreno));
});
prueba('en 80 sectores de cada escenario: se llega a pie de una base a la otra, y cada base tiene lo suyo', () => {
  for (const esc of ['mixto', 'urbano']) for (let s = 1; s <= 80; s++) {
    const mp = D.generarMapa(s, esc), [at, df] = mp.bases, N = mp.N, id = esc + ' ' + s;
    assert.ok(D.conectado(mp, at.x, at.y, df.x, df.y), id + ': bases incomunicadas');
    assert.ok(Math.hypot(at.x - df.x, at.y - df.y) > 55, id + ': bases demasiado cerca');
    assert.ok(df.antenas.length === 2 && df.falsa && df.escucha && at.antenas.length === 1, id + ': faltan antenas o la escucha');
    for (const p of [at.barracon, at.taller, df.centro, df.taller, df.barracon, ...at.antenas, ...df.antenas, df.falsa, df.escucha]) assert.ok(mp.paso[p.y * N + p.x], id + ': edificio sobre muro o agua en ' + p.x + ',' + p.y);
    for (const an of df.antenas) assert.ok(Math.hypot(an.x - df.x, an.y - df.y) >= 8, id + ': antena pegada al centro');
    assert.ok(mp.tubos.length >= 1, id + ': sin pasos bajo tierra'); for (const t of mp.tubos) for (const b of [t.a, t.b]) assert.ok(mp.paso[Math.floor(b.y) * N + Math.floor(b.x)], id + ': boca tapada');
    const U = mp.urbano; assert.ok(df.x >= U.x0 && df.x <= U.x1 && df.y >= U.y0 && df.y <= U.y1, id + ': el centro no está en el casco urbano');
    assert.ok(mp.ruinas.length >= (esc === 'urbano' ? 40 : 10), id + ': pocos edificios (' + mp.ruinas.length + ')');
    if (esc === 'mixto') { let agua = 0; for (const t of mp.terreno) if (t === T.AGUA) agua++; assert.ok(agua > 60, id + ': sin arroyo'); }
  }
});
prueba('los dos papeles: el atacante lleva más gente y menos pilotos; el defensor, al revés; nadie pasa del tope', () => {
  for (const esc of ['mixto', 'urbano']) for (const s of [1, 2, 3, 4, 5]) {
    const m = D.crearMundo(s, { escenario: esc }), [a, d] = m.jug, cuenta = (j, c, t) => m.ents.filter((e) => e.j === j && e.clase === c && (!t || e.tipo === t)).length;
    assert.ok(a.personas <= D.ECON.tope[0] && d.personas <= D.ECON.tope[1]);
    assert.ok(cuenta(0, 'sol') > cuenta(1, 'sol') && a.pilotos < d.pilotos, 'el reparto de papeles no es el esperado');
    assert.strictEqual(cuenta(1, 'edif', 'centro'), 1); assert.strictEqual(cuenta(0, 'edif', 'centro'), 0, 'el atacante no tiene centro que defender');
    assert.ok(cuenta(1, 'dron') > cuenta(0, 'dron'));
    for (const e of m.ents) if (e.clase === 'sol') assert.ok(m.mapa.paso[Math.floor(e.y) * m.N + Math.floor(e.x)], 'soldado dentro de un muro o en el agua');
  }
});
prueba('el reloj: amanece, anochece y vuelve a amanecer; la luz cambia sin saltos', () => {
  const m = D.crearMundo(3, {}), E = D.ECON; assert.ok(!D.esNoche(m) && D.luz(m) === 1);
  let antes = D.luz(m), noches = 0, era = false; for (let i = 0; i < E.dia * 2; i++) { D.tick(m); const l = D.luz(m); assert.ok(Math.abs(l - antes) < 0.02, 'salto de luz en el tick ' + m.t + ': ' + antes + ' → ' + l); antes = l; if (D.esNoche(m) && !era) noches++; era = D.esNoche(m); }
  assert.strictEqual(noches, 2); assert.strictEqual(D.hora(D.crearMundo(3, {})), '06:36'); assert.strictEqual(D.luz(D.crearMundo(3, {})), 1, 'se empieza con luz plena');
});
console.log(ok + ' pruebas correctas');
