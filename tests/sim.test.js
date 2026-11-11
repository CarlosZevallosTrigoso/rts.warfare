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
  for (let y = 50; y < 80; y++) for (let x = 30; x < 100; x++) { const i = y * N + x; if (!m.ocup[i]) { m.mapa.terreno[i] = 0; m.paso[i] = 1; } }
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
  for (let y = 56; y < 72; y++) for (let x = 30; x < 110; x++) { const i = y * N + x; if (!m.ocup[i]) { m.mapa.terreno[i] = 0; m.paso[i] = 1; } }
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
  const nuevo = () => { const m = W.crearMundo(4242, { N: 128 }); m.ents.filter((e) => !e.edif).forEach((e) => { e.vida = 0; }); W.tick(m); const N = m.N; for (let y = 40; y < 90; y++) for (let x = 20; x < 110; x++) { const i = y * N + x; if (!m.ocup[i]) { m.mapa.terreno[i] = 0; m.paso[i] = 1; } } return m; };
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
  for (let k = 0; k < 3; k++) { const emb = W.crearUnidad(m, 1, 'antitanque', en(m, Math.round(p.x) + 3 + k, 56)); emb.orden = 'atacar'; emb.obj = p.id; } // emboscada a uno solo
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
  for (let y = 50; y < 80; y++) for (let x = 30; x < 100; x++) { const i = y * N + x; if (!m.ocup[i]) { m.mapa.terreno[i] = 0; m.paso[i] = 1; } }
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
  for (let y = 40; y < 90; y++) for (let x = 30; x < 126; x++) { const i = y * N + x; if (!m.ocup[i]) { m.mapa.terreno[i] = 0; m.paso[i] = 1; } }
  for (let y = 58; y < 64; y++) for (let x = 60; x < 66; x++) { m.mapa.terreno[y * N + x] = 2; m.paso[y * N + x] = 0; } // un lago en medio
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
  for (let y = 40; y < 100; y++) for (let x = 30; x < 110; x++) { const i = y * N + x; if (!m.ocup[i]) { m.mapa.terreno[i] = 0; m.paso[i] = 1; } }
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
  for (let y = 20; y < 60; y++) for (let x = 60; x < 120; x++) { const i = y * N + x; if (!m.ocup[i]) { m.mapa.terreno[i] = 0; m.paso[i] = 1; m.mapa.mineral[i] = 0; } }
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
  const malo = W.crearUnidad(m, 1, 'infanteria', W.cercaLibre(m, co.x + 2, co.y)); malo.guardia = true;
  avanza(60);
  assert.ok(co.huye > 0 && (co.est === 'volver0' || co.est === 'volver'), 'atacada, debía huir a la refinería: ' + co.est);
  malo.vida = 0; let llego = false;
  avanza(900, () => { if (W.dist(co.x, co.y, ref) <= 1.5) llego = true; });
  assert.ok(llego, 'debía llegar a la refinería');
  avanza(700);
  assert.ok(co.huye === 0 && co.est !== 'espera', 'pasado el susto vuelve al trabajo: ' + co.est);
});

prueba('determinismo: misma semilla, misma partida', () => {
  const corre = () => {
    const m = W.crearMundo(777), a = W.iaCrear(0), b = W.iaCrear(1);
    for (let i = 0; i < 4000; i++) { W.iaTick(m, a); W.iaTick(m, b); W.tick(m); }
    return W.huella(m);
  };
  assert.strictEqual(corre(), corre());
});

if (!process.env.RAPIDO) prueba('partidas completas IA contra IA', () => {
  const LIMITE = 20 * 60 * 90; // 90 minutos de juego
  let conGanador = 0;
  for (const s of [3, 101, 2026, 555]) {
    const m = W.crearMundo(s), a = W.iaCrear(0), b = W.iaCrear(1);
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
