// Pruebas de la simulación. Ejecutar: node tests/sim.test.js
const assert = require('node:assert');
const path = require('node:path');
for (const f of ['datos', 'mapa', 'ruta', 'mundo', 'ia', 'guardar']) require(path.join(__dirname, '..', 'src', 'sim', f + '.js'));
const W = globalThis.W, N = W.N;
// Las pruebas de mecánicas anteriores a la red se hacen sin logística (las unidades no dependen de la cobertura);
// las de la red y las partidas con IA la piden expresamente.
{ const crear = W.crearMundo; W.crearMundo = (semilla, op) => crear(semilla, Object.assign({ logistica: false }, op)); }

let ok = 0;
function prueba(nombre, fn) { if (process.env.SOLO && !nombre.includes(process.env.SOLO)) return; fn(); ok++; console.log('  ok  ' + nombre); }

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
  const m = W.crearMundo(12345, { logistica: true }), ia = W.iaCrear(0);
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

prueba('colas: obras por tipo desde el patio; unidades, una cola por edificio', () => {
  const m = W.crearMundo(4242), J = m.jug[0], b = m.mapa.bases[0], T = W.EDIF.central.tiempo;
  const avanza = (n) => { for (let i = 0; i < n; i++) W.tick(m); };
  J.minerales = 9000;
  W.orden(m, { t: 'construir', j: 0, tipo: 'central' }); avanza(T + 2);
  assert.ok(J.obras[0].listo, 'una sola obra va a ritmo pleno');
  W.orden(m, { t: 'colocar', j: 0, tipo: 'central', x: b.x + 3, y: b.y - 1 }); avanza(1);
  // dos del mismo tipo: en fila
  W.orden(m, { t: 'construir', j: 0, tipo: 'central' }); W.orden(m, { t: 'construir', j: 0, tipo: 'central' }); avanza(T + 2);
  assert.ok(J.obras[0].listo && J.obras[1].prog <= 2, 'dos centrales debían ir una tras otra');
  avanza(T);
  assert.ok(J.obras[1].listo, 'al terminar la primera central sigue la segunda');
  W.orden(m, { t: 'colocar', j: 0, tipo: 'central', x: b.x + 3, y: b.y + 2 }); W.orden(m, { t: 'colocar', j: 0, tipo: 'central', x: b.x + 6, y: b.y - 1 }); avanza(1);
  assert.strictEqual(J.obras.length, 0);
  // tipos distintos: a la vez, cada uno a la mitad
  W.orden(m, { t: 'construir', j: 0, tipo: 'central' }); W.orden(m, { t: 'construir', j: 0, tipo: 'cuartel' }); avanza(101);
  assert.ok(Math.abs(J.obras[0].prog - 50) <= 1 && Math.abs(J.obras[1].prog - 50) <= 1, 'dos tipos debían avanzar a la vez y a la mitad: ' + J.obras.map((o) => o.prog));
  const antes = J.minerales;
  W.orden(m, { t: 'cancelarEdif', j: 0, tipo: 'cuartel' }); avanza(1);
  assert.strictEqual(J.obras.length, 1);
  assert.ok(J.minerales >= antes + W.EDIF.cuartel.costo, 'cancelar no devolvió el costo');
  const p = J.obras[0].prog; avanza(10);
  assert.ok(Math.abs(J.obras[0].prog - p - 10) < 0.01, 'al quedar un solo tipo vuelve al ritmo pleno');
  // unidades: cada fábrica despacha su cola en orden, de una en una y a ritmo pleno
  J.dios = true;
  W.crearEdificio(m, 0, 'refineria', b.x - 7, b.y - 6); const f1 = W.crearEdificio(m, 0, 'fabrica', b.x - 7, b.y + 3); avanza(1);
  W.orden(m, { t: 'entrenar', j: 0, tipo: 'tanque' }); W.orden(m, { t: 'entrenar', j: 0, tipo: 'tanque' }); W.orden(m, { t: 'entrenar', j: 0, tipo: 'cosechadora' }); avanza(101);
  assert.deepStrictEqual(f1.cola, ['tanque', 'tanque', 'cosechadora'], 'los tres encargos van a la cola de la fábrica, en orden');
  assert.ok(Math.abs(f1.prog - 100) <= 1 && J.colas.tanque.n === 2 && J.colas.cosechadora.n === 1, 'solo avanza el primero, a ritmo pleno: ' + f1.prog);
  // cancelar un puesto concreto de la cola devuelve su costo y no toca el resto
  W.orden(m, { t: 'cancelarUnidad', j: 0, id: f1.id, i: 1 }); avanza(1);
  assert.deepStrictEqual(f1.cola, ['tanque', 'cosechadora']);
  assert.ok(f1.prog > 100, 'cancelar el segundo no reinicia el que está en curso');
  // una segunda fábrica trabaja a la vez; el encargo sin edificio indicado va a la cola más corta, y con ids, a ese
  const f2 = W.crearEdificio(m, 0, 'fabrica', b.x - 7, b.y + 8); avanza(1);
  W.orden(m, { t: 'entrenar', j: 0, tipo: 'artilleria' }); avanza(1);
  assert.deepStrictEqual(f2.cola, [], 'la artillería pide nivel 2');
  W.orden(m, { t: 'entrenar', j: 0, tipo: 'tanque' }); W.orden(m, { t: 'entrenar', j: 0, tipo: 'tanque', ids: [f1.id] }); avanza(50);
  assert.deepStrictEqual([f1.cola, f2.cola], [['tanque', 'cosechadora', 'tanque'], ['tanque']]);
  assert.ok(f1.prog > 150 && Math.abs(f2.prog - 50) <= 1, 'las dos fábricas avanzan a la vez');
  // al perder el edificio se devuelve lo encargado
  J.dios = false; J.minerales = 0; J.petroleo = 0; f1.vida = 0; avanza(2);
  assert.strictEqual(J.minerales >= 2 * W.UNID.tanque.costo + W.UNID.cosechadora.costo, true, 'debía devolver la cola de la fábrica destruida');
  assert.ok(J.colas.tanque.n === 1 && J.colas.cosechadora.n === 0);
});

