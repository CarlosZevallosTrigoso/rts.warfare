// Pruebas de la simulación. Ejecutar: node tests/sim.test.js
const assert = require('node:assert');
const path = require('node:path');
for (const f of ['datos', 'mapa', 'ruta', 'mundo', 'ia']) require(path.join(__dirname, '..', 'src', 'sim', f + '.js'));
const W = globalThis.W, N = W.N;

let ok = 0;
function prueba(nombre, fn) { fn(); ok++; console.log('  ok  ' + nombre); }

prueba('prng determinista', () => {
  const a = W.prng(42), b = W.prng(42);
  for (let i = 0; i < 100; i++) assert.strictEqual(a(), b());
  assert.notStrictEqual(W.prng(1)(), W.prng(2)());
});

prueba('mapa: simetría, conexión y recursos en 20 semillas', () => {
  const ruta = W.crearRuta(N);
  for (let s = 1; s <= 20; s++) {
    const mp = W.generarMapa(s * 7919);
    for (let i = 0; i < N * N; i++) {
      const e = N * N - 1 - i;
      assert.strictEqual(mp.terreno[i], mp.terreno[e], 'terreno asimétrico, semilla ' + s);
      assert.strictEqual(mp.mineral[i], mp.mineral[e], 'mineral asimétrico, semilla ' + s);
    }
    const paso = Uint8Array.from(mp.terreno, (t) => (t === 0 || t === 3 ? 1 : 0));
    const [A, B] = mp.bases;
    assert.ok(ruta(paso, mp.terreno, A.x, A.y, B.x + 0.5, B.y + 0.5, 0), 'bases sin conexión, semilla ' + s);
    let cerca = 0, total = 0, raros = 0;
    for (let i = 0; i < N * N; i++) {
      if (mp.tipoMin[i] === 1) { total++; if (Math.hypot((i % N) - A.x, ((i / N) | 0) - A.y) < 18) cerca++; }
      if (mp.tipoMin[i] === 2) raros++;
    }
    assert.ok(cerca >= 8, 'sin campo junto a la base, semilla ' + s + ' (' + cerca + ')');
    assert.ok(total >= 120, 'pocos minerales, semilla ' + s + ' (' + total + ')');
    assert.ok(raros >= 4, 'sin minerales raros, semilla ' + s);
    assert.ok(mp.sitios.filter((x) => x.tipo === 'petroleo').length >= 4, 'poco petróleo, semilla ' + s);
    assert.ok(mp.sitios.filter((x) => x.tipo === 'conocimiento').length >= 2, 'sin conocimiento, semilla ' + s);
    let agua = false;
    for (let dy = -12; dy <= 12 && !agua; dy++) for (let dx = -12; dx <= 12; dx++) if (mp.terreno[(A.y + dy) * N + A.x + dx] === 2) { agua = true; break; }
    assert.ok(agua, 'sin agua junto a la base, semilla ' + s);
  }
});

prueba('ruta: rodea obstáculos y detecta lo inalcanzable', () => {
  const ruta = W.crearRuta(N), paso = new Uint8Array(N * N).fill(1), terr = new Uint8Array(N * N);
  for (let y = 0; y < 20; y++) paso[y * N + 10] = 0; // muro con hueco en y=20
  const r = ruta(paso, terr, 5, 5, 15.5, 5.5, 0);
  assert.ok(r && r.length > 20, 'no rodeó el muro');
  for (const c of r) assert.ok(paso[c]);
  for (let y = 0; y < N; y++) paso[y * N + 10] = 0;
  assert.strictEqual(ruta(paso, terr, 5, 5, 15.5, 5.5, 0), null);
  assert.deepStrictEqual(ruta(paso, terr, 5, 5, 5.5, 5.5, 0), []);
});

