// rts.warfare — estado del mundo, comandos y tick de simulación. No toca el DOM.
(function () {
  const W = globalThis.W || (globalThis.W = {});
  const EDIF = W.EDIF, UNID = W.UNID, ARMAS = W.ARMAS, ECON = W.ECON, TEC = W.TEC, INTEL = W.INTEL, T = W.TERRENO, TAU = Math.PI * 2;

  // Desplazamientos ordenados por distancia: reparten los destinos de un grupo.
  const ESPIRAL = [];
  for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) ESPIRAL.push([dx, dy]);
  ESPIRAL.sort((a, b) => (a[0] * a[0] + a[1] * a[1]) - (b[0] * b[0] + b[1] * b[1]) || a[1] - b[1] || a[0] - b[0]);

  function nuevoJugador(inicio) {
    return {
      minerales: inicio || ECON.inicio, prod: 0, uso: 0, cuenta: {}, vivo: true, dios: false, admin: false,
      tr: { requisitos: false, libre: false, vel: 1, mapa: false, invulnerable: false }, // interruptores del panel ADMIN (los recursos infinitos son 'dios')
      obras: [], // [{ tipo, prog, listo, patio }]: cada patio lleva las suyas; dentro de un patio, tipos distintos se reparten la velocidad
      patiosMax: 1, // cuántos patios ha llegado a tener a la vez
      retiro: false, // retirada automática por defecto para las unidades nuevas
      colas: Object.fromEntries(Object.keys(UNID).map((t) => [t, { n: 0, prog: 0, sinAgua: false }])), // total encargado por tipo; las colas de verdad están en cada edificio (e.cola)
      alerta: null, cosechado: 0, bajas: 0, producidas: 0,
      colmena: true, // inteligencia de colmena: las unidades piden y dan apoyo solas
      nivel: 1, mejoras: {}, inv: [], intercepta: -1, // tecnología: nivel, mejoras hechas, investigaciones en curso
      petroleo: ECON.petInicio, raros: 0, info: 0, aguaProd: 0, aguaUso: 0, extraido: 0,
    };
  }

  // op: { N: lado del mapa, inicio: minerales iniciales }
  W.crearMundo = function (semilla, op) {
    op = op || {};
    const mapa = W.generarMapa(semilla, op.N), N = mapa.N, NN = N * N;
    const m = {
      N, semilla, mapa, t: 0, ents: [], porId: new Map(), sigId: 1,
      ocup: new Int32Array(NN), paso: new Uint8Array(NN), pasoV: new Uint8Array(NN), hayCaminos: false, terrenoV: 0, carrilX: new Float32Array(NN), carrilY: new Float32Array(NN), tramoEn: new Int32Array(NN), via: [new Uint8Array(NN), new Uint8Array(NN)], viaN: [0, 0], // via: celdas de camino de cada jugador (solo a su dueño le dan velocidad y preferencia de ruta)
      // carrilX/Y: por cada celda de camino, el punto del carril que le toca (0 = ninguno); tramoEn: el tramo dueño de la celda
      jug: [nuevoJugador(op.inicio), nuevoJugador(op.inicio)],
      niebla: [new Uint8Array(NN), new Uint8Array(NN)],
      cola: [], colaRutas: [], efectos: [], proy: [], barridos: [], misiles: [], muro: new Uint8Array(NN), muroJ: new Uint8Array(NN), muroTodo: new Uint8Array(NN), puertas: [new Uint8Array(NN), new Uint8Array(NN)], muros: [], muroId: new Map(), trincheras: new Map(), focos: [[], []], sigFoco: 1, marchas: {}, sigMarcha: 1, logistica: op.logistica !== false, // logistica: las unidades necesitan la cobertura de su red (se puede apagar al crear la partida)
      sigMision: 1, minas: [], raros: [], ganador: -1, embarques: [],
      puestos: mapa.puestos.map((p, i) => ({ id: i, tipo: p.tipo, x: p.x + 0.5, y: p.y + 0.5, dueno: -1, prog: 0, quien: -1 })), // puestos neutrales: los captura la infantería
      ruta: W.crearRuta(N),
    };
    for (let i = 0; i < NN; i++) {
      m.paso[i] = mapa.terreno[i] === T.LLANO || mapa.terreno[i] === T.BOSQUE || mapa.terreno[i] >= T.CAMINO ? 1 : 0; // a pie
      m.pasoV[i] = mapa.terreno[i] === T.LLANO || mapa.terreno[i] >= T.CAMINO ? 1 : 0; // sobre ruedas u orugas: el bosque no
      if (mapa.tipoMin[i] === 1) m.minas.push(i); else if (mapa.tipoMin[i] === 2) m.raros.push(i);
    }
    for (let j = 0; j < 2; j++) {
      const b = mapa.bases[j];
      crearEdificio(m, j, 'patio', b.x - 1, b.y - 1);
      const haciaCentro = j === 0 ? 1 : -1;
      for (let k = 0; k < 2; k++) crearUnidad(m, j, 'infanteria', W.cercaLibre(m, b.x + (3 + k) * haciaCentro, b.y - 3 * haciaCentro));
    }
    // Los alrededores de cada base ya se conocen al empezar: ahí están el agua, el campo y el primer yacimiento.
    for (let j = 0; j < 2; j++) {
      const b = mapa.bases[j], R = ECON.vistaInicial;
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        const x = b.x + dx, y = b.y + dy;
        if (x >= 0 && y >= 0 && x < N && y < N && dx * dx + dy * dy <= R * R) m.niebla[j][y * N + x] = 1;
      }
    }
    contar(m);
    W.actualizarNiebla(m);
    return m;
  };

  // ---------- entidades ----------
  function crearEdificio(m, j, tipo, x, y) {
    const d = EDIF[tipo], N = m.N;
    const e = { id: m.sigId++, j, tipo, edif: true, x, y, tam: d.tam, cx: x + d.tam / 2, cy: y + d.tam / 2, vida: d.vida, vidaMax: d.vida, recarga: 0, obj: 0, reunion: null, acum: 0, nace: m.t, cola: [], pago: [], prog: 0, sinAgua: false, sinFondos: false, bucle: false, angT: Math.atan2(N / 2 - y, N / 2 - x) };
    for (let dy = 0; dy < d.tam; dy++) for (let dx = 0; dx < d.tam; dx++) { const i = (y + dy) * N + x + dx; m.ocup[i] = e.id; m.paso[i] = 0; m.pasoV[i] = 0; }
    m.ents.push(e); m.porId.set(e.id, e); m.redSucia = true;
    return e;
  }
  // Las celdas de camino de cada jugador. En una partida guardada antes de que existieran, se reconstruyen de los tramos.
  function viaDe(m) {
    if (!m.via) { const NN = m.N * m.N; m.via = [new Uint8Array(NN), new Uint8Array(NN)]; m.viaN = [0, 0]; for (const e of m.ents) if (e.infra && !e.ponton) for (const c of e.celdas) if (m.tramoEn[c] === e.id) { m.via[e.j][c] = 1; m.viaN[e.j]++; } }
    return m.via;
  }
  // Un tramo de camino: infraestructura con vida propia. Guarda su recorrido (pts), las celdas que abrió y lo que había antes en ellas.
  // No ocupa celdas ni estorba: es una entidad para poder seleccionarla, atacarla, repararla y demolerla.
  function crearTramo(m, j, x, y) {
    const d = EDIF.camino;
    const e = { id: m.sigId++, j, tipo: 'camino', edif: true, infra: true, x: x - 0.5, y: y - 0.5, tam: 1, cx: x, cy: y, vida: d.vida, vidaMax: d.vida, recarga: 0, obj: 0, reunion: null, acum: 0, nace: m.t, cola: [], pago: [], prog: 0, sinAgua: false, sinFondos: false, bucle: false, angT: 0, pts: [x, y], largo: 0, celdas: [], antes: [] };
    m.ents.push(e); m.porId.set(e.id, e);
    return e;
  }
  // Un tramo de línea de servicio: va de (x0,y0) a (x1,y1) por encima de lo que haya; no toca el terreno. de / a: lo que tiene en cada extremo.
  function crearLinea(m, j, x0, y0, x1, y1, de) {
    const d = EDIF.linea;
    const e = { id: m.sigId++, j, tipo: 'linea', edif: true, infra: true, linea: true, x: (x0 + x1) / 2 - 0.5, y: (y0 + y1) / 2 - 0.5, tam: 1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, vida: d.vida, vidaMax: d.vida, recarga: 0, obj: 0, reunion: null, acum: 0, nace: m.t, cola: [], pago: [], prog: 0, sinAgua: false, sinFondos: false, bucle: false, angT: 0, pts: [x0, y0, x1, y1], largo: Math.hypot(x1 - x0, y1 - y0), celdas: [], antes: [], de, a: 0 };
    m.ents.push(e); m.porId.set(e.id, e); m.redSucia = true;
    return e;
  }
  // Ingeniero civil en automático: busca el edificio propio sin red que tenga más cerca (y que no esté ya encargado a otro) y lo une con el edificio conectado más próximo a él.
  function autoConectar(m, u) {
    if (m.jug[u.j].minerales < ECON.autoReserva && !m.jug[u.j].dios) return; // solo con algo de dinero de sobra
    const tomados = new Set();
    for (const o of m.ents) if (!o.edif && o.j === u.j && o !== u && o.orden === 'conectar' && o.obra) for (const p of o.obra.pares) { tomados.add(p[0]); tomados.add(p[1]); }
    let b = null, db = Infinity;
    for (const e of m.ents) {
      if (!e.edif || e.infra || e.j !== u.j || e.vida <= 0 || e.conRed || e.tipo === 'avanzada' || tomados.has(e.id)) continue;
      const d0 = Math.hypot(e.cx - u.x, e.cy - u.y); if (d0 < db) { db = d0; b = e; }
    }
    if (!b) return;
    let a = null, da = Infinity;
    for (const e of m.ents) {
      if (!e.edif || e.infra || e.j !== u.j || e.vida <= 0 || !e.conRed) continue;
      const d0 = Math.hypot(e.cx - b.cx, e.cy - b.cy); if (d0 < da) { da = d0; a = e; }
    }
    if (!a || da > ECON.autoLargo) return; // demasiado lejos para decidirlo solo: eso lo ordena el jugador (o va un depósito)
    u.orden = 'conectar'; u.obra = { pares: [[a.id, b.id]], prog: 0, hecho: 0, ult: 0, auto: true }; u.ruta = null; u.pend = null; u.obj = 0;
  }
  // El ingeniero civil conectando: va al primer edificio del par y, desde ahí, la línea avanza sola hasta el segundo, tramo a tramo y pagando cada uno.
  function tickConectar(m, u) {
    const ob = u.obra, J = m.jug[u.j];
    const fin = () => { u.orden = 'nada'; u.obra = null; u.ruta = null; };
    if (!ob) { fin(); return; }
    while (ob.pares.length) { const a = m.porId.get(ob.pares[0][0]), b = m.porId.get(ob.pares[0][1]); if (a && b && a.vida > 0 && b.vida > 0) break; ob.pares.shift(); ob.prog = 0; ob.ult = 0; }
    if (!ob.pares.length) { fin(); return; }
    const a = m.porId.get(ob.pares[0][0]), b = m.porId.get(ob.pares[0][1]);
    if (dist(u.x, u.y, a) > 2.2) { // aún no ha llegado al edificio de partida
      if (u.fallo) { u.fallo = false; if (ob.auto) u.autoT = m.t + 600; else m.efectos.push({ tipo: 'sinLinea', x1: u.x, y1: u.y, j: u.j, t: m.t, llegar: true }); fin(); return; }
      if (!u.pend && !u.ruta) pedirRuta(m, u, a.cx, a.cy, a.tam / 2 + 1.2);
      avanzar(m, u); return;
    }
    u.ruta = null; u.v = 0; u.ang = Math.atan2(b.cy - u.y, b.cx - u.x);
    const L = Math.hypot(b.cx - a.cx, b.cy - a.cy) || 1, ux = (b.cx - a.cx) / L, uy = (b.cy - a.cy) / L;
    const sig = Math.min(L, (ob.hecho || 0) + 5), precio = Math.ceil((sig - (ob.hecho || 0)) * ECON.lineaCelda); // el siguiente tramo, de hasta 5 celdas
    if ((ob.prog || 0) < sig) { ob.prog = Math.min(sig, (ob.prog || 0) + ECON.lineaVel); return; }
    if (ob.auto && J.minerales < precio + ECON.autoReserva && !J.dios) return; // en automático no deja la caja vacía: espera a que sobre
    if (J.minerales < precio) { if (!ob.avisado) { ob.avisado = true; m.efectos.push({ tipo: 'sinLinea', x1: u.x, y1: u.y, j: u.j, t: m.t }); } return; } // espera a tener con qué
    J.minerales -= precio; ob.avisado = false;
    const h0 = ob.hecho || 0, tr = crearLinea(m, u.j, a.cx + ux * h0, a.cy + uy * h0, a.cx + ux * sig, a.cy + uy * sig, ob.ult || a.id);
    const prev = ob.ult ? m.porId.get(ob.ult) : null; if (prev) prev.a = tr.id;
    ob.ult = tr.id; ob.hecho = sig;
    if (sig >= L) { tr.a = b.id; m.redSucia = true; ob.pares.shift(); ob.prog = 0; ob.hecho = 0; ob.ult = 0; }
  }
  // ---------- muros ----------
  // Los muros no son entidades: van en tablas del mapa (m.muro: tipo; m.muroJ: dueño + 1; m.muros: la lista de celdas, para dibujar).
  // Solo cuando alguien dispara a una celda se le crea un blanco (una entidad mínima) que lleva su vida.
  const MURO_N = W.MURO_N;
  function murosDe(m) { // partidas guardadas antes de que existieran
    if (!m.muro) { const NN = m.N * m.N; m.muro = new Uint8Array(NN); m.muroJ = new Uint8Array(NN); m.muroTodo = new Uint8Array(NN); m.puertas = [new Uint8Array(NN), new Uint8Array(NN)]; m.muros = []; m.muroId = new Map(); }
    return m.muro;
  }
  function puedeMuro(m, c) {
    if (murosDe(m)[c] || m.mapa.terreno[c] !== T.LLANO || m.ocup[c] || m.mapa.mineral[c] || m.mapa.sitioEn[c] || m.trincheras.has(c)) return false;
    const x = c % m.N, y = (c / m.N) | 0;
    for (const u of m.ents) if (!u.edif && !UNID[u.tipo].aire && Math.floor(u.x) === x && Math.floor(u.y) === y) return false; // hay alguien encima
    return true;
  }
  function ponerMuro(m, j, n, c) {
    m.muro[c] = n; m.muroJ[c] = j + 1; m.muros.push(c); m.muroV = (m.muroV || 0) + 1;
    if (n >= 2) { m.paso[c] = 0; m.pasoV[c] = 0; m.muroTodo[c] = 1; if (n === 4) m.puertas[j][c] = 1; }
  }
  function quitarMuro(m, c) {
    const n = murosDe(m)[c]; if (!n) return;
    m.muro[c] = 0; m.muroJ[c] = 0; m.muroTodo[c] = 0; m.puertas[0][c] = 0; m.puertas[1][c] = 0; m.muroV = (m.muroV || 0) + 1;
    const k = m.muros.indexOf(c); if (k >= 0) { m.muros[k] = m.muros[m.muros.length - 1]; m.muros.pop(); }
    if (n >= 2 && !m.ocup[c]) { m.paso[c] = 1; m.pasoV[c] = 1; }
    const b = m.porId.get(m.muroId.get(c)); m.muroId.delete(c); if (b && b.vida > 0) { b.vida = 0; b.quitado = true; }
  }
  function blancoMuro(m, c) { // la entidad a la que se dispara cuando se ataca esa celda de muro
    let e = m.porId.get(m.muroId.get(c)); if (e) return e;
    const d = MURO_N[m.muro[c]], x = c % m.N, y = (c / m.N) | 0;
    e = { id: m.sigId++, j: m.muroJ[c] - 1, tipo: 'camino', edif: true, infra: true, muro: m.muro[c], celda: c, x, y, tam: 1, cx: x + 0.5, cy: y + 0.5, vida: d.vida, vidaMax: d.vida, recarga: 0, obj: 0, reunion: null, acum: 0, nace: m.t, cola: [], pago: [], prog: 0, pts: [x + 0.5, y + 0.5], celdas: [], antes: [] };
    m.ents.push(e); m.porId.set(e.id, e); m.muroId.set(c, e.id);
    return e;
  }
  W.blancoMuro = (m, c) => (murosDe(m)[c] ? blancoMuro(m, c) : null);
  function danarMuros(m, x, y, r, arma, mult, de, j) { // una explosión también castiga los muros que pilla (j: de quién es; -1, de nadie: daña todos)
    if (!m.muros || !m.muros.length) return;
    const N = m.N, R = Math.ceil(r);
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const cx = Math.floor(x) + dx, cy = Math.floor(y) + dy; if (cx < 0 || cy < 0 || cx >= N || cy >= N) continue;
      const c = cy * N + cx; if (!m.muro[c] || m.muroJ[c] - 1 === j || Math.hypot(cx + 0.5 - x, cy + 0.5 - y) > r) continue;
      herir(m, blancoMuro(m, c), arma, mult, de);
    }
  }
  // El ingeniero civil levantando muro: va hasta cerca de cada celda de la línea y la construye, pagando cada una; se salta las que no valen.
  function tickMurar(m, u) {
    const ob = u.obra, J = m.jug[u.j], N = m.N;
    const fin = () => { u.orden = 'nada'; u.obra = null; u.ruta = null; };
    if (!ob || ob.i >= ob.celdas.length) { fin(); return; }
    const c = ob.celdas[ob.i], cx = (c % N) + 0.5, cy = ((c / N) | 0) + 0.5, n = ob.ns[ob.i], d = MURO_N[n];
    if (Math.hypot(u.x - cx, u.y - cy) > 2.6) {
      if (u.fallo) { u.fallo = false; ob.i++; return; } // no puede llegar: pasa a la siguiente
      if (!u.pend && !u.ruta) pedirRuta(m, u, cx, cy, 1.8);
      avanzar(m, u); return;
    }
    u.ruta = null; u.pend = null; u.v = 0; u.ang = Math.atan2(cy - u.y, cx - u.x);
    if (++ob.t < d.ticks) return;
    if (!puedeMuro(m, c)) { ob.t = 0; ob.i++; return; }
    if (J.minerales < d.costo && !J.dios) { ob.t = d.ticks; if (!ob.avisado) { ob.avisado = true; m.efectos.push({ tipo: 'sinLinea', x1: u.x, y1: u.y, j: u.j, t: m.t, muro: true }); } return; }
    if (!J.dios) J.minerales -= d.costo;
    ob.avisado = false; ob.t = 0; ob.i++; ponerMuro(m, u.j, n, c);
  }
  // Cámaras: cada medio segundo descubren a los escondidos que tengan cerca y, si entra un enemigo, avisan (como mucho cada 15 s).
  function tickCamaras(m) {
    for (const e of m.ents) {
      if (!e.edif || e.infra || !EDIF[e.tipo].detecta || e.sinLuz || e.hack > m.t) continue;
      const r = EDIF[e.tipo].detecta; let visto = null;
      for (const u of m.ents) { if (u.edif || u.j === e.j || u.vida <= 0 || u.enTierra || Math.abs(u.x - e.cx) > r || Math.hypot(u.x - e.cx, u.y - e.cy) > r) continue; u.camT = m.t; visto = visto || u; }
      if (visto && m.t - (e.tAviso === undefined ? -999 : e.tAviso) > 300) { e.tAviso = m.t; m.efectos.push({ tipo: 'camara', x1: e.cx, y1: e.cy, x2: visto.x, y2: visto.y, j: e.j, clase: visto.tipo, t: m.t }); }
    }
  }
  // ---------- drones ----------
  // Cada portador (estación, operador o comando de drones) mantiene los suyos: repone los que le derriban, uno cada cierto tiempo y
  // pagándolo, y manda los de ataque contra lo que su bando tenga a la vista dentro de su radio. Si el portador cae, caen sus drones.
  const DRON = { rec: 'dronRec', bomba: 'dronBomba', fpv: 'dronFpv' };
  // La dotación de drones de un portador: la de su ficha, más lo que le den las mejoras (la estación, por nivel; el operador, por tecnología).
  W.dronesDe = function (m, e) {
    const d = e.edif ? EDIF[e.tipo] : UNID[e.tipo]; if (!d.drones) return null;
    const J = m.jug[e.j], n = d.dronesN && d.dronesN[e.nivelE || 1];
    if (n) return n;
    if (e.tipo === 'operador' && (J.mejoras.dronesFpv || J.mejoras.dronesPes)) return { rec: d.drones.rec, fpv: J.mejoras.dronesFpv ? 2 : 0, bomba: J.mejoras.dronesPes ? 1 : 0, radio: d.radioDron + (J.mejoras.dronesPes ? 4 : 0) };
    return { rec: d.drones.rec || 0, bomba: d.drones.bomba || 0, fpv: d.drones.fpv || 0, radio: d.radioDron };
  };
  function tickPortadores(m) {
    for (const e of m.ents) {
      const d = e.edif ? EDIF[e.tipo] : UNID[e.tipo];
      if (!d.drones || e.vida <= 0 || e.infra) continue;
      const dn = W.dronesDe(m, e);
      const J = m.jug[e.j], x = posX(e), y = posY(e), N = m.N;
      if (!e.dr) e.dr = { rec: [], bomba: [], fpv: [] };
      for (const k in e.dr) e.dr[k] = e.dr[k].filter((id) => { const q = m.porId.get(id); return q && q.vida > 0; });
      const activo = !(e.edif && e.sinLuz) && !(e.hack > m.t) && !(d.quieto && (e.orden !== 'nada' || e.v > 0.001)); // el operador solo trabaja parado
      if (!activo) { if (d.quieto && e.dronMis && e.orden !== 'nada') e.dronMis = null; continue; } // si echa a andar, la misión se acaba
      const mis = e.dronMis || null;
      const saca = (rol, obj) => { const q = crearUnidad(m, e.j, DRON[rol], Math.floor(y) * N + Math.floor(x)); q.x = q.px = x; q.y = q.py = y; q.base = e.id; q.rol = rol; q.fase = (e.id * 1.7 + e.dr[rol].length * 2.1) % TAU; q.obj = obj || 0; q.est = rol === 'bomba' ? 'espera' : ''; e.dr[rol].push(q.id); return q; };
      for (const rol of ['rec', 'bomba']) { // reconocimiento y bombarderos: se reponen de uno en uno
        if (!dn[rol] || e.dr[rol].length >= dn[rol] || m.t < (e.drListo || 0)) continue;
        const precio = UNID[DRON[rol]].costo, primero = !e.drHubo; // los primeros vienen con el portador; los repuestos se pagan
        if (!primero && J.minerales < precio && !J.dios) continue;
        if (!primero && !J.dios) J.minerales -= precio;
        saca(rol); e.drListo = m.t + (e.dr.rec.length + e.dr.bomba.length >= (dn.rec || 0) + (dn.bomba || 0) ? ECON.dronRepone : 20);
        if (e.dr.rec.length + e.dr.bomba.length >= (dn.rec || 0) + (dn.bomba || 0)) e.drHubo = true;
        break;
      }
      if ((!dn.fpv && !dn.bomba) || e.dronAtk === false) continue;
      // blancos: enemigos de tierra a la vista de su bando dentro del radio. El kamikaze va por vehículos y edificios con arma; el bombardero, por infantería.
      let veh = null, inf = null, dv = Infinity, di = Infinity; const pri = e.dronObj ? m.porId.get(e.dronObj) : null;
      for (const o of m.ents) {
        if (o.j === e.j || o.vida <= 0 || o.infra || (!o.edif && UNID[o.tipo].aire)) continue;
        const ox = posX(o), oy = posY(o), dd = Math.hypot(ox - x, oy - y);
        if ((dd > dn.radio && !(mis && Math.hypot(ox - mis.x, oy - mis.y) <= ECON.dronMisRadio)) || m.niebla[e.j][Math.floor(oy) * N + Math.floor(ox)] !== 2 || oculta(m, o)) continue; // dentro de su radio, o en la zona de la misión
        const k = o === pri ? -1000 : 0;
        if (o.edif ? !!EDIF[o.tipo].arma || o === pri : UNID[o.tipo].cat === 'veh') { const yaVan = e.dr.fpv.filter((id) => m.porId.get(id).obj === o.id).length; if (yaVan < 2 && dd + k + (o.edif ? 6 : 0) < dv) { dv = dd + k + (o.edif ? 6 : 0); veh = o; } }
        else if (!o.edif && dd + k < di) { di = dd + k; inf = o; }
      }
      if (dn.fpv && veh && e.dr.fpv.length < dn.fpv && m.t >= (e.fpvT || 0) && (J.minerales >= ECON.dronFpv || J.dios)) { if (!J.dios) J.minerales -= ECON.dronFpv; saca('fpv', veh.id); e.fpvT = m.t + ECON.dronFpvCada; }
      const blanco = inf || veh;
      if (blanco) for (const id of e.dr.bomba) { const q = m.porId.get(id); if (q.est === 'espera' && q.recarga <= 0 && (J.minerales >= ECON.dronBomba || J.dios)) { if (!J.dios) J.minerales -= ECON.dronBomba; q.obj = blanco.id; q.est = 'ir'; break; } }
    }
  }
  // ---------- zapadores: minas, pontones y voladuras ----------
  // Por dónde cruzaría un pontón que pase por la celda de agua (x, y): de los cuatro ejes, el más corto que toque tierra firme por los dos lados.
  // Devuelve las filas de celdas (dos de ancho, para que quepan los vehículos), empezando por la orilla más cercana al ingeniero, y esa orilla.
  function planPonton(m, x, y, u) {
    const N = m.N, terr = m.mapa.terreno, agua = (a, b) => a >= 0 && b >= 0 && a < N && b < N && terr[b * N + a] === T.AGUA && !m.tramoEn[b * N + a];
    const tierra = (a, b) => a >= 0 && b >= 0 && a < N && b < N && terr[b * N + a] !== T.AGUA && m.paso[b * N + a] === 1;
    if (!agua(x, y)) return null;
    let mejor = null;
    for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
      let a = 0, b = 0; while (a < ECON.pontonMax && agua(x - dx * (a + 1), y - dy * (a + 1))) a++; while (b < ECON.pontonMax && agua(x + dx * (b + 1), y + dy * (b + 1))) b++;
      if (a + b + 1 > ECON.pontonMax || !tierra(x - dx * (a + 1), y - dy * (a + 1)) || !tierra(x + dx * (b + 1), y + dy * (b + 1))) continue;
      const largo = (a + b + 1) * (dx && dy ? 1.4 : 1);
      if (!mejor || largo < mejor.largo) mejor = { largo, dx, dy, a, b };
    }
    if (!mejor) return null;
    const { dx, dy, a, b } = mejor, e0 = [x - dx * (a + 1), y - dy * (a + 1)], e1 = [x + dx * (b + 1), y + dy * (b + 1)];
    const alReves = Math.hypot(u.x - e1[0], u.y - e1[1]) < Math.hypot(u.x - e0[0], u.y - e0[1]), filas = [];
    for (let k = -a; k <= b; k++) { const cx = x + dx * k, cy = y + dy * k, f = [cy * N + cx]; const ox = dx && !dy ? 0 : 1, oy = dx && !dy ? 1 : 0; if (agua(cx + ox, cy + oy)) f.push((cy + oy) * N + cx + ox); filas.push(f); }
    if (alReves) filas.reverse();
    const s = alReves ? e1 : e0;
    return { filas, sx: s[0] + 0.5, sy: s[1] + 0.5 };
  }
  function tickZapar(m, u) {
    const z = u.zapa, J = m.jug[u.j], N = m.N, terr = m.mapa.terreno;
    const sig = () => { z.lista.shift(); z.prog = 0; u.ruta = null; u.pend = null; u.fallo = false; if (!z.lista.length) { u.orden = 'nada'; u.zapa = null; } };
    if (!z || !z.lista.length) { u.orden = 'nada'; u.zapa = null; return; }
    const q = z.lista[0];
    const llegar = (x, y, r) => { // true cuando está a r del punto; si no hay ruta, deja la tarea
      if (Math.hypot(u.x - x, u.y - y) <= r) { u.ruta = null; u.pend = null; u.v = 0; u.ang = Math.atan2(y - u.y, x - u.x); return true; }
      if (u.fallo) { u.fallo = false; sig(); return false; }
      if (!u.pend && !u.ruta) pedirRuta(m, u, x, y, Math.max(0.5, r - 0.5));
      avanzar(m, u); return false;
    };
    if (!m.minasT) m.minasT = [];
    if (q.t === 'minar') {
      if (!llegar(q.x, q.y, 1.4)) return;
      if (++z.prog < ECON.minaTiempo) return;
      const c = Math.floor(q.y) * N + Math.floor(q.x); let mias = 0, ya = false; for (const mn of m.minasT) { if (mn.j === u.j) mias++; if (mn.c === c) ya = true; }
      if (!ya && m.paso[c] && mias < ECON.minasMax && (J.minerales >= ECON.minaCosto || J.dios)) { if (!J.dios) J.minerales -= ECON.minaCosto; m.minasT.push({ x: q.x, y: q.y, c, j: u.j, vis: false }); m.efectos.push({ tipo: 'minaPuesta', x1: q.x, y1: q.y, j: u.j, t: m.t }); }
      else if (!ya) m.efectos.push({ tipo: 'sinMina', x1: q.x, y1: q.y, j: u.j, t: m.t, tope: mias >= ECON.minasMax });
      sig(); return;
    }
    if (q.t === 'desminar') {
      if (!q.en) { if (llegar(q.x, q.y, ECON.desminaRadio - 1)) q.en = true; return; }
      let mn = null, md = Infinity; for (const o of m.minasT) { if (o.j === u.j || Math.hypot(o.x - q.x, o.y - q.y) > ECON.desminaRadio) continue; const d0 = Math.hypot(o.x - u.x, o.y - u.y); if (d0 < md) { md = d0; mn = o; } }
      if (!mn) { sig(); return; } // zona limpia
      mn.vis = true;
      if (!llegar(mn.x, mn.y, 1.3)) return;
      if (++z.prog < ECON.desminaTiempo) return;
      z.prog = 0; m.minasT.splice(m.minasT.indexOf(mn), 1); m.efectos.push({ tipo: 'minaFuera', x1: mn.x, y1: mn.y, j: u.j, t: m.t });
      return;
    }
    if (q.t === 'volar') {
      const tr = m.porId.get(q.id); if (!tr || tr.vida <= 0) { sig(); return; }
      if (!llegar(q.x, q.y, 1.8)) return;
      if (++z.prog < ECON.volarTiempo) return;
      tr.vida = 0; m.efectos.push({ tipo: 'impacto', x1: q.x, y1: q.y, x2: q.x, y2: q.y, j: u.j, t: m.t, arma: 'mina', acierto: true });
      sig(); return;
    }
    if (q.t === 'ponton') {
      if (!q.tr && !llegar(q.sx, q.sy, 1.8)) return;
      let tr = q.tr ? m.porId.get(q.tr) : null;
      if (q.tr && (!tr || tr.vida <= 0)) { sig(); return; } // se lo han hundido a medio tender
      if (q.k >= q.filas.length) { sig(); return; }
      if (++z.prog < ECON.pontonCada) return;
      const fila = q.filas[q.k], precio = ECON.pontonCelda * fila.length;
      if (J.minerales < precio && !J.dios) { if (!q.avisado) { q.avisado = true; m.efectos.push({ tipo: 'sinCamino', x1: u.x, y1: u.y, j: u.j, t: m.t }); } return; } // espera a tener con qué
      z.prog = 0; if (!J.dios) J.minerales -= precio;
      const c0 = fila[0], fx = (c0 % N) + 0.5, fy = ((c0 / N) | 0) + 0.5;
      if (!tr) { tr = crearTramo(m, u.j, fx, fy); tr.ponton = true; tr.puente = true; tr.vida = tr.vidaMax = ECON.pontonVida; q.tr = tr.id; } else { tr.pts.push(fx, fy); tr.largo += 1; }
      for (const c of fila) { if (terr[c] !== T.AGUA || m.tramoEn[c]) continue; tr.celdas.push(c); tr.antes.push(T.AGUA); m.tramoEn[c] = tr.id; terr[c] = T.PUENTE; m.paso[c] = 1; m.pasoV[c] = 1; }
      m.hayCaminos = true; m.terrenoV++; q.k++;
      if (q.k >= q.filas.length) { tr.cx = (tr.pts[0] + fx) / 2; tr.cy = (tr.pts[1] + fy) / 2; tr.x = tr.cx - 0.5; tr.y = tr.cy - 0.5; m.efectos.push({ tipo: 'pontonListo', x1: tr.cx, y1: tr.cy, j: u.j, t: m.t }); }
      return;
    }
    sig();
  }
  // Minas terrestres: no son fichas, sino puntos. Estallan cuando las pisa una unidad de tierra enemiga que no sea zapador; las descubren
  // los zapadores enemigos que pasen cerca y las cámaras.
  function tickMinas(m) {
    const g = m.gr, C = g.C, ini = g.ini, us = g.us, ver = m.t % 10 === 0, arma = ARMAS.mina;
    for (let k = m.minasT.length - 1; k >= 0; k--) {
      const mn = m.minasT[k], gx = Math.min(C - 1, (mn.x / GC) | 0), gy = Math.min(C - 1, (mn.y / GC) | 0); let pisa = false;
      for (let cy = Math.max(0, gy - 1); cy <= Math.min(C - 1, gy + 1) && !pisa; cy++) for (let cx = Math.max(0, gx - 1); cx <= Math.min(C - 1, gx + 1) && !pisa; cx++) for (let i = ini[cy * C + cx], f = ini[cy * C + cx + 1]; i < f; i++) {
        const u = us[i], d = UNID[u.tipo];
        if (u.j === mn.j || u.vida <= 0 || d.aire) continue;
        const dd = Math.hypot(u.x - mn.x, u.y - mn.y);
        if (d.zapador) { if (ver && dd <= ECON.minaVe) mn.vis = true; continue; }
        if (dd <= ECON.minaPisa) { pisa = true; m.jug[u.j].minaVista = { x: mn.x, y: mn.y, t: m.t }; break; } // (su bando se entera de dónde había minas)
      }
      if (!pisa) { if (ver && !mn.vis) for (const e of g.edifs) if (e.j !== mn.j && EDIF[e.tipo].detecta && !e.sinLuz && Math.hypot(e.cx - mn.x, e.cy - mn.y) <= EDIF[e.tipo].detecta) { mn.vis = true; break; } continue; }
      m.minasT.splice(k, 1);
      for (let cy = Math.max(0, gy - 1); cy <= Math.min(C - 1, gy + 1); cy++) for (let cx = Math.max(0, gx - 1); cx <= Math.min(C - 1, gx + 1); cx++) for (let i = ini[cy * C + cx], f = ini[cy * C + cx + 1]; i < f; i++) {
        const u = us[i]; if (u.j === mn.j || u.vida <= 0 || UNID[u.tipo].aire) continue;
        const dd = Math.hypot(u.x - mn.x, u.y - mn.y); if (dd <= arma.area) herir(m, u, arma, dd <= ECON.minaPisa ? 1 : 0.5, 0);
      }
      m.efectos.push({ tipo: 'impacto', x1: mn.x, y1: mn.y, x2: mn.x, y2: mn.y, j: mn.j, t: m.t, arma: 'mina', acierto: true, mina: true });
    }
  }
  // ---------- suministro móvil ----------
  // Camiones y helicópteros de suministro: ida al punto, plantados mientras dura la carga, vuelta al puesto logístico, recarga y otra vez.
  // Devuelve los que están plantados y con carga (para el reparto del suministro de este ciclo).
  function tickSuministro(m) {
    const pts = [];
    for (const u of m.ents) {
      if (u.edif || u.vida <= 0) continue;
      const cfg = UNID[u.tipo].suministro; if (!cfg) continue;
      if (u.sumC === undefined) u.sumC = cfg.carga;
      const s = u.sumi, J = m.jug[u.j], aire = UNID[u.tipo].aire;
      if (!s) { u.sumiN = 0; continue; }
      if (s.est === 'puesto') { u.sumC = Math.max(0, u.sumC - ECON.sumiBase - ECON.sumiUnidad * (u.sumiN || 0)); u.sumiAt = u.sumiN || 0; } // lo gastado en el ciclo anterior
      u.sumiN = 0;
      const parado = u.orden === 'nada' && !u.pend;
      if (s.est === 'ida') {
        if (aire && (u.enTierra || u.repostando)) { if (u.enTierra && !u.repostando && parado) asignar(m, u, { t: 'mover', x: s.x, y: s.y }); }
        else if (parado) { if (Math.hypot(u.x - s.x, u.y - s.y) < 3.5) s.est = 'puesto'; else if ((s.n = (s.n || 0) + 1) > 6) { s.x = u.x; s.y = u.y; s.est = 'puesto'; } else asignar(m, u, { t: 'mover', x: s.x, y: s.y }); } // (si no consigue llegar, se planta donde está)
      } else if (s.est === 'puesto') {
        if (u.sumC <= 0 || (aire && u.repostando)) {
          let base = null, md = Infinity; for (const b of m.ents) { if (b.tipo !== 'logistica' || b.j !== u.j || b.vida <= 0) continue; const d0 = Math.hypot(b.cx - u.x, b.cy - u.y); if (d0 < md) { md = d0; base = b; } }
          if (base) { s.est = 'vuelta'; s.base = base.id; s.n = 0; m.efectos.push({ tipo: 'sumiVacio', x1: u.x, y1: u.y, j: u.j, t: m.t }); if (!aire) { const c = W.cercaLibre(m, base.cx, base.cy + base.tam / 2 + 1.5, true); asignar(m, u, { t: 'mover', x: (c % m.N) + 0.5, y: ((c / m.N) | 0) + 0.5 }); } }
        } else pts.push({ x: u.x, y: u.y, r2: cfg.radio * cfg.radio, j: u.j, u });
      } else if (s.est === 'vuelta') {
        const base = m.porId.get(s.base);
        if (!base || base.vida <= 0) { s.est = 'puesto'; continue; } // sin puesto logístico al que volver: se queda donde está (vacío) hasta que haya otro
        if (aire ? u.enTierra : parado && Math.hypot(u.x - base.cx, u.y - base.cy) < 6) { s.est = 'carga'; s.pagado = false; }
        else if (!aire && parado) { const c = W.cercaLibre(m, base.cx, base.cy + base.tam / 2 + 1.5, true); asignar(m, u, { t: 'mover', x: (c % m.N) + 0.5, y: ((c / m.N) | 0) + 0.5 }); }
      } else if (s.est === 'carga') {
        if (!s.pagado) { if (J.minerales < cfg.recarga && !J.dios) continue; if (!J.dios) J.minerales -= cfg.recarga; s.pagado = true; } // la recarga se paga; sin minerales, espera
        const base = m.porId.get(s.base); if (base && (base.sinLuz || base.hack > m.t)) continue; // el puesto apagado no carga
        u.sumC = Math.min(cfg.carga, u.sumC + ECON.sumiCarga);
        if (u.sumC >= cfg.carga && !(aire && u.repostando)) { s.est = 'ida'; s.n = 0; asignar(m, u, { t: 'mover', x: s.x, y: s.y }); }
      }
    }
    return pts;
  }
  // ---------- espías ----------
  // Un espía a pocas celdas de un edificio enemigo: su bando ve los recursos del rival y lo que produce (como «interceptar»), y gana información.
  function tickEspias(m) {
    const g = m.gr; if (!g) return;
    for (const u of g.us) {
      if (!UNID[u.tipo].espia || u.vida <= 0) continue;
      let cerca = false;
      for (const e of g.edifs) if (e.j !== u.j && e.vida > 0 && dist(u.x, u.y, e) <= ECON.espiaRadio) { cerca = true; break; }
      if (cerca !== !!u.infiltrado) { u.infiltrado = cerca; if (cerca) m.efectos.push({ tipo: 'infiltrado', x1: u.x, y1: u.y, j: u.j, t: m.t }); }
      if (!cerca) continue;
      const J = m.jug[u.j]; J.intercepta = Math.max(J.intercepta || 0, m.t + 30);
      if (m.t % 40 === 0) J.info += ECON.espiaInfo;
    }
  }
  // ---------- puente aéreo ----------
  // Cada puesto de avanzada tiene un helicóptero de carga que va y viene de un puesto logístico. Cada entrega renueva su enlace;
  // si derriban los vuelos y el enlace caduca, el puesto se queda fuera de la red hasta que llegue otro.
  function tickPuenteAereo(m) {
    for (const e of m.ents) {
      if (e.tipo !== 'avanzada' || e.vida <= 0) continue;
      const J = m.jug[e.j], N = m.N, vivo = e.abast > m.t;
      if (vivo !== !!e.enlace) { e.enlace = vivo; m.redSucia = true; if (!vivo) m.efectos.push({ tipo: 'sinEnlace', x1: e.cx, y1: e.cy, j: e.j, t: m.t }); }
      if (vivo) for (const u of m.ents) { if (u.edif || u.j !== e.j || u.vida <= 0 || u.vida >= u.vidaMax || UNID[u.tipo].cat !== 'inf' || Math.hypot(u.x - e.cx, u.y - e.cy) > EDIF.avanzada.hospital) continue; u.vida = Math.min(u.vidaMax, u.vida + ECON.hospitalCura); u.curando = m.t; } // hospital
      const h = e.heli ? m.porId.get(e.heli) : null;
      if ((h && h.vida > 0) || m.t < (e.heliT || 0)) continue;
      let base = null, md = Infinity; // el puesto logístico propio más cercano que funcione
      for (const b of m.ents) { if (b.tipo !== 'logistica' || b.j !== e.j || b.vida <= 0 || b.sinLuz || b.hack > m.t) continue; const d0 = Math.hypot(b.cx - e.cx, b.cy - e.cy); if (d0 < md) { md = d0; base = b; } }
      if (!base) continue;
      if (e.heliHubo && J.minerales < UNID.heliCarga.costo && !J.dios) continue; // el primero viene con el puesto; reponer uno derribado se paga
      if (e.heliHubo && !J.dios) J.minerales -= UNID.heliCarga.costo;
      const q = crearUnidad(m, e.j, 'heliCarga', Math.floor(base.cy) * N + Math.floor(base.cx)); q.x = q.px = base.cx; q.y = q.py = base.cy; q.rol = 'carga'; q.base = base.id; q.av = e.id; q.est = 'ida';
      e.heli = q.id; e.heliT = m.t + ECON.heliRepone; e.heliHubo = true;
    }
  }
  function tickHeli(m, u) {
    const d = UNID[u.tipo];
    const ir = (x, y) => { const dx = x - u.x, dy = y - u.y, dd = Math.hypot(dx, dy); if (dd > 0.05) u.ang = Math.atan2(dy, dx); u.v = Math.min(d.vel, dd); if (dd > 1e-6) { u.x += (dx / dd) * u.v; u.y += (dy / dd) * u.v; } return dd; };
    if (u.rol === 'tropa') { // lleva a los suyos a la otra pista, los deja y se va
      if (u.est === 'fuera') { if (ir(u.ox, u.oy) <= 0.6) { u.vida = 0; u.retirado = true; } return; }
      if (ir(u.tx, u.ty) > 0.4) return;
      const lista = u.pasajeros; u.pasajeros = []; apear(m, u, lista); contar(m);
      m.efectos.push({ tipo: 'aterriza', x1: u.x, y1: u.y, j: u.j, n: lista.length, t: m.t }); u.est = 'fuera';
      return;
    }
    const base = m.porId.get(u.base), av = m.porId.get(u.av); // de carga
    if (!base || base.vida <= 0 || !av || av.vida <= 0) { u.vida = 0; return; }
    if (u.espera > m.t) return;
    if (u.est === 'ida') { if (ir(av.cx, av.cy) <= 0.5) { av.abast = m.t + ECON.abastDura; u.est = 'vuelta'; u.espera = m.t + 40; } }
    else if (ir(base.cx, base.cy) <= 0.5) { u.est = 'ida'; u.espera = m.t + 60; }
  }
  function tickDron(m, u) {
    if (UNID[u.tipo].heli) { tickHeli(m, u); return; }
    const d = UNID[u.tipo], base = m.porId.get(u.base);
    if (!base || base.vida <= 0) { u.vida = 0; return; } // sin portador, cae
    if (m.t - (u.tInterf === undefined ? -99 : u.tInterf) <= 12) { u.vida -= 1.2; if (u.vida <= 0) m.efectos.push({ tipo: 'interferido', x1: u.x, y1: u.y, j: u.j, t: m.t }); return; } // interferido por un vehículo de mando enemigo: pierde el enlace y cae
    const bx = posX(base), by = posY(base), cfg = { radioDron: W.dronesDe(m, base).radio };
    const ir = (x, y, vel) => { const dx = x - u.x, dy = y - u.y, dd = Math.hypot(dx, dy); if (dd > 0.02) u.ang = Math.atan2(dy, dx); u.v = Math.min(vel, dd); if (dd > 1e-6) { u.x += (dx / dd) * u.v; u.y += (dy / dd) * u.v; } return dd; };
    const orbita = (r, cx, cy) => { const a = u.fase + m.t * (0.6 / Math.max(3, r)) * 0.33; ir((cx === undefined ? bx : cx) + Math.cos(a) * r, (cy === undefined ? by : cy) + Math.sin(a) * r, d.vel); };
    const mis = base.dronMis || null;
    const parado = base.edif || (base.orden === 'nada' && base.v < 0.001);
    if (u.rol === 'rec') { if (parado && mis) orbita(3.5, mis.x, mis.y); else orbita(parado ? cfg.radioDron * 0.55 : 2.2); return; } // en misión, da vueltas sobre el punto lejano
    const o = u.obj ? m.porId.get(u.obj) : null, vivo = o && o.vida > 0;
    if (u.rol === 'fpv') {
      if (!vivo || (Math.hypot(posX(o) - bx, posY(o) - by) > cfg.radioDron + 3 && !(mis && Math.hypot(posX(o) - mis.x, posY(o) - mis.y) <= ECON.dronMisRadio + 3))) { u.vida = 0; return; } // sin blanco: se pierde
      if (ir(posX(o), posY(o), d.vel) <= (o.edif ? o.tam * 0.5 : 0.35)) {
        const arma = ARMAS.fpv;
        for (const e of m.ents) if (e.j !== u.j && e.vida > 0 && !e.muro && dist(u.x, u.y, e) <= arma.area) herir(m, e, arma, e === o ? 1 : 0.5, 0, u.x, u.y);
        m.efectos.push({ tipo: 'impacto', x1: u.x, y1: u.y, x2: u.x, y2: u.y, j: u.j, t: m.t, arma: 'fpv', acierto: true });
        u.vida = 0; u.sinResto = true;
      }
      return;
    }
    // bombardero
    if (u.est === 'ir') {
      if (!vivo) { u.est = 'volver'; return; }
      if (ir(posX(o), posY(o), d.vel) <= 0.5) {
        const arma = ARMAS.granada;
        danarMuros(m, u.x, u.y, arma.area, arma, 1, 0, u.j);
        for (const e of m.ents) if (e.j !== u.j && e.vida > 0 && !e.muro && !(!e.edif && UNID[e.tipo].aire) && dist(u.x, u.y, e) <= arma.area) herir(m, e, arma, 1, 0);
        m.efectos.push({ tipo: 'impacto', x1: u.x, y1: u.y, x2: u.x, y2: u.y, j: u.j, t: m.t, arma: 'granada', acierto: true });
        u.est = 'volver'; u.obj = 0;
      }
    } else if (u.est === 'volver') { if (ir(bx, by, d.vel) <= 0.8) { u.est = 'espera'; u.recarga = 100; } }
    else orbita(1.6);
  }
  // ---------- misiles balísticos ----------
  const MIS = W.MISILES, VS_MISIL = { ligero: 1, pesado: 1, edificio: 1.2, aire: 0 };
  const guardados = (e) => { let n = 0; if (e.silo) for (const k in e.silo) n += e.silo[k]; return n + (e.fabMis ? e.fabMis.length : 0); };
  W.alcanceMisil = (m, e, tipo, x, y) => !MIS[tipo].alcance || Math.hypot(x - e.cx, y - e.cy) <= MIS[tipo].alcance;
  function tickMisiles(m) {
    for (const e of m.ents) { // fábrica de misiles e interceptores
      if (!e.edif || e.infra) continue;
      const d = EDIF[e.tipo];
      if (d.misiles && e.fabMis && e.fabMis.length && !(e.hack > m.t)) {
        e.progMis = (e.progMis || 0) + m.jug[e.j].tr.vel * (e.sinLuz ? 0.5 : 1);
        if (e.progMis >= MIS[e.fabMis[0]].tiempo) { const t = e.fabMis.shift(); e.progMis = 0; if (!e.silo) e.silo = {}; e.silo[t] = (e.silo[t] || 0) + 1; m.efectos.push({ tipo: 'misilListo', x1: e.cx, y1: e.cy, j: e.j, clase: t, t: m.t }); }
      }
      if (d.intercepta) {
        if (e.cargas === undefined) e.cargas = d.cargas;
        if (e.cargas < d.cargas && !e.sinLuz) { e.repone = (e.repone || 0) + 1; if (e.repone >= d.reponeCarga) { e.repone = 0; e.cargas++; } }
        if (e.cargas <= 0 || e.sinLuz || e.hack > m.t || (m.t + e.id) % 4) continue;
        for (const q of m.misiles) { // dispara al misil enemigo más avanzado que tenga en su radio y que nadie haya rematado ya
          if (q.j === e.j || q.vida <= 0 || Math.hypot(q.x - e.cx, q.y - e.cy) > d.intercepta) continue;
          e.cargas--; q.vida--; e.angT = Math.atan2(q.y - e.cy, q.x - e.cx);
          m.efectos.push({ tipo: 'intercepta', x1: e.cx, y1: e.cy, x2: q.x, y2: q.y, j: e.j, derribo: q.vida <= 0, t: m.t });
          break;
        }
      }
    }
    for (let k = m.misiles.length - 1; k >= 0; k--) {
      const q = m.misiles[k], d = MIS[q.tipo];
      if (q.vida <= 0) { m.misiles.splice(k, 1); continue; } // derribado
      const dx = q.tx - q.x, dy = q.ty - q.y, dd = Math.hypot(dx, dy);
      q.px = q.x; q.py = q.y;
      if (dd > d.vel) { q.x += (dx / dd) * d.vel; q.y += (dy / dd) * d.vel; continue; }
      const arma = { dano: d.dano, area: d.area, vs: VS_MISIL }; // cae: daña todo lo que haya en el radio, sea de quien sea, más cuanto más cerca del centro
      danarMuros(m, q.tx, q.ty, d.area, arma, 0.7, 0, -1); // primero se les da blanco a los muros de la zona, y luego cae sobre todo
      for (const e of m.ents) { if (e.vida <= 0 || e.muro) continue; const r = dist(q.tx, q.ty, e); if (r <= d.area) herir(m, e, arma, 1 - 0.6 * (r / d.area), 0); }
      m.efectos.push({ tipo: 'impactoMisil', x2: q.tx, y2: q.ty, area: d.area, j: q.j, clase: q.tipo, t: m.t });
      m.misiles.splice(k, 1);
    }
  }
  // ¿Se puede hackear? Vehículos de tierra y edificios enemigos (no la infantería, ni los aviones, ni caminos o líneas).
  const hackeable = (u, o) => !!o && o.vida > 0 && o.j !== u.j && !o.infra && (o.edif || (UNID[o.tipo].cat === 'veh' && !UNID[o.tipo].aire));
  W.hackeable = hackeable;
  // El hacker con orden: se acerca hasta tener el blanco a su alcance, teclea un par de segundos y lo apaga. Cuesta información.
  function tickHackear(m, u) {
    const o = m.porId.get(u.hackObj), d = UNID[u.tipo], J = m.jug[u.j];
    const fin = () => { u.orden = 'nada'; u.hackObj = 0; u.canal = 0; u.ruta = null; };
    if (!hackeable(u, o)) { fin(); return; }
    if (dist(u.x, u.y, o) > d.alcanceHack) {
      u.canal = 0;
      if (u.fallo) { u.fallo = false; fin(); return; }
      if (!u.pend && (!u.ruta || (!o.edif && (m.t + u.id) % 20 === 0))) pedirRuta(m, u, posX(o), posY(o), d.alcanceHack - 1.5);
      avanzar(m, u); return;
    }
    u.ruta = null; u.pend = null; u.v = 0; u.ang = Math.atan2(posY(o) - u.y, posX(o) - u.x);
    if (u.recarga > 0) return; // aún se recupera del anterior
    if (J.info < ECON.hackInfo && !J.dios) { m.efectos.push({ tipo: 'sinInfo', x1: u.x, y1: u.y, j: u.j, t: m.t }); fin(); return; }
    u.canal = (u.canal || 0) + 1;
    if (u.canal < ECON.hackCanal) return;
    if (!J.dios) J.info -= ECON.hackInfo;
    o.hack = m.t + (o.edif ? ECON.hackEdif : ECON.hackVeh); if (!o.edif) { o.v = 0; o.obj = 0; }
    u.recarga = ECON.hackRecarga;
    m.efectos.push({ tipo: 'hack', x1: u.x, y1: u.y, x2: posX(o), y2: posY(o), j: u.j, de: o.j, clase: o.tipo, t: m.t });
    fin();
  }
  // Tramo destruido o demolido: sus celdas vuelven a ser lo que eran (el bosque se cierra otra vez a los vehículos).
  function quitarTramo(m, e) {
    const terr = m.mapa.terreno; let cerrado = false;
    for (let k = 0; k < e.celdas.length; k++) {
      const c = e.celdas[k];
      if (m.tramoEn[c] !== e.id) continue;
      m.tramoEn[c] = 0; m.carrilX[c] = 0; m.carrilY[c] = 0; terr[c] = e.antes[k]; if (!e.ponton) { viaDe(m)[e.j][c] = 0; m.viaN[e.j]--; } // (el pontón no es vía: no acelera a nadie)
      if (e.antes[k] === T.BOSQUE) { m.pasoV[c] = 0; cerrado = true; }
      else if (e.antes[k] === T.AGUA) { m.paso[c] = 0; m.pasoV[c] = 0; cerrado = true; } // el puente caído vuelve a ser agua
    }
    m.terrenoV++;
    if (!cerrado) return;
    for (const u of m.ents) { // quien estaba encima sale al suelo firme más cercano
      if (u.edif || u.vida <= 0 || UNID[u.tipo].aire) continue;
      const c = Math.floor(u.y) * m.N + Math.floor(u.x), veh = UNID[u.tipo].cat === 'veh';
      if (u.orden === 'trazar' ? pisaTraza(m, c) : (veh ? m.pasoV : m.paso)[c]) continue;
      const l = W.cercaLibre(m, u.x, u.y, veh); u.x = (l % m.N) + 0.5; u.y = ((l / m.N) | 0) + 0.5; u.ruta = null; u.v = 0;
      if (u.meta) pedirRuta(m, u, u.meta.x, u.meta.y, u.meta.radio);
    }
  }
  // ---------- efectos de las mejoras ----------
  const bonoVida = (J, tipo) => (UNID[tipo].cat === 'inf' ? (J.mejoras.chalecos ? 1.3 : 1) : UNID[tipo].cat === 'veh' && J.mejoras.reactivo ? 1.25 : 1);
  function vidaDe(J, tipo) { return Math.round(UNID[tipo].vida * bonoVida(J, tipo)); }
  function alcance(m, e, arma) {
    const J = m.jug[e.j];
    if (e.edif) return arma.alcance + (J.mejoras.telemetro ? 1.5 : 0);
    return arma.alcance + (J.mejoras.canonLargo && UNID[e.tipo].cat === 'veh' ? 1 : 0);
  }
  W.alcance = alcance;

  function crearUnidad(m, j, tipo, celda) {
    const d = UNID[tipo], N = m.N, x = (celda % N) + 0.5, y = ((celda / N) | 0) + 0.5;
    const u = {
      id: m.sigId++, j, tipo, edif: false, x, y, px: x, py: y, vida: vidaDe(m.jug[j], tipo), vidaMax: vidaDe(m.jug[j], tipo),
      orden: 'nada', ruta: null, ri: 0, dest: null, meta: null, pend: null, fallo: false, obj: 0, recarga: 0, fijo: false,
      ang: Math.atan2(N / 2 - y, N / 2 - x), angT: Math.atan2(N / 2 - y, N / 2 - x), mira: 0, apunto: false, v: 0, tReplan: -99, tRep: -999, tope: 0, angFin: null,
      guardia: false, mision: 0, acude: 0, salto: 0, origen: null, previo: null, // colmena: modo fijo, misión, foco al que acude // rumbo, velocidad actual
      carga: 0, est: tipo === 'cosechadora' ? 'buscar' : '', celda: -1, ref: 0, espera: 0, pref: null,
      quiere: 1, cargaTipo: 1, // cosechadora: qué busca y qué lleva (1 minerales, 2 raros)
      fuel: d.fuel || 0, repostando: false, casa: 0, enTierra: false, slot: 0, // aviación: su aeródromo y si está posado en él
      auto: !!d.tiende, cola: [], patrulla: null, explora: false, // órdenes encadenadas, ruta de patrulla, exploración automática
      retira: m.jug[j].retiro, retirando: false, volver: null, tRet: 0, huye: 0, // retirada automática a reparar; cosechadora que huye
      bajas: 0, rango: 0, // veteranía
      trazas: [], // excavadora: tramos de camino pendientes
      pasajeros: [], sube: 0, dentro: false, // transporte: quién va dentro; infantería: a qué transporte va a subir
    };
    m.ents.push(u); m.porId.set(u.id, u);
    m.jug[j].producidas++;
    return u;
  }
  W.crearEdificio = crearEdificio; W.crearUnidad = crearUnidad;

  W.cercaLibre = function (m, x, y, veh) { // veh: celda libre para un vehículo (no vale el bosque)
    const paso = veh ? m.pasoV : m.paso;
    const N = m.N, cx = Math.max(0, Math.min(N - 1, Math.floor(x))), cy = Math.max(0, Math.min(N - 1, Math.floor(y)));
    for (let k = 0; k < ESPIRAL.length; k++) {
      const xx = cx + ESPIRAL[k][0], yy = cy + ESPIRAL[k][1];
      if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue;
      if (paso[yy * N + xx]) return yy * N + xx;
    }
    return cy * N + cx;
  };

  // Disponible = tiene los edificios requeridos y el nivel tecnológico.
  W.disponible = function (m, j, d) { return W.tieneReq(m, j, d.req) && ((d.nivel || 1) <= m.jug[j].nivel || m.jug[j].tr.requisitos); };
  const bonoE = (e) => 1 + ECON.mejoraBono * ((e.nivelE || 1) - 1); // lo que rinde de más un edificio mejorado
  W.costoMejora = (e) => Math.round(EDIF[e.tipo].costo * ECON.mejoraCosto * (e.nivelE || 1));
  W.tieneReq = function (m, j, req) {
    const c = m.jug[j].cuenta;
    if (m.jug[j].tr.requisitos) return true; // ADMIN: sin requisitos
    for (let k = 0; k < req.length; k++) if (!c[req[k]] && !(req[k] === 'estacion' && c.laboratorio)) return false; // el laboratorio vale como estación
    return true;
  };

  // ¿Puede desplegarse aquí un patio móvil? Necesita 3×3 de llano libre a su alrededor (lo que hay debajo de otras unidades no cuenta).
  W.destinoDespliegue = (u) => (UNID[u.tipo].despliega === true ? 'patio' : UNID[u.tipo].despliega); // en qué edificio se convierte
  W.puedeDesplegar = function (m, u) {
    const N = m.N, x = Math.floor(u.x) - 1, y = Math.floor(u.y) - 1, t = EDIF[W.destinoDespliegue(u)].tam;
    if (u.orden !== 'nada' || x < 0 || y < 0 || x + t > N || y + t > N) return false;
    for (let dy = 0; dy < t; dy++) for (let dx = 0; dx < t; dx++) {
      const i = (y + dy) * N + x + dx;
      if (m.mapa.terreno[i] !== T.LLANO || m.ocup[i] || m.mapa.mineral[i] || m.mapa.sitioEn[i]) return false;
    }
    return true;
  };
  // Por qué no se puede colocar ese edificio ahí ('' si se puede): la interfaz se lo dice al jugador.
  W.porQueNo = function (m, j, tipo, x, y) {
    const d = EDIF[tipo], N = m.N, t = d.tam;
    if (x < 0 || y < 0 || x + t > N || y + t > N) return 'fuera del mapa';
    let sitio = false;
    const c0 = y * N + x, mu = murosDe(m)[c0], enMuro = t === 1 && m.muroJ[c0] === j + 1 && (d.sobreMuro ? mu === 3 : d.enMuro ? mu === 2 || mu === 3 : false); // sobre un muro propio
    if (d.sobreMuro && !enMuro) return 'va sobre un muro propio';
    for (let dy = 0; dy < t; dy++) for (let dx = 0; dx < t; dx++) {
      const i = (y + dy) * N + x + dx;
      if (m.mapa.terreno[i] !== T.LLANO || m.ocup[i] || m.mapa.mineral[i] || (m.muro[i] && !enMuro)) return m.ocup[i] ? 'ese sitio está ocupado' : m.mapa.mineral[i] ? 'hay mineral debajo' : m.muro[i] ? 'hay un muro' : 'hace falta llano despejado';
      if (m.mapa.sitioEn[i]) { if (!d.sobre || m.mapa.sitioTipo.get(i) !== d.sobre) return 'ese sitio es para otro edificio'; sitio = true; }
    }
    if (d.sobre && !sitio) return d.sobre === 'petroleo' ? 'va sobre un yacimiento de petróleo' : 'va sobre un campo de conocimiento'; // debe cubrir su yacimiento o su campo
    if (d.juntoA === 'agua') { // debe tener agua a dos celdas o menos
      let agua = false;
      for (let yy = Math.max(0, y - 2); yy < Math.min(N, y + t + 2) && !agua; yy++) for (let xx = Math.max(0, x - 2); xx < Math.min(N, x + t + 2); xx++) if (m.mapa.terreno[yy * N + xx] === T.AGUA) { agua = true; break; }
      if (!agua) return 'necesita agua a dos celdas o menos';
    }
    if (d.libre && !m.niebla[j][y * N + x]) return 'terreno sin explorar'; // solo en terreno explorado
    // Territorio: se construye dentro de la cobertura de la red propia (cerca de un patio, de un depósito conectado, de los
    // edificios de la base o junto a un camino conectado). Los edificios de extracción y el depósito van donde haga falta.
    let junto = !!d.libre || enMuro || m.jug[j].tr.libre || (m.logistica !== false && !!W.cobertura(m, j)[(y + (t >> 1)) * N + x + (t >> 1)]); // ADMIN: se construye en cualquier parte
    const s = ECON.separacionColocar;
    for (let k = 0; k < m.ents.length; k++) {
      const e = m.ents[k];
      if (e.edif) { // partida clásica (sin red): basta con estar junto a un edificio propio
        if (m.logistica !== false || e.infra || e.j !== j || junto) continue;
        const gx = Math.max(e.x - (x + t), x - (e.x + e.tam), 0), gy = Math.max(e.y - (y + t), y - (e.y + e.tam), 0);
        if (Math.max(gx, gy) <= s) junto = true;
      } else if (e.x > x - 0.3 && e.x < x + t + 0.3 && e.y > y - 0.3 && e.y < y + t + 0.3) return 'hay una unidad encima';
    }
    return junto ? '' : m.logistica !== false ? 'aquí no llega tu red: se construye dentro de la zona sombreada' : 'demasiado lejos de tus edificios';
  };
  W.puedeColocar = (m, j, tipo, x, y) => !W.porQueNo(m, j, tipo, x, y);

  // ---------- la red ----------
  // Patios, depósitos, edificios cercanos entre sí y caminos propios forman redes. La red que tiene un patio da cobertura:
  // alrededor de sus nodos (patio y depósito), de sus edificios y a lo largo de sus caminos. Dentro de la cobertura hay
  // suministro para las unidades y se puede construir; la energía se reparte dentro de cada red, no en todo el mapa.
  // Se recalcula solo cuando algo cambia (m.redSucia) y, por si acaso, cada cinco segundos.
  function calcularRed(m) {
    const N = m.N, NN = N * N;
    if (!m.cob) { m.cob = [new Uint8Array(NN), new Uint8Array(NN)]; m.redCel = new Int32Array(NN); }
    m.cob[0].fill(0); m.cob[1].fill(0); m.redSucia = false; m.redT = m.t; m.redV = (m.redV || 0) + 1;
    const its = []; for (const e of m.ents) if (e.edif && e.vida > 0) its.push(e);
    const clasica = m.logistica === false, primero = [-1, -1]; // partida clásica: todo lo de un jugador es una sola red, como antes
    const pad = its.map((e, i) => i), raiz = (i) => { while (pad[i] !== i) { pad[i] = pad[pad[i]]; i = pad[i]; } return i; }, une = (a, b) => { a = raiz(a); b = raiz(b); if (a !== b) pad[Math.max(a, b)] = Math.min(a, b); };
    const cel = m.redCel, puestas = [];
    const idx = new Map(); for (let i = 0; i < its.length; i++) idx.set(its[i].id, i);
    for (let i = 0; i < its.length; i++) { // líneas de servicio: cada tramo se une con lo que tiene a cada extremo (otro tramo o un edificio)
      const e = its[i]; if (!e.linea) continue;
      for (const id of [e.de, e.a]) { const k = idx.get(id); if (k !== undefined && its[k].j === e.j) une(i, k); }
    }
    for (let i = 0; i < its.length; i++) { // edificios cercanos entre sí
      const e = its[i]; if (clasica) { if (primero[e.j] < 0) primero[e.j] = i; else une(i, primero[e.j]); continue; }
      if (e.infra) continue;
      for (let y = Math.max(0, e.y - ECON.enlace); y < Math.min(N, e.y + e.tam + ECON.enlace); y++) for (let x = Math.max(0, e.x - ECON.enlace); x < Math.min(N, e.x + e.tam + ECON.enlace); x++) { const k = cel[y * N + x] - 1; if (k >= 0 && its[k].j === e.j) une(i, k); }
      for (let k = i + 1; k < its.length; k++) {
        const o = its[k]; if (o.infra || o.j !== e.j) continue;
        if (Math.max(o.x - (e.x + e.tam), e.x - (o.x + o.tam), 0) <= ECON.enlace && Math.max(o.y - (e.y + e.tam), e.y - (o.y + o.tam), 0) <= ECON.enlace) une(i, k);
      }
    }
    for (let i = 0; i < its.length; i++) { // puente aéreo: el puesto de avanzada al que le llega carga está unido a un puesto logístico
      const e = its[i]; if (e.tipo !== 'avanzada' || !(e.abast > m.t)) continue;
      for (let k = 0; k < its.length; k++) if (its[k].tipo === 'logistica' && its[k].j === e.j) { une(i, k); break; }
    }
    const red = new Map(); // por red: si tiene patio, cuánta energía da y cuánta pide
    for (let i = 0; i < its.length; i++) {
      const e = its[i], r = raiz(i); let g = red.get(r); if (!g) { g = { patio: false, prod: 0, uso: 0 }; red.set(r, g); }
      if (e.infra) continue;
      const en = EDIF[e.tipo].energia;
      if (e.tipo === 'patio') g.patio = true;
      if (en > 0) g.prod += en * (m.jug[e.j].mejoras.turbinas ? 1.5 : 1) * bonoE(e); else g.uso -= en;
    }
    const sella = (f, cx, cy, r) => { const R = Math.ceil(r), r2 = r * r; for (let dy = -R; dy <= R; dy++) { const y = cy + dy; if (y < 0 || y >= N) continue; for (let dx = -R; dx <= R; dx++) { const x = cx + dx; if (x >= 0 && x < N && dx * dx + dy * dy <= r2) f[y * N + x] = 1; } } };
    for (let i = 0; i < its.length; i++) {
      const e = its[i], g = red.get(raiz(i)), f = m.cob[e.j];
      e.conRed = g.patio; e.red = its[raiz(i)].id;
      if (e.infra) continue; // ni los caminos ni las líneas dan cobertura: la dan los nodos y los edificios conectados
      e.deficit = g.uso > g.prod && !m.jug[e.j].dios; e.sinLuz = e.deficit && EDIF[e.tipo].energia < 0; // su red no da para todos: a media marcha
      if (g.patio) sella(f, Math.floor(e.cx), Math.floor(e.cy), (e.tipo === 'patio' || e.tipo === 'deposito' ? ECON.cobNodo : e.tipo === 'avanzada' ? ECON.cobAvanzada : ECON.cobEdif) + e.tam / 2);
    }
  }
  W.calcularRed = calcularRed;
  W.cobertura = (m, j) => { if (!m.cob || m.redSucia) calcularRed(m); return m.cob[j]; };
  const sinSuministro = (u) => u.sinSum >= ECON.sinSum; // lleva demasiado fuera de la cobertura de su red

  // Distancia de un punto a una entidad (al borde, si es edificio).
  function dist(x, y, e) {
    if (!e.edif) return Math.hypot(e.x - x, e.y - y);
    const dx = Math.max(e.x - x, 0, x - (e.x + e.tam)), dy = Math.max(e.y - y, 0, y - (e.y + e.tam));
    return Math.hypot(dx, dy);
  }
  const posX = (e) => (e.edif ? e.cx : e.x), posY = (e) => (e.edif ? e.cy : e.y);
  W.dist = dist;

  // ---------- rejilla espacial ----------
  // Una vez por tick, las unidades se reparten en casillas de 8×8 celdas (y los edificios que no son tendido, en una lista aparte):
  // buscar enemigo, separar y aplastar miran solo las casillas vecinas en vez de comparar cada ficha con todas las demás.
  const GC = 8;
  function rejilla(m) {
    const C = Math.ceil(m.N / GC); let g = m.gr;
    if (!g || g.C !== C) g = m.gr = { C, ini: new Int32Array(C * C + 1), cur: new Int32Array(C * C), us: [], edifs: [], t: -1 };
    const ini = g.ini, cur = g.cur, us = g.us, ed = g.edifs, ents = m.ents; ini.fill(0); ed.length = 0; let n = 0;
    for (let k = 0; k < ents.length; k++) {
      const e = ents[k];
      if (e.edif) { if (!e.infra) ed.push(e); continue; }
      const cx = Math.min(C - 1, Math.max(0, (e.x / GC) | 0)), cy = Math.min(C - 1, Math.max(0, (e.y / GC) | 0));
      e.gc = cy * C + cx; ini[e.gc + 1]++; n++;
    }
    for (let c = 0; c < C * C; c++) { ini[c + 1] += ini[c]; cur[c] = ini[c]; }
    us.length = n;
    for (let k = 0; k < ents.length; k++) { const e = ents[k]; if (!e.edif) { e.gi = cur[e.gc]++; us[e.gi] = e; } }
    g.t = m.t;
  }

  function contar(m) {
    for (let j = 0; j < 2; j++) { const J = m.jug[j]; J.prod = 0; J.uso = 0; J.aguaProd = 0; J.aguaUso = 0; J.cuenta = {}; }
    for (let k = 0; k < m.ents.length; k++) {
      const e = m.ents[k], J = m.jug[e.j];
      J.cuenta[e.tipo] = (J.cuenta[e.tipo] || 0) + 1;
      if (e.edif) {
        const d = EDIF[e.tipo], en = d.energia;
        if (en > 0) J.prod += en * (J.mejoras.turbinas ? 1.5 : 1) * bonoE(e); else J.uso -= en;
        J.aguaProd += (d.agua || 0) * (e.tipo === 'bomba' && J.mejoras.depuracion ? 1.5 : 1) * (e.tipo === 'bomba' ? bonoE(e) : 1);
      }
      else { J.aguaUso += UNID[e.tipo].agua || 0; for (const p of e.pasajeros) { J.cuenta[p.tipo] = (J.cuenta[p.tipo] || 0) + 1; J.aguaUso += UNID[p.tipo].agua || 0; } } // los que van dentro de un transporte también cuentan
    }
    for (let j = 0; j < 2; j++) {
      const J = m.jug[j];
      if ((J.cuenta.patio || 0) > J.patiosMax) J.patiosMax = J.cuenta.patio;
      if (!J.dios) continue;
      J.minerales = J.petroleo = J.raros = J.info = 999999;
      if (J.prod < J.uso) J.prod = J.uso;
      J.aguaProd = Math.max(J.aguaProd, J.aguaUso + 50);
    }
  }

  // ---------- pagos ----------
  W.puedePagar = function (J, d) { return J.minerales >= (d.costo || 0) && J.petroleo >= (d.pet || 0) && J.raros >= (d.raros || 0) && J.info >= (d.info || 0); };
  function cobrar(J, d) { J.minerales -= d.costo || 0; J.petroleo -= d.pet || 0; J.raros -= d.raros || 0; J.info -= d.info || 0; }
  function devolver(J, d) { J.minerales += d.costo || 0; J.petroleo += d.pet || 0; J.raros += d.raros || 0; J.info += d.info || 0; }

  // ---------- comandos ----------
  // Con m.registro (una lista), cada orden queda apuntada con su tick: reproducidas en un mundo igual, dan la misma partida.
  // Con m.soloRep (viendo una repetición) solo entran las órdenes de la repetición.
  W.orden = function (m, cmd, deRep) { if (m.soloRep && !deRep) return; if (m.registro) m.registro.push(m.t, cmd); m.cola.push(cmd); };

  // Por dónde puede pasar cada unidad: los vehículos no entran al bosque, salvo la excavadora mientras traza un camino.
  const pasoDe = (m, u) => (UNID[u.tipo].cat === 'veh' && u.orden !== 'trazar' ? m.pasoV : m.paso);
  // La excavadora, mientras traza, también puede meterse al agua: va tendiendo un puente.
  const pisaTraza = (m, c) => m.paso[c] || (m.mapa.terreno[c] === T.AGUA && !m.ocup[c] ? 1 : 0);
  function tablaTraza(m) {
    const NN = m.N * m.N; if (!m.pasoT) m.pasoT = new Uint8Array(NN);
    for (let i = 0; i < NN; i++) m.pasoT[i] = pisaTraza(m, i);
    return m.pasoT;
  }
  function pedirRuta(m, u, x, y, radio) {
    if (UNID[u.tipo].aire) { // un avión no busca camino: va en línea recta
      const casa = u.casa ? m.porId.get(u.casa) : null, rv = UNID[u.tipo].radioVuelo;
      if (casa) { const ax = x - casa.cx, ay = y - casa.cy, ad = Math.hypot(ax, ay); if (ad > rv) { x = casa.cx + (ax / ad) * rv; y = casa.cy + (ay / ad) * rv; } } // no se aleja más que su radio de vuelo
      const N = m.N, cx = Math.max(0.5, Math.min(N - 0.5, x)), cy = Math.max(0.5, Math.min(N - 0.5, y));
      u.ruta = [Math.floor(cy) * N + Math.floor(cx)]; u.ri = 0; u.fin = { x: cx, y: cy }; u.pend = null; u.meta = { x, y, radio };
      return;
    }
    if (radio === 0 && x >= 0 && y >= 0 && x < m.N && y < m.N && pasoDe(m, u) === m.pasoV && !m.pasoV[Math.floor(y) * m.N + Math.floor(x)] && m.paso[Math.floor(y) * m.N + Math.floor(x)]) {
      const c = W.cercaLibre(m, x, y, true); x = (c % m.N) + 0.5; y = ((c / m.N) | 0) + 0.5; // un vehículo no entra al bosque: se queda en el borde
    }
    if (!u.pend) m.colaRutas.push(u.id);
    u.pend = { x, y, radio }; u.meta = u.pend;
  }

  function propias(m, cmd) {
    const out = [];
    for (let k = 0; k < cmd.ids.length; k++) { const u = m.porId.get(cmd.ids[k]); if (u && !u.edif && u.j === cmd.j) { u.retirando = false; u.volver = null; u.noRetira = true; out.push(u); } } // una orden directa anula la retirada (hasta que se repare)
    return out;
  }
  // En un grupo, cada unidad tarda unas décimas distintas en reaccionar a la orden: no arrancan todas en el mismo instante.
  function reaccion(m, us) { if (us.length > 1) for (const u of us) u.espera = m.t + (((u.id * 2654435761) >>> 0) % 7); return us; }
  // Puestos de una formación, en coordenadas locales [avance, lateral] respecto del rumbo del grupo.
  function puestos(forma, n) {
    const s = 0.8, out = []; // separación entre puestos, en celdas
    for (let i = 0; i < n; i++) {
      if (forma === 'linea') { const por = Math.min(n, 12), fila = (i / por) | 0, enFila = Math.min(por, n - fila * por); out.push([-fila * s, ((i % por) - (enFila - 1) / 2) * s]); }
      else if (forma === 'columna') out.push([-(i >> 1) * s, n > 1 ? (i % 2 ? 0.4 : -0.4) : 0]);
      else if (forma === 'cuna') { const r = Math.ceil(i / 2); out.push([-r * s * 0.9, (i % 2 ? 1 : -1) * r * s * 0.8]); }
      else { const lado = Math.ceil(Math.sqrt(n)), filas = Math.ceil(n / lado); out.push([-(((i / lado) | 0) - (filas - 1) / 2) * s, ((i % lado) - (lado - 1) / 2) * s]); } // cuadro
    }
    return out;
  }
  // Reparte destinos. Sin formación (o 'grupo'): racimo alrededor del punto. Con formación: cada unidad a su
  // puesto, orientada según el rumbo del grupo, y todas al paso de la más lenta para llegar juntas.
  function destinos(m, us, x, y, fn, forma, rumboPedido) {
    const aire = us.length > 0 && us.every((u) => UNID[u.tipo].aire); // un grupo solo de aviones puede quedar sobre agua o roca
    if (forma && forma !== 'grupo' && us.length > 1) {
      let sx = 0, sy = 0, tope = Infinity;
      for (const u of us) { sx += u.x; sy += u.y; tope = Math.min(tope, UNID[u.tipo].vel); }
      const rumbo = rumboPedido === undefined ? Math.atan2(y - sy / us.length, x - sx / us.length) : rumboPedido, c = Math.cos(rumbo), s = Math.sin(rumbo);
      const orden = us.slice().sort((a, b) => (UNID[a.tipo].cat === 'veh' ? 0 : 1) - (UNID[b.tipo].cat === 'veh' ? 0 : 1) || a.id - b.id); // vehículos delante
      const ps = puestos(forma, orden.length);
      // Formación en marcha: el grupo se forma primero donde está (si está junto y el viaje es largo) y luego avanza
      // en bloque: cada puesto se traslada en paralelo, y tickMarchas frena a los que se adelantan.
      const mx = sx / us.length, my = sy / us.length, viaje = Math.hypot(x - mx, y - my), rm = Math.atan2(y - my, x - mx), cm = Math.cos(rm), sm = Math.sin(rm);
      let disperso = 0; for (const u of us) disperso = Math.max(disperso, Math.hypot(u.x - mx, u.y - my));
      const marcha = aire || orden.some((u) => UNID[u.tipo].aire) ? 0 : m.sigMarcha++, formar = marcha && viaje >= 6 && disperso <= 7;
      if (marcha) { if (!m.marchas) m.marchas = {}; m.marchas[marcha] = orden.map((u) => u.id); }
      for (let i = 0; i < orden.length; i++) {
        const px = x + ps[i][0] * c - ps[i][1] * s, py = y + ps[i][0] * s + ps[i][1] * c, cel = W.cercaLibre(m, px, py);
        const libre = px >= 0 && py >= 0 && px < m.N && py < m.N && (aire || m.paso[Math.floor(py) * m.N + Math.floor(px)]);
        const qx = mx + ps[i][0] * cm - ps[i][1] * sm, qy = my + ps[i][0] * sm + ps[i][1] * cm; // su puesto al formar, alrededor de donde está el grupo
        const previo = formar && qx >= 0 && qy >= 0 && qx < m.N && qy < m.N && pasoDe(m, orden[i])[Math.floor(qy) * m.N + Math.floor(qx)] ? { x: qx, y: qy } : null;
        fn(orden[i], libre ? px : (cel % m.N) + 0.5, libre ? py : ((cel / m.N) | 0) + 0.5, { marcha, tope, angFin: rumbo, previo });
      }
      return;
    }
    const N = m.N, cx = Math.floor(x) + 0.5, cy = Math.floor(y) + 0.5, paso = aire ? 1 : 0.6; // racimo apretado: las unidades son pequeñas
    let k = 0;
    for (let i = 0; i < us.length; i++) {
      let px = -1, py = -1;
      while (k < ESPIRAL.length) {
        const xx = cx + ESPIRAL[k][0] * paso, yy = cy + ESPIRAL[k][1] * paso; k++;
        if (xx >= 0 && yy >= 0 && xx < N && yy < N && (aire || m.paso[Math.floor(yy) * N + Math.floor(xx)])) { px = xx; py = yy; break; }
      }
      if (px < 0) { const c = W.cercaLibre(m, x, y); px = (c % N) + 0.5; py = ((c / N) | 0) + 0.5; }
      fn(us[i], px, py);
      if (rumboPedido !== undefined) us[i].angFin = rumboPedido; // al llegar queda encarada hacia donde se pidió
    }
  }

  // ---------- órdenes de unidad: directa, encadenada, patrulla y exploración ----------
  function limpiar(u) { u.cola.length = 0; u.patrulla = null; u.explora = false; u.acude = 0; }
  function asignar(m, u, o) {
    if (o.t === 'atacar') {
      const ob = m.porId.get(o.obj);
      if (!ob || ob.vida <= 0 || !puede(ARMAS[UNID[u.tipo].arma], ob)) return false;
      u.orden = 'atacar'; u.obj = ob.id; u.ruta = null; u.pend = null; u.guardia = false;
      return true;
    }
    u.orden = o.t; u.obj = 0; u.dest = { x: o.x, y: o.y }; u.ruta = null; u.tope = o.tope || 0; u.angFin = o.angFin === undefined ? null : o.angFin; u.guardia = false; u.marcha = o.marcha || 0; u.fm = 1; u.suelto = false;
    pedirRuta(m, u, o.x, o.y, 0);
    return true;
  }
  function encargar(m, u, o, enc) {
    if (enc && !u.patrulla && (u.orden !== 'nada' || u.cola.length)) { if (u.cola.length < 16) u.cola.push(o); return; }
    limpiar(u); asignar(m, u, o);
  }
  // Una orden de movimiento en formación: si hay que formar antes, primero va a su puesto junto al grupo y luego marcha.
  function enFormacion(m, u, t, x, y, ex, enc) {
    const o = { t, x, y };
    if (ex) { o.marcha = ex.marcha; o.tope = ex.tope; o.angFin = ex.angFin; }
    if (ex && ex.previo) { encargar(m, u, { t: 'mover', x: ex.previo.x, y: ex.previo.y, angFin: Math.atan2(y - ex.previo.y, x - ex.previo.x) }, enc); encargar(m, u, o, true); }
    else encargar(m, u, o, enc);
  }
  // Cada 4 ticks: en cada grupo en marcha, quien va por delante de la media afloja y quien se queda atrás corre a lo suyo,
  // de modo que avanzan juntos y la forma se conserva. Quien se para a combatir retiene a los demás cerca.
  function tickMarchas(m) {
    for (const gid in m.marchas) {
      const g = +gid, act = []; let suma = 0;
      for (const id of m.marchas[gid]) {
        const u = m.porId.get(id);
        if (!u || u.vida <= 0) continue;
        let d = -1;
        if (u.marcha === g && (u.orden === 'mover' || u.orden === 'amover') && u.dest) d = Math.hypot(u.dest.x - u.x, u.dest.y - u.y);
        else { const q = u.cola.find((o) => o.marcha === g); if (q) d = Math.hypot(q.x - u.x, q.y - u.y); } // aún formando: cuenta para la media, pero va a su aire
        if (d < 0) continue;
        act.push(u, d); suma += d;
      }
      if (act.length < 4) { for (let k = 0; k < act.length; k += 2) { act[k].fm = 1; act[k].suelto = false; } if (!act.length) delete m.marchas[gid]; continue; }
      const media = suma / (act.length / 2);
      for (let k = 0; k < act.length; k += 2) {
        const u = act[k], delta = media - act[k + 1]; // > 0: va adelantada
        if (u.marcha !== g) continue;
        u.fm = delta > 3 ? 0.2 : delta > 0.6 ? 1 - 0.8 * (delta - 0.6) / 2.4 : 1; u.suelto = delta < -0.6;
      }
    }
  }
  function celdaSinExplorar(m, u) {
    const N = m.N, f = m.niebla[u.j], al = m.mapa.alcanzable;
    let mejor = -1, md = Infinity;
    for (let y = 2; y < N; y += 4) for (let x = 2; x < N; x += 4) {
      const i = y * N + x;
      if (f[i] || !al[i] || !m.paso[i]) continue;
      const d = Math.hypot(x - u.x, y - u.y) + ((x * 7 + y * 13 + u.id * 31) % 17) * 1.5; // el sesgo reparte a varios exploradores
      if (d < md) { md = d; mejor = i; }
    }
    return mejor;
  }
  function siguienteOrden(m, u) {
    while (u.cola.length) if (asignar(m, u, u.cola.shift())) return;
    if (u.patrulla) {
      const p = u.patrulla;
      if (p.g && (p.esp = (p.esp || 0) + 1) < 200) { // patrulla en grupo: en cada punto espera (un rato) a los compañeros que aún vienen de camino
        for (const o of m.ents) if (o !== u && !o.edif && o.vida > 0 && o.patrulla && o.patrulla.g === p.g && o.patrulla.i === p.i && o.orden !== 'nada' && o.dest && Math.hypot(o.x - o.dest.x, o.y - o.dest.y) > 2.5) return;
      }
      p.esp = 0; p.i = (p.i + 1) % p.pts.length;
      if (UNID[u.tipo].aire && p.pts.length === 1) { // patrulla aérea sobre un punto: da vueltas a su alrededor
        p.a = (p.a === undefined ? u.id * 2.4 : p.a) + 0.8; // cada avión entra en la órbita por un punto distinto, para no ir encimados
        asignar(m, u, { t: 'amover', x: p.pts[0].x + Math.cos(p.a) * ECON.orbita, y: p.pts[0].y + Math.sin(p.a) * ECON.orbita });
      } else asignar(m, u, { t: 'amover', x: p.pts[p.i].x, y: p.pts[p.i].y, tope: p.tope || 0 });
    } else if (u.explora) {
      const c = celdaSinExplorar(m, u);
      if (c < 0) { u.explora = false; m.efectos.push({ tipo: 'explorado', x1: u.x, y1: u.y, j: u.j, t: m.t }); } else asignar(m, u, { t: 'mover', x: (c % m.N) + 0.5, y: ((c / m.N) | 0) + 0.5 });
    }
  }

  // Interruptores del panel ADMIN. Los de un solo uso (nivel3, mejoras) no se deshacen.
  function trampa(m, j, clave, valor) {
    const J = m.jug[j];
    if (clave === 'recursos') { if (!!valor !== J.dios) { J.dios = !!valor; if (J.dios) J.antesDios = [J.minerales, J.petroleo, J.raros, J.info]; else [J.minerales, J.petroleo, J.raros, J.info] = J.antesDios; } }
    else if (clave === 'vel') J.tr.vel = [1, 2, 4, 10, 20].includes(+valor) ? +valor : 1;
    else if (clave === 'nivel3') J.nivel = 3;
    else if (clave === 'mejoras') {
      for (const k in TEC) if (!TEC[k].sube) J.mejoras[k] = true;
      for (const e of m.ents) if (!e.edif && e.j === j) { const nueva = Math.round(vidaDe(J, e.tipo) * (1 + ECON.rangoVida * e.rango)); if (nueva !== e.vidaMax) { e.vida = e.vida * (nueva / e.vidaMax); e.vidaMax = nueva; } }
    } else if (clave in J.tr) J.tr[clave] = !!valor;
    J.admin = J.dios || J.tr.requisitos || J.tr.libre || J.tr.vel > 1 || J.tr.mapa || J.tr.invulnerable;
  }
  function aplicar(m, cmd) {
    const J = m.jug[cmd.j];
    if (!J || !J.vivo) return;
    if (cmd.ids && (cmd.t === 'mover' || cmd.t === 'amover' || cmd.t === 'atacar' || cmd.t === 'patrulla')) { // misma orden, misma misión
      const mision = m.sigMision++;
      for (const id of cmd.ids) { const u = m.porId.get(id); if (u && !u.edif && u.j === cmd.j) u.mision = mision; }
    }
    if (cmd.ids && cmd.t !== 'autoCivil' && cmd.t !== 'formar') for (const id of cmd.ids) { const u = m.porId.get(id); if (u && !u.edif && u.j === cmd.j && u.auto) u.auto = false; } // una orden a mano saca al ingeniero civil del automático
    switch (cmd.t) {
      case 'autoCivil': for (const u of propias(m, cmd)) if (UNID[u.tipo].tiende) u.auto = !!cmd.on; return;
      case 'dios': // modo GOD: recursos infinitos; al apagarlo vuelve el saldo anterior
        J.dios = !J.dios;
        if (J.dios) J.antesDios = [J.minerales, J.petroleo, J.raros, J.info]; else [J.minerales, J.petroleo, J.raros, J.info] = J.antesDios;
        return;
      case 'admin': // atajo: prende (o apaga) todo lo del panel ADMIN de una vez, con producción ×4
        J.admin = !J.admin;
        for (const [clave, valor] of [['recursos', J.admin], ['requisitos', J.admin], ['libre', J.admin], ['vel', J.admin ? 4 : 1], ['mapa', J.admin]]) trampa(m, cmd.j, clave, valor);
        if (J.admin) { trampa(m, cmd.j, 'nivel3', true); trampa(m, cmd.j, 'mejoras', true); }
        return;
      case 'trampa': // un interruptor del panel ADMIN
        trampa(m, cmd.j, cmd.clave, cmd.valor);
        return;
      case 'aerotransporte': { // la infantería elegida que esté junto a una pista propia vuela a otra (cmd.de → cmd.a), de ocho en ocho; cada vuelo se paga
        const de = m.porId.get(cmd.de), a = m.porId.get(cmd.a), N = m.N;
        const vale = (e) => e && e.edif && e.j === cmd.j && e.vida > 0 && EDIF[e.tipo].pista && !(e.hack > m.t) && (e.tipo !== 'avanzada' || e.abast > m.t);
        if (!vale(de) || !vale(a) || de === a) return;
        const us = propias(m, cmd).filter((u) => UNID[u.tipo].cat === 'inf' && dist(u.x, u.y, de) <= 6);
        for (let k = 0; k < us.length; k += UNID.heliTropa.plazas) {
          if (J.minerales < UNID.heliTropa.costo && !J.dios) { m.efectos.push({ tipo: 'sinLinea', x1: de.cx, y1: de.cy, j: cmd.j, t: m.t, vuelo: true }); break; }
          if (!J.dios) J.minerales -= UNID.heliTropa.costo;
          const q = crearUnidad(m, cmd.j, 'heliTropa', Math.floor(de.cy) * N + Math.floor(de.cx)); q.x = q.px = q.ox = de.cx; q.y = q.py = q.oy = de.cy; q.rol = 'tropa'; q.est = 'ida';
          const c = W.cercaLibre(m, a.cx, a.y + a.tam + 1.5); q.tx = (c % N) + 0.5; q.ty = ((c / N) | 0) + 0.5;
          for (const u of us.slice(k, k + UNID.heliTropa.plazas)) { limpiar(u); u.ruta = null; u.pend = null; u.v = 0; u.trin = 0; u.dentro = true; q.pasajeros.push(u); m.porId.delete(u.id); }
        }
        m.ents = m.ents.filter((e) => !e.dentro); contar(m);
        return;
      }
      case 'mejorarEdif': { // sube un nivel el rendimiento de ese edificio (central, bomba, extractor, estación, laboratorio)
        const e = m.porId.get(cmd.id);
        if (!e || !e.edif || e.j !== cmd.j || e.vida <= 0 || !EDIF[e.tipo].mejora || (e.nivelE || 1) >= ECON.mejoraMax) return;
        const precio = W.costoMejora(e); if (J.minerales < precio && !J.dios) return;
        if (!J.dios) J.minerales -= precio;
        e.nivelE = (e.nivelE || 1) + 1; m.redSucia = true;
        m.efectos.push({ tipo: 'mejoraEdif', x1: e.cx, y1: e.cy, j: e.j, clase: e.tipo, nivel: e.nivelE, t: m.t });
        return;
      }
      case 'zapar': { // el ingeniero militar: minar / desminar un punto, tender un pontón sobre el agua o volar un tramo de camino o puente (con enc, se suma a lo que lleva)
        const N = m.N, x = Math.floor(cmd.x), y = Math.floor(cmd.y); if (!(x >= 0 && y >= 0 && x < N && y < N)) return;
        const us = propias(m, cmd).filter((u) => UNID[u.tipo].zapador); if (!us.length) return;
        let q = null;
        if (cmd.que === 'minar') q = { t: 'minar', x: x + 0.5, y: y + 0.5 };
        else if (cmd.que === 'desminar') q = { t: 'desminar', x: cmd.x, y: cmd.y };
        else if (cmd.que === 'volar') { const tr = m.porId.get(m.tramoEn[y * N + x]); if (tr && tr.vida > 0 && tr.tipo === 'camino') q = { t: 'volar', id: tr.id, x: x + 0.5, y: y + 0.5 }; }
        else if (cmd.que === 'ponton') { const pl = planPonton(m, x, y, us[0]); if (pl) q = { t: 'ponton', filas: pl.filas, sx: pl.sx, sy: pl.sy, k: 0, tr: 0 }; else { m.efectos.push({ tipo: 'sinPonton', x1: cmd.x, y1: cmd.y, j: cmd.j, t: m.t }); return; } }
        if (!q) return;
        us.forEach((u, k) => {
          if (k > 0 && q.t !== 'minar' && q.t !== 'desminar') return; // un pontón o una voladura, un solo ingeniero
          const mio = k === 0 ? q : { t: q.t, x: q.x + (q.t === 'minar' ? k : 0), y: q.y };
          if (cmd.enc && u.orden === 'zapar' && u.zapa) { if (u.zapa.lista.length < 24) u.zapa.lista.push(mio); return; }
          limpiar(u); u.arregla = 0; u.obj = 0; u.ruta = null; u.pend = null; u.fallo = false; u.orden = 'zapar'; u.zapa = { lista: [mio], prog: 0 };
        });
        return;
      }
      case 'formar': // la formación con la que esas unidades llegarán a destino (cada una recuerda la suya)
        if (['grupo', 'linea', 'columna', 'cuna', 'cuadro'].includes(cmd.forma)) for (const u of propias(m, cmd)) u.forma = cmd.forma;
        return;
      case 'dronMision': // el operador manda sus drones a un punto lejano (sin x: los recoge)
        for (const u of propias(m, cmd)) {
          const al = UNID[u.tipo].misionDron; if (!al) continue;
          if (!(cmd.x >= 0 && cmd.y >= 0 && cmd.x < m.N && cmd.y < m.N)) { u.dronMis = null; continue; }
          if (Math.hypot(cmd.x - u.x, cmd.y - u.y) <= al) { u.dronMis = { x: cmd.x, y: cmd.y }; if (u.orden !== 'nada') { limpiar(u); u.orden = 'nada'; u.ruta = null; u.pend = null; } } // (se planta: el operador solo trabaja parado)
        }
        return;
      case 'dronAtk': // enciende o apaga los drones de ataque de esos portadores
        for (const u of propias(m, cmd)) if (UNID[u.tipo].drones) u.dronAtk = !!cmd.on;
        return;
      case 'dronObj': { // blanco preferente para los drones de ataque de esos portadores
        const o = m.porId.get(cmd.obj); if (!o || o.j === cmd.j) return;
        for (const u of propias(m, cmd)) if (UNID[u.tipo].drones && W.dronesDe(m, u).fpv) { u.dronObj = o.id; u.dronAtk = true; }
        return;
      }
      case 'murar': { // el ingeniero civil levanta un tramo recto de muro (tipo: clave de W.MUROS) de una celda a otra; con enc, lo añade a lo que lleva
        const u = propias(m, cmd).find((q) => UNID[q.tipo].tiende), d = W.MUROS[cmd.tipo], N = m.N;
        if (!u || !d || (d.nivel || 1) > J.nivel) return;
        let x = Math.floor(cmd.x0), y = Math.floor(cmd.y0); const x1 = Math.floor(cmd.x1), y1 = Math.floor(cmd.y1), celdas = [];
        if (!(x >= 0 && y >= 0 && x < N && y < N && x1 >= 0 && y1 >= 0 && x1 < N && y1 < N)) return;
        const dx = Math.abs(x1 - x), dy = Math.abs(y1 - y), sx = x < x1 ? 1 : -1, sy = y < y1 ? 1 : -1; let err = dx - dy;
        for (let k = 0; k < 200; k++) { // la línea, sin huecos en diagonal: tras un paso en diagonal se rellena la esquina
          celdas.push(y * N + x); if (x === x1 && y === y1) break;
          const e2 = 2 * err; let mx = false, my = false;
          if (e2 > -dy) { err -= dy; x += sx; mx = true; } if (e2 < dx) { err += dx; y += sy; my = true; }
          if (mx && my) celdas.push(y * N + x - sx);
        }
        if (cmd.enc && u.orden === 'murar' && u.obra && u.obra.ns) { for (const c of celdas) if (u.obra.celdas.length < 600) { u.obra.celdas.push(c); u.obra.ns.push(d.n); } return; } // se suma a lo que ya tiene encargado, sea del tipo que sea
        limpiar(u); u.obj = 0; u.ruta = null; u.pend = null; u.guardia = false; u.orden = 'murar'; u.obra = { celdas, ns: celdas.map(() => d.n), i: 0, t: 0 };
        return;
      }
      case 'quitarMuro': { // derriba una celda de muro propia y recupera la mitad
        const c = cmd.c, n = murosDe(m)[c]; if (!n || m.muroJ[c] !== cmd.j + 1 || m.ocup[c]) return;
        J.minerales += Math.floor(MURO_N[n].costo / 2); quitarMuro(m, c);
        return;
      }
      case 'atacarMuro': { // ordena disparar a esa celda de muro enemiga
        const b = W.blancoMuro(m, cmd.c); if (!b || b.j === cmd.j) return;
        for (const u of propias(m, cmd)) if (UNID[u.tipo].arma) encargar(m, u, { t: 'atacar', obj: b.id }, cmd.enc);
        return;
      }
      case 'misil': { // encarga un misil en esa misilera: se paga al encargarlo; entre guardados y encargados, diez como mucho
        const e = m.porId.get(cmd.id), d = MIS[cmd.tipo];
        if (!e || !d || e.j !== cmd.j || !EDIF[e.tipo].misiles || e.vida <= 0 || J.nivel < d.nivel || guardados(e) >= ECON.misilesMax || !W.puedePagar(J, d)) return;
        cobrar(J, d); if (!e.fabMis) e.fabMis = []; e.fabMis.push(cmd.tipo);
        return;
      }
      case 'cancelarMisil': { // quita el último encargado de ese tipo y devuelve su precio
        const e = m.porId.get(cmd.id); if (!e || e.j !== cmd.j || !e.fabMis) return;
        const k = e.fabMis.lastIndexOf(cmd.tipo); if (k < 0) return;
        e.fabMis.splice(k, 1); if (k === 0) e.progMis = 0; devolver(J, MIS[cmd.tipo]);
        return;
      }
      case 'lanzar': { // lanza un misil guardado a un punto explorado y dentro de su alcance
        const e = m.porId.get(cmd.id), d = MIS[cmd.tipo], N = m.N;
        if (!e || !d || e.j !== cmd.j || e.vida <= 0 || !e.silo || !(e.silo[cmd.tipo] > 0) || e.hack > m.t || e.sinLuz) return;
        if (!(cmd.x >= 0 && cmd.y >= 0 && cmd.x < N && cmd.y < N) || !m.niebla[cmd.j][Math.floor(cmd.y) * N + Math.floor(cmd.x)] || !W.alcanceMisil(m, e, cmd.tipo, cmd.x, cmd.y)) return;
        e.silo[cmd.tipo]--;
        m.misiles.push({ id: m.sigId++, tipo: cmd.tipo, j: cmd.j, x: e.cx, y: e.cy, px: e.cx, py: e.cy, ox: e.cx, oy: e.cy, tx: cmd.x, ty: cmd.y, vida: d.aguante, t0: m.t });
        m.efectos.push({ tipo: 'lanzamiento', x1: e.cx, y1: e.cy, x2: cmd.x, y2: cmd.y, j: cmd.j, clase: cmd.tipo, t: m.t });
        return;
      }
      case 'hackear': { // los hackers elegidos van por ese vehículo o edificio enemigo
        const o = m.porId.get(cmd.obj);
        for (const u of propias(m, cmd)) if (UNID[u.tipo].hackea && hackeable(u, o)) { limpiar(u); u.obj = 0; u.ruta = null; u.pend = null; u.guardia = false; u.orden = 'hackear'; u.hackObj = o.id; u.canal = 0; }
        return;
      }
      case 'ocupar': { // la infantería se mete en la trinchera de esa celda, hasta llenar sus puestos; va cada una a su puesto y se queda
        const q = m.trincheras.get(cmd.c); if (!q) return;
        if (!q.dentro) q.dentro = [];
        if (q.dentro.some((id) => { const o = id ? m.porId.get(id) : null; return o && o.vida > 0 && o.j !== cmd.j; })) return; // la tiene el otro bando: hay que echarlo antes
        for (const u of propias(m, cmd)) {
          if (UNID[u.tipo].cat !== 'inf' || u.trin === cmd.c + 1) continue;
          let k = q.dentro.findIndex((id) => !id); if (k < 0) { if (q.dentro.length >= PLAZAS) break; k = q.dentro.length; }
          q.dentro[k] = u.id; u.trin = cmd.c + 1;
          const p = puestoTrinchera(q, k); limpiar(u); asignar(m, u, { t: 'mover', x: p.x, y: p.y, angFin: q.ang });
        }
        return;
      }
      case 'salir': { // deja la trinchera: sale por detrás y el puesto queda libre
        for (const u of propias(m, cmd)) {
          const q = u.trin ? m.trincheras.get(u.trin - 1) : null; if (!q) continue;
          const k = q.dentro.indexOf(u.id); if (k >= 0) q.dentro[k] = 0; u.trin = 0;
          const c = W.cercaLibre(m, q.x - Math.cos(q.ang) * 1.4, q.y - Math.sin(q.ang) * 1.4);
          limpiar(u); asignar(m, u, { t: 'mover', x: (c % m.N) + 0.5, y: ((c / m.N) | 0) + 0.5 });
        }
        return;
      }
      case 'conectar': { // el ingeniero civil une edificios propios con líneas de servicio: cmd.edifs en orden; con enc, se añade a lo que ya tiene encargado
        const u = propias(m, cmd).find((q) => UNID[q.tipo].tiende), es = (cmd.edifs || []).map((id) => m.porId.get(id)).filter((e) => e && e.edif && !e.infra && e.j === cmd.j && e.vida > 0);
        if (!u || es.length < 2) return;
        const pares = []; for (let k = 0; k + 1 < es.length; k++) if (es[k] !== es[k + 1]) pares.push([es[k].id, es[k + 1].id]);
        if (cmd.enc && u.orden === 'conectar' && u.obra) { for (const p of pares) if (u.obra.pares.length < 12) u.obra.pares.push(p); return; }
        limpiar(u); u.obj = 0; u.ruta = null; u.pend = null; u.guardia = false; u.orden = 'conectar'; u.obra = { pares, prog: 0, hecho: 0, ult: 0 };
        return;
      }
      case 'trazar': { // la excavadora va hasta el punto dejando camino (con enc, se añade otro tramo)
        for (const u of propias(m, cmd)) {
          if (!UNID[u.tipo].traza) continue;
          if (cmd.enc && u.orden === 'trazar') { if (u.trazas.length < 12) u.trazas.push({ x: cmd.x, y: cmd.y }); continue; }
          limpiar(u); u.obj = 0; u.trazas = []; u.tramo = 0; u.tramoFin = null; u.orden = 'trazar'; u.dest = { x: cmd.x, y: cmd.y }; u.ruta = null; u.guardia = false;
          pedirRuta(m, u, cmd.x, cmd.y, 0);
        }
        return;
      }
      case 'construir': {
        const d = EDIF[cmd.tipo];
        if (!d || cmd.tipo === 'patio' || d.oculto || !W.disponible(m, cmd.j, d) || !W.puedePagar(J, d)) return;
        // La obra va a un patio: de los indicados (cmd.ids) o de todos, el que menos tenga entre manos.
        let patio = null, carga = Infinity;
        for (const e of m.ents) {
          if (!e.edif || e.j !== cmd.j || e.tipo !== 'patio' || e.vida <= 0 || (cmd.ids && !cmd.ids.includes(e.id))) continue;
          let n = 0, pend = 0; for (const o of J.obras) if (o.patio === e.id) { n++; if (!o.listo) pend++; }
          if (n < ECON.obrasMax && pend < carga) { carga = pend; patio = e; }
        }
        if (!patio) return;
        cobrar(J, d); J.obras.push({ tipo: cmd.tipo, prog: 0, listo: false, patio: patio.id });
        return;
      }
      case 'cancelarEdif': { // cancela la obra más reciente de ese tipo (primero las que siguen en curso) y devuelve su costo
        let i = -1;
        for (let k = J.obras.length - 1; k >= 0; k--) if (J.obras[k].tipo === cmd.tipo && (!cmd.ids || cmd.ids.includes(J.obras[k].patio)) && (i < 0 || (J.obras[i].listo && !J.obras[k].listo))) i = k;
        if (i < 0) return;
        devolver(J, EDIF[cmd.tipo]); J.obras.splice(i, 1);
        return;
      }
      case 'colocar': {
        const i = J.obras.findIndex((o) => o.listo && o.tipo === cmd.tipo);
        if (i < 0 || !W.puedeColocar(m, cmd.j, cmd.tipo, cmd.x, cmd.y)) return;
        const e = crearEdificio(m, cmd.j, cmd.tipo, cmd.x, cmd.y);
        J.obras.splice(i, 1);
        if (e.tipo === 'refineria') crearUnidad(m, cmd.j, 'cosechadora', W.cercaLibre(m, e.cx, e.y + e.tam + 0.5));
        contar(m);
        return;
      }
      case 'cargar': { // la infantería indicada va a subir al transporte cmd.en
        const t = m.porId.get(cmd.en);
        if (!t || t.edif || t.j !== cmd.j || !UNID[t.tipo].plazas) return;
        for (const u of propias(m, cmd)) if (UNID[u.tipo].cat === 'inf') { limpiar(u); u.orden = 'nada'; u.obj = 0; u.ruta = null; u.pend = null; u.guardia = false; u.sube = t.id; }
        return;
      }
      case 'descargar': {
        for (const t of propias(m, cmd)) if (t.pasajeros.length) { apear(m, t, t.pasajeros); t.pasajeros = []; }
        contar(m);
        return;
      }
      case 'desplegar': { // el patio móvil se convierte en un patio donde está; no hay vuelta atrás
        for (const u of propias(m, cmd)) {
          if (!UNID[u.tipo].despliega || u.vida <= 0 || !W.puedeDesplegar(m, u)) continue;
          const x = Math.floor(u.x) - 1, y = Math.floor(u.y) - 1;
          u.vida = 0; u.desplegado = true;
          const td = EDIF[W.destinoDespliegue(u)].tam;
          for (const e of m.ents) if (!e.edif && e !== u && e.vida > 0 && !UNID[e.tipo].aire && e.x > x - 0.4 && e.x < x + td + 0.4 && e.y > y - 0.4 && e.y < y + td + 0.4) { // quien esté en medio se aparta
            const c = W.cercaLibre(m, e.x < x + 1.5 ? x - 1 : x + 4, e.y); e.x = e.px = (c % m.N) + 0.5; e.y = e.py = ((c / m.N) | 0) + 0.5; e.ruta = null;
          }
          const p = crearEdificio(m, cmd.j, W.destinoDespliegue(u), x, y); p.nace = m.t; if (EDIF[p.tipo].hospital) p.abast = m.t + 600; // el puesto de avanzada llega con suministros para medio minuto
          m.efectos.push({ tipo: 'despliega', x2: p.cx, y2: p.cy, j: cmd.j, t: m.t });
        }
        contar(m);
        return;
      }
      case 'entrenar': {
        const d = UNID[cmd.tipo];
        if (!d || !W.disponible(m, cmd.j, d) || !W.puedePagar(J, d)) return;
        if (d.aire) { const c = W.cupoAire(m, cmd.j, W.hangarDe(d)); if (c.hay >= c.cupo) return; } // cada aeródromo aloja un número limitado de aviones
        // Va a la cola de un edificio: de los indicados (cmd.ids) o de todos los del tipo, el que la tenga más corta.
        let fab = null;
        for (const e of m.ents) {
          if (!e.edif || e.j !== cmd.j || e.tipo !== W.lugarDe(d) || e.vida <= 0 || e.cola.length >= ECON.colaMax) continue;
          if (cmd.ids && !cmd.ids.includes(e.id)) continue;
          if (!fab || e.cola.length < fab.cola.length) fab = e;
        }
        if (!fab) return;
        cobrar(J, d); fab.cola.push(cmd.tipo); fab.pago.push(true); J.colas[cmd.tipo].n++;
        return;
      }
      case 'cancelarUnidad': { // con id e i: ese puesto de la cola de ese edificio; si no, el último de ese tipo (en los edificios indicados o en todos)
        let fab = null, i = -1;
        if (cmd.id !== undefined && cmd.i !== undefined) { fab = m.porId.get(cmd.id); i = cmd.i; if (!fab || !fab.edif || fab.j !== cmd.j || !(i >= 0 && i < fab.cola.length)) return; }
        else {
          for (const e of m.ents) {
            if (!e.edif || e.j !== cmd.j || !e.cola.length || (cmd.ids && !cmd.ids.includes(e.id))) continue;
            const k = e.cola.lastIndexOf(cmd.tipo);
            if (k >= 0 && (!fab || e.cola.length > fab.cola.length)) { fab = e; i = k; }
          }
          if (!fab) return;
        }
        const tipo = fab.cola[i], pagado = fab.pago[i];
        fab.cola.splice(i, 1); fab.pago.splice(i, 1); if (i === 0) fab.prog = 0;
        J.colas[tipo].n--; if (pagado) devolver(J, UNID[tipo]);
        return;
      }
      case 'bucle': { // producción en bucle: cada unidad que sale se vuelve a encargar al final de la cola (se paga al empezarla)
        const eds = (cmd.ids || []).map((id) => m.porId.get(id)).filter((e) => e && e.edif && e.j === cmd.j && e.cola);
        if (!eds.length) return;
        const on = cmd.on !== undefined ? !!cmd.on : !eds[0].bucle;
        for (const e of eds) e.bucle = on;
        return;
      }
      case 'retiro': { // retirada automática: con ids, para esas unidades; sin ids, para todas y como valor por defecto
        const on = !!cmd.on;
        if (cmd.ids) { for (const u of propias(m, cmd)) { u.retira = on; u.noRetira = false; } return; }
        J.retiro = on;
        for (const e of m.ents) if (!e.edif && e.j === cmd.j) { e.retira = on; if (!on) { e.retirando = false; e.volver = null; } }
        return;
      }
      // cmd.enc (encadenar): la orden se añade a la cola de la unidad en vez de reemplazar lo que hace.
      case 'mover':
        destinos(m, reaccion(m, propias(m, cmd)), cmd.x, cmd.y, (u, x, y, ex) => { enFormacion(m, u, 'mover', x, y, ex, cmd.enc && u.tipo !== 'cosechadora'); if (UNID[u.tipo].suministro) u.sumi = { x, y, est: 'ida' }; }, cmd.forma, cmd.rumbo); // al suministro móvil, mover es marcarle su punto
        return;
      case 'amover':
        destinos(m, reaccion(m, propias(m, cmd).filter((u) => UNID[u.tipo].arma)), cmd.x, cmd.y, (u, x, y, ex) => enFormacion(m, u, 'amover', x, y, ex, cmd.enc), cmd.forma, cmd.rumbo);
        return;
      case 'investigar': { // una investigación a la vez por tipo de edificio
        const t = TEC[cmd.clave];
        if (!t || J.mejoras[cmd.clave] || !J.cuenta[t.lugar] || J.inv.some((i) => i.clave === cmd.clave || TEC[i.clave].lugar === t.lugar)) return;
        if (t.sube ? J.nivel !== t.nivel : J.nivel < t.nivel) return;
        if (!W.puedePagar(J, t)) return;
        cobrar(J, t); J.inv.push({ clave: cmd.clave, prog: 0 });
        return;
      }
      case 'cancelarInv': {
        const i = J.inv.findIndex((x) => x.clave === cmd.clave);
        if (i < 0) return;
        devolver(J, TEC[cmd.clave]); J.inv.splice(i, 1);
        return;
      }
      case 'intel': { // usos de inteligencia: se pagan con información y piden una estación en pie
        const it = INTEL[cmd.clave];
        if (!it || !(J.cuenta.estacion || J.cuenta.inteligencia) || (it.pide && !J.cuenta[it.pide]) || J.nivel < it.nivel || J.info < it.info) return;
        J.info -= it.info;
        if (it.zona) m.barridos.push({ j: cmd.j, x: cmd.x, y: cmd.y, r: it.radio, hasta: m.t + it.dura });
        else if (cmd.clave === 'interceptar') J.intercepta = m.t + it.dura;
        else { const f = m.niebla[cmd.j]; for (let i = 0; i < f.length; i++) if (!f[i]) f[i] = 1; m.nieblaV++; }
        return;
      }
      case 'guardia': // modo fijo: no se mueve ni para perseguir ni para acudir; dispara a lo que entre en su alcance
        for (const u of propias(m, cmd)) if (UNID[u.tipo].arma && !UNID[u.tipo].aire) { limpiar(u); u.orden = 'nada'; u.obj = 0; u.ruta = null; u.pend = null; u.guardia = true; }
        return;
      case 'trinchera': // la infantería quieta cava una trinchera en su sitio y se queda en ella
        for (const u of propias(m, cmd)) if (UNID[u.tipo].cat === 'inf' && u.orden === 'nada') {
          limpiar(u); u.obj = 0; u.ruta = null; u.pend = null; u.guardia = true;
          if (!m.trincheras.has(Math.floor(u.y) * m.N + Math.floor(u.x))) u.cava = ECON.cavar;
        }
        return;
      case 'colmena': J.colmena = !J.colmena; return;
      case 'vender': { // demoler un edificio propio: devuelve parte de su costo, según la vida que le quede
        const e = m.porId.get(cmd.id);
        if (!e || !e.edif || e.j !== cmd.j || e.tipo === 'patio' || e.vida <= 0) return;
        J.minerales += Math.floor(EDIF[e.tipo].costo * ECON.venta * (e.vida / e.vidaMax));
        e.vida = 0; e.vendido = true;
        return;
      }
      case 'atacar': {
        const o = m.porId.get(cmd.obj);
        if (!o || o.j === cmd.j) return;
        for (const u of propias(m, cmd)) if (UNID[u.tipo].arma) encargar(m, u, { t: 'atacar', obj: o.id }, cmd.enc);
        return;
      }
      case 'patrulla': // va y vuelve entre puntos, atacando lo que encuentre; con enc se añade otro punto
        if (cmd.pts && cmd.pts.length) { // ruta entera, compartida por el grupo: cada unidad lleva su puesto en cada punto y todas van al paso de la más lenta
          const us = propias(m, cmd).filter((u) => u.tipo !== 'cosechadora'), pts = cmd.pts.slice(0, 12), rutas = new Map();
          let tope = Infinity; for (const u of us) tope = Math.min(tope, UNID[u.tipo].vel);
          for (const q of pts) destinos(m, us, q.x, q.y, (u, x, y) => { let r = rutas.get(u.id); if (!r) rutas.set(u.id, r = []); r.push({ x, y }); });
          for (const u of us) {
            const r = rutas.get(u.id); if (!r || !r.length) continue;
            limpiar(u); u.orden = 'nada'; u.obj = 0; u.ruta = null; u.pend = null;
            if (UNID[u.tipo].aire) u.patrulla = pts.length === 1 ? { pts: [{ x: pts[0].x, y: pts[0].y }], i: 0 } : { pts: pts.map((q) => ({ x: q.x, y: q.y })), i: -1 };
            else u.patrulla = r.length === 1 ? { pts: [{ x: u.x, y: u.y }, r[0]], i: 0, tope, g: us.length > 1 ? u.mision : 0 } : { pts: r, i: -1, tope, g: us.length > 1 ? u.mision : 0 };
          }
          return;
        }
        destinos(m, propias(m, cmd).filter((u) => u.tipo !== 'cosechadora'), cmd.x, cmd.y, (u, x, y) => {
          if (cmd.enc && u.patrulla) { if (u.patrulla.pts.length < 12) u.patrulla.pts.push({ x, y }); return; }
          limpiar(u); u.orden = 'nada'; u.obj = 0; u.ruta = null; u.pend = null;
          u.patrulla = UNID[u.tipo].aire ? { pts: [{ x, y }], i: 0 } : { pts: [{ x: u.x, y: u.y }, { x, y }], i: 0 }; // el avión patrulla el punto, no el trayecto
        });
        return;
      case 'explorar': // recorre sola lo que aún no se ha visto
        for (const u of propias(m, cmd)) if (u.tipo !== 'cosechadora' && !UNID[u.tipo].aire) { limpiar(u); u.explora = true; u.orden = 'nada'; u.obj = 0; u.ruta = null; u.pend = null; }
        return;
      case 'reunion': { // punto de reunión de un cuartel o una fábrica
        const e = m.porId.get(cmd.id);
        if (e && e.edif && e.j === cmd.j && W.PRODUCE[e.tipo]) e.reunion = { x: cmd.x, y: cmd.y };
        return;
      }
      case 'detener':
        for (const u of propias(m, cmd)) { limpiar(u); u.orden = 'nada'; u.obj = 0; u.ruta = null; u.pend = null; if (u.tipo === 'cosechadora') u.est = 'quieto'; if (u.sumi) u.sumi = null; }
        return;
      case 'cosechar':
        for (const u of propias(m, cmd)) if (u.tipo === 'cosechadora') { limpiar(u); u.orden = 'nada'; u.ruta = null; u.pend = null; u.est = 'buscar'; u.pref = { x: cmd.x, y: cmd.y };
          const cx = Math.floor(cmd.x), cy = Math.floor(cmd.y); // si se señala una veta rara, va por raros
          u.quiere = cx >= 0 && cy >= 0 && cx < m.N && cy < m.N && m.mapa.tipoMin[cy * m.N + cx] === 2 ? 2 : 1; }
        return;
    }
  }

  // ---------- movimiento ----------
  // Avanza hacia el siguiente punto de la ruta: primero gira, luego acelera, y frena al llegar.
  function avanzar(m, u) {
    if (!u.ruta) { u.v = 0; return false; }
    if (u.ri >= u.ruta.length) { u.ruta = null; u.v = 0; return true; }
    const N = m.N, d = UNID[u.tipo], c = u.ruta[u.ri];
    const replantear = () => { u.ruta = null; u.v = 0; u.tReplan = m.t; if (u.meta) pedirRuta(m, u, u.meta.x, u.meta.y, u.meta.radio); };
    if (d.monta && u.monta > 0) { u.monta = Math.max(0, u.monta - 2); u.v = 0; return false; } // antes de moverse hay que desmontar el arma
    const pisa = (i) => (u.orden === 'trazar' ? pisaTraza(m, i) : pasoDe(m, u)[i] || (m.puertas ? m.puertas[u.j][i] : 0));
    if (!d.aire && m.muro && m.muro[c] >= 2 && m.muroJ[c] - 1 !== u.j && !pisa(c)) { // le cierra el paso un muro enemigo: si su ruta pasa por él y tiene con qué, lo derriba a tiros
      const arma = d.arma ? ARMAS[d.arma] : null;
      if (!u.rompe || !arma || !(arma.vs.edificio > 0) || u.orden === 'mover') { u.ruta = null; u.v = 0; u.fallo = !u.rompe; if (u.rompe) u.orden = 'nada'; return false; }
      const b = blancoMuro(m, c); u.v = 0;
      if (apuntar(m, u, b, false) && u.recarga <= 0) disparar(m, u, b, arma);
      return false;
    }
    if (!d.aire && !pisa(c) && pisa(Math.floor(u.y) * N + Math.floor(u.x))) { replantear(); return false; } // alguien construyó en el punto de paso
    const vel = d.vel * (d.cat === 'veh' && m.jug[u.j].mejoras.motores ? 1.15 : 1);
    const terr = m.mapa.terreno[Math.floor(u.y) * N + Math.floor(u.x)];
    let freno = 1; // alambrada enemiga: a la infantería la frena mucho; un vehículo la aplasta al pasar
    if (m.muro && !d.aire) { const ca = Math.floor(u.y) * N + Math.floor(u.x); if (m.muro[ca] === 1 && m.muroJ[ca] - 1 !== u.j) { if (d.cat === 'veh') quitarMuro(m, ca); else freno = 0.3; } }
    const vmax = freno * (u.tope && u.tope < vel && !u.suelto ? u.tope : vel) * (u.marcha ? u.fm || 1 : 1) * (u.orden === 'trazar' && !(viaDe(m)[u.j][Math.floor(u.y) * N + Math.floor(u.x)] && m.via[u.j][c]) ? ECON.trazaVel : d.cat === 'veh' && terr >= T.CAMINO && viaDe(m)[u.j][Math.floor(u.y) * N + Math.floor(u.x)] ? ECON.caminoVel : 1); // (trazando sobre camino ya hecho va a su paso normal) // por camino los vehículos van más rápido; trazándolo, despacio
    const alFinal = u.ri === u.ruta.length - 1 && u.fin;
    const carril = !alFinal && d.cat === 'veh' && u.orden !== 'trazar' && m.carrilX && m.carrilX[c] > 0 && m.mapa.terreno[c] >= T.CAMINO && viaDe(m)[u.j][c]; // por camino, los vehículos van por el carril y no por el centro de cada celda
    const tx = alFinal ? u.fin.x : carril ? m.carrilX[c] : (c % N) + 0.5, ty = alFinal ? u.fin.y : carril ? m.carrilY[c] : ((c / N) | 0) + 0.5, dx = tx - u.x, dy = ty - u.y, dd = Math.hypot(dx, dy);
    let alin = 1, dif = 0;
    if (dd > 0.4) { // muy cerca del punto ya no exige alinearse: evita quedarse pivotando si lo empujan
      const meta = Math.atan2(dy, dx);
      dif = ((meta - u.ang + Math.PI) % TAU + TAU) % TAU - Math.PI;
      if (Math.abs(dif) <= d.giro) { u.ang = meta; dif = 0; } else { u.ang += Math.sign(dif) * d.giro; dif -= Math.sign(dif) * d.giro; }
      alin = Math.cos(dif);
    }
    // Los vehículos toman las curvas rodando: avanzan hacia donde miran mientras giran, más despacio cuanto más cerrada la curva,
    // y solo se paran a pivotar si el punto les queda casi a la espalda.
    const curva = d.cat === 'veh' && !d.aire && dd > 0.4;
    const ultimo = u.ri === u.ruta.length - 1;
    const planea = d.aire && (!u.obj || d.pasada); // un avión en ruta (o atacando de pasada) no se detiene: vira en marcha y da por alcanzado el punto al pasar cerca
    let obj = planea ? vmax * Math.max(0.6, alin) : curva ? (Math.abs(dif) < 1.75 ? vmax * Math.max(0.35, alin) : 0) : alin > 0.6 ? vmax * alin : 0; // muy desalineado: pivota en el sitio
    if (curva && Math.abs(dif) > 0.05) obj = Math.min(obj, Math.max(0.012, (d.giro * dd) / (2 * Math.abs(Math.sin(dif))))); // nunca tan rápido que la curva no alcance el punto
    if (u.espera > m.t) obj = 0; // aún no ha reaccionado a la orden: se va encarando, pero no arranca
    if (ultimo && !planea) obj = Math.min(obj, 0.02 + dd * 0.12); // frena al llegar
    if (planea && ultimo && dd <= 1.5) { u.ruta = null; return true; }
    u.v = u.v < obj ? Math.min(obj, u.v + d.acel) : Math.max(obj, u.v - d.acel * 2);
    if (ultimo && dd <= 0.25) { u.ruta = null; u.v = 0; return true; } // en el destino basta con quedar cerca
    if (curva && !ultimo && dd <= Math.max(u.v, 0.3)) { u.ri++; return false; } // rodando no hace falta clavar cada punto intermedio
    if (dd <= Math.max(u.v, 0.02)) { u.x = tx; u.y = ty; u.ri++; return false; }
    let nx = u.x + (dx / dd) * u.v, ny = u.y + (dy / dd) * u.v;
    if (curva) { // hacia donde mira; si eso lo saca de lo transitable, recto al punto como antes
      const hx = u.x + Math.cos(u.ang) * u.v, hy = u.y + Math.sin(u.ang) * u.v;
      if (hx >= 0 && hy >= 0 && hx < N && hy < N && pisa(Math.floor(hy) * N + Math.floor(hx))) { nx = hx; ny = hy; }
    }
    if (!d.aire && m.ocup[Math.floor(ny) * N + Math.floor(nx)] && m.t - u.tReplan > 10) { replantear(); return false; } // edificio nuevo en medio del tramo
    u.x = nx; u.y = ny;
    return false;
  }

  // ¿Hay paso en línea recta, con el ancho de una unidad?
  function despejado(m, x0, y0, x1, y1, paso) {
    const N = m.N, dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy);
    if (L < 1e-6) return true;
    const n = Math.ceil(L / 0.25), ox = (-dy / L) * 0.3, oy = (dx / L) * 0.3;
    for (let i = 0; i <= n; i++) {
      const x = x0 + (dx * i) / n, y = y0 + (dy * i) / n;
      if (!paso[(y | 0) * N + (x | 0)] || !paso[((y + oy) | 0) * N + ((x + ox) | 0)] || !paso[((y - oy) | 0) * N + ((x - ox) | 0)]) return false;
    }
    return true;
  }
  // Quita los zigzags de la rejilla: salta al punto más lejano que se alcanza en línea recta.
  function suavizar(m, x, y, ruta, paso) {
    const N = m.N, out = [];
    let ax = x, ay = y, i = 0;
    while (i < ruta.length) {
      let j = i;
      const tope = Math.min(ruta.length - 1, i + 24);
      for (let k = i + 1; k <= tope; k++) {
        const c = ruta[k];
        if (despejado(m, ax, ay, (c % N) + 0.5, ((c / N) | 0) + 0.5, paso)) j = k; else if (k - j > 4) break;
      }
      out.push(ruta[j]); ax = (ruta[j] % N) + 0.5; ay = ((ruta[j] / N) | 0) + 0.5; i = j + 1;
    }
    return out;
  }

  function procesarRutas(m) {
    // Cada tick se gasta en rutas un presupuesto de celdas exploradas (no de tiempo: así la partida sigue siendo reproducible):
    // las rutas largas de un ejército entero se reparten entre varios ticks en vez de congelar uno.
    // Las unidades de una misma orden (u.mision) comparten el tramo largo: solo la primera lo calcula entero; las demás
    // buscan cómo llegar a él y, desde su final, a su propio puesto.
    const N = m.N, terr = m.mapa.terreno;
    let n = 0, nodos = 0;
    if (!m.rc) m.rc = [];
    if (m.rc.length && m.t - m.rc[0].t > 60) m.rc = m.rc.filter((q) => m.t - q.t <= 60);
    while (m.colaRutas.length && n < 40 && nodos < ECON.rutaNodos) {
      const u = m.porId.get(m.colaRutas.shift());
      if (!u || !u.pend) continue;
      const p = u.pend; u.pend = null; n++;
      const traza = u.orden === 'trazar', paso = traza ? tablaTraza(m) : pasoDe(m, u), tb = paso === m.pasoV ? 1 : 0;
      conVia = viaDe(m) && m.viaN[u.j] > 0, kh = conVia && Math.max(Math.abs(p.x - u.x), Math.abs(p.y - u.y)) < 70 ? 0.62 : 1, hayMuros = murosDe(m) && m.muros.length > 0, puertas = hayMuros ? m.puertas[u.j] : null;
      // kh: con caminos propios y en trayectos cortos, 0,62 (la búsqueda los encuentra y los prefiere); en los largos, 1: con 0,62 exploraba medio mapa por ruta, y con 1 sale a lo sumo un 2-3 % peor por la tercera parte.
      const x0 = Math.floor(u.x), y0 = Math.floor(u.y);
      let camino = null;
      u.rompe = false;
      if (!traza && u.mision) { // ¿ya hay un tramo largo calculado para esta misma orden?
        let q = null; for (const r of m.rc) if (r.mi === u.mision && r.j === u.j && r.tb === tb && Math.abs(r.x - p.x) <= 10 && Math.abs(r.y - p.y) <= 10) { q = r; break; }
        if (q) {
          const c = q.c; let k = -1, md = 144;
          for (let i = 0; i < c.length; i++) { const dx = (c[i] % N) + 0.5 - u.x, dy = ((c[i] / N) | 0) + 0.5 - u.y, d = dx * dx + dy * dy; if (d < md) { md = d; k = i; } }
          if (k >= 0 && k < c.length - 8) {
            const fin = c[c.length - 1];
            const a1 = m.ruta(paso, terr, x0, y0, (c[k] % N) + 0.5, ((c[k] / N) | 0) + 0.5, 0.75, conVia ? 0.62 : 1, m.via[u.j], puertas, null, 1500); nodos += m.ruta.nodos || 0;
            const a2 = a1 ? m.ruta(paso, terr, fin % N, (fin / N) | 0, p.x, p.y, p.radio, conVia ? 0.62 : 1, m.via[u.j], puertas, null, 1500) : null; if (a1) nodos += m.ruta.nodos || 0;
            if (a1 && a2) camino = a1.concat(c.slice(k + 1), a2);
          }
        }
      }
      if (!camino) {
        camino = m.ruta(paso, terr, x0, y0, p.x, p.y, p.radio, kh, m.via[u.j], puertas); nodos += m.ruta.nodos || 0;
        if (!camino && hayMuros && !traza) { // cerrado por muros: la ruta que menos muro tenga que derribar
          camino = m.ruta(paso, terr, x0, y0, p.x, p.y, p.radio, kh, m.via[u.j], m.muroTodo, m.muroTodo); nodos += m.ruta.nodos || 0;
          if (camino) u.rompe = true;
        }
        if (camino && !u.rompe && !traza && u.mision && camino.length > 24) { if (m.rc.length >= 16) m.rc.shift(); m.rc.push({ mi: u.mision, j: u.j, tb, x: p.x, y: p.y, t: m.t, c: camino.slice() }); }
      }
      if (camino) {
        u.fin = null;
        if (p.radio === 0) { // destino exacto: el último tramo va al punto pedido, no al centro de su celda
          const cf = Math.floor(p.y) * N + Math.floor(p.x);
          if (p.x >= 0 && p.y >= 0 && p.x < N && p.y < N && paso[cf]) { if (camino[camino.length - 1] !== cf) camino.push(cf); u.fin = { x: p.x, y: p.y }; }
        }
        u.ruta = u.rompe || (m.viaN[u.j] > 0 && paso === m.pasoV) ? camino : suavizar(m, u.x, u.y, camino, traza && !camino.some((c) => m.mapa.terreno[c] === T.AGUA) ? m.paso : paso); u.ri = 0; // (la excavadora solo recorta por el agua si de verdad tiene que cruzarla) // con caminos, los vehículos siguen la ruta tal cual, para no salirse de ellos
      } else { u.ruta = null; u.fallo = true; }
    }
  }

  function separar(m) {
    const N = m.N, g = m.gr, C = g.C, ini = g.ini, us = g.us;
    for (let a = 0; a < us.length; a++) {
      const A = us[a]; if (UNID[A.tipo].mini || A.enTierra) continue; // (los drones pequeños no estorban a nadie; los aviones posados tienen su sitio)
      const ra = UNID[A.tipo].radio, gx = A.gc % C, gy = (A.gc / C) | 0;
      for (let cy = Math.max(0, gy - 1); cy <= Math.min(C - 1, gy + 1); cy++) for (let cx = Math.max(0, gx - 1); cx <= Math.min(C - 1, gx + 1); cx++) {
       const cc = cy * C + cx;
       for (let b = Math.max(ini[cc], a + 1), fb = ini[cc + 1]; b < fb; b++) { // cada pareja, una sola vez: la que va después en la rejilla
        const B = us[b];
        if (UNID[B.tipo].mini || B.enTierra) continue;
        let dx = B.x - A.x; if (dx > 1 || dx < -1) continue;
        let dy = B.y - A.y; if (dy > 1 || dy < -1) continue;
        if (!UNID[A.tipo].aire !== !UNID[B.tipo].aire) continue; // los aviones pasan por encima de todo lo demás
        if (A.j !== B.j && (UNID[A.tipo].cat === 'inf') !== (UNID[B.tipo].cat === 'inf')) continue; // un vehículo no esquiva a la infantería enemiga: la arrolla
        const min = ra + UNID[B.tipo].radio;
        let d = Math.hypot(dx, dy);
        if (d >= min) continue;
        if (d < 1e-4) { dx = ((A.id * 7 + B.id * 3) % 5) - 2 || 1; dy = ((A.id * 3 + B.id * 5) % 5) - 2; d = Math.hypot(dx, dy); }
        // Empuje blando y algo girado: tope por debajo de la velocidad de marcha,
        // para que dos unidades de frente se rodeen en vez de bloquearse.
        const emp = Math.min((min - d) * 0.5, 0.06), ex = dx / d, ey = dy / d;
        const ux = ex * 0.88 - ey * 0.48, uy = ex * 0.48 + ey * 0.88;
        const pa = A.fijo ? 0 : B.fijo ? 1 : 0.5, pb = B.fijo ? 0 : A.fijo ? 1 : 0.5;
        mover(A, -ux * emp * pa, -uy * emp * pa); mover(B, ux * emp * pb, uy * emp * pb);
       }
      }
    }
    function mover(u, dx, dy) {
      if (!dx && !dy) return;
      const nx = u.x + dx, ny = u.y + dy;
      if (nx < 0.3 || ny < 0.3 || nx > N - 0.3 || ny > N - 0.3) return;
      if (UNID[u.tipo].aire || pasoDe(m, u)[Math.floor(ny) * N + Math.floor(nx)]) { u.x = nx; u.y = ny; }
    }
  }

  // ---------- combate ----------
  // ¿Puede esta arma dañar a ese blanco? (los cañones no alcanzan a los aviones; la antiaérea solo a ellos)
  function puede(arma, b) { return !!arma && !b.enTierra && arma.vs[b.edif ? 'edificio' : UNID[b.tipo].blindaje] > 0; } // al avión posado lo cubre su aeródromo
  W.puedeAtacar = (a, b) => puede(ARMAS[a.edif ? EDIF[a.tipo].arma : UNID[a.tipo].arma], b);
  // ---------- frente, torreta y visión dirigida ----------
  const difAng = (a, b) => ((a - b + Math.PI) % TAU + TAU) % TAU - Math.PI;
  const girarHacia = (act, meta, paso) => { const d = difAng(meta, act); return Math.abs(d) <= paso ? meta : act + Math.sign(d) * paso; };
  const COS_CONO = Math.cos(ECON.cono), COS_PERI = Math.cos(ECON.periferia);
  const K_CONO = COS_CONO * Math.abs(COS_CONO), K_PERI = COS_PERI * Math.abs(COS_PERI); // cosenos al cuadrado con signo: comparan sin raíz
  const CAMPO = {}; // campo de visión de cada tipo de unidad (algunas ven más ancho, o en redondo)
  for (const t in UNID) { const a = UNID[t].cono || ECON.cono, c = Math.cos(a); CAMPO[t] = { todo: a >= Math.PI, cos: c, k: c * Math.abs(c) }; }
  // ¿Ve la unidad a ese enemigo? Cerca, en todas direcciones; lejos, solo dentro del cono frontal.
  function veDir(m, a, e, d) {
    const v = UNID[a.tipo].vision * (W.esNoche(m) ? ECON.nocheVis : 1);
    const dx = posX(e) - a.x, dy = posY(e) - a.y;
    const q = trincheraDe(m, a);
    if (q && Math.abs(difAng(Math.atan2(dy, dx), q.ang)) > ECON.arcoTrinchera) return false; // desde la trinchera solo se cubre su frente
    if (d <= v * ECON.visAt) return true;
    if (d > v * ECON.visAd) return false;
    if (CAMPO[a.tipo].todo || mandado(m, a)) return true;
    const c = (dx * Math.cos(a.ang) + dy * Math.sin(a.ang)) / (Math.hypot(dx, dy) || 1); // coseno del ángulo respecto al frente
    return c >= CAMPO[a.tipo].cos || (c >= COS_PERI && d <= v * ECON.visLado);
  }
  // Apunta el arma al blanco y dice si ya puede disparar. Con torreta gira solo la torreta; sin ella, el cuerpo entero
  // (y solo si está quieto: en marcha el cuerpo sigue el camino). Desde una trinchera no se sale de su arco frontal.
  const mandado = (m, u) => m.t - (u.tMando === undefined ? -99 : u.tMando) <= 12; // bajo el radio de un vehículo de mando
  function apuntar(m, a, o, quieto) {
    const meta = Math.atan2(posY(o) - posY(a), posX(o) - posX(a));
    if (a.edif) { a.angT = girarHacia(a.angT, meta, EDIF[a.tipo].giroT); return Math.abs(difAng(meta, a.angT)) <= ECON.arco; }
    const d = UNID[a.tipo], kg = mandado(m, a) ? ECON.mandoGiro : 1;
    if (ARMAS[d.arma].omni) return true;
    a.apunto = true;
    if (d.giroT) { a.angT = girarHacia(a.angT, meta, d.giroT * kg); return Math.abs(difAng(meta, a.angT)) <= ECON.arco; }
    const q = trincheraDe(m, a);
    if (q && Math.abs(difAng(meta, q.ang)) > ECON.arcoTrinchera) return false;
    if (quieto) a.ang = girarHacia(a.ang, meta, d.giro * kg);
    return Math.abs(difAng(meta, a.ang)) <= (d.arco || ECON.arco);
  }
  W.sector = (m, a, e) => { // 0 frente, 1 costado, 2 espalda: desde dónde le llega a "a" algo situado en "e"
    const rel = Math.abs(difAng(Math.atan2(e.y - a.y, e.x - a.x), a.ang));
    return rel > 2.094 ? 2 : rel > 1.047 ? 1 : 0;
  };

  // Escondida: infantería quieta en el bosque (o un francotirador quieto en cualquier parte) que no ha disparado hace poco.
  // El enemigo no la ve ni la ataca por su cuenta hasta tenerla a un par de celdas.
  function oculta(m, e) {
    if (e.edif || m.t - (e.camT === undefined ? -999 : e.camT) < 20) return false; // (una cámara enemiga cerca la descubre)
    const d = UNID[e.tipo];
    if (d.espia) return true; // el espía pasa inadvertido también en movimiento
    if (e.orden !== 'nada' || e.v > 0.001 || m.t - (e.tDisparo === undefined ? -999 : e.tDisparo) < 60) return false;
    return d.cat === 'inf' && (d.sigilo || m.mapa.terreno[Math.floor(e.y) * m.N + Math.floor(e.x)] === T.BOSQUE);
  }
  W.oculta = oculta;
  function buscarEnemigo(m, a, x, y, rango) {
    const arma = ARMAS[a.edif ? EDIF[a.tipo].arma : UNID[a.tipo].arma];
    let mejor = null, md = rango;
    const mira = (e) => {
      if (e.j === a.j || e.vida <= 0 || e.infra || !puede(arma, e)) return; // a los caminos no se les dispara por iniciativa propia: solo por orden
      const d = dist(x, y, e);
      if (d > md) return;
      if (oculta(m, e)) { if (d > ECON.ocultaVe) return; e.delatada = m.t; } // escondida: solo se la ve de muy cerca
      if (!a.edif) { // una unidad solo detecta por sí misma lo que cae en su visión; el arma indirecta, lo que vea cualquiera de los suyos
        if (arma.indirecto ? m.niebla[a.j][Math.floor(posY(e)) * m.N + Math.floor(posX(e))] !== 2 : !veDir(m, a, e, d)) return;
      }
      md = d; mejor = e;
    };
    const g = m.gr;
    if (g && g.t === m.t) { // dentro del tick: solo las casillas que caen en el alcance (con un margen por lo que se hayan movido), y los edificios
      const C = g.C, R = rango + 1.5, ini = g.ini, us = g.us;
      const c0 = Math.max(0, ((x - R) / GC) | 0), c1 = Math.min(C - 1, ((x + R) / GC) | 0), r0 = Math.max(0, ((y - R) / GC) | 0), r1 = Math.min(C - 1, ((y + R) / GC) | 0);
      for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) { const c = cy * C + cx; for (let k = ini[c], f = ini[c + 1]; k < f; k++) mira(us[k]); }
      const ed = g.edifs; for (let k = 0; k < ed.length; k++) mira(ed[k]);
    } else for (let k = 0; k < m.ents.length; k++) mira(m.ents[k]);
    return mejor;
  }

  // Atrincherada: infantería quieta sobre una trinchera. Recibe menos daño y no puede ser atropellada.
  // La trinchera es un lugar fijo con cuatro puestos, que queda en el mapa: la ocupa la infantería que se mete en ella (con la orden, o parándose
  // encima si queda sitio) y la deja libre al salir. Vacía, la puede tomar cualquiera. Solo quien ocupa un puesto está a cubierto.
  function enTrinchera(m, b) { if (b.edif || b.orden !== 'nada' || !b.trin) return false; const q = m.trincheras.get(b.trin - 1); return !!q && Math.abs(b.x - q.x) < 0.8 && Math.abs(b.y - q.y) < 0.8; } // en su puesto (los de los extremos asoman de la celda)
  const PLAZAS = 4;
  const puestoTrinchera = (q, k) => { const l = (k - (PLAZAS - 1) / 2) * 0.3; return { x: q.x - Math.sin(q.ang) * l, y: q.y + Math.cos(q.ang) * l }; };
  W.puestoTrinchera = puestoTrinchera; W.PLAZAS_TRINCHERA = PLAZAS;
  function tickTrincheras(m) { // cada medio segundo: quien se fue deja su puesto; quien se ha parado encima y cabe, lo toma
    for (const [c, q] of m.trincheras) {
      if (!q.dentro) q.dentro = [];
      for (let k = 0; k < PLAZAS; k++) {
        const u = q.dentro[k] ? m.porId.get(q.dentro[k]) : null;
        if (!u) { q.dentro[k] = 0; continue; }
        const aqui = Math.abs(u.x - q.x) < 0.8 && Math.abs(u.y - q.y) < 0.8, viene = u.orden === 'mover' && u.dest && Math.hypot(u.dest.x - q.x, u.dest.y - q.y) < 0.7;
        if (u.vida <= 0 || u.trin !== c + 1 || !(aqui ? u.orden === 'nada' || viene : viene)) { q.dentro[k] = 0; if (u.trin === c + 1) u.trin = 0; }
      }
    }
    for (const u of m.ents) {
      if (u.edif || u.trin || u.orden !== 'nada' || u.v > 0.001 || UNID[u.tipo].cat !== 'inf') continue;
      const c = Math.floor(u.y) * m.N + Math.floor(u.x), q = m.trincheras.get(c);
      if (!q) continue;
      if (q.dentro.some((id) => { const o = id ? m.porId.get(id) : null; return o && o.j !== u.j; })) continue; // ocupada por el otro bando
      const k = q.dentro.findIndex((id) => !id); if (k < 0 || k >= PLAZAS) { if (q.dentro.length < PLAZAS) { q.dentro.push(u.id); u.trin = c + 1; } continue; }
      q.dentro[k] = u.id; u.trin = c + 1;
    }
  }
  W.enTrinchera = enTrinchera;
  function trincheraDe(m, b) { return enTrinchera(m, b) ? m.trincheras.get(b.trin - 1) : null; }
  // El bosque cubre a la infantería (recibe menos daño) y frena a los vehículos.
  function enBosque(m, b) { return !b.edif && !UNID[b.tipo].aire && m.mapa.terreno[Math.floor(b.y) * m.N + Math.floor(b.x)] === T.BOSQUE; }
  W.enBosque = enBosque;
  // ox, oy: de dónde viene el tiro. A un vehículo le duele más por los costados y más aún por la espalda.
  function herir(m, b, arma, mult, de, ox, oy) {
    if (!puede(arma, b) || m.jug[b.j].tr.invulnerable) return; // ADMIN: invulnerables
    let fl = 1;
    if (ox !== undefined && !b.edif && UNID[b.tipo].cat === 'veh') { const s = W.sector(m, b, { x: ox, y: oy }); fl = s === 2 ? ECON.espalda : s === 1 ? ECON.flanco : 1; if (s && m.t - (b.tFlanco === undefined ? -99 : b.tFlanco) > 25) { b.tFlanco = m.t; m.efectos.push({ tipo: 'flanco', x1: b.x, y1: b.y, s, j: b.j, t: m.t }); } }
    b.vida -= fl * arma.dano * (mult || 1) * arma.vs[b.edif ? 'edificio' : UNID[b.tipo].blindaje] * (enTrinchera(m, b) ? ECON.trinchera : 1) * (enBosque(m, b) && UNID[b.tipo].cat === 'inf' ? ECON.bosqueCubre : 1);
    b.tDano = m.t; b.agresor = de;
    if (b.vida <= 0 && !b.contada) { // veteranía: la baja se la apunta quien disparó
      b.contada = true;
      const a = de ? m.porId.get(de) : null;
      if (a && !a.edif && a.vida > 0) {
        a.bajas++;
        while (a.rango < ECON.rangos.length && a.bajas >= ECON.rangos[a.rango]) {
          a.rango++;
          const nueva = Math.round(vidaDe(m.jug[a.j], a.tipo) * (1 + ECON.rangoVida * a.rango));
          a.vida += nueva - a.vidaMax; a.vidaMax = nueva;
          m.efectos.push({ tipo: 'ascenso', x1: a.x, y1: a.y, rango: a.rango, j: a.j, t: m.t });
        }
      }
    }
  }
  // Contraataque: el atacado va por su agresor. Los compañeros llegan por la colmena (ver más abajo).
  function alertar(m, a, b) {
    m.jug[b.j].alerta = { x: posX(b), y: posY(b), t: m.t };
    if (b.tipo === 'cosechadora' && b.orden !== 'mover') { // la cosechadora atacada deja lo que hace y se refugia en la refinería
      if (!b.huye) m.efectos.push({ tipo: 'huye', x1: b.x, y1: b.y, j: b.j, t: m.t });
      b.huye = m.t + ECON.huida;
      if (b.est === 'ir' || b.est === 'cosechar' || b.est === 'buscar' || b.est === 'espera') { b.ruta = null; b.est = 'volver0'; }
      return;
    }
    if (b.edif || b.obj || !UNID[b.tipo].arma || b.repostando || (b.orden !== 'nada' && b.orden !== 'amover') || !puede(ARMAS[UNID[b.tipo].arma], a)) return;
    b.obj = a.id; b.tRep = m.t; b.ruta = null; b.pend = null;
  }

  // ---------- inteligencia de colmena ----------
  // Cada medio segundo: lo atacado forma un "foco". El foco estima la amenaza (valor de los enemigos cercanos)
  // y la compara con el apoyo presente y el que ya va en camino. Si falta fuerza, la llamada se propaga:
  // la oyen las unidades dentro de un radio que crece, y también las que están cerca de quien ya acude
  // (hasta tres saltos). Acuden primero las más cercanas y solo hasta cubrir la necesidad.
  const valor = (e) => (e.edif ? (EDIF[e.tipo].arma ? EDIF[e.tipo].costo * 0.8 : 0) : UNID[e.tipo].arma ? UNID[e.tipo].costo : 0) * Math.max(0.2, e.vida / e.vidaMax);
  function soltar(m, f) { // fin del foco: quienes acudieron retoman lo suyo o vuelven a su puesto
    for (const id of f.resp) {
      const u = m.porId.get(id);
      if (!u || u.acude !== f.id) continue;
      u.acude = 0;
      if (u.previo) asignar(m, u, u.previo);
      else if (!u.patrulla && !u.cola.length && u.origen) asignar(m, u, { t: 'amover', x: u.origen.x, y: u.origen.y });
    }
  }
  function colmena(m) {
    for (let j = 0; j < 2; j++) {
      const J = m.jug[j], focos = m.focos[j];
      if (!J.colmena) { for (const f of focos) soltar(m, f); focos.length = 0; continue; }
      for (const f of focos) { f.victimas = []; f.agresores = []; }
      for (const e of m.ents) { // lo herido hace poco se agrupa por cercanía
        if (e.j !== j || e.infra || e.tDano === undefined || m.t - e.tDano > 40 || !e.agresor) continue; // un camino atacado no llama a nadie
        const x = posX(e), y = posY(e);
        let f = focos.find((q) => Math.hypot(q.x - x, q.y - y) < 7);
        if (!f) { f = { id: m.sigFoco++, x, y, radio: 8, resp: [], victimas: [], agresores: [], visto: m.t }; focos.push(f); }
        f.victimas.push(e); f.visto = m.t;
        const a = m.porId.get(e.agresor); if (a && !f.agresores.includes(a)) f.agresores.push(a);
      }
      for (let k = focos.length - 1; k >= 0; k--) {
        const f = focos[k];
        if (m.t - f.visto > 60) { soltar(m, f); focos.splice(k, 1); continue; } // tres segundos de calma: se acabó
        if (!f.victimas.length) continue;
        f.x = posX(f.victimas[0]); f.y = posY(f.victimas[0]);
        f.resp = f.resp.filter((id) => { const u = m.porId.get(id); return u && u.acude === f.id; });
        const vict = new Set(f.victimas.map((e) => e.id));
        let amenaza = 0, presente = 0, camino = 0, ayudan = 0;
        f.ox = f.x; f.oy = f.y;
        let dmin = Infinity;
        for (const a of f.agresores) { const d = Math.hypot(posX(a) - f.x, posY(a) - f.y); if (d < dmin) { dmin = d; f.ox = posX(a); f.oy = posY(a); } }
        for (const e of m.ents) {
          const v = valor(e);
          if (!v || e.vida <= 0) continue;
          const x = posX(e), y = posY(e), d = Math.hypot(x - f.x, y - f.y);
          if (e.j !== j) { if (d <= 7 || f.agresores.some((a) => Math.hypot(posX(a) - x, posY(a) - y) <= 4)) amenaza += v; }
          else if (vict.has(e.id)) presente += v * 0.5; // quien está recibiendo el golpe cuenta la mitad
          else if (e.acude === f.id) { if (d <= 6) { presente += v; ayudan++; } else camino += v; }
          else if (d <= 6 && e.obj) { presente += v; ayudan++; } // compañera cercana que ya está peleando
        }
        f.amenaza = amenaza; f.necesidad = amenaza * 1.2 - presente - camino;
        f.sinApoyo = ayudan === 0 && amenaza > 0;
        if (f.sinApoyo) { // la alerta solo se muestra mientras nadie ha llegado a ayudar
          for (const e of f.victimas) e.llama = m.t;
          m.efectos.push({ tipo: 'llama', x2: f.x, y2: f.y, r: f.radio, j, t: m.t });
        }
        if (f.necesidad <= 0) continue;
        const nodos = [{ x: f.x, y: f.y, r: f.radio, salto: 0 }]; // la red: el foco y quienes ya acuden, que retransmiten
        for (const id of f.resp) { const u = m.porId.get(id); nodos.push({ x: u.x, y: u.y, r: 8, salto: u.salto }); }
        const cand = [];
        for (const u of m.ents) {
          if (u.j !== j || u.edif || u.acude || u.guardia || u.retirando || u.vida <= 0 || vict.has(u.id) || !UNID[u.tipo].arma || sinSuministro(u)) continue; // fuera de la red no llega la llamada
          const libre = (u.orden === 'nada' || u.orden === 'amover') && !u.obj;
          // Con una orden directa solo acude si atacan a una compañera que marcha en su misma misión.
          if (!libre && !(u.orden !== 'nada' && u.mision && f.victimas.some((v) => !v.edif && v.mision === u.mision && v.orden !== 'nada'))) continue;
          let salto = 99;
          for (const n of nodos) if (n.salto < 3 && n.salto + 1 < salto && Math.hypot(n.x - u.x, n.y - u.y) <= n.r) salto = n.salto + 1;
          if (salto <= 3) cand.push({ u, d: Math.hypot(u.x - f.x, u.y - f.y), salto });
        }
        cand.sort((a, b) => a.d - b.d || a.u.id - b.u.id);
        for (const c of cand) {
          if (f.necesidad <= 0) break;
          const u = c.u;
          u.previo = u.orden === 'atacar' ? { t: 'atacar', obj: u.obj } : u.orden !== 'nada' && !u.patrulla && u.dest ? { t: u.orden, x: u.dest.x, y: u.dest.y } : null;
          u.origen = { x: u.x, y: u.y };
          asignar(m, u, { t: 'amover', x: f.ox, y: f.oy });
          u.acude = f.id; u.salto = c.salto; u.oyo = m.t;
          f.resp.push(u.id); f.necesidad -= valor(u);
          m.efectos.push({ tipo: 'oye', x1: u.x, y1: u.y, x2: f.x, y2: f.y, j, t: m.t });
        }
        f.radio = Math.min(30, f.radio + 1); // nadie basta todavía: la llamada llega más lejos
      }
    }
  }
  // Los efectos son avisos para la interfaz (dibujo y sonido); la simulación no los lee.
  function disparar(m, a, b, arma) {
    const clave = a.edif ? EDIF[a.tipo].arma : UNID[a.tipo].arma, ax = posX(a), ay = posY(a), bx = posX(b), by = posY(b);
    const mult = (!a.edif && UNID[a.tipo].cat === 'inf' && m.jug[a.j].mejoras.perforante ? 1.25 : 1) * (a.edif ? 1 : 1 + ECON.rangoDano * a.rango);
    a.recarga = arma.recarga >= 8 ? Math.round(arma.recarga * (0.9 + ((a.id * 31 + m.t * 17) % 21) / 100)) : arma.recarga;
    if (!a.edif && sinSuministro(a)) a.recarga = Math.round(a.recarga * ECON.sinSumRecarga); // sin suministro: dispara más despacio
    a.tDisparo = m.t; // (cada arma lleva su compás, ±10 %: un grupo no dispara como un metrónomo)
    if (arma.vuelo) { // obús: vuela hasta donde estaba el blanco al disparar
      m.proy.push({ ox: ax, oy: ay, x: ax, y: ay, px: ax, py: ay, tx: bx, ty: by, obj: b.id, j: a.j, arma: clave, mult, de: a.id });
      for (let k = 1; k < (arma.rafaga || 1); k++) { // el resto de la salva cae repartido alrededor, un poco más tarde cada cohete
        const ang = a.id * 1.7 + m.t * 0.37 + k * 2.4, rr = arma.area * 0.95;
        m.proy.push({ ox: ax, oy: ay, x: ax, y: ay, px: ax, py: ay, tx: bx + Math.cos(ang) * rr, ty: by + Math.sin(ang) * rr, obj: 0, j: a.j, arma: clave, mult, de: a.id, sale: m.t + k * 9 }); // salen uno tras otro, como de una lanzadera
      }
      m.efectos.push({ tipo: 'boca', x1: ax, y1: ay, x2: bx, y2: by, j: a.j, t: m.t, arma: clave });
    } else {
      herir(m, b, arma, mult, a.id, ax, ay);
      m.efectos.push({ tipo: 'traza', x1: ax, y1: ay, x2: bx, y2: by, j: a.j, t: m.t, arma: clave });
    }
    alertar(m, a, b);
  }
  function tickProyectiles(m) {
    for (let k = m.proy.length - 1; k >= 0; k--) {
      const p = m.proy[k], arma = ARMAS[p.arma], dx = p.tx - p.x, dy = p.ty - p.y, dd = Math.hypot(dx, dy);
      if (p.sale) { if (p.sale > m.t) continue; p.sale = 0; m.efectos.push({ tipo: 'boca', x1: p.ox, y1: p.oy, x2: p.tx, y2: p.ty, j: p.j, t: m.t, arma: p.arma }); } // aún en el tubo
      p.px = p.x; p.py = p.y;
      const vel = p.vel || arma.vuelo;
      if (dd > vel) { p.x += (dx / dd) * vel; p.y += (dy / dd) * vel; continue; }
      let acierto = false;
      if (arma.area) { // explosión: daña a todo enemigo dentro del radio
        danarMuros(m, p.tx, p.ty, arma.area, arma, p.mult, p.de, p.j);
        for (const e of m.ents) if (e.j !== p.j && e.vida > 0 && !e.muro && dist(p.tx, p.ty, e) <= arma.area) { herir(m, e, arma, p.mult, p.de); acierto = true; }
      } else {
        const o = m.porId.get(p.obj);
        acierto = !!o && o.vida > 0 && dist(p.tx, p.ty, o) <= 0.9; // si el blanco se apartó, falla
        if (acierto) herir(m, o, arma, p.mult, p.de, p.ox, p.oy);
      }
      m.efectos.push({ tipo: 'impacto', x1: p.x, y1: p.y, x2: p.tx, y2: p.ty, j: p.j, t: m.t, arma: p.arma, acierto });
      m.proy[k] = m.proy[m.proy.length - 1]; m.proy.pop();
    }
  }

  function tickTorreta(m, e) {
    const J = m.jug[e.j], arma = ARMAS[EDIF[e.tipo].arma], alc = alcance(m, e, arma);
    if (e.recarga > 0) e.recarga--;
    if (e.sinLuz) { e.obj = 0; return; } // su red no le da energía: apagada
    let o = e.obj ? m.porId.get(e.obj) : null;
    if (o && (o.vida <= 0 || dist(e.cx, e.cy, o) > alc)) { o = null; e.obj = 0; }
    if (!o && (m.t + e.id) % 5 === 0) { o = buscarEnemigo(m, e, e.cx, e.cy, alc); if (o) e.obj = o.id; }
    if (o && apuntar(m, e, o) && e.recarga <= 0) disparar(m, e, o, arma);
  }

  // ---------- aviación ----------
  // Cada avión pertenece a un aeródromo (su "casa"), con cupo limitado. Sale de él, vuela, y vuelve a posarse cuando
  // termina su orden o cuando le queda el combustible justo. Posado reposta y nadie puede atacarlo. En patrulla,
  // al llenar el depósito despega solo y la retoma. Si pierde su casa busca otra con sitio; si no hay, acaba cayendo.
  const SLOTS = [[-0.9, -0.6], [0, -0.6], [0.9, -0.6], [-0.45, 0.6], [0.45, 0.6]];
  function avionesDe(m, base) { let n = 0; for (const e of m.ents) if (!e.edif && e.casa === base.id && e.vida > 0) n++; return n; }
  function aerodromoLibre(m, u) {
    let mejor = null, md = Infinity;
    for (const e of m.ents) {
      if (!e.edif || e.j !== u.j || e.tipo !== (W.hangarDe(UNID[u.tipo]) || 'aerodromo') || e.vida <= 0) continue; // el dron espía vive en su central
      const dd = Math.hypot(e.cx - u.x, e.cy - u.y);
      if (dd < md && avionesDe(m, e) - (u.casa === e.id ? 1 : 0) < (EDIF[e.tipo].hangar || ECON.cupoAviones)) { md = dd; mejor = e; }
    }
    return mejor;
  }
  function posar(m, u, base) {
    const usados = new Set();
    for (const e of m.ents) if (!e.edif && e !== u && e.casa === base.id && e.enTierra) usados.add(e.slot);
    let s = 0; while (usados.has(s) && s < SLOTS.length - 1) s++;
    u.casa = base.id; u.enTierra = true; u.slot = s; u.ruta = null; u.v = 0;
    u.x = base.cx + SLOTS[s][0]; u.y = base.cy + SLOTS[s][1]; u.px = u.x; u.py = u.y; u.ang = u.angT = -Math.PI / 2;
  }
  // Aviones y cupo de un jugador (los que vuelan, los posados y los encargados).
  // El edificio con hangar propio del que sale una unidad aérea (central de inteligencia, puesto logístico), o '' si vive en un aeródromo.
  W.hangarDe = (d) => (d.lugar && EDIF[d.lugar] && EDIF[d.lugar].hangar ? d.lugar : '');
  W.cupoAire = function (m, j, esp) { // esp: el edificio con hangar cuyo cupo se pregunta; sin él, el de los aeródromos
    const J = m.jug[j]; let hay = 0; esp = esp || '';
    for (const t in UNID) if (UNID[t].aire && !UNID[t].mini && W.hangarDe(UNID[t]) === esp) hay += (J.cuenta[t] || 0) + J.colas[t].n;
    return { hay, cupo: esp ? EDIF[esp].hangar * (J.cuenta[esp] || 0) : ECON.cupoAviones * (J.cuenta.aerodromo || 0) };
  };
  // Devuelve true si este tick el avión lo pasa posado o volviendo a su aeródromo.
  function tickVuelo(m, u) {
    const d = UNID[u.tipo];
    let base = u.casa ? m.porId.get(u.casa) : null;
    if (base && base.vida <= 0) base = null;
    if (!base) {
      if (u.enTierra) { u.vida = 0; return true; } // estaba dentro del aeródromo destruido
      base = aerodromoLibre(m, u); u.casa = base ? base.id : 0;
    }
    const conOrden = u.orden !== 'nada' || u.obj || u.cola.length > 0 || !!u.patrulla || u.acude || (u.sumi && u.sumi.est === 'puesto'); // (el helicóptero de suministro se queda sobre su punto)
    if (u.enTierra) {
      u.fuel = Math.min(d.fuel, u.fuel + ECON.reposta);
      if (u.fuel >= d.fuel) u.repostando = false;
      if (u.repostando) { u.orden = 'nada'; u.obj = 0; u.cola.length = 0; return true; } // hasta llenar el depósito no despega
      if (conOrden && u.fuel >= d.fuel * 0.3) { u.enTierra = false; return false; } // despega
      return true;
    }
    u.fuel--;
    if (u.fuel <= 0) { u.fuel = 0; u.vida -= u.vidaMax / ECON.fuelCae; u.tDano = m.t; } // sin combustible, cae
    if (!base) return false;
    const md = Math.hypot(base.cx - u.x, base.cy - u.y);
    if (!u.repostando && u.fuel < (md / d.vel) * 1.3 + 60) { // lo justo para volver: suelta lo que hace (la patrulla la retomará)
      u.repostando = true; u.orden = 'nada'; u.obj = 0; u.ruta = null; u.cola.length = 0; u.acude = 0;
      m.efectos.push({ tipo: 'reposta', x1: u.x, y1: u.y, x2: base.cx, y2: base.cy, j: u.j, t: m.t });
    }
    if (u.repostando) { u.orden = 'nada'; u.obj = 0; u.cola.length = 0; }
    else if (conOrden) return false;
    // de vuelta a casa: por combustible o porque ya no tiene nada que hacer
    if (md <= 1.7) { posar(m, u, base); return true; }
    if (!u.ruta || !u.meta || u.meta.x !== base.cx || u.meta.y !== base.cy) pedirRuta(m, u, base.cx, base.cy, 0);
    avanzar(m, u);
    return true;
  }

  // Excavadora trazando: convierte en camino las cuatro celdas que pisa (así el corredor tiene dos de ancho y los vehículos
  // caben también en las diagonales). Talar bosque cuesta más que allanar. Sin minerales, se detiene.
  function tickTraza(m, u) {
    const N = m.N, J = m.jug[u.j], terr = m.mapa.terreno, x0 = Math.floor(u.x - 0.5), y0 = Math.floor(u.y - 0.5);
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const x = x0 + dx, y = y0 + dy, c = y * N + x;
      if (x < 0 || y < 0 || x >= N || y >= N || (terr[c] !== T.LLANO && terr[c] !== T.BOSQUE && terr[c] !== T.AGUA) || m.ocup[c] || m.mapa.mineral[c] || m.mapa.sitioEn[c]) continue;
      const agua = terr[c] === T.AGUA, precio = agua ? ECON.caminoAgua : terr[c] === T.BOSQUE ? ECON.caminoBosque : ECON.caminoLlano;
      if (J.minerales < precio) { u.orden = 'nada'; u.ruta = null; u.trazas = []; m.efectos.push({ tipo: 'sinCamino', x1: u.x, y1: u.y, j: u.j, t: m.t }); return; }
      let tr = u.tramo ? m.porId.get(u.tramo) : null; // el tramo en curso; si no hay (o ya mide lo suyo), empieza otro
      if (!tr || tr.vida <= 0) { const f = u.tramoFin, sigue = f && Math.hypot(f.x - u.x, f.y - u.y) < 3.5; tr = crearTramo(m, u.j, sigue ? f.x : u.x, sigue ? f.y : u.y); u.tramo = tr.id; const cc = terr[Math.floor(u.y) * N + Math.floor(u.x)]; tr.puente = cc === T.AGUA || cc === T.PUENTE; } // empieza donde acabó el anterior, para que el carril no se corte
      tr.celdas.push(c); tr.antes.push(terr[c]); m.tramoEn[c] = tr.id; m.redSucia = true; viaDe(m)[tr.j][c] = 1; m.viaN[tr.j]++;
      J.minerales -= precio; terr[c] = agua ? T.PUENTE : T.CAMINO; m.paso[c] = 1; m.pasoV[c] = 1; m.hayCaminos = true; m.terrenoV++;
    }
    if (m.carrilX) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) { // a cada celda de camino le toca el punto del carril más cercano a su centro
      const x = x0 + dx, y = y0 + dy, c = y * N + x;
      if (x < 0 || y < 0 || x >= N || y >= N || terr[c] < T.CAMINO) continue;
      const px = m.carrilX[c], py = m.carrilY[c];
      if (!px || Math.hypot(u.x - x - 0.5, u.y - y - 0.5) < Math.hypot(px - x - 0.5, py - y - 0.5)) { m.carrilX[c] = u.x; m.carrilY[c] = u.y; }
    }
    if (u.fallo) { u.fallo = false; u.orden = 'nada'; u.trazas = []; m.efectos.push({ tipo: 'sinCamino', x1: u.x, y1: u.y, j: u.j, t: m.t, corte: true }); return; }
    { // el carril: el tramo apunta el recorrido cada poco, mientras la excavadora pisa celdas suyas; al llegar a su largo se cierra y el siguiente empieza donde acaba
      const tr = u.tramo ? m.porId.get(u.tramo) : null;
      if (tr && tr.vida > 0) {
        const p = tr.pts, d = Math.hypot(u.x - p[p.length - 2], u.y - p[p.length - 1]);
        if (m.tramoEn[Math.floor(u.y) * N + Math.floor(u.x)] !== tr.id) { if (p.length >= 4) { u.tramo = 0; u.tramoFin = { x: p[p.length - 2], y: p[p.length - 1] }; } } // va sobre un camino que ya existía: no se dibuja dos veces
        else if ((terr[Math.floor(u.y) * N + Math.floor(u.x)] === T.PUENTE) !== !!tr.puente) { // pasa de tierra a agua o al revés: el puente es un tramo aparte
          if (p.length >= 4) { u.tramo = 0; u.tramoFin = { x: p[p.length - 2], y: p[p.length - 1] }; } else tr.puente = !tr.puente;
        }
        else if (d > 0.35) {
          p.push(u.x, u.y); tr.largo += d;
          const q = (p.length >> 2) << 1; tr.cx = p[q]; tr.cy = p[q + 1]; tr.x = tr.cx - 0.5; tr.y = tr.cy - 0.5; // su centro: el punto medio del recorrido
          if (tr.largo >= ECON.tramoLargo) { u.tramo = 0; u.tramoFin = { x: u.x, y: u.y }; }
        }
      } else u.tramo = 0;
    }
    if (avanzar(m, u) || (!u.ruta && !u.pend)) {
      const sig = u.trazas.shift();
      if (sig) { u.dest = sig; pedirRuta(m, u, sig.x, sig.y, 0); } else u.orden = 'nada';
    }
  }
  // Ingeniero: cada medio segundo elige el vehículo o edificio propio dañado más cercano; va hasta él y lo repara, gratis
  // y también en pleno combate. En guardia (fijo) solo repara lo que tiene al alcance de la mano.
  // (El médico hace lo mismo con la infantería herida.)
  function tickIngeniero(m, u) {
    const med = !!UNID[u.tipo].cura;
    let o = u.arregla ? m.porId.get(u.arregla) : null;
    if (o && (o.vida <= 0 || o.vida >= o.vidaMax)) { o = null; u.arregla = 0; u.ruta = null; }
    if (!o && (m.t + u.id) % 10 === 0) {
      let md = u.guardia ? 1.6 : ECON.reparaRadio;
      for (const e of m.ents) {
        if (e.j !== u.j || e.vida >= e.vidaMax || e.vida <= 0 || e.enTierra || e === u) continue;
        if (med ? e.edif || UNID[e.tipo].cat !== 'inf' : !e.edif && UNID[e.tipo].cat !== 'veh') continue;
        const dd = dist(u.x, u.y, e);
        if (dd < md) { md = dd; o = e; }
      }
      if (o) { u.arregla = o.id; u.ruta = null; u.pend = null; }
    }
    if (!o) return;
    if (dist(u.x, u.y, o) <= 1.6) {
      u.ruta = null; u.v = 0; u.ang = Math.atan2(posY(o) - u.y, posX(o) - u.x);
      o.vida = Math.min(o.vidaMax, o.vida + (med ? ECON.curaMedico : o.edif ? ECON.reparaEdif : ECON.reparaVeh)); o.curando = m.t;
    } else {
      if (!u.pend && (!u.ruta || (!o.edif && (m.t + u.id) % 20 === 0))) pedirRuta(m, u, posX(o), posY(o), o.edif ? o.tam / 2 + 1 : 1);
      avanzar(m, u);
    }
  }
  // Retirada automática: la unidad muy dañada se va a reparar al taller más cercano (patio, o cuartel/fábrica según sea)
  // y, ya recuperada, vuelve a su puesto o retoma su patrulla. Cualquier orden directa la anula.
  function retirada(m, u) {
    const cat = UNID[u.tipo].cat;
    if (!u.retirando) {
      if (u.vida >= u.vidaMax * ECON.retiroBajo) { u.noRetira = false; return; }
      if (u.noRetira || u.guardia || u.cava > 0 || u.acude || enTrinchera(m, u)) return;
      let t = null, md = Infinity;
      for (const e of m.ents) {
        if (!e.edif || e.j !== u.j || (e.tipo !== 'patio' && e.tipo !== LUGAR[cat])) continue;
        const dd = Math.hypot(e.cx - u.x, e.cy - u.y);
        if (dd < md) { md = dd; t = e; }
      }
      if (!t) return;
      const enMarcha = u.dest && u.orden !== 'nada' && !u.patrulla;
      u.volver = { x: enMarcha ? u.dest.x : u.x, y: enMarcha ? u.dest.y : u.y, ang: u.ang, patrulla: u.patrulla };
      limpiar(u); u.obj = 0; u.retirando = true; u.tRet = m.t;
      const c = W.cercaLibre(m, t.cx, t.y + t.tam + 1.5);
      asignar(m, u, { t: 'mover', x: (c % m.N) + 0.5, y: ((c / m.N) | 0) + 0.5 });
      m.efectos.push({ tipo: 'retira', x1: u.x, y1: u.y, j: u.j, t: m.t });
      return;
    }
    if (u.vida < u.vidaMax * ECON.retiroAlto && m.t - u.tRet < 2400) return; // sigue reparándose (o lleva demasiado esperando)
    const v = u.volver; u.retirando = false; u.volver = null;
    if (!v) return;
    if (v.patrulla) u.patrulla = v.patrulla;
    else { asignar(m, u, { t: 'amover', x: v.x, y: v.y }); u.angFin = v.ang; }
  }
  function tickUnidad(m, u) {
    const d = UNID[u.tipo];
    u.px = u.x; u.py = u.y;
    if (u.recarga > 0) u.recarga--;
    if (d.mini) { tickDron(m, u); return; } // dron pequeño: lo lleva su portador
    if (u.hack > m.t) { u.v = 0; return; } // hackeado: ni se mueve ni dispara
    if (d.monta) { // arma de equipo: quieta, se va montando; hasta estar montada no dispara
      if (!u.ruta && !u.pend && u.v === 0) u.monta = Math.min(d.monta, (u.monta || 0) + 1);
      if ((u.monta || 0) < d.monta && u.recarga < 1) u.recarga = 1;
    }
    if (d.aire && tickVuelo(m, u)) return;
    if (u.tipo === 'cosechadora') { tickCosechadora(m, u); return; }
    if (d.giroT) { if (!u.apunto) u.angT = girarHacia(u.angT, u.ang, d.giroT); } else u.angT = u.ang; // sin blanco, la torreta vuelve al frente
    u.apunto = false;
    if (u.sube) { // camino de su transporte
      const t = m.porId.get(u.sube);
      if (!t || t.vida <= 0 || t.pasajeros.length >= UNID[t.tipo].plazas || u.orden !== 'nada') u.sube = 0;
      else {
        if (Math.hypot(t.x - u.x, t.y - u.y) <= 1.7) { if (!m.embarques.includes(u)) m.embarques.push(u); }
        else { if (!u.pend && (!u.ruta || (m.t + u.id) % 15 === 0)) pedirRuta(m, u, t.x, t.y, 1); avanzar(m, u); }
        return;
      }
    }
    if (u.fallo) { u.fallo = false; u.orden = 'nada'; u.obj = 0; limpiar(u); }
    if (u.orden === 'nada' && !u.obj && !u.acude && (u.cola.length || u.patrulla || u.explora)) siguienteOrden(m, u);
    if (u.orden === 'nada' && !u.obj && u.angFin != null) { // en su puesto, se encara como el resto de la formación
      const dif = ((u.angFin - u.ang + Math.PI) % TAU + TAU) % TAU - Math.PI;
      if (Math.abs(dif) <= d.giro) { u.ang = u.angFin; u.angFin = null; } else u.ang += Math.sign(dif) * d.giro;
    }
    if (u.cava > 0) { // cavando: al terminar queda la trinchera en esa celda, para quien la ocupe
      if (u.orden !== 'nada') u.cava = 0;
      else if ((u.cava -= d.cavaRapido ? 2 : 1) <= 0) { const c = Math.floor(u.y) * m.N + Math.floor(u.x); m.trincheras.set(c, { x: Math.floor(u.x) + 0.5, y: Math.floor(u.y) + 0.5, ang: u.ang, dentro: [u.id] }); u.trin = c + 1; } // quien la cava se queda en ella
    }
    if (!d.aire && (u.retira || u.retirando)) retirada(m, u);
    if (!d.arma) { // sin arma: solo se mueve; el ingeniero, además, repara lo que tenga cerca
      if (u.orden === 'atacar') { u.orden = 'nada'; u.obj = 0; }
      if (u.orden === 'trazar') { tickTraza(m, u); return; }
      if (u.orden === 'conectar') { tickConectar(m, u); return; }
      if (u.orden === 'hackear') { tickHackear(m, u); return; }
      if (u.orden === 'murar') { tickMurar(m, u); return; }
      if (u.orden === 'zapar') { tickZapar(m, u); return; }
      if (u.orden !== 'nada') { u.arregla = 0; if (avanzar(m, u) || (!u.ruta && !u.pend)) u.orden = 'nada'; return; }
      if (d.tiende && u.auto && m.logistica !== false && (m.t + u.id) % 30 === 0 && m.t >= (u.autoT || 0)) autoConectar(m, u);
      if (d.repara || d.cura) tickIngeniero(m, u);
      return;
    }
    const arma = ARMAS[d.arma], alc = alcance(m, u, arma);
    if (u.orden === 'mover') { // cumple la orden sin desviarse, pero dispara a lo que tenga a tiro
      if ((m.t + u.id) % 4 === 0) { const e = buscarEnemigo(m, u, u.x, u.y, alc); u.mira = e ? e.id : 0; }
      const e = u.mira ? m.porId.get(u.mira) : null;
      if (e && e.vida > 0) { const dd = dist(u.x, u.y, e); if (dd <= alc && dd >= (arma.alcanceMin || 0) && apuntar(m, u, e, false) && u.recarga <= 0) disparar(m, u, e, arma); }
      if (avanzar(m, u) || (!u.ruta && !u.pend)) u.orden = 'nada';
      return;
    }
    let o = u.obj ? m.porId.get(u.obj) : null;
    if (u.obj && (!o || o.vida <= 0 || o.enTierra)) { o = null; u.obj = 0; u.ruta = null; if (u.orden === 'atacar') u.orden = 'nada'; }
    if (o && d.aire && u.casa) { // no persigue más allá de su radio de vuelo
      const casa = m.porId.get(u.casa);
      if (casa && Math.hypot(posX(o) - casa.cx, posY(o) - casa.cy) > d.radioVuelo + alc) { o = null; u.obj = 0; u.ruta = null; if (u.orden === 'atacar') u.orden = 'nada'; }
    }
    if (!o) u.pase = '';
    if (o && d.pasada) { // ataque de pasada: entra disparando, sigue de largo unas celdas, vira y vuelve
      const dd = dist(u.x, u.y, o);
      if (u.pase !== 'sale') {
        if (dd <= alc && dd >= (arma.alcanceMin || 0) && u.recarga <= 0 && apuntar(m, u, o, false)) disparar(m, u, o, arma);
        if (!u.ruta || (m.t + u.id) % 8 === 0) pedirRuta(m, u, posX(o), posY(o), 0);
        if (avanzar(m, u) || dd < 1) { u.pase = 'sale'; pedirRuta(m, u, posX(o) + Math.cos(u.ang) * ECON.pasada, posY(o) + Math.sin(u.ang) * ECON.pasada, 0); }
      } else if (avanzar(m, u) || !u.ruta) u.pase = 'entra';
      return;
    }
    if (!o && (m.t + u.id) % 5 === 0) {
      o = buscarEnemigo(m, u, u.x, u.y, alc + (u.guardia || u.retirando ? 0 : 2));
      if (o) { u.obj = o.id; u.ruta = null; u.pend = null; }
    }
    if (o) {
      const dd = dist(u.x, u.y, o);
      if (dd <= alc) {
        const listo = apuntar(m, u, o, true);
        if (listo && u.recarga <= 0 && dd >= (arma.alcanceMin || 0)) disparar(m, u, o, arma); // demasiado cerca, la artillería no puede tirar
        else if (!listo && u.orden !== 'atacar' && enTrinchera(m, u)) u.obj = 0; // fuera del arco de la trinchera: no puede responder
      } else if (u.guardia || u.retirando) {
        u.obj = 0; // en guardia, o reparándose, no persigue
      } else if (u.orden !== 'atacar' && dd > alc + (m.t - u.tRep < 240 ? 14 : 4)) { // al agresor lo persigue más lejos
        u.obj = 0; u.ruta = null; // se alejó demasiado: lo suelta
      } else {
        if (!u.pend && (!u.ruta || (!o.edif && (m.t + u.id) % 20 === 0))) pedirRuta(m, u, posX(o), posY(o), o.edif ? o.tam / 2 + 1 : 1);
        if (d.giroT) apuntar(m, u, o, false); // la torreta va siguiendo al blanco mientras el casco avanza
        avanzar(m, u);
      }
      return;
    }
    if (u.orden === 'amover') {
      if (u.ruta) { if (avanzar(m, u)) u.orden = 'nada'; }
      else if (!u.pend) {
        if (Math.hypot(u.dest.x - u.x, u.dest.y - u.y) > 1.5) pedirRuta(m, u, u.dest.x, u.dest.y, 0); else u.orden = 'nada';
      }
    }
  }

  // ---------- cosecha ----------
  function minaCercana(m, u) {
    const N = m.N, rx = u.pref ? u.pref.x : u.x, ry = u.pref ? u.pref.y : u.y;
    if (u.vetadas && m.t - u.tVeto > 2400) u.vetadas = null; // pasado un rato vuelve a probar: puede que ya haya camino
    if (u.quiere === 2 && !m.raros.length) u.quiere = 1; // se acabaron los raros: vuelve a los minerales
    const lista = u.quiere === 2 ? m.raros : m.minas;
    let mejor = -1, md = Infinity;
    for (let k = 0; k < lista.length; k++) {
      const c = lista[k];
      if (u.vetadas && u.vetadas.has(c)) continue;
      const d = Math.hypot((c % N) + 0.5 - rx, ((c / N) | 0) + 0.5 - ry) + ((c * 7 + u.id * 13) % 5) * 0.3;
      if (d < md) { md = d; mejor = c; }
    }
    u.pref = null;
    return mejor;
  }
  function quitarMina(m, c) {
    for (const lista of [m.minas, m.raros]) {
      const i = lista.indexOf(c);
      if (i >= 0) { lista[i] = lista[lista.length - 1]; lista.pop(); }
    }
    m.mapa.tipoMin[c] = 0;
  }
  function refineriaCercana(m, u) {
    let mejor = null, md = Infinity;
    for (let k = 0; k < m.ents.length; k++) {
      const e = m.ents[k];
      if (e.j !== u.j || e.tipo !== 'refineria') continue;
      const d = dist(u.x, u.y, e);
      if (d < md) { md = d; mejor = e; }
    }
    return mejor;
  }

  function tickCosechadora(m, u) {
    const d = UNID.cosechadora, N = m.N, J = m.jug[u.j], cap = d.carga * (J.mejoras.tolva ? 1.5 : 1);
    u.fijo = false; u.fallo = false;
    if (u.orden === 'mover') {
      if (avanzar(m, u) || (!u.ruta && !u.pend)) { u.orden = 'nada'; u.est = 'quieto'; }
      return;
    }
    switch (u.est) {
      case 'buscar': {
        if (u.carga >= cap) { u.est = 'volver0'; break; }
        const c = minaCercana(m, u);
        if (u.carga > 0 && u.cargaTipo !== u.quiere) { u.est = 'volver0'; break; } // no mezcla cargas: descarga primero
        if (c < 0) { if (u.carga > 0) u.est = 'volver0'; else { u.est = 'espera'; u.espera = 60; } break; }
        u.celda = c; pedirRuta(m, u, (c % N) + 0.5, ((c / N) | 0) + 0.5, 0); u.est = 'ir';
        break;
      }
      case 'ir': {
        if (u.pend) break;
        const cerca = Math.hypot((u.celda % N) + 0.5 - u.x, ((u.celda / N) | 0) + 0.5 - u.y) < 0.9;
        if (cerca) { u.ruta = null; u.v = 0; u.est = 'cosechar'; break; } // basta con estar junto a la celda
        if (!u.ruta) { (u.vetadas || (u.vetadas = new Set())).add(u.celda); u.tVeto = m.t; u.est = 'espera'; u.espera = 40; break; } // no llega a esa mina (bosque por medio): prueba otra
        avanzar(m, u);
        break;
      }
      case 'cosechar': {
        u.fijo = true;
        const hay = m.mapa.mineral[u.celda];
        if (hay <= 0) { quitarMina(m, u.celda); u.est = 'buscar'; break; }
        if (u.carga === 0) u.cargaTipo = m.mapa.tipoMin[u.celda] === 2 ? 2 : 1; // la chatarra (3) cuenta como minerales
        const q = Math.min(ECON.cosecha, cap - u.carga, hay);
        m.mapa.mineral[u.celda] -= q; u.carga += q;
        if (m.mapa.mineral[u.celda] <= 0) quitarMina(m, u.celda);
        if (u.carga >= cap) u.est = 'volver0';
        break;
      }
      case 'volver0': {
        const ref = refineriaCercana(m, u);
        if (!ref) { u.est = 'espera'; u.espera = 60; break; }
        u.ref = ref.id; pedirRuta(m, u, ref.cx, ref.cy, ref.tam / 2 + 0.9); u.est = 'volver';
        break;
      }
      case 'volver': {
        if (u.pend) break;
        const ref = m.porId.get(u.ref);
        if (!ref) { u.ruta = null; u.est = 'volver0'; break; }
        if (dist(u.x, u.y, ref) <= 1.3) { u.ruta = null; u.v = 0; u.est = 'descargar'; break; }
        if (!u.ruta) { u.est = 'espera'; u.espera = 40; break; }
        avanzar(m, u);
        break;
      }
      case 'descargar': {
        u.fijo = true;
        if (!m.porId.get(u.ref)) { u.est = 'volver0'; break; }
        const q = Math.min(ECON.descarga, u.carga);
        u.carga -= q;
        if (u.cargaTipo === 2) J.raros += q; else { J.minerales += q; J.cosechado += q; }
        if (u.carga <= 0) { if (u.huye > m.t) { u.est = 'espera'; u.espera = u.huye - m.t; } else u.est = 'buscar'; } // si huía, espera a cubierto antes de volver
        break;
      }
      case 'espera':
        if (--u.espera <= 0) { u.huye = 0; u.est = u.carga >= cap ? 'volver0' : 'buscar'; }
        break;
    }
  }

  // ---------- producción ----------
  function edificiosDe(m, j, tipo) {
    const out = [];
    for (let k = 0; k < m.ents.length; k++) if (m.ents[k].j === j && m.ents[k].tipo === tipo) out.push(m.ents[k]);
    return out;
  }
  // (Escala de bonificación que se usó para las colas compartidas; hoy cada edificio y cada patio lleva su propia cola.)
  W.ritmo = function (n) { return n < 1 ? 0 : Math.min(1 + ECON.bonoProd * (n - 1), ECON.bonoMax); };
  function tickProduccion(m, j) {
    const J = m.jug[j];
    if (!J.vivo) return;
    const base = J.tr.vel, factor = base * (J.uso > J.prod ? 0.5 : 1); // el multiplicador de ADMIN; la investigación va a media velocidad si en conjunto falta energía, y cada edificio según su red
    if (m.t % ECON.goteoCada === 0) J.minerales += 1; // ingreso mínimo del patio: evita el bloqueo total
    // Investigaciones: avanzan en su edificio sin frenar obras ni unidades; si el edificio cae, se devuelve el costo.
    for (let k = J.inv.length - 1; k >= 0; k--) {
      const i = J.inv[k], t = TEC[i.clave];
      if (!J.cuenta[t.lugar]) { devolver(J, t); J.inv.splice(k, 1); continue; }
      i.prog += factor;
      if (i.prog < t.tiempo) continue;
      J.inv.splice(k, 1);
      if (t.sube) J.nivel = t.sube; else J.mejoras[i.clave] = true;
      if (i.clave === 'chalecos' || i.clave === 'reactivo') { // la vida extra llega también a las unidades ya existentes
        for (const e of m.ents) if (!e.edif && e.j === j) { const nueva = Math.round(vidaDe(J, e.tipo) * (1 + ECON.rangoVida * e.rango)); if (nueva !== e.vidaMax) { e.vida = e.vida * (nueva / e.vidaMax); e.vidaMax = nueva; } }
      }
      m.efectos.push({ tipo: 'tec', clave: i.clave, j, t: m.t });
    }
    // Cada tipo de edificio tiene su propia cola: dos del mismo tipo van uno tras otro.
    // Tipos distintos avanzan a la vez, repartiéndose la velocidad entre los que están en curso.
    // Y cada patio lleva sus propias obras: dos patios construyen a la vez.
    if (J.obras.length) {
      let primero = 0;
      for (const o of J.obras) { const p = o.patio ? m.porId.get(o.patio) : null; if (!p || p.vida <= 0) { if (!primero) { const q = m.ents.find((e) => e.edif && e.j === j && e.tipo === 'patio' && e.vida > 0); primero = q ? q.id : -1; } o.patio = primero > 0 ? primero : 0; } } // sin su patio, la obra pasa a otro
      const porPatio = new Map();
      for (const o of J.obras) {
        if (o.listo || !o.patio) continue;
        let g = porPatio.get(o.patio); if (!g) { g = { vistos: new Set(), activas: [] }; porPatio.set(o.patio, g); }
        if (!g.vistos.has(o.tipo)) { g.vistos.add(o.tipo); g.activas.push(o); }
      }
      for (const [idp, g] of porPatio) for (const o of g.activas) { const pt = m.porId.get(idp); o.prog += pt && pt.hack > m.t ? 0 : (base * (pt && pt.deficit ? 0.5 : 1)) / g.activas.length; if (o.prog >= EDIF[o.tipo].tiempo) o.listo = true; }
    }
    // Unidades: cada cuartel, fábrica y aeródromo tiene su propia cola y la despacha en orden, uno tras otro.
    // Dos edificios iguales producen a la vez. J.colas guarda el total encargado por tipo (para la IA y el cupo).
    for (const t in J.colas) { J.colas[t].prog = 0; J.colas[t].sinAgua = false; }
    for (let k = 0, total = m.ents.length; k < total; k++) {
      const fab = m.ents[k];
      if (!fab.edif || fab.j !== j || !fab.cola || !fab.cola.length || fab.vida <= 0) continue;
      const tipo = fab.cola[0], q = J.colas[tipo], cat = UNID[tipo].cat;
      {
      fab.sinAgua = J.aguaUso + (UNID[tipo].agua || 0) > J.aguaProd; // sin agua no se sostiene más tropa
      if (fab.sinAgua) { q.sinAgua = true; continue; }
      if (!fab.pago[0]) { // repetido por el bucle: se paga al empezarlo; si no alcanza, espera
        fab.sinFondos = !W.puedePagar(J, UNID[tipo]);
        if (fab.sinFondos) continue;
        cobrar(J, UNID[tipo]); fab.pago[0] = true;
      }
      fab.prog += fab.hack > m.t ? 0 : base * (fab.sinLuz ? 0.5 : 1); // hackeado: parado
      if (fab.prog > q.prog) q.prog = fab.prog;
      if (fab.prog < UNID[tipo].tiempo) continue;
      fab.cola.shift(); fab.pago.shift(); fab.prog = 0; q.n--; J.aguaUso += UNID[tipo].agua || 0;
      if (fab.bucle && (cat !== 'aire' || W.cupoAire(m, j, W.hangarDe(UNID[tipo])).hay + 1 < W.cupoAire(m, j, W.hangarDe(UNID[tipo])).cupo)) { fab.cola.push(tipo); fab.pago.push(false); q.n++; }
      const u = crearUnidad(m, j, tipo, cat === 'aire' ? Math.floor(fab.cy) * m.N + Math.floor(fab.cx) : W.cercaLibre(m, fab.cx, fab.y + fab.tam + 0.5, cat === 'veh'));
      if (cat === 'aire') { const casa = aerodromoLibre(m, u) || fab; posar(m, u, casa); } // el avión nace posado en un aeródromo con sitio
      if (fab.reunion) { // va al punto de reunión del edificio
        if (tipo === 'cosechadora') u.pref = { x: fab.reunion.x, y: fab.reunion.y };
        else if (cat === 'aire') u.patrulla = { pts: [{ x: fab.reunion.x, y: fab.reunion.y }], i: 0 }; // el punto de reunión de un aeródromo es un punto de patrulla
        else { const c = W.cercaLibre(m, fab.reunion.x, fab.reunion.y, cat === 'veh'); asignar(m, u, { t: 'mover', x: (c % m.N) + 0.5, y: ((c / m.N) | 0) + 0.5 }); }
      } else if (tipo !== 'cosechadora' && cat !== 'aire') { // se aparta de la puerta, hacia el centro del mapa
        const cx = m.N / 2 - fab.cx, cy = m.N / 2 - fab.cy, cd = Math.hypot(cx, cy) || 1;
        const c = W.cercaLibre(m, fab.cx + (cx / cd) * (fab.tam + 2), fab.cy + (cy / cd) * (fab.tam + 2), cat === 'veh');
        u.orden = 'mover'; u.dest = { x: (c % m.N) + 0.5, y: ((c / m.N) | 0) + 0.5 };
        pedirRuta(m, u, u.dest.x, u.dest.y, 0);
      }
      }
    }
  }

  // ---------- curación y atropello ----------
  // Fuera de combate, las unidades se reparan cerca de su edificio (infantería: cuartel; vehículos: fábrica;
  // todos: patio) y los edificios se reparan solos, más despacio.
  const LUGAR = { inf: 'cuartel', veh: 'fabrica', aire: 'aerodromo' }; // dónde se produce y se repara cada categoría
  W.lugarDe = (d) => d.lugar || LUGAR[d.cat]; // las unidades civiles salen de Obras civiles
  W.PRODUCE = { cuartel: true, fabrica: true, aerodromo: true, obras: true, inteligencia: true, logistica: true };
  function curar(m) {
    const talleres = [[], []];
    for (const e of m.ents) if (e.edif && (e.tipo === 'patio' || e.tipo === 'cuartel' || e.tipo === 'fabrica' || e.tipo === 'aerodromo')) talleres[e.j].push(e);
    const puestosTaller = m.puestos.filter((p) => p.tipo === 'taller' && p.dueno >= 0);
    for (const e of m.ents) {
      if (e.vida >= e.vidaMax || e.vida <= 0) continue; // los caídos en este tick no se reaniman
      const calma = m.t - (e.tDano === undefined ? -999 : e.tDano);
      // Curar cuesta minerales: recuperar toda la vida vale una fracción (curaCosto) del precio de la ficha.
      const J = m.jug[e.j], d = e.edif ? EDIF[e.tipo] : UNID[e.tipo];
      const sanar = (parte) => {
        const pv = Math.min(e.vidaMax - e.vida, e.vidaMax * parte), precio = (pv / e.vidaMax) * d.costo * ECON.curaCosto;
        if (J.minerales < precio) return false; // sin minerales no hay reparación
        J.minerales -= precio; e.vida += pv; e.curando = m.t;
        return true;
      };
      if (e.edif) { if (calma > 300) sanar(ECON.curaEdificio); continue; }
      if (calma < 100 || sinSuministro(e)) continue; // sin suministro no hay reparación
      const quiere = LUGAR[UNID[e.tipo].cat];
      if (!UNID[e.tipo].aire && puestosTaller.some((p) => p.dueno === e.j && Math.hypot(p.x - e.x, p.y - e.y) <= ECON.tallerRadio)) { sanar(ECON.curaUnidad); continue; } // taller capturado: repara a cualquiera de los suyos
      for (const b of talleres[e.j]) {
        if ((b.tipo !== 'patio' && b.tipo !== quiere) || dist(e.x, e.y, b) > 5) continue;
        sanar(ECON.curaUnidad);
        break;
      }
    }
  }
  // Vehículo de mando: mientras su jugador tenga información, los suyos a su alrededor ven en redondo y giran más rápido.
  function tickMando(m) {
    for (const e of m.ents) {
      if (e.edif || !UNID[e.tipo].mando || e.vida <= 0) continue;
      const J = m.jug[e.j];
      if (J.info <= 0) { e.sinInfo = true; continue; }
      e.sinInfo = false;
      if (m.t % ECON.mandoCada === 0) J.info--;
      const r = UNID[e.tipo].mando;
      for (const u of m.ents) { if (u.edif || Math.abs(u.x - e.x) > r || Math.hypot(u.x - e.x, u.y - e.y) > r) continue; if (u.j === e.j) u.tMando = m.t; else if (UNID[u.tipo].mini) u.tInterf = m.t; } // a los suyos los coordina; a los drones enemigos, los interfiere
    }
  }
  // Transporte: sacar a los pasajeros alrededor del vehículo (todos, o solo los supervivientes si lo han destruido).
  function apear(m, t, lista) {
    lista.forEach((p, i) => {
      const a = (i / Math.max(1, lista.length)) * TAU, c = W.cercaLibre(m, t.x + Math.cos(a) * 1.3, t.y + Math.sin(a) * 1.3);
      p.x = p.px = (c % m.N) + 0.5; p.y = p.py = ((c / m.N) | 0) + 0.5; p.dentro = false; p.sube = 0; p.orden = 'nada'; p.obj = 0; p.ruta = null; p.pend = null; p.v = 0;
      m.ents.push(p); m.porId.set(p.id, p);
    });
  }
  // Puestos neutrales: los captura la infantería que se queda junto a ellos sin enemigos cerca (el ingeniero vale por dos).
  // La antena da visión de su zona, el depósito gotea petróleo y el taller repara a los suyos.
  function tickPuestos(m) {
    for (const p of m.puestos) {
      const n = [0, 0];
      for (const e of m.gr.us) if (e.vida > 0 && UNID[e.tipo].cat === 'inf' && Math.hypot(e.x - p.x, e.y - p.y) <= ECON.capturaRadio) n[e.j] += UNID[e.tipo].repara ? 2 : 1;
      const j = n[0] && !n[1] ? 0 : n[1] && !n[0] ? 1 : -1;
      if (j >= 0 && j !== p.dueno) {
        if (p.quien !== j) { p.quien = j; p.prog = 0; }
        p.prog += 10 * Math.min(3, n[j]);
        if (p.prog >= ECON.captura) { p.dueno = j; p.prog = 0; p.quien = -1; m.efectos.push({ tipo: 'captura', x2: p.x, y2: p.y, clase: p.tipo, j, t: m.t }); }
      } else if (p.prog > 0 && !(n[0] && n[1])) { p.prog = Math.max(0, p.prog - 10); if (!p.prog) p.quien = -1; } // sin nadie, lo ganado se pierde poco a poco
      if (p.dueno >= 0 && p.tipo === 'deposito' && m.t % (ECON.depositoCada * 10) === 0) { m.jug[p.dueno].petroleo += 10; m.jug[p.dueno].extraido += 10; }
    }
  }
  // Los vehículos en marcha aplastan a la infantería enemiga que pisan: daño fuerte cada tick mientras la tienen
  // debajo. Pasarle por encima de lleno la mata; un roce solo la hiere.
  function aplastar(m) {
    const g = m.gr, C = g.C, ini = g.ini, us = g.us;
    for (let ka = 0; ka < us.length; ka++) {
      const a = us[ka];
      if (UNID[a.tipo].cat !== 'veh' || a.v < 0.03) continue;
      const gx = Math.min(C - 1, Math.max(0, (a.x / GC) | 0)), gy = Math.min(C - 1, Math.max(0, (a.y / GC) | 0));
      for (let cy = Math.max(0, gy - 1); cy <= Math.min(C - 1, gy + 1); cy++) for (let cx = Math.max(0, gx - 1); cx <= Math.min(C - 1, gx + 1); cx++) for (let kb = ini[cy * C + cx], fb = ini[cy * C + cx + 1]; kb < fb; kb++) {
        const b = us[kb];
        if (UNID[b.tipo].cat !== 'inf' || b.j === a.j || b.vida <= 0 || enTrinchera(m, b)) continue;
        const dx = b.x - a.x; if (dx > 0.5 || dx < -0.5) continue;
        const dy = b.y - a.y; if (dy > 0.5 || dy < -0.5) continue;
        const lim = UNID[a.tipo].radio + UNID[b.tipo].radio + 0.08; // la tiene debajo
        if (dx * dx + dy * dy >= lim * lim) continue;
        b.vida -= ECON.aplasta; b.tDano = m.t; b.agresor = a.id;
        if (b.vida <= 0) m.jug[a.j].aplastados = (m.jug[a.j].aplastados || 0) + 1;
      }
    }
  }

  // ---------- niebla ----------
  // Día y noche: ciclo fijo; W.luz va de 1 (día) a 0 (noche), con un minuto de transición, para el velo de la interfaz.
  W.esNoche = (m) => m.t % ECON.dia >= ECON.diaLuz;
  W.luz = (m) => { const f = m.t % ECON.dia, T2 = 600; return f < ECON.diaLuz - T2 ? 1 : f < ECON.diaLuz ? (ECON.diaLuz - f) / T2 : f < ECON.dia - T2 ? 0 : (f - (ECON.dia - T2)) / T2; };
  W.actualizarNiebla = function (m) {
    const N = m.N, NN = N * N;
    // Lo visto en la pasada anterior deja de estarlo. Se lleva la lista de esas celdas para no recorrer el mapa entero cada vez.
    if (!m.vistas) m.vistas = [0, 1].map(() => { const L = new Int32Array(NN); L.n = 0; L.todo = true; return L; });
    for (let j = 0; j < 2; j++) {
      const f = m.niebla[j], L = m.vistas[j];
      if (L.todo) { for (let i = 0; i < NN; i++) if (f[i] === 2) f[i] = 1; L.todo = false; }
      else for (let k = 0; k < L.n; k++) f[L[k]] = 1;
      L.n = 0;
    }
    const noche = W.esNoche(m) ? ECON.nocheVis : 1; // de noche las unidades ven menos (los edificios, igual)
    for (let k = 0; k < m.ents.length; k++) {
      const e = m.ents[k], f = m.niebla[e.j], L = m.vistas[e.j];
      const cx = Math.floor(posX(e)), cy = Math.floor(posY(e));
      if (e.edif) { // los edificios ven en círculo
        const r = EDIF[e.tipo].vision + e.tam / 2, r2 = r * r, R = Math.ceil(r);
        for (let dy = -R; dy <= R; dy++) {
          const y = cy + dy; if (y < 0 || y >= N) continue;
          for (let dx = -R; dx <= R; dx++) {
            const x = cx + dx; if (x < 0 || x >= N || dx * dx + dy * dy > r2) continue;
            { const q = y * N + x; if (f[q] !== 2) { f[q] = 2; L[L.n++] = q; } }
          }
        }
        continue;
      }
      // Las unidades ven cerca alrededor y lejos solo en un cono hacia su frente.
      const v = UNID[e.tipo].vision * noche, rc = v * ECON.visAt, rc2 = rc * rc, rs = v * ECON.visLado, rs2 = rs * rs, rl = v * ECON.visAd, rl2 = rl * rl, R = Math.ceil(rl);
      const ux = Math.cos(e.ang), uy = Math.sin(e.ang), campo = CAMPO[e.tipo], kc = campo.k, redondo = campo.todo || mandado(m, e);
      for (let dy = -R; dy <= R; dy++) {
        const y = cy + dy; if (y < 0 || y >= N) continue;
        for (let dx = -R; dx <= R; dx++) {
          const x = cx + dx, d2 = dx * dx + dy * dy;
          if (x < 0 || x >= N || d2 > rl2) continue;
          if (d2 > rc2 && !redondo) { // fuera del círculo cercano: al frente llega lejos, a los costados menos, detrás nada
            const p = dx * ux + dy * uy, s = p * Math.abs(p);
            if (s < kc * d2 && (d2 > rs2 || s < K_PERI * d2)) continue;
          }
          { const q = y * N + x; if (f[q] !== 2) { f[q] = 2; L[L.n++] = q; } }
        }
      }
    }
    for (let j = 0; j < 2; j++) if (m.jug[j].tr.mapa) { m.niebla[j].fill(2); m.vistas[j].todo = true; } // ADMIN: todo el mapa a la vista
    for (const p of m.puestos) { // una antena capturada da visión de su zona
      if (p.tipo !== 'antena' || p.dueno < 0) continue;
      const f = m.niebla[p.dueno], L = m.vistas[p.dueno], R = ECON.antenaRadio, px = Math.floor(p.x), py = Math.floor(p.y);
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        const x = px + dx, y = py + dy;
        if (x >= 0 && y >= 0 && x < N && y < N && dx * dx + dy * dy <= R * R) { const q = y * N + x; if (f[q] !== 2) { f[q] = 2; L[L.n++] = q; } }
      }
    }
    for (let k = m.barridos.length - 1; k >= 0; k--) { // zonas reveladas por inteligencia
      const b = m.barridos[k], f = m.niebla[b.j], L = m.vistas[b.j], R = b.r;
      if (m.t > b.hasta) { m.barridos.splice(k, 1); continue; }
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        const x = Math.floor(b.x) + dx, y = Math.floor(b.y) + dy;
        if (x >= 0 && y >= 0 && x < N && y < N && dx * dx + dy * dy <= R * R) { const q = y * N + x; if (f[q] !== 2) { f[q] = 2; L[L.n++] = q; } }
      }
    }
    m.nieblaV = (m.nieblaV || 0) + 1;
  };

  // ---------- tick ----------
  W.tick = function (m) {
    if (m.ganador >= 0) return;
    const cmds = m.cola; m.cola = [];
    for (let k = 0; k < cmds.length; k++) aplicar(m, cmds[k]);
    contar(m);
    rejilla(m);
    procesarRutas(m);
    tickProduccion(m, 0); tickProduccion(m, 1);
    for (let k = 0, n = m.ents.length; k < n; k++) {
      const e = m.ents[k];
      if (!e.edif) tickUnidad(m, e);
      else if (e.hack > m.t) { e.obj = 0; } // edificio hackeado: apagado
      else if (EDIF[e.tipo].arma) tickTorreta(m, e);
      else if (EDIF[e.tipo].da) { // extracción continua; con déficit de energía rinde la mitad
        const da = EDIF[e.tipo].da, J = m.jug[e.j];
        e.acum += (e.sinLuz ? 0.5 : 1) * (e.tipo === 'estacion' && J.mejoras.analisis ? 1.5 : 1) * bonoE(e);
        if (e.acum >= da.cada) { e.acum -= da.cada; J[da.rec]++; if (da.rec === 'petroleo') J.extraido++; }
      }
    }
    separar(m);
    aplastar(m);
    tickProyectiles(m);
    tickMisiles(m);
    if (m.t % 10 === 0) { curar(m); colmena(m); }

    if (m.redSucia || !m.cob || m.t - m.redT >= 100) calcularRed(m);
    if (m.t % 10 === 0) { tickTrincheras(m); tickCamaras(m); tickPortadores(m); tickPuenteAereo(m); tickEspias(m); }
    if (m.minasT && m.minasT.length && m.t % 2 === 0) tickMinas(m);
    if (m.t % 10 === 0 && m.logistica !== false) { // suministro: fuera de la cobertura el contador sube; dentro, baja rápido. Los aviones repostan en su base: no cuenta.
      const pts = tickSuministro(m);
      for (const u of m.ents) { if (u.edif || UNID[u.tipo].aire || UNID[u.tipo].suministro) continue; let dentro = m.cob[u.j][Math.floor(u.y) * m.N + Math.floor(u.x)] || m.jug[u.j].dios;
        if (!dentro) for (const q of pts) if (q.j === u.j && (u.x - q.x) * (u.x - q.x) + (u.y - q.y) * (u.y - q.y) <= q.r2) { dentro = 1; q.u.sumiN++; break; } /* fuera de la red, pero junto a un camión o helicóptero de suministro plantado: gasta de su carga */
        u.sinSum = dentro ? Math.max(0, (u.sinSum || 0) - 40) : Math.min(ECON.sinSum + 200, (u.sinSum || 0) + 10); }
    }
    let muertos = false;
    const apeados = [];
    for (let k = 0; k < m.ents.length; k++) {
      const e = m.ents[k];
      if (e.vida > 0) continue;
      muertos = true; m.porId.delete(e.id);
      if (e.desplegado) continue; // el patio móvil no muere: se ha convertido en patio
      if (e.muro) { if (!e.quitado) { quitarMuro(m, e.celda); m.efectos.push({ tipo: 'muerte', x2: e.cx, y2: e.cy, edif: true, tam: 1, clase: 'muro', ang: 0, j: e.j, t: m.t }); } continue; }
      if (e.infra) { quitarTramo(m, e); m.efectos.push({ tipo: e.vendido ? 'venta' : 'muerte', x2: e.cx, y2: e.cy, edif: true, tam: 1, clase: 'camino', ang: 0, j: e.j, t: m.t }); continue; }
      if (e.retirado) continue; // el helicóptero que ya ha cumplido se va sin más
      m.jug[e.j].bajas++;
      if (!e.edif && e.pasajeros.length) { // del transporte destruido sale la mitad de su carga
        const vivos = e.pasajeros.filter((p, i) => i % 2 === 0);
        m.jug[e.j].bajas += e.pasajeros.length - vivos.length; e.pasajeros = [];
        apeados.push([e, vivos]);
      }
      if (!e.edif && UNID[e.tipo].cat === 'veh') { // el vehículo destruido deja chatarra que las cosechadoras reciclan
        const c = Math.floor(e.y) * m.N + Math.floor(e.x), tm = m.mapa.tipoMin[c];
        if (m.paso[c] && !m.ocup[c] && !m.mapa.sitioEn[c] && tm !== 2) {
          if (!tm) { m.mapa.tipoMin[c] = 3; m.minas.push(c); }
          m.mapa.mineral[c] += Math.round(UNID[e.tipo].costo * ECON.chatarra);
        }
      }
      m.efectos.push({ tipo: e.vendido ? 'venta' : 'muerte', x2: posX(e), y2: posY(e), edif: e.edif, tam: e.tam || 0, clase: e.tipo, ang: e.ang || 0, j: e.j, t: m.t });
      if (e.edif) {
        const N = m.N;
        e.cola.forEach((t, i) => { if (e.pago[i]) devolver(m.jug[e.j], UNID[t]); m.jug[e.j].colas[t].n--; }); // lo que tenía encargado (y pagado) se devuelve
        e.cola.length = 0;
        for (let dy = 0; dy < e.tam; dy++) for (let dx = 0; dx < e.tam; dx++) { const i = (e.y + dy) * N + e.x + dx; m.ocup[i] = 0; m.paso[i] = 1; m.pasoV[i] = 1; }
        if (e.tam === 1 && m.muro && m.muro[e.y * N + e.x] >= 2) { m.paso[e.y * N + e.x] = 0; m.pasoV[e.y * N + e.x] = 0; } // debajo sigue el muro
      }
    }
    if (muertos) {
      m.ents = m.ents.filter((e) => e.vida > 0); m.redSucia = true;
      for (const [t, vivos] of apeados) apear(m, t, vivos);
      contar(m);
      for (const J of m.jug) if (!J.cuenta.patio && !J.cuenta.patioMovil) J.vivo = false; // se pierde al quedarse sin patios (ni patio móvil que desplegar)
      if (!m.jug[0].vivo || !m.jug[1].vivo) m.ganador = m.jug[0].vivo ? 0 : m.jug[1].vivo ? 1 : 2;
    }
    if (m.t % 10 === 0) { tickPuestos(m); tickMando(m); }
    if (m.t % 4 === 0 && m.marchas) tickMarchas(m);
    if (m.embarques.length) { // la infantería que ha llegado a su transporte entra en él y deja el mapa
      for (const u of m.embarques) {
        const t = m.porId.get(u.sube);
        if (t && t.vida > 0 && u.vida > 0 && t.pasajeros.length < UNID[t.tipo].plazas) { u.dentro = true; u.sube = 0; u.ruta = null; u.v = 0; t.pasajeros.push(u); m.porId.delete(u.id); }
        else u.sube = 0;
      }
      m.embarques.length = 0;
      m.ents = m.ents.filter((e) => !e.dentro);
      contar(m);
    }
    if (m.efectos.length && m.efectos[0].t < m.t - 4) m.efectos = m.efectos.filter((f) => f.t >= m.t - 4);
    if (m.t % 4 === 0) W.actualizarNiebla(m);
    m.t++;
  };

  // Resumen numérico del estado, para comprobar determinismo.
  W.huella = function (m) {
    let h = m.t + m.jug[0].minerales * 3 + m.jug[1].minerales * 7;
    for (const e of m.ents) h = (h * 31 + e.id * 17 + Math.round(posX(e) * 1000) + Math.round(posY(e) * 1000) * 3 + Math.round(e.vida * 10)) % 2147483647;
    return h;
  };
})();
