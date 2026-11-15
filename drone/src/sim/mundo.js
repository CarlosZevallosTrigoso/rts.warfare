// drone.warfare — el mundo y su tick: reloj, órdenes, movimiento de los equipos, quién ve a quién, combate entre
// soldados, la carga que vuela edificios y el final de la partida. Los drones, por ahora, solo vigilan en círculo.
(function () {
  const D = globalThis.D || (globalThis.D = {});
  const ECON = D.ECON, T = D.T, TAU = Math.PI * 2;

  D.esNoche = (m) => m.t % ECON.dia >= ECON.diaLuz;
  // Cuánta luz hay, de 0 (noche cerrada) a 1 (día): baja durante el anochecer y sube al amanecer.
  D.luz = function (m) {
    const h = m.t % ECON.dia, c = ECON.crepusculo;
    if (h < c * 0.5) return 0.5 + (h / (c * 0.5)) * 0.5; // termina de amanecer
    if (h < ECON.diaLuz - c) return 1;
    if (h < ECON.diaLuz) return (ECON.diaLuz - h) / c; // anochece
    if (h < ECON.dia - c * 0.5) return 0;
    return ((h - (ECON.dia - c * 0.5)) / (c * 0.5)) * 0.5; // empieza a clarear
  };
  D.hora = function (m) { const f = ((m.t % ECON.dia) / ECON.dia) * 24, h = Math.floor(f + 6) % 24, mi = Math.floor((f % 1) * 60); return String(h).padStart(2, '0') + ':' + String(mi).padStart(2, '0'); }; // el día empieza a las 06:00
  D.faltaAmanecer = (m) => Math.max(0, ECON.dia - m.t); // ticks que quedan de partida

  function crear(m, clase, j, tipo, x, y, extra) { const e = Object.assign({ id: m.sigId++, clase, j, tipo, x, y, ang: 0, vida: 1 }, extra); m.ents.push(e); m.porId.set(e.id, e); return e; }
  const libre = (m, x, y) => { x = Math.floor(x); y = Math.floor(y); return x >= 0 && y >= 0 && x < m.N && y < m.N && m.paso[y * m.N + x] === 1; };
  // La celda pisable más cercana a un punto (en espiral), que no sea ninguna de las ya dadas.
  D.cercaLibre = function (m, x, y, usadas) {
    for (let r = 0; r < 12; r++) for (let k = 0, n = Math.max(1, r * 6); k < n; k++) { const a = (k / n) * TAU + r * 0.7, X = Math.floor(x + Math.cos(a) * r), Y = Math.floor(y + Math.sin(a) * r), c = Y * m.N + X; if (libre(m, X, Y) && !(usadas && usadas.has(c))) { if (usadas) usadas.add(c); return { x: X + 0.5, y: Y + 0.5 }; } }
    return { x: Math.floor(x) + 0.5, y: Math.floor(y) + 0.5 };
  };

  // op.escenario: 'mixto' | 'urbano'. op.t: tick de inicio (para pruebas). op.ia: [bool, bool], qué bandos lleva la máquina.
  D.crearMundo = function (semilla, op) {
    op = op || {};
    const mapa = D.generarMapa(semilla, op.escenario), N = mapa.N, az = D.prng(semilla ^ 0x51ED);
    const m = { semilla, t: op.t === undefined ? ECON.inicio : op.t, N, mapa, paso: mapa.paso.slice(), ents: [], porId: new Map(), sigId: 1, az,
      jug: [{ personas: 0, pilotos: 0, bajas: 0 }, { personas: 0, pilotos: 0, bajas: 0 }], visto: [new Set(), new Set()], conocido: [new Set(), new Set()], efectos: [], cola: [], fin: null, ia: [null, null], humos: [], proy: [] };
    // Coste de pisar cada celda: a paso normal manda la velocidad; en sigilo se prefiere lo que tapa.
    m.coste = new Float32Array(N * N); m.costeSigilo = new Float32Array(N * N);
    for (let c = 0; c < N * N; c++) { const t = mapa.terreno[c], v = D.PASO[t] || 1; m.coste[c] = 1 / v; m.costeSigilo[c] = Math.max(0.5, (1 / v) * (1.5 - D.COBERTURA[t])); }
    let eq = 1;
    const equipo = (j, roles, x, y, ang) => { const us = new Set(); roles.forEach((r, i) => { const d = (i - (roles.length - 1) / 2) * 1.3, p = D.cercaLibre(m, x + Math.cos(ang + 1.57) * d, y + Math.sin(ang + 1.57) * d, us), s = D.SOL[r]; crear(m, 'sol', j, r, p.x, p.y, { ang, eq, vida: s.vida, vidaMax: s.vida, orden: 'nada', ruta: null, ri: 0, sigilo: false, fuego: true, recarga: 0, supr: 0, obj: 0, canal: 0, movio: false, tTiro: -999, firma: 1, mira: ang, cdGranada: 0, cdHumo: 0 }); m.jug[j].personas++; }); eq++; };
    const edif = (j, t, p) => { if (!p) return; const e = crear(m, 'edif', j, t, p.x + 0.5, p.y + 0.5, { vida: 1 }), r = D.EDIF[t].tam >= 3 ? 1 : 0; for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const X = p.x + dx, Y = p.y + dy; if (X >= 0 && Y >= 0 && X < N && Y < N && (r === 0 || Math.abs(dy) < 1 || t === 'centro')) m.paso[Y * N + X] = 0; } return e; };
    const pilotos = (j, n) => { m.jug[j].pilotos = n; m.jug[j].personas += n; }; // están dentro: cuentan, pero no se ven
    const posado = (j, t, p, i, ang) => crear(m, 'dron', j, t, p.x + 2.4 + (i % 3) * 1.5, p.y + 0.5 + (Math.floor(i / 3) - 0.5) * 1.6, { alt: 0, ang });
    const orbita = (j, t, x, y, r) => crear(m, 'dron', j, t, x, y, { alt: D.DRON[t].alt, orbita: { x, y, r, fase: az() * TAU } });

    // El atacante: cuatro equipos de fuerzas especiales y solo dos pilotos.
    { const b = mapa.bases[0], f = b.frente, lado = f + Math.PI / 2;
      edif(0, 'barracon', b.barracon); edif(0, 'taller', b.taller); edif(0, 'antena', b.antenas[0]);
      equipo(0, ['asaltante', 'asaltante', 'escopetero', 'zapador'], b.x + Math.cos(f) * 5 + Math.cos(lado) * 4, b.y + Math.sin(f) * 5 + Math.sin(lado) * 4, f);
      equipo(0, ['asaltante', 'asaltante', 'escopetero', 'observador'], b.x + Math.cos(f) * 5 - Math.cos(lado) * 4, b.y + Math.sin(f) * 5 - Math.sin(lado) * 4, f);
      equipo(0, ['asaltante', 'escopetero', 'inhibidor', 'sanitario'], b.x + Math.cos(f) * 9, b.y + Math.sin(f) * 9, f);
      equipo(0, ['tirador', 'observador'], b.x + Math.cos(f) * 13 + Math.cos(lado) * 6, b.y + Math.sin(f) * 13 + Math.sin(lado) * 6, f);
      pilotos(0, 2); orbita(0, 'recon', b.x + Math.cos(f) * 16, b.y + Math.sin(f) * 16, 9); posado(0, 'fpvRadio', b.taller, 0, f); posado(0, 'fpvFibra', b.taller, 1, f); }
    // El defensor: el centro con seis pilotos, dos antenas y una falsa, la estación de escucha, y una guardia de dos equipos.
    { const b = mapa.bases[1], f = b.frente;
      edif(1, 'centro', b.centro); edif(1, 'taller', b.taller); edif(1, 'barracon', b.barracon); for (const a of b.antenas) edif(1, 'antena', a); edif(1, 'falsa', b.falsa); edif(1, 'escucha', b.escucha);
      equipo(1, ['asaltante', 'asaltante', 'escopetero', 'sanitario'], b.x + Math.cos(f) * 5, b.y + Math.sin(f) * 5, f);
      equipo(1, ['asaltante', 'escopetero', 'tirador', 'inhibidor'], b.x - Math.cos(f) * 4, b.y - Math.sin(f) * 4, f);
      pilotos(1, 6); orbita(1, 'recon', b.x + Math.cos(f) * 12, b.y + Math.sin(f) * 12, 11); orbita(1, 'recon', b.x + Math.cos(f) * 30, b.y + Math.sin(f) * 30, 13);
      ['fpvRadio', 'fpvRadio', 'fpvFibra', 'bombardero', 'interceptor'].forEach((t, i) => posado(1, t, b.taller, i, f)); }
    if (op.ia) for (let j = 0; j < 2; j++) if (op.ia[j] && D.iaCrear) m.ia[j] = D.iaCrear(m, j);
    drones(m); detectar(m);
    return m;
  };

  // ---------- órdenes ----------
  // Se dan con D.orden y se aplican al principio del tick siguiente. Van por equipos (cmd.eqs).
  //   { t: 'mover', j, eqs, x, y }     ir a un punto (cada miembro, a su sitio alrededor)
  //   { t: 'volar', j, eqs, obj }      ir a un edificio enemigo y colocarle la carga (lo hacen asaltantes y zapadores)
  //   { t: 'detener', j, eqs }
  //   { t: 'modo', j, eqs, sigilo?, fuego? }   sigilo: lento y tapado · fuego: libre (true) o contenido (false)
  //   { t: 'retirada', j, eqs }        correr al barracón: no disparan y cuesta más darles
  //   { t: 'granada' | 'humo', j, eqs, x, y }   la lanza el miembro más cercano al punto, si está a tiro y el equipo no está recargando
  D.orden = function (m, cmd) { m.cola.push(cmd); };
  const delEquipo = (m, j, eqs) => m.ents.filter((e) => e.clase === 'sol' && e.j === j && eqs.includes(e.eq));
  function irA(m, u, x, y) { const r = D.ruta(m.N, m.paso, u.sigilo ? m.costeSigilo : m.coste, u.x, u.y, x, y); u.ruta = r; u.ri = 1; if (!r) u.orden = 'nada'; return !!r; }
  function aplicar(m, cmd) {
    if (m.fin || !cmd.eqs) return; const us = delEquipo(m, cmd.j, cmd.eqs); if (!us.length) return;
    if (cmd.t === 'mover') { // cada uno, a su puesto: los mejores sitios cubiertos alrededor del punto, de cara a la amenaza
      const cx = us.reduce((s, u) => s + u.x, 0) / us.length, cy = us.reduce((s, u) => s + u.y, 0) / us.length, am = D.amenaza(m, cmd.j, cmd.x, cmd.y, cx, cy), ps = D.puestos(m, cmd.x, cmd.y, us.length, am);
      us.forEach((u, i) => { const p = ps[i] || D.cercaLibre(m, cmd.x, cmd.y); u.orden = 'mover'; u.obj = 0; u.canal = 0; u.mira = Math.atan2(am.y - p.y, am.x - p.x); if (!irA(m, u, p.x, p.y)) { const q = D.cercaLibre(m, cmd.x, cmd.y); u.orden = 'mover'; irA(m, u, q.x, q.y); } });
    }
    else if (cmd.t === 'retirada') { const b = m.ents.find((e) => e.clase === 'edif' && e.j === cmd.j && e.tipo === 'barracon') || m.mapa.bases[cmd.j], usadas = new Set(); for (const u of us) { const p = D.cercaLibre(m, b.x + (u.x > b.x ? 2 : -2), b.y + (u.y > b.y ? 2 : -2), usadas); u.sigilo = false; u.obj = 0; u.canal = 0; u.orden = 'retirada'; if (!irA(m, u, p.x, p.y)) u.orden = 'nada'; else u.orden = 'retirada'; } m.efectos.push({ tipo: 'retirada', j: cmd.j, x: us[0].x, y: us[0].y, t: m.t }); }
    else if (cmd.t === 'granada' || cmd.t === 'humo') {
      const g = cmd.t === 'granada', cd = g ? 'cdGranada' : 'cdHumo', alc = g ? ECON.granadaAlc : ECON.humoAlc; if (us[0][cd] > m.t) { m.efectos.push({ tipo: 'noPuede', j: cmd.j, que: 'recarga', t: m.t }); return; }
      let quien = null, md = 1e9; for (const u of us) { if (u.orden === 'retirada' || u.supr >= ECON.suprClavado) continue; const d = Math.hypot(u.x - cmd.x, u.y - cmd.y); if (d < md) { md = d; quien = u; } }
      if (!quien || md > alc) { m.efectos.push({ tipo: 'noPuede', j: cmd.j, que: quien ? 'lejos' : 'nadie', t: m.t }); return; }
      for (const u of us) u[cd] = m.t + (g ? ECON.granadaCd : ECON.humoCd); quien.tTiro = m.t; quien.ang = Math.atan2(cmd.y - quien.y, cmd.x - quien.x);
      m.proy.push({ k: cmd.t, j: cmd.j, x1: quien.x, y1: quien.y, x2: cmd.x, y2: cmd.y, t0: m.t, t1: m.t + ECON.granadaVuelo }); m.efectos.push({ tipo: 'lanza', k: cmd.t, j: cmd.j, x1: quien.x, y1: quien.y, x2: cmd.x, y2: cmd.y, t: m.t });
    }
    else if (cmd.t === 'detener') { for (const u of us) { if (u.orden === 'retirada') continue; u.orden = 'nada'; u.ruta = null; u.obj = 0; u.canal = 0; } }
    else if (cmd.t === 'modo') { for (const u of us) { if (cmd.sigilo !== undefined && u.sigilo !== cmd.sigilo) { u.sigilo = cmd.sigilo; if (u.ruta && u.ri < u.ruta.length) { const f = u.ruta[u.ruta.length - 1]; irA(m, u, f[0], f[1]); } } if (cmd.fuego !== undefined) u.fuego = cmd.fuego; } }
    else if (cmd.t === 'volar') { const o = m.porId.get(cmd.obj); if (!o || o.clase !== 'edif' || o.j === cmd.j || !m.conocido[cmd.j].has(o.id)) return; const usadas = new Set(); for (const u of us) { const p = D.cercaLibre(m, o.x + (u.x > o.x ? 1.6 : -1.6), o.y + (u.y > o.y ? 1.6 : -1.6), usadas); u.orden = D.SOL[u.tipo].carga ? 'volar' : 'mover'; u.obj = D.SOL[u.tipo].carga ? o.id : 0; u.canal = 0; irA(m, u, p.x, p.y); } }
  }

  // ---------- cobertura con dirección ----------
  // Lo cubierto que está quien pisa (tx, ty) frente a un tiro que viene de (sx, sy): lo que le tape su celda (arboleda, ruina,
  // trinchera, cráter) o lo que tenga pegado en esa dirección (murete, esquina de muro, borde de arboleda), lo que más. A quemarropa
  // lo de delante no cuenta. En camino, calle o puente, sin nada delante: cobertura negativa.
  D.cobFrente = function (m, tx, ty, sx, sy) {
    const N = m.N, t = m.mapa.terreno, cx = Math.floor(tx), cy = Math.floor(ty), propia = t[cy * N + cx], dx = sx - tx, dy = sy - ty, L = Math.hypot(dx, dy);
    let v = D.COBERTURA[propia];
    if (L > 1.6) { const nx = cx + Math.round(dx / L), ny = cy + Math.round(dy / L); if (nx >= 0 && ny >= 0 && nx < N && ny < N) { const lado = D.COB_LADO[t[ny * N + nx]]; if (lado && !(propia === T.BOSQUE && t[ny * N + nx] === T.BOSQUE)) v = Math.max(v, lado); } }
    if (v < D.COB_LIGERA && (propia === T.CAMINO || propia === T.PUENTE || propia === T.VADO)) v = D.COB_EXPUESTO;
    return v;
  };
  // De dónde se espera el peligro al ir a (x, y): del enemigo a la vista más cercano; si no hay, de frente según se avanza;
  // y si apenas se mueve uno, de donde está el otro bando.
  D.amenaza = function (m, j, x, y, ox, oy) {
    let ob = null, md = 30; for (const id of m.visto[j]) { const o = m.porId.get(id); if (!o) continue; const d = Math.hypot(o.x - x, o.y - y); if (d < md) { md = d; ob = o; } }
    if (ob) return { x: ob.x, y: ob.y, visto: true };
    let dx = x - ox, dy = y - oy, L = Math.hypot(dx, dy); if (L < 3) { const f = m.mapa.bases[j].frente; dx = Math.cos(f); dy = Math.sin(f); L = 1; }
    return { x: x + (dx / L) * 20, y: y + (dy / L) * 20, visto: false };
  };
  // Los n mejores puestos alrededor de (x, y) frente a una amenaza: celdas pisables y libres, las más cubiertas y cercanas.
  // Lo usan la orden de mover y la vista previa del jugador, así que lo que se ve es lo que se obtiene.
  D.puestos = function (m, x, y, n, am) {
    const N = m.N, cand = [], R = n > 2 ? 3 : 2, ocup = new Set(); for (const e of m.ents) if (e.clase === 'sol' && (!e.ruta || e.ri >= e.ruta.length)) ocup.add(Math.floor(e.y) * N + Math.floor(e.x));
    for (let cy = Math.floor(y - R); cy <= y + R; cy++) for (let cx = Math.floor(x - R); cx <= x + R; cx++) { if (cx < 0 || cy < 0 || cx >= N || cy >= N || !m.paso[cy * N + cx]) continue; const d = Math.hypot(cx + 0.5 - x, cy + 0.5 - y); if (d > R + 0.5) continue; const cob = D.cobFrente(m, cx + 0.5, cy + 0.5, am.x, am.y); cand.push({ x: cx + 0.5, y: cy + 0.5, cob, p: cob * 10 - d * 1.5 - (ocup.has(cy * N + cx) ? 4 : 0) }); }
    cand.sort((a, b) => b.p - a.p || a.y - b.y || a.x - b.x); return cand.slice(0, n);
  };
  // ¿Corta el humo la línea entre dos puntos? (las nubes son círculos; basta que la línea pase por una)
  function humoCorta(m, ax, ay, bx, by) {
    for (const h of m.humos) { const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1, k = Math.max(0, Math.min(1, ((h.x - ax) * dx + (h.y - ay) * dy) / L2)); if (Math.hypot(ax + dx * k - h.x, ay + dy * k - h.y) < h.r) return true; }
    return false;
  }
  const enHumo = (m, x, y) => m.humos.some((h) => Math.hypot(h.x - x, h.y - y) < h.r);
  D.nivelSupr = (u) => (u.supr >= ECON.suprClavado ? 2 : u.supr >= ECON.suprAgachado ? 1 : 0); // 0 de pie · 1 agachado · 2 clavado

  // ---------- firma y detección ----------
  // La firma de un soldado: cuánto se le ve (1 = de pie en campo abierto). Quieto, la cobertura le tapa del todo; andando,
  // solo en parte; en sigilo, menos; y si acaba de disparar, se le ve más que nunca.
  function firmaDe(m, u) {
    const cob = D.COBERTURA[m.mapa.terreno[Math.floor(u.y) * m.N + Math.floor(u.x)]];
    let f = D.SOL[u.tipo].firma * (1 - cob * (u.movio ? ECON.andaCob : ECON.quietoCob)); if (u.movio && u.sigilo) f *= ECON.sigiloFirma; if (!u.movio && u.sigilo) f *= 0.8;
    if (m.t - u.tTiro < ECON.tiroDelata) f = Math.max(f, ECON.firmaTiro);
    return Math.max(0.05, f);
  }
  // Cada cuatro ticks: qué enemigos ve cada bando (m.visto) y qué edificios enemigos ha descubierto ya (m.conocido, no se olvida).
  // Ven los soldados (con línea de visión, y menos de noche) y los drones de reconocimiento en vuelo (desde arriba: sin muros
  // que estorben, pero no ven bajo techo ni a quien está quieto bajo los árboles).
  function detectar(m) {
    const luzF = ECON.verNoche + (1 - ECON.verNoche) * D.luz(m), N = m.N, terr = m.mapa.terreno;
    for (const u of m.ents) if (u.clase === 'sol') u.firma = firmaDe(m, u);
    for (let j = 0; j < 2; j++) {
      const ve = m.visto[j]; ve.clear();
      const ojos = [], altos = []; for (const e of m.ents) { if (e.j !== j) continue; if (e.clase === 'sol') ojos.push(e); else if (e.clase === 'dron' && e.tipo === 'recon' && e.alt) altos.push(e); }
      for (const o of m.ents) {
        if (o.j === j || o.clase === 'dron') continue;
        if (o.clase === 'edif') { if (m.conocido[j].has(o.id)) continue;
          let visto = false; for (const d of altos) if (Math.hypot(d.x - o.x, d.y - o.y) <= ECON.dronVeEdif) { visto = true; break; }
          if (!visto) for (const s of ojos) { const dd = Math.hypot(s.x - o.x, s.y - o.y); if (dd <= ECON.verEdif * luzF && D.seVe(m.mapa, s.x, s.y, o.x, o.y)) { visto = true; break; } }
          if (visto) { m.conocido[j].add(o.id); m.efectos.push({ tipo: 'hallado', j, id: o.id, clase: o.tipo, x: o.x, y: o.y, t: m.t }); } continue; }
        const t = terr[Math.floor(o.y) * N + Math.floor(o.x)], techo = t === T.RUINA || t === T.MURO, arbol = t === T.BOSQUE; let visto = false;
        const humo = m.humos.length && enHumo(m, o.x, o.y);
        for (const d of altos) { if (humo || (techo && !o.movio && m.t - o.tTiro >= ECON.tiroDelata)) break; const r = ECON.dronVe * (arbol && !o.movio ? 0.4 : techo ? 0.5 : 1); if (Math.hypot(d.x - o.x, d.y - o.y) <= r) { visto = true; break; } }
        if (!visto) for (const s of ojos) { const dd = Math.hypot(s.x - o.x, s.y - o.y), r = Math.max(1.5, D.SOL[s.tipo].ver * luzF * o.firma); if (dd <= r && D.seVe(m.mapa, s.x, s.y, o.x, o.y) && !(m.humos.length && humoCorta(m, s.x, s.y, o.x, o.y))) { visto = true; break; } }
        if (visto) ve.add(o.id);
      }
    }
  }
  D.detectar = detectar;

  // ---------- movimiento ----------
  function mover(m, u) {
    u.movio = false; if (u.supr > 0) u.supr = Math.max(0, u.supr - ECON.suprBaja); if (u.recarga > 0) u.recarga--;
    const corre = u.orden === 'retirada', ns = D.nivelSupr(u);
    if (!u.ruta || u.ri >= u.ruta.length) { if (u.orden === 'mover' || corre) { u.orden = 'nada'; if (corre) u.supr = 0; else u.ang = u.mira; } return; }
    if (u.canal > 0 || (ns === 2 && !corre)) return; // clavado: no se mueve (salvo que se retire)
    const d = D.SOL[u.tipo], t = m.mapa.terreno[Math.floor(u.y) * m.N + Math.floor(u.x)];
    let paso = d.vel * (D.PASO[t] || 1) * (corre ? ECON.retiradaVel : (u.sigilo ? ECON.sigiloVel : 1) * (ns ? ECON.suprVel : 1)) * (0.6 + 0.4 * (u.vida / u.vidaMax));
    while (paso > 0 && u.ri < u.ruta.length) { const [px, py] = u.ruta[u.ri], dx = px - u.x, dy = py - u.y, L = Math.hypot(dx, dy); if (L <= paso) { u.x = px; u.y = py; u.ri++; paso -= L; } else { u.x += (dx / L) * paso; u.y += (dy / L) * paso; u.ang = Math.atan2(dy, dx); paso = 0; } u.movio = true; }
  }

  // ---------- combate ----------
  function baja(m, u) { u.vida = 0; m.jug[u.j].personas--; m.jug[u.j].bajas++; m.efectos.push({ tipo: 'baja', x: u.x, y: u.y, j: u.j, clase: u.tipo, t: m.t }); }
  function combatir(m, u) {
    const a = D.ARMA[D.SOL[u.tipo].arma]; if (u.recarga > 0 || u.canal > 0 || u.orden === 'retirada') return;
    let ob = null, md = a.alc; for (const id of m.visto[u.j]) { const o = m.porId.get(id); if (!o || o.vida <= 0) continue; const d = Math.hypot(o.x - u.x, o.y - u.y); if (d < md) { md = d; ob = o; } }
    if (!ob) return;
    if (!u.fuego && md > 5 && m.t - (u.tHerido || -999) > 100) return; // fuego contenido: solo de cerca o si le están dando
    if (!D.seVe(m.mapa, u.x, u.y, ob.x, ob.y) || (m.humos.length && humoCorta(m, u.x, u.y, ob.x, ob.y))) return;
    const ns = D.nivelSupr(u); u.recarga = a.cad * (ns === 2 ? 2 : 1); u.tTiro = m.t; u.ang = Math.atan2(ob.y - u.y, ob.x - u.x);
    const cob = D.cobFrente(m, ob.x, ob.y, u.x, u.y); // lo cubierto que está el blanco visto desde aquí
    const p = a.prec * (1 - cob * ECON.cobTiro * (ob.movio && cob > 0 ? 0.5 : 1)) * (1 - 0.5 * (md / a.alc)) * (u.movio ? ECON.andaPrec : 1) * (ns === 2 ? ECON.clavadoPrec : ns === 1 ? ECON.suprPrec : 1) * (ob.orden === 'retirada' ? ECON.retiradaBlanco : 1), da = m.az() < p;
    m.efectos.push({ tipo: 'tiro', x1: u.x, y1: u.y, x2: ob.x, y2: ob.y, da, arma: D.SOL[u.tipo].arma, j: u.j, t: m.t });
    const amort = 1 - Math.max(0, cob) * 0.5; ob.supr = Math.min(100, ob.supr + a.supr * amort); ob.tHerido = m.t; // cada tiro que te tiran, dé o no, te aprieta contra el suelo (menos si estás cubierto)
    for (const o of m.ents) if (o.clase === 'sol' && o.j === ob.j && o !== ob && Math.abs(o.x - ob.x) < 2 && Math.abs(o.y - ob.y) < 2) o.supr = Math.min(100, o.supr + a.supr * ECON.suprVecino * amort); // y a los de al lado
    if (da) { ob.vida -= a.dano * (0.8 + m.az() * 0.4); if (ob.vida <= 0) baja(m, ob); }
  }
  function curar(m, u) { for (const o of m.ents) if (o.clase === 'sol' && o.j === u.j && o.vida > 0 && o.vida < o.vidaMax && o.supr < ECON.suprAgachado && Math.hypot(o.x - u.x, o.y - u.y) <= ECON.curaRadio) o.vida = Math.min(o.vidaMax, o.vida + ECON.cura); }
  // Colocar la carga: pegado al edificio y sin que le estén disparando, cinco segundos. Si es el centro, se acabó.
  function volar(m, u) {
    const o = m.porId.get(u.obj); if (!o || o.vida <= 0) { u.orden = 'nada'; u.obj = 0; u.canal = 0; return; }
    if (Math.hypot(o.x - u.x, o.y - u.y) > ECON.cargaDist + (D.EDIF[o.tipo].tam >= 3 ? 1 : 0)) { u.canal = 0; if (!u.ruta || u.ri >= u.ruta.length) { u.orden = 'nada'; u.obj = 0; } return; }
    u.ruta = null; if (u.supr >= ECON.suprAgachado) { u.canal = Math.max(0, u.canal - 1); return; }
    u.canal++; if (u.canal === 1) m.efectos.push({ tipo: 'cargando', x: o.x, y: o.y, j: u.j, id: o.id, t: m.t });
    if (u.canal < ECON.cargaTicks) return;
    o.vida = 0; m.efectos.push({ tipo: 'volado', x: o.x, y: o.y, j: u.j, de: o.j, clase: o.tipo, t: m.t });
    for (const q of m.ents) if (q.clase === 'sol' && q.obj === o.id) { q.orden = 'nada'; q.obj = 0; q.canal = 0; }
    if (o.tipo === 'centro') m.fin = { gana: u.j, motivo: 'centro', t: m.t };
  }
  // Lo lanzado llega: la granada revienta (hiere y clava a todos los de alrededor, sin mirar bando); el bote suelta su nube.
  function lanzados(m) {
    for (let i = m.proy.length - 1; i >= 0; i--) { const p = m.proy[i]; if (m.t < p.t1) continue; m.proy.splice(i, 1);
      if (p.k === 'humo') { m.humos.push({ x: p.x2, y: p.y2, r: ECON.humoRadio, hasta: m.t + ECON.humoDura }); m.efectos.push({ tipo: 'humo', x: p.x2, y: p.y2, t: m.t }); continue; }
      m.efectos.push({ tipo: 'explosion', x: p.x2, y: p.y2, t: m.t });
      for (const o of m.ents) { if (o.clase !== 'sol' || o.vida <= 0) continue; const d = Math.hypot(o.x - p.x2, o.y - p.y2); if (d > ECON.granadaRadio) continue; const cob = D.COBERTURA[m.mapa.terreno[Math.floor(o.y) * m.N + Math.floor(o.x)]]; o.supr = Math.min(100, o.supr + ECON.granadaSupr); o.tHerido = m.t; o.vida -= ECON.granadaDano * (1 - 0.6 * (d / ECON.granadaRadio)) * (1 - cob * 0.4); if (o.vida <= 0) baja(m, o); } }
    if (m.humos.length) m.humos = m.humos.filter((h) => h.hasta > m.t);
  }
  function drones(m) { for (const e of m.ents) if (e.orbita) { const o = e.orbita, a = o.fase + m.t * 0.004; e.x = o.x + Math.cos(a) * o.r; e.y = o.y + Math.sin(a) * o.r * 0.7; e.ang = Math.atan2(Math.cos(a) * 0.7, -Math.sin(a)); } }

  D.tick = function (m) {
    if (m.fin) return;
    m.t++;
    if (m.cola.length) { const q = m.cola; m.cola = []; for (const c of q) aplicar(m, c); }
    for (let j = 0; j < 2; j++) if (m.ia[j] && D.iaTick) D.iaTick(m, m.ia[j]);
    drones(m); if (m.proy.length || m.humos.length) lanzados(m);
    for (const u of m.ents) if (u.clase === 'sol' && u.vida > 0) mover(m, u);
    if (m.t % 4 === 0) detectar(m);
    for (const u of m.ents) { if (u.clase !== 'sol' || u.vida <= 0) continue; if (u.orden === 'volar') volar(m, u); combatir(m, u); if (D.SOL[u.tipo].cura && m.t % 2 === 0) curar(m, u); }
    // Los caídos y lo volado salen del mundo.
    let hay = false; for (const e of m.ents) if (e.vida <= 0) { hay = true; break; }
    if (hay) { m.ents = m.ents.filter((e) => { if (e.vida > 0) return true; m.porId.delete(e.id); if (e.clase === 'edif') { const r = D.EDIF[e.tipo].tam >= 3 ? 1 : 0, cx = Math.floor(e.x), cy = Math.floor(e.y); for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const c = (cy + dy) * m.N + cx + dx; if (m.mapa.paso[c]) m.paso[c] = 1; } } return false; }); }
    // El final: el atacante gana si vuela el centro; el defensor, si amanece o si al atacante no le queda quien ponga la carga.
    if (!m.fin) {
      if (m.t >= ECON.dia) m.fin = { gana: 1, motivo: 'amanecer', t: m.t };
      else if (!m.ents.some((e) => e.clase === 'sol' && e.j === 0 && D.SOL[e.tipo].carga)) m.fin = { gana: 1, motivo: 'sin asalto', t: m.t };
    }
  };
})();