prueba('economía: construir, colocar, cosechar', () => {
  const m = W.crearMundo(12345), ia = W.iaCrear(0);
  const avanza = (n) => { for (let i = 0; i < n; i++) W.tick(m); };
  const patio = m.ents.find((e) => e.j === 0 && e.tipo === 'patio');
  assert.ok(patio);
  W.orden(m, { t: 'construir', j: 0, tipo: 'fabrica' }); avanza(1);
  assert.strictEqual(m.jug[0].obras.length, 0, 'aceptó un edificio sin prerrequisito');
  W.orden(m, { t: 'construir', j: 0, tipo: 'central' }); avanza(1);
  assert.ok(m.jug[0].minerales >= 2200 && m.jug[0].minerales <= 2202, 'no descontó el costo');
  avanza(W.EDIF.central.tiempo);
  assert.ok(m.jug[0].obras[0].listo);
  W.orden(m, { t: 'colocar', j: 0, tipo: 'central', x: patio.x, y: patio.y }); avanza(1);
  assert.strictEqual(m.jug[0].obras.length, 1, 'colocó encima del patio');
  W.orden(m, { t: 'colocar', j: 0, tipo: 'central', x: patio.x + 4, y: patio.y }); avanza(1);
  assert.strictEqual(m.jug[0].obras.length, 0);
  assert.strictEqual(m.jug[0].cuenta.central, 1);
  assert.strictEqual(m.jug[0].prod, 100);
  // el resto lo levanta la IA con los mismos comandos
  const antes = m.jug[0].cosechado;
  for (let i = 0; i < 3000; i++) { W.iaTick(m, ia); W.tick(m); }
  assert.ok(m.jug[0].cuenta.refineria >= 1, 'sin refinería');
  assert.ok(m.jug[0].cosechado > antes + 1000, 'no cosechó: ' + m.jug[0].cosechado);
});

prueba('obras en cola: una tras otra, y se cancelan con reembolso', () => {
  const m = W.crearMundo(4242), J = m.jug[0], T = W.EDIF.central.tiempo, T2 = W.EDIF.cuartel.tiempo;
  const avanza = (n) => { for (let i = 0; i < n; i++) W.tick(m); };
  J.minerales = 5000;
  W.orden(m, { t: 'construir', j: 0, tipo: 'central' }); avanza(T + 2);
  assert.ok(J.obras[0].listo);
  W.orden(m, { t: 'colocar', j: 0, tipo: 'central', x: m.mapa.bases[0].x + 3, y: m.mapa.bases[0].y - 1 }); avanza(1);
  assert.strictEqual(J.cuenta.central, 1);
  W.orden(m, { t: 'construir', j: 0, tipo: 'central' }); W.orden(m, { t: 'construir', j: 0, tipo: 'cuartel' }); avanza(T + 2);
  assert.strictEqual(J.obras.length, 2);
  assert.ok(J.obras[0].listo, 'la primera de la cola va a ritmo pleno');
  assert.ok(J.obras[1].prog <= 2, 'la segunda debía esperar su turno: ' + J.obras[1].prog);
  avanza(T2);
  assert.ok(J.obras[1].listo, 'al terminar la primera, sigue la segunda');
  W.orden(m, { t: 'construir', j: 0, tipo: 'cuartel' }); avanza(5);
  const antes = J.minerales;
  W.orden(m, { t: 'cancelarEdif', j: 0, tipo: 'cuartel' }); avanza(1);
  assert.strictEqual(J.obras.length, 2);
  assert.ok(J.obras.every((o) => o.listo), 'debía cancelarse la que seguía en curso');
  assert.ok(J.minerales >= antes + W.EDIF.cuartel.costo, 'cancelar no devolvió el costo');
});

