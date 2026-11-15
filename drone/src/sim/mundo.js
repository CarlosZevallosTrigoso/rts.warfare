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
      jug: [{ personas: 0, pilotos: 0, bajas: 0 }, { personas: 0, pilotos: 0, bajas: 0 }], visto: [new Set(), new Set()], conocido: [new Set(), new Set()], efectos: [], cola: [], fin: null, ia: [null, null] };
    // Coste de pisar cada celda: a paso normal manda la velocidad; en sigilo se prefiere lo que tapa.
    m.coste = new Float32Array(N * N); m.costeSigilo = new Float32Array(N * N);
    for (let c = 0; c < N * N; c++) { const t = mapa.terreno[c], v = D.PASO[t] || 1; m.coste[c] = 1 / v; m.costeSigilo[c] = Math.max(0.5, (1 / v) * (1.5 - D.COBERTURA[t])); }
    let eq = 1;
    const equipo = (j, roles, x, y, ang) => { const us = new Set(); roles.forEach((r, i) => { const d = (i - (roles.length - 1) / 2) * 1.3, p = D.cercaLibre(m, x + Math.cos(ang + 1.57) * d, y + Math.sin(ang + 1.57) * d, us), s = D.SOL[r]; crear(m, 'sol', j, r, p.x, p.y, { ang, eq, vida: s.vida, vidaMax: s.vida, orden: 'nada', ruta: null, ri: 0, sigilo: false, fuego: true, recarga: 0, supr: 0, obj: 0, canal: 0, movio: false, tTiro: -999, firma: 1 }); m.jug[j].personas++; }); eq++; };
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
  D.orden = function (m, cmd) { m.cola.push(cmd); };
  const delEquipo = (m, j, eqs) => m.ents.filter((e) => e.clase === 'sol' && e.j === j && eqs.includes(e.eq));
  function irA(m, u, x, y) { const r = D.ruta(m.N, m.paso, u.sigilo ? m.costeSigilo : m.coste, u.x, u.y, x, y); u.ruta = r; u.ri = 1; if (!r) u.orden = 'nada'; return !!r; }
  function aplicar(m, cmd) {
    if (m.fin || !cmd.eqs) return; const us = delEquipo(m, cmd.j, cmd.eqs); if (!us.length) return;
    if (cmd.t === 'mover') { const usadas = new Set(); for (const u of us) { const p = D.cercaLibre(m, cmd.x, cmd.y, usadas); u.orden = 'mover'; u.obj = 0; u.canal = 0; irA(m, u, p.x, p.y); } }
    else if (cmd.t === 'detener') { for (const u of us) { u.orden = 'nada'; u.ruta = null; u.obj = 0; u.canal = 0; } }
    else if (cmd.t === 'modo') { for (const u of us) { if (cmd.sigilo !== undefined && u.sigilo !== cmd.sigilo) { u.sigilo = cmd.sigilo; if (u.ruta && u.ri < u.ruta.length) { const f = u.ruta[u.ruta.length - 1]; irA(m, u, f[0], f[1]); } } if (cmd.fuego !== undefined) u.fuego = cmd.fuego; } }
    else if (cmd.t === 'volar') { const o = m.porId.get(cmd.obj); if (!o || o.clase !== 'edif' || o.j === cmd.j || !m.conocido[cmd.j].has(o.id)) return; const usadas = new Set(); for (const u of us) { const p = D.cercaLibre(m, o.x + (u.x > o.x ? 1.6 : -1.6), o.y + (u.y > o.y ? 1.6 : -1.6), usadas); u.orden = D.SOL[u.tipo].carga ? 'volar' : 'mover'; u.obj = D.SOL[u.tipo].carga ? o.id : 0; u.canal = 0; irA(m, u, p.x, p.y); } }
  }

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
        for (const d of altos) { if (techo && !o.movio && m.t - o.tTiro >= ECON.tiroDelata) break; const r = ECON.dronVe * (arbol && !o.movio ? 0.4 : techo ? 0.5 : 1); if (Math.hypot(d.x - o.x, d.y - o.y) <= r) { visto = true; break; } }
        if (!visto) for (const s of ojos) { const dd = Math.hypot(s.x - o.x, s.y - o.y), r = Math.max(1.5, D.SOL[s.tipo].ver * luzF * o.firma); if (dd <= r && D.seVe(m.mapa, s.x, s.y, o.x, o.y)) { visto = true; break; } }
        if (visto) ve.add(o.id);
      }
    }
  }
  D.detectar = detectar;

  // ---------- movimiento ----------
  function mover(m, u) {
    u.movio = false; if (u.supr > 0) u.supr--; if (u.recarga > 0) u.recarga--;
    if (!u.ruta || u.ri >= u.ruta.length) { if (u.orden === 'mover') u.orden = 'nada'; return; }
    if (u.canal > 0) return;
    const d = D.SOL[u.tipo], t = m.mapa.terreno[Math.floor(u.y) * m.N + Math.floor(u.x)];
    let paso = d.vel * (D.PASO[t] || 1) * (u.sigilo ? ECON.sigiloVel : 1) * (u.supr > 0 ? ECON.suprVel : 1) * (0.6 + 0.4 * (u.vida / u.vidaMax));
    while (paso > 0 && u.ri < u.ruta.length) { const [px, py] = u.ruta[u.ri], dx = px - u.x, dy = py - u.y, L = Math.hypot(dx, dy); if (L <= paso) { u.x = px; u.y = py; u.ri++; paso -= L; } else { u.x += (dx / L) * paso; u.y += (dy / L) * paso; u.ang = Math.atan2(dy, dx); paso = 0; } u.movio = true; }
  }

  // ---------- combate ----------
  function baja(m, u) { u.vida = 0; m.jug[u.j].personas--; m.jug[u.j].bajas++; m.efectos.push({ tipo: 'baja', x: u.x, y: u.y, j: u.j, clase: u.tipo, t: m.t }); }
  function combatir(m, u) {
    const a = D.ARMA[D.SOL[u.tipo].arma]; if (u.recarga > 0 || u.canal > 0) return;
    let ob = null, md = a.alc; for (const id of m.visto[u.j]) { const o = m.porId.get(id); if (!o || o.vida <= 0) continue; const d = Math.hypot(o.x - u.x, o.y - u.y); if (d < md) { md = d; ob = o; } }
    if (!ob) return;
    if (!u.fuego && md > 5 && m.t - (u.tHerido || -999) > 100) return; // fuego contenido: solo de cerca o si le están dando
    if (!D.seVe(m.mapa, u.x, u.y, ob.x, ob.y)) return;
    u.recarga = a.cad; u.tTiro = m.t; u.ang = Math.atan2(ob.y - u.y, ob.x - u.x);
    const cob = D.COBERTURA[m.mapa.terreno[Math.floor(ob.y) * m.N + Math.floor(ob.x)]];
    const p = a.prec * (1 - cob * ECON.cobTiro * (ob.movio ? 0.5 : 1)) * (1 - 0.5 * (md / a.alc)) * (u.movio ? ECON.andaPrec : 1) * (u.supr > 0 ? ECON.suprPrec : 1), da = m.az() < p;
    m.efectos.push({ tipo: 'tiro', x1: u.x, y1: u.y, x2: ob.x, y2: ob.y, da, arma: D.SOL[u.tipo].arma, j: u.j, t: m.t });
    ob.supr = Math.max(ob.supr, ECON.supr); ob.tHerido = m.t;
    for (const o of m.ents) if (o.clase === 'sol' && o.j === ob.j && o !== ob && Math.abs(o.x - ob.x) < 2 && Math.abs(o.y - ob.y) < 2) o.supr = Math.max(o.supr, ECON.supr * 0.6); // los de al lado también se agachan
    if (da) { ob.vida -= a.dano * (0.8 + m.az() * 0.4); if (ob.vida <= 0) baja(m, ob); }
  }
  function curar(m, u) { for (const o of m.ents) if (o.clase === 'sol' && o.j === u.j && o.vida > 0 && o.vida < o.vidaMax && o.supr <= 0 && Math.hypot(o.x - u.x, o.y - u.y) <= ECON.curaRadio) o.vida = Math.min(o.vidaMax, o.vida + ECON.cura); }
  // Colocar la carga: pegado al edificio y sin que le estén disparando, cinco segundos. Si es el centro, se acabó.
  function volar(m, u) {
    const o = m.porId.get(u.obj); if (!o || o.vida <= 0) { u.orden = 'nada'; u.obj = 0; u.canal = 0; return; }
    if (Math.hypot(o.x - u.x, o.y - u.y) > ECON.cargaDist + (D.EDIF[o.tipo].tam >= 3 ? 1 : 0)) { u.canal = 0; if (!u.ruta || u.ri >= u.ruta.length) { u.orden = 'nada'; u.obj = 0; } return; }
    u.ruta = null; if (u.supr > 0) { u.canal = Math.max(0, u.canal - 1); return; }
    u.canal++; if (u.canal === 1) m.efectos.push({ tipo: 'cargando', x: o.x, y: o.y, j: u.j, id: o.id, t: m.t });
    if (u.canal < ECON.cargaTicks) return;
    o.vida = 0; m.efectos.push({ tipo: 'volado', x: o.x, y: o.y, j: u.j, de: o.j, clase: o.tipo, t: m.t });
    for (const q of m.ents) if (q.clase === 'sol' && q.obj === o.id) { q.orden = 'nada'; q.obj = 0; q.canal = 0; }
    if (o.tipo === 'centro') m.fin = { gana: u.j, motivo: 'centro', t: m.t };
  }
  function drones(m) { for (const e of m.ents) if (e.orbita) { const o = e.orbita, a = o.fase + m.t * 0.004; e.x = o.x + Math.cos(a) * o.r; e.y = o.y + Math.sin(a) * o.r * 0.7; e.ang = Math.atan2(Math.cos(a) * 0.7, -Math.sin(a)); } }

  D.tick = function (m) {
    if (m.fin) return;
    m.t++;
    if (m.cola.length) { const q = m.cola; m.cola = []; for (const c of q) aplicar(m, c); }
    for (let j = 0; j < 2; j++) if (m.ia[j] && D.iaTick) D.iaTick(m, m.ia[j]);
    drones(m);
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
