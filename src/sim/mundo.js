// rts.warfare — estado del mundo, comandos y tick de simulación. No toca el DOM.
(function () {
  const W = globalThis.W || (globalThis.W = {});
  const EDIF = W.EDIF, UNID = W.UNID, ARMAS = W.ARMAS, ECON = W.ECON, T = W.TERRENO;

  // Desplazamientos ordenados por distancia: reparten los destinos de un grupo.
  const ESPIRAL = [];
  for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) ESPIRAL.push([dx, dy]);
  ESPIRAL.sort((a, b) => (a[0] * a[0] + a[1] * a[1]) - (b[0] * b[0] + b[1] * b[1]) || a[1] - b[1] || a[0] - b[0]);

  function nuevoJugador() {
    return {
      minerales: ECON.inicio, prod: 0, uso: 0, cuenta: {}, vivo: true, dios: false,
      obras: [], // [{ tipo, prog, listo }]: varias a la vez, se reparten la velocidad
      colas: { inf: { lista: [], prog: 0 }, veh: { lista: [], prog: 0 } },
      alerta: null, cosechado: 0, bajas: 0, producidas: 0,
    };
  }

  W.crearMundo = function (semilla) {
    const mapa = W.generarMapa(semilla), N = mapa.N, NN = N * N;
    const m = {
      N, semilla, mapa, t: 0, ents: [], porId: new Map(), sigId: 1,
      ocup: new Int32Array(NN), paso: new Uint8Array(NN),
      jug: [nuevoJugador(), nuevoJugador()],
      niebla: [new Uint8Array(NN), new Uint8Array(NN)],
      cola: [], colaRutas: [], efectos: [], minas: [], raros: [], ganador: -1,
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
    contar(m);
    W.actualizarNiebla(m);
    return m;
  };

  // ---------- entidades ----------
  function crearEdificio(m, j, tipo, x, y) {
    const d = EDIF[tipo], N = m.N;
    const e = { id: m.sigId++, j, tipo, edif: true, x, y, tam: d.tam, cx: x + d.tam / 2, cy: y + d.tam / 2, vida: d.vida, vidaMax: d.vida, recarga: 0, obj: 0 };
    for (let dy = 0; dy < d.tam; dy++) for (let dx = 0; dx < d.tam; dx++) { const i = (y + dy) * N + x + dx; m.ocup[i] = e.id; m.paso[i] = 0; }
    m.ents.push(e); m.porId.set(e.id, e);
    return e;
  }
  function crearUnidad(m, j, tipo, celda) {
    const d = UNID[tipo], N = m.N, x = (celda % N) + 0.5, y = ((celda / N) | 0) + 0.5;
    const u = {
      id: m.sigId++, j, tipo, edif: false, x, y, px: x, py: y, vida: d.vida, vidaMax: d.vida,
      orden: 'nada', ruta: null, ri: 0, dest: null, meta: null, pend: null, fallo: false, obj: 0, recarga: 0, fijo: false,
      carga: 0, est: tipo === 'cosechadora' ? 'buscar' : '', celda: -1, ref: 0, espera: 0, pref: null,
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

  W.tieneReq = function (m, j, req) {
    const c = m.jug[j].cuenta;
    for (let k = 0; k < req.length; k++) if (!c[req[k]]) return false;
    return true;
  };

  W.puedeColocar = function (m, j, tipo, x, y) {
    const d = EDIF[tipo], N = m.N, t = d.tam;
    if (x < 0 || y < 0 || x + t > N || y + t > N) return false;
    for (let dy = 0; dy < t; dy++) for (let dx = 0; dx < t; dx++) {
      const i = (y + dy) * N + x + dx;
      if (m.mapa.terreno[i] !== T.LLANO || m.ocup[i] || m.mapa.mineral[i] || m.mapa.sitioEn[i]) return false;
    }
    let junto = false;
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
    for (let j = 0; j < 2; j++) { const J = m.jug[j]; J.prod = 0; J.uso = 0; J.cuenta = {}; }
    for (let k = 0; k < m.ents.length; k++) {
      const e = m.ents[k], J = m.jug[e.j];
      J.cuenta[e.tipo] = (J.cuenta[e.tipo] || 0) + 1;
      if (e.edif) { const en = EDIF[e.tipo].energia; if (en > 0) J.prod += en; else J.uso -= en; }
    }
    for (let j = 0; j < 2; j++) { const J = m.jug[j]; if (J.dios) { J.minerales = 999999; if (J.prod < J.uso) J.prod = J.uso; } }
  }

  // ---------- comandos ----------
  W.orden = function (m, cmd) { m.cola.push(cmd); };

  function pedirRuta(m, u, x, y, radio) {
    if (!u.pend) m.colaRutas.push(u.id);
    u.pend = { x, y, radio }; u.meta = u.pend;
  }

  function propias(m, cmd) {
    const out = [];
    for (let k = 0; k < cmd.ids.length; k++) { const u = m.porId.get(cmd.ids[k]); if (u && !u.edif && u.j === cmd.j) out.push(u); }
    return out;
  }
  function destinos(m, us, x, y, fn) {
    const N = m.N, cx = Math.floor(x), cy = Math.floor(y);
    let k = 0;
    for (let i = 0; i < us.length; i++) {
      let c = -1;
      while (k < ESPIRAL.length) {
        const xx = cx + ESPIRAL[k][0], yy = cy + ESPIRAL[k][1]; k++;
        if (xx >= 0 && yy >= 0 && xx < N && yy < N && m.paso[yy * N + xx]) { c = yy * N + xx; break; }
      }
      if (c < 0) c = W.cercaLibre(m, x, y);
      fn(us[i], (c % N) + 0.5, ((c / N) | 0) + 0.5);
    }
  }

  function aplicar(m, cmd) {
    const J = m.jug[cmd.j];
    if (!J || !J.vivo) return;
    switch (cmd.t) {
      case 'dios': // modo GOD: recursos infinitos; al apagarlo vuelve el saldo anterior
        J.dios = !J.dios;
        if (J.dios) J.antesDios = J.minerales; else J.minerales = J.antesDios;
        return;
      case 'construir': {
        const d = EDIF[cmd.tipo];
        if (!d || cmd.tipo === 'patio' || J.obras.length >= ECON.obrasMax || !W.tieneReq(m, cmd.j, d.req) || J.minerales < d.costo) return;
        J.minerales -= d.costo; J.obras.push({ tipo: cmd.tipo, prog: 0, listo: false });
        return;
      }
      case 'cancelarEdif': { // cancela la obra más reciente de ese tipo (primero las que siguen en curso) y devuelve su costo
        let i = -1;
        for (let k = J.obras.length - 1; k >= 0; k--) if (J.obras[k].tipo === cmd.tipo && (i < 0 || (J.obras[i].listo && !J.obras[k].listo))) i = k;
        if (i < 0) return;
        J.minerales += EDIF[cmd.tipo].costo; J.obras.splice(i, 1);
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
        if (!d || !W.tieneReq(m, cmd.j, d.req) || J.minerales < d.costo) return;
        const q = J.colas[d.cat];
        if (q.lista.length >= ECON.colaMax) return;
        J.minerales -= d.costo; q.lista.push(cmd.tipo);
        return;
      }
      case 'cancelarUnidad': {
        const d = UNID[cmd.tipo]; if (!d) return;
        const q = J.colas[d.cat], i = q.lista.lastIndexOf(cmd.tipo);
        if (i < 0) return;
        q.lista.splice(i, 1); J.minerales += d.costo;
        if (i === 0) q.prog = 0;
        return;
      }
      case 'mover':
        destinos(m, propias(m, cmd), cmd.x, cmd.y, (u, x, y) => { u.orden = 'mover'; u.obj = 0; u.dest = { x, y }; u.ruta = null; pedirRuta(m, u, x, y, 0); });
        return;
      case 'amover':
        destinos(m, propias(m, cmd).filter((u) => UNID[u.tipo].arma), cmd.x, cmd.y, (u, x, y) => { u.orden = 'amover'; u.obj = 0; u.dest = { x, y }; u.ruta = null; pedirRuta(m, u, x, y, 0); });
        return;
      case 'atacar': {
        const o = m.porId.get(cmd.obj);
        if (!o || o.j === cmd.j) return;
        for (const u of propias(m, cmd)) if (UNID[u.tipo].arma) { u.orden = 'atacar'; u.obj = o.id; u.ruta = null; u.pend = null; }
        return;
      }
      case 'detener':
        for (const u of propias(m, cmd)) { u.orden = 'nada'; u.obj = 0; u.ruta = null; u.pend = null; if (u.tipo === 'cosechadora') u.est = 'quieto'; }
        return;
      case 'cosechar':
        for (const u of propias(m, cmd)) if (u.tipo === 'cosechadora') { u.orden = 'nada'; u.ruta = null; u.pend = null; u.est = 'buscar'; u.pref = { x: cmd.x, y: cmd.y }; }
        return;
    }
  }

  // ---------- movimiento ----------
  function avanzar(m, u) {
    if (!u.ruta) return false;
    const N = m.N, d = UNID[u.tipo];
    let vel = d.vel * (m.mapa.terreno[Math.floor(u.y) * N + Math.floor(u.x)] === T.BOSQUE ? 0.6 : 1);
    while (vel > 0 && u.ri < u.ruta.length) {
      const c = u.ruta[u.ri];
      if (!m.paso[c]) { // alguien construyó encima: se recalcula
        u.ruta = null;
        if (u.meta) pedirRuta(m, u, u.meta.x, u.meta.y, u.meta.radio);
        return false;
      }
      const tx = (c % N) + 0.5, ty = ((c / N) | 0) + 0.5, dx = tx - u.x, dy = ty - u.y, dd = Math.hypot(dx, dy);
      if (dd <= vel) { u.x = tx; u.y = ty; vel -= dd; u.ri++; } else { u.x += (dx / dd) * vel; u.y += (dy / dd) * vel; vel = 0; }
    }
    if (u.ri >= u.ruta.length) { u.ruta = null; return true; }
    return false;
  }

  function procesarRutas(m) {
    const N = m.N;
    let n = 0;
    while (m.colaRutas.length && n < 12) {
      const u = m.porId.get(m.colaRutas.shift());
      if (!u || !u.pend) continue;
      const p = u.pend; u.pend = null; n++;
      const camino = m.ruta(m.paso, m.mapa.terreno, Math.floor(u.x), Math.floor(u.y), p.x, p.y, p.radio);
      if (camino) { u.ruta = camino; u.ri = 0; } else { u.ruta = null; u.fallo = true; }
    }
  }

  function separar(m) {
    const N = m.N, us = [];
    for (let k = 0; k < m.ents.length; k++) if (!m.ents[k].edif) us.push(m.ents[k]);
    for (let a = 0; a < us.length; a++) {
      const A = us[a], ra = UNID[A.tipo].radio;
      for (let b = a + 1; b < us.length; b++) {
        const B = us[b];
        let dx = B.x - A.x; if (dx > 1 || dx < -1) continue;
        let dy = B.y - A.y; if (dy > 1 || dy < -1) continue;
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
      if (m.paso[Math.floor(ny) * N + Math.floor(nx)]) { u.x = nx; u.y = ny; }
    }
  }

  // ---------- combate ----------
  function buscarEnemigo(m, a, x, y, rango) {
    let mejor = null, md = rango;
    for (let k = 0; k < m.ents.length; k++) {
      const e = m.ents[k];
      if (e.j === a.j || e.vida <= 0) continue;
      const d = dist(x, y, e);
      if (d <= md) { md = d; mejor = e; }
    }
    return mejor;
  }

  function disparar(m, a, b, arma) {
    const blindaje = b.edif ? 'edificio' : UNID[b.tipo].blindaje;
    b.vida -= arma.dano * arma.vs[blindaje];
    a.recarga = arma.recarga;
    m.efectos.push({ x1: posX(a), y1: posY(a), x2: posX(b), y2: posY(b), j: a.j, t: m.t, arma: a.edif ? EDIF[a.tipo].arma : UNID[a.tipo].arma });
    m.jug[b.j].alerta = { x: posX(b), y: posY(b), t: m.t };
    if (!b.edif && b.orden === 'nada' && !b.obj && UNID[b.tipo].arma) b.obj = a.id;
  }

  function tickTorreta(m, e) {
    const J = m.jug[e.j], arma = ARMAS[EDIF[e.tipo].arma];
    if (e.recarga > 0) e.recarga--;
    if (J.uso > J.prod) { e.obj = 0; return; } // sin energía, apagada
    let o = e.obj ? m.porId.get(e.obj) : null;
    if (o && (o.vida <= 0 || dist(e.cx, e.cy, o) > arma.alcance)) { o = null; e.obj = 0; }
    if (!o && (m.t + e.id) % 5 === 0) { o = buscarEnemigo(m, e, e.cx, e.cy, arma.alcance); if (o) e.obj = o.id; }
    if (o && e.recarga <= 0) disparar(m, e, o, arma);
  }

  function tickUnidad(m, u) {
    const d = UNID[u.tipo];
    u.px = u.x; u.py = u.y;
    if (u.recarga > 0) u.recarga--;
    if (u.tipo === 'cosechadora') { tickCosechadora(m, u); return; }
    if (u.fallo) { u.fallo = false; u.orden = 'nada'; u.obj = 0; }
    const arma = ARMAS[d.arma];
    if (u.orden === 'mover') {
      if (avanzar(m, u) || (!u.ruta && !u.pend)) u.orden = 'nada';
      return;
    }
    let o = u.obj ? m.porId.get(u.obj) : null;
    if (u.obj && (!o || o.vida <= 0)) { o = null; u.obj = 0; u.ruta = null; if (u.orden === 'atacar') u.orden = 'nada'; }
    if (!o && (m.t + u.id) % 5 === 0) {
      o = buscarEnemigo(m, u, u.x, u.y, arma.alcance + 2);
      if (o) { u.obj = o.id; u.ruta = null; u.pend = null; }
    }
    if (o) {
      const dd = dist(u.x, u.y, o);
      if (dd <= arma.alcance) {
        if (u.recarga <= 0) disparar(m, u, o, arma);
      } else if (u.orden !== 'atacar' && dd > arma.alcance + 4) {
        u.obj = 0; u.ruta = null; // se alejó demasiado: lo suelta
      } else {
        if (!u.pend && (!u.ruta || (!o.edif && (m.t + u.id) % 20 === 0))) pedirRuta(m, u, posX(o), posY(o), o.edif ? o.tam / 2 + 1 : 1);
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
    let mejor = -1, md = Infinity;
    for (let k = 0; k < m.minas.length; k++) {
      const c = m.minas[k];
      const d = Math.hypot((c % N) + 0.5 - rx, ((c / N) | 0) + 0.5 - ry) + ((c * 7 + u.id * 13) % 5) * 0.3;
      if (d < md) { md = d; mejor = c; }
    }
    u.pref = null;
    return mejor;
  }
  function quitarMina(m, c) {
    const i = m.minas.indexOf(c);
    if (i >= 0) { m.minas[i] = m.minas[m.minas.length - 1]; m.minas.pop(); }
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
    const d = UNID.cosechadora, N = m.N, J = m.jug[u.j];
    u.fijo = false; u.fallo = false;
    if (u.orden === 'mover') {
      if (avanzar(m, u) || (!u.ruta && !u.pend)) { u.orden = 'nada'; u.est = 'quieto'; }
      return;
    }
    switch (u.est) {
      case 'buscar': {
        if (u.carga >= d.carga) { u.est = 'volver0'; break; }
        const c = minaCercana(m, u);
        if (c < 0) { if (u.carga > 0) u.est = 'volver0'; else { u.est = 'espera'; u.espera = 60; } break; }
        u.celda = c; pedirRuta(m, u, (c % N) + 0.5, ((c / N) | 0) + 0.5, 0); u.est = 'ir';
        break;
      }
      case 'ir':
        if (u.pend) break;
        if (!u.ruta) {
          const cerca = Math.hypot((u.celda % N) + 0.5 - u.x, ((u.celda / N) | 0) + 0.5 - u.y) < 0.9;
          if (cerca) u.est = 'cosechar'; else { u.est = 'espera'; u.espera = 40; }
          break;
        }
        avanzar(m, u);
        break;
      case 'cosechar': {
        u.fijo = true;
        const hay = m.mapa.mineral[u.celda];
        if (hay <= 0) { quitarMina(m, u.celda); u.est = 'buscar'; break; }
        const q = Math.min(ECON.cosecha, d.carga - u.carga, hay);
        m.mapa.mineral[u.celda] -= q; u.carga += q;
        if (m.mapa.mineral[u.celda] <= 0) quitarMina(m, u.celda);
        if (u.carga >= d.carga) u.est = 'volver0';
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
        if (!u.ruta) {
          if (dist(u.x, u.y, ref) <= 1.3) u.est = 'descargar'; else { u.est = 'espera'; u.espera = 40; }
          break;
        }
        avanzar(m, u);
        break;
      }
      case 'descargar': {
        u.fijo = true;
        if (!m.porId.get(u.ref)) { u.est = 'volver0'; break; }
        const q = Math.min(ECON.descarga, u.carga);
        u.carga -= q; J.minerales += q; J.cosechado += q;
        if (u.carga <= 0) u.est = 'buscar';
        break;
      }
      case 'espera':
        if (--u.espera <= 0) u.est = u.carga >= d.carga ? 'volver0' : 'buscar';
        break;
    }
  }

  // ---------- producción ----------
  function edificiosDe(m, j, tipo) {
    const out = [];
    for (let k = 0; k < m.ents.length; k++) if (m.ents[k].j === j && m.ents[k].tipo === tipo) out.push(m.ents[k]);
    return out;
  }
  // Varios edificios productivos del mismo tipo aceleran su cola: +50 % por cada uno extra, hasta ×2,5.
  W.ritmo = function (n) { return n < 1 ? 0 : Math.min(1 + ECON.bonoProd * (n - 1), ECON.bonoMax); };
  function tickProduccion(m, j) {
    const J = m.jug[j];
    if (!J.vivo) return;
    const factor = J.uso > J.prod ? 0.5 : 1; // déficit de energía: todo a media velocidad
    if (m.t % ECON.goteoCada === 0) J.minerales += 1; // ingreso mínimo del patio: evita el bloqueo total
    // Las obras en curso se reparten la velocidad: una sola va a ritmo pleno, dos a la mitad cada una.
    let activas = 0;
    for (const o of J.obras) if (!o.listo) activas++;
    const ritmoObras = factor * W.ritmo(J.cuenta.patio || 0);
    for (const o of J.obras) if (!o.listo) { o.prog += ritmoObras / activas; if (o.prog >= EDIF[o.tipo].tiempo) o.listo = true; }
    for (const cat of ['inf', 'veh']) {
      const q = J.colas[cat];
      if (!q.lista.length) continue;
      const fabs = edificiosDe(m, j, cat === 'inf' ? 'cuartel' : 'fabrica');
      if (!fabs.length) { for (const t of q.lista) J.minerales += UNID[t].costo; q.lista.length = 0; q.prog = 0; continue; }
      const fab = fabs[J.producidas % fabs.length]; // las unidades van saliendo por turnos de cada edificio
      q.prog += factor * W.ritmo(fabs.length);
      const tipo = q.lista[0];
      if (q.prog < UNID[tipo].tiempo) continue;
      q.lista.shift(); q.prog = 0;
      const u = crearUnidad(m, j, tipo, W.cercaLibre(m, fab.cx, fab.y + fab.tam + 0.5));
      if (tipo !== 'cosechadora') { // se aparta de la puerta, hacia el centro del mapa
        const cx = m.N / 2 - fab.cx, cy = m.N / 2 - fab.cy, cd = Math.hypot(cx, cy) || 1;
        const c = W.cercaLibre(m, fab.cx + (cx / cd) * (fab.tam + 2), fab.cy + (cy / cd) * (fab.tam + 2));
        u.orden = 'mover'; u.dest = { x: (c % m.N) + 0.5, y: ((c / m.N) | 0) + 0.5 };
        pedirRuta(m, u, u.dest.x, u.dest.y, 0);
      }
    }
  }

  // ---------- niebla ----------
  W.actualizarNiebla = function (m) {
    const N = m.N, NN = N * N;
    for (let j = 0; j < 2; j++) { const f = m.niebla[j]; for (let i = 0; i < NN; i++) if (f[i] === 2) f[i] = 1; }
    for (let k = 0; k < m.ents.length; k++) {
      const e = m.ents[k], f = m.niebla[e.j];
      const r = (e.edif ? EDIF[e.tipo] : UNID[e.tipo]).vision + (e.edif ? e.tam / 2 : 0), r2 = r * r;
      const cx = Math.floor(posX(e)), cy = Math.floor(posY(e)), R = Math.ceil(r);
      for (let dy = -R; dy <= R; dy++) {
        const y = cy + dy; if (y < 0 || y >= N) continue;
        for (let dx = -R; dx <= R; dx++) {
          const x = cx + dx; if (x < 0 || x >= N || dx * dx + dy * dy > r2) continue;
          f[y * N + x] = 2;
        }
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
      if (e.edif) { if (EDIF[e.tipo].arma) tickTorreta(m, e); } else tickUnidad(m, e);
    }
    separar(m);

    let muertos = false;
    for (let k = 0; k < m.ents.length; k++) {
      const e = m.ents[k];
      if (e.vida > 0) continue;
      muertos = true; m.porId.delete(e.id); m.jug[e.j].bajas++;
      if (e.edif) {
        const N = m.N;
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