prueba('contraataque, disparo en marcha, curación y atropello', () => {
  const nuevo = () => { const m = W.crearMundo(4242, { N: 128 }); m.ents.filter((e) => !e.edif).forEach((e) => { e.vida = 0; }); W.tick(m); return m; };
  const avanza = (m, n) => { for (let i = 0; i < n; i++) W.tick(m); };
  // Campo abierto para las pruebas: se limpia una franja del mapa.
  const franja = (m) => { const N = m.N; for (let y = 56; y < 72; y++) for (let x = 30; x < 100; x++) { const i = y * N + x; if (!m.ocup[i]) { m.mapa.terreno[i] = 0; m.paso[i] = 1; } } };
  const en = (m, x, y) => y * m.N + x;

  // disparo en marcha: un tanque que solo se mueve hiere al enemigo que le queda a tiro
  let m = nuevo(); franja(m);
  let t = W.crearUnidad(m, 0, 'tanque', en(m, 40, 64)), r = W.crearUnidad(m, 1, 'tanque', en(m, 50, 67));
  r.orden = 'mover'; r.ruta = null; // rival pasivo para aislar el efecto
  W.orden(m, { t: 'mover', j: 0, ids: [t.id], x: 56.5, y: 64.5 }); avanza(m, 260);
  assert.ok(r.vida < r.vidaMax, 'el tanque en marcha no disparó');
  assert.ok(Math.hypot(t.x - 56.5, t.y - 64.5) < 2, 'el tanque debía cumplir su orden de mover');

  // contraataque en grupo: hieren a uno y el compañero ocioso cercano también va por el agresor
  m = nuevo(); franja(m);
  const a = W.crearUnidad(m, 0, 'tanque', en(m, 40, 62)), b = W.crearUnidad(m, 0, 'tanque', en(m, 40, 66));
  const lejos = W.crearUnidad(m, 0, 'tanque', en(m, 34, 70));
  const torre = W.crearEdificio(m, 1, 'torreta', 46, 61); m.jug[1].dios = true; // a 6: alcanza a "a" pero no a "b"
  a.obj = 0; avanza(m, 40);
  assert.ok(a.vida < a.vidaMax, 'la torreta debía herir al primero');
  assert.strictEqual(b.obj, torre.id, 'el compañero cercano no acudió');
  avanza(m, 800);
  assert.ok(!m.porId.has(torre.id), 'entre todos debían destruir al agresor');
  assert.ok(lejos.vida === lejos.vidaMax);

  // curación: cerca del cuartel la infantería herida se recupera; lejos, no
  m = nuevo(); franja(m);
  W.crearEdificio(m, 0, 'cuartel', 40, 62);
  const cerca = W.crearUnidad(m, 0, 'infanteria', en(m, 43, 63)), aparte = W.crearUnidad(m, 0, 'infanteria', en(m, 70, 63));
  cerca.vida = 20; aparte.vida = 20;
  m.jug[0].minerales = 0; m.t = 5; avanza(m, 195); // el goteo del patio da algo, pero casi nada: apenas cura
  const pobre = cerca.vida;
  m.jug[0].minerales = 1000; avanza(m, 600);
  assert.strictEqual(cerca.vida, 60, 'no se curó junto al cuartel: ' + cerca.vida);
  assert.ok(pobre < 60, 'sin minerales no debía curarse del todo');
  const gasto = 1000 + 600 / W.ECON.goteoCada - m.jug[0].minerales, justo = (40 / 60) * W.UNID.infanteria.costo * W.ECON.curaCosto;
  assert.ok(gasto > 0 && gasto <= justo + 0.01, 'la curación debía costar poco: ' + gasto.toFixed(2) + ' (tope ' + justo.toFixed(2) + ')');
  assert.strictEqual(aparte.vida, 20, 'se curó lejos de todo edificio');
  // los edificios se reparan solos tras un rato sin recibir daño
  const cu = m.ents.find((e) => e.tipo === 'cuartel'); cu.vida = 300; cu.tDano = m.t; avanza(m, 250);
  assert.strictEqual(cu.vida, 300, 'se reparó sin esperar'); avanza(m, 400);
  assert.ok(cu.vida > 300, 'el edificio no se reparó');

  // atropello: un tanque en marcha aplasta a la infantería enemiga
  m = nuevo(); franja(m);
  t = W.crearUnidad(m, 0, 'tanque', en(m, 40, 64));
  const victima = W.crearUnidad(m, 1, 'infanteria', en(m, 46, 64)), amigo = W.crearUnidad(m, 0, 'infanteria', en(m, 44, 64));
  W.orden(m, { t: 'mover', j: 0, ids: [t.id], x: 52.5, y: 64.5 });
  let herida = false;
  for (let i = 0; i < 110; i++) { W.tick(m); if (m.porId.has(victima.id) && victima.vida < 30 && victima.vida > 0) herida = true; }
  assert.ok(herida, 'el atropello no debía matar de un solo golpe');
  assert.ok(!m.porId.has(victima.id) && m.jug[0].aplastados === 1, 'pasarle por encima de lleno debía matarla');
  assert.ok(m.porId.has(amigo.id), 'aplastó a su propia infantería');
});

