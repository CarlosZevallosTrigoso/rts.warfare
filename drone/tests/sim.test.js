// Pruebas de la simulación de drone.warfare. Ejecutar: node drone/tests/sim.test.js
const assert = require('node:assert'), path = require('node:path');
for (const f of ['datos', 'mapa', 'ruta', 'mundo', 'ia']) require(path.join(__dirname, '..', 'src', 'sim', f + '.js'));
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
// Utilidades para montar escenas: buscar una celda de un terreno con sitio alrededor, y llevar allí a un soldado.
const celda = (m, t, cond) => { const N = m.N; for (let y = 16; y < N - 16; y++) for (let x = 16; x < N - 26; x++) if (m.mapa.terreno[y * N + x] === t && m.paso[y * N + x] && (!cond || cond(x, y))) return { x: x + 0.5, y: y + 0.5 }; throw new Error('sin celda de ' + D.TERRENO[t]); };
const llano = (m, x, y, n) => { for (let d = 0; d <= n; d++) { const c = y * m.N + x + d; if (m.mapa.terreno[c] > 2 || !m.paso[c]) return false; } return true; };
const sol = (m, j, tipo) => m.ents.find((e) => e.clase === 'sol' && e.j === j && e.tipo === tipo);
const lleva = (u, p) => { u.x = p.x; u.y = p.y; u.ruta = null; u.orden = 'nada'; };
const solos = (m, ...quedan) => { for (const e of m.ents) if (e.clase === 'sol' && !quedan.includes(e)) { e.x = e.j ? m.N - 2.5 - (e.id % 5) : 2.5 + (e.id % 5); e.y = e.j ? m.N - 2.5 : 2.5; e.fuego = false; e.recarga = 1e9; } for (const e of m.ents) if (e.clase === 'dron') { e.alt = 0; e.orbita = null; e.x = 1.5; e.y = 1.5; } D.detectar(m); }; // aparta a los demás (cada bando a una esquina) y posa los drones
const avanza = (m, n) => { for (let i = 0; i < n; i++) D.tick(m); };