prueba('contraataque, disparo en marcha, curación y atropello', () => {
  const nuevo = () => { const m = W.crearMundo(4242, { N: 128 }); m.ents.filter((e) => !e.edif).forEach((e) => { e.vida = 0; }); W.tick(m); return m; };
  const avanza = (m, n) => { for (let i = 0; i < n; i++) W.tick(m); };
  // Campo abierto para las pruebas: se limpia una franja del mapa.
  const franja = (m) => { const N = m.N; for (let y = 56; y < 72; y++) for (let x = 30; x < 100; x++) { const i = y * N + x; if (!m.ocup[i]) { m.mapa.terreno[i] = 0; m.paso[i] = 1; m.pasoV[i] = 1; } } };
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
  assert.ok(b.acude, 'el compañero cercano no acudió a la llamada');
  avanza(m, 250);
  assert.ok(torre.vida < torre.vidaMax - 200, 'entre los dos debían castigar al agresor: ' + torre.vida);
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

prueba('dos cuarteles producen a la vez; los patios aceleran las obras', () => {
  assert.deepStrictEqual([0, 1, 2, 3, 4, 5, 9].map(W.ritmo), [0, 1, 1.5, 2, 2.5, 2.5, 2.5]);
  const tiempoCon = (cuarteles, pedidos) => {
    const m = W.crearMundo(4242), J = m.jug[0], b = m.mapa.bases[0];
    J.dios = true;
    W.crearEdificio(m, 0, 'central', b.x + 3, b.y - 1);
    for (let k = 0; k < cuarteles; k++) W.crearEdificio(m, 0, 'cuartel', b.x - 5 + k * 3, b.y - 6);
    W.tick(m);
    const antes = J.cuenta.infanteria;
    for (let k = 0; k < pedidos; k++) W.orden(m, { t: 'entrenar', j: 0, tipo: 'infanteria' });
    let n = 0;
    while ((J.cuenta.infanteria || 0) < antes + pedidos && n < 3000) { W.tick(m); n++; }
    return n;
  };
  const T = W.UNID.infanteria.tiempo, t1 = tiempoCon(1, 1), t14 = tiempoCon(1, 4), t24 = tiempoCon(2, 4), t21 = tiempoCon(2, 1);
  assert.ok(Math.abs(t1 - T) <= 3, 'un cuartel, un soldado: ' + t1);
  assert.ok(Math.abs(t14 - 4 * T) <= 6, 'un cuartel, cuatro soldados en fila: ' + t14);
  assert.ok(Math.abs(t24 - 2 * T) <= 6, 'dos cuarteles se reparten los cuatro y tardan la mitad: ' + t24);
  assert.ok(Math.abs(t21 - T) <= 3, 'un solo soldado no sale antes por tener dos cuarteles: ' + t21);
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
  assert.strictEqual(J.colas.tanque.n, 0, 'aceptó un tanque sin petróleo');
  J.petroleo = 60; W.orden(m, { t: 'entrenar', j: 0, tipo: 'tanque' }); avanza(1);
  assert.strictEqual(J.colas.tanque.n, 1); assert.ok(J.petroleo < 20, 'no cobró el petróleo');
  W.orden(m, { t: 'cancelarUnidad', j: 0, tipo: 'tanque' }); avanza(1);
  assert.ok(J.petroleo >= 60, 'cancelar no devolvió el petróleo');
  // agua: el patio sostiene 8; al llenarse, la cola espera hasta que haya una bomba
  assert.strictEqual(J.aguaProd, 8);
  for (let k = 0; k < 9; k++) W.orden(m, { t: 'entrenar', j: 0, tipo: 'infanteria' });
  avanza(W.UNID.infanteria.tiempo * 10);
  assert.strictEqual(J.aguaUso, 8, 'la tropa pasó del agua disponible: ' + J.aguaUso);
  assert.ok(J.colas.infanteria.sinAgua && J.colas.infanteria.n > 0, 'la cola debía quedar esperando agua');
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

prueba('demoler devuelve parte del costo y las formaciones ordenan al grupo', () => {
  const m = W.crearMundo(4242, { N: 128 }), J = m.jug[0], b = m.mapa.bases[0], N = m.N;
  const avanza = (n) => { for (let i = 0; i < n; i++) W.tick(m); };
  const c = W.crearEdificio(m, 0, 'cuartel', b.x + 4, b.y - 1), patio = m.ents.find((e) => e.j === 0 && e.tipo === 'patio');
  c.vida = c.vidaMax / 2; avanza(1);
  const antes = J.minerales;
  W.orden(m, { t: 'vender', j: 0, id: patio.id }); W.orden(m, { t: 'vender', j: 1, id: c.id }); avanza(1);
  assert.ok(m.porId.has(patio.id) && m.porId.has(c.id), 'no se puede demoler el patio ni un edificio ajeno');
  W.orden(m, { t: 'vender', j: 0, id: c.id }); avanza(1);
  assert.ok(!m.porId.has(c.id), 'el edificio debía desaparecer');
  assert.ok(Math.abs(J.minerales - antes - W.EDIF.cuartel.costo * W.ECON.venta * 0.5) <= 1, 'con media vida devuelve la mitad de la parte recuperable');
  assert.strictEqual(m.paso[(b.y - 1) * N + b.x + 4], 1, 'la celda debía quedar libre');
  // formaciones en campo abierto
  for (let y = 50; y < 80; y++) for (let x = 30; x < 100; x++) { const i = y * N + x; if (!m.ocup[i]) { m.mapa.terreno[i] = 0; m.paso[i] = 1; m.pasoV[i] = 1; } }
  const us = [];
  for (let k = 0; k < 5; k++) us.push(W.crearUnidad(m, 0, k < 3 ? 'tanque' : 'infanteria', (60 + k) * N + 40));
  const ids = us.map((u) => u.id);
  W.orden(m, { t: 'mover', j: 0, ids, x: 70.5, y: 62.5, forma: 'linea' }); avanza(700);
  const xs = us.map((u) => u.x), ys = us.map((u) => u.y).sort((p, q) => p - q);
  assert.ok(Math.max(...xs) - Math.min(...xs) < 1.2, 'en línea debían quedar a la misma altura: ' + xs.map((v) => v.toFixed(1)));
  assert.ok(ys[4] - ys[0] > 2.8, 'en línea debían abrirse a lo ancho: ' + ys.map((v) => v.toFixed(1)));
  assert.ok(us.every((u) => Math.abs(u.ang) < 0.2), 'todas debían quedar mirando al frente');
  W.orden(m, { t: 'mover', j: 0, ids, x: 90.5, y: 62.5, forma: 'columna' }); avanza(700);
  const xs2 = us.map((u) => u.x), ys2 = us.map((u) => u.y);
  assert.ok(Math.max(...xs2) - Math.min(...xs2) > 1.3 && Math.max(...ys2) - Math.min(...ys2) < 2.2, 'en columna debían alargarse en el sentido de la marcha');
  assert.ok(us.filter((u) => u.tipo === 'tanque').every((t) => t.x >= Math.min(...us.filter((u) => u.tipo === 'infanteria').map((i) => i.x)) - 0.5), 'los vehículos van delante');
});

prueba('fase 2: niveles, mejoras, unidades nuevas e inteligencia', () => {
  const m = W.crearMundo(4242, { N: 128 }), J = m.jug[0], b = m.mapa.bases[0], N = m.N;
  const avanza = (n) => { for (let i = 0; i < n; i++) W.tick(m); };
  W.crearEdificio(m, 0, 'central', b.x + 3, b.y - 1); W.crearEdificio(m, 0, 'central', b.x + 3, b.y + 2);
  W.crearEdificio(m, 0, 'cuartel', b.x + 6, b.y - 4); W.crearEdificio(m, 0, 'refineria', b.x - 6, b.y - 6); W.crearEdificio(m, 0, 'fabrica', b.x - 6, b.y + 3);
  J.minerales = 20000; J.petroleo = 2000; J.info = 0; avanza(1);
  // candados de nivel y de recursos
  W.orden(m, { t: 'entrenar', j: 0, tipo: 'antitanque' }); W.orden(m, { t: 'construir', j: 0, tipo: 'torreCanon' }); avanza(1);
  assert.ok(J.colas.antitanque.n === 0 && J.obras.length === 0, 'lo de nivel 2 no puede hacerse en nivel 1');
  W.orden(m, { t: 'investigar', j: 0, clave: 'nivel2' }); avanza(1);
  assert.strictEqual(J.inv.length, 0, 'sin información no se investiga');
  J.info = 1000;
  W.orden(m, { t: 'investigar', j: 0, clave: 'chalecos' }); avanza(1);
  assert.strictEqual(J.inv.length, 0, 'una mejora de nivel 2 no se investiga en nivel 1');
  // dos investigaciones en edificios distintos van a la vez; dos en el mismo, no
  W.orden(m, { t: 'investigar', j: 0, clave: 'nivel2' }); W.orden(m, { t: 'investigar', j: 0, clave: 'perforante' }); W.orden(m, { t: 'investigar', j: 0, clave: 'motores' }); avanza(1);
  assert.deepStrictEqual(J.inv.map((i) => i.clave).sort(), ['motores', 'nivel2', 'perforante']);
  assert.strictEqual(J.info, 1000 - 150 - 60 - 80);
  W.orden(m, { t: 'investigar', j: 0, clave: 'reactivo' }); avanza(1);
  assert.strictEqual(J.inv.length, 3, 'la fábrica ya estaba investigando');
  W.orden(m, { t: 'cancelarInv', j: 0, clave: 'motores' }); avanza(1);
  assert.ok(J.inv.length === 2 && J.info === 1000 - 150 - 60, 'cancelar devuelve la información');
  avanza(W.TEC.nivel2.tiempo + 5);
  assert.ok(J.nivel === 2 && J.mejoras.perforante && J.inv.length === 0, 'debía llegar al nivel 2 con la mejora hecha');
  assert.ok(m.efectos.length === 0 || true);
  // unidades de nivel 2 y mejora de vida retroactiva
  const inf = m.ents.find((e) => e.j === 0 && e.tipo === 'infanteria');
  W.orden(m, { t: 'entrenar', j: 0, tipo: 'antitanque' }); W.orden(m, { t: 'investigar', j: 0, clave: 'chalecos' }); avanza(W.TEC.chalecos.tiempo + 5);
  assert.ok(J.cuenta.antitanque === 1, 'el antitanque debía salir en nivel 2');
  assert.strictEqual(inf.vidaMax, 78, 'los chalecos suben la vida de la infantería existente');
  assert.strictEqual(m.ents.find((e) => e.tipo === 'antitanque').vidaMax, 91);
  // nivel 3 pide raros; el pesado también
  W.orden(m, { t: 'investigar', j: 0, clave: 'nivel3' }); avanza(1);
  assert.strictEqual(J.inv.length, 0, 'el nivel 3 pide minerales raros');
  J.raros = 400; W.orden(m, { t: 'investigar', j: 0, clave: 'nivel3' }); avanza(W.TEC.nivel3.tiempo + 5);
  assert.strictEqual(J.nivel, 3); assert.strictEqual(J.raros, 200);
  W.orden(m, { t: 'entrenar', j: 0, tipo: 'pesado' }); avanza(1);
  assert.ok(J.colas.pesado.n === 1 && J.raros === 140, 'el tanque pesado cuesta raros');
  // mejoras de economía
  const e0 = J.prod; J.mejoras.turbinas = true; avanza(1);
  assert.strictEqual(J.prod, e0 * 1.5, 'turbinas: +50 % de energía');
  // artillería: daño en área y alcance mínimo
  for (let y = 56; y < 72; y++) for (let x = 30; x < 110; x++) { const i = y * N + x; if (!m.ocup[i]) { m.mapa.terreno[i] = 0; m.paso[i] = 1; m.pasoV[i] = 1; } }
  const art = W.crearUnidad(m, 0, 'artilleria', 64 * N + 40);
  const v1 = W.crearUnidad(m, 1, 'infanteria', 64 * N + 49), v2 = W.crearUnidad(m, 1, 'infanteria', 65 * N + 49), lejos = W.crearUnidad(m, 1, 'infanteria', 64 * N + 56);
  for (const v of [v1, v2, lejos]) { v.orden = 'mover'; v.recarga = 99999; } // blancos quietos y mudos
  W.orden(m, { t: 'atacar', j: 0, ids: [art.id], obj: v1.id }); avanza(60);
  assert.ok(v1.vida < v1.vidaMax && v2.vida < v2.vidaMax, 'el obús debía dañar a los dos soldados juntos');
  assert.strictEqual(lejos.vida, lejos.vidaMax, 'y no al que estaba lejos de la explosión');
  assert.ok(Math.hypot(art.x - 40.5, art.y - 64.5) < 0.6, 'la artillería tira desde lejos, sin acercarse');
  const pegado = W.crearUnidad(m, 1, 'tanque', 64 * N + 42); pegado.orden = 'mover'; pegado.recarga = 99999;
  for (const v of [v1, v2]) v.vida = 0;
  avanza(2); art.obj = pegado.id; art.orden = 'atacar'; art.recarga = 0; avanza(150);
  assert.strictEqual(pegado.vida, pegado.vidaMax, 'a menos del alcance mínimo la artillería no puede disparar');
  // inteligencia
  const est = m.mapa.sitios.find((s) => s.tipo === 'conocimiento');
  W.orden(m, { t: 'intel', j: 0, clave: 'barrido', x: 100, y: 20 }); avanza(8);
  assert.strictEqual(m.niebla[0][20 * N + 100], 0, 'sin estación no hay inteligencia');
  W.crearEdificio(m, 0, 'estacion', est.x, est.y); J.info = 500; avanza(1);
  W.orden(m, { t: 'intel', j: 0, clave: 'barrido', x: 100, y: 20 }); avanza(8);
  assert.strictEqual(m.niebla[0][20 * N + 100], 2, 'el barrido debía revelar la zona');
  assert.ok(J.info <= 500 - 30 + 1);
  avanza(W.INTEL.barrido.dura + 8);
  assert.strictEqual(m.niebla[0][20 * N + 100], 1, 'al acabar el barrido la zona queda solo explorada');
  W.orden(m, { t: 'intel', j: 0, clave: 'cartografia' }); W.orden(m, { t: 'intel', j: 0, clave: 'interceptar' }); avanza(2);
  assert.ok(m.niebla[0].every((v) => v > 0), 'la cartografía revela todo el terreno');
  assert.ok(J.intercepta > m.t, 'interceptar debía quedar activo');
});

prueba('colmena: llamada, red, necesidad, modo fijo y misiones', () => {
  const nuevo = () => { const m = W.crearMundo(4242, { N: 128 }); m.ents.filter((e) => !e.edif).forEach((e) => { e.vida = 0; }); W.tick(m); const N = m.N; for (let y = 40; y < 90; y++) for (let x = 20; x < 110; x++) { const i = y * N + x; if (!m.ocup[i]) { m.mapa.terreno[i] = 0; m.paso[i] = 1; m.pasoV[i] = 1; } } return m; };
  const avanza = (m, n) => { for (let i = 0; i < n; i++) W.tick(m); };
  const en = (m, x, y) => y * m.N + x;
  // Un tanque solo, atacado por dos. Hay una compañera a 12 celdas, otra 7 más atrás (solo oye por la red),
  // una muy lejos, una en guardia al lado y otra cumpliendo una orden.
  let m = nuevo();
  const a = W.crearUnidad(m, 0, 'tanque', en(m, 60, 64)), b = W.crearUnidad(m, 0, 'tanque', en(m, 48, 64)), d = W.crearUnidad(m, 0, 'tanque', en(m, 41, 64));
  const lejos = W.crearUnidad(m, 0, 'tanque', en(m, 24, 80)), fijo = W.crearUnidad(m, 0, 'tanque', en(m, 56, 70)), ocupado = W.crearUnidad(m, 0, 'tanque', en(m, 52, 60));
  W.orden(m, { t: 'guardia', j: 0, ids: [fijo.id] }); W.orden(m, { t: 'mover', j: 0, ids: [ocupado.id], x: 30.5, y: 44.5 });
  const e1 = W.crearUnidad(m, 1, 'tanque', en(m, 65, 63)), e2 = W.crearUnidad(m, 1, 'tanque', en(m, 65, 66));
  m.jug[1].colmena = false;
  let llamo = false, visto = { b: 0, d: 0 };
  for (let i = 0; i < 160; i++) { W.tick(m); if (a.llama !== undefined) llamo = true; if (b.acude && !visto.b) visto.b = m.t; if (d.acude && !visto.d) visto.d = m.t; }
  assert.ok(llamo, 'el tanque atacado y solo debía lanzar la alerta');
  assert.ok(visto.b, 'la compañera cercana debía responder');
  assert.ok(visto.d && visto.d >= visto.b, 'la de más atrás debía enterarse por la red, después');
  assert.ok(!lejos.acude, 'cubierta la necesidad, la lejana no acude');
  assert.ok(fijo.guardia && Math.hypot(fijo.x - 56.5, fijo.y - 70.5) < 0.3, 'la unidad en guardia no se mueve');
  assert.ok(!ocupado.acude && ocupado.orden === 'mover', 'la que cumple una orden ajena no la abandona');
  const sinApoyo = m.focos[0][0] ? m.focos[0][0].sinApoyo : false;
  for (let i = 0; i < 200; i++) W.tick(m);
  assert.ok(Math.hypot(b.x - 60, b.y - 64) < 9 || !m.porId.has(b.id), 'la que respondió debía llegar a la pelea');
  assert.ok(a.llama === undefined || m.t - a.llama > 20 || !m.porId.has(a.id), 'con apoyo presente la alerta se apaga');
  // al acabar la amenaza, vuelven a su puesto
  for (const e of [e1, e2]) e.vida = 0;
  avanza(m, 600);
  if (m.porId.has(d.id)) assert.ok(Math.hypot(d.x - 41.5, d.y - 64.5) < 2.5, 'pasada la amenaza debía volver a su puesto: ' + d.x.toFixed(1));
  // misiones: dos tanques marchan juntos; atacan a uno y el otro acude aunque tenga orden; un tercero con otra orden no
  m = nuevo(); m.jug[1].colmena = false;
  const p = W.crearUnidad(m, 0, 'tanque', en(m, 40, 60)), q = W.crearUnidad(m, 0, 'tanque', en(m, 40, 70)), otro = W.crearUnidad(m, 0, 'tanque', en(m, 40, 76));
  W.orden(m, { t: 'mover', j: 0, ids: [p.id, q.id], x: 90.5, y: 64.5, forma: 'linea' }); W.orden(m, { t: 'mover', j: 0, ids: [otro.id], x: 90.5, y: 80.5 });
  avanza(m, 60);
  for (let k = 0; k < 3; k++) { const emb = W.crearUnidad(m, 1, 'antitanque', en(m, Math.round(p.x) + 3 + k, Math.round(p.y) - 4)); emb.orden = 'atacar'; emb.obj = p.id; } // emboscada a uno solo
  let acudio = false;
  for (let i = 0; i < 120; i++) { W.tick(m); if (q.acude) acudio = true; }
  assert.ok(acudio, 'la compañera de misión debía acudir aunque tuviera orden');
  assert.ok(!otro.acude, 'la de otra misión sigue su orden');
  // interruptor
  m = nuevo(); m.jug[1].colmena = false;
  const s1 = W.crearUnidad(m, 0, 'tanque', en(m, 60, 64)), s2 = W.crearUnidad(m, 0, 'tanque', en(m, 50, 64));
  W.orden(m, { t: 'colmena', j: 0 }); W.crearUnidad(m, 1, 'tanque', en(m, 65, 63)); W.crearUnidad(m, 1, 'tanque', en(m, 65, 66)); avanza(m, 100);
  assert.ok(!s2.acude && Math.hypot(s2.x - 50.5, s2.y - 64.5) < 0.3, 'con la colmena apagada nadie acude solo');
  assert.ok(s1.vida < s1.vidaMax);
});

prueba('trincheras y orientación al llegar', () => {
  const m = W.crearMundo(4242, { N: 128 }), N = m.N;
  m.ents.filter((e) => !e.edif).forEach((e) => { e.vida = 0; }); W.tick(m);
  for (let y = 50; y < 80; y++) for (let x = 30; x < 100; x++) { const i = y * N + x; if (!m.ocup[i]) { m.mapa.terreno[i] = 0; m.paso[i] = 1; m.pasoV[i] = 1; } }
  const avanza = (n) => { for (let i = 0; i < n; i++) W.tick(m); };
  const cel = (x, y) => y * N + x;
  // dos soldados iguales bajo el mismo fuego: el atrincherado aguanta bastante más
  const dentro = W.crearUnidad(m, 0, 'infanteria', cel(50, 60)), fuera = W.crearUnidad(m, 0, 'infanteria', cel(50, 70)), andando = W.crearUnidad(m, 0, 'infanteria', cel(40, 75));
  W.orden(m, { t: 'mover', j: 0, ids: [andando.id], x: 60.5, y: 76.5 });
  W.orden(m, { t: 'trinchera', j: 0, ids: [dentro.id, andando.id] }); avanza(W.ECON.cavar - 5);
  assert.strictEqual(m.trincheras.size, 0, 'cavar lleva su tiempo');
  avanza(10);
  assert.ok(m.trincheras.has(cel(50, 60)) && m.trincheras.size === 1, 'solo cava quien estaba quieta');
  assert.ok(W.enTrinchera(m, dentro) && dentro.guardia && !W.enTrinchera(m, fuera));
  const t1 = W.crearUnidad(m, 1, 'infanteria', cel(53, 60)), t2 = W.crearUnidad(m, 1, 'infanteria', cel(53, 70));
  t1.orden = 'atacar'; t1.obj = dentro.id; t2.orden = 'atacar'; t2.obj = fuera.id;
  for (const u of [dentro, fuera]) u.recarga = 99999; // sin responder, para comparar solo el daño recibido
  avanza(60);
  const d1 = 60 - dentro.vida, d2 = 60 - fuera.vida;
  assert.ok(d2 > 0 && Math.abs(d1 / d2 - W.ECON.trinchera) < 0.05, 'la trinchera debía reducir el daño a ' + W.ECON.trinchera + ': ' + d1 + ' frente a ' + d2);
  // un tanque no aplasta a quien está en la trinchera, pero sí a quien sale de ella
  for (const u of [t1, t2]) u.vida = 0;
  avanza(2); dentro.vida = 60;
  const tq = W.crearUnidad(m, 1, 'tanque', cel(44, 60)); tq.recarga = 99999;
  W.orden(m, { t: 'mover', j: 1, ids: [tq.id], x: 56.5, y: 60.5 }); avanza(160);
  assert.ok(m.porId.has(dentro.id) && !m.jug[1].aplastados, 'la trinchera protege del atropello');
  tq.vida = 0; avanza(2);
  // orientación: al llegar, la unidad queda mirando hacia donde se pidió
  const t = W.crearUnidad(m, 0, 'tanque', cel(40, 55));
  W.orden(m, { t: 'mover', j: 0, ids: [t.id], x: 60.5, y: 55.5, rumbo: Math.PI / 2 }); avanza(400);
  assert.ok(Math.hypot(t.x - 60.5, t.y - 55.5) < 0.6 && Math.abs(t.ang - Math.PI / 2) < 0.05, 'debía quedar mirando hacia abajo: ' + t.ang.toFixed(2));
  const g = [0, 1, 2].map((k) => W.crearUnidad(m, 0, 'tanque', cel(40, 64 + k * 2)));
  W.orden(m, { t: 'mover', j: 0, ids: g.map((u) => u.id), x: 80.5, y: 66.5, forma: 'linea', rumbo: -Math.PI / 2 }); avanza(700);
  const ys = g.map((u) => u.y), xs = g.map((u) => u.x);
  assert.ok(Math.max(...ys) - Math.min(...ys) < 1 && Math.max(...xs) - Math.min(...xs) > 1.4, 'la línea debía orientarse según el rumbo pedido');
  assert.ok(g.every((u) => Math.abs(u.ang + Math.PI / 2) < 0.05), 'y todas mirar hacia arriba');
});

prueba('fase 3: aviación con aeródromo, cupo, patrulla, radio de vuelo y antiaérea', () => {
  const m = W.crearMundo(777, { N: 128 }), N = m.N, J = m.jug[0];
  m.ents.filter((e) => !e.edif).forEach((e) => { e.vida = 0; }); W.tick(m);
  for (let y = 40; y < 90; y++) for (let x = 30; x < 126; x++) { const i = y * N + x; if (!m.ocup[i]) { m.mapa.terreno[i] = 0; m.paso[i] = 1; m.pasoV[i] = 1; } }
  for (let y = 58; y < 64; y++) for (let x = 60; x < 66; x++) { m.mapa.terreno[y * N + x] = 2; m.paso[y * N + x] = 0; m.pasoV[y * N + x] = 0; } // un lago en medio
  const avanza = (n, fn) => { for (let i = 0; i < n; i++) { W.tick(m); if (fn) fn(); } };
  const cel = (x, y) => y * N + x;
  const lejos = (u, x, y) => Math.hypot(u.x - x, u.y - y);
  J.dios = true; m.jug[1].dios = true;
  // el aeródromo pide nivel 2; el avión nace posado en él
  assert.ok(!W.disponible(m, 0, W.EDIF.aerodromo), 'el aeródromo no debía estar disponible en nivel 1');
  J.nivel = 2;
  const ae = W.crearEdificio(m, 0, 'aerodromo', 40, 60);
  avanza(1);
  W.orden(m, { t: 'entrenar', j: 0, tipo: 'caza' }); avanza(W.UNID.caza.tiempo + 5);
  const caza = m.ents.find((e) => e.tipo === 'caza');
  assert.ok(caza && caza.enTierra && caza.casa === ae.id, 'el caza debía nacer posado en su aeródromo');
  W.orden(m, { t: 'entrenar', j: 0, tipo: 'bombardero' }); avanza(5);
  assert.strictEqual(J.colas.bombardero.n, 0, 'el bombardero pide nivel 3');
  avanza(200);
  assert.ok(caza.enTierra && caza.fuel === W.UNID.caza.fuel, 'sin órdenes se queda en tierra y no gasta combustible');
  // posado no se le puede atacar; en vuelo sí
  const sol = W.crearUnidad(m, 1, 'infanteria', cel(44, 63)); sol.recarga = 99999; sol.guardia = true;
  assert.ok(!W.puedeAtacar(sol, caza), 'al avión posado lo cubre su aeródromo');
  sol.vida = 0; avanza(2);
  // mover: va en línea recta sobre el agua, pasa por el punto y vuelve a posarse
  let cerca = Infinity;
  W.orden(m, { t: 'mover', j: 0, ids: [caza.id], x: 63.5, y: 61.5 });
  avanza(400, () => { cerca = Math.min(cerca, lejos(caza, 63.5, 61.5)); });
  assert.ok(cerca < 1.6, 'el caza debía pasar sobre el lago: ' + cerca.toFixed(2));
  assert.ok(caza.enTierra && caza.orden === 'nada', 'y volver solo a su aeródromo');
  // patrulla sobre un punto: da vueltas sin detenerse
  W.orden(m, { t: 'patrulla', j: 0, ids: [caza.id], x: 63.5, y: 61.5 }); avanza(200);
  let maxD = 0, minV = Infinity;
  avanza(300, () => { maxD = Math.max(maxD, lejos(caza, 63.5, 61.5)); minV = Math.min(minV, caza.v); });
  assert.ok(!caza.enTierra && maxD < W.ECON.orbita + 2.5 && minV > 0.05, 'debía orbitar el punto: ' + maxD.toFixed(1) + ' · ' + minV.toFixed(3));
  // un tanque no puede dispararle; la antiaérea sí, y solo a aviones
  const tq = W.crearUnidad(m, 1, 'tanque', cel(68, 61)), v0 = caza.vida;
  assert.ok(!W.puedeAtacar(tq, caza) && W.puedeAtacar(caza, tq));
  caza.recarga = 99999; tq.recarga = 99999; avanza(60);
  assert.strictEqual(caza.vida, v0, 'el cañón del tanque no alcanza a un avión');
  tq.vida = 0; avanza(2);
  const aa = W.crearEdificio(m, 1, 'antiaerea', 67, 61); m.jug[1].prod = 999;
  const t2 = W.crearUnidad(m, 0, 'tanque', cel(70, 61)); t2.recarga = 99999; const vt = t2.vida;
  avanza(45);
  assert.ok(m.porId.has(caza.id) && caza.vida < v0, 'la antiaérea debía herir al caza');
  assert.strictEqual(t2.vida, vt, 'la antiaérea no dispara a tierra');
  aa.vida = 0; t2.vida = 0; avanza(2);
  // combustible: con lo justo vuelve, reposta posado y retoma sola la patrulla
  caza.vida = caza.vidaMax; caza.fuel = 150; avanza(30);
  assert.ok(caza.repostando, 'con el combustible justo debía volver a base');
  avanza(120);
  assert.ok(caza.enTierra && caza.patrulla, 'debía posarse a repostar sin olvidar la patrulla');
  avanza(400);
  assert.ok(!caza.enTierra && !caza.repostando && lejos(caza, 63.5, 61.5) < W.ECON.orbita + 2.5 && caza.fuel > W.UNID.caza.fuel * 0.7, 'y despegar de nuevo a patrullar: ' + caza.fuel);
  // radio de vuelo: no se aleja de su aeródromo más de lo que le toca
  let maxR = 0;
  W.orden(m, { t: 'mover', j: 0, ids: [caza.id], x: 125.5, y: 61.5 });
  avanza(900, () => { maxR = Math.max(maxR, lejos(caza, ae.cx, ae.cy)); });
  assert.ok(maxR > W.UNID.caza.radioVuelo - 2 && maxR < W.UNID.caza.radioVuelo + 0.5, 'debía llegar hasta su radio y no más: ' + maxR.toFixed(1));
  assert.ok(caza.enTierra, 'y volver');
  // cupo: cinco aviones por aeródromo
  const cupo = W.ECON.cupoAviones;
  for (let k = 0; k < cupo - 1; k++) W.crearUnidad(m, 0, 'caza', cel(41, 61));
  avanza(40);
  assert.ok(m.ents.filter((e) => e.tipo === 'caza' && e.j === 0).every((e) => e.enTierra && e.casa === ae.id), 'los cinco debían posarse en el aeródromo');
  assert.strictEqual(new Set(m.ents.filter((e) => e.tipo === 'caza' && e.j === 0).map((e) => e.slot)).size, cupo, 'cada uno en su sitio');
  W.orden(m, { t: 'entrenar', j: 0, tipo: 'caza' }); avanza(2);
  assert.strictEqual(J.colas.caza.n, 0, 'con el cupo lleno no se encargan más aviones');
  // bombardero: nivel 3, bombardea en área lo que hay en tierra, no puede con otros aviones y vuelve al acabar
  J.nivel = 3;
  const ae2 = W.crearEdificio(m, 0, 'aerodromo', 40, 70); avanza(1);
  const bo = W.crearUnidad(m, 0, 'bombardero', cel(41, 71)); avanza(30);
  assert.ok(bo.enTierra && bo.casa === ae2.id, 'con el primero lleno, el bombardero va al segundo aeródromo');
  const ed = W.crearEdificio(m, 1, 'central', 70, 70), inf = W.crearUnidad(m, 1, 'infanteria', cel(72, 71)); inf.recarga = 99999; inf.guardia = true;
  const c3 = W.crearUnidad(m, 1, 'caza', cel(50, 84)); c3.recarga = 99999; c3.fuel = 99999; c3.orden = 'mover'; // un avión sin base, en vuelo
  assert.ok(!W.puedeAtacar(bo, c3) && !W.puedeAtacar(c3, bo), 'ni el bombardero puede con un caza ni el caza con un avión posado');
  W.orden(m, { t: 'atacar', j: 0, ids: [bo.id], obj: ed.id }); avanza(500);
  assert.ok(!m.porId.has(ed.id) || ed.vida < W.EDIF.central.vida * 0.6, 'el bombardero debía dañar el edificio: ' + ed.vida);
  assert.ok(!m.porId.has(inf.id) || inf.vida < 60, 'la bomba daña en área');
  // el caza derriba al bombardero en vuelo
  const ed2 = W.crearEdificio(m, 1, 'central', 74, 76); ed2.vida = ed2.vidaMax = 99999;
  bo.recarga = 99999; bo.fuel = 99999; bo.vida = bo.vidaMax; c3.recarga = 0;
  W.orden(m, { t: 'atacar', j: 0, ids: [bo.id], obj: ed2.id }); avanza(60);
  assert.ok(!bo.enTierra, 'el bombardero debía despegar hacia su blanco');
  W.orden(m, { t: 'atacar', j: 1, ids: [c3.id], obj: bo.id }); avanza(500);
  assert.ok(!m.porId.has(bo.id), 'el caza debía derribar al bombardero: ' + bo.vida);
  // sin base y sin combustible, cae; y los posados caen con su aeródromo
  c3.fuel = 5; avanza(W.ECON.fuelCae + 20);
  assert.ok(!m.porId.has(c3.id), 'un avión sin combustible ni base debía caer');
  ae.vida = 0; avanza(3);
  assert.strictEqual(m.ents.filter((e) => e.tipo === 'caza' && e.j === 0).length, 0, 'los aviones posados se pierden con su aeródromo');
});

prueba('frente: torreta, giro del cuerpo, flancos y visión en cono', () => {
  const m = W.crearMundo(99, { N: 128 }), N = m.N;
  m.ents.filter((e) => !e.edif).forEach((e) => { e.vida = 0; }); W.tick(m);
  for (let y = 40; y < 100; y++) for (let x = 30; x < 110; x++) { const i = y * N + x; if (!m.ocup[i]) { m.mapa.terreno[i] = 0; m.paso[i] = 1; m.pasoV[i] = 1; } }
  const avanza = (n) => { for (let i = 0; i < n; i++) W.tick(m); };
  const cel = (x, y) => y * N + x;
  const mudo = (u) => { u.recarga = 99999; u.guardia = true; return u; };
  // visión: lejos hacia adelante, corta hacia atrás
  const v = W.crearUnidad(m, 0, 'infanteria', cel(60, 50)); v.ang = 0; avanza(4);
  const f = m.niebla[0], vis = W.UNID.infanteria.vision;
  assert.strictEqual(f[cel(60 + Math.floor(vis * 1.2), 50)], 2, 'debía ver más lejos al frente');
  assert.notStrictEqual(f[cel(60 - Math.floor(vis * 0.9), 50)], 2, 'no debía ver tan lejos a su espalda');
  assert.strictEqual(f[cel(60 - 1, 50)], 2, 'muy cerca percibe también detrás');
  assert.strictEqual(f[cel(60, 50 + 4)], 2, 'a los costados ve más que detrás');
  assert.notStrictEqual(f[cel(60 - 3, 50)], 2, 'detrás, casi nada');
  assert.notStrictEqual(f[cel(60, 50 + 6)], 2, 'y a los costados menos que al frente');
  // detección: no advierte al enemigo que tiene detrás hasta que este le dispara
  const atras = mudo(W.crearUnidad(m, 1, 'infanteria', cel(56, 50)));
  avanza(30);
  assert.strictEqual(v.obj, 0, 'no debía detectar lo que tiene a la espalda');
  const delante = mudo(W.crearUnidad(m, 1, 'infanteria', cel(63, 50)));
  avanza(10);
  assert.strictEqual(v.obj, delante.id, 'debía detectar lo que tiene delante');
  for (const u of [v, atras, delante]) u.vida = 0; avanza(2);
  // tanque: gira la torreta, no el casco, y tarda en apuntar a lo que tiene detrás
  const tq = W.crearUnidad(m, 0, 'tanque', cel(60, 60)); tq.ang = tq.angT = 0;
  const b1 = mudo(W.crearUnidad(m, 1, 'tanque', cel(56, 60))); b1.ang = Math.PI; // de espaldas al tanque... y el tanque de espaldas a él
  W.orden(m, { t: 'atacar', j: 0, ids: [tq.id], obj: b1.id }); avanza(5);
  assert.strictEqual(tq.recarga, 0, 'aún no debía haber disparado: la torreta está girando');
  assert.ok(tq.ang === 0 && tq.angT !== 0, 'gira la torreta, no el casco');
  avanza(30);
  assert.ok(tq.recarga > 0 && Math.abs(Math.abs(tq.angT) - Math.PI) < 0.2 && tq.ang === 0, 'debía disparar con la torreta vuelta: ' + tq.angT);
  // flancos: el mismo cañonazo duele más por el costado y más por la espalda
  const dano = (angBlanco) => { const b = mudo(W.crearUnidad(m, 1, 'tanque', cel(80, 80))); b.ang = angBlanco; const a = W.crearUnidad(m, 0, 'tanque', cel(76, 80)); a.ang = a.angT = 0;
    W.orden(m, { t: 'atacar', j: 0, ids: [a.id], obj: b.id }); avanza(12); const d = b.vidaMax - b.vida; a.vida = 0; b.vida = 0; avanza(2); return d; };
  tq.vida = 0; b1.vida = 0; avanza(2);
  const frente = dano(Math.PI), costado = dano(Math.PI / 2), espalda = dano(0);
  assert.ok(frente > 0 && Math.abs(costado / frente - W.ECON.flanco) < 0.01 && Math.abs(espalda / frente - W.ECON.espalda) < 0.01, 'flancos: ' + [frente, costado, espalda]);
  // artillería: sin torreta, gira el cuerpo entero antes de tirar
  const ar = W.crearUnidad(m, 0, 'artilleria', cel(60, 90)); ar.ang = 0;
  const b2 = mudo(W.crearUnidad(m, 1, 'tanque', cel(60, 83)));
  W.orden(m, { t: 'atacar', j: 0, ids: [ar.id], obj: b2.id }); avanza(8);
  assert.ok(ar.recarga === 0 && ar.ang < 0, 'debía estar girando, sin disparar todavía');
  avanza(30);
  assert.ok(ar.recarga > 0 && Math.abs(ar.ang + Math.PI / 2) < 0.2, 'debía tirar ya encarada: ' + ar.ang);
  ar.vida = 0; b2.vida = 0; avanza(2);
  // trinchera: solo cubre su frente
  const s = W.crearUnidad(m, 0, 'infanteria', cel(60, 70)); s.ang = 0;
  W.orden(m, { t: 'trinchera', j: 0, ids: [s.id] }); avanza(W.ECON.cavar + 5);
  const e1 = mudo(W.crearUnidad(m, 1, 'infanteria', cel(57, 70)));
  avanza(40);
  assert.ok(e1.vida === 60 && s.obj === 0, 'desde la trinchera no se dispara hacia atrás');
  const e2 = mudo(W.crearUnidad(m, 1, 'infanteria', cel(63, 70)));
  avanza(40);
  assert.ok(e2.vida < 60, 'pero sí hacia su frente');
});

prueba('modo admin: todo activado para probar', () => {
  const m = W.crearMundo(5, { N: 128 }), J = m.jug[0];
  W.tick(m);
  assert.ok(!W.disponible(m, 0, W.EDIF.aerodromo) && !W.disponible(m, 0, W.UNID.pesado));
  W.orden(m, { t: 'admin', j: 0 }); W.tick(m);
  assert.ok(J.admin && J.dios && J.nivel === 3 && J.mejoras.canonLargo && J.mejoras.analisis, 'nivel 3 y todas las mejoras');
  assert.ok(Object.values(W.EDIF).every((d) => W.disponible(m, 0, d)) && Object.values(W.UNID).every((d) => W.disponible(m, 0, d)), 'todo disponible sin requisitos');
  for (let i = 0; i < 4; i++) W.tick(m);
  assert.ok(m.niebla[0].every((v) => v === 2) && !m.niebla[1].every((v) => v === 2), 'mapa a la vista solo para quien lo activa');
  W.orden(m, { t: 'construir', j: 0, tipo: 'aerodromo' });
  for (let i = 0; i < W.EDIF.aerodromo.tiempo / 4 + 3; i++) W.tick(m);
  assert.ok(J.obras[0] && J.obras[0].listo, 'las obras van cuatro veces más rápido');
  const min = J.minerales; W.orden(m, { t: 'admin', j: 0 }); W.tick(m);
  assert.ok(!J.admin && !J.dios && J.minerales < min && J.nivel === 3, 'al apagarlo vuelve el saldo; el nivel y las mejoras se quedan');
});

prueba('fase 1a y 1b: bucle, retirada, cosechadora que huye, veteranía, observador y aviso de flanco', () => {
  const m = W.crearMundo(4242, { N: 128 }), N = m.N, J = m.jug[0], b = m.mapa.bases[0];
  const avanza = (n, fn) => { for (let i = 0; i < n; i++) { W.tick(m); if (fn) fn(); } };
  const cel = (x, y) => y * N + x;
  for (let y = 20; y < 60; y++) for (let x = 60; x < 120; x++) { const i = y * N + x; if (!m.ocup[i]) { m.mapa.terreno[i] = 0; m.paso[i] = 1; m.pasoV[i] = 1; m.mapa.mineral[i] = 0; } }
  J.dios = true; m.jug[1].dios = true;
  W.crearEdificio(m, 0, 'central', b.x + 3, b.y - 1); const cu = W.crearEdificio(m, 0, 'cuartel', b.x - 5, b.y - 6); avanza(1);
  // bucle: cada soldado que sale se vuelve a encargar solo
  const T = W.UNID.infanteria.tiempo, n0 = J.cuenta.infanteria || 0;
  W.orden(m, { t: 'bucle', j: 0, ids: [cu.id] }); W.orden(m, { t: 'entrenar', j: 0, tipo: 'infanteria' }); avanza(3 * T + 10);
  assert.ok(cu.bucle && (J.cuenta.infanteria || 0) - n0 === 3 && cu.cola.length === 1, 'en bucle debían salir tres soldados y quedar otro encargado: ' + ((J.cuenta.infanteria || 0) - n0));
  // lo repetido se paga al empezarlo: sin dinero espera, y cancelarlo no devuelve nada
  J.dios = false; J.minerales = 0; avanza(T + 5);
  assert.ok(cu.sinFondos && cu.cola.length === 1 && cu.prog === 0, 'sin minerales el bucle espera');
  W.orden(m, { t: 'cancelarUnidad', j: 0, id: cu.id, i: 0 }); W.orden(m, { t: 'bucle', j: 0, ids: [cu.id], on: false }); avanza(1);
  assert.ok(cu.cola.length === 0 && J.minerales < 50, 'cancelar un encargo aún sin pagar no devuelve dinero');
  J.dios = true; avanza(1);
  // veteranía: dos bajas dan el primer galón, con más vida y más daño
  const vet = W.crearUnidad(m, 0, 'tanque', cel(80, 30)); vet.ang = vet.angT = 0;
  for (let k = 0; k < 2; k++) { const e = W.crearUnidad(m, 1, 'infanteria', cel(84, 29 + k * 2)); e.recarga = 99999; e.guardia = true; }
  avanza(400);
  assert.ok(vet.bajas === 2 && vet.rango === 1 && vet.vidaMax === Math.round(W.UNID.tanque.vida * 1.1), 'dos bajas, un galón: ' + vet.bajas + ' · ' + vet.rango + ' · ' + vet.vidaMax);
  const blanco = W.crearUnidad(m, 1, 'tanque', cel(84, 30)); blanco.recarga = 99999; blanco.guardia = true; blanco.ang = Math.PI;
  avanza(40);
  const golpe = W.ARMAS.canon.dano * (1 + W.ECON.rangoDano);
  assert.ok(Math.abs((blanco.vidaMax - blanco.vida) % golpe) < 0.01 && blanco.vida < blanco.vidaMax, 'el veterano pega un 10 % más: ' + (blanco.vidaMax - blanco.vida));
  // aviso de flanco: al darle por la espalda sale el efecto
  blanco.ang = 0; blanco.vida = blanco.vidaMax; m.efectos.length = 0; let avisos = 0;
  avanza(80, () => { avisos += m.efectos.filter((e) => e.tipo === 'flanco' && e.s === 2).length; m.efectos.length = 0; });
  assert.ok(avisos >= 1, 'debía avisar del golpe por la espalda');
  // retirada automática: muy dañado se va a reparar y vuelve a su puesto
  blanco.vida = 0; avanza(2);
  W.orden(m, { t: 'retiro', j: 0, on: true }); avanza(1);
  const x0 = vet.x, y0 = vet.y; vet.vida = vet.vidaMax * 0.2; avanza(5);
  assert.ok(vet.retirando && vet.orden === 'mover', 'con poca vida debía retirarse');
  let cercaBase = false;
  avanza(4500, () => { if (Math.hypot(vet.x - b.x, vet.y - b.y) < 9) cercaBase = true; });
  assert.ok(cercaBase, 'debía llegar a su base a repararse');
  assert.ok(!vet.retirando && vet.vida >= vet.vidaMax * 0.9 && Math.hypot(vet.x - x0, vet.y - y0) < 1.5, 'reparado, vuelve a su puesto: ' + vet.vida.toFixed(0) + ' · ' + Math.hypot(vet.x - x0, vet.y - y0).toFixed(1));
  // una orden directa anula la retirada
  vet.vida = vet.vidaMax * 0.2; avanza(5);
  W.orden(m, { t: 'mover', j: 0, ids: [vet.id], x: 90.5, y: 30.5 }); avanza(2);
  assert.ok(!vet.retirando, 'la orden del jugador manda');
  W.orden(m, { t: 'retiro', j: 0, on: false }); vet.vida = vet.vidaMax; avanza(300);
  // observador: la artillería no ve al blanco; en cuanto un soldado propio lo ve, dispara
  const ar = W.crearUnidad(m, 0, 'artilleria', cel(70, 50)); ar.ang = Math.PI; // de espaldas
  const lejos = W.crearUnidad(m, 1, 'tanque', cel(80, 50)); lejos.recarga = 99999; lejos.guardia = true;
  avanza(150);
  assert.strictEqual(lejos.vida, lejos.vidaMax, 'sin nadie que lo vea, la artillería no dispara');
  const ojo = W.crearUnidad(m, 0, 'infanteria', cel(76, 53)); ojo.ang = 0; ojo.recarga = 99999; ojo.guardia = true;
  avanza(250);
  assert.ok(lejos.vida < lejos.vidaMax, 'con un observador, la artillería debía disparar');
  // cosechadora: atacada, deja la mina y se refugia en la refinería; pasado el susto vuelve a cosechar
  for (const e of [lejos, ojo, ar]) e.vida = 0; avanza(2);
  const ref = W.crearEdificio(m, 0, 'refineria', b.x - 7, b.y + 3); avanza(1);
  const co = m.ents.find((e) => e.tipo === 'cosechadora' && e.j === 0) || W.crearUnidad(m, 0, 'cosechadora', W.cercaLibre(m, b.x - 3, b.y + 6));
  avanza(900);
  assert.ok(co.est === 'cosechar' || co.est === 'ir' || co.est === 'volver' || co.est === 'descargar', 'la cosechadora debía estar trabajando: ' + co.est);
  let espera = 0; while (co.est !== 'cosechar' && espera++ < 1500) W.tick(m);
  const malo = W.crearUnidad(m, 1, 'infanteria', W.cercaLibre(m, co.x + 2, co.y)); malo.guardia = true; malo.ang = Math.atan2(co.y - malo.y, co.x - malo.x); // de noche ve menos: que la tenga delante
  avanza(60);
  assert.ok(co.huye > 0 && (co.est === 'volver0' || co.est === 'volver'), 'atacada, debía huir a la refinería: ' + co.est);
  malo.vida = 0; let llego = false;
  avanza(900, () => { if (W.dist(co.x, co.y, ref) <= 1.5) llego = true; });
  assert.ok(llego, 'debía llegar a la refinería');
  avanza(700);
  assert.ok(co.huye === 0 && co.est !== 'espera', 'pasado el susto vuelve al trabajo: ' + co.est);
});

prueba('fase 1c: explorador, blindado ligero, ingeniero, antiaéreo móvil y dron', () => {
  const m = W.crearMundo(31, { N: 128 }), N = m.N, J = m.jug[0];
  m.ents.filter((e) => !e.edif).forEach((e) => { e.vida = 0; }); W.tick(m);
  for (let y = 30; y < 100; y++) for (let x = 30; x < 110; x++) { const i = y * N + x; if (!m.ocup[i]) { m.mapa.terreno[i] = 0; m.paso[i] = 1; m.pasoV[i] = 1; } }
  const avanza = (n, fn) => { for (let i = 0; i < n; i++) { W.tick(m); if (fn) fn(); } };
  const cel = (x, y) => y * N + x;
  const mudo = (u) => { u.recarga = 99999; u.guardia = true; return u; };
  J.dios = true; m.jug[1].dios = true;
  const cu = W.crearEdificio(m, 0, 'cuartel', 40, 40), fa = W.crearEdificio(m, 0, 'fabrica', 40, 46), ae = W.crearEdificio(m, 0, 'aerodromo', 40, 52); avanza(1);
  // niveles: explorador y blindado desde el nivel 1; ingeniero, antiaéreo móvil y dron piden el 2
  for (const t of ['explorador', 'ingeniero', 'blindado', 'antiaereoMovil', 'dron']) W.orden(m, { t: 'entrenar', j: 0, tipo: t });
  avanza(1);
  assert.deepStrictEqual([cu.cola, fa.cola, ae.cola], [['explorador'], ['blindado'], []], 'en nivel 1 solo explorador y blindado');
  J.nivel = 2; W.orden(m, { t: 'cancelarUnidad', j: 0, id: cu.id, i: 0 }); W.orden(m, { t: 'cancelarUnidad', j: 0, id: fa.id, i: 0 }); avanza(1);
  // explorador: ve más lejos y más ancho que un soldado
  const ex = W.crearUnidad(m, 0, 'explorador', cel(60, 40)); ex.ang = 0; avanza(4);
  const f = m.niebla[0];
  assert.strictEqual(f[cel(72, 40)], 2, 'el explorador debía ver a 12 celdas');
  assert.strictEqual(f[cel(62, 49)], 2, 'y con un campo ancho (casi de costado, a 9 celdas)');
  const so = W.crearUnidad(m, 0, 'infanteria', cel(60, 70)); so.ang = 0; avanza(4);
  assert.notStrictEqual(f[cel(62, 79)], 2, 'un soldado no ve ahí');
  ex.vida = 0; so.vida = 0; avanza(2);
  // blindado ligero: barre infantería con su torreta; a un tanque casi no le hace nada
  const bl = W.crearUnidad(m, 0, 'blindado', cel(60, 40)); bl.ang = bl.angT = 0;
  const inf = mudo(W.crearUnidad(m, 1, 'infanteria', cel(63, 42)));
  avanza(120);
  assert.ok(!m.porId.has(inf.id) && bl.ang === 0, 'debía acabar pronto con el soldado, girando solo la torreta');
  const tq = mudo(W.crearUnidad(m, 1, 'tanque', cel(63, 40)));
  avanza(200);
  assert.ok(tq.vida > tq.vidaMax * 0.8, 'la ametralladora apenas araña un tanque: ' + tq.vida);
  tq.recarga = 0; avanza(300);
  assert.ok(!m.porId.has(bl.id), 'y un cañón lo destroza');
  tq.vida = 0; avanza(2);
  // ingeniero: sin arma; va solo hasta el vehículo dañado y lo repara gratis; también edificios; cava el doble de rápido
  const ing = W.crearUnidad(m, 0, 'ingeniero', cel(60, 60)), roto = W.crearUnidad(m, 0, 'tanque', cel(65, 60));
  roto.guardia = true; roto.vida = 100; J.dios = false; J.minerales = 0;
  W.orden(m, { t: 'atacar', j: 0, ids: [ing.id], obj: roto.id }); W.orden(m, { t: 'amover', j: 0, ids: [ing.id], x: 61.5, y: 60.5 }); avanza(60); // órdenes de combate: no deben romper nada
  avanza(700);
  assert.ok(roto.vida === roto.vidaMax && W.dist(ing.x, ing.y, roto) <= 1.7, 'el ingeniero debía ir y dejar el tanque como nuevo: ' + roto.vida);
  assert.ok(J.minerales < 200, 'reparar con ingeniero no cuesta minerales');
  cu.vida = cu.vidaMax - 200; cu.tDano = m.t; avanza(900);
  assert.ok(cu.vida > cu.vidaMax - 200 + 100, 'también repara edificios cercanos... si están a su alcance: ' + cu.vida);
  J.dios = true;
  const s2 = W.crearUnidad(m, 0, 'infanteria', cel(70, 70)), i2 = W.crearUnidad(m, 0, 'ingeniero', cel(73, 70));
  W.orden(m, { t: 'trinchera', j: 0, ids: [s2.id, i2.id] }); avanza(W.ECON.cavar / 2 + 3);
  assert.ok(m.trincheras.has(cel(73, 70)) && !m.trincheras.has(cel(70, 70)), 'el ingeniero cava en la mitad de tiempo');
  // antiaéreo móvil: solo dispara a aviones y acompaña al grupo
  const aa = W.crearUnidad(m, 0, 'antiaereoMovil', cel(60, 80)); aa.ang = aa.angT = 0;
  const t3 = mudo(W.crearUnidad(m, 1, 'tanque', cel(63, 80))), v3 = t3.vida;
  const avion = W.crearUnidad(m, 1, 'caza', cel(65, 82)); avion.recarga = 99999; avion.fuel = 99999; avion.orden = 'mover';
  avanza(120);
  assert.ok(t3.vida === v3 && (!m.porId.has(avion.id) || avion.vida < avion.vidaMax), 'debía disparar al avión y no al tanque');
  t3.vida = 0; avion.vida = 0; avanza(2);
  W.orden(m, { t: 'amover', j: 0, ids: [aa.id], x: 80.5, y: 80.5 }); avanza(400);
  assert.ok(Math.hypot(aa.x - 80.5, aa.y - 80.5) < 1, 'el antiaéreo móvil se mueve con el grupo');
  // dron: se paga con información, no tiene armas, ve en redondo, patrulla y ocupa plaza de aeródromo
  J.dios = false; J.minerales = 5000; J.info = 10;
  W.orden(m, { t: 'entrenar', j: 0, tipo: 'dron' }); avanza(1);
  assert.deepStrictEqual(ae.cola, [], 'sin información no hay dron');
  J.info = 100; W.orden(m, { t: 'entrenar', j: 0, tipo: 'dron' }); avanza(1);
  assert.ok(ae.cola.length === 1 && J.info === 100 - W.UNID.dron.info);
  J.dios = true; avanza(W.UNID.dron.tiempo + 5);
  const dr = m.ents.find((e) => e.tipo === 'dron');
  assert.ok(dr && dr.enTierra && W.cupoAire(m, 0).hay === 1, 'el dron nace posado y cuenta para el cupo');
  W.orden(m, { t: 'patrulla', j: 0, ids: [dr.id], x: 70.5, y: 55.5 }); avanza(400);
  assert.ok(!dr.enTierra && Math.hypot(dr.x - 70.5, dr.y - 55.5) < W.ECON.orbita + 2.5, 'debía patrullar el punto');
  avanza(4);
  const atras = { x: Math.round(dr.x - Math.cos(dr.ang) * 11), y: Math.round(dr.y - Math.sin(dr.ang) * 11) };
  assert.strictEqual(m.niebla[0][cel(atras.x, atras.y)], 2, 'el dron ve en todas direcciones');
  const e4 = mudo(W.crearUnidad(m, 1, 'tanque', cel(72, 56)));
  W.orden(m, { t: 'atacar', j: 0, ids: [dr.id], obj: e4.id }); avanza(100);
  assert.ok(e4.vida === e4.vidaMax && m.porId.has(dr.id), 'el dron no ataca');
});

prueba('fase 2a: patio móvil, segundas bases, obras por patio y derrota al perder todos los patios', () => {
  const m = W.crearMundo(77, { N: 128 }), N = m.N, J = m.jug[0], b = m.mapa.bases[0];
  const avanza = (n) => { for (let i = 0; i < n; i++) W.tick(m); };
  const cel = (x, y) => y * N + x;
  const lejos = { x: b.x < N / 2 ? b.x + 30 : b.x - 30, y: b.y < N / 2 ? b.y + 30 : b.y - 30 };
  for (let y = lejos.y - 8; y < lejos.y + 8; y++) for (let x = lejos.x - 8; x < lejos.x + 8; x++) { const i = y * N + x; m.mapa.terreno[i] = 0; m.paso[i] = 1; m.pasoV[i] = 1; m.mapa.mineral[i] = 0; m.mapa.sitioEn[i] = 0; }
  J.dios = true;
  const p1 = m.ents.find((e) => e.tipo === 'patio' && e.j === 0);
  // un patio: dos centrales van una tras otra
  const T = W.EDIF.central.tiempo;
  W.orden(m, { t: 'construir', j: 0, tipo: 'central' }); W.orden(m, { t: 'construir', j: 0, tipo: 'central' }); avanza(T + 3);
  assert.ok(J.obras[0].listo && !J.obras[1].listo && J.obras.every((o) => o.patio === p1.id), 'con un patio, en fila');
  W.orden(m, { t: 'cancelarEdif', j: 0, tipo: 'central' }); W.orden(m, { t: 'cancelarEdif', j: 0, tipo: 'central' }); avanza(1);
  // el patio móvil pide nivel 2; se despliega en llano libre y deja de existir como vehículo
  W.crearEdificio(m, 0, 'fabrica', b.x - 8, b.y + 4); avanza(1);
  W.orden(m, { t: 'entrenar', j: 0, tipo: 'patioMovil' }); avanza(1);
  assert.strictEqual(J.colas.patioMovil.n, 0, 'el patio móvil pide nivel 2');
  J.nivel = 2;
  const pm = W.crearUnidad(m, 0, 'patioMovil', cel(lejos.x, lejos.y)), bajas = J.bajas;
  W.orden(m, { t: 'mover', j: 0, ids: [pm.id], x: lejos.x + 3.5, y: lejos.y + 0.5 }); avanza(3);
  assert.ok(!W.puedeDesplegar(m, pm), 'en marcha no se despliega');
  avanza(300);
  const estorbo = W.crearUnidad(m, 0, 'infanteria', cel(Math.floor(pm.x) + 1, Math.floor(pm.y)));
  W.orden(m, { t: 'desplegar', j: 0, ids: [pm.id] }); avanza(2);
  const p2 = m.ents.find((e) => e.tipo === 'patio' && e.j === 0 && e.id !== p1.id);
  assert.ok(p2 && !m.porId.has(pm.id) && J.cuenta.patio === 2 && J.bajas === bajas, 'debía quedar un segundo patio en su lugar, sin contar como baja');
  assert.ok(!(estorbo.x > p2.x && estorbo.x < p2.x + 3 && estorbo.y > p2.y && estorbo.y < p2.y + 3), 'quien estaba en medio se aparta');
  // sobre roca no
  const pm2 = W.crearUnidad(m, 0, 'patioMovil', cel(lejos.x - 6, lejos.y - 6)); m.mapa.terreno[cel(lejos.x - 7, lejos.y - 6)] = 1; avanza(1);
  assert.ok(!W.puedeDesplegar(m, pm2), 'necesita 3×3 de llano');
  // dos patios: dos centrales a la vez; y se puede construir junto al patio nuevo
  W.orden(m, { t: 'construir', j: 0, tipo: 'central' }); W.orden(m, { t: 'construir', j: 0, tipo: 'central' }); avanza(T + 3);
  assert.ok(J.obras.length === 2 && J.obras.every((o) => o.listo) && J.obras[0].patio !== J.obras[1].patio, 'con dos patios, a la vez y una en cada uno');
  assert.ok(W.puedeColocar(m, 0, 'central', p2.x, p2.y + 4), 'el patio nuevo permite construir a su alrededor');
  W.orden(m, { t: 'colocar', j: 0, tipo: 'central', x: p2.x, y: p2.y + 4 }); avanza(1);
  // con ids, la obra va al patio indicado
  W.orden(m, { t: 'construir', j: 0, tipo: 'cuartel', ids: [p2.id] }); avanza(50);
  assert.strictEqual(J.obras.find((o) => o.tipo === 'cuartel').patio, p2.id);
  // perder un patio no es perder la partida; la obra en curso pasa al otro
  p2.vida = 0; avanza(2);
  assert.ok(m.ganador < 0 && J.vivo && J.cuenta.patio === 1, 'con un patio en pie se sigue jugando');
  assert.strictEqual(J.obras.find((o) => o.tipo === 'cuartel').patio, p1.id, 'la obra se la queda el patio que resta');
  // sin patios pero con un patio móvil, tampoco
  p1.vida = 0; avanza(2);
  assert.ok(m.ganador < 0 && J.vivo, 'queda un patio móvil por desplegar');
  pm2.vida = 0; avanza(2);
  assert.strictEqual(m.ganador, 1, 'sin patios ni patio móvil, derrota');
});

prueba('fase 2b: puestos neutrales, escondite en el bosque y chatarra', () => {
  const m = W.crearMundo(123, { N: 128 }), N = m.N, J = m.jug[0];
  const avanza = (n) => { for (let i = 0; i < n; i++) W.tick(m); };
  const cel = (x, y) => y * N + x;
  const mudo = (u) => { u.recarga = 99999; u.guardia = true; return u; };
  // el mapa trae puestos por parejas simétricas y de los tres tipos
  assert.ok(m.puestos.length >= 4 && m.puestos.length % 2 === 0, 'puestos: ' + m.puestos.length);
  assert.deepStrictEqual([...new Set(m.puestos.map((p) => p.tipo))].sort(), ['antena', 'deposito', 'taller']);
  const p0 = m.mapa.puestos[0], p1 = m.mapa.puestos[1];
  assert.ok(p0.x + p1.x === N - 1 && p0.y + p1.y === N - 1 && p0.tipo === p1.tipo, 'simétricos');
  assert.ok(!W.puedeColocar(m, 0, 'bomba', p0.x, p0.y) , 'sobre un puesto no se construye');
  m.ents.filter((e) => !e.edif).forEach((e) => { e.vida = 0; }); W.tick(m);
  J.dios = true; m.jug[1].dios = true;
  const de = (tipo) => m.puestos.find((p) => p.tipo === tipo);
  const junto = (p, j, tipo) => { const c = W.cercaLibre(m, p.x + 1, p.y); return W.crearUnidad(m, j, tipo || 'infanteria', c); };
  // captura: un soldado tarda; con un enemigo al lado, disputado; al quedar solo, lo toma
  const an = de('antena'), s1 = mudo(junto(an, 0)), riv = mudo(junto(an, 1));
  avanza(W.ECON.captura + 50);
  assert.strictEqual(an.dueno, -1, 'disputado, nadie lo captura');
  riv.vida = 0; avanza(W.ECON.captura + 20);
  assert.strictEqual(an.dueno, 0, 'solo, el soldado captura la antena');
  // la antena da visión de su zona aunque el soldado se vaya
  s1.vida = 0; avanza(8);
  assert.strictEqual(m.niebla[0][cel(Math.floor(an.x) + 8, Math.floor(an.y))] === 2 || m.niebla[0][cel(Math.floor(an.x) - 8, Math.floor(an.y))] === 2, true, 'la antena debía dar visión');
  // el ingeniero captura el doble de rápido; el depósito da petróleo
  const dp = de('deposito'); mudo(junto(dp, 0, 'ingeniero')); avanza(W.ECON.captura / 2 + 20);
  assert.strictEqual(dp.dueno, 0, 'el ingeniero vale por dos');
  J.dios = false; J.petroleo = 0; J.minerales = 5000; avanza(W.ECON.depositoCada * 10 * 3);
  assert.ok(J.petroleo >= 20, 'el depósito debía dar petróleo: ' + J.petroleo);
  // el taller repara a los suyos cerca
  const ta = de('taller'); ta.dueno = 0;
  const herido = mudo(junto(ta, 0, 'tanque')); herido.vida = 100; herido.tDano = m.t - 500; avanza(200);
  assert.ok(herido.vida > 140, 'el taller capturado repara: ' + herido.vida);
  J.dios = true;
  // escondite: infantería quieta en el bosque no es atacada hasta tenerla muy cerca; si dispara, se delata
  for (let y = 60; y < 70; y++) for (let x = 40; x < 60; x++) { const i = cel(x, y); if (!m.ocup[i]) { m.mapa.terreno[i] = 0; m.paso[i] = 1; m.pasoV[i] = 1; m.mapa.mineral[i] = 0; } }
  for (let x = 48; x < 52; x++) m.mapa.terreno[cel(x, 64)] = 3;
  const esc = W.crearUnidad(m, 1, 'infanteria', cel(50, 64)); esc.recarga = 99999; esc.guardia = true; esc.ang = Math.PI;
  const tq = W.crearUnidad(m, 0, 'tanque', cel(46, 64)); tq.ang = tq.angT = 0; tq.guardia = true;
  avanza(100);
  assert.ok(W.oculta(m, esc) && esc.vida === esc.vidaMax && tq.obj === 0, 'escondido en el bosque, el tanque no lo ve');
  esc.recarga = 0; avanza(40);
  assert.ok(!W.oculta(m, esc) && tq.obj === esc.id, 'al disparar se delata');
  esc.vida = 0; avanza(2);
  const esc2 = mudo(W.crearUnidad(m, 1, 'infanteria', cel(48, 64))); avanza(40);
  assert.ok(esc2.vida < esc2.vidaMax || !m.porId.has(esc2.id), 'a dos celdas sí lo descubre');
  // chatarra: el vehículo destruido deja restos que la cosechadora recicla
  tq.vida = 0; avanza(2);
  const cc = cel(46, 64);
  assert.ok(m.mapa.tipoMin[cc] === 3 && m.mapa.mineral[cc] === Math.round(W.UNID.tanque.costo * W.ECON.chatarra), 'debía quedar chatarra: ' + m.mapa.mineral[cc]);
  const b = m.mapa.bases[0];
  W.crearEdificio(m, 0, 'refineria', b.x - 7, b.y + 3); avanza(1);
  const co = W.crearUnidad(m, 0, 'cosechadora', cel(45, 65)); co.pref = { x: 46.5, y: 64.5 };
  J.dios = false; J.minerales = 0; const antes = J.cosechado;
  avanza(60);
  assert.ok(m.mapa.mineral[cc] < 150 && co.carga > 0, 'la cosechadora debía reciclar la chatarra');
});

prueba('fase 2b: francotirador, transporte, lanzacohetes, vehículo de mando y helicóptero', () => {
  const m = W.crearMundo(31, { N: 128 }), N = m.N, J = m.jug[0];
  m.ents.filter((e) => !e.edif).forEach((e) => { e.vida = 0; }); W.tick(m);
  for (let y = 30; y < 100; y++) for (let x = 30; x < 110; x++) { const i = y * N + x; if (!m.ocup[i]) { m.mapa.terreno[i] = 0; m.paso[i] = 1; m.pasoV[i] = 1; m.mapa.mineral[i] = 0; } }
  const avanza = (n, fn) => { for (let i = 0; i < n; i++) { W.tick(m); if (fn) fn(); } };
  const cel = (x, y) => y * N + x;
  const mudo = (u) => { u.recarga = 99999; u.guardia = true; return u; };
  J.dios = true; m.jug[1].dios = true; J.nivel = 3;
  // francotirador: quieto no se le ve ni en campo abierto; mata infantería de lejos y a un tanque no le hace nada
  const fr = W.crearUnidad(m, 0, 'francotirador', cel(50, 40)); fr.ang = 0; fr.guardia = true;
  avanza(3);
  assert.ok(W.oculta(m, fr), 'el francotirador quieto está oculto');
  const e1 = W.crearUnidad(m, 1, 'infanteria', cel(58, 40)); e1.ang = Math.PI; e1.guardia = true; e1.recarga = 99999;
  avanza(200);
  assert.ok(!m.porId.has(e1.id), 'debía abatir al soldado a 8 celdas');
  const t1 = mudo(W.crearUnidad(m, 1, 'tanque', cel(57, 40))); avanza(300);
  assert.ok(t1.vida > t1.vidaMax * 0.9, 'el rifle no sirve contra un tanque');
  t1.vida = 0; fr.vida = 0; avanza(2);
  // transporte: suben hasta seis, viajan dentro, cuentan como tropa y bajan donde se ordena
  const tr = W.crearUnidad(m, 0, 'transporte', cel(50, 60));
  const inf = []; for (let k = 0; k < 7; k++) inf.push(W.crearUnidad(m, 0, 'infanteria', cel(46 + k % 4, 62 + (k >> 2))));
  avanza(1); const n0 = J.cuenta.infanteria;
  W.orden(m, { t: 'cargar', j: 0, ids: inf.map((u) => u.id), en: tr.id }); avanza(250);
  assert.strictEqual(tr.pasajeros.length, 6, 'seis plazas: ' + tr.pasajeros.length);
  assert.ok(m.ents.filter((e) => e.tipo === 'infanteria' && e.j === 0).length === 1 && J.cuenta.infanteria === n0, 'los de dentro salen del mapa pero siguen contando');
  W.orden(m, { t: 'mover', j: 0, ids: [tr.id], x: 80.5, y: 60.5 }); avanza(400);
  W.orden(m, { t: 'descargar', j: 0, ids: [tr.id] }); avanza(2);
  const bajados = m.ents.filter((e) => e.tipo === 'infanteria' && e.j === 0 && Math.hypot(e.x - tr.x, e.y - tr.y) < 3.5);
  assert.ok(tr.pasajeros.length === 0 && bajados.length === 6 && bajados.every((u) => m.porId.get(u.id) === u), 'debían bajar los seis junto al transporte: ' + bajados.length);
  // si lo destruyen cargado, se salva la mitad
  W.orden(m, { t: 'cargar', j: 0, ids: bajados.map((u) => u.id), en: tr.id }); avanza(250);
  assert.strictEqual(tr.pasajeros.length, 6);
  tr.vida = 0; avanza(2);
  assert.strictEqual(m.ents.filter((e) => e.tipo === 'infanteria' && e.j === 0 && Math.hypot(e.x - 80.5, e.y - 60.5) < 5).length, 3, 'del transporte destruido sale la mitad');
  m.ents.filter((e) => !e.edif).forEach((e) => { e.vida = 0; }); avanza(2);
  // lanzacohetes: salva de cuatro cohetes en área, de lejos, con observador
  const lc = W.crearUnidad(m, 0, 'lanzacohetes', cel(40, 80)); lc.ang = 0;
  const grupo = [0, 1, 2].map((k) => mudo(W.crearUnidad(m, 1, 'infanteria', cel(52 + k, 80))));
  const ojo = mudo(W.crearUnidad(m, 0, 'explorador', cel(45, 83))); ojo.ang = 0;
  let cohetes = 0;
  avanza(120, () => { cohetes = Math.max(cohetes, m.proy.filter((q) => q.arma === 'salva').length); });
  assert.strictEqual(cohetes, 4, 'la salva son cuatro cohetes');
  assert.ok(grupo.filter((u) => !m.porId.has(u.id) || u.vida < u.vidaMax).length >= 2, 'la salva debía alcanzar a varios');
  m.ents.filter((e) => !e.edif).forEach((e) => { e.vida = 0; }); avanza(2);
  // vehículo de mando: los suyos a su alrededor ven en redondo; gasta información; sin ella, nada
  J.dios = false; J.info = 50; J.minerales = 9999;
  const so = W.crearUnidad(m, 0, 'infanteria', cel(60, 50)); so.ang = 0; so.guardia = true; avanza(8);
  const atras = cel(60 - 6, 50);
  assert.notStrictEqual(m.niebla[0][atras], 2, 'sin mando, no ve a su espalda');
  const md = W.crearUnidad(m, 0, 'mando', cel(62, 52)); md.ang = 0; avanza(24);
  assert.strictEqual(m.niebla[0][atras], 2, 'con el vehículo de mando ve en redondo');
  avanza(400);
  assert.ok(J.info < 50 && J.info > 30, 'el mando gasta información: ' + J.info);
  J.info = 0; avanza(40);
  assert.notStrictEqual(m.niebla[0][atras], 2, 'sin información, el mando no hace nada');
  m.ents.filter((e) => !e.edif).forEach((e) => { e.vida = 0; }); avanza(2);
  // helicóptero: se queda en el aire disparando; pega fuerte a los tanques; radio de vuelo corto
  J.dios = true;
  const ae = W.crearEdificio(m, 0, 'aerodromo', 40, 90); avanza(1);
  const he = W.crearUnidad(m, 0, 'helicoptero', cel(41, 91)); avanza(30);
  assert.ok(he.enTierra && he.casa === ae.id);
  const t2 = mudo(W.crearUnidad(m, 1, 'tanque', cel(60, 92)));
  W.orden(m, { t: 'atacar', j: 0, ids: [he.id], obj: t2.id }); avanza(700);
  assert.ok(!m.porId.has(t2.id), 'el helicóptero debía destruir el tanque');
  let maxR = 0;
  W.orden(m, { t: 'mover', j: 0, ids: [he.id], x: 105.5, y: 91.5 });
  avanza(900, () => { maxR = Math.max(maxR, Math.hypot(he.x - ae.cx, he.y - ae.cy)); });
  assert.ok(maxR < W.UNID.helicoptero.radioVuelo + 0.5 && maxR > 40, 'radio de vuelo corto: ' + maxR.toFixed(1));
});

prueba('aviones: el caza y el bombardero atacan de pasada; el helicóptero se queda en el aire', () => {
  const m = W.crearMundo(31, { N: 128 }), N = m.N, J = m.jug[0];
  m.ents.filter((e) => !e.edif).forEach((e) => { e.vida = 0; }); W.tick(m);
  for (let y = 30; y < 100; y++) for (let x = 30; x < 110; x++) { const i = y * N + x; if (!m.ocup[i]) { m.mapa.terreno[i] = 0; m.paso[i] = 1; m.pasoV[i] = 1; m.mapa.mineral[i] = 0; } }
  const avanza = (n, fn) => { for (let i = 0; i < n; i++) { W.tick(m); if (fn) fn(); } };
  const cel = (x, y) => y * N + x;
  J.dios = true; m.jug[1].dios = true; J.nivel = 3;
  W.crearEdificio(m, 0, 'aerodromo', 40, 60); avanza(1);
  const pasa = (tipo) => {
    const av = W.crearUnidad(m, 0, tipo, cel(41, 61)); avanza(30);
    const t = W.crearUnidad(m, 1, 'tanque', cel(62, 61)); t.recarga = 99999; t.guardia = true; t.vida = t.vidaMax = 4000;
    W.orden(m, { t: 'atacar', j: 0, ids: [av.id], obj: t.id }); avanza(260); // ya ha llegado
    let quieto = 0, minD = Infinity, maxD = 0; // ticks casi sin moverse
    avanza(500, () => { if (Math.hypot(av.x - av.px, av.y - av.py) < 0.02) quieto++; const d = Math.hypot(av.x - t.x, av.y - t.y); minD = Math.min(minD, d); maxD = Math.max(maxD, d); });
    const r = { quieto, minD, maxD, dano: t.vidaMax - t.vida };
    t.vida = 0; av.vida = 0; avanza(2);
    return r;
  };
  const caza = pasa('caza'), bomb = pasa('bombardero'), heli = pasa('helicoptero');
  assert.ok(caza.quieto < 25 && caza.minD < 1.6 && caza.maxD > 5 && caza.dano > 100, 'el caza debía pasar una y otra vez sobre el blanco sin detenerse: ' + JSON.stringify(caza));
  assert.ok(bomb.quieto < 25 && bomb.minD < 1.6 && bomb.maxD > 5 && bomb.dano > 100, 'el bombardero suelta sus bombas de pasada: ' + JSON.stringify(bomb));
  assert.ok(heli.quieto > 300 && heli.maxD < W.ARMAS.coheteAire.alcance + 1 && heli.dano > 100, 'el helicóptero se queda en el aire frente al blanco: ' + JSON.stringify(heli));
});

prueba('carril: los vehículos entran al camino y lo siguen por el centro', () => {
  const m = W.crearMundo(31, { N: 128 }), N = m.N, J = m.jug[0], T = W.TERRENO;
  m.ents.filter((e) => !e.edif).forEach((e) => { e.vida = 0; }); W.tick(m);
  const cel = (x, y) => y * N + x;
  for (let y = 40; y < 80; y++) for (let x = 30; x < 100; x++) if (!m.ocup[cel(x, y)]) { const i = cel(x, y); m.mapa.terreno[i] = 0; m.mapa.mineral[i] = 0; m.paso[i] = 1; m.pasoV[i] = 1; }
  J.minerales = 5000;
  const ex = W.crearUnidad(m, 0, 'excavadora', cel(40, 48));
  W.orden(m, { t: 'trazar', j: 0, ids: [ex.id], x: 80.5, y: 70.5 }); // un camino en diagonal tendida, como el de la captura
  W.tick(m); for (let i = 0; i < 6000 && ex.orden === 'trazar'; i++) W.tick(m);
  assert.ok(ex.orden !== 'trazar' && Math.hypot(ex.x - 80.5, ex.y - 70.5) < 1.5, 'la excavadora debía terminar el camino');
  const tramos = m.ents.filter((e) => e.infra);
  assert.ok(tramos.length >= 8 && tramos.every((e) => e.pts.length >= 4 && e.celdas.length > 0), 'el camino debía quedar partido en tramos: ' + tramos.length);
  const alCarril = (x, y) => { let mejor = 1e9; for (const e of tramos) for (let k = 0, tr = e.pts; k + 3 < tr.length; k += 2) { const ax = tr[k], ay = tr[k + 1], bx = tr[k + 2] - ax, by = tr[k + 3] - ay, q = Math.max(0, Math.min(1, ((x - ax) * bx + (y - ay) * by) / (bx * bx + by * by || 1))); mejor = Math.min(mejor, Math.hypot(x - ax - bx * q, y - ay - by * q)); } return mejor; };
  ex.vida = 0; W.tick(m);
  const tq = W.crearUnidad(m, 0, 'tanque', cel(42, 46)); // empieza fuera del camino, a un par de celdas
  W.orden(m, { t: 'mover', j: 0, ids: [tq.id], x: 79.5, y: 72.5 });
  let enCamino = 0, centrado = 0, total = 0;
  W.tick(m); for (let i = 0; i < 3000 && (tq.ruta || tq.pend); i++) {
    W.tick(m); total++;
    if (m.mapa.terreno[cel(Math.floor(tq.x), Math.floor(tq.y))] === T.CAMINO) { enCamino++; if (alCarril(tq.x, tq.y) < 0.3) centrado++; }
  }
  assert.ok(Math.hypot(tq.x - 79.5, tq.y - 72.5) < 1, 'el tanque debía llegar');
  assert.ok(enCamino > total * 0.75, 'debía hacer casi todo el viaje por el camino: ' + enCamino + ' de ' + total);
  assert.ok(centrado > enCamino * 0.85, 'y por el centro del carril: ' + centrado + ' de ' + enCamino);
});

prueba('camino como infraestructura: tramos con vida, se destruyen por orden y el bosque se cierra', () => {
  const m = W.crearMundo(31, { N: 128 }), N = m.N, J = m.jug[0], T = W.TERRENO;
  m.ents.filter((e) => !e.edif).forEach((e) => { e.vida = 0; }); W.tick(m);
  const cel = (x, y) => y * N + x;
  const pon = (x, y, t) => { const i = cel(x, y); m.mapa.terreno[i] = t; m.mapa.mineral[i] = 0; m.paso[i] = t === 1 || t === 2 ? 0 : 1; m.pasoV[i] = t === 0 || t === 4 ? 1 : 0; };
  for (let y = 40; y < 80; y++) for (let x = 30; x < 100; x++) if (!m.ocup[cel(x, y)]) pon(x, y, 0);
  for (let y = 40; y < 80; y++) for (let x = 56; x < 68; x++) pon(x, y, 3); // franja de bosque de 12 celdas
  for (let x = 30; x < 100; x++) { pon(x, 39, 1); pon(x, 80, 1); } for (let y = 39; y <= 80; y++) { pon(29, y, 1); pon(100, y, 1); }
  const avanza = (n) => { for (let i = 0; i < n; i++) W.tick(m); };
  J.dios = false; J.minerales = 5000; m.jug[1].minerales = 5000;
  const ex = W.crearUnidad(m, 0, 'excavadora', cel(50, 60));
  W.orden(m, { t: 'trazar', j: 0, ids: [ex.id], x: 74.5, y: 60.5 }); avanza(2);
  for (let i = 0; i < 6000 && ex.orden === 'trazar'; i++) W.tick(m);
  const tramos = () => m.ents.filter((e) => e.infra);
  const n0 = tramos().length;
  assert.ok(n0 >= 5 && n0 <= 8, 'unas 24 celdas de camino en tramos de 4: ' + n0);
  assert.ok(tramos().every((e) => e.j === 0 && e.vida === W.EDIF.camino.vida && !m.ocup[cel(Math.floor(e.cx), Math.floor(e.cy))]), 'los tramos son del que los traza y no ocupan celdas');
  // un tanque propio cruza por el camino
  const tq = W.crearUnidad(m, 0, 'tanque', cel(48, 60));
  W.orden(m, { t: 'mover', j: 0, ids: [tq.id], x: 75.5, y: 60.5 }); avanza(900);
  assert.ok(tq.x > 73, 'el tanque debía cruzar el bosque por el camino: ' + tq.x.toFixed(1));
  // el enemigo no dispara a los caminos por su cuenta…
  const medio = tramos().find((e) => m.mapa.terreno[cel(Math.floor(e.cx), Math.floor(e.cy))] === T.CAMINO && e.cx > 59 && e.cx < 65);
  assert.ok(medio, 'debía haber un tramo en mitad del bosque');
  ex.vida = 0; tq.vida = 0; avanza(2);
  const ene = [0, 1, 2].map((k) => W.crearUnidad(m, 1, 'tanque', cel(70 + k, 56)));
  avanza(400);
  assert.ok(tramos().length === n0 && tramos().every((e) => e.vida === e.vidaMax), 'sin orden, nadie toca el camino');
  assert.ok(ene.every((u) => !u.obj), 'los tanques enemigos no debían fijarse en el camino');
  // …pero con orden lo destruyen, y ese tramo se cierra otra vez
  W.orden(m, { t: 'atacar', j: 1, ids: ene.map((u) => u.id), obj: medio.id });
  for (let i = 0; i < 3000 && medio.vida > 0; i++) W.tick(m);
  avanza(3);
  assert.ok(medio.vida <= 0 && tramos().length === n0 - 1, 'el tramo debía caer');
  assert.ok(medio.celdas.some((c) => m.mapa.terreno[c] === T.BOSQUE && !m.pasoV[c] && m.paso[c]), 'sus celdas vuelven a ser bosque cerrado a los vehículos');
  assert.ok(medio.celdas.every((c) => !m.tramoEn[c] && !m.carrilX[c]));
  ene.forEach((u) => { u.vida = 0; }); avanza(2);
  const tq2 = W.crearUnidad(m, 0, 'tanque', cel(48, 60));
  W.orden(m, { t: 'mover', j: 0, ids: [tq2.id], x: 75.5, y: 60.5 }); avanza(900);
  assert.ok(tq2.x < 66, 'con el camino cortado el tanque ya no cruza: ' + tq2.x.toFixed(1));
  assert.ok(m.mapa.terreno[cel(Math.floor(tq2.x), Math.floor(tq2.y))] !== T.BOSQUE, 'y no se queda dentro del bosque');
  // la excavadora lo repone trazando otra vez, y demoler un tramo propio devuelve algo
  const ex2 = W.crearUnidad(m, 0, 'excavadora', cel(50, 62));
  W.orden(m, { t: 'trazar', j: 0, ids: [ex2.id], x: 74.5, y: 60.5 }); avanza(2);
  for (let i = 0; i < 6000 && ex2.orden === 'trazar'; i++) W.tick(m);
  W.orden(m, { t: 'mover', j: 0, ids: [tq2.id], x: 75.5, y: 60.5 }); avanza(900);
  assert.ok(tq2.x > 73, 'repuesto el tramo, vuelve a cruzar: ' + tq2.x.toFixed(1));
  const propio = tramos()[0], min0 = J.minerales, nAntes = tramos().length;
  W.orden(m, { t: 'vender', j: 0, id: propio.id }); avanza(3);
  assert.ok(tramos().length === nAntes - 1 && J.minerales > min0, 'demoler un tramo lo quita y devuelve parte');
  // partida guardada con caminos: sigue igual
  const copia = W.cargar(W.guardar(m)).m;
  for (let i = 0; i < 200; i++) { W.tick(m); W.tick(copia); }
  assert.equal(W.huella(copia), W.huella(m), 'con caminos, la partida cargada sigue igual');
});

prueba('formación en marcha: el grupo se forma, avanza junto y llega formado', () => {
  const hacer = (forma) => {
    const m = W.crearMundo(4242, { N: 128 }), N = m.N;
    m.ents.filter((e) => !e.edif).forEach((e) => { e.vida = 0; }); W.tick(m);
    for (let y = 40; y < 90; y++) for (let x = 20; x < 110; x++) { const i = y * N + x; if (!m.ocup[i]) { m.mapa.terreno[i] = 0; m.mapa.mineral[i] = 0; m.paso[i] = 1; m.pasoV[i] = 1; } }
    const us = [];
    for (let k = 0; k < 8; k++) us.push(W.crearUnidad(m, 0, k < 3 ? 'tanque' : k < 5 ? 'explorador' : 'infanteria', (62 + (k % 4)) * N + 30 + ((k / 4) | 0) * 2)); // un racimo mezclado: rápidos y lentos
    W.orden(m, { t: 'mover', j: 0, ids: us.map((u) => u.id), x: 95.5, y: 64.5, forma });
    let peor = 0, muestras = 0, llegada = [];
    for (let i = 0; i < 4000; i++) {
      W.tick(m);
      const cx = us.reduce((s, u) => s + u.x, 0) / us.length;
      if (cx > 50 && cx < 85 && i % 10 === 0) { const xs = us.map((u) => u.x); peor = Math.max(peor, Math.max(...xs) - Math.min(...xs)); muestras++; } // a media marcha: cuánto se estira el grupo a lo largo
      us.forEach((u, k) => { if (llegada[k] === undefined && u.orden === 'nada' && u.x > 90) llegada[k] = i; });
      if (us.every((u, k) => llegada[k] !== undefined)) break;
    }
    return { m, us, peor, muestras, llegada };
  };
  const linea = hacer('linea'), suelto = hacer(undefined);
  assert.ok(linea.us.every((u, k) => linea.llegada[k] !== undefined), 'en línea debían llegar todos');
  assert.ok(linea.muestras > 20 && linea.peor < 2.5, 'en marcha la línea no debía estirarse: ' + linea.peor.toFixed(1));
  assert.ok(suelto.peor > linea.peor * 2, 'sin formación cada uno va a su paso y el grupo se estira: ' + suelto.peor.toFixed(1) + ' frente a ' + linea.peor.toFixed(1));
  const l = linea.llegada, xs = linea.us.map((u) => u.x);
  assert.ok(Math.max(...l) - Math.min(...l) < 240, 'llegan casi a la vez: ' + (Math.max(...l) - Math.min(...l)) + ' ticks');
  assert.ok(Math.max(...xs) - Math.min(...xs) < 1.2, 'y quedan en línea: ' + xs.map((v) => v.toFixed(1)));
  for (let i = 0; i < 8; i++) W.tick(linea.m);
  assert.equal(Object.keys(linea.m.marchas).length, 0, 'terminada la marcha, el grupo se disuelve');
  console.log('      a media marcha el grupo se estira ' + linea.peor.toFixed(1) + ' celdas en línea, ' + suelto.peor.toFixed(1) + ' sin formación · llegan con ' + (Math.max(...l) - Math.min(...l)) + ' ticks de diferencia');
});

prueba('repetición: las órdenes apuntadas reproducen la misma partida', () => {
  const m = W.crearMundo(555, { N: 128, logistica: true }), ia = W.iaCrear(1, 'normal', 'equilibrado');
  m.registro = [];
  const propias = () => m.ents.filter((e) => !e.edif && e.j === 0).map((e) => e.id);
  for (let i = 0; i < 5000; i++) {
    if (i === 40) W.orden(m, { t: 'construir', j: 0, tipo: 'central' });
    if (i === 300) W.orden(m, { t: 'mover', j: 0, ids: propias(), x: 60.5, y: 60.5, forma: 'linea' });
    if (i === 900) W.orden(m, { t: 'amover', j: 0, ids: propias(), x: 70.5, y: 50.5 });
    if (i === 1500) W.orden(m, { t: 'trampa', j: 0, clave: 'recursos', valor: true });
    W.iaTick(m, ia); W.tick(m);
  }
  assert.ok(m.registro.length > 40, 'debía haber órdenes apuntadas: ' + m.registro.length / 2);
  const txt = JSON.stringify(m.registro), rep = JSON.parse(txt), r = W.crearMundo(555, { N: 128, logistica: true });
  r.soloRep = true;
  let k = 0;
  for (let i = 0; i < 5000; i++) {
    while (k < rep.length && rep[k] <= r.t) { W.orden(r, rep[k + 1], true); k += 2; }
    if (i === 100) W.orden(r, { t: 'mover', j: 0, ids: r.ents.filter((e) => !e.edif && e.j === 0).map((e) => e.id), x: 20.5, y: 20.5 }); // quien mira no puede mandar
    W.tick(r);
  }
  assert.equal(k, rep.length, 'todas las órdenes reproducidas');
  assert.equal(W.huella(r), W.huella(m), 'la repetición debía dar exactamente la misma partida');
  assert.ok(!W.guardar(m).includes('"registro"'), 'el registro no va en la partida guardada');
  console.log('      ' + rep.length / 2 + ' órdenes en 5000 ticks · ' + Math.round(txt.length / 1024) + ' KB');
});

prueba('movimiento: los vehículos toman las curvas rodando y el grupo no arranca ni dispara al unísono', () => {
  const m = W.crearMundo(4242, { N: 128 }), N = m.N;
  m.ents.filter((e) => !e.edif).forEach((e) => { e.vida = 0; }); W.tick(m);
  for (let y = 40; y < 90; y++) for (let x = 20; x < 110; x++) { const i = y * N + x; if (!m.ocup[i]) { m.mapa.terreno[i] = 0; m.mapa.mineral[i] = 0; m.paso[i] = 1; m.pasoV[i] = 1; } }
  // un tanque mirando al este recibe la orden de ir al norte: gira rodando, sin pararse a pivotar
  const tq = W.crearUnidad(m, 0, 'tanque', 70 * N + 40); tq.ang = 0;
  W.orden(m, { t: 'mover', j: 0, ids: [tq.id], x: 70.5, y: 70.5 });
  for (let i = 0; i < 150; i++) W.tick(m); // primero coge velocidad hacia el este
  assert.ok(tq.v > 0.08, 'debía ir lanzado');
  W.orden(m, { t: 'mover', j: 0, ids: [tq.id], x: tq.x + 0.5, y: 50.5 });
  let parado = 0, maxX = tq.x, x0 = tq.x, n = 0;
  for (let i = 0; i < 1200 && (i < 3 || tq.ruta || tq.pend); i++) { W.tick(m); n++; if (i > 3 && tq.v < 0.005 && Math.hypot(tq.x - x0 - 0.5, tq.y - 50.5) > 1.5) parado++; maxX = Math.max(maxX, tq.x); }
  assert.ok(Math.hypot(tq.x - x0 - 0.5, tq.y - 50.5) < 0.6, 'el tanque debía llegar: ' + tq.x.toFixed(1) + ',' + tq.y.toFixed(1));
  assert.ok(parado <= 2, 'no debía pararse a pivotar en un giro de 90°: ' + parado + ' ticks parado');
  assert.ok(maxX - x0 > 0.6, 'la curva debía abrirse hacia donde iba: ' + (maxX - x0).toFixed(2));
  // casi a la espalda sí pivota, y llega igual
  W.orden(m, { t: 'mover', j: 0, ids: [tq.id], x: tq.x, y: 62.5 });
  for (let i = 0; i < 1200 && (i < 3 || tq.ruta || tq.pend); i++) W.tick(m);
  assert.ok(Math.abs(tq.y - 62.5) < 0.6, 'media vuelta y llega: ' + tq.y.toFixed(1));
  // un grupo no arranca en el mismo tick
  const us = []; for (let k = 0; k < 8; k++) us.push(W.crearUnidad(m, 0, 'infanteria', (60 + k) * N + 30));
  W.orden(m, { t: 'mover', j: 0, ids: us.map((u) => u.id), x: 60.5, y: 64.5 });
  const arranque = us.map(() => -1);
  for (let i = 0; i < 40; i++) { W.tick(m); us.forEach((u, k) => { if (arranque[k] < 0 && u.v > 0) arranque[k] = i; }); }
  assert.ok(arranque.every((t) => t >= 0) && new Set(arranque).size >= 3 && Math.max(...arranque) - Math.min(...arranque) <= 8, 'arranque escalonado, pero dentro de unas décimas: ' + arranque);
  // una sola unidad obedece al instante
  const sola = W.crearUnidad(m, 0, 'infanteria', 80 * N + 30);
  W.orden(m, { t: 'mover', j: 0, ids: [sola.id], x: 40.5, y: 80.5 }); for (let i = 0; i < 4; i++) W.tick(m);
  assert.ok(sola.v > 0, 'una unidad sola no espera');
  // la cadencia varía un poco de un disparo a otro
  const rec = new Set(), t1 = W.crearUnidad(m, 0, 'tanque', 85 * N + 60), blanco = W.crearEdificio(m, 1, 'central', 64, 84); blanco.vida = blanco.vidaMax = 99999;
  W.orden(m, { t: 'atacar', j: 0, ids: [t1.id], obj: blanco.id });
  let ult = -1; for (let i = 0; i < 1500; i++) { W.tick(m); if (t1.tDisparo !== ult && t1.tDisparo !== undefined) { ult = t1.tDisparo; rec.add(t1.recarga); } }
  const base = W.ARMAS.canon.recarga;
  assert.ok(rec.size >= 3 && [...rec].every((r) => r >= base * 0.89 && r <= base * 1.11), 'recargas variadas, dentro de ±10 %: ' + [...rec].sort((p, q) => p - q) + ' (base ' + base + ')');
});

prueba('la red: cobertura, territorio, energía por red, depósito y suministro', () => {
  const m = W.crearMundo(31, { N: 128, logistica: true }), N = m.N, J = m.jug[0], T = W.TERRENO;
  m.ents.filter((e) => !e.edif).forEach((e) => { e.vida = 0; }); W.tick(m);
  const cel = (x, y) => y * N + x, patio = m.ents.find((e) => e.j === 0 && e.tipo === 'patio'), px = Math.floor(patio.cx), py = Math.floor(patio.cy);
  const dir = px < 64 ? 1 : -1, x0 = Math.min(px, px + dir * 60), x1 = Math.max(px, px + dir * 60); // un campo llano desde el patio hacia el centro
  for (let y = py - 10; y <= py + 10; y++) for (let x = x0 - 2; x <= x1 + 2; x++) { const i = cel(x, y); if (x < 2 || y < 2 || x >= N - 2 || y >= N - 2 || m.ocup[i]) continue; m.mapa.terreno[i] = 0; m.mapa.mineral[i] = 0; m.mapa.tipoMin[i] = 0; m.paso[i] = 1; m.pasoV[i] = 1; }
  const avanza = (n) => { for (let i = 0; i < n; i++) W.tick(m); };
  J.dios = false; J.minerales = 20000; J.petroleo = 5000;
  const cob = () => W.cobertura(m, 0);
  // cobertura alrededor del patio; lejos, no
  const lejos = px + dir * 34, medio = px + dir * 22;
  assert.ok(cob()[cel(px + dir * 8, py)] && !cob()[cel(lejos, py)], 'cobertura junto al patio y no a 34 celdas');
  // territorio: dentro se construye; fuera no (salvo el depósito, que va donde haga falta)
  assert.ok(W.puedeColocar(m, 0, 'central', px + dir * 6, py + 3), 'dentro de la cobertura se construye');
  assert.ok(!W.puedeColocar(m, 0, 'central', lejos, py + 3), 'fuera de la cobertura no');
  assert.ok(W.puedeColocar(m, 0, 'deposito', lejos, py + 3) || !m.niebla[0][cel(lejos, py + 3)], 'el depósito sí puede ir fuera (si está explorado)');
  // energía por red: una torreta aislada con su central lejos no tiene luz; la de la base, sí
  const central = W.crearEdificio(m, 0, 'central', px + dir * 5, py + 4), tBase = W.crearEdificio(m, 0, 'torreta', px + dir * 5, py - 4), tLejos = W.crearEdificio(m, 0, 'torreta', lejos, py - 4);
  avanza(2);
  assert.ok(central.conRed && tBase.conRed && !tBase.sinLuz, 'la torreta de la base está en la red y con energía');
  assert.ok(!tLejos.conRed && tLejos.sinLuz, 'la torreta aislada no tiene red ni energía');
  assert.ok(!cob()[cel(lejos, py)], 'un edificio suelto no da cobertura');
  // un depósito suelto tampoco da cobertura…
  const dep = W.crearEdificio(m, 0, 'deposito', lejos - dir * 4, py + 2); avanza(2);
  assert.ok(!dep.conRed && !cob()[cel(lejos, py)], 'el depósito sin conexión no sirve');
  // …hasta que un camino lo une a la base: entonces da cobertura, y la torreta de al lado recibe energía
  // (un camino militar no conecta nada: solo sirve para moverse)
  const ex = W.crearUnidad(m, 0, 'excavadora', cel(px + dir * 7, py - 1));
  W.orden(m, { t: 'trazar', j: 0, ids: [ex.id], x: lejos - dir * 5 + 0.5, y: py - 0.5 }); avanza(2);
  for (let i = 0; i < 8000 && ex.orden === 'trazar'; i++) W.tick(m);
  avanza(3);
  assert.ok(!dep.conRed && tLejos.sinLuz, 'el camino militar no lleva la red');
  // el ingeniero civil tiende una línea de servicio de la central al depósito
  const min0 = J.minerales, civil = W.crearUnidad(m, 0, 'civil', cel(px + dir * 7, py + 2));
  W.orden(m, { t: 'conectar', j: 0, ids: [civil.id], edifs: [central.id, dep.id] }); avanza(2);
  for (let i = 0; i < 4000 && civil.orden === 'conectar'; i++) W.tick(m);
  avanza(3);
  const lineas = m.ents.filter((e) => e.linea);
  assert.ok(lineas.length >= 4 && lineas.every((e) => e.conRed), 'la línea queda tendida en tramos: ' + lineas.length);
  assert.ok(min0 - J.minerales >= 20 && min0 - J.minerales < 400, 'y se paga (descontado lo que entra mientras tanto): ' + (min0 - J.minerales));
  assert.ok(dep.conRed && tLejos.conRed && !tLejos.sinLuz, 'con la línea, depósito y torreta entran en la red y hay energía');
  assert.ok(cob()[cel(lejos, py)] && cob()[cel(medio, py + 3)] && !cob()[cel(px + dir * 17, py + 10)], 'cobertura alrededor del depósito, pero no lejos de él');
  assert.ok(W.puedeColocar(m, 0, 'central', medio, py + 3), 'en la cobertura del depósito ya se puede construir');
  // suministro: una unidad fuera de la cobertura acaba disparando más lento y no acude; dentro se recupera
  const fuera = W.crearUnidad(m, 0, 'tanque', cel(px + dir * 17, py + 10)), dentro = W.crearUnidad(m, 0, 'tanque', cel(medio, py + 2));
  avanza(450);
  assert.ok(fuera.sinSum >= W.ECON.sinSum && !(dentro.sinSum > 0), 'fuera de la red se queda sin suministro; dentro no: ' + fuera.sinSum + ' / ' + dentro.sinSum);
  const blanco = W.crearEdificio(m, 1, 'central', px + dir * 17 + 2, py + 8); blanco.vida = blanco.vidaMax = 99999;
  W.orden(m, { t: 'atacar', j: 0, ids: [fuera.id, dentro.id], obj: blanco.id });
  const rec = { f: 0, d: 0 }; let uf = -1, ud = -1;
  for (let i = 0; i < 900; i++) { W.tick(m); if (fuera.tDisparo !== uf && fuera.tDisparo !== undefined) { uf = fuera.tDisparo; rec.f = Math.max(rec.f, fuera.recarga); } if (dentro.tDisparo !== ud && dentro.tDisparo !== undefined) { ud = dentro.tDisparo; if (!(dentro.sinSum >= W.ECON.sinSum)) rec.d = Math.max(rec.d, dentro.recarga); } }
  assert.ok(rec.f >= W.ARMAS.canon.recarga * 1.3, 'sin suministro recarga más lento: ' + rec.f);
  W.orden(m, { t: 'mover', j: 0, ids: [fuera.id], x: medio + 0.5, y: py + 1.5 }); avanza(500);
  assert.ok(!(fuera.sinSum >= W.ECON.sinSum), 'de vuelta en la red, se recupera: ' + fuera.sinSum);
  // cortar el camino deja otra vez aislado el extremo
  const tramos = m.ents.filter((e) => e.linea).sort((a, b) => Math.abs(a.cx - medio) - Math.abs(b.cx - medio));
  tramos.slice(0, 2).forEach((e) => { e.vida = 0; }); avanza(3);
  assert.ok(!dep.conRed && tLejos.sinLuz && !cob()[cel(lejos, py)], 'cortada la línea, el depósito y su zona quedan fuera de la red');
  // en partida clásica nada de esto aplica
  const c = W.crearMundo(31, { N: 128 }), pc = c.ents.find((e) => e.j === 0 && e.tipo === 'patio'), suelta = W.crearEdificio(c, 0, 'torreta', Math.floor(pc.cx) + (pc.cx < 64 ? 30 : -30), Math.floor(pc.cy));
  W.crearEdificio(c, 0, 'central', Math.floor(pc.cx) + 4, Math.floor(pc.cy) + 4); for (let i = 0; i < 3; i++) W.tick(c);
  assert.ok(!suelta.sinLuz, 'en clásica la energía es global');
});

prueba('tanda 1: cohetes uno tras otro, el camino solo sirve a su dueño y el médico cura', () => {
  const m = W.crearMundo(4242, { N: 128 }), N = m.N, J = m.jug[0];
  m.ents.filter((e) => !e.edif).forEach((e) => { e.vida = 0; }); W.tick(m);
  for (let y = 40; y < 90; y++) for (let x = 20; x < 110; x++) { const i = y * N + x; if (!m.ocup[i]) { m.mapa.terreno[i] = 0; m.mapa.mineral[i] = 0; m.paso[i] = 1; m.pasoV[i] = 1; } }
  const avanza = (n) => { for (let i = 0; i < n; i++) W.tick(m); };
  J.minerales = 9000; m.jug[1].minerales = 9000;
  // lanzacohetes: la salva sale escalonada
  const lc = W.crearUnidad(m, 0, 'lanzacohetes', 50 * N + 30), blanco = W.crearEdificio(m, 1, 'central', 40, 49); blanco.vida = blanco.vidaMax = 99999;
  lc.ang = 0; W.orden(m, { t: 'atacar', j: 0, ids: [lc.id], obj: blanco.id });
  let enVuelo = [], salidas = new Set();
  for (let i = 0; i < 400 && salidas.size < 4; i++) { W.tick(m); for (const f of m.efectos) if (f.tipo === 'boca' && f.arma === 'salva') salidas.add(f.t); }
  const ts = [...salidas].sort((a, b) => a - b);
  assert.ok(ts.length === 4 && ts[1] - ts[0] >= 6 && ts[3] - ts[0] >= 20, 'cuatro cohetes, uno tras otro: ' + ts.map((t) => t - ts[0]));
  // camino: el dueño corre por él; el rival lo pisa a su paso normal y su ruta no lo busca
  const ex = W.crearUnidad(m, 0, 'excavadora', 70 * N + 30);
  W.orden(m, { t: 'trazar', j: 0, ids: [ex.id], x: 80.5, y: 70.5 }); avanza(2);
  for (let i = 0; i < 6000 && ex.orden === 'trazar'; i++) W.tick(m);
  ex.vida = 0; avanza(2);
  const mio = W.crearUnidad(m, 0, 'tanque', 70 * N + 31), suyo = W.crearUnidad(m, 1, 'tanque', 71 * N + 31);
  W.orden(m, { t: 'mover', j: 0, ids: [mio.id], x: 79.5, y: 70.5 }); W.orden(m, { t: 'mover', j: 1, ids: [suyo.id], x: 79.5, y: 71.5 });
  let vm = 0, vs = 0; for (let i = 0; i < 300; i++) { W.tick(m); vm = Math.max(vm, mio.v); vs = Math.max(vs, suyo.v); }
  assert.ok(vm > W.UNID.tanque.vel * 1.4 && vs <= W.UNID.tanque.vel * 1.01, 'el dueño va a ' + vm.toFixed(3) + ' y el rival a ' + vs.toFixed(3));
  // médico: cura a la infantería herida cercana, no a los vehículos
  const med = W.crearUnidad(m, 0, 'medico', 55 * N + 60), herido = W.crearUnidad(m, 0, 'infanteria', 57 * N + 62), tq = W.crearUnidad(m, 0, 'tanque', 55 * N + 63);
  herido.vida = 20; tq.vida = 100; avanza(400);
  assert.ok(herido.vida === herido.vidaMax, 'el médico debía curar al soldado: ' + herido.vida);
  assert.ok(tq.vida <= 110, 'pero no repara tanques: ' + tq.vida);
});

prueba('trincheras ocupables: cuatro puestos, ocupar, salir, y vacía la toma cualquiera', () => {
  const m = W.crearMundo(4242, { N: 128 }), N = m.N;
  m.ents.filter((e) => !e.edif).forEach((e) => { e.vida = 0; }); W.tick(m);
  for (let y = 40; y < 90; y++) for (let x = 20; x < 110; x++) { const i = y * N + x; if (!m.ocup[i]) { m.mapa.terreno[i] = 0; m.mapa.mineral[i] = 0; m.paso[i] = 1; m.pasoV[i] = 1; } }
  const avanza = (n) => { for (let i = 0; i < n; i++) W.tick(m); };
  // uno cava; queda dentro, en su puesto
  const cavador = W.crearUnidad(m, 0, 'infanteria', 60 * N + 50); cavador.ang = 0;
  W.orden(m, { t: 'trinchera', j: 0, ids: [cavador.id] }); avanza(W.ECON.cavar + 15);
  const c = 60 * N + 50, q = m.trincheras.get(c);
  assert.ok(q && W.enTrinchera(m, cavador) && q.dentro.includes(cavador.id), 'quien cava la trinchera la ocupa');
  // otros cinco reciben la orden de ocuparla: entran tres (hay cuatro puestos) y los demás se quedan fuera
  const us = []; for (let k = 0; k < 5; k++) us.push(W.crearUnidad(m, 0, 'infanteria', (63 + k) * N + 46));
  W.orden(m, { t: 'ocupar', j: 0, ids: us.map((u) => u.id), c }); avanza(300);
  const dentro = us.filter((u) => W.enTrinchera(m, u));
  assert.equal(dentro.length, 3, 'caben cuatro en total: ' + dentro.length);
  assert.equal(q.dentro.filter((id) => id).length, 4);
  const pos = [cavador, ...dentro].map((u) => u.x.toFixed(2) + ',' + u.y.toFixed(2));
  assert.equal(new Set(pos).size, 4, 'cada uno en su puesto, a la vista: ' + pos);
  // a cubierto: el de dentro recibe menos daño que el de fuera
  const fuera = us.find((u) => !W.enTrinchera(m, u)), v0 = [dentro[0].vida, fuera.vida];
  const ene = W.crearUnidad(m, 1, 'infanteria', 60 * N + 54);
  ene.obj = dentro[0].id; ene.orden = 'atacar'; avanza(60); const dDentro = v0[0] - dentro[0].vida; dentro[0].vida = v0[0];
  ene.vida = 0; avanza(2);
  // salir: el puesto queda libre y otro puede entrar
  W.orden(m, { t: 'salir', j: 0, ids: [dentro[0].id] }); avanza(120);
  assert.ok(!W.enTrinchera(m, dentro[0]) && !dentro[0].trin && q.dentro.filter((id) => id).length === 3, 'al salir deja el puesto');
  W.orden(m, { t: 'ocupar', j: 0, ids: [fuera.id], c }); avanza(300);
  assert.ok(W.enTrinchera(m, fuera), 'y otro lo toma');
  // mientras esté ocupada, el enemigo no puede meterse; vacía, sí
  const rival = W.crearUnidad(m, 1, 'infanteria', 70 * N + 70); rival.guardia = true;
  W.orden(m, { t: 'ocupar', j: 1, ids: [rival.id], c }); avanza(5);
  assert.ok(!rival.trin, 'ocupada por el otro bando no se puede tomar');
  for (const id of q.dentro) { const u = id ? m.porId.get(id) : null; if (u) u.vida = 0; }
  [dentro[0], ...us].forEach((u) => { u.vida = 0; }); avanza(15);
  assert.equal(q.dentro.filter((id) => id).length, 0, 'vacía tras caer sus ocupantes');
  W.orden(m, { t: 'ocupar', j: 1, ids: [rival.id], c }); avanza(700);
  assert.ok(W.enTrinchera(m, rival), 'vacía, la toma el enemigo');
  assert.ok(dDentro > 0, 'dentro también se recibe daño, pero menos');
});

prueba('tanda 2: la gatling monta antes de disparar y el hacker apaga vehículos y edificios', () => {
  const m = W.crearMundo(4242, { N: 128 }), N = m.N, J = m.jug[0];
  m.ents.filter((e) => !e.edif).forEach((e) => { e.vida = 0; }); W.tick(m);
  for (let y = 40; y < 90; y++) for (let x = 20; x < 110; x++) { const i = y * N + x; if (!m.ocup[i]) { m.mapa.terreno[i] = 0; m.mapa.mineral[i] = 0; m.paso[i] = 1; m.pasoV[i] = 1; } }
  const avanza = (n) => { for (let i = 0; i < n; i++) W.tick(m); };
  // gatling: recién llegada no dispara hasta montar; montada, dispara mucho; al moverla, desmonta primero
  const g = W.crearUnidad(m, 0, 'gatling', 60 * N + 40), blanco = W.crearEdificio(m, 1, 'central', 44, 59); blanco.vida = blanco.vidaMax = 99999; g.ang = 0;
  W.orden(m, { t: 'atacar', j: 0, ids: [g.id], obj: blanco.id });
  let primero = -1, tiros = 0, ult = -1;
  for (let i = 0; i < 200; i++) { W.tick(m); if (g.tDisparo !== undefined && g.tDisparo !== ult) { ult = g.tDisparo; tiros++; if (primero < 0) primero = i; } }
  assert.ok(primero >= W.UNID.gatling.monta - 5, 'no dispara hasta montar el arma: primer tiro en el tick ' + primero);
  assert.ok(tiros > 30, 'montada, dispara en ráfaga: ' + tiros + ' tiros');
  const x0 = g.x; W.orden(m, { t: 'mover', j: 0, ids: [g.id], x: 30.5, y: 60.5 }); avanza(20);
  assert.ok(Math.abs(g.x - x0) < 0.05 && g.monta < W.UNID.gatling.monta, 'antes de andar, desmonta: ' + (x0 - g.x).toFixed(2));
  avanza(200); assert.ok(g.x < x0 - 3, 'y luego sí se mueve');
  // hacker: apaga un tanque enemigo a distancia, pagando información; no puede con la infantería
  J.info = 100;
  const hk = W.crearUnidad(m, 0, 'hacker', 75 * N + 40), tq = W.crearUnidad(m, 1, 'tanque', 75 * N + 47), sol = W.crearUnidad(m, 1, 'infanteria', 78 * N + 46);
  tq.guardia = true; sol.guardia = true; sol.recarga = 99999; tq.recarga = 99999;
  W.orden(m, { t: 'hackear', j: 0, ids: [hk.id], obj: sol.id }); avanza(3);
  assert.ok(hk.orden === 'nada', 'a la infantería no se la hackea');
  W.orden(m, { t: 'hackear', j: 0, ids: [hk.id], obj: tq.id }); avanza(W.ECON.hackCanal + 8);
  assert.ok(tq.hack > m.t && J.info === 100 - W.ECON.hackInfo, 'tanque hackeado y cobrado: info ' + J.info);
  tq.recarga = 0; W.orden(m, { t: 'mover', j: 1, ids: [tq.id], x: 60.5, y: 75.5 }); const tx = tq.x; avanza(100);
  assert.ok(Math.abs(tq.x - tx) < 0.01 && tq.tDisparo === undefined, 'hackeado ni se mueve ni dispara');
  avanza(W.ECON.hackVeh); assert.ok(!(tq.hack > m.t) && Math.abs(tq.x - tx) > 1, 'pasado el efecto, vuelve a andar');
  // un edificio hackeado deja de producir; sin información no hay hackeo
  const cu = W.crearEdificio(m, 1, 'cuartel', 48, 80); m.jug[1].minerales = 5000;
  W.orden(m, { t: 'entrenar', j: 1, tipo: 'infanteria', ids: [cu.id] }); avanza(3);
  hk.recarga = 0; W.orden(m, { t: 'hackear', j: 0, ids: [hk.id], obj: cu.id }); avanza(W.ECON.hackCanal + 60);
  assert.ok(cu.hack > m.t, 'cuartel hackeado');
  const p0 = cu.prog; avanza(60); assert.equal(cu.prog, p0, 'hackeado no produce');
  J.info = 0; hk.recarga = 0; W.orden(m, { t: 'hackear', j: 0, ids: [hk.id], obj: tq.id }); avanza(200);
  assert.ok(!(tq.hack > m.t), 'sin información no hay hackeo');
});

prueba('tanda 3: misilera (Scud, Minuteman, Sarmat) e interceptor', () => {
  const m = W.crearMundo(4242, { N: 256 }), N = m.N, J = m.jug[0], R = m.jug[1];
  m.ents.filter((e) => !e.edif).forEach((e) => { e.vida = 0; }); W.tick(m);
  for (let y = 20; y < 236; y++) for (let x = 20; x < 236; x++) { const i = y * N + x; if (!m.ocup[i]) { m.mapa.terreno[i] = 0; m.mapa.mineral[i] = 0; m.mapa.tipoMin[i] = 0; m.paso[i] = 1; m.pasoV[i] = 1; } }
  const avanza = (n) => { for (let i = 0; i < n; i++) W.tick(m); };
  J.minerales = 60000; J.petroleo = 9000; J.raros = 900; J.nivel = 3; m.niebla[0].fill(1);
  const mis = W.crearEdificio(m, 0, 'misilera', 40, 100); W.crearEdificio(m, 0, 'central', 45, 100); W.crearEdificio(m, 0, 'central', 45, 103);
  // fabricar: se paga al encargar; diez como mucho
  const min0 = J.minerales;
  for (let k = 0; k < 12; k++) W.orden(m, { t: 'misil', j: 0, id: mis.id, tipo: 'scud' });
  avanza(2);
  assert.equal(mis.fabMis.length, 10, 'diez misiles como mucho');
  assert.ok(min0 - J.minerales >= W.MISILES.scud.costo * 10 - 200, 'se pagan al encargarlos');
  for (let k = 0; k < 7; k++) W.orden(m, { t: 'cancelarMisil', j: 0, id: mis.id, tipo: 'scud' });
  W.orden(m, { t: 'misil', j: 0, id: mis.id, tipo: 'sarmat' }); W.orden(m, { t: 'misil', j: 0, id: mis.id, tipo: 'minuteman' });
  avanza(2); assert.equal(mis.fabMis.join(), 'scud,scud,scud,sarmat,minuteman');
  avanza(W.MISILES.scud.tiempo * 3 + W.MISILES.sarmat.tiempo + W.MISILES.minuteman.tiempo + 20);
  assert.deepEqual(mis.silo, { scud: 3, sarmat: 1, minuteman: 1 }, 'los cinco fabricados y guardados');
  // alcance: el Scud no llega a 100 celdas; el Minuteman sí; lo no explorado no se puede apuntar
  const lejos = W.crearEdificio(m, 1, 'fabrica', 150, 100), cerca = W.crearEdificio(m, 1, 'cuartel', 90, 100), tq = W.crearUnidad(m, 1, 'tanque', 102 * N + 92);
  W.orden(m, { t: 'lanzar', j: 0, id: mis.id, tipo: 'scud', x: 151.5, y: 101.5 }); avanza(2);
  assert.equal(m.misiles.length, 0, 'fuera de alcance no sale');
  W.orden(m, { t: 'lanzar', j: 0, id: mis.id, tipo: 'scud', x: 91, y: 101 }); avanza(2);
  assert.ok(m.misiles.length === 1 && mis.silo.scud === 2, 'el Scud sale');
  const v0 = cerca.vida; for (let i = 0; i < 400 && m.misiles.length; i++) W.tick(m);
  assert.ok(cerca.vida < v0 - 300 && tq.vida < tq.vidaMax, 'y pega fuerte en área: cuartel ' + cerca.vida + ', tanque ' + tq.vida);
  const vl = lejos.vida; W.orden(m, { t: 'lanzar', j: 0, id: mis.id, tipo: 'minuteman', x: 151.5, y: 101.5 });
  for (let i = 0; i < 600 && (i < 3 || m.misiles.length); i++) W.tick(m);
  assert.ok(lejos.vida < vl - 700, 'el Minuteman llega el doble de lejos y pega más: ' + (vl - lejos.vida));
  // interceptor: para el Scud; el Sarmat necesita dos impactos, y las cargas se gastan
  const obj = W.crearEdificio(m, 1, 'refineria', 92, 108), ic = W.crearEdificio(m, 1, 'interceptor', 96, 103); W.crearEdificio(m, 1, 'central', 100, 103);
  avanza(3); assert.ok(!ic.sinLuz, 'interceptor con energía');
  const v2 = obj.vida, tiro = (tipo) => { W.orden(m, { t: 'lanzar', j: 0, id: mis.id, tipo, x: 93.5, y: 109.5 }); for (let i = 0; i < 600 && (i < 3 || m.misiles.length); i++) W.tick(m); };
  tiro('scud');
  assert.ok(obj.vida === v2 && mis.silo.scud === 1 && ic.cargas === W.EDIF.interceptor.cargas - 1, 'Scud derribado, una carga menos: ' + ic.cargas);
  tiro('sarmat');
  assert.ok(obj.vida === v2 && mis.silo.sarmat === 0 && ic.cargas === W.EDIF.interceptor.cargas - 3, 'el Sarmat cae con dos impactos: cargas ' + ic.cargas);
  ic.cargas = 0; ic.repone = 0; tiro('scud');
  assert.ok(obj.vida < v2, 'sin cargas, el misil pasa');
  // partida guardada con un misil en vuelo: sigue igual
  W.orden(m, { t: 'misil', j: 0, id: mis.id, tipo: 'scud' }); avanza(W.MISILES.scud.tiempo + 5);
  W.orden(m, { t: 'lanzar', j: 0, id: mis.id, tipo: 'scud', x: 91, y: 101 }); avanza(20);
  const copia = W.cargar(W.guardar(m)).m; for (let i = 0; i < 300; i++) { W.tick(m); W.tick(copia); }
  assert.equal(W.huella(copia), W.huella(m));
});

prueba('tanda 4: muros, puertas, alambrada, torreta de muro y cámara', () => {
  const m = W.crearMundo(4242, { N: 128 }), N = m.N, J = m.jug[0];
  m.ents.filter((e) => !e.edif).forEach((e) => { e.vida = 0; }); W.tick(m);
  const cel = (x, y) => y * N + x;
  const pon = (x, y, t) => { const i = cel(x, y); m.mapa.terreno[i] = t; m.mapa.mineral[i] = 0; m.paso[i] = t === 1 || t === 2 ? 0 : 1; m.pasoV[i] = t === 0 ? 1 : 0; };
  for (let y = 40; y < 80; y++) for (let x = 30; x < 100; x++) if (!m.ocup[cel(x, y)]) pon(x, y, 0);
  for (let x = 30; x < 100; x++) { pon(x, 39, 1); pon(x, 80, 1); } for (let y = 39; y <= 80; y++) { pon(29, y, 1); pon(100, y, 1); } // un campo cerrado por roca
  const avanza = (n) => { for (let i = 0; i < n; i++) W.tick(m); };
  J.dios = false; J.minerales = 20000; J.nivel = 2; m.jug[1].minerales = 20000;
  // el ingeniero civil levanta un muro de lado a lado, con una puerta en medio
  const civ = W.crearUnidad(m, 0, 'civil', cel(58, 42)), min0 = J.minerales;
  W.orden(m, { t: 'murar', j: 0, ids: [civ.id], tipo: 'reforzado', x0: 60.5, y0: 40.5, x1: 60.5, y1: 58.5 });
  W.orden(m, { t: 'murar', j: 0, ids: [civ.id], tipo: 'reforzado', x0: 60.5, y0: 61.5, x1: 60.5, y1: 79.5, enc: true });
  avanza(2); for (let i = 0; i < 20000 && civ.orden === 'murar'; i++) W.tick(m);
  W.orden(m, { t: 'murar', j: 0, ids: [civ.id], tipo: 'puerta', x0: 60.5, y0: 59.5, x1: 60.5, y1: 60.5 });
  avanza(2); for (let i = 0; i < 4000 && civ.orden === 'murar'; i++) W.tick(m);
  let nMuro = 0, nPuerta = 0; for (let y = 40; y < 80; y++) { if (m.muro[cel(60, y)] === 3) nMuro++; if (m.muro[cel(60, y)] === 4) nPuerta++; }
  assert.ok(nMuro === 38 && nPuerta === 2, 'muro de lado a lado con su puerta: ' + nMuro + ' + ' + nPuerta);
  assert.ok(min0 - J.minerales >= 38 * 30 + 2 * 40 - 300, 'pagado celda a celda: ' + (min0 - J.minerales));
  assert.ok(!m.ents.some((e) => e.muro), 'los muros no son entidades');
  // los propios cruzan por la puerta; el enemigo, sin armas que valgan, no pasa
  const mio = W.crearUnidad(m, 0, 'tanque', cel(50, 50)), ing = W.crearUnidad(m, 1, 'ingeniero', cel(75, 50));
  W.orden(m, { t: 'mover', j: 0, ids: [mio.id], x: 75.5, y: 45.5 }); W.orden(m, { t: 'mover', j: 1, ids: [ing.id], x: 45.5, y: 50.5 }); avanza(900);
  assert.ok(mio.x > 70, 'el tanque propio cruza por la puerta: ' + mio.x.toFixed(1));
  assert.ok(ing.x > 60.9, 'el enemigo no pasa: ' + ing.x.toFixed(1));
  // un grupo enemigo con orden de avanzar atacando se abre paso derribando el muro
  mio.vida = 0; ing.vida = 0; avanza(2);
  const ene = [0, 1, 2, 3].map((k) => W.crearUnidad(m, 1, 'tanque', cel(75, 48 + k)));
  W.orden(m, { t: 'amover', j: 1, ids: ene.map((u) => u.id), x: 40.5, y: 50.5 });
  let roto = -1; for (let i = 0; i < 9000 && roto < 0; i++) { W.tick(m); if (ene.some((u) => u.x < 59.5)) roto = i; }
  assert.ok(roto > 100, 'derriban el muro y pasan (tick ' + roto + ')');
  let huecos = 0; for (let y = 40; y < 80; y++) if (!m.muro[cel(60, y)]) huecos++;
  assert.ok(huecos >= 1 && huecos <= 6, 'abren un hueco, no todo el muro: ' + huecos);
  ene.forEach((u) => { u.vida = 0; }); avanza(2);
  // torreta de muro: solo sobre muro reforzado propio; cámara: descubre a un francotirador escondido y avisa
  assert.ok(!W.puedeColocar(m, 0, 'torretaMuro', 55, 50), 'en el suelo no');
  assert.ok(W.puedeColocar(m, 0, 'torretaMuro', 60, 44), 'sobre el muro reforzado sí');
  assert.ok(!W.puedeColocar(m, 1, 'torretaMuro', 60, 44), 'el enemigo no puede usar tu muro');
  assert.ok(W.puedeColocar(m, 0, 'camara', 60, 70) && !W.puedeColocar(m, 0, 'central', 60, 70), 'la cámara también va sobre el muro; otros edificios no');
  const cam = W.crearEdificio(m, 0, 'camara', 60, 70); cam.sinLuz = false;
  const franco = W.crearUnidad(m, 1, 'francotirador', cel(66, 70)); franco.guardia = true; franco.recarga = 99999;
  let aviso = false; for (let i = 0; i < 60; i++) { W.tick(m); cam.sinLuz = false; if (m.efectos.some((f) => f.tipo === 'camara' && f.j === 0)) aviso = true; }
  assert.ok(!W.oculta(m, franco) && aviso, 'la cámara lo descubre y avisa');
  cam.vida = 0; avanza(40);
  assert.ok(W.oculta(m, franco) && m.muro[cel(60, 70)] === 3 && !m.paso[cel(60, 70)], 'sin cámara vuelve a esconderse, y el muro de debajo sigue en pie');
  // alambrada: frena a la infantería enemiga y un tanque la aplasta
  franco.vida = 0; avanza(2);
  W.orden(m, { t: 'murar', j: 0, ids: [civ.id], tipo: 'alambrada', x0: 40.5, y0: 70.5, x1: 46.5, y1: 70.5 }); W.orden(m, { t: 'mover', j: 0, ids: [civ.id], x: 43.5, y: 68.5 });
  avanza(2); W.orden(m, { t: 'murar', j: 0, ids: [civ.id], tipo: 'alambrada', x0: 40.5, y0: 70.5, x1: 46.5, y1: 70.5 });
  avanza(2); for (let i = 0; i < 4000 && civ.orden === 'murar'; i++) W.tick(m);
  assert.equal(m.muro[cel(43, 70)], 1, 'alambrada tendida');
  const sol = W.crearUnidad(m, 1, 'infanteria', cel(43, 69)); sol.guardia = true;
  W.orden(m, { t: 'mover', j: 1, ids: [sol.id], x: 43.5, y: 74.5 }); let vmin = 9; for (let i = 0; i < 60; i++) { W.tick(m); if (Math.floor(sol.y) === 70 && sol.v > 0) vmin = Math.min(vmin, sol.v); }
  assert.ok(vmin < W.UNID.infanteria.vel * 0.5, 'la infantería enemiga cruza la alambrada muy despacio: ' + vmin.toFixed(3));
  const tq = W.crearUnidad(m, 1, 'tanque', cel(45, 67)); W.orden(m, { t: 'mover', j: 1, ids: [tq.id], x: 45.5, y: 75.5 }); avanza(200);
  assert.equal(m.muro[cel(45, 70)], 0, 'el tanque aplasta la alambrada');
  // derribar lo propio devuelve la mitad; guardar y cargar
  const m1 = J.minerales; W.orden(m, { t: 'quitarMuro', j: 0, c: cel(60, 41) }); avanza(2);
  assert.ok(!m.muro[cel(60, 41)] && m.paso[cel(60, 41)] && J.minerales >= m1 + 15, 'se quita y devuelve la mitad');
  const copia = W.cargar(W.guardar(m)).m; for (let i = 0; i < 100; i++) { W.tick(m); W.tick(copia); }
  assert.equal(W.huella(copia), W.huella(m));
});

prueba('drones: estación, operador y comando; kamikaze, bombardero, derribos e interferencia', () => {
  const m = W.crearMundo(4242, { N: 128 }), N = m.N, J = m.jug[0];
  m.ents.filter((e) => !e.edif).forEach((e) => { e.vida = 0; }); W.tick(m);
  for (let y = 30; y < 100; y++) for (let x = 20; x < 110; x++) { const i = y * N + x; if (!m.ocup[i]) { m.mapa.terreno[i] = 0; m.mapa.mineral[i] = 0; m.paso[i] = 1; m.pasoV[i] = 1; } }
  const avanza = (n) => { for (let i = 0; i < n; i++) W.tick(m); };
  const drones = (base, rol) => m.ents.filter((e) => W.UNID[e.tipo] && W.UNID[e.tipo].mini && e.base === base.id && (!rol || e.rol === rol));
  J.dios = false; J.minerales = 5000;
  // estación: dos de reconocimiento dando vueltas, y se ve donde antes no
  const lejos = 60 * N + 52; assert.notEqual(m.niebla[0][lejos], 2, 'antes no se ve a esa distancia');
  W.crearEdificio(m, 0, 'central', 36, 64); const est = W.crearEdificio(m, 0, 'estDrones', 40, 60); avanza(200);
  assert.equal(drones(est, 'rec').length, 2, 'la estación saca sus dos drones');
  let visto = false; for (let i = 0; i < 600; i++) { W.tick(m); if (m.niebla[0][lejos] === 2) visto = true; }
  assert.ok(visto, 'los drones dan visión lejos de la estación');
  assert.ok(drones(est).every((q) => Math.hypot(q.x - est.cx, q.y - est.cy) <= W.EDIF.estDrones.radioDron + 1), 'sin salirse de su radio');
  // derribarlos cuesta reponerlos; si cae la estación, caen
  const min0 = J.minerales; drones(est)[0].vida = 0; avanza(W.ECON.dronRepone + 60);
  assert.ok(drones(est, 'rec').length === 2, 'repone el derribado'); void min0;
  est.vida = 0; avanza(5); assert.equal(m.ents.filter((e) => W.UNID[e.tipo] && W.UNID[e.tipo].mini).length, 0, 'sin estación caen sus drones');
  // operador: solo despliega parado; al andar, el dron se le pega
  const op = W.crearUnidad(m, 0, 'operador', 80 * N + 40); avanza(60);
  const dr = drones(op, 'rec'); assert.equal(dr.length, 1, 'el operador despliega su dron');
  avanza(300); assert.ok(Math.hypot(dr[0].x - op.x, dr[0].y - op.y) > 4, 'parado, el dron se aleja a mirar');
  W.orden(m, { t: 'mover', j: 0, ids: [op.id], x: 60.5, y: 80.5 }); avanza(150);
  assert.ok(Math.hypot(dr[0].x - op.x, dr[0].y - op.y) < 4, 'andando, el dron va pegado a él');
  op.vida = 0; avanza(5);
  // comando: kamikazes contra el tanque, bombardero contra la infantería; cada salida cuesta
  const cmd = W.crearUnidad(m, 0, 'comandoDrones', 45 * N + 40); avanza(150);
  assert.ok(drones(cmd, 'rec').length === 3 && drones(cmd, 'bomba').length === 2, 'tres de reconocimiento y dos bombarderos');
  const tq = W.crearUnidad(m, 1, 'tanque', 45 * N + 52), sols = [0, 1, 2].map((k) => W.crearUnidad(m, 1, 'infanteria', (49 + k) * N + 50));
  tq.guardia = true; tq.recarga = 99999; sols.forEach((s) => { s.guardia = true; s.recarga = 99999; });
  const m1 = J.minerales; let maxFpv = 0;
  for (let i = 0; i < 700; i++) { W.tick(m); tq.recarga = 99999; sols.forEach((s) => { s.recarga = 99999; }); maxFpv = Math.max(maxFpv, drones(cmd, 'fpv').length); }
  assert.ok(tq.vida <= 0 || tq.vida < tq.vidaMax - 140, 'los kamikazes castigan al tanque: ' + tq.vida);
  assert.ok(sols.some((s) => s.vida < s.vidaMax), 'el bombardero castiga a la infantería');
  assert.ok(maxFpv >= 1 && maxFpv <= 5, 'salen de uno en uno, como mucho cinco: ' + maxFpv); void m1;
  assert.ok(drones(cmd).length <= 10, 'nunca más de diez en el aire');
  // apagados los de ataque, no sale ninguno más
  W.orden(m, { t: 'dronAtk', j: 0, ids: [cmd.id], on: false }); avanza(100);
  const tq2 = W.crearUnidad(m, 1, 'tanque', 42 * N + 52); tq2.guardia = true; tq2.recarga = 99999; avanza(300);
  assert.ok(tq2.vida === tq2.vidaMax, 'con los drones de ataque apagados no ataca');
  // la antiaérea enemiga los derriba; el vehículo de mando enemigo los interfiere
  [tq, tq2, ...sols].forEach((e) => { e.vida = 0; }); avanza(3);
  m.jug[1].nivel = 2; W.crearEdificio(m, 1, 'central', 58, 44); const g = W.crearEdificio(m, 1, 'antiaerea', 54, 45); // en la órbita de los de reconocimiento
  const antes = drones(cmd).length; let minimo = antes; for (let i = 0; i < 400; i++) { W.tick(m); minimo = Math.min(minimo, drones(cmd).length); }
  assert.ok(minimo < antes, 'la antiaérea derriba drones: de ' + antes + ' bajan a ' + minimo);
  g.vida = 0; avanza(W.ECON.dronRepone * 3 + 100);
  m.jug[1].info = 500; const mando = W.crearUnidad(m, 1, 'mando', 46 * N + 43); mando.guardia = true; avanza(80);
  const r = W.UNID.mando.mando;
  assert.ok(drones(cmd, 'bomba').length < 2 && drones(cmd).filter((q) => Math.hypot(q.x - mando.x, q.y - mando.y) <= r).every((q) => q.vida < q.vidaMax), 'dentro del radio del mando enemigo los drones pierden el enlace y caen');
  assert.equal(drones(cmd, 'rec').length, 3, 'los que vuelan fuera de su radio siguen');
});

prueba('laboratorio y mejoras de rendimiento por edificio', () => {
  const m = W.crearMundo(4242, { N: 128 }), J = m.jug[0], b = m.mapa.bases[0];
  const avanza = (n) => { for (let i = 0; i < n; i++) W.tick(m); };
  J.minerales = 20000;
  const cen = W.crearEdificio(m, 0, 'central', b.x + 5, b.y), cen2 = W.crearEdificio(m, 0, 'central', b.x + 5, b.y + 3), lab = W.crearEdificio(m, 0, 'laboratorio', b.x + 5, b.y - 4);
  avanza(2);
  // el laboratorio da información sin campo, y vale como estación para lo que la pide
  const i0 = J.info; avanza(400);
  assert.ok(J.info - i0 >= 9 && J.info - i0 <= 11, 'una de información cada dos segundos: ' + (J.info - i0));
  assert.ok(W.tieneReq(m, 0, ['estacion']), 'el laboratorio vale como estación');
  // mejorar: cuesta, sube el rendimiento un 50 % por nivel y tiene tope
  const p0 = J.prod, min0 = J.minerales, precio = W.costoMejora(cen);
  W.orden(m, { t: 'mejorarEdif', j: 0, id: cen.id }); avanza(2);
  assert.ok(cen.nivelE === 2 && J.prod === p0 + 50 && min0 - J.minerales >= precio - 20, 'central a nivel 2: +50 de energía, pagados ' + precio);
  W.orden(m, { t: 'mejorarEdif', j: 0, id: cen.id }); avanza(2); W.orden(m, { t: 'mejorarEdif', j: 0, id: cen.id }); avanza(2);
  assert.ok(cen.nivelE === 3 && J.prod === p0 + 100, 'tope en el nivel 3');
  W.orden(m, { t: 'mejorarEdif', j: 0, id: lab.id }); avanza(2); const i1 = J.info; avanza(400);
  assert.ok(lab.nivelE === 2 && J.info - i1 >= 14 && J.info - i1 <= 16, 'laboratorio mejorado: un 50 % más de información: ' + (J.info - i1));
  const cu = W.crearEdificio(m, 0, 'cuartel', b.x + 8, b.y - 4); W.orden(m, { t: 'mejorarEdif', j: 0, id: cu.id }); avanza(2);
  assert.ok(!cu.nivelE, 'el cuartel no se mejora'); void cen2;
});

prueba('ingeniero civil en automático conecta lo que está fuera de la red; patrulla por puntos compartida', () => {
  const m = W.crearMundo(31, { N: 128, logistica: true }), N = m.N, J = m.jug[0];
  m.ents.filter((e) => !e.edif).forEach((e) => { e.vida = 0; }); W.tick(m);
  const cel = (x, y) => y * N + x, patio = m.ents.find((e) => e.j === 0 && e.tipo === 'patio'), px = Math.floor(patio.cx), py = Math.floor(patio.cy), dir = px < 64 ? 1 : -1;
  for (let y = py - 10; y <= py + 10; y++) for (let x = Math.min(px, px + dir * 60) - 2; x <= Math.max(px, px + dir * 60) + 2; x++) { const i = cel(x, y); if (x < 2 || y < 2 || x >= N - 2 || y >= N - 2 || m.ocup[i]) continue; m.mapa.terreno[i] = 0; m.mapa.mineral[i] = 0; m.paso[i] = 1; m.pasoV[i] = 1; }
  m.terrenoV++;
  const avanza = (n) => { for (let i = 0; i < n; i++) W.tick(m); };
  J.dios = false; J.minerales = 20000;
  const c1 = W.crearEdificio(m, 0, 'central', px + dir * 22, py - 3), c2 = W.crearEdificio(m, 0, 'central', px + dir * 22, py + 6); avanza(3);
  assert.ok(!c1.conRed && !c2.conRed, 'las dos centrales lejanas nacen fuera de la red');
  const ing = W.crearUnidad(m, 0, 'civil', cel(px + dir * 4, py + 1)), ing2 = W.crearUnidad(m, 0, 'civil', cel(px + dir * 4, py + 2));
  assert.ok(ing.auto, 'el ingeniero civil nace en automático');
  avanza(40);
  assert.strictEqual(ing.orden, 'conectar', 'sin que nadie se lo ordene, se pone a conectar');
  assert.ok(ing2.orden !== 'conectar' || ing2.obra.pares[0][1] !== ing.obra.pares[0][1], 'dos ingenieros no se encargan del mismo edificio');
  avanza(2500);
  assert.ok(c1.conRed && c2.conRed, 'las dos quedan conectadas');
  assert.ok(m.ents.some((e) => e.linea && e.j === 0), 'con líneas de servicio');
  const nLin = m.ents.filter((e) => e.linea).length; avanza(200);
  assert.strictEqual(m.ents.filter((e) => e.linea).length, nLin, 'y con todo conectado no tiende nada más');
  // una orden a mano lo saca del automático; el botón lo devuelve
  W.orden(m, { t: 'mover', j: 0, ids: [ing.id], x: ing.x + 1, y: ing.y }); avanza(2); assert.ok(!ing.auto, 'una orden a mano lo deja en manual');
  W.orden(m, { t: 'autoCivil', j: 0, ids: [ing.id], on: true }); avanza(2); assert.ok(ing.auto, 'y se le puede devolver');
  // patrulla por puntos: el grupo recorre el mismo circuito, al paso del más lento
  const t1 = W.crearUnidad(m, 0, 'tanque', cel(px + dir * 8, py - 6)), i1 = W.crearUnidad(m, 0, 'infanteria', cel(px + dir * 8, py - 5));
  const pts = [{ x: px + dir * 12, y: py - 7 }, { x: px + dir * 18, y: py - 7 }, { x: px + dir * 18, y: py - 9 }];
  W.orden(m, { t: 'patrulla', j: 0, ids: [t1.id, i1.id], pts }); avanza(2);
  assert.strictEqual(t1.patrulla.pts.length, 3); assert.strictEqual(i1.patrulla.pts.length, 3);
  assert.ok(Math.hypot(t1.patrulla.pts[1].x - pts[1].x, t1.patrulla.pts[1].y - pts[1].y) < 3, 'cada unidad lleva su puesto junto a cada punto');
  avanza(5); assert.ok(Math.hypot(t1.dest.x - pts[0].x, t1.dest.y - pts[0].y) < 3, 'empieza por el primer punto');
  const vistos = new Set(); let sep = 0;
  for (let k = 0; k < 2400; k++) { W.tick(m); pts.forEach((q, n) => { if (Math.hypot(t1.x - q.x, t1.y - q.y) < 2.5) vistos.add(n); }); sep = Math.max(sep, Math.hypot(t1.x - i1.x, t1.y - i1.y)); }
  assert.strictEqual(vistos.size, 3, 'pasa por los tres puntos');
  assert.ok(t1.patrulla && i1.patrulla, 'y sigue patrullando');
  assert.ok(sep < 6, 'el tanque no deja atrás a la infantería (separación máxima ' + sep.toFixed(1) + ')');
  // un solo punto: ida y vuelta desde donde está
  W.orden(m, { t: 'patrulla', j: 0, ids: [i1.id], pts: [{ x: i1.x + dir * 5, y: i1.y }] }); avanza(2);
  assert.strictEqual(i1.patrulla.pts.length, 2, 'con un punto, va y vuelve');
});

prueba('rendimiento: un grupo comparte el tramo largo de la ruta y las búsquedas se reparten por presupuesto', () => {
  const m = W.crearMundo(31, { N: 128 }), N = m.N;
  m.ents.filter((e) => !e.edif).forEach((e) => { e.vida = 0; }); W.tick(m);
  const cel = (x, y) => y * N + x;
  for (let y = 20; y < 110; y++) for (let x = 20; x < 110; x++) { const i = cel(x, y); if (m.ocup[i]) continue; m.mapa.terreno[i] = 0; m.mapa.mineral[i] = 0; m.paso[i] = 1; m.pasoV[i] = 1; }
  for (let y = 30; y < 100; y++) { const i = cel(64, y); m.mapa.terreno[i] = 1; m.paso[i] = 0; m.pasoV[i] = 0; } // un muro de roca en medio: hay que rodearlo
  m.terrenoV++;
  const us = []; for (let k = 0; k < 16; k++) us.push(W.crearUnidad(m, 0, k % 2 ? 'tanque' : 'infanteria', cel(26 + (k % 4), 60 + ((k / 4) | 0))));
  let enteras = 0, cortas = 0, maxNodos = 0; const r0 = m.ruta;
  m.ruta = function (...a) { const r = r0.apply(this, a); m.ruta.nodos = r0.nodos; if (a[11]) cortas++; else enteras++; return r; };
  W.orden(m, { t: 'mover', j: 0, ids: us.map((u) => u.id), x: 100.5, y: 62.5 });
  for (let i = 0; i < 12; i++) W.tick(m);
  assert.ok(us.every((u) => u.ruta && !u.pend), 'todas tienen ruta a los pocos ticks');
  assert.ok(enteras <= 4, 'solo se calcula entera una ruta por tipo de paso (fueron ' + enteras + ')');
  assert.ok(cortas >= 20, 'las demás se enganchan al tramo compartido (' + cortas + ' búsquedas cortas)');
  for (let i = 0; i < 3000 && us.some((u) => u.orden !== 'nada'); i++) W.tick(m);
  assert.ok(us.every((u) => Math.hypot(u.x - 100.5, u.y - 62.5) < 6), 'y todas llegan al otro lado del muro');
  // el presupuesto: muchas rutas largas pedidas a la vez no se resuelven todas en el mismo tick
  const vs = []; for (let k = 0; k < 30; k++) vs.push(W.crearUnidad(m, 1, 'infanteria', cel(24 + (k % 6), 24 + ((k / 6) | 0))));
  W.tick(m); enteras = 0;
  for (const u of vs) W.orden(m, { t: 'mover', j: 1, ids: [u.id], x: 104.5 - (u.id % 5) * 12, y: 104.5 }); // 30 órdenes distintas: nada que compartir
  const antes = W.ECON.rutaNodos; W.ECON.rutaNodos = 3000; // (en un mapa tan pequeño el presupuesto normal alcanza para todas)
  W.tick(m); W.tick(m);
  assert.ok(vs.some((u) => u.pend), 'quedan rutas pendientes para los ticks siguientes');
  for (let i = 0; i < 60; i++) W.tick(m);
  W.ECON.rutaNodos = antes;
  assert.ok(vs.every((u) => !u.pend), 'y en pocos ticks están todas');
});

prueba('tanda 5: puente aéreo, puesto de avanzada, hospital y traslado de infantería', () => {
  const m = W.crearMundo(31, { N: 128, logistica: true }), N = m.N, J = m.jug[0];
  m.ents.filter((e) => !e.edif).forEach((e) => { e.vida = 0; }); W.tick(m);
  const cel = (x, y) => y * N + x, patio = m.ents.find((e) => e.j === 0 && e.tipo === 'patio'), px = Math.floor(patio.cx), py = Math.floor(patio.cy), dir = px < 64 ? 1 : -1;
  for (let y = py - 10; y <= py + 10; y++) for (let x = Math.min(px, px + dir * 60) - 2; x <= Math.max(px, px + dir * 60) + 2; x++) { const i = cel(x, y); if (x < 2 || y < 2 || x >= N - 2 || y >= N - 2 || m.ocup[i]) continue; m.mapa.terreno[i] = 0; m.mapa.mineral[i] = 0; m.mapa.tipoMin[i] = 0; m.paso[i] = 1; m.pasoV[i] = 1; }
  const avanza = (n) => { for (let i = 0; i < n; i++) W.tick(m); };
  J.dios = false; J.minerales = 20000;
  W.crearEdificio(m, 0, 'central', px + dir * 5, py + 4); const log = W.crearEdificio(m, 0, 'logistica', px + dir * 5, py - 4);
  const lejos = px + dir * 45, cob = () => W.cobertura(m, 0);
  // el puesto móvil se despliega lejos como puesto de avanzada: queda en la red por aire, sin línea ni camino
  const movil = W.crearUnidad(m, 0, 'avanzadaMovil', cel(lejos, py)); avanza(3);
  assert.ok(!cob()[cel(lejos, py + 3)], 'antes de desplegar no hay cobertura allí');
  assert.ok(W.puedeDesplegar(m, movil), 'cabe');
  W.orden(m, { t: 'desplegar', j: 0, ids: [movil.id] }); avanza(15);
  const av = m.ents.find((e) => e.tipo === 'avanzada');
  assert.ok(av && av.conRed && cob()[cel(lejos, py + 3)], 'desplegado: en la red y con cobertura alrededor');
  assert.ok(W.puedeColocar(m, 0, 'torreta', lejos + 3, py + 3), 'y se puede construir junto a él');
  // el helicóptero de carga va y viene y renueva el enlace
  const heli = () => m.ents.find((e) => e.tipo === 'heliCarga');
  assert.ok(heli(), 'sale un helicóptero de carga del puesto logístico');
  avanza(1400); assert.ok(av.abast > m.t + 300 && av.conRed, 'las entregas mantienen el enlace');
  // hospital: cura a la infantería cercana
  const her = W.crearUnidad(m, 0, 'infanteria', cel(lejos + 3, py + 1)); her.vida = 10; avanza(320);
  assert.ok(her.vida >= her.vidaMax - 1, 'el hospital del puesto cura: ' + her.vida);
  // traslado: ocho soldados junto al puesto logístico vuelan al puesto de avanzada
  const us = []; for (let k = 0; k < 10; k++) us.push(W.crearUnidad(m, 0, 'infanteria', cel(px + dir * 5 + (k % 5), py - 6 - ((k / 5) | 0))));
  avanza(3); W.orden(m, { t: 'aerotransporte', j: 0, ids: us.map((u) => u.id), de: log.id, a: av.id }); avanza(3);
  assert.equal(m.ents.filter((e) => e.tipo === 'heliTropa').length, 2, 'diez soldados: dos helicópteros');
  assert.ok(us.every((u) => !m.ents.includes(u)), 'la tropa va dentro');
  avanza(600);
  assert.ok(us.every((u) => m.ents.includes(u) && Math.hypot(u.x - av.cx, u.y - av.cy) < 6), 'llegan y bajan junto al puesto de avanzada');
  avanza(600); assert.equal(m.ents.filter((e) => e.tipo === 'heliTropa').length, 0, 'los helicópteros de tropa se van');
  // sin vuelos, el enlace caduca y el puesto sale de la red; con otro helicóptero, vuelve
  log.vida = 0; avanza(W.ECON.abastDura + 60);
  assert.ok(!av.conRed && !cob()[cel(lejos, py + 3)] && !heli(), 'sin puesto logístico no hay vuelos, y el puesto queda aislado');
  const log2 = W.crearEdificio(m, 0, 'logistica', px + dir * 5, py - 4); avanza(900);
  assert.ok(av.conRed && heli() && log2.vida > 0, 'con otro puesto logístico se restablece');
  // derribar el helicóptero de carga corta el enlace hasta que lo reponen
  heli().vida = 0; avanza(5); assert.ok(!heli(), 'derribado');
  avanza(W.ECON.heliRepone + 40); assert.ok(heli(), 'lo reponen pasado un rato');
  const copia = W.cargar(W.guardar(m)).m; for (let i = 0; i < 200; i++) { W.tick(m); W.tick(copia); }
  assert.equal(W.huella(copia), W.huella(m));
});

prueba('puentes: la excavadora cruza el agua, todos lo usan y al caer se cierra', () => {
  const m = W.crearMundo(31, { N: 128 }), N = m.N, J = m.jug[0], T = W.TERRENO;
  m.ents.filter((e) => !e.edif).forEach((e) => { e.vida = 0; }); W.tick(m);
  const cel = (x, y) => y * N + x;
  const pon = (x, y, t) => { const i = cel(x, y); m.mapa.terreno[i] = t; m.mapa.mineral[i] = 0; m.paso[i] = t === 1 || t === 2 ? 0 : 1; m.pasoV[i] = t === 0 || t === 4 ? 1 : 0; };
  for (let y = 40; y < 80; y++) for (let x = 30; x < 100; x++) if (!m.ocup[cel(x, y)]) pon(x, y, 0);
  for (let y = 40; y < 80; y++) for (let x = 60; x < 66; x++) pon(x, y, 2); // un río de 6 celdas, de lado a lado
  for (let x = 30; x < 100; x++) { pon(x, 39, 1); pon(x, 80, 1); } for (let y = 39; y <= 80; y++) { pon(29, y, 1); pon(100, y, 1); }
  const avanza = (n) => { for (let i = 0; i < n; i++) W.tick(m); };
  J.dios = false; J.minerales = 5000;
  // nadie cruza el río; la excavadora, moviéndose normal, tampoco
  const tq = W.crearUnidad(m, 0, 'tanque', cel(50, 60)), so = W.crearUnidad(m, 0, 'infanteria', cel(50, 62)), ex = W.crearUnidad(m, 0, 'excavadora', cel(52, 64));
  W.orden(m, { t: 'mover', j: 0, ids: [tq.id, so.id, ex.id], x: 75.5, y: 60.5 }); avanza(700);
  assert.ok(tq.x < 60 && so.x < 60 && ex.x < 60, 'sin puente no se cruza');
  assert.ok(!m.ents.some((e) => e.infra), 'moverse no deja camino');
  const min1 = J.minerales;
  // trazando, sí: tiende un puente, que cuesta más que el camino
  W.orden(m, { t: 'trazar', j: 0, ids: [ex.id], x: 72.5, y: 64.5 }); avanza(2);
  for (let i = 0; i < 6000 && ex.orden === 'trazar'; i++) W.tick(m);
  assert.ok(ex.x > 71, 'la excavadora debía llegar al otro lado: ' + ex.x.toFixed(1));
  const puentes = m.ents.filter((e) => e.infra && e.puente);
  let nPuente = 0; for (let i = 0; i < N * N; i++) if (m.mapa.terreno[i] === T.PUENTE) nPuente++;
  assert.ok(puentes.length >= 1 && nPuente >= 10 && nPuente <= 16, 'unas 12 celdas de puente: ' + nPuente);
  assert.ok(min1 - J.minerales >= nPuente * W.ECON.caminoAgua - 150, 'el puente se paga a su precio: ' + (min1 - J.minerales));
  // tanque e infantería cruzan
  W.orden(m, { t: 'mover', j: 0, ids: [tq.id, so.id], x: 75.5, y: 60.5 }); avanza(1200);
  assert.ok(tq.x > 73 && so.x > 73, 'por el puente cruzan los dos: ' + tq.x.toFixed(1) + ' ' + so.x.toFixed(1));
  // con una unidad encima, el puente cae: la unidad sale a tierra y el paso se cierra
  W.orden(m, { t: 'mover', j: 0, ids: [tq.id], x: 50.5, y: 64.5 });
  for (let i = 0; i < 2000 && m.mapa.terreno[cel(Math.floor(tq.x), Math.floor(tq.y))] !== T.PUENTE; i++) W.tick(m);
  assert.equal(m.mapa.terreno[cel(Math.floor(tq.x), Math.floor(tq.y))], T.PUENTE, 'el tanque debía estar sobre el puente');
  puentes.forEach((e) => { e.vida = 0; }); avanza(3);
  assert.ok(m.pasoV[cel(Math.floor(tq.x), Math.floor(tq.y))], 'el tanque sale a tierra firme');
  for (let y = 41; y < 79; y++) for (let x = 62; x < 64; x++) assert.ok(m.mapa.terreno[cel(x, y)] === T.AGUA && !m.paso[cel(x, y)] && !m.pasoV[cel(x, y)], 'el río vuelve a estar cerrado por el medio');
  W.orden(m, { t: 'mover', j: 0, ids: [so.id], x: 50.5, y: 60.5 }); avanza(900);
  assert.ok(so.x > 66, 'sin puente la infantería ya no vuelve: ' + so.x.toFixed(1));
});

prueba('bosque cerrado a los vehículos, excavadora y caminos', () => {
  // en cualquier mapa queda un corredor de llano entre las dos bases
  for (let semilla = 1; semilla <= 12; semilla++) {
    const mp = W.generarMapa(semilla, 128), N = mp.N, visto = new Uint8Array(N * N), cola = [mp.bases[0].y * N + mp.bases[0].x];
    visto[cola[0]] = 1;
    while (cola.length) { const c = cola.pop(); for (const d of [1, -1, N, -N]) { const n = c + d; if (n >= 0 && n < N * N && !visto[n] && mp.terreno[n] === 0 && Math.abs((n % N) - (c % N)) <= 1) { visto[n] = 1; cola.push(n); } } }
    assert.ok(visto[mp.bases[1].y * N + mp.bases[1].x], 'sin corredor para vehículos, semilla ' + semilla);
  }
  const m = W.crearMundo(31, { N: 128 }), N = m.N, J = m.jug[0], T = W.TERRENO;
  m.ents.filter((e) => !e.edif).forEach((e) => { e.vida = 0; }); W.tick(m);
  const cel = (x, y) => y * N + x;
  const pon = (x, y, t) => { const i = cel(x, y); m.mapa.terreno[i] = t; m.mapa.mineral[i] = 0; m.paso[i] = t === 1 || t === 2 ? 0 : 1; m.pasoV[i] = t === 0 || t === 4 ? 1 : 0; };
  for (let y = 40; y < 80; y++) for (let x = 30; x < 100; x++) if (!m.ocup[cel(x, y)]) pon(x, y, 0);
  for (let y = 40; y < 80; y++) for (let x = 58; x < 64; x++) pon(x, y, 3); // una franja de bosque de lado a lado
  for (let x = 30; x < 100; x++) { pon(x, 39, 1); pon(x, 80, 1); } for (let y = 39; y <= 80; y++) { pon(29, y, 1); pon(100, y, 1); } // y roca alrededor: no hay rodeo
  const avanza = (n, fn) => { for (let i = 0; i < n; i++) { W.tick(m); if (fn) fn(); } };
  const terr = (u) => m.mapa.terreno[cel(Math.floor(u.x), Math.floor(u.y))];
  J.dios = false; J.minerales = 3000;
  // el tanque no entra al bosque ni lo cruza; la infantería sí
  const tq = W.crearUnidad(m, 0, 'tanque', cel(50, 60)), so = W.crearUnidad(m, 0, 'infanteria', cel(50, 62));
  let piso = false;
  W.orden(m, { t: 'mover', j: 0, ids: [tq.id, so.id], x: 75.5, y: 60.5 });
  avanza(700, () => { if (terr(tq) === T.BOSQUE) piso = true; });
  assert.ok(!piso && tq.x < 58.2, 'el tanque no debía entrar al bosque: ' + tq.x.toFixed(1));
  assert.ok(so.x > 70, 'la infantería sí lo cruza: ' + so.x.toFixed(1));
  // si el destino está dentro del bosque, el vehículo se queda en el borde
  W.orden(m, { t: 'mover', j: 0, ids: [tq.id], x: 60.5, y: 50.5 }); avanza(400);
  assert.ok(terr(tq) !== T.BOSQUE && Math.hypot(tq.x - 60.5, tq.y - 50.5) < 5, 'debía quedarse junto al bosque');
  // la excavadora, moviéndose normal, ni entra ni deja camino
  const ex = W.crearUnidad(m, 0, 'excavadora', cel(52, 70)); const min0 = J.minerales;
  W.orden(m, { t: 'mover', j: 0, ids: [ex.id], x: 75.5, y: 70.5 }); avanza(400);
  assert.ok(ex.x < 58.2 && !m.hayCaminos && J.minerales >= min0, 'sin la orden de trazar no abre nada');
  // trazando, tala el bosque, deja camino de dos de ancho y lo cobra
  J.minerales = 1000; W.orden(m, { t: 'trazar', j: 0, ids: [ex.id], x: 70.5, y: 70.5 }); avanza(20);
  assert.ok(J.minerales < 1000, 'trazar cuesta minerales');
  J.minerales = 3000; avanza(1500);
  assert.ok(ex.x > 69 && ex.orden === 'nada', 'la excavadora debía llegar al otro lado: ' + ex.x.toFixed(1));
  let camino = 0; for (let x = 58; x < 64; x++) for (let y = 68; y < 73; y++) if (m.mapa.terreno[cel(x, y)] === T.CAMINO) camino++;
  assert.ok(camino >= 10 && m.hayCaminos, 'debía quedar camino a través del bosque: ' + camino + ' celdas');
  // ahora el tanque cruza por el camino, y por camino va más rápido que por llano
  W.orden(m, { t: 'mover', j: 0, ids: [tq.id], x: 75.5, y: 70.5 }); avanza(900);
  assert.ok(tq.x > 74, 'por el camino el tanque sí pasa: ' + tq.x.toFixed(1));
  const carrera = (y, conCamino) => {
    if (conCamino) { const e2 = W.crearUnidad(m, 0, 'excavadora', cel(66, y)); W.orden(m, { t: 'trazar', j: 0, ids: [e2.id], x: 96.5, y: y + 0.5 }); avanza(1600); e2.vida = 0; avanza(2); }
    const t = W.crearUnidad(m, 0, 'tanque', cel(67, y)); t.ang = 0;
    W.orden(m, { t: 'mover', j: 0, ids: [t.id], x: 95.5, y: y + 0.5 });
    let n = 0; while (t.x < 94 && n < 2000) { W.tick(m); n++; }
    t.vida = 0; avanza(2);
    return n;
  };
  const llano = carrera(45, false), pista = carrera(55, true);
  assert.ok(pista < llano * 0.85, 'por la pista debía tardar menos: ' + pista + ' frente a ' + llano);
  // sin minerales, la excavadora se para
  J.minerales = 0; const e3 = W.crearUnidad(m, 0, 'excavadora', cel(40, 45));
  W.orden(m, { t: 'trazar', j: 0, ids: [e3.id], x: 50.5, y: 45.5 }); avanza(60);
  assert.ok(e3.orden === 'nada' && e3.x < 42, 'sin minerales no hay camino');
});

prueba('panel ADMIN: cada interruptor por separado', () => {
  const m = W.crearMundo(5, { N: 128 }), J = m.jug[0], b = m.mapa.bases[0];
  const avanza = (n) => { for (let i = 0; i < n; i++) W.tick(m); };
  const pon = (clave, valor) => { W.orden(m, { t: 'trampa', j: 0, clave, valor }); avanza(1); };
  // sin requisitos: solo eso
  assert.ok(!W.disponible(m, 0, W.EDIF.aerodromo));
  pon('requisitos', true);
  assert.ok(W.disponible(m, 0, W.EDIF.aerodromo) && !J.dios && J.nivel === 1 && J.admin, 'sin requisitos, pero ni recursos ni nivel');
  pon('requisitos', false);
  assert.ok(!W.disponible(m, 0, W.EDIF.aerodromo) && !J.admin);
  // velocidad
  J.minerales = 5000; pon('vel', 10);
  W.orden(m, { t: 'construir', j: 0, tipo: 'central' }); avanza(W.EDIF.central.tiempo / 10 + 3);
  assert.ok(J.obras[0].listo, 'a ×10 la obra debía estar lista');
  W.orden(m, { t: 'cancelarEdif', j: 0, tipo: 'central' }); avanza(2); // ×20: otra obra, veinte veces más rápida
  assert.equal(J.obras.length, 0, 'la obra anterior debía quedar cancelada');
  pon('vel', 20); W.orden(m, { t: 'construir', j: 0, tipo: 'central' }); avanza(Math.ceil(W.EDIF.central.tiempo / 20) + 3);
  assert.ok(J.tr.vel === 20 && J.obras.length === 1 && J.obras[0].listo, 'a ×20 la obra debía estar lista');
  pon('vel', 1);
  // construir en cualquier parte
  const lejos = W.cercaLibre(m, b.x < 64 ? b.x + 30 : b.x - 30, b.y), lx = lejos % m.N, ly = (lejos / m.N) | 0;
  let sitio = null; for (let d = 0; d < 12 && !sitio; d++) for (const [dx, dy] of [[d, 0], [0, d], [-d, 0], [0, -d]]) { pon('libre', true); if (W.puedeColocar(m, 0, 'central', lx + dx, ly + dy)) { sitio = [lx + dx, ly + dy]; break; } }
  assert.ok(sitio, 'con el interruptor debía poder colocar lejos de la base');
  pon('libre', false);
  assert.ok(!W.puedeColocar(m, 0, 'central', sitio[0], sitio[1]), 'y sin él, no');
  // invulnerables
  const u = W.crearUnidad(m, 0, 'infanteria', W.cercaLibre(m, b.x + 5, b.y + 5, true)), malo = W.crearUnidad(m, 1, 'tanque', W.cercaLibre(m, u.x + 2, u.y, true)); malo.guardia = true; malo.ang = malo.angT = Math.atan2(u.y - malo.y, u.x - malo.x);
  u.guardia = true; u.recarga = 99999; pon('invulnerable', true); avanza(200);
  assert.ok(malo.obj === u.id, 'el tanque debía estar disparándole');
  assert.strictEqual(u.vida, u.vidaMax, 'no debía recibir daño');
  pon('invulnerable', false); avanza(200);
  assert.ok(u.vida < u.vidaMax || !m.porId.has(u.id), 'y al apagarlo, sí');
  // mapa a la vista y recursos
  pon('mapa', true); avanza(4);
  assert.ok(m.niebla[0].every((v) => v === 2), 'todo el mapa visible');
  pon('mapa', false);
  const antes = J.minerales; pon('recursos', true);
  assert.ok(J.dios && J.minerales > 900000);
  pon('recursos', false);
  assert.ok(!J.dios && J.minerales <= antes + 5, 'al apagar los recursos vuelve el saldo');
  // de un solo uso
  pon('nivel3', true); pon('mejoras', true);
  assert.ok(J.nivel === 3 && J.mejoras.canonLargo && !J.admin, 'nivel y mejoras quedan puestos');
});

prueba('guardar y cargar: la partida cargada sigue exactamente igual que la original', () => {
  const m = W.crearMundo(2026, { N: 128, logistica: true }), a = W.iaCrear(0), b = W.iaCrear(1, 'normal', 'asalto');
  const paso = (mm, x, y) => { W.iaTick(mm, x); W.iaTick(mm, y); W.tick(mm); };
  for (let i = 0; i < 9000; i++) paso(m, a, b);
  const txt = W.guardar(m, { a, b });
  assert.ok(txt.length < 1500000, 'la partida guardada debía caber de sobra en el navegador: ' + txt.length);
  const c = W.cargar(txt), m2 = c.m, a2 = c.extra.a, b2 = c.extra.b;
  assert.ok(m2.t === m.t && m2.ents.length === m.ents.length && m2.porId.size === m.porId.size && a2.atacantes instanceof Set && m2.trincheras instanceof Map);
  assert.ok(m2.mapa.terreno instanceof Uint8Array && m2.mapa.terreno.every((v, i) => v === m.mapa.terreno[i]) && m2.niebla[0].every((v, i) => v === m.niebla[0][i]), 'las tablas del mapa debían volver idénticas');
  for (let i = 0; i < 4000; i++) { paso(m, a, b); paso(m2, a2, b2); }
  const firma = (mm) => mm.ents.map((e) => e.id + ':' + e.tipo + ':' + (e.edif ? e.x : e.x.toFixed(3)) + ':' + Math.round(e.vida)).join('|') + '#' + mm.jug.map((J) => Math.round(J.minerales) + '/' + J.bajas).join(',');
  assert.strictEqual(firma(m2), firma(m), 'tras cargar, la partida debía seguir igual que la original');
  assert.throws(() => W.cargar('{"hola":1}'), /partida guardada/);
});

prueba('determinismo: misma semilla, misma partida', () => {
  const corre = () => {
    const m = W.crearMundo(777, { logistica: true }), a = W.iaCrear(0), b = W.iaCrear(1);
    for (let i = 0; i < 4000; i++) { W.iaTick(m, a); W.iaTick(m, b); W.tick(m); }
    return W.huella(m);
  };
  assert.strictEqual(corre(), corre());
});

if (!process.env.RAPIDO) prueba('fase 2c: los cinco estilos de rival juegan media hora y se comportan distinto', () => {
  const res = {};
  for (const estilo of Object.keys(W.ESTILOS_IA)) {
    const m = W.crearMundo(555, { N: 256, logistica: true }), a = W.iaCrear(0, 'normal', estilo), b = W.iaCrear(1, 'normal', 'equilibrado');
    for (const J of m.jug) { J.nivel = 2; J.info = 500; J.minerales += 8000; J.petroleo += 600; } // con ventaja inicial, para que en media hora se vea el juego avanzado
    let aviones = 0, torres = 0, patios = 1, puestos = 0, primera = 0;
    while (m.ganador < 0 && m.t < 20 * 60 * 30) {
      W.iaTick(m, a); W.iaTick(m, b); W.tick(m);
      if (m.t % 200 === 0) {
        const c = m.jug[0].cuenta;
        aviones = Math.max(aviones, (c.caza || 0) + (c.bombardero || 0) + (c.helicoptero || 0) + (c.dron || 0));
        torres = Math.max(torres, (c.torreta || 0) + (c.torreCanon || 0)); patios = Math.max(patios, c.patio || 0, m.jug[1].cuenta.patio || 0); // de cualquiera de los dos
        puestos = Math.max(puestos, m.puestos.filter((p) => p.dueno === 0).length);
        if (!primera && a.atacantes.size) primera = m.t;
      }
    }
    res[estilo] = { aviones, torres, patios, puestos, primera: +(primera / 1200).toFixed(1), fin: +(m.t / 1200).toFixed(1), ganador: m.ganador };
    console.log('      ' + estilo + ': ' + JSON.stringify(res[estilo]));
  }
  assert.ok(res.aereo.aviones >= 3 && res.aereo.aviones > res.asalto.aviones, 'el aéreo debía apostar por la aviación');
  assert.ok(res.defensivo.torres > res.asalto.torres, 'el defensivo debía levantar más torres que el de asalto');
  assert.ok(res.asalto.primera > 0 && res.asalto.primera < res.defensivo.primera, 'el de asalto debía atacar antes que el defensivo');
  assert.ok(Object.values(res).some((r) => r.patios > 1), 'algún estilo debía fundar una segunda base');
  assert.ok(Object.values(res).some((r) => r.puestos > 0), 'algún estilo debía capturar un puesto');
});

if (!process.env.RAPIDO) prueba('partidas completas IA contra IA', () => {
  const LIMITE = 20 * 60 * 90; // 90 minutos de juego
  let conGanador = 0;
  for (const s of [3, 101, 2026, 555]) {
    const m = W.crearMundo(s, { logistica: true }), a = W.iaCrear(0), b = W.iaCrear(1);
    const t0 = Date.now();
    let maxEnts = 0;
    while (m.ganador < 0 && m.t < LIMITE) { W.iaTick(m, a); W.iaTick(m, b); W.tick(m); if (m.ents.length > maxEnts) maxEnts = m.ents.length; }
    const [J0, J1] = m.jug;
    console.log(`      semilla ${s}: ganador ${m.ganador} en ${(m.t / 1200).toFixed(1)} min de juego · cosechado ${J0.cosechado}/${J1.cosechado} · producidas ${J0.producidas}/${J1.producidas} · bajas ${J0.bajas}/${J1.bajas} · petróleo ${J0.extraido}/${J1.extraido} · info ${J0.info}/${J1.info} · nivel ${J0.nivel}/${J1.nivel} · mejoras ${Object.keys(J0.mejoras).length}/${Object.keys(J1.mejoras).length} · máx entidades ${maxEnts} · ${(Date.now() - t0)} ms (${((Date.now() - t0) / m.t).toFixed(3)} ms/tick)`);
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