prueba('varios edificios productivos aceleran la cola, con tope', () => {
  assert.deepStrictEqual([0, 1, 2, 3, 4, 5, 9].map(W.ritmo), [0, 1, 1.5, 2, 2.5, 2.5, 2.5]);
  const tiempoCon = (cuarteles) => {
    const m = W.crearMundo(4242), J = m.jug[0], b = m.mapa.bases[0];
    J.dios = true;
    W.crearEdificio(m, 0, 'central', b.x + 3, b.y - 1);
    for (let k = 0; k < cuarteles; k++) W.crearEdificio(m, 0, 'cuartel', b.x - 5 + k * 3, b.y - 6);
    W.tick(m);
    const antes = J.cuenta.infanteria;
    W.orden(m, { t: 'entrenar', j: 0, tipo: 'infanteria' });
    let n = 0;
    while ((J.cuenta.infanteria || 0) === antes && n < 1000) { W.tick(m); n++; }
    return n;
  };
  const t1 = tiempoCon(1), t2 = tiempoCon(2), t6 = tiempoCon(6);
  assert.ok(Math.abs(t1 - W.UNID.infanteria.tiempo) <= 3, 'un cuartel: ' + t1);
  assert.ok(Math.abs(t2 - t1 / 1.5) <= 3, 'dos cuarteles: ' + t2);
  assert.ok(Math.abs(t6 - t1 / 2.5) <= 3, 'seis cuarteles (tope): ' + t6);
});

prueba('tamaños de mapa: 128, 256 y 1024 se generan simétricos y conectados', () => {
  for (const lado of [128, 256, 1024]) {
    const mp = W.generarMapa(2026, lado), NN = lado * lado;
    assert.strictEqual(mp.N, lado);
    for (let i = 0; i < NN; i += 7) assert.strictEqual(mp.terreno[i], mp.terreno[NN - 1 - i], 'asimétrico en ' + lado);
    const [A, B] = mp.bases;
    assert.ok(mp.alcanzable[B.y * lado + B.x], 'bases sin conexión en ' + lado);
    assert.ok(mp.sitios.length >= 4, 'sin sitios en ' + lado);
  }
  const m = W.crearMundo(5, { N: 128, inicio: 5000 });
  assert.strictEqual(m.N, 128); assert.strictEqual(m.jug[0].minerales, 5000);
  const a = W.iaCrear(0), b = W.iaCrear(1, 'agresivo');
  for (let i = 0; i < 6000; i++) { W.iaTick(m, a); W.iaTick(m, b); W.tick(m); }
  assert.ok(m.jug[0].cosechado > 1000 && m.jug[1].cosechado > 1000, 'economía parada en mapa de 128');
});