prueba('el reloj: la partida empieza con luz, anochece sin saltos y, si nadie hace nada, gana el defensor al amanecer', () => {
  const m = D.crearMundo(3, {}), E = D.ECON; assert.ok(!D.esNoche(m) && D.luz(m) === 1); assert.strictEqual(D.faltaAmanecer(m), E.dia - E.inicio);
  let antes = D.luz(m), oscuro = false; while (!m.fin) { D.tick(m); const l = D.luz(m); assert.ok(Math.abs(l - antes) < 0.02, 'salto de luz en el tick ' + m.t); antes = l; if (l === 0) oscuro = true; }
  assert.ok(oscuro, 'no llegó a hacerse de noche'); assert.deepStrictEqual({ gana: m.fin.gana, motivo: m.fin.motivo }, { gana: 1, motivo: 'amanecer' }); assert.strictEqual(m.t, E.dia);
  const t = m.t; D.tick(m); assert.strictEqual(m.t, t, 'acabada la partida, el mundo se para');
});
prueba('mover: el equipo entero llega a su sitio sin pisar muros ni agua; en sigilo tarda el doble', () => {
  const ida = (sigilo) => { const m = D.crearMundo(4, {}), us = m.ents.filter((e) => e.clase === 'sol' && e.j === 0 && e.eq === 1), b = m.mapa.bases[0], x = b.x + Math.cos(b.frente) * 22, y = b.y + Math.sin(b.frente) * 22;
    if (sigilo) D.orden(m, { t: 'modo', j: 0, eqs: [1], sigilo: true }); D.orden(m, { t: 'mover', j: 0, eqs: [1], x, y }); let n = 0;
    while (n < 6000 && (n < 5 || us.some((u) => u.orden === 'mover'))) { D.tick(m); n++; for (const u of us) assert.ok(m.mapa.paso[Math.floor(u.y) * m.N + Math.floor(u.x)], 'pisa donde no se puede'); }
    for (const u of us) assert.ok(Math.hypot(u.x - x, u.y - y) < 4, 'no llegó: ' + Math.hypot(u.x - x, u.y - y)); assert.strictEqual(new Set(us.map((u) => Math.floor(u.y) * m.N + Math.floor(u.x))).size, us.length, 'dos en la misma celda'); return n; };
  const normal = ida(false), lento = ida(true); assert.ok(lento > normal * 1.5, 'el sigilo no frena: ' + normal + ' / ' + lento);
});
prueba('detección: quieto bajo los árboles no se le ve; andando al descubierto, sí; de noche se ve menos; quien dispara se delata', () => {
  const m = D.crearMundo(6, {}), E = D.ECON, T = D.T, ojo = sol(m, 1, 'asaltante'), u = sol(m, 0, 'asaltante'); solos(m, ojo, u); ojo.fuego = false; u.fuego = false;
  const p = celda(m, T.SUELO, (x, y) => llano(m, x, y, 16)); lleva(ojo, p); lleva(u, { x: p.x + 13, y: p.y }); u.movio = true; D.detectar(m);
  assert.ok(m.visto[1].has(u.id), 'a 13 celdas, de día y andando al descubierto, se le tiene que ver');
  const t0 = m.t; m.t = E.diaLuz + 2000; D.detectar(m); assert.ok(!m.visto[1].has(u.id), 'de noche a 13 celdas no'); lleva(u, { x: p.x + 7, y: p.y }); u.movio = true; D.detectar(m); assert.ok(m.visto[1].has(u.id), 'de noche a 7 celdas sí'); m.t = t0;
  const b = celda(m, T.BOSQUE); lleva(u, b); lleva(ojo, { x: b.x - 9, y: b.y }); u.movio = false; D.detectar(m);
  assert.ok(!m.visto[1].has(u.id), 'quieto en la arboleda, a 9 celdas no se le ve'); const callado = u.firma; u.tTiro = m.t; D.detectar(m); assert.ok(u.firma >= E.firmaTiro && u.firma > callado * 3, 'si dispara, su firma se dispara: ' + callado + ' → ' + u.firma);
  u.tTiro = -999; u.movio = true; u.sigilo = false; D.detectar(m); const andando = u.firma; u.sigilo = true; D.detectar(m); assert.ok(u.firma < andando, 'el sigilo no baja la firma');
});
prueba('combate: dos fusileros al descubierto se disparan hasta que uno cae; a cubierto se aguanta más; fuego contenido no dispara de lejos', () => {
  const duelo = (cubierto, s) => { const m = D.crearMundo(s, {}), T = D.T, a = sol(m, 0, 'asaltante'), b = sol(m, 1, 'asaltante'); solos(m, a, b);
    const tiro = (x, y) => m.paso[y * m.N + x + 9] && m.mapa.terreno[y * m.N + x + 9] <= 2 && D.seVe(m.mapa, x + 0.5, y + 0.5, x + 9.5, y + 0.5), p = cubierto ? celda(m, T.TRINCHERA, tiro) : celda(m, T.SUELO, (x, y) => llano(m, x, y, 12)); lleva(b, p); lleva(a, { x: p.x + 9, y: p.y }); a.vida = a.vidaMax = 1e6; D.detectar(m);
    let n = 0; while (b.vida > 0 && n < 4000) { D.tick(m); n++; } return n; };
  let abierto = 0, tapado = 0; for (let s = 1; s <= 20; s++) { abierto += duelo(false, s); tapado += duelo(true, s); }
  assert.ok(abierto / 20 < 600, 'al descubierto cae en menos de medio minuto: ' + abierto / 20); assert.ok(tapado > abierto * 1.25, 'la trinchera no protege: ' + abierto + ' / ' + tapado);
  const m = D.crearMundo(2, {}), a = sol(m, 0, 'asaltante'), b = sol(m, 1, 'asaltante'); solos(m, a, b); const p = celda(m, D.T.SUELO, (x, y) => llano(m, x, y, 12)); lleva(b, p); lleva(a, { x: p.x + 10, y: p.y }); a.fuego = false; b.fuego = false; D.detectar(m);
  avanza(m, 200); assert.ok(a.vida === a.vidaMax && b.vida === b.vidaMax && m.efectos.every((e) => e.tipo !== 'tiro'), 'con fuego contenido, a 10 celdas nadie dispara');
  a.fuego = true; avanza(m, 100); assert.ok(m.efectos.some((e) => e.tipo === 'tiro'), 'con fuego libre, sí'); assert.ok(b.supr > 0 || b.vida <= 0, 'el que recibe se agacha');
});
prueba('cobertura con dirección: detrás de un obstáculo bajo cubre de lo que viene de ese lado y no del otro; el camino expone; los puestos buscan lo cubierto', () => {
  const m = D.crearMundo(3, {}), T = D.T, N = m.N, t = m.mapa.terreno; let q = null;
  for (const o of m.mapa.muretes) if (o.x > 12 && o.x < N - 12 && t[o.y * N + o.x - 1] === T.SUELO && m.paso[o.y * N + o.x - 1] && t[o.y * N + o.x - 2] !== T.MURETE && [1, 2, 3].every((d) => m.paso[o.y * N + o.x + d] && t[o.y * N + o.x + d] !== T.BOSQUE)) { q = o; break; }
  assert.ok(q, 'sin obstáculo bajo con sitio al oeste');
  const px = q.x - 0.5, py = q.y + 0.5; // el que se cubre está pegado al oeste del obstáculo
  assert.strictEqual(D.cobNivel(D.cobFrente(m, px, py, px + 10, py)), 'pesada', 'del este (con el obstáculo en medio) debe cubrir mucho');
  assert.ok(D.cobFrente(m, px, py, px - 10, py) < D.COB_LIGERA, 'del oeste (por la espalda) no cubre');
  assert.ok(D.cobFrente(m, px, py, px + 1.2, py) < D.COB_LIGERA, 'a quemarropa no cuenta');
  assert.ok(D.seVe(m.mapa, px, py, px + 4, py), 'el obstáculo bajo no corta la vista');
  const c = (() => { for (let y = 20; y < N - 20; y++) for (let x = 20; x < N - 20; x++) if (t[y * N + x] === T.CAMINO && t[y * N + x + 1] === T.CAMINO) return { x: x + 0.5, y: y + 0.5 }; })();
  assert.strictEqual(D.cobNivel(D.cobFrente(m, c.x, c.y, c.x + 12, c.y)), 'expuesto', 'en mitad del camino se está expuesto');
  const ps = D.puestos(m, px - 1, py, 4, { x: px + 12, y: py }); assert.strictEqual(ps.length, 4); assert.strictEqual(new Set(ps.map((p) => p.x + ',' + p.y)).size, 4, 'puestos repetidos');
  assert.ok(ps[0].cob >= D.COB_PESADA, 'el mejor puesto debe ser el cubierto: ' + JSON.stringify(ps[0])); for (const p of ps) assert.ok(m.paso[Math.floor(p.y) * N + Math.floor(p.x)], 'puesto donde no se pisa');
  // la orden de mover deja a cada uno en los puestos que anuncia la vista previa, y mirando a la amenaza
  const us = m.ents.filter((e) => e.clase === 'sol' && e.j === 0 && e.eq === 1), b = m.mapa.bases[0], x = b.x + Math.cos(b.frente) * 14, y = b.y + Math.sin(b.frente) * 14, cx = us.reduce((s, u) => s + u.x, 0) / 4, cy = us.reduce((s, u) => s + u.y, 0) / 4;
  const previstos = D.puestos(m, x, y, 4, D.amenaza(m, 0, x, y, cx, cy)).map((p) => p.x + ',' + p.y).sort(); D.orden(m, { t: 'mover', j: 0, eqs: [1], x, y }); avanza(m, 1500);
  assert.deepStrictEqual(us.map((u) => u.x + ',' + u.y).sort(), previstos, 'no acabaron donde decía la vista previa');
});
prueba('supresión, retirada, granada y humo', () => {
  const E = D.ECON, T = D.T, escena = (s) => { const m = D.crearMundo(s, {}), a = m.ents.filter((e) => e.clase === 'sol' && e.j === 0 && e.tipo === 'asaltante').slice(0, 3), b = sol(m, 1, 'asaltante'); solos(m, ...a, b); const p = celda(m, T.SUELO, (x, y) => llano(m, x, y, 12) && llano(m, x, y + 1, 12) && llano(m, x, y - 1, 12)); return { m, a, b, p }; };
  // tres fusiles sobre uno lo clavan; uno solo, no. El clavado no se mueve.
  { const { m, a, b, p } = escena(4); lleva(b, p); b.vida = b.vidaMax = 1e6; b.fuego = false; lleva(a[0], { x: p.x + 9, y: p.y }); for (const u of a) u.vida = u.vidaMax = 1e6; D.detectar(m);
    let pico = 0; for (let i = 0; i < 300; i++) { D.tick(m); pico = Math.max(pico, b.supr); } assert.ok(pico > 0 && pico < E.suprClavado, 'un solo fusil no debe clavar: ' + pico);
    lleva(a[1], { x: p.x + 9, y: p.y + 1 }); lleva(a[2], { x: p.x + 9, y: p.y - 1 }); for (const u of a) u.recarga = 0; avanza(m, 300); assert.strictEqual(D.nivelSupr(b), 2, 'tres fusiles deben clavarlo: ' + b.supr);
    const x0 = b.x; b.eq = 99; D.orden(m, { t: 'mover', j: 1, eqs: [99], x: p.x - 8, y: p.y }); avanza(m, 60); assert.ok(Math.abs(b.x - x0) < 0.2, 'clavado no se mueve');
    // retirada: sale aunque esté clavado, corre más que andando, no dispara y acaba junto a su barracón
    D.orden(m, { t: 'retirada', j: 1, eqs: [99] }); avanza(m, 40); assert.ok(b.orden === 'retirada' && Math.abs(b.x - x0) > 0.5, 'la retirada no arranca'); const tiros = m.efectos.filter((e) => e.tipo === 'tiro' && e.j === 1).length;
    b.fuego = true; avanza(m, 100); assert.strictEqual(m.efectos.filter((e) => e.tipo === 'tiro' && e.j === 1).length, tiros, 'en retirada no se dispara');
    for (const u of a) u.fuego = false; let n = 0; while (b.orden === 'retirada' && n < 8000) { D.tick(m); n++; } const bar = m.ents.find((e) => e.tipo === 'barracon' && e.j === 1); assert.ok(Math.hypot(b.x - bar.x, b.y - bar.y) < 5 && b.supr === 0, 'no llegó a su barracón'); }
  // granada: hiere en su radio y no más allá, hay que estar a tiro, y el equipo queda recargando
  { const { m, a, b, p } = escena(5); lleva(b, p); b.fuego = false; const otro = sol(m, 1, 'escopetero'); lleva(otro, { x: p.x, y: p.y + 4 }); otro.recarga = 1e9; a[0].eq = 98; a[0].recarga = 1e9; b.recarga = 1e9; lleva(a[0], { x: p.x + 8, y: p.y }); D.detectar(m); // (ninguno dispara: solo se prueba la granada)
    D.orden(m, { t: 'granada', j: 0, eqs: [98], x: p.x, y: p.y }); avanza(m, 40); assert.ok(b.vida === b.vidaMax && m.efectos.some((e) => e.tipo === 'noPuede' && e.que === 'lejos'), 'a 8 celdas no llega');
    lleva(a[0], { x: p.x + 4, y: p.y }); D.orden(m, { t: 'granada', j: 0, eqs: [98], x: p.x, y: p.y }); avanza(m, E.granadaVuelo + 3);
    assert.ok(b.vida < b.vidaMax - 30 && b.supr >= E.suprAgachado, 'la granada no hirió: ' + b.vida); assert.strictEqual(otro.vida, otro.vidaMax, 'a 4 celdas no debe alcanzar'); assert.strictEqual(a[0].vida, a[0].vidaMax, 'el que la lanza, a 4 celdas, sale ileso');
    const v = b.vida; D.orden(m, { t: 'granada', j: 0, eqs: [98], x: p.x, y: p.y }); avanza(m, 60); assert.ok(b.vida === v && m.efectos.some((e) => e.tipo === 'noPuede' && e.que === 'recarga'), 'no se lanzan dos seguidas'); }
  // humo: entre dos que se ven, la nube corta la vista y el fuego; cuando se disipa, vuelven a verse
  { const { m, a, b, p } = escena(6); lleva(b, p); b.fuego = false; a[0].eq = 97; a[0].fuego = false; lleva(a[0], { x: p.x + 10, y: p.y }); b.movio = true; D.detectar(m); assert.ok(m.visto[0].has(b.id), 'antes del humo se ven');
    D.orden(m, { t: 'humo', j: 0, eqs: [97], x: p.x + 5, y: p.y }); avanza(m, E.granadaVuelo + 6); assert.strictEqual(m.humos.length, 1); b.movio = true; D.detectar(m); assert.ok(!m.visto[0].has(b.id) && !m.visto[1].has(a[0].id), 'con humo en medio no se ven');
    avanza(m, E.humoDura + 10); assert.strictEqual(m.humos.length, 0); b.movio = true; a[0].movio = true; D.detectar(m); assert.ok(m.visto[0].has(b.id), 'disipado el humo, se ven otra vez'); }
});
prueba('la carga: un asaltante pegado al centro lo vuela en cinco segundos y gana; el que no lleva carga no puede; sin descubrirlo, tampoco', () => {
  const m = D.crearMundo(5, {}), E = D.ECON, c = m.ents.find((e) => e.tipo === 'centro'), a = sol(m, 0, 'asaltante'); solos(m, a);
  D.orden(m, { t: 'volar', j: 0, eqs: [a.eq], obj: c.id }); avanza(m, 3); assert.strictEqual(a.orden, 'nada', 'no se puede volar lo que no se ha descubierto');
  lleva(a, D.cercaLibre(m, c.x + 2, c.y + 2)); D.detectar(m); assert.ok(m.conocido[0].has(c.id), 'a dos pasos, el centro queda descubierto');
  D.orden(m, { t: 'volar', j: 0, eqs: [a.eq], obj: c.id }); avanza(m, E.cargaTicks + 200);
  assert.deepStrictEqual(m.fin && { gana: m.fin.gana, motivo: m.fin.motivo }, { gana: 0, motivo: 'centro' }); assert.ok(!m.porId.has(c.id));
  const m2 = D.crearMundo(5, {}), o = sol(m2, 0, 'observador'), c2 = m2.ents.find((e) => e.tipo === 'centro'); solos(m2, o); lleva(o, D.cercaLibre(m2, c2.x + 2, c2.y + 2)); D.detectar(m2); D.orden(m2, { t: 'volar', j: 0, eqs: [o.eq], obj: c2.id }); avanza(m2, 400);
  assert.ok(m2.porId.has(c2.id) && !m2.fin, 'un observador no lleva carga');
  const m3 = D.crearMundo(5, {}); for (const e of m3.ents) if (e.clase === 'sol' && e.j === 0 && D.SOL[e.tipo].carga) e.vida = 0; avanza(m3, 2); assert.deepStrictEqual(m3.fin && m3.fin.motivo, 'sin asalto');
});
prueba('partida entera, máquina contra máquina: termina, es idéntica si se repite, y el tick es barato', () => {
  const juega = (s, esc) => { const m = D.crearMundo(s, { escenario: esc, ia: [true, true] }), t0 = Date.now(); let n = 0; while (!m.fin) { D.tick(m); n++; assert.ok(n <= D.ECON.dia, 'no termina'); } return { fin: m.fin, n, ms: (Date.now() - t0) / n, firma: m.ents.map((e) => e.id + ':' + e.x.toFixed(3) + ',' + e.y.toFixed(3) + ',' + Math.round(e.vida)).join('|'), bajas: [m.jug[0].bajas, m.jug[1].bajas] }; };
  let atacante = 0, total = 0;
  for (const esc of ['mixto', 'urbano']) for (const s of [1, 2, 3, 4]) { const a = juega(s, esc); assert.ok(a.ms < 0.5, 'tick caro: ' + a.ms); if (a.fin.gana === 0) atacante++; total++; if (s === 1) { const b = juega(s, esc); assert.deepStrictEqual(b.fin, a.fin); assert.strictEqual(b.firma, a.firma, 'la partida no es determinista'); } }
  console.log('      (el atacante gana ' + atacante + ' de ' + total + ' con el rival provisional)');
});
console.log(ok + ' pruebas correctas');
