// drone.warfare — el mundo y su tick: reloj, órdenes, movimiento de los equipos, quién ve a quién, combate entre
// soldados, la carga que vuela edificios y el final de la partida. Los drones, por ahora, solo vigilan en círculo.
(function () {
  const D = globalThis.D || (globalThis.D = {});
  const ECON = D.ECON, T = D.T, TAU = Math.PI * 2;

  const DESF = (((ECON.hora0 - 6 + 24) % 24) * ECON.dia) / 24, fase = (m) => (m.t + DESF) % ECON.dia; // la partida empieza a las 22:00; la fase cuenta desde las 06:00
  D.esNoche = (m) => fase(m) >= ECON.diaLuz;
  // Cuánta luz hay, de 0 (noche cerrada) a 1 (día): baja durante el anochecer y sube al amanecer.
  D.luz = function (m) {
    const h = fase(m), c = ECON.crepusculo;
    if (h < ECON.diaLuz - c) return 1;
    if (h < ECON.diaLuz) return (ECON.diaLuz - h) / c; // anochece
    if (h < ECON.dia - c) return 0;
    return (h - (ECON.dia - c)) / c; // amanece: a las 06:00 ya es de día
  };
  D.hora = function (m) { const f = (fase(m) / ECON.dia) * 24, h = Math.floor(f + 6) % 24, mi = Math.floor((f % 1) * 60); return String(h).padStart(2, '0') + ':' + String(mi).padStart(2, '0'); }; // el día empieza a las 06:00
  D.faltaRefuerzos = (m) => Math.max(0, ECON.dia - m.t); // ticks que quedan de partida: a las 22:00 llegan los refuerzos del defensor

  // Un dron posado en su hueco junto al taller (i: el hueco). Estados: posado · vuelo · vuelve (a recargar) · carga.
  D.dronNuevo = function (m, j, t, p, i, ang) { const d = D.DRON[t], x = p.x + 0.5 + ((i % 3) - 1) * 1.5, y = p.y + 0.5 + [-1.8, 1.8, -3.2][Math.floor(i / 3) % 3]; return crear(m, 'dron', j, t, x, y, { alt: 0, ang, estado: 'posado', hueco: i, bat: d.bat || 0, batMax: d.bat || 0, casa: { x, y }, sinEnlace: 0, obj: 0, dest: null, orbita: null }); };
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
      jug: [{ personas: 0, pilotos: 0, bajas: 0, fab: 0, nFab: 0 }, { personas: 0, pilotos: 0, bajas: 0, fab: 0, nFab: 0 }], visto: [new Set(), new Set()], conocido: [new Set(), new Set()], efectos: [], cola: [], fin: null, tiros: [], caido: 0, extraccion: { x: mapa.bases[0].x + 0.5, y: mapa.bases[0].y + 0.5, r: ECON.extraeRadio }, ia: [null, null], humos: [], proy: [], hilos: [], rumbo: [[], []] };
    // Coste de pisar cada celda: a paso normal manda la velocidad; en sigilo se prefiere lo que tapa.
    m.coste = new Float32Array(N * N); m.costeSigilo = new Float32Array(N * N);
    for (let c = 0; c < N * N; c++) { const t = mapa.terreno[c], v = D.PASO[t] || 1; m.coste[c] = 1 / v; m.costeSigilo[c] = Math.max(0.5, (1 / v) * (1.5 - D.COBERTURA[t])); }
    let eq = 1; const nums = [0, 0]; // los escuadrones se numeran por bando: 1, 2, 3…
    const equipo = (j, roles, x, y, ang) => { const us = new Set(), num = ++nums[j]; roles.forEach((r, i) => { const d = (i - (roles.length - 1) / 2) * 1.3, p = D.cercaLibre(m, x + Math.cos(ang + 1.57) * d, y + Math.sin(ang + 1.57) * d, us), s = D.SOL[r]; crear(m, 'sol', j, r, p.x, p.y, { ang, eq, num, vida: s.vida, vidaMax: s.vida, orden: 'nada', ruta: null, ri: 0, sigilo: false, fuego: true, recarga: 0, supr: 0, obj: 0, canal: 0, movio: false, tTiro: -999, firma: 1, mira: ang, cdGranada: 0, cdHumo: 0 }); m.jug[j].personas++; }); eq++; };
    const edif = (j, t, p) => { if (!p) return; const e = crear(m, 'edif', j, t, p.x + 0.5, p.y + 0.5, { vida: 1 }), r = D.EDIF[t].tam >= 3 ? 1 : 0; for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const X = p.x + dx, Y = p.y + dy; if (X >= 0 && Y >= 0 && X < N && Y < N && (r === 0 || Math.abs(dy) < 1 || t === 'centro')) m.paso[Y * N + X] = 0; } return e; };
    const pilotos = (j, n) => { m.jug[j].pilotos = n; m.jug[j].personas += n; }; // están dentro: cuentan, pero no se ven
    const posado = (j, t, p, i, ang) => D.dronNuevo(m, j, t, p, i, ang);
    const orbita = (j, t, x, y, r, p, i) => { const e = D.dronNuevo(m, j, t, p, i, 0); e.estado = 'vuelo'; e.alt = D.DRON[t].alt; e.x = x; e.y = y; e.orbita = { x, y, r, fase: az() * TAU }; return e; };

    // El atacante: cuatro equipos de fuerzas especiales y solo dos pilotos.
    { const b = mapa.bases[0], f = b.frente, lado = f + Math.PI / 2;
      edif(0, 'barracon', b.barracon); edif(0, 'taller', b.taller); edif(0, 'antena', b.antenas[0]);
      equipo(0, ['asaltante', 'asaltante', 'escopetero', 'zapador'], b.x + Math.cos(f) * 5 + Math.cos(lado) * 4, b.y + Math.sin(f) * 5 + Math.sin(lado) * 4, f);
      equipo(0, ['asaltante', 'asaltante', 'escopetero', 'observador'], b.x + Math.cos(f) * 5 - Math.cos(lado) * 4, b.y + Math.sin(f) * 5 - Math.sin(lado) * 4, f);
      equipo(0, ['asaltante', 'escopetero', 'inhibidor', 'sanitario'], b.x + Math.cos(f) * 9, b.y + Math.sin(f) * 9, f);
      equipo(0, ['tirador', 'observador'], b.x + Math.cos(f) * 13 + Math.cos(lado) * 6, b.y + Math.sin(f) * 13 + Math.sin(lado) * 6, f);
      pilotos(0, 2); m.jug[0].taller = b.taller; orbita(0, 'recon', b.x + Math.cos(f) * 16, b.y + Math.sin(f) * 16, 9, b.taller, 6); posado(0, 'fpvRadio', b.taller, 0, f); posado(0, 'fpvFibra', b.taller, 1, f); }
    // El defensor: el centro con seis pilotos, dos antenas y una falsa, la estación de escucha, y una guardia de dos equipos.
    { const b = mapa.bases[1], f = b.frente;
      edif(1, 'centro', b.centro); edif(1, 'taller', b.taller); edif(1, 'barracon', b.barracon); for (const a of b.antenas) edif(1, 'antena', a); edif(1, 'falsa', b.falsa); edif(1, 'escucha', b.escucha);
      equipo(1, ['asaltante', 'asaltante', 'escopetero', 'sanitario'], b.x + Math.cos(f) * 5, b.y + Math.sin(f) * 5, f);
      equipo(1, ['asaltante', 'escopetero', 'tirador', 'inhibidor'], b.x - Math.cos(f) * 4, b.y - Math.sin(f) * 4, f);
      pilotos(1, 6); m.jug[1].taller = b.taller; orbita(1, 'recon', b.x + Math.cos(f) * 12, b.y + Math.sin(f) * 12, 11, b.taller, 6); orbita(1, 'recon', b.x + Math.cos(f) * 30, b.y + Math.sin(f) * 30, 13, b.taller, 7);
      ['fpvRadio', 'fpvRadio', 'fpvFibra', 'bombardero', 'interceptor'].forEach((t, i) => posado(1, t, b.taller, i, f)); }
    if (op.ia) for (let j = 0; j < 2; j++) if (op.ia[j] && D.iaCrear) m.ia[j] = D.iaCrear(m, j);
    detectar(m);
    return m;
  };

  // ---------- órdenes ----------
  // Se dan con D.orden y se aplican al principio del tick siguiente. Van por equipos (cmd.eqs).
  //   { t: 'mover', j, eqs, x, y }     ir a un punto (cada miembro, a su sitio alrededor)
  //   { t: 'volar', j, eqs, obj }      ir a un edificio enemigo y colocarle la carga (lo hacen asaltantes y zapadores)
  //   { t: 'detener', j, eqs }
  //   { t: 'modo', j, eqs, sigilo?, fuego? }   sigilo: lento y tapado · fuego: libre (true) o contenido (false)
  //   { t: 'retirada', j, eqs }        correr al barracón: no disparan y cuesta más darles
  //   { t: 'mover', j, eqs, x, y, hacia: {x, y} }   lo mismo, pero orientados hacia ese punto: se cubren de ese lado y miran allí
  //   { t: 'granada' | 'humo', j, eqs, x, y }   la lanza el miembro más cercano al punto, si está a tiro y el equipo no está recargando
  //   { t: 'recon', j, id, x, y }      el dron de reconocimiento va a dar vueltas sobre ese punto (si está posado, despega)
  //   { t: 'reconCasa', j, id }        vuelve al taller a recargar y se queda posado
  //   { t: 'fpv', j, tipo, obj? | x, y }   despega un FPV posado de ese tipo contra un enemigo a la vista, un edificio descubierto o un punto
  D.orden = function (m, cmd) { m.cola.push(cmd); };
  const delEquipo = (m, j, eqs) => m.ents.filter((e) => e.clase === 'sol' && e.j === j && eqs.includes(e.eq));
  function irA(m, u, x, y) { const r = D.ruta(m.N, m.paso, u.sigilo ? m.costeSigilo : m.coste, u.x, u.y, x, y); u.ruta = r; u.ri = 1; if (!r) u.orden = 'nada'; return !!r; }
  // La celda pisable y libre desde la que se alcanza a poner la carga en un edificio, la más cercana a quien va.
  function juntoA(m, o, u, usadas) {
    const al = ECON.cargaDist + (D.EDIF[o.tipo].tam >= 3 ? 1 : 0) - 0.15, cx = Math.floor(o.x), cy = Math.floor(o.y); let mejor = null, md = 1e9;
    for (let y = cy - 4; y <= cy + 4; y++) for (let x = cx - 4; x <= cx + 4; x++) { const c = y * m.N + x; if (!libre(m, x, y) || usadas.has(c) || Math.hypot(x + 0.5 - o.x, y + 0.5 - o.y) > al) continue; const d = Math.hypot(x + 0.5 - u.x, y + 0.5 - u.y); if (d < md) { md = d; mejor = { x: x + 0.5, y: y + 0.5, c }; } }
    if (mejor) { usadas.add(mejor.c); return mejor; } return D.cercaLibre(m, o.x, o.y, usadas);
  }
  function aplicar(m, cmd) {
    if (m.fin) return; if (cmd.t === 'recon' || cmd.t === 'reconCasa' || cmd.t === 'fpv') { aplicarDron(m, cmd); return; }
    if (!cmd.eqs) return; const us = delEquipo(m, cmd.j, cmd.eqs); if (!us.length) return;
    if (cmd.t === 'mover') { // cada uno, a su puesto: los mejores sitios cubiertos alrededor del punto, de cara a la amenaza
      const cx = us.reduce((s, u) => s + u.x, 0) / us.length, cy = us.reduce((s, u) => s + u.y, 0) / us.length, am = cmd.hacia ? D.haciaDonde(cmd.x, cmd.y, cmd.hacia.x, cmd.hacia.y) : D.amenaza(m, cmd.j, cmd.x, cmd.y, cx, cy), ps = D.puestos(m, cmd.x, cmd.y, us.length, am); // con «hacia», el jugador dice de qué lado quiere cubrirse
      us.forEach((u, i) => { const p = ps[i] || D.cercaLibre(m, cmd.x, cmd.y); u.orden = 'mover'; u.obj = 0; u.canal = 0; u.mira = Math.atan2(am.y - p.y, am.x - p.x); if (!irA(m, u, p.x, p.y)) { const q = D.cercaLibre(m, cmd.x, cmd.y); u.orden = 'mover'; irA(m, u, q.x, q.y); } if (u.orden === 'nada') u.ang = u.mira; }); // quien ya está en su puesto solo se gira
    }
    else if (cmd.t === 'retirada') { const b = cmd.j === 0 ? m.extraccion : m.ents.find((e) => e.clase === 'edif' && e.j === cmd.j && e.tipo === 'barracon') || m.mapa.bases[cmd.j], usadas = new Set(); for (const u of us) { const p = D.cercaLibre(m, b.x + (u.x > b.x ? 2 : -2), b.y + (u.y > b.y ? 2 : -2), usadas); u.sigilo = false; u.obj = 0; u.canal = 0; u.orden = 'retirada'; if (!irA(m, u, p.x, p.y)) u.orden = 'nada'; else u.orden = 'retirada'; } m.efectos.push({ tipo: 'retirada', j: cmd.j, x: us[0].x, y: us[0].y, t: m.t }); }
    else if (cmd.t === 'granada' || cmd.t === 'humo') {
      const g = cmd.t === 'granada', cd = g ? 'cdGranada' : 'cdHumo', alc = g ? ECON.granadaAlc : ECON.humoAlc; if (us[0][cd] > m.t) { m.efectos.push({ tipo: 'noPuede', j: cmd.j, que: 'recarga', t: m.t }); return; }
      let quien = null, md = 1e9; for (const u of us) { if (u.orden === 'retirada' || u.supr >= ECON.suprClavado) continue; const d = Math.hypot(u.x - cmd.x, u.y - cmd.y); if (d < md) { md = d; quien = u; } }
      if (!quien || md > alc) { m.efectos.push({ tipo: 'noPuede', j: cmd.j, que: quien ? 'lejos' : 'nadie', t: m.t }); return; }
      for (const u of us) u[cd] = m.t + (g ? ECON.granadaCd : ECON.humoCd); quien.tTiro = m.t; quien.ang = Math.atan2(cmd.y - quien.y, cmd.x - quien.x);
      m.proy.push({ k: cmd.t, j: cmd.j, x1: quien.x, y1: quien.y, x2: cmd.x, y2: cmd.y, t0: m.t, t1: m.t + ECON.granadaVuelo }); m.efectos.push({ tipo: 'lanza', k: cmd.t, j: cmd.j, x1: quien.x, y1: quien.y, x2: cmd.x, y2: cmd.y, t: m.t });
    }
    else if (cmd.t === 'detener') { for (const u of us) { if (u.orden === 'retirada') continue; u.orden = 'nada'; u.ruta = null; u.obj = 0; u.canal = 0; } }
    else if (cmd.t === 'modo') { for (const u of us) { if (cmd.sigilo !== undefined && u.sigilo !== cmd.sigilo) { u.sigilo = cmd.sigilo; if (u.ruta && u.ri < u.ruta.length) { const f = u.ruta[u.ruta.length - 1]; irA(m, u, f[0], f[1]); } } if (cmd.fuego !== undefined) u.fuego = cmd.fuego; } }
    else if (cmd.t === 'volar') { const o = m.porId.get(cmd.obj); if (!o || o.clase !== 'edif' || o.j === cmd.j || !m.conocido[cmd.j].has(o.id)) return; const usadas = new Set(); for (const u of us) { const p = juntoA(m, o, u, usadas); u.orden = D.SOL[u.tipo].carga ? 'volar' : 'mover'; u.obj = D.SOL[u.tipo].carga ? o.id : 0; u.canal = 0; irA(m, u, p.x, p.y); } }
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
  D.haciaDonde = function (x, y, hx, hy) { const L = Math.hypot(hx - x, hy - y) || 1; return { x: x + ((hx - x) / L) * 30, y: y + ((hy - y) / L) * 30, visto: false, puesto: true }; }; // la «amenaza» que señala el jugador: lejos, en esa dirección
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
          const oculto = o.tipo === 'centro'; let visto = false; if (!oculto) for (const d of altos) if (Math.hypot(d.x - o.x, d.y - o.y) <= ECON.dronVeEdif) { visto = true; break; } // el centro está enterrado: desde el aire no se ve
          if (!visto) for (const s of ojos) { const dd = Math.hypot(s.x - o.x, s.y - o.y); if (dd <= (oculto ? Math.max(3.5, ECON.verCentro * luzF) : ECON.verEdif * luzF) && D.seVe(m.mapa, s.x, s.y, o.x, o.y)) { visto = true; break; } }
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
    // No todos al mismo: entre los que están casi igual de cerca que el más cercano, cada uno se queda con uno (y lo mantiene unos segundos).
    { const cs = []; for (const id of m.visto[u.j]) { const o = m.porId.get(id); if (o && o.vida > 0 && Math.hypot(o.x - u.x, o.y - u.y) <= Math.min(a.alc, md + 2.5)) cs.push(o); } if (cs.length > 1) { ob = cs[(u.id + Math.floor(m.t / 100)) % cs.length]; md = Math.hypot(ob.x - u.x, ob.y - u.y); } }
    if (!u.fuego && md > 5 && m.t - (u.tHerido || -999) > 100) return; // fuego contenido: solo de cerca o si le están dando
    if (!D.seVe(m.mapa, u.x, u.y, ob.x, ob.y) || (m.humos.length && humoCorta(m, u.x, u.y, ob.x, ob.y))) return;
    const ns = D.nivelSupr(u); u.recarga = Math.round(a.cad * (ns === 2 ? ECON.clavadoCad : 1)); u.tTiro = m.t; u.ang = Math.atan2(ob.y - u.y, ob.x - u.x);
    const cob = D.cobFrente(m, ob.x, ob.y, u.x, u.y), nb = D.nivelSupr(ob); // lo cubierto que está el blanco visto desde aquí, y si está cuerpo a tierra
    const p = a.prec * (1 - cob * ECON.cobTiro * (ob.movio && cob > 0 ? 0.5 : 1)) * (1 - 0.5 * (md / a.alc)) * (u.movio ? ECON.andaPrec : 1) * (ns === 2 ? ECON.clavadoPrec : ns === 1 ? ECON.suprPrec : 1) * (ob.orden === 'retirada' ? ECON.retiradaBlanco : 1) * (nb === 2 ? ECON.clavadoBlanco : nb === 1 ? ECON.agachadoBlanco : 1), da = m.az() < p;
    m.efectos.push({ tipo: 'tiro', x1: u.x, y1: u.y, x2: ob.x, y2: ob.y, da, arma: D.SOL[u.tipo].arma, j: u.j, t: m.t });
    m.tiros.push({ ob, s: a.supr * (1 - Math.max(0, cob) * 0.5), d: da ? a.dano * (0.8 + m.az() * 0.4) : 0 }); // el efecto se aplica cuando han disparado todos: nadie saca ventaja por ir antes en la lista
  }
  // Los tiros del tick, a la vez: cada tiro que te tiran, dé o no, te aprieta contra el suelo (menos si estás cubierto), y a los de al lado, la mitad.
  function impactos(m) {
    for (const q of m.tiros) { const ob = q.ob; if (ob.vida <= 0 && !q.d) continue; ob.supr = Math.min(100, ob.supr + q.s); ob.tHerido = m.t;
      for (const o of m.ents) if (o.clase === 'sol' && o.j === ob.j && o !== ob && Math.abs(o.x - ob.x) < 2 && Math.abs(o.y - ob.y) < 2) o.supr = Math.min(100, o.supr + q.s * ECON.suprVecino);
      if (q.d && ob.vida > 0) { ob.vida -= q.d; if (ob.vida <= 0) baja(m, ob); } }
    m.tiros.length = 0;
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
    if (o.tipo === 'centro') { m.caido = m.t; m.efectos.push({ tipo: 'huida', t: m.t }); } // destruido: ahora hay que salir
  }
  // Lo lanzado llega: la granada revienta (hiere y clava a todos los de alrededor, sin mirar bando); el bote suelta su nube.
  function lanzados(m) {
    for (let i = m.proy.length - 1; i >= 0; i--) { const p = m.proy[i]; if (m.t < p.t1) continue; m.proy.splice(i, 1);
      if (p.k === 'humo') { m.humos.push({ x: p.x2, y: p.y2, r: ECON.humoRadio, hasta: m.t + ECON.humoDura }); m.efectos.push({ tipo: 'humo', x: p.x2, y: p.y2, t: m.t }); continue; }
      m.efectos.push({ tipo: 'explosion', x: p.x2, y: p.y2, t: m.t });
      for (const o of m.ents) { if (o.clase !== 'sol' || o.vida <= 0) continue; const d = Math.hypot(o.x - p.x2, o.y - p.y2); if (d > ECON.granadaRadio) continue; const cob = D.COBERTURA[m.mapa.terreno[Math.floor(o.y) * m.N + Math.floor(o.x)]]; o.supr = Math.min(100, o.supr + ECON.granadaSupr); o.tHerido = m.t; o.vida -= ECON.granadaDano * (1 - 0.6 * (d / ECON.granadaRadio)) * (1 - cob * 0.4); if (o.vida <= 0) baja(m, o); } }
    if (m.humos.length) m.humos = m.humos.filter((h) => h.hasta > m.t);
  }
  // ---------- drones ----------
  // Cada dron en el aire (o recargando para volver a salir) ocupa a un piloto.
  D.pilotosLibres = function (m, j) { let n = 0; for (const e of m.ents) if (e.clase === 'dron' && e.j === j && e.estado !== 'posado') n++; return m.jug[j].pilotos - n; };
  // De dónde sale el enlace de radio de un bando: sus antenas y sus observadores (que llevan repetidor).
  D.enlaces = function (m, j) { const f = []; for (const e of m.ents) { if (e.j !== j || e.vida <= 0) continue; if (e.clase === 'edif' && e.tipo === 'antena') f.push({ x: e.x, y: e.y, r: ECON.enlace, id: e.id }); else if (e.clase === 'sol' && e.tipo === 'observador') f.push({ x: e.x, y: e.y, r: ECON.enlaceObs, id: e.id }); } return f; };
  const conEnlace = (fs, x, y, margen) => { for (const f of fs) if (Math.hypot(f.x - x, f.y - y) <= f.r - margen) return true; return false; };
  // ¿Llega un dron de ese tipo a ese punto? El de radio, si hay enlace allí; el de fibra, si le da el carrete desde su taller.
  D.alcanza = function (m, j, tipo, x, y, casa) { return D.DRON[tipo].radio ? conEnlace(D.enlaces(m, j), x, y, 1) : Math.hypot(casa.x - x, casa.y - y) <= ECON.fibraAlc; };
  const MR = ECON.reconRadio + 1; // el dron de reconocimiento da vueltas: su punto queda ese margen dentro del enlace
  const noPuede = (m, j, que) => m.efectos.push({ tipo: 'noPuede', j, que, t: m.t });
  function aplicarDron(m, cmd) {
    const j = cmd.j;
    if (cmd.t === 'fpv') {
      let e = null; for (const q of m.ents) if (q.clase === 'dron' && q.j === j && q.tipo === cmd.tipo && q.estado === 'posado' && D.DRON[q.tipo].fpv) { e = q; break; }
      if (!e) return noPuede(m, j, 'sinFpv'); if (D.pilotosLibres(m, j) < 1) return noPuede(m, j, 'pilotos');
      let x = cmd.x, y = cmd.y, o = cmd.obj ? m.porId.get(cmd.obj) : null;
      if (o) { if (o.j === j || o.clase === 'dron' || (o.clase === 'sol' ? !m.visto[j].has(o.id) : !m.conocido[j].has(o.id))) return noPuede(m, j, 'noVisto'); x = o.x; y = o.y; }
      if (!(x >= 0 && y >= 0 && x < m.N && y < m.N)) return;
      if (!D.alcanza(m, j, e.tipo, x, y, e.casa)) return noPuede(m, j, D.DRON[e.tipo].radio ? 'enlace' : 'fibra');
      e.estado = 'vuelo'; e.alt = D.DRON[e.tipo].alt; e.obj = o ? o.id : 0; e.dest = { x, y }; e.sinEnlace = 0; if (!D.DRON[e.tipo].radio) { e.hilo = { j, pts: [[e.x, e.y]], visto: [j === 0, j === 1] }; m.hilos.push(e.hilo); } m.efectos.push({ tipo: 'fpvSale', j, id: e.id, clase: e.tipo, t: m.t }); return;
    }
    const e = m.porId.get(cmd.id); if (!e || e.clase !== 'dron' || e.j !== j || e.tipo !== 'recon') return;
    if (cmd.t === 'reconCasa') { e.orbita = null; if (e.estado === 'vuelo') e.estado = 'vuelve'; return; }
    let x = Math.max(0.5, Math.min(m.N - 0.5, cmd.x)), y = Math.max(0.5, Math.min(m.N - 0.5, cmd.y)); const fs = D.enlaces(m, j); if (!fs.length) return noPuede(m, j, 'enlace');
    if (!conEnlace(fs, x, y, MR)) { let f = null, md = 1e9; for (const q of fs) { const d = Math.hypot(q.x - x, q.y - y) - q.r; if (d < md) { md = d; f = q; } } const d = Math.hypot(f.x - x, f.y - y), k = Math.max(0, f.r - MR) / d; x = f.x + (x - f.x) * k; y = f.y + (y - f.y) * k; m.efectos.push({ tipo: 'recortado', j, x, y, t: m.t }); } // más allá del enlace no llega: se queda en el borde
    if (e.estado === 'posado') { if (D.pilotosLibres(m, j) < 1) return noPuede(m, j, 'pilotos'); e.estado = e.bat >= e.batMax * 0.5 ? 'vuelo' : 'carga'; if (e.estado === 'vuelo') e.alt = D.DRON.recon.alt; }
    e.orbita = { x, y, r: ECON.reconRadio, fase: e.orbita ? e.orbita.fase : 0 }; if (e.estado === 'vuelve' && e.bat > e.batMax * 0.5) e.estado = 'vuelo';
  }
  function cae(m, e, que) { e.vida = 0; if (e.hilo) e.hilo.pts.push([e.x, e.y]); m.efectos.push({ tipo: 'perdido', j: e.j, clase: e.tipo, que, x: e.x, y: e.y, t: m.t }); }
  function avanza(e, tx, ty, v) { const dx = tx - e.x, dy = ty - e.y, L = Math.hypot(dx, dy); if (L <= v) { e.x = tx; e.y = ty; return true; } e.x += (dx / L) * v; e.y += (dy / L) * v; e.ang = Math.atan2(dy, dx); return false; }
  // El FPV revienta: hiere y clava a quien esté cerca, sin mirar bando, y tumba antenas y demás edificios pequeños. El de radio
  // no entra bajo techo (apenas hace daño a quien está dentro de una ruina); el de fibra, sí.
  function revienta(m, e) {
    e.vida = 0; m.efectos.push({ tipo: 'fpvBoom', j: e.j, x: e.x, y: e.y, t: m.t });
    for (const o of m.ents) { if (o.vida <= 0 || o === e) continue; const d = Math.hypot(o.x - e.x, o.y - e.y);
      if (o.clase === 'sol') { if (d > ECON.fpvRadio) continue; const t = m.mapa.terreno[Math.floor(o.y) * m.N + Math.floor(o.x)], techo = t === T.RUINA && D.DRON[e.tipo].radio; o.supr = Math.min(100, o.supr + ECON.fpvSupr); o.tHerido = m.t; o.vida -= ECON.fpvDano * (1 - 0.6 * (d / ECON.fpvRadio)) * (techo ? ECON.fpvTecho : 1 - D.COBERTURA[t] * 0.3); if (o.vida <= 0) baja(m, o); }
      else if (o.clase === 'edif' && o.j !== e.j && D.EDIF[o.tipo].tam < 3 && d <= 1.3) { o.vida = 0; m.efectos.push({ tipo: 'volado', x: o.x, y: o.y, j: e.j, de: o.j, clase: o.tipo, t: m.t }); } }
  }
  function fpv(m, e, d) {
    if (e.obj) { const o = m.porId.get(e.obj); if (!o || o.vida <= 0) e.obj = 0; else if (o.clase === 'edif' || m.visto[e.j].has(o.id)) { e.dest.x = o.x; e.dest.y = o.y; } } // sigue al blanco mientras lo vea alguien; si lo pierde, va a donde lo vio por última vez
    if (!d.radio && Math.hypot(e.casa.x - e.x, e.casa.y - e.y) > ECON.fibraAlc + 1) return cae(m, e, 'fibra');
    for (const s of m.ents) { if (s.clase !== 'sol' || s.j === e.j || s.vida <= 0) continue; const dd = Math.hypot(s.x - e.x, s.y - e.y); if (dd > ECON.dronOye) continue;
      if (!e.oido) { e.oido = true; m.efectos.push({ tipo: 'fpvCerca', j: s.j, x: e.x, y: e.y, t: m.t }); }
      if (d.radio && s.tipo === 'inhibidor' && dd <= ECON.inhibeRadio) return cae(m, e, 'inhibidor');
      if (dd > ECON.dronTiroAlc || s.recarga > 0 || s.orden === 'retirada' || s.canal > 0 || D.nivelSupr(s) === 2) continue;
      const arma = D.SOL[s.tipo].arma, p = arma === 'escopeta' ? ECON.escopetaDron : arma === 'fusil' ? ECON.fusilDron : 0; if (!p) continue;
      if (!s.fuego && Math.hypot(e.dest.x - s.x, e.dest.y - s.y) > 3) continue; // con fuego contenido solo le tiran si viene a por ellos
      s.recarga = D.ARMA[arma].cad; s.tTiro = m.t; s.ang = Math.atan2(e.y - s.y, e.x - s.x); const da = m.az() < p;
      m.efectos.push({ tipo: 'tiro', x1: s.x, y1: s.y, x2: e.x, y2: e.y, da, arma, j: s.j, t: m.t }); if (da) return cae(m, e, 'derribo'); }
    const fin = avanza(e, e.dest.x, e.dest.y, d.vel); if (e.hilo && (fin || m.t % 10 === 0)) e.hilo.pts.push([e.x, e.y]); if (fin) revienta(m, e);
  }
  function drones(m) {
    let fs = [null, null];
    for (const e of m.ents) { if (e.clase !== 'dron' || e.vida <= 0 || e.estado === 'posado') continue; const d = D.DRON[e.tipo];
      if (e.estado === 'carga') { e.bat = Math.min(e.batMax, e.bat + ECON.recarga); if (e.bat >= e.batMax) { if (e.orbita) { e.estado = 'vuelo'; e.alt = d.alt; } else e.estado = 'posado'; } continue; }
      if (--e.bat <= 0) { cae(m, e, 'bateria'); continue; }
      if (d.radio) { if (!fs[e.j]) fs[e.j] = D.enlaces(m, e.j); if (conEnlace(fs[e.j], e.x, e.y, 0)) e.sinEnlace = 0; else if (++e.sinEnlace > ECON.enlaceCorte) { cae(m, e, 'enlace'); continue; } }
      if (d.fpv) { fpv(m, e, d); continue; }
      if (e.estado === 'vuelo' && (!e.orbita || e.bat < (Math.hypot(e.casa.x - e.x, e.casa.y - e.y) / d.vel) * 1.3 + 60)) { e.estado = 'vuelve'; m.efectos.push({ tipo: 'vuelve', j: e.j, id: e.id, t: m.t }); } // con la batería justa para volver, vuelve solo
      if (e.estado === 'vuelve') { if (avanza(e, e.casa.x, e.casa.y, d.vel)) { e.estado = 'carga'; e.alt = 0; } }
      else { const o = e.orbita, a = o.fase + (m.t * 0.036) / o.r; avanza(e, o.x + Math.cos(a) * o.r, o.y + Math.sin(a) * o.r * 0.7, d.vel); }
    }
  }
  // ---------- rastros: lo que delata dónde está el otro ----------
  // Una vez por segundo. (1) Rumbos de radio: emite la antena o el repetidor que lleva el enlace de un dron en el aire, y el
  // inhibidor siempre. Escuchan los observadores y la estación de escucha: cada uno da una línea hacia cada emisor enemigo, con
  // un error fijo por pareja (hasta rumboError), así que no baila. Posar los drones de radio es callarse.
  // (2) Hilos de fibra: quien pasa cerca de un hilo enemigo (o lo sobrevuela con un dron de reconocimiento) lo ve entero.
  D.emisores = function (m, j) {
    const em = new Map(), fs = D.enlaces(m, j);
    for (const e of m.ents) { if (e.j !== j || e.vida <= 0) continue; if (e.clase === 'sol' && e.tipo === 'inhibidor') em.set(e.id, e);
      else if (e.clase === 'dron' && D.DRON[e.tipo].radio && (e.estado === 'vuelo' || e.estado === 'vuelve')) { let f = null, md = 1e9; for (const q of fs) { const d = Math.hypot(q.x - e.x, q.y - e.y); if (d <= q.r && d < md) { md = d; f = q; } } if (f) em.set(f.id, f); } }
    return [...em.values()];
  };
  function rastros(m) {
    for (let j = 0; j < 2; j++) { const em = D.emisores(m, 1 - j), rs = [], antes = m.rumbo[j].length;
      if (em.length) for (const o of m.ents) { if (o.j !== j || o.vida <= 0 || !((o.clase === 'sol' && o.tipo === 'observador') || (o.clase === 'edif' && o.tipo === 'escucha'))) continue;
        for (const e of em) { const h = Math.imul((o.id * 7919 + e.id * 104729) ^ m.semilla, 2654435761) >>> 0; rs.push({ x: o.x, y: o.y, ang: Math.atan2(e.y - o.y, e.x - o.x) + (h / 4294967296 - 0.5) * 2 * ECON.rumboError, de: o.id, a: e.id }); } }
      m.rumbo[j] = rs; if (rs.length && !antes) m.efectos.push({ tipo: 'rumbo', j, t: m.t });
      for (const h of m.hilos) { if (h.visto[j] || h.j === j) continue; let v = false;
        for (const o of m.ents) { if (o.j !== j || o.vida <= 0) continue; const r = o.clase === 'sol' ? ECON.hiloVe : o.clase === 'dron' && o.tipo === 'recon' && o.alt ? ECON.hiloVeDron : 0; if (!r) continue; for (const p of h.pts) if (Math.abs(p[0] - o.x) <= r && Math.abs(p[1] - o.y) <= r) { v = true; m.efectos.push({ tipo: 'hilo', j, x: p[0], y: p[1], t: m.t }); break; } if (v) break; }
        if (v) h.visto[j] = true; } }
  }
  D.rastros = rastros;
  // El taller, mientras siga en pie, va sacando FPV hasta tener el tope posado: dos de radio por cada uno de fibra.
  function fabricar(m) {
    for (let j = 0; j < 2; j++) { const J = m.jug[j]; if (!J.taller || !m.ents.some((e) => e.clase === 'edif' && e.j === j && e.tipo === 'taller')) continue;
      let n = 0; const huecos = new Set(); for (const e of m.ents) if (e.clase === 'dron' && e.j === j) { huecos.add(e.hueco); if (D.DRON[e.tipo].fpv && e.estado === 'posado') n++; }
      if (n >= ECON.fpvTope[j]) { J.fab = 0; continue; } J.fab += 20; if (J.fab < ECON.fabrica[j]) continue; J.fab = 0;
      let i = 0; while (huecos.has(i)) i++; const t = J.nFab++ % 3 === 2 ? 'fpvFibra' : 'fpvRadio'; D.dronNuevo(m, j, t, J.taller, i, m.mapa.bases[j].frente); m.efectos.push({ tipo: 'fabricado', j, clase: t, t: m.t }); }
  }

  D.tick = function (m) {
    if (m.fin) return;
    m.t++;
    if (m.cola.length) { const q = m.cola; m.cola = []; for (const c of q) aplicar(m, c); }
    for (let j = 0; j < 2; j++) if (m.ia[j] && D.iaTick) D.iaTick(m, m.ia[j]);
    drones(m); if (m.t % 20 === 0) { fabricar(m); rastros(m); } if (m.proy.length || m.humos.length) lanzados(m);
    for (const u of m.ents) if (u.clase === 'sol' && u.vida > 0) mover(m, u);
    if (m.t % 4 === 0) detectar(m);
    for (const u of m.ents) { if (u.clase !== 'sol' || u.vida <= 0) continue; if (u.orden === 'volar') volar(m, u); combatir(m, u); if (D.SOL[u.tipo].cura && m.t % 2 === 0) curar(m, u); } if (m.tiros.length) impactos(m);
    // Los caídos y lo volado salen del mundo.
    let hay = false; for (const e of m.ents) if (e.vida <= 0) { hay = true; break; }
    if (hay) { m.ents = m.ents.filter((e) => { if (e.vida > 0) return true; m.porId.delete(e.id); if (e.clase === 'edif') { const r = D.EDIF[e.tipo].tam >= 3 ? 1 : 0, cx = Math.floor(e.x), cy = Math.floor(e.y); for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const c = (cy + dy) * m.N + cx + dx; if (m.mapa.paso[c]) m.paso[c] = 1; } } return false; }); }
    // El final. Entrar, destruir y huir: el atacante gana cuando, volado el centro, todos los suyos que siguen vivos están en la
    // zona de extracción. El defensor gana si dan las 22:00 (llegan sus refuerzos), si al atacante no le queda quien ponga la
    // carga o si, volado el centro, no sale nadie.
    if (!m.fin) {
      if (m.t >= ECON.dia) m.fin = { gana: 1, motivo: m.caido ? 'atrapados' : 'refuerzos', t: m.t };
      else if (!m.caido) { if (!m.ents.some((e) => e.clase === 'sol' && e.j === 0 && D.SOL[e.tipo].carga)) m.fin = { gana: 1, motivo: 'sin asalto', t: m.t }; }
      else if (m.t % 10 === 0) { let vivos = 0, fuera = 0; const z = m.extraccion; for (const e of m.ents) if (e.clase === 'sol' && e.j === 0) { vivos++; if (Math.hypot(e.x - z.x, e.y - z.y) > z.r) fuera++; }
        if (!vivos) m.fin = { gana: 1, motivo: 'sin extraccion', t: m.t }; else if (!fuera) m.fin = { gana: 0, motivo: 'extraccion', salen: vivos, t: m.t }; }
    }
  };
})();