prueba('órdenes encadenadas, patrulla, exploración y punto de reunión', () => {
  const m = W.crearMundo(4242, { N: 128 }), J = m.jug[0], b = m.mapa.bases[0];
  const avanza = (n) => { for (let i = 0; i < n; i++) W.tick(m); };
  const u = m.ents.find((e) => e.j === 0 && e.tipo === 'infanteria');
  const cerca = (x, y) => Math.hypot(u.x - x, u.y - y) < 1.6;
  const p1 = { x: b.x + 6.5, y: b.y - 4.5 }, p2 = { x: b.x + 6.5, y: b.y - 8.5 }, p3 = { x: b.x + 2.5, y: b.y - 8.5 };
  // encadenadas: pasa por p1, luego p2, y termina en p3
  W.orden(m, { t: 'mover', j: 0, ids: [u.id], x: p1.x, y: p1.y });
  W.orden(m, { t: 'mover', j: 0, ids: [u.id], x: p2.x, y: p2.y, enc: true });
  W.orden(m, { t: 'mover', j: 0, ids: [u.id], x: p3.x, y: p3.y, enc: true });
  avanza(2);
  assert.strictEqual(u.cola.length, 2);
  let paso1 = false, paso2 = false;
  for (let i = 0; i < 600 && !(u.orden === 'nada' && !u.cola.length); i++) { W.tick(m); if (cerca(p1.x, p1.y)) paso1 = true; if (paso1 && cerca(p2.x, p2.y)) paso2 = true; }
  assert.ok(paso1 && paso2 && cerca(p3.x, p3.y), 'no siguió la cadena de puntos');
  // una orden sin encadenar borra la cola
  W.orden(m, { t: 'mover', j: 0, ids: [u.id], x: p1.x, y: p1.y });
  W.orden(m, { t: 'mover', j: 0, ids: [u.id], x: p2.x, y: p2.y, enc: true });
  W.orden(m, { t: 'mover', j: 0, ids: [u.id], x: p3.x, y: p3.y });
  avanza(2);
  assert.strictEqual(u.cola.length, 0);
  avanza(300);
  // patrulla: va y vuelve sin parar
  const ini = { x: u.x, y: u.y };
  W.orden(m, { t: 'patrulla', j: 0, ids: [u.id], x: p1.x, y: p1.y });
  let ida = false, vuelta = false, otraIda = false;
  for (let i = 0; i < 1500; i++) { W.tick(m); if (cerca(p1.x, p1.y)) { if (vuelta) otraIda = true; ida = true; } if (ida && cerca(ini.x, ini.y)) vuelta = true; }
  assert.ok(ida && vuelta && otraIda, 'la patrulla no va y vuelve');
  W.orden(m, { t: 'detener', j: 0, ids: [u.id] }); avanza(2);
  assert.strictEqual(u.patrulla, null);
  // exploración: la zona vista crece sola
  const vistas = () => m.niebla[0].reduce((a, v) => a + (v ? 1 : 0), 0);
  const antes = vistas();
  W.orden(m, { t: 'explorar', j: 0, ids: [u.id] }); avanza(1500);
  assert.ok(u.explora && vistas() > antes * 1.5, 'explorar no descubre mapa: ' + antes + ' -> ' + vistas());
  // punto de reunión
  J.dios = true;
  W.crearEdificio(m, 0, 'central', b.x + 3, b.y - 1);
  const cu = W.crearEdificio(m, 0, 'cuartel', b.x - 5, b.y - 6);
  avanza(1);
  const r = { x: b.x + 8.5, y: b.y + 0.5 };
  W.orden(m, { t: 'reunion', j: 0, id: cu.id, x: r.x, y: r.y });
  W.orden(m, { t: 'entrenar', j: 0, tipo: 'infanteria' });
  const ids = new Set(m.ents.map((e) => e.id));
  avanza(W.UNID.infanteria.tiempo + 400);
  const nueva = m.ents.find((e) => !ids.has(e.id) && e.tipo === 'infanteria');
  assert.ok(nueva && Math.hypot(nueva.x - r.x, nueva.y - r.y) < 2.5, 'la unidad nueva no fue al punto de reunión');
});

