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
      obras: [], // [{ tipo, prog, listo }]: varias a la vez, se reparten la velocidad
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
      ocup: new Int32Array(NN), paso: new Uint8Array(NN),
      jug: [nuevoJugador(op.inicio), nuevoJugador(op.inicio)],
      niebla: [new Uint8Array(NN), new Uint8Array(NN)],
      cola: [], colaRutas: [], efectos: [], proy: [], barridos: [], trincheras: new Map(), focos: [[], []], sigFoco: 1, sigMision: 1, minas: [], raros: [], ganador: -1,
      ruta: W.crearRuta(N),
    };
    for (let i = 0; i < NN; i++) {
      m.paso[i] = mapa.terreno[i] === T.LLANO || mapa.terreno[i] === T.BOSQUE ? 1 : 0;
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
    for (let dy = 0; dy < d.tam; dy++) for (let dx = 0; dx < d.tam; dx++) { const i = (y + dy) * N + x + dx; m.ocup[i] = e.id; m.paso[i] = 0; }
    m.ents.push(e); m.porId.set(e.id, e);
    return e;
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
      cola: [], patrulla: null, explora: false, // órdenes encadenadas, ruta de patrulla, exploración automática
      retira: m.jug[j].retiro, retirando: false, volver: null, tRet: 0, huye: 0, // retirada automática a reparar; cosechadora que huye
      bajas: 0, rango: 0, // veteranía
    };
    m.ents.push(u); m.porId.set(u.id, u);
    m.jug[j].producidas++;
    return u;
  }
  W.crearEdificio = crearEdificio; W.crearUnidad = crearUnidad;

  W.cercaLibre = function (m, x, y) {
    const N = m.N, cx = Math.max(0, Math.min(N - 1, Math.floor(x))), cy = Math.max(0, Math.min(N - 1, Math.floor(y)));
    for (let k = 0; k < ESPIRAL.length; k++) {
      const xx = cx + ESPIRAL[k][0], yy = cy + ESPIRAL[k][1];
      if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue;
      if (m.paso[yy * N + xx]) return yy * N + xx;
    }
    return cy * N + cx;
  };

  // Disponible = tiene los edificios requeridos y el nivel tecnológico.
  W.disponible = function (m, j, d) { return W.tieneReq(m, j, d.req) && (d.nivel || 1) <= m.jug[j].nivel; };
  W.tieneReq = function (m, j, req) {
    const c = m.jug[j].cuenta;
    if (m.jug[j].admin) return true; // modo ADMIN: sin requisitos
    for (let k = 0; k < req.length; k++) if (!c[req[k]]) return false;
    return true;
  };

  W.puedeColocar = function (m, j, tipo, x, y) {
    const d = EDIF[tipo], N = m.N, t = d.tam;
    if (x < 0 || y < 0 || x + t > N || y + t > N) return false;
    let sitio = false;
    for (let dy = 0; dy < t; dy++) for (let dx = 0; dx < t; dx++) {
      const i = (y + dy) * N + x + dx;
      if (m.mapa.terreno[i] !== T.LLANO || m.ocup[i] || m.mapa.mineral[i]) return false;
      if (m.mapa.sitioEn[i]) { if (!d.sobre || m.mapa.sitioTipo.get(i) !== d.sobre) return false; sitio = true; }
    }
    if (d.sobre && !sitio) return false; // debe cubrir su yacimiento o su campo
    if (d.juntoA === 'agua') { // debe tener agua a dos celdas o menos
      let agua = false;
      for (let yy = Math.max(0, y - 2); yy < Math.min(N, y + t + 2) && !agua; yy++) for (let xx = Math.max(0, x - 2); xx < Math.min(N, x + t + 2); xx++) if (m.mapa.terreno[yy * N + xx] === T.AGUA) { agua = true; break; }
      if (!agua) return false;
    }
    if (d.libre && !m.niebla[j][y * N + x]) return false; // solo en terreno explorado
    let junto = !!d.libre || m.jug[j].admin; // en modo ADMIN se construye en cualquier parte
    const s = ECON.separacionColocar;
    for (let k = 0; k < m.ents.length; k++) {
      const e = m.ents[k];
      if (e.edif) {
        if (e.j !== j || junto) continue;
        const gx = Math.max(e.x - (x + t), x - (e.x + e.tam), 0), gy = Math.max(e.y - (y + t), y - (e.y + e.tam), 0);
        if (Math.max(gx, gy) <= s) junto = true;
      } else if (e.x > x - 0.3 && e.x < x + t + 0.3 && e.y > y - 0.3 && e.y < y + t + 0.3) return false;
    }
    return junto;
  };

  // Distancia de un punto a una entidad (al borde, si es edificio).
  function dist(x, y, e) {
    if (!e.edif) return Math.hypot(e.x - x, e.y - y);
    const dx = Math.max(e.x - x, 0, x - (e.x + e.tam)), dy = Math.max(e.y - y, 0, y - (e.y + e.tam));
    return Math.hypot(dx, dy);
  }
  const posX = (e) => (e.edif ? e.cx : e.x), posY = (e) => (e.edif ? e.cy : e.y);
  W.dist = dist;

  function contar(m) {
    for (let j = 0; j < 2; j++) { const J = m.jug[j]; J.prod = 0; J.uso = 0; J.aguaProd = 0; J.aguaUso = 0; J.cuenta = {}; }
    for (let k = 0; k < m.ents.length; k++) {
      const e = m.ents[k], J = m.jug[e.j];
      J.cuenta[e.tipo] = (J.cuenta[e.tipo] || 0) + 1;
      if (e.edif) {
        const d = EDIF[e.tipo], en = d.energia;
        if (en > 0) J.prod += en * (J.mejoras.turbinas ? 1.5 : 1); else J.uso -= en;
        J.aguaProd += (d.agua || 0) * (e.tipo === 'bomba' && J.mejoras.depuracion ? 1.5 : 1);
      }
      else J.aguaUso += UNID[e.tipo].agua || 0;
    }
    for (let j = 0; j < 2; j++) {
      const J = m.jug[j];
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
  W.orden = function (m, cmd) { m.cola.push(cmd); };

  function pedirRuta(m, u, x, y, radio) {
    if (UNID[u.tipo].aire) { // un avión no busca camino: va en línea recta
      const casa = u.casa ? m.porId.get(u.casa) : null, rv = UNID[u.tipo].radioVuelo;
      if (casa) { const ax = x - casa.cx, ay = y - casa.cy, ad = Math.hypot(ax, ay); if (ad > rv) { x = casa.cx + (ax / ad) * rv; y = casa.cy + (ay / ad) * rv; } } // no se aleja más que su radio de vuelo
      const N = m.N, cx = Math.max(0.5, Math.min(N - 0.5, x)), cy = Math.max(0.5, Math.min(N - 0.5, y));
      u.ruta = [Math.floor(cy) * N + Math.floor(cx)]; u.ri = 0; u.fin = { x: cx, y: cy }; u.pend = null; u.meta = { x, y, radio };
      return;
    }
    if (!u.pend) m.colaRutas.push(u.id);
    u.pend = { x, y, radio }; u.meta = u.pend;
  }

  function propias(m, cmd) {
    const out = [];
    for (let k = 0; k < cmd.ids.length; k++) { const u = m.porId.get(cmd.ids[k]); if (u && !u.edif && u.j === cmd.j) { u.retirando = false; u.volver = null; u.noRetira = true; out.push(u); } } // una orden directa anula la retirada (hasta que se repare)
    return out;
  }
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
      for (let i = 0; i < orden.length; i++) {
        const px = x + ps[i][0] * c - ps[i][1] * s, py = y + ps[i][0] * s + ps[i][1] * c, cel = W.cercaLibre(m, px, py);
        const libre = px >= 0 && py >= 0 && px < m.N && py < m.N && (aire || m.paso[Math.floor(py) * m.N + Math.floor(px)]);
        fn(orden[i], libre ? px : (cel % m.N) + 0.5, libre ? py : ((cel / m.N) | 0) + 0.5);
        orden[i].tope = tope; orden[i].angFin = rumbo;
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
    u.orden = o.t; u.obj = 0; u.dest = { x: o.x, y: o.y }; u.ruta = null; u.tope = 0; u.angFin = null; u.guardia = false;
    pedirRuta(m, u, o.x, o.y, 0);
    return true;
  }
  function encargar(m, u, o, enc) {
    if (enc && !u.patrulla && (u.orden !== 'nada' || u.cola.length)) { if (u.cola.length < 16) u.cola.push(o); return; }
    limpiar(u); asignar(m, u, o);
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
      const p = u.patrulla; p.i = (p.i + 1) % p.pts.length;
      if (UNID[u.tipo].aire && p.pts.length === 1) { // patrulla aérea sobre un punto: da vueltas a su alrededor
        p.a = (p.a === undefined ? u.id * 2.4 : p.a) + 0.8; // cada avión entra en la órbita por un punto distinto, para no ir encimados
        asignar(m, u, { t: 'amover', x: p.pts[0].x + Math.cos(p.a) * ECON.orbita, y: p.pts[0].y + Math.sin(p.a) * ECON.orbita });
      } else asignar(m, u, { t: 'amover', x: p.pts[p.i].x, y: p.pts[p.i].y });
    } else if (u.explora) {
      const c = celdaSinExplorar(m, u);
      if (c < 0) u.explora = false; else asignar(m, u, { t: 'mover', x: (c % m.N) + 0.5, y: ((c / m.N) | 0) + 0.5 });
    }
  }

  function aplicar(m, cmd) {
    const J = m.jug[cmd.j];
    if (!J || !J.vivo) return;
    if (cmd.ids && (cmd.t === 'mover' || cmd.t === 'amover' || cmd.t === 'atacar' || cmd.t === 'patrulla')) { // misma orden, misma misión
      const mision = m.sigMision++;
      for (const id of cmd.ids) { const u = m.porId.get(id); if (u && !u.edif && u.j === cmd.j) u.mision = mision; }
    }
    switch (cmd.t) {
      case 'dios': // modo GOD: recursos infinitos; al apagarlo vuelve el saldo anterior
        J.dios = !J.dios;
        if (J.dios) J.antesDios = [J.minerales, J.petroleo, J.raros, J.info]; else [J.minerales, J.petroleo, J.raros, J.info] = J.antesDios;
        return;
      case 'admin': // modo ADMIN, para probar: todo lo de GOD más nivel 3, todas las mejoras, sin requisitos, todo cuatro veces más rápido (300 % más) y el mapa a la vista
        J.admin = !J.admin;
        if (J.admin !== J.dios) { J.dios = J.admin; if (J.dios) J.antesDios = [J.minerales, J.petroleo, J.raros, J.info]; else [J.minerales, J.petroleo, J.raros, J.info] = J.antesDios; }
        if (J.admin) {
          J.nivel = 3;
          for (const k in TEC) if (!TEC[k].sube) J.mejoras[k] = true;
          for (const e of m.ents) if (!e.edif && e.j === cmd.j) { const nueva = Math.round(vidaDe(J, e.tipo) * (1 + ECON.rangoVida * e.rango)); if (nueva !== e.vidaMax) { e.vida = e.vida * (nueva / e.vidaMax); e.vidaMax = nueva; } }
        }
        return;
      case 'construir': {
        const d = EDIF[cmd.tipo];
        if (!d || cmd.tipo === 'patio' || J.obras.length >= ECON.obrasMax || !W.disponible(m, cmd.j, d) || !W.puedePagar(J, d)) return;
        cobrar(J, d); J.obras.push({ tipo: cmd.tipo, prog: 0, listo: false });
        return;
      }
      case 'cancelarEdif': { // cancela la obra más reciente de ese tipo (primero las que siguen en curso) y devuelve su costo
        let i = -1;
        for (let k = J.obras.length - 1; k >= 0; k--) if (J.obras[k].tipo === cmd.tipo && (i < 0 || (J.obras[i].listo && !J.obras[k].listo))) i = k;
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
      case 'entrenar': {
        const d = UNID[cmd.tipo];
        if (!d || !W.disponible(m, cmd.j, d) || !W.puedePagar(J, d)) return;
        if (d.aire) { const c = W.cupoAire(m, cmd.j); if (c.hay >= c.cupo) return; } // cada aeródromo aloja un número limitado de aviones
        // Va a la cola de un edificio: de los indicados (cmd.ids) o de todos los del tipo, el que la tenga más corta.
        let fab = null;
        for (const e of m.ents) {
          if (!e.edif || e.j !== cmd.j || e.tipo !== LUGAR[d.cat] || e.vida <= 0 || e.cola.length >= ECON.colaMax) continue;
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
        destinos(m, propias(m, cmd), cmd.x, cmd.y, (u, x, y) => encargar(m, u, { t: 'mover', x, y }, cmd.enc && u.tipo !== 'cosechadora'), cmd.forma, cmd.rumbo);
        return;
      case 'amover':
        destinos(m, propias(m, cmd).filter((u) => UNID[u.tipo].arma), cmd.x, cmd.y, (u, x, y) => encargar(m, u, { t: 'amover', x, y }, cmd.enc), cmd.forma, cmd.rumbo);
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
        if (!it || !J.cuenta.estacion || J.nivel < it.nivel || J.info < it.info) return;
        J.info -= it.info;
        if (cmd.clave === 'barrido') m.barridos.push({ j: cmd.j, x: cmd.x, y: cmd.y, r: it.radio, hasta: m.t + it.dura });
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
        if (e && e.edif && e.j === cmd.j && (e.tipo === 'cuartel' || e.tipo === 'fabrica' || e.tipo === 'aerodromo')) e.reunion = { x: cmd.x, y: cmd.y };
        return;
      }
      case 'detener':
        for (const u of propias(m, cmd)) { limpiar(u); u.orden = 'nada'; u.obj = 0; u.ruta = null; u.pend = null; if (u.tipo === 'cosechadora') u.est = 'quieto'; }
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
    if (!d.aire && !m.paso[c]) { replantear(); return false; } // alguien construyó en el punto de paso
    const vel = d.vel * (d.cat === 'veh' && m.jug[u.j].mejoras.motores ? 1.15 : 1);
    const vmax = (u.tope && u.tope < vel ? u.tope : vel) * (d.cat === 'veh' && m.mapa.terreno[Math.floor(u.y) * N + Math.floor(u.x)] === T.BOSQUE ? ECON.bosqueVeh : 1); // el bosque frena a los vehículos, no a la tropa a pie
    const alFinal = u.ri === u.ruta.length - 1 && u.fin;
    const tx = alFinal ? u.fin.x : (c % N) + 0.5, ty = alFinal ? u.fin.y : ((c / N) | 0) + 0.5, dx = tx - u.x, dy = ty - u.y, dd = Math.hypot(dx, dy);
    let alin = 1;
    if (dd > 0.4) { // muy cerca del punto ya no exige alinearse: evita quedarse pivotando si lo empujan
      const meta = Math.atan2(dy, dx);
      let dif = ((meta - u.ang + Math.PI) % TAU + TAU) % TAU - Math.PI;
      if (Math.abs(dif) <= d.giro) { u.ang = meta; dif = 0; } else { u.ang += Math.sign(dif) * d.giro; dif -= Math.sign(dif) * d.giro; }
      alin = Math.cos(dif);
    }
    const ultimo = u.ri === u.ruta.length - 1;
    const planea = d.aire && !u.obj; // un avión en ruta no se detiene: vira en marcha y da por alcanzado el punto al pasar cerca
    let obj = planea ? vmax * Math.max(0.6, alin) : alin > 0.6 ? vmax * alin : 0; // muy desalineado: pivota en el sitio
    if (ultimo && !planea) obj = Math.min(obj, 0.02 + dd * 0.12); // frena al llegar
    if (planea && ultimo && dd <= 1.5) { u.ruta = null; return true; }
    u.v = u.v < obj ? Math.min(obj, u.v + d.acel) : Math.max(obj, u.v - d.acel * 2);
    if (ultimo && dd <= 0.25) { u.ruta = null; u.v = 0; return true; } // en el destino basta con quedar cerca
    if (dd <= Math.max(u.v, 0.02)) { u.x = tx; u.y = ty; u.ri++; return false; }
    const nx = u.x + (dx / dd) * u.v, ny = u.y + (dy / dd) * u.v;
    if (!d.aire && m.ocup[Math.floor(ny) * N + Math.floor(nx)] && m.t - u.tReplan > 10) { replantear(); return false; } // edificio nuevo en medio del tramo
    u.x = nx; u.y = ny;
    return false;
  }

  // ¿Hay paso en línea recta, con el ancho de una unidad?
  function despejado(m, x0, y0, x1, y1) {
    const N = m.N, dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy);
    if (L < 1e-6) return true;
    const n = Math.ceil(L / 0.25), ox = (-dy / L) * 0.3, oy = (dx / L) * 0.3;
    for (let i = 0; i <= n; i++) {
      const x = x0 + (dx * i) / n, y = y0 + (dy * i) / n;
      if (!m.paso[(y | 0) * N + (x | 0)] || !m.paso[((y + oy) | 0) * N + ((x + ox) | 0)] || !m.paso[((y - oy) | 0) * N + ((x - ox) | 0)]) return false;
    }
    return true;
  }
  // Quita los zigzags de la rejilla: salta al punto más lejano que se alcanza en línea recta.
  function suavizar(m, x, y, ruta) {
    const N = m.N, out = [];
    let ax = x, ay = y, i = 0;
    while (i < ruta.length) {
      let j = i;
      const tope = Math.min(ruta.length - 1, i + 24);
      for (let k = i + 1; k <= tope; k++) {
        const c = ruta[k];
        if (despejado(m, ax, ay, (c % N) + 0.5, ((c / N) | 0) + 0.5)) j = k; else if (k - j > 4) break;
      }
      out.push(ruta[j]); ax = (ruta[j] % N) + 0.5; ay = ((ruta[j] / N) | 0) + 0.5; i = j + 1;
    }
    return out;
  }

  function procesarRutas(m) {
    const N = m.N;
    let n = 0;
    while (m.colaRutas.length && n < 12) {
      const u = m.porId.get(m.colaRutas.shift());
      if (!u || !u.pend) continue;
      const p = u.pend; u.pend = null; n++;
      const camino = m.ruta(m.paso, m.mapa.terreno, Math.floor(u.x), Math.floor(u.y), p.x, p.y, p.radio);
      if (camino) {
        u.fin = null;
        if (p.radio === 0) { // destino exacto: el último tramo va al punto pedido, no al centro de su celda
          const cf = Math.floor(p.y) * N + Math.floor(p.x);
          if (p.x >= 0 && p.y >= 0 && p.x < N && p.y < N && m.paso[cf]) { if (camino[camino.length - 1] !== cf) camino.push(cf); u.fin = { x: p.x, y: p.y }; }
        }
        u.ruta = suavizar(m, u.x, u.y, camino); u.ri = 0;
      } else { u.ruta = null; u.fallo = true; }
    }
  }

  function separar(m) {
    const N = m.N, us = [];
    for (let k = 0; k < m.ents.length; k++) if (!m.ents[k].edif) us.push(m.ents[k]);
    for (let a = 0; a < us.length; a++) {
      const A = us[a], ra = UNID[A.tipo].radio;
      for (let b = a + 1; b < us.length; b++) {
        const B = us[b];
        if (A.enTierra || B.enTierra) continue; // los aviones posados tienen su sitio
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
    function mover(u, dx, dy) {
      if (!dx && !dy) return;
      const nx = u.x + dx, ny = u.y + dy;
      if (nx < 0.3 || ny < 0.3 || nx > N - 0.3 || ny > N - 0.3) return;
      if (UNID[u.tipo].aire || m.paso[Math.floor(ny) * N + Math.floor(nx)]) { u.x = nx; u.y = ny; }
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
    const v = UNID[a.tipo].vision;
    const dx = posX(e) - a.x, dy = posY(e) - a.y;
    const q = trincheraDe(m, a);
    if (q && Math.abs(difAng(Math.atan2(dy, dx), q.ang)) > ECON.arcoTrinchera) return false; // desde la trinchera solo se cubre su frente
    if (d <= v * ECON.visAt) return true;
    if (d > v * ECON.visAd) return false;
    if (CAMPO[a.tipo].todo) return true;
    const c = (dx * Math.cos(a.ang) + dy * Math.sin(a.ang)) / (Math.hypot(dx, dy) || 1); // coseno del ángulo respecto al frente
    return c >= CAMPO[a.tipo].cos || (c >= COS_PERI && d <= v * ECON.visLado);
  }
  // Apunta el arma al blanco y dice si ya puede disparar. Con torreta gira solo la torreta; sin ella, el cuerpo entero
  // (y solo si está quieto: en marcha el cuerpo sigue el camino). Desde una trinchera no se sale de su arco frontal.
  function apuntar(m, a, o, quieto) {
    const meta = Math.atan2(posY(o) - posY(a), posX(o) - posX(a));
    if (a.edif) { a.angT = girarHacia(a.angT, meta, EDIF[a.tipo].giroT); return Math.abs(difAng(meta, a.angT)) <= ECON.arco; }
    const d = UNID[a.tipo];
    if (ARMAS[d.arma].omni) return true;
    a.apunto = true;
    if (d.giroT) { a.angT = girarHacia(a.angT, meta, d.giroT); return Math.abs(difAng(meta, a.angT)) <= ECON.arco; }
    const q = trincheraDe(m, a);
    if (q && Math.abs(difAng(meta, q.ang)) > ECON.arcoTrinchera) return false;
    if (quieto) a.ang = girarHacia(a.ang, meta, d.giro);
    return Math.abs(difAng(meta, a.ang)) <= (d.arco || ECON.arco);
  }
  W.sector = (m, a, e) => { // 0 frente, 1 costado, 2 espalda: desde dónde le llega a "a" algo situado en "e"
    const rel = Math.abs(difAng(Math.atan2(e.y - a.y, e.x - a.x), a.ang));
    return rel > 2.094 ? 2 : rel > 1.047 ? 1 : 0;
  };

  function buscarEnemigo(m, a, x, y, rango) {
    const arma = ARMAS[a.edif ? EDIF[a.tipo].arma : UNID[a.tipo].arma];
    let mejor = null, md = rango;
    for (let k = 0; k < m.ents.length; k++) {
      const e = m.ents[k];
      if (e.j === a.j || e.vida <= 0 || !puede(arma, e)) continue;
      const d = dist(x, y, e);
      if (d > md) continue;
      if (!a.edif) { // una unidad solo detecta por sí misma lo que cae en su visión; el arma indirecta, lo que vea cualquiera de los suyos
        if (arma.indirecto ? m.niebla[a.j][Math.floor(posY(e)) * m.N + Math.floor(posX(e))] !== 2 : !veDir(m, a, e, d)) continue;
      }
      md = d; mejor = e;
    }
    return mejor;
  }

  // Atrincherada: infantería quieta sobre una trinchera. Recibe menos daño y no puede ser atropellada.
  function enTrinchera(m, b) { return !b.edif && b.orden === 'nada' && UNID[b.tipo].cat === 'inf' && m.trincheras.has(Math.floor(b.y) * m.N + Math.floor(b.x)); }
  W.enTrinchera = enTrinchera;
  function trincheraDe(m, b) { return enTrinchera(m, b) ? m.trincheras.get(Math.floor(b.y) * m.N + Math.floor(b.x)) : null; }
  // El bosque cubre a la infantería (recibe menos daño) y frena a los vehículos.
  function enBosque(m, b) { return !b.edif && !UNID[b.tipo].aire && m.mapa.terreno[Math.floor(b.y) * m.N + Math.floor(b.x)] === T.BOSQUE; }
  W.enBosque = enBosque;
  // ox, oy: de dónde viene el tiro. A un vehículo le duele más por los costados y más aún por la espalda.
  function herir(m, b, arma, mult, de, ox, oy) {
    if (!puede(arma, b)) return;
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
        if (e.j !== j || e.tDano === undefined || m.t - e.tDano > 40 || !e.agresor) continue;
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
          if (u.j !== j || u.edif || u.acude || u.guardia || u.retirando || u.vida <= 0 || vict.has(u.id) || !UNID[u.tipo].arma) continue;
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
    a.recarga = arma.recarga;
    if (arma.vuelo) { // obús: vuela hasta donde estaba el blanco al disparar
      m.proy.push({ ox: ax, oy: ay, x: ax, y: ay, px: ax, py: ay, tx: bx, ty: by, obj: b.id, j: a.j, arma: clave, mult, de: a.id });
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
      p.px = p.x; p.py = p.y;
      if (dd > arma.vuelo) { p.x += (dx / dd) * arma.vuelo; p.y += (dy / dd) * arma.vuelo; continue; }
      let acierto = false;
      if (arma.area) { // explosión: daña a todo enemigo dentro del radio
        for (const e of m.ents) if (e.j !== p.j && e.vida > 0 && dist(p.tx, p.ty, e) <= arma.area) { herir(m, e, arma, p.mult, p.de); acierto = true; }
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
    if (J.uso > J.prod) { e.obj = 0; return; } // sin energía, apagada
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
      if (!e.edif || e.j !== u.j || e.tipo !== 'aerodromo' || e.vida <= 0) continue;
      const dd = Math.hypot(e.cx - u.x, e.cy - u.y);
      if (dd < md && avionesDe(m, e) - (u.casa === e.id ? 1 : 0) < ECON.cupoAviones) { md = dd; mejor = e; }
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
  W.cupoAire = function (m, j) {
    const J = m.jug[j]; let hay = 0;
    for (const t in UNID) if (UNID[t].aire) hay += (J.cuenta[t] || 0) + J.colas[t].n;
    return { hay, cupo: ECON.cupoAviones * (J.cuenta.aerodromo || 0) };
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
    const conOrden = u.orden !== 'nada' || u.obj || u.cola.length > 0 || !!u.patrulla || u.acude;
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

  // Ingeniero: cada medio segundo elige el vehículo o edificio propio dañado más cercano; va hasta él y lo repara, gratis
  // y también en pleno combate. En guardia (fijo) solo repara lo que tiene al alcance de la mano.
  function tickIngeniero(m, u) {
    let o = u.arregla ? m.porId.get(u.arregla) : null;
    if (o && (o.vida <= 0 || o.vida >= o.vidaMax)) { o = null; u.arregla = 0; u.ruta = null; }
    if (!o && (m.t + u.id) % 10 === 0) {
      let md = u.guardia ? 1.6 : ECON.reparaRadio;
      for (const e of m.ents) {
        if (e.j !== u.j || e.vida >= e.vidaMax || e.vida <= 0 || e.enTierra || (!e.edif && UNID[e.tipo].cat !== 'veh')) continue;
        const dd = dist(u.x, u.y, e);
        if (dd < md) { md = dd; o = e; }
      }
      if (o) { u.arregla = o.id; u.ruta = null; u.pend = null; }
    }
    if (!o) return;
    if (dist(u.x, u.y, o) <= 1.6) {
      u.ruta = null; u.v = 0; u.ang = Math.atan2(posY(o) - u.y, posX(o) - u.x);
      o.vida = Math.min(o.vidaMax, o.vida + (o.edif ? ECON.reparaEdif : ECON.reparaVeh)); o.curando = m.t;
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
    if (d.aire && tickVuelo(m, u)) return;
    if (u.tipo === 'cosechadora') { tickCosechadora(m, u); return; }
    if (d.giroT) { if (!u.apunto) u.angT = girarHacia(u.angT, u.ang, d.giroT); } else u.angT = u.ang; // sin blanco, la torreta vuelve al frente
    u.apunto = false;
    if (u.fallo) { u.fallo = false; u.orden = 'nada'; u.obj = 0; limpiar(u); }
    if (u.orden === 'nada' && !u.obj && !u.acude && (u.cola.length || u.patrulla || u.explora)) siguienteOrden(m, u);
    if (u.orden === 'nada' && !u.obj && u.angFin != null) { // en su puesto, se encara como el resto de la formación
      const dif = ((u.angFin - u.ang + Math.PI) % TAU + TAU) % TAU - Math.PI;
      if (Math.abs(dif) <= d.giro) { u.ang = u.angFin; u.angFin = null; } else u.ang += Math.sign(dif) * d.giro;
    }
    if (u.cava > 0) { // cavando: al terminar queda la trinchera en esa celda, para quien la ocupe
      if (u.orden !== 'nada') u.cava = 0;
      else if ((u.cava -= d.cavaRapido ? 2 : 1) <= 0) m.trincheras.set(Math.floor(u.y) * m.N + Math.floor(u.x), { x: Math.floor(u.x) + 0.5, y: Math.floor(u.y) + 0.5, ang: u.ang });
    }
    if (!d.aire && (u.retira || u.retirando)) retirada(m, u);
    if (!d.arma) { // sin arma: solo se mueve; el ingeniero, además, repara lo que tenga cerca
      if (u.orden === 'atacar') { u.orden = 'nada'; u.obj = 0; }
      if (u.orden !== 'nada') { u.arregla = 0; if (avanzar(m, u) || (!u.ruta && !u.pend)) u.orden = 'nada'; return; }
      if (d.repara) tickIngeniero(m, u);
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
    if (u.quiere === 2 && !m.raros.length) u.quiere = 1; // se acabaron los raros: vuelve a los minerales
    const lista = u.quiere === 2 ? m.raros : m.minas;
    let mejor = -1, md = Infinity;
    for (let k = 0; k < lista.length; k++) {
      const c = lista[k];
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
        if (!u.ruta) { u.est = 'espera'; u.espera = 40; break; }
        avanzar(m, u);
        break;
      }
      case 'cosechar': {
        u.fijo = true;
        const hay = m.mapa.mineral[u.celda];
        if (hay <= 0) { quitarMina(m, u.celda); u.est = 'buscar'; break; }
        if (u.carga === 0) u.cargaTipo = m.mapa.tipoMin[u.celda] || 1;
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
  // Varios patios aceleran las obras: +50 % por cada uno extra, hasta ×2,5. (Las unidades no: cada edificio tiene su cola.)
  W.ritmo = function (n) { return n < 1 ? 0 : Math.min(1 + ECON.bonoProd * (n - 1), ECON.bonoMax); };
  function tickProduccion(m, j) {
    const J = m.jug[j];
    if (!J.vivo) return;
    const factor = J.admin ? 4 : J.uso > J.prod ? 0.5 : 1; // déficit de energía: todo a media velocidad
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
    const vistos = new Set(), activas = [];
    for (const o of J.obras) if (!o.listo && !vistos.has(o.tipo)) { vistos.add(o.tipo); activas.push(o); }
    const ritmoObras = (factor * W.ritmo(J.cuenta.patio || 0)) / (activas.length || 1);
    for (const o of activas) { o.prog += ritmoObras; if (o.prog >= EDIF[o.tipo].tiempo) o.listo = true; }
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
      fab.prog += factor;
      if (fab.prog > q.prog) q.prog = fab.prog;
      if (fab.prog < UNID[tipo].tiempo) continue;
      fab.cola.shift(); fab.pago.shift(); fab.prog = 0; q.n--; J.aguaUso += UNID[tipo].agua || 0;
      if (fab.bucle && (cat !== 'aire' || W.cupoAire(m, j).hay + 1 < W.cupoAire(m, j).cupo)) { fab.cola.push(tipo); fab.pago.push(false); q.n++; }
      const u = crearUnidad(m, j, tipo, cat === 'aire' ? Math.floor(fab.cy) * m.N + Math.floor(fab.cx) : W.cercaLibre(m, fab.cx, fab.y + fab.tam + 0.5));
      if (cat === 'aire') { const casa = aerodromoLibre(m, u) || fab; posar(m, u, casa); } // el avión nace posado en un aeródromo con sitio
      if (fab.reunion) { // va al punto de reunión del edificio
        if (tipo === 'cosechadora') u.pref = { x: fab.reunion.x, y: fab.reunion.y };
        else if (cat === 'aire') u.patrulla = { pts: [{ x: fab.reunion.x, y: fab.reunion.y }], i: 0 }; // el punto de reunión de un aeródromo es un punto de patrulla
        else { const c = W.cercaLibre(m, fab.reunion.x, fab.reunion.y); asignar(m, u, { t: 'mover', x: (c % m.N) + 0.5, y: ((c / m.N) | 0) + 0.5 }); }
      } else if (tipo !== 'cosechadora' && cat !== 'aire') { // se aparta de la puerta, hacia el centro del mapa
        const cx = m.N / 2 - fab.cx, cy = m.N / 2 - fab.cy, cd = Math.hypot(cx, cy) || 1;
        const c = W.cercaLibre(m, fab.cx + (cx / cd) * (fab.tam + 2), fab.cy + (cy / cd) * (fab.tam + 2));
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
  function curar(m) {
    const talleres = [[], []];
    for (const e of m.ents) if (e.edif && (e.tipo === 'patio' || e.tipo === 'cuartel' || e.tipo === 'fabrica' || e.tipo === 'aerodromo')) talleres[e.j].push(e);
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
      if (calma < 100) continue;
      const quiere = LUGAR[UNID[e.tipo].cat];
      for (const b of talleres[e.j]) {
        if ((b.tipo !== 'patio' && b.tipo !== quiere) || dist(e.x, e.y, b) > 5) continue;
        sanar(ECON.curaUnidad);
        break;
      }
    }
  }
  // Los vehículos en marcha aplastan a la infantería enemiga que pisan: daño fuerte cada tick mientras la tienen
  // debajo. Pasarle por encima de lleno la mata; un roce solo la hiere.
  function aplastar(m) {
    for (const a of m.ents) {
      if (a.edif || UNID[a.tipo].cat !== 'veh' || a.v < 0.03) continue;
      for (const b of m.ents) {
        if (b.edif || UNID[b.tipo].cat !== 'inf' || b.j === a.j || b.vida <= 0 || enTrinchera(m, b)) continue;
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
  W.actualizarNiebla = function (m) {
    const N = m.N, NN = N * N;
    for (let j = 0; j < 2; j++) { const f = m.niebla[j]; for (let i = 0; i < NN; i++) if (f[i] === 2) f[i] = 1; }
    for (let k = 0; k < m.ents.length; k++) {
      const e = m.ents[k], f = m.niebla[e.j];
      const cx = Math.floor(posX(e)), cy = Math.floor(posY(e));
      if (e.edif) { // los edificios ven en círculo
        const r = EDIF[e.tipo].vision + e.tam / 2, r2 = r * r, R = Math.ceil(r);
        for (let dy = -R; dy <= R; dy++) {
          const y = cy + dy; if (y < 0 || y >= N) continue;
          for (let dx = -R; dx <= R; dx++) {
            const x = cx + dx; if (x < 0 || x >= N || dx * dx + dy * dy > r2) continue;
            f[y * N + x] = 2;
          }
        }
        continue;
      }
      // Las unidades ven cerca alrededor y lejos solo en un cono hacia su frente.
      const v = UNID[e.tipo].vision, rc = v * ECON.visAt, rc2 = rc * rc, rs = v * ECON.visLado, rs2 = rs * rs, rl = v * ECON.visAd, rl2 = rl * rl, R = Math.ceil(rl);
      const ux = Math.cos(e.ang), uy = Math.sin(e.ang), campo = CAMPO[e.tipo], kc = campo.k;
      for (let dy = -R; dy <= R; dy++) {
        const y = cy + dy; if (y < 0 || y >= N) continue;
        for (let dx = -R; dx <= R; dx++) {
          const x = cx + dx, d2 = dx * dx + dy * dy;
          if (x < 0 || x >= N || d2 > rl2) continue;
          if (d2 > rc2 && !campo.todo) { // fuera del círculo cercano: al frente llega lejos, a los costados menos, detrás nada
            const p = dx * ux + dy * uy, s = p * Math.abs(p);
            if (s < kc * d2 && (d2 > rs2 || s < K_PERI * d2)) continue;
          }
          f[y * N + x] = 2;
        }
      }
    }
    for (let j = 0; j < 2; j++) if (m.jug[j].admin) m.niebla[j].fill(2); // modo ADMIN: todo el mapa a la vista
    for (let k = m.barridos.length - 1; k >= 0; k--) { // zonas reveladas por inteligencia
      const b = m.barridos[k], f = m.niebla[b.j], R = b.r;
      if (m.t > b.hasta) { m.barridos.splice(k, 1); continue; }
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        const x = Math.floor(b.x) + dx, y = Math.floor(b.y) + dy;
        if (x >= 0 && y >= 0 && x < N && y < N && dx * dx + dy * dy <= R * R) f[y * N + x] = 2;
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
    procesarRutas(m);
    tickProduccion(m, 0); tickProduccion(m, 1);
    for (let k = 0, n = m.ents.length; k < n; k++) {
      const e = m.ents[k];
      if (!e.edif) tickUnidad(m, e);
      else if (EDIF[e.tipo].arma) tickTorreta(m, e);
      else if (EDIF[e.tipo].da) { // extracción continua; con déficit de energía rinde la mitad
        const da = EDIF[e.tipo].da, J = m.jug[e.j];
        e.acum += (J.uso > J.prod ? 0.5 : 1) * (e.tipo === 'estacion' && J.mejoras.analisis ? 1.5 : 1);
        if (e.acum >= da.cada) { e.acum -= da.cada; J[da.rec]++; if (da.rec === 'petroleo') J.extraido++; }
      }
    }
    separar(m);
    aplastar(m);
    tickProyectiles(m);
    if (m.t % 10 === 0) { curar(m); colmena(m); }

    let muertos = false;
    for (let k = 0; k < m.ents.length; k++) {
      const e = m.ents[k];
      if (e.vida > 0) continue;
      muertos = true; m.porId.delete(e.id); m.jug[e.j].bajas++;
      m.efectos.push({ tipo: e.vendido ? 'venta' : 'muerte', x2: posX(e), y2: posY(e), edif: e.edif, tam: e.tam || 0, clase: e.tipo, ang: e.ang || 0, j: e.j, t: m.t });
      if (e.edif) {
        const N = m.N;
        e.cola.forEach((t, i) => { if (e.pago[i]) devolver(m.jug[e.j], UNID[t]); m.jug[e.j].colas[t].n--; }); // lo que tenía encargado (y pagado) se devuelve
        e.cola.length = 0;
        for (let dy = 0; dy < e.tam; dy++) for (let dx = 0; dx < e.tam; dx++) { const i = (e.y + dy) * N + e.x + dx; m.ocup[i] = 0; m.paso[i] = 1; }
        if (e.tipo === 'patio') m.jug[e.j].vivo = false;
      }
    }
    if (muertos) {
      m.ents = m.ents.filter((e) => e.vida > 0);
      contar(m);
      if (!m.jug[0].vivo || !m.jug[1].vivo) m.ganador = m.jug[0].vivo ? 0 : m.jug[1].vivo ? 1 : 2;
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