prueba('fase 1: petróleo, agua, información y minerales raros', () => {
  const m = W.crearMundo(4242, { N: 128 }), J = m.jug[0], b = m.mapa.bases[0], N = m.N;
  const avanza = (n) => { for (let i = 0; i < n; i++) W.tick(m); };
  const sitio = (tipo) => m.mapa.sitios.filter((s) => s.tipo === tipo).sort((p, q) => Math.hypot(p.x - b.x, p.y - b.y) - Math.hypot(q.x - b.x, q.y - b.y))[0];
  const pet = sitio('petroleo'), con = sitio('conocimiento');
  // colocación: sobre el yacimiento, y solo si está explorado
  assert.ok(!W.puedeColocar(m, 0, 'central', pet.x, pet.y), 'un edificio normal no puede tapar un yacimiento');
  assert.ok(!W.puedeColocar(m, 0, 'extractor', b.x + 4, b.y), 'extractor fuera de yacimiento');
  m.niebla[0].fill(0); W.actualizarNiebla(m);
  if (!m.niebla[0][pet.y * N + pet.x]) assert.ok(!W.puedeColocar(m, 0, 'extractor', pet.x, pet.y), 'extractor en terreno sin explorar');
  m.niebla[0].fill(1);
  assert.ok(W.puedeColocar(m, 0, 'extractor', pet.x, pet.y), 'extractor sobre yacimiento explorado, lejos de la base');
  assert.ok(W.puedeColocar(m, 0, 'estacion', con.x, con.y), 'estación sobre campo de conocimiento');
  assert.ok(!W.puedeColocar(m, 0, 'estacion', pet.x, pet.y), 'estación sobre petróleo');
  // bomba: solo junto al agua
  let conAgua = null, sinAgua = null;
  for (let y = 4; y < N - 4 && !(conAgua && sinAgua); y++) for (let x = 4; x < N - 4; x++) {
    if (!conAgua && W.puedeColocar(m, 0, 'bomba', x, y)) conAgua = { x, y };
    if (!sinAgua && !W.puedeColocar(m, 0, 'bomba', x, y) && W.puedeColocar(m, 0, 'extractor', pet.x, pet.y) && m.mapa.terreno[y * N + x] === 0 && lejosDeAgua(m, x, y)) sinAgua = { x, y };
  }
  assert.ok(conAgua, 'ningún sitio válido para la bomba');
  assert.ok(sinAgua, 'la bomba se deja colocar lejos del agua');
  // extracción continua
  W.crearEdificio(m, 0, 'central', b.x + 3, b.y - 1); W.crearEdificio(m, 0, 'central', b.x + 3, b.y + 2);
  W.crearEdificio(m, 0, 'extractor', pet.x, pet.y); W.crearEdificio(m, 0, 'estacion', con.x, con.y);
  const p0 = J.petroleo; avanza(600);
  assert.strictEqual(J.petroleo - p0, 600 / W.EDIF.extractor.da.cada, 'ritmo de petróleo');
  assert.strictEqual(J.info, 600 / W.EDIF.estacion.da.cada, 'ritmo de información');
  // costos en petróleo
  W.crearEdificio(m, 0, 'refineria', b.x - 6, b.y - 6); W.crearEdificio(m, 0, 'fabrica', b.x - 6, b.y + 3); W.crearEdificio(m, 0, 'cuartel', b.x + 6, b.y - 4);
  J.minerales = 5000; J.petroleo = 40; avanza(1);
  W.orden(m, { t: 'entrenar', j: 0, tipo: 'tanque' }); avanza(1);
  assert.strictEqual(J.colas.veh.lista.length, 0, 'aceptó un tanque sin petróleo');
  J.petroleo = 60; W.orden(m, { t: 'entrenar', j: 0, tipo: 'tanque' }); avanza(1);
  assert.strictEqual(J.colas.veh.lista.length, 1); assert.ok(J.petroleo < 20, 'no cobró el petróleo');
  W.orden(m, { t: 'cancelarUnidad', j: 0, tipo: 'tanque' }); avanza(1);
  assert.ok(J.petroleo >= 60, 'cancelar no devolvió el petróleo');
  // agua: el patio sostiene 8; al llenarse, la cola espera hasta que haya una bomba
  assert.strictEqual(J.aguaProd, 8);
  for (let k = 0; k < 9; k++) W.orden(m, { t: 'entrenar', j: 0, tipo: 'infanteria' });
  avanza(W.UNID.infanteria.tiempo * 10);
  assert.strictEqual(J.aguaUso, 8, 'la tropa pasó del agua disponible: ' + J.aguaUso);
  assert.ok(J.colas.inf.sinAgua && J.colas.inf.lista.length > 0, 'la cola debía quedar esperando agua');
  W.crearEdificio(m, 0, 'bomba', conAgua.x, conAgua.y); avanza(W.UNID.infanteria.tiempo * 4);
  assert.ok(J.aguaUso > 8 && J.aguaProd === 20, 'con bomba la tropa debía crecer');
  // minerales raros: la cosechadora señalada a una veta trae raros
  const cos = m.ents.find((e) => e.j === 0 && e.tipo === 'cosechadora') || W.crearUnidad(m, 0, 'cosechadora', W.cercaLibre(m, b.x - 4, b.y - 2));
  assert.ok(m.raros.length > 0);
  const veta = m.raros[0];
  W.orden(m, { t: 'cosechar', j: 0, ids: [cos.id], x: (veta % N) + 0.5, y: ((veta / N) | 0) + 0.5 });
  for (let i = 0; i < 6000 && J.raros === 0; i++) W.tick(m);
  assert.ok(J.raros > 0, 'la cosechadora no trajo minerales raros');
});
function lejosDeAgua(m, x, y) {
  for (let dy = -3; dy <= 4; dy++) for (let dx = -3; dx <= 4; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < m.N && yy < m.N && m.mapa.terreno[yy * m.N + xx] === 2) return false; }
  return true;
}

prueba('determinismo: misma semilla, misma partida', () => {
  const corre = () => {
    const m = W.crearMundo(777), a = W.iaCrear(0), b = W.iaCrear(1);
    for (let i = 0; i < 4000; i++) { W.iaTick(m, a); W.iaTick(m, b); W.tick(m); }
    return W.huella(m);
  };
  assert.strictEqual(corre(), corre());
});

prueba('partidas completas IA contra IA', () => {
  const LIMITE = 20 * 60 * 90; // 90 minutos de juego
  let conGanador = 0;
  for (const s of [3, 101, 2026, 555]) {
    const m = W.crearMundo(s), a = W.iaCrear(0), b = W.iaCrear(1);
    const t0 = Date.now();
    let maxEnts = 0;
    while (m.ganador < 0 && m.t < LIMITE) { W.iaTick(m, a); W.iaTick(m, b); W.tick(m); if (m.ents.length > maxEnts) maxEnts = m.ents.length; }
    const [J0, J1] = m.jug;
    console.log(`      semilla ${s}: ganador ${m.ganador} en ${(m.t / 1200).toFixed(1)} min de juego · cosechado ${J0.cosechado}/${J1.cosechado} · producidas ${J0.producidas}/${J1.producidas} · bajas ${J0.bajas}/${J1.bajas} · petróleo ${J0.extraido}/${J1.extraido} · info ${J0.info}/${J1.info} · máx entidades ${maxEnts} · ${(Date.now() - t0)} ms (${((Date.now() - t0) / m.t).toFixed(3)} ms/tick)`);
    for (const J of [J0, J1]) {
      assert.ok(J.cosechado > 3000, 'economía parada, semilla ' + s);
      assert.ok(J.producidas > 8, 'sin producción, semilla ' + s);
      assert.ok(J.extraido > 0, 'la IA no extrajo petróleo, semilla ' + s);
    }
    assert.ok(J0.bajas + J1.bajas > 5, 'sin combate, semilla ' + s);
    if (m.ganador >= 0) conGanador++;
  }
  assert.ok(conGanador >= 2, 'pocas partidas terminan: ' + conGanador);
});

console.log(ok + ' pruebas correctas');
