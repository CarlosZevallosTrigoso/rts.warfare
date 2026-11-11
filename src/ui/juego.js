// rts.warfare — interfaz: dibujo en canvas, entrada y barra lateral. Lee el mundo y emite comandos.
(function () {
  const W = globalThis.W;
  const EDIF = W.EDIF, UNID = W.UNID;
  const TAU = Math.PI * 2;

  // Toda la paleta vive aquí: cambiar de tema no cuesta nada.
  const PALETAS = {
    // Grises para todo lo que es interfaz y terreno; el color queda para bandos y recursos.
    clara:  { fondo: '#ededed', llano: '#f5f5f5', camino: '#d9d2c2', roca: '#5a5a5a', agua: '#aebfcc', bosque: '#c6cfbd', tinta: '#1a1a1a', mineral: '#4d7a38', raro: '#7d5aa6', niebla: [178, 178, 178], velo: 150, yo: '#3b6ea5', yoOsc: '#22466b', rival: '#c9622b', rivalOsc: '#853d15', bien: '#4d7a38', mal: '#b0362f' },
    oscura: { fondo: '#1c1c1c', llano: '#2c2c2c', camino: '#4b463c', roca: '#666666', agua: '#27353f', bosque: '#343d2f', tinta: '#e6e6e6', mineral: '#8fb574', raro: '#b08ad6', niebla: [8, 8, 8],       velo: 140, yo: '#6aa0d8', yoOsc: '#35597f', rival: '#e08a4f', rivalOsc: '#96552a', bien: '#8fb574', mal: '#d0554a' },
  };
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

  // Pantalla inicial: opciones de la partida. Los mismos valores viajan en la dirección
  // (?s=semilla&n=lado&min=minerales&ia=nivel); con &ya=1 se salta el menú.
  W.iniciar = function () {
    const $ = (id) => document.getElementById(id);
    const params = new URLSearchParams(location.search);
    try { if (localStorage.getItem('rts.tema') === 'oscura') document.body.dataset.tema = 'oscura'; } catch (e) { /* tema por defecto */ }
    const op = { n: '512', min: '2500', ia: 'normal', est: 'azar', red: 'si' };
    for (const k in op) {
      const cont = $('op-' + k), v = params.get(k);
      if (v && cont.querySelector('[data-v="' + CSS.escape(v) + '"]')) op[k] = v;
      const marcar = () => { for (const b of cont.children) b.classList.toggle('on', b.dataset.v === op[k]); };
      for (const b of cont.children) b.addEventListener('click', () => { op[k] = b.dataset.v; marcar(); });
      marcar();
    }
    if (params.get('s')) $('op-s').value = params.get('s');
    const empezar = () => {
      let semilla = parseInt($('op-s').value, 10);
      if (!Number.isFinite(semilla) || semilla < 0) semilla = Math.floor(Date.now() % 1000000);
      const q = 's=' + semilla + '&n=' + op.n + '&min=' + op.min + '&ia=' + op.ia + '&est=' + op.est + '&red=' + op.red;
      try { history.replaceState(null, '', location.pathname + '?' + q); } catch (e) { /* en file:// puede no dejar */ }
      $('menu').hidden = true;
      let rep = null; // ?rep=1: se vuelve a ver la partida apuntada en esta pestaña
      if (params.get('rep')) { try { const g = JSON.parse(sessionStorage.getItem('rts.rep')); if (g && g.q === q && Array.isArray(g.c)) rep = g; } catch (e) { /* sin repetición: partida normal */ } }
      W.jugar({ semilla, N: +op.n, inicio: +op.min, ia: op.ia, estilo: op.est, red: op.red, consulta: q, repeticion: rep });
    };
    $('empezar').addEventListener('click', empezar);
    // Partida guardada: se ofrece continuarla, y con ?cargar=1 se entra directo (así funciona «cargar la guardada» desde dentro).
    const continuar = () => {
      try {
        const c = W.cargar(localStorage.getItem('rts.guardado'));
        $('menu').hidden = true;
        W.jugar(Object.assign({}, c.extra.op, { guardado: c }));
      } catch (e) { $('continuar').textContent = 'La partida guardada no se pudo leer'; $('continuar').disabled = true; }
    };
    let hayGuardada = false;
    try { hayGuardada = !!localStorage.getItem('rts.guardado'); } catch (e) { /* sin almacenamiento */ }
    $('continuar').hidden = !hayGuardada;
    $('continuar').addEventListener('click', continuar);
    if (hayGuardada && params.get('cargar')) { try { history.replaceState(null, '', location.pathname); } catch (e) { /* da igual */ } continuar(); return; }
    $('op-s').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') empezar(); });
    $('tituloMenu').addEventListener('click', () => location.reload());
    if (params.has('ya')) empezar();
  };

  W.jugar = function (op) {
    const $ = (id) => document.getElementById(id);
    const semilla = op.semilla;
    const cargado = op.guardado || null; // partida guardada: el mundo y la IA vienen ya hechos
    const m = cargado ? cargado.m : W.crearMundo(semilla, { N: op.N, inicio: op.inicio, logistica: op.red !== 'no' }), estilos = Object.keys(W.ESTILOS_IA);
    const rep = op.repeticion ? op.repeticion.c : null, repFin = op.repeticion ? op.repeticion.fin : 0; // repetición: las órdenes apuntadas de una partida; se reproducen solas, sin rival que piense ni jugador que mande
    if (rep) m.soloRep = true; else if (!cargado) m.registro = [];
    let repI = 0, repVel = 1, repAvisado = false;
    const ia = cargado ? cargado.extra.ia : rep || op.ia === 'no' ? null : W.iaCrear(1, op.ia, W.ESTILOS_IA[op.estilo] ? op.estilo : estilos[semilla % estilos.length]), N = m.N, YO = 0, J = m.jug[YO];
    const hist = cargado && cargado.extra.hist ? cargado.extra.hist : []; // una muestra cada 30 s, para el resumen final
    W.mundo = m; // a mano en la consola, para depurar

    let tema = 'clara';
    try { tema = localStorage.getItem('rts.tema') === 'oscura' ? 'oscura' : 'clara'; } catch (e) { /* sin almacenamiento: tema por defecto */ }
    let P = PALETAS[tema], COL = null; // COL: colores de ficha por bando

    const lienzo = $('lienzo'), ctx = lienzo.getContext('2d');
    const mini = $('mini'), mctx = mini.getContext('2d'), MS = mini.width;
    let cw = 0, ch = 0, dpr = 1;
    const cam = cargado && cargado.extra.cam ? cargado.extra.cam : { x: m.mapa.bases[YO].x, y: m.mapa.bases[YO].y, z: 30 };
    W.cam = cam;
    const son = W.crearSonido();
    W.son = son;
    const oido = { llamada: 0, t: m.t, listas: 0, producidas: J.producidas, edificios: 0, bajas: 0, alerta: -999 };
    let tecleado = ''; // últimas letras escritas, para el código "god"
    const sel = new Set(), grupos = {}, teclas = new Set(), marcas = [];
    let modo = null; // null | 'colocar' | 'amover' | 'patrulla'
    const FORMAS = ['grupo', 'linea', 'columna', 'cuna', 'cuadro'];
    let forma = 'grupo'; // formación con la que llegan los grupos a su destino
    let tipoColocar = null; // edificio que se está colocando
    const obraLista = (tipo) => J.obras.some((o) => o.listo && o.tipo === tipo);
    let pausa = false, cuadros = 0, nieblaVista = -1, terrVisto = 0, iaQuieta = false;
    const raton = { x: 0, y: 0, izq: false, x0: 0, y0: 0, medio: false, dentro: false, der: false, arrastre: false, xd: 0, yd: 0 };

    // ---------- capas pre-dibujadas ----------
    const cTerr = document.createElement('canvas'); cTerr.width = cTerr.height = N;
    const xTerr = cTerr.getContext('2d');
    const cRed = document.createElement('canvas'); cRed.width = cRed.height = N; // la cobertura de la red propia, para la vista de la red
    const xRed = cRed.getContext('2d'), conRed = m.logistica !== false; let verRed = false, redVista = -1;
    function pintarRed() {
      const f = W.cobertura(m, YO), img = xRed.createImageData(N, N), d = img.data, c = hex(P.yo);
      for (let i = 0; i < N * N; i++) if (f[i]) { d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]; d[i * 4 + 3] = 46; }
      xRed.putImageData(img, 0, 0); redVista = m.redV;
    }
    const cNie = document.createElement('canvas'); cNie.width = cNie.height = N;
    const xNie = cNie.getContext('2d'), imgNie = xNie.createImageData(N, N);
    function pintarTerreno() {
      const img = xTerr.createImageData(N, N), cols = [P.llano, P.roca, P.agua, P.bosque, P.llano, P.agua].map(hex); // el camino se dibuja aparte, como un carril; debajo queda suelo despejado
      for (let i = 0; i < N * N; i++) { const c = cols[m.mapa.terreno[i]]; img.data[i * 4] = c[0]; img.data[i * 4 + 1] = c[1]; img.data[i * 4 + 2] = c[2]; img.data[i * 4 + 3] = 255; }
      xTerr.putImageData(img, 0, 0);
    }
    function pintarNiebla() {
      const f = m.niebla[YO], d = imgNie.data, c = P.niebla;
      for (let i = 0; i < N * N; i++) { d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]; d[i * 4 + 3] = rep || f[i] === 2 ? 0 : f[i] === 1 ? P.velo : 255; } // en la repetición se ve todo
      xNie.putImageData(imgNie, 0, 0);
      nieblaVista = m.nieblaV;
    }
    function ponerTema(t) {
      tema = t; P = PALETAS[t]; document.body.dataset.tema = t;
      try { localStorage.setItem('rts.tema', t); } catch (e) { /* no pasa nada */ }
      const comun = { luz: P.llano, suelo: P.llano, mineral: P.mineral, raro: P.raro, humo: P.roca, fuego: '#e8912d', mal: P.mal, agua: '#4f86b0', tinta: P.tinta };
      const tono = (h, f) => { const c = hex(h); return 'rgb(' + Math.round(c[0] * f) + ',' + Math.round(c[1] * f) + ',' + Math.round(c[2] * f) + ')'; };
      const lado = (c) => ({ base: c, osc: c, luz: c, suelo: c, mineral: c, raro: c, humo: c, fuego: 'rgba(0,0,0,0)', mal: c, agua: c, tinta: c }); // paleta de un solo tono: el canto de las fichas
      COL = { yo: Object.assign({ base: P.yo, osc: P.yoOsc, pared: tono(P.yoOsc, 0.68) }, comun), rival: Object.assign({ base: P.rival, osc: P.rivalOsc, pared: tono(P.rivalOsc, 0.68) }, comun) };
      COL.yoLado = lado(COL.yo.pared); COL.rivalLado = lado(COL.rival.pared);
      COL.caminoBorde = tono(P.camino, tema === 'clara' ? 0.82 : 1.3); COL.puente = tono(P.camino, tema === 'clara' ? 0.5 : 1.7);
      COL.rocaCara = tono(P.roca, tema === 'clara' ? 0.62 : 0.55); COL.rocaLuz = tono(P.roca, tema === 'clara' ? 1.35 : 1.3); COL.copa = tono(P.bosque, tema === 'clara' ? 0.74 : 1.5);
      pintarTerreno(); pintarNiebla(); hacerIconos();
    }

    function ajustar() {
      dpr = window.devicePixelRatio || 1;
      const r = lienzo.getBoundingClientRect();
      cw = r.width; ch = r.height;
      lienzo.width = Math.max(1, Math.round(cw * dpr)); lienzo.height = Math.max(1, Math.round(ch * dpr));
      limitarCam();
    }
    function limitarCam() {
      // El mapa cubre siempre toda la ventana: ni zoom ni cámara dejan ver fuera de él.
      cam.z = Math.max(Math.max(cw, ch) / N, Math.min(120, cam.z));
      const mx = cw / 2 / cam.z, my = ch / 2 / cam.z;
      cam.x = Math.max(mx, Math.min(N - mx, cam.x)); cam.y = Math.max(my, Math.min(N - my, cam.y));
    }
    const aMundoX = (sx) => cam.x + (sx - cw / 2) / cam.z, aMundoY = (sy) => cam.y + (sy - ch / 2) / cam.z;
    const visible = (x, y) => x >= 0 && y >= 0 && x < N && y < N && (rep || m.niebla[YO][Math.floor(y) * N + Math.floor(x)] === 2);
    const veo = (e) => rep || e.j === YO || (visible(e.edif ? e.cx : e.x, e.edif ? e.cy : e.y) && !(W.oculta(m, e) && m.t - (e.delatada === undefined ? -99 : e.delatada) > 20)); // al enemigo escondido no se le ve hasta descubrirlo

    // Volumen: la vista sigue siendo cenital, pero cada cosa tiene altura. Los edificios muestran su pared sur y el tejado
    // se dibuja desplazado hacia arriba; las unidades llevan un canto; la roca y el agua, un escalón.
    const ALTO = { patio: 0.3, central: 0.36, refineria: 0.32, bomba: 0.2, cuartel: 0.26, extractor: 0.3, fabrica: 0.34, torreta: 0.22, torreCanon: 0.36, aerodromo: 0.08, antiaerea: 0.22, estacion: 0.26, deposito: 0.22, obras: 0.28, misilera: 0.12, interceptor: 0.24 };
    function entEn(wx, wy, holgura) { // holgura: margen extra (en celdas) para acertar con el dedo
      let mejor = null, md = Infinity;
      for (const e of m.ents) {
        if (!veo(e)) continue;
        if (e.infra) { // un tramo de camino: se acierta sobre su carril, y cede ante cualquier unidad
          if (md <= 40) continue;
          const p = e.pts; let dm = Math.hypot(wx - p[0], wy - p[1]);
          for (let k = 0; k + 3 < p.length; k += 2) { const bx = p[k + 2] - p[k], by = p[k + 3] - p[k + 1], q = Math.max(0, Math.min(1, ((wx - p[k]) * bx + (wy - p[k + 1]) * by) / (bx * bx + by * by || 1))); dm = Math.min(dm, Math.hypot(wx - p[k] - bx * q, wy - p[k + 1] - by * q)); }
          if (dm < 0.55 + (holgura || 0)) { mejor = e; md = 40; }
          continue;
        }
        if (e.edif) { if (wx >= e.x && wx < e.x + e.tam && wy >= e.y - (cam.z >= 8 ? ALTO[e.tipo] : 0) && wy < e.y + e.tam && md > 50) { mejor = e; md = 50; } } // el tejado sobresale por arriba
        else { const d = Math.hypot(e.x - wx, e.y - wy); if (d < UNID[e.tipo].radio + 0.3 + (holgura || 0) && d < md) { mejor = e; md = d; } }
      }
      return mejor;
    }
    const unidadesSel = () => { const out = []; for (const id of sel) { const e = m.porId.get(id); if (e && !e.edif) out.push(e); } return out; };
    const esquinaColocar = (tipo) => { const t = EDIF[tipo].tam; return { x: Math.round(aMundoX(raton.x) - t / 2), y: Math.round(aMundoY(raton.y) - t / 2) }; };

    const NOMBRE_TERRENO = ['Llano', 'Roca · no se puede pasar', 'Agua · no se puede pasar', 'Bosque · cubre y esconde a la infantería; los vehículos no pasan', 'Camino · los vehículos van mucho más rápido', 'Puente · cruza el agua; si lo destruyen, se cierra el paso'];
    const sitioPorCelda = new Map(m.mapa.sitios.map((s) => [s.y * N + s.x, s.tipo]));
    // Lo que el terreno (o la trinchera) le da o le quita a una unidad, en texto.
    const pct = (k) => Math.round(Math.abs(1 - k) * 100) + ' %';
    function efectos(e) {
      if (e.edif || UNID[e.tipo].aire) return '';
      const inf = UNID[e.tipo].cat === 'inf', out = [];
      if (W.enTrinchera(m, e)) out.push('trinchera: −' + pct(W.ECON.trinchera) + ' daño, no la atropellan');
      if (W.enBosque(m, e)) out.push(inf ? 'bosque: −' + pct(W.ECON.bosqueCubre) + ' daño' : 'abriendo bosque');
      if (!inf && !UNID[e.tipo].aire && m.via && m.via[e.j][Math.floor(e.y) * N + Math.floor(e.x)]) out.push('camino: +' + Math.round((W.ECON.caminoVel - 1) * 100) + ' % velocidad');
      return out.join(' · ');
    }
    const NOMBRE_PUESTO = { antena: 'Antena (da visión de la zona)', deposito: 'Depósito (da petróleo)', taller: 'Taller (repara a los tuyos cerca)' };
    function bajoCursor() {
      const wx = aMundoX(raton.x), wy = aMundoY(raton.y);
      if (wx < 0 || wy < 0 || wx >= N || wy >= N) return '';
      const c = Math.floor(wy) * N + Math.floor(wx);
      if (!m.niebla[YO][c]) return 'Sin explorar';
      const e = entEn(wx, wy);
      if (e) {
        let t = (e.edif ? EDIF : UNID)[e.tipo].nombre + (e.j === YO ? '' : ' rival') + ' · ' + Math.ceil(e.vida) + '/' + e.vidaMax;
        if (e.tipo === 'cosechadora' && e.j === YO) t += ' · carga ' + e.carga;
        if (e.cava > 0) t += ' · cavando'; else if (e.guardia && e.j === YO && !W.enTrinchera(m, e)) t += ' · en guardia';
        if (UNID[e.tipo] && UNID[e.tipo].aire && e.j === YO) t += (e.enTierra ? ' · en tierra' : e.repostando ? ' · vuelve a repostar' : e.patrulla ? ' · patrulla' : '') + ' · combustible ' + Math.round(e.fuel / UNID[e.tipo].fuel * 100) + ' %';
        if (!e.edif && e.rango) t += ' · veterano ' + '▲'.repeat(e.rango);
        if (!e.edif && e.j === YO && e.bajas) t += ' · ' + e.bajas + (e.bajas === 1 ? ' baja' : ' bajas');
        if (e.arregla && e.j === YO) t += ' · reparando';
        if (!e.edif && UNID[e.tipo].plazas && e.j === YO) t += ' · ' + e.pasajeros.length + '/' + UNID[e.tipo].plazas + ' dentro';
        if (!e.edif && UNID[e.tipo].mando && e.j === YO) t += e.sinInfo ? ' · sin información: apagado' : ' · mando activo';
        if (!e.edif && e.j === YO && W.oculta(m, e)) t += ' · oculta';
        if (e.retirando) t += ' · se retira a reparar'; else if (e.huye > m.t) t += ' · huye';
        if (e.j === YO && conRed) { if (e.edif && !e.infra && !e.conRed) t += e.tipo === 'deposito' ? ' · sin conexión: únelo a tu base con un ingeniero civil' : ' · fuera de la red'; if (e.linea && !e.conRed) t += ' · no llega a tu red'; if (e.sinLuz) t += ' · sin energía: a media marcha'; if (!e.edif && e.sinSum >= W.ECON.sinSum) t += ' · sin suministro: dispara más lento y no se repara'; }
        if (e.tipo === 'misilera' && e.j === YO) { const g = Object.keys(MIS).filter((k) => e.silo && e.silo[k]).map((k) => e.silo[k] + ' ' + MIS[k].nombre).join(', '); t += ' · ' + (g || 'sin misiles'); }
        if (e.tipo === 'interceptor' && e.j === YO) t += ' · cargas ' + (e.cargas === undefined ? EDIF.interceptor.cargas : e.cargas) + '/' + EDIF.interceptor.cargas;
        if (e.hack > m.t) t += ' · hackeado: ' + Math.ceil((e.hack - m.t) / 20) + ' s';
        if (!e.edif && UNID[e.tipo].monta && e.j === YO) t += (e.monta || 0) >= UNID[e.tipo].monta ? ' · montada' : ' · montando…';
        if (e.tipo === 'aerodromo' && e.j === YO) t += ' · aviones ' + m.ents.filter((u) => !u.edif && u.casa === e.id).length + '/' + W.ECON.cupoAviones;
        const ef = efectos(e); if (ef) t += ' · ' + ef;
        return t;
      }
      { const tq = m.trincheras.get(c); if (tq) { const n = (tq.dentro || []).filter((id) => id && m.porId.get(id)).length, ajena = (tq.dentro || []).some((id) => { const o = id ? m.porId.get(id) : null; return o && o.j !== YO; }); return 'Trinchera · ' + n + '/' + W.PLAZAS_TRINCHERA + (ajena ? ' · del enemigo' : n ? '' : ' · vacía') + ' · clic derecho con infantería: ocuparla'; } }
      const pu = m.puestos.find((p) => Math.abs(p.x - wx) < 0.8 && Math.abs(p.y - wy) < 0.8);
      if (pu) return NOMBRE_PUESTO[pu.tipo] + (pu.dueno === YO ? ' · tuyo' : pu.dueno >= 0 ? ' · del rival' : ' · neutral: lo captura la infantería') + (pu.prog > 0 ? ' · capturando ' + Math.floor((pu.prog / W.ECON.captura) * 100) + ' %' : '');
      if (m.mapa.tipoMin[c] === 3) return 'Chatarra · ' + m.mapa.mineral[c] + ' (la reciclan las cosechadoras)';
      const sitio = sitioPorCelda.get(c);
      if (sitio) return sitio === 'petroleo' ? 'Yacimiento de petróleo' : 'Campo de conocimiento';
      if (m.mapa.tipoMin[c] === 1) return 'Minerales · ' + m.mapa.mineral[c];
      if (m.mapa.tipoMin[c] === 2) return 'Minerales raros · ' + m.mapa.mineral[c];
      return NOMBRE_TERRENO[m.mapa.terreno[c]];
    }

    // ---------- partículas y marcas en el suelo: solo dibujo, la simulación no las conoce ----------
    const parts = [], suelo = [], senales = [], azar = Math.random; // senales: ondas de llamada y enlaces de la colmena
    let dtCuadro = 16;
    function parte(k, x, y, vx, vy, vida, s) { if (parts.length > 700) parts.shift(); parts.push({ k, x, y, vx, vy, v: 0, m: vida, s }); }
    function marcaSuelo(k, x, y, s, ang, dur, clase) { if (suelo.length > 500) suelo.shift(); suelo.push({ k, x, y, s, ang, t0: performance.now(), dur, clase }); }
    function estallido(x, y, tam) { // tam: 1 impacto, 2 unidad, 3 edificio
      parte('fogonazo', x, y, 0, 0, 0.13, 0.28 + tam * 0.22);
      parte('anillo', x, y, 0, 0, 0.28 + tam * 0.09, 0.5 + tam * 0.5);
      for (let i = 0, n = 3 + tam * 3; i < n; i++) { const a = azar() * TAU, v = (1.5 + azar() * 3.5) * (0.6 + tam * 0.3); parte('chispa', x, y, Math.cos(a) * v, Math.sin(a) * v, 0.2 + azar() * 0.3, 0); }
      for (let i = 0; i <= tam; i++) parte('humo', x + (azar() - 0.5) * tam * 0.4, y + (azar() - 0.5) * tam * 0.4, (azar() - 0.5) * 0.5, -0.4 - azar() * 0.6, 0.9 + azar() * 1.1, 0.22 + tam * 0.14);
    }

    // Orientación visual de cada ficha: rumbo del casco (a) y de la torreta o el arma (t).
    const giros = new Map();
    const hacia = (a, b, k) => a + ((((b - a + Math.PI) % TAU) + TAU) % TAU - Math.PI) * k;
    function giro(e) {
      const x = e.edif ? e.cx : e.x, y = e.edif ? e.cy : e.y;
      let g = giros.get(e.id);
      if (!g) { const a0 = Math.atan2(N / 2 - y, N / 2 - x); g = { a: a0, t: a0 }; giros.set(e.id, g); }
      const dt = pausa ? 0 : Math.min(0.05, dtCuadro / 1000); // por tiempo y no por cuadro: se mueve igual a 30 que a 120 cuadros por segundo
      if (!e.edif) { // el rumbo real lo lleva la simulación; aquí el casco lo sigue con suavidad: la infantería, ágil; los vehículos, con más peso
        g.a = hacia(g.a, e.ang, 1 - Math.exp(-dt * (UNID[e.tipo].cat === 'inf' ? 24 : 15)));
        if (g.tk !== m.t) { g.ac = e.v - (g.vt === undefined ? e.v : g.vt); g.vt = e.v; g.tk = m.t; } // cuánto acelera o frena, para el cabeceo
      }
      // La torreta (o el arma) es un muelle amortiguado: arranca, coge velocidad y se pasa un pelo antes de asentarse.
      const meta = e.angT !== undefined ? e.angT : g.a, dif = (((meta - g.t + Math.PI) % TAU) + TAU) % TAU - Math.PI;
      g.tv = (g.tv || 0) + (dif * 240 - (g.tv || 0) * 23) * dt; g.t += g.tv * dt;
      return g;
    }
    const retroceso = (e, arma) => { const r = Math.max(0, (e.recarga / W.ARMAS[arma].recarga - 0.7) / 0.3); return r * r * (3 - 2 * r); }; // 1 justo al disparar; vuelve suave a su sitio
    // Balas ligeras (fusil, pistola, ametralladora, rifle): el disparo es instantáneo en la simulación, pero aquí la bala viaja.
    const balas = [];
    function bala(d) {
      const dx = d.x2 - d.x1, dy = d.y2 - d.y1, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, x1 = d.x1 + ux * 0.28, y1 = d.y1 + uy * 0.28, ahora = performance.now();
      if (balas.length > 300) balas.shift();
      parte('fogonazo', x1, y1, 0, 0, 0.07, d.arma === 'rifle' ? 0.16 : 0.1);
      if (d.arma === 'rifle') balas.push({ x1, y1, x2: d.x2, y2: d.y2, t0: ahora, dur: 380, k: 'rifle' }); // el rifle: una línea fina que se queda un instante y se apaga
      else for (let i = 0, n = d.arma === 'ametralladora' ? 2 : 1; i < n; i++) { // la ametralladora suelta dos, algo abiertas
        const ab = n > 1 ? (azar() - 0.5) * 0.3 : (azar() - 0.5) * 0.08;
        balas.push({ x1, y1, x2: d.x2 - uy * ab, y2: d.y2 + ux * ab, t0: ahora + i * 45, dur: (L / 42) * 1000, k: 'bala', chispa: i === 0 });
      }
    }

    // ---------- dibujo ----------
    function dibujar(alfa) {
      const z = cam.z, ox = cw / 2 - cam.x * z, oy = ch / 2 - cam.y * z, f = m.niebla[YO], mp = m.mapa;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = P.fondo; ctx.fillRect(0, 0, cw, ch);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(cTerr, ox, oy, N * z, N * z);
      const x0 = Math.floor(-ox / z) - 1, x1 = Math.floor((cw - ox) / z) + 1, y0 = Math.floor(-oy / z) - 1, y1 = Math.floor((ch - oy) / z) + 1;
      const fuera = (x, y) => x < x0 || x > x1 || y < y0 || y > y1;

      const lod = z >= 16 ? 2 : z >= 8 ? 1 : 0; // nivel de detalle según el zoom
      if (lod) { // relieve: la roca es una meseta con su cara sur a la vista y sombra al sur y al este; el agua queda hundida
        const T = mp.terreno, ax = Math.max(0, x0), bx = Math.min(N - 1, x1), ay = Math.max(0, y0), by = Math.min(N - 1, y1);
        const cara = new Path2D(), luz = new Path2D(), sombra = new Path2D(), orilla = new Path2D(), copas = new Path2D(), sCopas = new Path2D();
        const hr = z * 0.3;
        for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) {
          const i = y * N + x, t = T[i];
          if (!f[i] || t === 0) continue;
          const sx = ox + x * z, sy = oy + y * z;
          if (t === 1) {
            if (y + 1 < N && T[i + N] !== 1) { cara.rect(sx, sy + z - hr, z, hr); if (T[i + N] !== 2) sombra.rect(sx + z * 0.12, sy + z, z, z * 0.26); }
            if (x + 1 < N && T[i + 1] !== 1) sombra.rect(sx + z, sy + z * 0.12, z * 0.2, z);
            if (y > 0 && T[i - N] !== 1) luz.rect(sx, sy, z, Math.max(1, z * 0.06));
          } else if (t === 2) {
            if (y > 0 && T[i - N] !== 2) orilla.rect(sx, sy, z, z * 0.2);
            if (x > 0 && T[i - 1] !== 2) orilla.rect(sx, sy, z * 0.1, z);
          } else if (t === 3 && lod === 2) { // bosque: un par de copas por celda, siempre en el mismo sitio
            for (let k = 0; k < 2; k++) {
              const a = i * 2.39996 + k * 3.1, qx = sx + z * (0.5 + Math.cos(a) * 0.27), qy = sy + z * (0.5 + Math.sin(a * 1.3) * 0.27), rr = z * (0.2 + ((i * 7 + k * 3) % 5) * 0.022);
              sCopas.moveTo(qx + z * 0.1 + rr, qy + z * 0.12); sCopas.arc(qx + z * 0.1, qy + z * 0.12, rr, 0, TAU);
              copas.moveTo(qx + rr, qy - z * 0.08); copas.arc(qx, qy - z * 0.08, rr, 0, TAU);
            }
          }
        }
        ctx.fillStyle = 'rgba(0,0,0,0.15)'; ctx.fill(sombra); ctx.fill(sCopas);
        ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fill(orilla);
        ctx.fillStyle = COL.rocaCara; ctx.fill(cara);
        ctx.fillStyle = COL.rocaLuz; ctx.fill(luz);
        ctx.fillStyle = COL.copa; ctx.fill(copas);
      }
      if (conRed && (verRed || modo === 'colocar')) { if (redVista !== m.redV) pintarRed(); ctx.drawImage(cRed, ox, oy, N * z, N * z); } // la cobertura: dónde hay suministro y dónde se puede construir
      const infra = m.ents.filter((e) => e.infra), tramos = infra.filter((e) => !e.linea), lineas = infra.filter((e) => e.linea); // caminos: cada tramo es una pieza de infraestructura, dibujada como un carril continuo con su borde
      if (tramos.length) {
        const linea = (p) => { ctx.moveTo(ox + p[0] * z, oy + p[1] * z); if (p.length < 4) ctx.lineTo(ox + p[0] * z + 0.01, oy + p[1] * z); for (let k = 2; k < p.length; k += 2) ctx.lineTo(ox + p[k] * z, oy + p[k + 1] * z); };
        ctx.lineJoin = 'round'; ctx.lineCap = 'butt'; // los puentes: un tablero más ancho y oscuro debajo del carril
        ctx.strokeStyle = COL.puente; ctx.lineWidth = Math.max(2.5, z * 1.3); ctx.beginPath();
        for (const e of tramos) if (e.puente) linea(e.pts);
        ctx.stroke();
        ctx.lineCap = 'round';
        for (const [ancho, color] of [[1.0, COL.caminoBorde], [0.78, P.camino]]) {
          ctx.strokeStyle = color; ctx.lineWidth = Math.max(1.5, z * ancho); ctx.beginPath();
          for (const e of tramos) linea(e.pts);
          ctx.stroke();
        }
        if (z >= 16) { // rodadas, como las que dejan los vehículos
          ctx.strokeStyle = COL.caminoBorde; ctx.lineWidth = Math.max(1, z * 0.05); ctx.globalAlpha = 0.55;
          for (const lado of [-0.2, 0.2]) {
            ctx.beginPath();
            for (const e of tramos) {
              const tr = e.pts;
              for (let k = 0; k + 3 < tr.length; k += 2) {
                const dx = tr[k + 2] - tr[k], dy = tr[k + 3] - tr[k + 1], L = Math.hypot(dx, dy) || 1, nx = (-dy / L) * lado, ny = (dx / L) * lado;
                if (k === 0) ctx.moveTo(ox + (tr[k] + nx) * z, oy + (tr[k + 1] + ny) * z);
                ctx.lineTo(ox + (tr[k + 2] + nx) * z, oy + (tr[k + 3] + ny) * z);
              }
            }
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
        }
        for (const e of tramos) { // el tramo dañado se oscurece; el seleccionado se marca, con su barra de vida
          const dano = 1 - e.vida / e.vidaMax, elegido = sel.has(e.id);
          if (dano > 0.02) { ctx.strokeStyle = 'rgba(40,30,20,' + (0.15 + dano * 0.5).toFixed(2) + ')'; ctx.lineWidth = Math.max(1.5, z * 0.78); ctx.lineCap = 'butt'; ctx.beginPath(); linea(e.pts); ctx.stroke(); ctx.lineCap = 'round'; }
          if (elegido) { ctx.strokeStyle = P.tinta; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]); ctx.beginPath(); linea(e.pts); ctx.stroke(); ctx.setLineDash([]); }
          if (elegido || dano > 0.02) {
            const bx = ox + e.cx * z, by = oy + e.cy * z - z * 0.75, w = Math.max(14, z * 1.2);
            ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(bx - w / 2, by, w, 3);
            ctx.fillStyle = dano > 0.6 ? P.mal : e.j === YO ? P.yo : P.rival; ctx.fillRect(bx - w / 2, by, w * (1 - dano), 3);
          }
        }
        ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
      }
      if (lineas.length) { // líneas de servicio: un trazo fino con sus postes; en rojo las propias que no llegan a la red
        const ancho = Math.max(1, z * (verRed ? 0.14 : 0.08));
        for (const pasada of [0, 1]) {
          ctx.strokeStyle = pasada ? P.mal : P.tinta; ctx.globalAlpha = pasada ? 0.9 : verRed ? 0.85 : 0.5; ctx.lineWidth = ancho; ctx.beginPath();
          for (const e of lineas) { if ((e.j === YO && conRed && !e.conRed) !== !!pasada) continue; const p = e.pts; ctx.moveTo(ox + p[0] * z, oy + p[1] * z); ctx.lineTo(ox + p[2] * z, oy + p[3] * z); }
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        if (z >= 9) { // postes: uno por celda, más o menos
          ctx.fillStyle = P.tinta; ctx.beginPath();
          for (const e of lineas) { const p = e.pts, n = Math.max(1, Math.round(e.largo)); for (let k = 0; k <= n; k += 2) { const x = ox + (p[0] + ((p[2] - p[0]) * k) / n) * z, y = oy + (p[1] + ((p[3] - p[1]) * k) / n) * z; ctx.moveTo(x + z * 0.09, y); ctx.arc(x, y, Math.max(1.2, z * 0.09), 0, TAU); } }
          ctx.fill();
        }
        for (const e of lineas) { // la seleccionada o dañada, con su barra de vida
          const dano = 1 - e.vida / e.vidaMax, elegido = sel.has(e.id);
          if (elegido) { const p = e.pts; ctx.strokeStyle = P.tinta; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(ox + p[0] * z, oy + p[1] * z - 4); ctx.lineTo(ox + p[2] * z, oy + p[3] * z - 4); ctx.stroke(); ctx.setLineDash([]); }
          if (elegido || dano > 0.02) { const bx = ox + e.cx * z, by = oy + e.cy * z - z * 0.5, w = Math.max(14, z); ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(bx - w / 2, by, w, 3); ctx.fillStyle = dano > 0.6 ? P.mal : e.j === YO ? P.yo : P.rival; ctx.fillRect(bx - w / 2, by, w * (1 - dano), 3); }
        }
      }
      const chatarra = [];
      ctx.fillStyle = P.mineral; ctx.beginPath();
      for (const c of m.minas) {
        const x = c % N, y = (c / N) | 0;
        if (fuera(x, y) || !f[c]) continue;
        if (mp.tipoMin[c] === 3) { chatarra.push(c); continue; }
        const r = z * (0.13 + 0.25 * Math.min(1, mp.mineral[c] / 600)), px = ox + (x + 0.5) * z, py = oy + (y + 0.5) * z;
        if (z < 8) { ctx.moveTo(px + r, py); ctx.arc(px, py, r, 0, TAU); continue; }
        for (let k = 0; k < 3; k++) { // de cerca, cada celda es un racimo de tres cristales
          const a = c * 1.7 + k * 2.1, qx = px + Math.cos(a) * z * 0.2, qy = py + Math.sin(a) * z * 0.2, h = r * (1.05 - k * 0.2), w = h * 0.55;
          ctx.moveTo(qx, qy - h); ctx.lineTo(qx + w, qy); ctx.lineTo(qx, qy + h); ctx.lineTo(qx - w, qy); ctx.closePath();
        }
      }
      ctx.fill();
      if (chatarra.length) { // restos de vehículos: planchas torcidas, hasta que una cosechadora las recicle
        ctx.fillStyle = COL.rocaCara; ctx.strokeStyle = P.roca; ctx.lineWidth = 1;
        for (const c of chatarra) {
          const px = ox + ((c % N) + 0.5) * z, py = oy + (((c / N) | 0) + 0.5) * z, s = z * (0.16 + 0.1 * Math.min(1, mp.mineral[c] / 400));
          ctx.beginPath();
          for (let k = 0; k < 3; k++) { const a = c * 1.3 + k * 2.2, qx = px + Math.cos(a) * z * 0.17, qy = py + Math.sin(a) * z * 0.17; ctx.moveTo(qx - s, qy - s * 0.3); ctx.lineTo(qx + s * 0.6, qy - s * 0.6); ctx.lineTo(qx + s, qy + s * 0.3); ctx.lineTo(qx - s * 0.5, qy + s * 0.5); ctx.closePath(); }
          ctx.fill(); if (z >= 16) ctx.stroke();
        }
      }
      // Puestos neutrales: una caseta con su símbolo, del color de quien la tiene, y el avance de la captura alrededor.
      for (const p of m.puestos) {
        const c = Math.floor(p.y) * N + Math.floor(p.x);
        if (fuera(p.x, p.y) || !f[c]) continue;
        const px = ox + p.x * z, py = oy + p.y * z, s = Math.max(4, z * 0.42), col = p.dueno === YO ? P.yo : p.dueno >= 0 ? P.rival : P.roca, h = z >= 8 ? z * 0.2 : 0;
        if (h) { ctx.fillStyle = 'rgba(0,0,0,0.17)'; ctx.fillRect(px - s + h * 0.9, py - s + h * 0.6, s * 2, s * 2); ctx.fillStyle = COL.rocaCara; ctx.fillRect(px - s, py + s - h, s * 2, h); }
        ctx.fillStyle = P.llano; ctx.strokeStyle = col; ctx.lineWidth = Math.max(1.5, z * 0.09);
        ctx.beginPath(); ctx.rect(px - s, py - s - h, s * 2, s * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = col; ctx.lineWidth = Math.max(1, z * 0.06); ctx.beginPath();
        const cy = py - h;
        if (p.tipo === 'antena') { ctx.moveTo(px, cy + s * 0.6); ctx.lineTo(px, cy - s * 0.5); ctx.moveTo(px + s * 0.55, cy - s * 0.5); ctx.arc(px, cy - s * 0.5, s * 0.55, 0, -Math.PI, true); ctx.stroke(); }
        else if (p.tipo === 'deposito') { ctx.arc(px, cy, s * 0.55, 0, TAU); ctx.fill(); }
        else { ctx.moveTo(px - s * 0.5, cy + s * 0.5); ctx.lineTo(px + s * 0.5, cy - s * 0.5); ctx.moveTo(px - s * 0.5, cy - s * 0.5); ctx.lineTo(px + s * 0.5, cy + s * 0.5); ctx.stroke(); }
        if (p.prog > 0) { ctx.strokeStyle = p.quien === YO ? P.yo : P.rival; ctx.lineWidth = Math.max(2, z * 0.1); ctx.beginPath(); ctx.arc(px, cy, s * 1.7, -Math.PI / 2, -Math.PI / 2 + TAU * (p.prog / W.ECON.captura)); ctx.stroke(); }
      }
      ctx.fillStyle = P.raro; ctx.beginPath();
      for (const c of m.raros) {
        const x = c % N, y = (c / N) | 0;
        if (fuera(x, y) || !f[c]) continue;
        const r = z * 0.34, px = ox + (x + 0.5) * z, py = oy + (y + 0.5) * z;
        ctx.moveTo(px, py - r); ctx.lineTo(px + r, py); ctx.lineTo(px, py + r); ctx.lineTo(px - r, py); ctx.closePath();
      }
      ctx.fill();
      ctx.strokeStyle = P.tinta; ctx.fillStyle = P.tinta; ctx.lineWidth = Math.max(1, z * 0.09);
      for (const s of mp.sitios) {
        if (fuera(s.x, s.y) || !f[s.y * N + s.x] || m.ocup[s.y * N + s.x]) continue; // con edificio encima no se dibuja
        const px = ox + (s.x + 0.5) * z, py = oy + (s.y + 0.5) * z;
        if (s.tipo === 'petroleo') { // mancha negra con anillo: se reconoce también de lejos
          const r = Math.max(4, z * 0.62);
          ctx.beginPath(); ctx.arc(px, py, r, 0, TAU); ctx.fill();
          ctx.beginPath(); ctx.arc(px + r * 0.7, py + r * 0.55, r * 0.45, 0, TAU); ctx.arc(px - r * 0.75, py + r * 0.35, r * 0.32, 0, TAU); ctx.fill();
          ctx.lineWidth = Math.max(1, z * 0.07); ctx.beginPath(); ctx.arc(px, py, r * 1.75, 0, TAU); ctx.stroke();
          ctx.lineWidth = Math.max(1, z * 0.09);
        } else {
          ctx.beginPath(); ctx.arc(px, py, z * 0.55, 0, TAU); ctx.moveTo(px + z * 0.28, py); ctx.arc(px, py, z * 0.28, 0, TAU);
          ctx.moveTo(px - z * 0.85, py); ctx.lineTo(px + z * 0.85, py); ctx.moveTo(px, py - z * 0.85); ctx.lineTo(px, py + z * 0.85); ctx.stroke();
        }
      }

      const barras = [], signos = [], tiempo = performance.now();
      const so = z * 0.13; // desplazamiento de las sombras

      // Marcas en el suelo: quemaduras, huellas de oruga, restos y ruinas, que se van borrando.
      for (let i = suelo.length - 1; i >= 0; i--) {
        const q = suelo[i], edad = (tiempo - q.t0) / q.dur;
        if (edad >= 1) { suelo.splice(i, 1); continue; }
        if (!lod || fuera(q.x, q.y) || !f[Math.floor(q.y) * N + Math.floor(q.x)]) continue;
        const a = 1 - edad, sx = ox + q.x * z, sy = oy + q.y * z;
        if (q.k === 'quemado') { ctx.globalAlpha = 0.26 * a; ctx.fillStyle = P.tinta; ctx.beginPath(); ctx.arc(sx, sy, z * q.s, 0, TAU); ctx.fill(); }
        else if (q.k === 'huella') {
          const c = Math.cos(q.ang), s = Math.sin(q.ang), w = q.s * z * 0.78, l = z * 0.26;
          ctx.globalAlpha = 0.15 * a; ctx.strokeStyle = P.tinta; ctx.lineWidth = Math.max(1, z * 0.1); ctx.beginPath();
          ctx.moveTo(sx - s * w - c * l, sy + c * w - s * l); ctx.lineTo(sx - s * w + c * l, sy + c * w + s * l);
          ctx.moveTo(sx + s * w - c * l, sy - c * w - s * l); ctx.lineTo(sx + s * w + c * l, sy - c * w + s * l); ctx.stroke();
        } else if (q.k === 'resto') {
          const r = q.s * z;
          ctx.globalAlpha = 0.6 * Math.min(1, a * 2.5); ctx.fillStyle = '#3a3a3a';
          ctx.save(); ctx.translate(sx, sy); ctx.rotate(q.ang); ctx.beginPath();
          if (UNID[q.clase].cat === 'inf') ctx.ellipse(0, 0, r * 1.5, r * 0.8, 0, 0, TAU);
          else { ctx.rect(-r * 1.3, -r * 0.9, r * 2.2, r * 1.8); ctx.rect(r * 0.5, -r * 0.3, r * 1.1, r * 0.5); }
          ctx.fill(); ctx.restore();
        } else { // ruina de edificio
          const t = q.s * z;
          ctx.globalAlpha = 0.42 * Math.min(1, a * 2.5); ctx.fillStyle = '#3a3a3a'; ctx.fillRect(sx - t / 2 + 2, sy - t / 2 + 2, t - 4, t - 4);
          ctx.fillStyle = P.roca;
          for (let k = 0; k < 6; k++) { const a2 = q.x * 3.1 + k * 1.9, d2 = t * (0.12 + ((k * 37) % 10) * 0.03); ctx.fillRect(sx + Math.cos(a2) * d2 - t * 0.06, sy + Math.sin(a2) * d2 - t * 0.05, t * 0.14, t * 0.1); }
        }
      }
      ctx.globalAlpha = 1;
      // Trincheras: un parapeto de tierra en herradura, abierto por detrás.
      for (const q of m.trincheras.values()) {
        if (fuera(q.x, q.y) || !m.niebla[YO][Math.floor(q.y) * N + Math.floor(q.x)]) continue;
        const sx = ox + q.x * z, sy = oy + q.y * z;
        ctx.lineCap = 'round';
        { // una zanja a lo ancho, con el parapeto por delante
          const lx = -Math.sin(q.ang) * z * 0.56, ly = Math.cos(q.ang) * z * 0.56, fx = Math.cos(q.ang) * z * 0.22, fy = Math.sin(q.ang) * z * 0.22;
          ctx.strokeStyle = 'rgba(95,81,64,0.55)'; ctx.lineWidth = Math.max(2, z * 0.34); ctx.beginPath(); ctx.moveTo(sx - lx, sy - ly); ctx.lineTo(sx + lx, sy + ly); ctx.stroke();
          ctx.strokeStyle = '#5f5140'; ctx.lineWidth = Math.max(1.5, z * 0.1); ctx.beginPath(); ctx.moveTo(sx - lx + fx, sy - ly + fy); ctx.lineTo(sx + lx + fx, sy + ly + fy); ctx.stroke();
          if (lod) { ctx.strokeStyle = '#a8977c'; ctx.lineWidth = Math.max(1, z * 0.05); ctx.beginPath(); ctx.moveTo(sx - lx + fx * 1.5, sy - ly + fy * 1.5); ctx.lineTo(sx + lx + fx * 1.5, sy + ly + fy * 1.5); ctx.stroke(); }
        }
        if (lod && z >= 14) { // sus cuatro puestos: hueco el libre, lleno el ocupado
          ctx.lineWidth = 1; ctx.strokeStyle = '#5f5140';
          for (let k = 0; k < W.PLAZAS_TRINCHERA; k++) { const p = W.puestoTrinchera(q, k), o = q.dentro && q.dentro[k] ? m.porId.get(q.dentro[k]) : null; ctx.beginPath(); ctx.arc(ox + p.x * z, oy + p.y * z, Math.max(1.5, z * 0.05), 0, TAU); if (o) { ctx.fillStyle = o.j === YO ? P.yo : P.rival; ctx.fill(); } ctx.stroke(); }
        }
        ctx.lineCap = 'butt';
      }
      // Cuerpo de un edificio: la pared sur y, encima y desplazado hacia arriba, el tejado (la ficha de siempre).
      const cuerpos = new Map(), tapan = new Set();
      const cuerpo = (e, px, py, t, est, h, redondo, edadObra) => {
        const col = e.j === YO ? COL.yo : COL.rival;
        if (edadObra < 1) { ctx.save(); ctx.beginPath(); ctx.rect(px - 2, py - h + (t + h) * (1 - edadObra), t + 4, (t + h) * edadObra + 2); ctx.clip(); }
        if (h > 0) {
          ctx.fillStyle = col.pared;
          if (redondo) { const R = t * 0.47, cx = px + t / 2, cy = py + t / 2; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI); ctx.lineTo(cx - R, cy - h); ctx.lineTo(cx + R, cy - h); ctx.closePath(); ctx.fill(); }
          else {
            ctx.fillRect(px, py + t - h, t, h);
            if (lod === 2 && h >= 6 && e.tipo !== 'aerodromo') { // ventanas, y un zócalo en la base
              ctx.fillStyle = col.base; ctx.globalAlpha = 0.6;
              const n = e.tam * 2, w = t / n;
              for (let k = 0; k < n; k++) ctx.fillRect(px + k * w + w * 0.3, py + t - h * 0.74, w * 0.4, h * 0.4);
              ctx.globalAlpha = 1;
            }
            ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.fillRect(px, py + t - Math.max(1, h * 0.12), t, Math.max(1, h * 0.12));
          }
        }
        W.fichaEdificio(ctx, e, px, py - h, t, lod, col, est);
        if (edadObra < 1) { ctx.restore(); ctx.strokeStyle = P.tinta; ctx.lineWidth = 1; ctx.setLineDash([4, 3]); ctx.strokeRect(px + 1.5, py + 1.5, t - 3, t - 3); ctx.setLineDash([]); }
      };
      const descargando = new Set();
      for (const e of m.ents) if (!e.edif && e.est === 'descargar') descargando.add(e.ref);
      for (const e of m.ents) {
        if (!e.edif || e.infra || !veo(e) || fuera(e.cx, e.cy) && fuera(e.x, e.y)) continue;
        const px = ox + e.x * z, py = oy + e.y * z, t = e.tam * z, Je = m.jug[e.j];
        const est = { tiempo, id: e.id, vida: e.vida / e.vidaMax, deficit: !!e.sinLuz || e.hack > m.t || (e.tipo === 'deposito' && !e.conRed), activo: false, descarga: descargando.has(e.id), ang: 0, retro: 0 };
        if (e.tipo === 'patio') est.activo = Je.obras.some((o) => !o.listo);
        else if (e.tipo === 'fabrica') est.activo = e.cola.length > 0;
        else if (EDIF[e.tipo].arma) { est.ang = giro(e).t; est.retro = retroceso(e, EDIF[e.tipo].arma); }
        const h = lod ? ALTO[e.tipo] * z : 0, redondo = e.tipo === 'torreta' || e.tipo === 'antiaerea'; // altura en píxeles
        if (lod) { // sombra: cae hacia el sureste, más larga cuanto más alto el edificio
          const sx = so + h * 0.75, sy = so + h * 0.45;
          ctx.fillStyle = 'rgba(0,0,0,0.17)'; ctx.beginPath();
          if (redondo) { ctx.arc(px + t / 2 + sx, py + t / 2 + sy, t * 0.47, 0, TAU); ctx.moveTo(px + t / 2, py + t / 2 + t * 0.47); ctx.lineTo(px + t / 2 + sx, py + t / 2 + sy + t * 0.47); ctx.lineTo(px + t / 2 + sx + t * 0.47, py + t / 2 + sy); ctx.lineTo(px + t / 2 + t * 0.47, py + t / 2); }
          else { ctx.moveTo(px + 1, py + t); ctx.lineTo(px + t, py + t); ctx.lineTo(px + t, py + 1); ctx.lineTo(px + t + sx, py + 1 + sy); ctx.lineTo(px + t + sx, py + t + sy); ctx.lineTo(px + 1 + sx, py + t + sy); }
          ctx.closePath(); ctx.fill();
        }
        const edadObra = e.nace > 0 ? (m.t - e.nace + alfa) / 30 : 1; // recién colocado: se levanta de abajo arriba
        cuerpos.set(e.id, [e, px, py, t, est, h, redondo, edadObra]);
        cuerpo(e, px, py, t, est, h, redondo, edadObra);
        if (sel.has(e.id)) {
          const g = Math.max(4, t * 0.18), a = px - 2, b = py - h - 2, c2 = px + t + 2, d2 = py + t + 2; // escuadras de selección
          ctx.strokeStyle = P.tinta; ctx.lineWidth = 1.5; ctx.beginPath();
          ctx.moveTo(a, b + g); ctx.lineTo(a, b); ctx.lineTo(a + g, b); ctx.moveTo(c2 - g, b); ctx.lineTo(c2, b); ctx.lineTo(c2, b + g);
          ctx.moveTo(c2, d2 - g); ctx.lineTo(c2, d2); ctx.lineTo(c2 - g, d2); ctx.moveTo(a + g, d2); ctx.lineTo(a, d2); ctx.lineTo(a, d2 - g); ctx.stroke();
          if (EDIF[e.tipo].arma) { // alcance
            ctx.setLineDash([5, 5]); ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.arc(px + t / 2, py + t / 2, W.alcance(m, e, W.ARMAS[EDIF[e.tipo].arma]) * z, 0, TAU); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
          }
        }
        if (sel.has(e.id) && e.reunion && e.j === YO) { // punto de reunión: línea y banderín
          const rx = ox + e.reunion.x * z, ry = oy + e.reunion.y * z;
          ctx.strokeStyle = P.bien; ctx.fillStyle = P.bien; ctx.lineWidth = 1.2; ctx.setLineDash([3, 3]);
          ctx.beginPath(); ctx.moveTo(px + t / 2, py + t / 2); ctx.lineTo(rx, ry); ctx.stroke(); ctx.setLineDash([]);
          ctx.beginPath(); ctx.moveTo(rx, ry); ctx.lineTo(rx, ry - 14); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(rx, ry - 14); ctx.lineTo(rx + 9, ry - 10.5); ctx.lineTo(rx, ry - 7); ctx.closePath(); ctx.fill();
        }
        if (e.tipo === 'patio' && e.j === YO && lod) { // edificio terminado esperando sitio: una chapa sobre el patio, que late
          const n = J.obras.filter((o) => o.listo && o.patio === e.id).length;
          if (n) {
            const bx = px + t - 2, by = py - h + 2, rr = Math.max(7, z * 0.3) * (1 + Math.sin(tiempo * 0.008) * 0.12);
            ctx.fillStyle = P.bien; ctx.beginPath(); ctx.arc(bx, by, rr, 0, TAU); ctx.fill();
            ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(1.5, rr * 0.2); ctx.lineCap = 'round'; ctx.beginPath(); // un edificio pequeño con una flecha hacia abajo: «por colocar»
            ctx.moveTo(bx, by - rr * 0.5); ctx.lineTo(bx, by + rr * 0.35); ctx.moveTo(bx - rr * 0.35, by); ctx.lineTo(bx, by + rr * 0.4); ctx.lineTo(bx + rr * 0.35, by); ctx.stroke(); ctx.lineCap = 'butt';
            if (n > 1) { ctx.fillStyle = P.tinta; ctx.fillText(String(n), bx + rr + 2, by + 4); }
          }
        }
        if (sel.has(e.id) || e.vida < e.vidaMax) barras.push([px, py - h - 6, t, e.vida / e.vidaMax, m.t - e.curando < 12]);
        if (e.j === YO && m.t - e.llama < 14) signos.push([px + t / 2, py - h - 18, '!']);
      }

      // Líneas de recorrido de las unidades seleccionadas: ruta pendiente, destino y objetivo.
      ctx.lineWidth = 1.2; ctx.lineJoin = 'round';
      for (const id of sel) {
        const u = m.porId.get(id);
        if (!u || u.edif || u.j !== YO) continue;
        const ux = ox + (u.px + (u.x - u.px) * alfa) * z, uy = oy + (u.py + (u.y - u.py) * alfa) * z;
        const hostil = u.orden === 'amover' || u.orden === 'atacar';
        const color = u.tipo === 'cosechadora' && u.orden !== 'mover' ? P.mineral : hostil ? P.mal : P.bien;
        if (u.ruta && u.ri < u.ruta.length) {
          ctx.strokeStyle = color; ctx.globalAlpha = 0.75; ctx.setLineDash([6, 4]); ctx.lineDashOffset = -tiempo * 0.02;
          ctx.beginPath(); ctx.moveTo(ux, uy);
          let fx = ux, fy = uy;
          for (let k = u.ri; k < u.ruta.length; k++) { const c = u.ruta[k]; fx = ox + ((c % N) + 0.5) * z; fy = oy + (((c / N) | 0) + 0.5) * z; ctx.lineTo(fx, fy); }
          ctx.stroke(); ctx.setLineDash([]); ctx.lineDashOffset = 0;
          ctx.fillStyle = color; ctx.beginPath(); ctx.arc(fx, fy, 3, 0, TAU); ctx.fill();
          ctx.beginPath(); ctx.arc(fx, fy, 6.5, 0, TAU); ctx.stroke();
          ctx.globalAlpha = 1;
        }
        // Puntos encadenados (línea fina) y circuito de patrulla (cerrado).
        const puntos = u.patrulla ? u.patrulla.pts : u.cola.filter((q) => q.t !== 'atacar');
        if (puntos.length) {
          ctx.strokeStyle = u.patrulla ? P.mal : color; ctx.fillStyle = ctx.strokeStyle; ctx.globalAlpha = 0.55; ctx.setLineDash([2, 4]);
          ctx.beginPath();
          if (u.patrulla) { ctx.moveTo(ox + puntos[0].x * z, oy + puntos[0].y * z); for (const q of puntos) ctx.lineTo(ox + q.x * z, oy + q.y * z); ctx.closePath(); }
          else { const d0 = u.dest && u.orden !== 'nada' ? u.dest : u; ctx.moveTo(ox + d0.x * z, oy + d0.y * z); for (const q of puntos) ctx.lineTo(ox + q.x * z, oy + q.y * z); }
          ctx.stroke(); ctx.setLineDash([]);
          for (const q of puntos) { ctx.beginPath(); ctx.arc(ox + q.x * z, oy + q.y * z, 2.5, 0, TAU); ctx.fill(); }
          ctx.globalAlpha = 1;
        }
        const o = u.obj ? m.porId.get(u.obj) : null;
        if (o && veo(o)) { // objetivo de ataque: línea y retícula
          const tx = ox + (o.edif ? o.cx : o.x) * z, ty = oy + (o.edif ? o.cy : o.y) * z, rr = (o.edif ? o.tam * 0.6 : 0.7) * z;
          ctx.strokeStyle = P.mal; ctx.globalAlpha = 0.6;
          ctx.beginPath(); ctx.moveTo(ux, uy); ctx.lineTo(tx, ty);
          ctx.moveTo(tx + rr, ty); ctx.arc(tx, ty, rr, 0, TAU);
          ctx.moveTo(tx - rr * 1.3, ty); ctx.lineTo(tx - rr * 0.7, ty); ctx.moveTo(tx + rr * 0.7, ty); ctx.lineTo(tx + rr * 1.3, ty);
          ctx.moveTo(tx, ty - rr * 1.3); ctx.lineTo(tx, ty - rr * 0.7); ctx.moveTo(tx, ty + rr * 0.7); ctx.lineTo(tx, ty + rr * 1.3);
          ctx.stroke(); ctx.globalAlpha = 1;
        }
      }

      let repasado = false;
      const repasar = () => { repasado = true; for (const id of tapan) cuerpo(...cuerpos.get(id)); }; // los edificios tapan a quien tienen justo detrás
      for (const e of m.ents.filter((u) => !u.edif && !UNID[u.tipo].aire).concat(m.ents.filter((u) => !u.edif && UNID[u.tipo].aire))) { // los aviones, encima
        if (!repasado && UNID[e.tipo].aire) repasar();
        if (!veo(e)) continue;
        const wx = e.px + (e.x - e.px) * alfa, wy = e.py + (e.y - e.py) * alfa;
        if (fuera(wx, wy)) continue;
        const d = UNID[e.tipo], px = ox + wx * z, py = oy + wy * z, r = Math.max(2, d.radio * z * (e.enTierra ? 0.72 : 1)), g = giro(e); // posado se ve más pequeño: está abajo
        const anda = (e.x - e.px) ** 2 + (e.y - e.py) ** 2 > 1e-6;
        if (lod) { // sombra
          ctx.fillStyle = 'rgba(0,0,0,0.17)'; ctx.beginPath();
          const alto = d.aire && !e.enTierra ? r * 1.5 : 0; // la sombra de un avión cae lejos: vuela
          if (alto) ctx.fillStyle = 'rgba(0,0,0,0.12)';
          ctx.ellipse(px + so * 0.8 + alto, py + so * 0.8 + alto, r * (d.cat === 'inf' ? 1.1 : 1.45), r * 1.1, g.a, 0, TAU); ctx.fill();
          if (anda && d.cat === 'veh' && !pausa) { // los vehículos dejan huella y levantan polvo
            g.d = (g.d || 0) + e.v * (dtCuadro / 50);
            if (g.d > 0.5) {
              g.d = 0; marcaSuelo('huella', e.x, e.y, d.radio, g.a, 22000);
              if (azar() < 0.6) parte('polvo', e.x - Math.cos(g.a) * d.radio * 1.3, e.y - Math.sin(g.a) * d.radio * 1.3, (azar() - 0.5) * 0.4, (azar() - 0.5) * 0.4, 0.8, 0.22);
            }
          }
        }
        ctx.save(); ctx.translate(px, py);
        let mec = 0; // la infantería camina: se balancea a cada paso; quieta y sin nada que hacer, de vez en cuando mira a un lado
        if (d.cat === 'inf' && lod) {
          if (anda && !pausa) g.paso = (g.paso || 0) + e.v * (dtCuadro / 50);
          if (anda) { const s = Math.sin((g.paso || 0) * 15); mec = s * 0.13; ctx.translate(-Math.sin(g.a) * s * r * 0.17, Math.cos(g.a) * s * r * 0.17); }
          else if (!e.obj && e.orden === 'nada') { const ph = (tiempo / 1000 + e.id * 1.7) % 11; if (ph < 1.4) mec = Math.sin((ph / 1.4) * Math.PI) * 0.5 * (e.id % 2 ? 1 : -1); }
        }
        const st = {
          ang: (d.cat === 'inf' && e.obj && !anda ? g.t : g.a) + mec, angT: g.t, retro: d.arma ? retroceso(e, d.arma) : 0, monta: d.monta ? (e.monta || 0) / d.monta : 1,
          anda, tiempo, carga: e.carga / (d.carga || 1), cosecha: e.est === 'cosechar', raro: e.cargaTipo === 2,
        };
        const canto = lod && !d.aire && r >= 3.5 ? Math.max(1, r * 0.26) : 0; // el cuerpo de la unidad: su silueta en oscuro, y encima la ficha
        if (canto) { W.fichaUnidad(ctx, e, r, 1, e.j === YO ? COL.yoLado : COL.rivalLado, st); ctx.translate(0, -canto); }
        if (d.cat === 'veh' && !d.aire && lod) { // el casco tiene peso: cabecea al frenar y al arrancar, y recula con el disparo
          const quiere = Math.max(-1, Math.min(2, -(g.ac || 0) / d.acel)) * 0.075;
          g.cab = (g.cab || 0) + (quiere - (g.cab || 0)) * (1 - Math.exp(-(pausa ? 0 : dtCuadro / 1000) * 9));
          const golpe = st.retro * 0.17;
          ctx.translate((Math.cos(g.a) * g.cab - Math.cos(g.t) * golpe) * r, (Math.sin(g.a) * g.cab - Math.sin(g.t) * golpe) * r);
        }
        W.fichaUnidad(ctx, e, r, lod, e.j === YO ? COL.yo : COL.rival, st);
        ctx.restore();
        if (lod && !d.aire) { // si está pegada a la cara norte de un edificio, este la tapa
          const idb = m.ocup[Math.floor(wy + 0.45) * N + Math.floor(wx)], cb = idb ? cuerpos.get(idb) : null;
          if (cb && wy < cb[0].y) tapan.add(idb);
        }
        if (sel.has(e.id)) { ctx.strokeStyle = P.tinta; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(px, py, r * 1.9 + 2, 0, TAU); ctx.stroke(); }
        if (sel.has(e.id) && e.j === YO && lod && sel.size <= 40) { // lo que ve: cerca alrededor, lejos solo al frente
          const E = W.ECON, rf = d.vision * E.visAd * z, rs = d.vision * E.visLado * z, rb = d.vision * E.visAt * z, a = g.a;
          const cono = d.cono || E.cono; // cada tipo tiene su campo; el dron ve en redondo
          ctx.beginPath();
          if (cono >= Math.PI) ctx.arc(px, py, rf, 0, TAU);
          else {
            ctx.arc(px, py, rf, a - cono, a + cono); ctx.arc(px, py, rs, a + cono, a + E.periferia);
            ctx.arc(px, py, rb, a + E.periferia, a - E.periferia + TAU); ctx.arc(px, py, rs, a - E.periferia, a - cono); ctx.closePath();
          }
          ctx.fillStyle = P.tinta; ctx.globalAlpha = 0.035; ctx.fill();
          ctx.globalAlpha = 0.28; ctx.lineWidth = 1; ctx.setLineDash([3, 4]); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
        }
        if (e.cava > 0) { // cavando: el parapeto se va cerrando
          const fr = 1 - e.cava / W.ECON.cavar;
          ctx.strokeStyle = '#5f5140'; ctx.lineWidth = Math.max(2, z * 0.16); ctx.beginPath(); ctx.arc(px, py, z * 0.3, e.ang - 2.1 * fr, e.ang + 2.1 * fr); ctx.stroke();
        } else if (e.guardia && lod && !W.enTrinchera(m, e)) { // en guardia: una base fija bajo la unidad
          ctx.strokeStyle = P.tinta; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(px - r * 1.3, py + r * 1.9); ctx.lineTo(px + r * 1.3, py + r * 1.9); ctx.moveTo(px - r * 0.7, py + r * 1.9 + 3); ctx.lineTo(px + r * 0.7, py + r * 1.9 + 3); ctx.stroke();
        }
        if (e.j === YO) { if (m.t - e.llama < 14) signos.push([px, py - r * 1.9 - 20, '!']); else if (m.t - e.oyo < 36) signos.push([px, py - r * 1.9 - 20, '✓']); }
        if (e.arregla && lod && veo(e)) { // el ingeniero trabajando: una línea hasta lo que repara
          const o = m.porId.get(e.arregla);
          if (o && W.dist(e.x, e.y, o) <= 1.7) { ctx.strokeStyle = P.bien; ctx.lineWidth = 1.5; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(ox + (o.edif ? o.cx : o.x) * z, oy + (o.edif ? o.cy : o.y) * z); ctx.stroke(); ctx.setLineDash([]); }
        }
        if (d.mando && e.j === YO && (sel.has(e.id) || lod === 2)) { // radio del vehículo de mando
          ctx.strokeStyle = e.sinInfo ? P.mal : P.bien; ctx.lineWidth = 1; ctx.globalAlpha = sel.has(e.id) ? 0.6 : 0.22; ctx.setLineDash([2, 5]);
          ctx.beginPath(); ctx.arc(px, py, d.mando * z, 0, TAU); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
        }
        if (d.plazas && e.j === YO && lod && e.pasajeros.length) { // cuántos lleva dentro
          ctx.fillStyle = P.tinta; for (let q = 0; q < e.pasajeros.length; q++) ctx.fillRect(px - r * 1.2 + q * 4, py + r * 1.6 + 3, 3, 3);
        }
        if (d.despliega && sel.has(e.id) && e.j === YO) { // dónde quedaría el patio: verde si cabe
          const bx = ox + (Math.floor(e.x) - 1) * z, by = oy + (Math.floor(e.y) - 1) * z;
          ctx.strokeStyle = W.puedeDesplegar(m, e) ? P.bien : P.mal; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]); ctx.strokeRect(bx, by, z * 3, z * 3); ctx.setLineDash([]);
        }
        if (e.hack > m.t && lod) { // hackeado: un rayo quebrado encima
          const gx = px, gy = py - r * 1.6 - 6; ctx.strokeStyle = P.mal; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(gx - 5, gy - 4); ctx.lineTo(gx + 1, gy - 1); ctx.lineTo(gx - 2, gy + 1); ctx.lineTo(gx + 5, gy + 5); ctx.stroke();
        }
        if (lod && e.j === YO && e.sinSum >= W.ECON.sinSum) { // sin suministro: un rombo hueco rojo sobre la unidad
          const gx = px - r * 1.2 - 4, gy = py - r - 3; ctx.strokeStyle = P.mal; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(gx, gy - 4); ctx.lineTo(gx + 4, gy); ctx.lineTo(gx, gy + 4); ctx.lineTo(gx - 4, gy); ctx.closePath(); ctx.stroke();
        }
        if (e.rango && lod) { // galones de veteranía, junto a la unidad
          ctx.strokeStyle = P.tinta; ctx.lineWidth = 1.2; ctx.beginPath();
          for (let g2 = 0; g2 < e.rango; g2++) { const gx = px + r * 1.2 + 3, gy = py - r - g2 * 4; ctx.moveTo(gx - 3, gy + 2); ctx.lineTo(gx, gy - 1); ctx.lineTo(gx + 3, gy + 2); }
          ctx.stroke();
        }
        const fuel = d.aire && e.j === YO ? e.fuel / d.fuel : -1;
        if (sel.has(e.id) || e.vida < e.vidaMax || (fuel >= 0 && fuel < 0.35)) barras.push([px - Math.max(r * 1.3, 8), py - r * 1.9 - 8, Math.max(r * 2.6, 16), e.vida / e.vidaMax, m.t - e.curando < 12, fuel]);
      }
      if (!repasado) repasar();

      // Misiles balísticos: se ven siempre (el radar los canta), grandes, con su llama y su estela.
      for (const q of m.misiles) {
        const x = q.px + (q.x - q.px) * alfa, y = q.py + (q.y - q.py) * alfa, d = MIS[q.tipo];
        if (fuera(x, y)) continue;
        const a = Math.atan2(q.ty - q.y, q.tx - q.x), sx = ox + x * z, sy = oy + y * z, L = Math.max(7, z * (0.5 + d.area * 0.12)), w = Math.max(2.5, L * 0.22);
        if (!pausa && azar() < 0.7) parte('humo', x - Math.cos(a) * 0.4, y - Math.sin(a) * 0.4, (azar() - 0.5) * 0.2, (azar() - 0.5) * 0.2, 0.9, 0.16 + d.area * 0.02);
        ctx.fillStyle = 'rgba(0,0,0,0.15)'; ctx.beginPath(); ctx.ellipse(sx + L * 0.6, sy + L * 0.6, L * 0.6, w * 0.8, a, 0, TAU); ctx.fill(); // sombra, lejos: va alto
        ctx.save(); ctx.translate(sx, sy); ctx.rotate(a);
        ctx.fillStyle = '#e8912d'; ctx.beginPath(); ctx.moveTo(-L * 0.5, -w * 0.5); ctx.lineTo(-L * (0.85 + azar() * 0.25), 0); ctx.lineTo(-L * 0.5, w * 0.5); ctx.fill(); // llama
        ctx.fillStyle = q.j === YO ? P.yoOsc : P.rivalOsc; ctx.fillRect(-L * 0.5, -w * 0.5, L * 0.8, w);
        ctx.fillStyle = P.tinta; ctx.beginPath(); ctx.moveTo(L * 0.3, -w * 0.5); ctx.lineTo(L * 0.62, 0); ctx.lineTo(L * 0.3, w * 0.5); ctx.fill(); // ojiva
        ctx.fillRect(-L * 0.5, -w * 0.9, L * 0.14, w * 1.8); // aletas
        ctx.restore();
      }
      // Obuses en vuelo, con estela.
      ctx.lineCap = 'round';
      for (const p of m.proy) {
        if (p.sale > m.t) continue; // aún no ha salido del tubo
        const x = p.px + (p.x - p.px) * alfa, y = p.py + (p.y - p.py) * alfa;
        if (fuera(x, y) || !visible(x, y)) continue;
        const a = Math.atan2(p.ty - p.y, p.tx - p.x), c = Math.cos(a), s = Math.sin(a), sx = ox + x * z, sy = oy + y * z;
        ctx.strokeStyle = P.roca; ctx.globalAlpha = 0.45; ctx.lineWidth = Math.max(1, z * 0.06);
        ctx.beginPath(); ctx.moveTo(sx - c * z * 1.3, sy - s * z * 1.3); ctx.lineTo(sx, sy); ctx.stroke();
        ctx.strokeStyle = P.tinta; ctx.globalAlpha = 1; ctx.lineWidth = Math.max(2, z * 0.13);
        ctx.beginPath(); ctx.moveTo(sx - c * z * 0.28, sy - s * z * 0.28); ctx.lineTo(sx, sy); ctx.stroke();
      }
      // Balas de fusil: un trazo corto que cruza hasta el blanco.
      {
        const ahora = performance.now();
        for (let i = balas.length - 1; i >= 0; i--) {
          const b = balas[i], f = (ahora - b.t0) / b.dur;
          if (f < 0) continue;
          if (f >= 1) { if (b.chispa && visible(b.x2, b.y2)) parte('chispa', b.x2, b.y2, (azar() - 0.5) * 3, (azar() - 0.5) * 3, 0.18, 0); balas[i] = balas[balas.length - 1]; balas.pop(); continue; }
          const dx = b.x2 - b.x1, dy = b.y2 - b.y1;
          if (b.k === 'rifle') { // todo el recorrido de golpe, y se desvanece
            ctx.strokeStyle = P.tinta; ctx.globalAlpha = 0.55 * (1 - f) * (1 - f); ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(ox + b.x1 * z, oy + b.y1 * z); ctx.lineTo(ox + b.x2 * z, oy + b.y2 * z); ctx.stroke();
          } else { // un trazo que viaja: cabeza brillante y cola que se apaga
            const L = Math.hypot(dx, dy) || 1, cola = Math.min(0.5, 1.1 / L), f0 = Math.max(0, f - cola), fm = Math.max(0, f - cola * 0.4);
            ctx.strokeStyle = '#d9882a'; ctx.lineWidth = Math.max(1, z * 0.045); ctx.globalAlpha = 0.45;
            ctx.beginPath(); ctx.moveTo(ox + (b.x1 + dx * f0) * z, oy + (b.y1 + dy * f0) * z); ctx.lineTo(ox + (b.x1 + dx * fm) * z, oy + (b.y1 + dy * fm) * z); ctx.stroke();
            ctx.strokeStyle = '#f2c45c'; ctx.lineWidth = Math.max(1.2, z * 0.07); ctx.globalAlpha = 1;
            ctx.beginPath(); ctx.moveTo(ox + (b.x1 + dx * fm) * z, oy + (b.y1 + dy * fm) * z); ctx.lineTo(ox + (b.x1 + dx * f) * z, oy + (b.y1 + dy * f) * z); ctx.stroke();
          }
        }
        ctx.globalAlpha = 1;
      }
      ctx.lineCap = 'butt';
      // Partículas: humo, polvo, chispas, anillos y fogonazos.
      const ds = pausa ? 0 : dtCuadro / 1000;
      for (let i = parts.length - 1; i >= 0; i--) {
        const q = parts[i];
        q.v += ds;
        if (q.v >= q.m) { parts[i] = parts[parts.length - 1]; parts.pop(); continue; }
        q.x += q.vx * ds; q.y += q.vy * ds;
        const fr = q.v / q.m, sx = ox + q.x * z, sy = oy + q.y * z;
        if (!lod || sx < -40 || sy < -40 || sx > cw + 40 || sy > ch + 40 || !visible(q.x, q.y)) continue;
        ctx.globalAlpha = 1 - fr; ctx.beginPath();
        if (q.k === 'humo') { ctx.globalAlpha = 0.34 * (1 - fr); ctx.fillStyle = P.roca; ctx.arc(sx, sy, z * q.s * (0.6 + fr * 1.3), 0, TAU); ctx.fill(); }
        else if (q.k === 'polvo') { ctx.globalAlpha = 0.3 * (1 - fr); ctx.fillStyle = '#a3977f'; ctx.arc(sx, sy, z * q.s * (0.5 + fr), 0, TAU); ctx.fill(); }
        else if (q.k === 'chispa') { q.vx *= 0.93; q.vy *= 0.93; ctx.strokeStyle = '#e8912d'; ctx.lineWidth = Math.max(1, z * 0.06); ctx.moveTo(sx, sy); ctx.lineTo(sx - q.vx * z * 0.07, sy - q.vy * z * 0.07); ctx.stroke(); }
        else if (q.k === 'alma') { ctx.globalAlpha = 0.85 * (1 - fr) * (1 - fr); ctx.fillStyle = P.tinta; ctx.arc(sx, sy, Math.max(1.5, z * q.s * (1 - fr * 0.5)), 0, TAU); ctx.fill(); }
        else if (q.k === 'anillo') { ctx.globalAlpha = 0.8 * (1 - fr); ctx.strokeStyle = P.tinta; ctx.lineWidth = 1.5; ctx.arc(sx, sy, z * q.s * (1 - (1 - fr) * (1 - fr)), 0, TAU); ctx.stroke(); }
        else { ctx.fillStyle = '#f2c45c'; ctx.arc(sx, sy, z * q.s * (0.6 + fr * 0.6), 0, TAU); ctx.fill(); }
      }
      ctx.globalAlpha = 1;

      ctx.imageSmoothingEnabled = true;
      { const luz = W.luz(m); if (luz < 1) { ctx.fillStyle = 'rgba(14,20,48,' + (0.36 * (1 - luz)).toFixed(3) + ')'; ctx.fillRect(0, 0, cw, ch); } } // la noche: un velo azulado sobre el mapa
      ctx.drawImage(cNie, ox, oy, N * z, N * z);
      ctx.strokeStyle = P.tinta; ctx.lineWidth = 1; ctx.strokeRect(ox - 0.5, oy - 0.5, N * z + 1, N * z + 1);

      // Colmena: ondas de llamada que se desvanecen al alejarse, y enlaces entre quien llama y quien acude.
      for (let i = senales.length - 1; i >= 0; i--) {
        const q = senales[i], fr = (performance.now() - q.t0) / q.dur;
        if (fr >= 1) { senales.splice(i, 1); continue; }
        ctx.strokeStyle = q.k === 'onda' ? P.mal : P.bien; ctx.lineWidth = 1.2;
        if (q.k === 'flecha') { ctx.globalAlpha = 1 - fr; flecha(ox + q.x * z, oy + q.y * z, ox + q.x2 * z, oy + q.y2 * z, P.bien); }
        else if (q.k === 'onda') { ctx.globalAlpha = 0.55 * (1 - fr) * (1 - fr); ctx.beginPath(); ctx.arc(ox + q.x * z, oy + q.y * z, q.r * z * fr, 0, TAU); ctx.stroke(); }
        else { ctx.globalAlpha = 0.7 * (1 - fr); ctx.setLineDash([2, 4]); ctx.beginPath(); ctx.moveTo(ox + q.x * z, oy + q.y * z); ctx.lineTo(ox + q.x2 * z, oy + q.y2 * z); ctx.stroke(); ctx.setLineDash([]); }
      }
      ctx.globalAlpha = 1;
      giroCerca = false;
      if (giroPend) { // tras ordenar mover: la flecha sigue al cursor y un segundo clic derecho fija la orientación
        const g = giroPend, wx = aMundoX(raton.x), wy = aMundoY(raton.y), d = Math.hypot(wx - g.x, wy - g.y);
        g.ids = g.ids.filter((id) => m.porId.has(id)); // las bajas no anulan la orden
        if (g.ids.some((id) => m.porId.get(id).orden !== 'nada')) g.t0 = performance.now(); // mientras sigan en camino, el plazo no corre
        if (performance.now() - g.t0 > 12000 || !g.ids.length || !mismaSel(g.ids)) giroPend = null;
        else if (raton.dentro && d > 0.4 && d < 9) {
          giroCerca = true;
          ctx.globalAlpha = 0.8; flecha(ox + g.x * z, oy + g.y * z, raton.x, raton.y, P.tinta); ctx.globalAlpha = 1;
          ctx.fillStyle = P.tinta; ctx.fillText('clic: mirar hacia aquí', raton.x + 14, raton.y - 8);
        }
      }
      { // radio de vuelo: alrededor del aeródromo de cada avión seleccionado, o del aeródromo seleccionado
        const vistos = new Set();
        const aro = (b, rv) => { const kk = b.id + ':' + rv; if (vistos.has(kk)) return; vistos.add(kk); ctx.beginPath(); ctx.arc(ox + b.cx * z, oy + b.cy * z, rv * z, 0, TAU); ctx.stroke(); };
        ctx.strokeStyle = P.tinta; ctx.lineWidth = 1; ctx.globalAlpha = 0.35; ctx.setLineDash([8, 7]);
        for (const id of sel) {
          const e = m.porId.get(id);
          if (!e || e.j !== YO) continue;
          if (e.edif) { if (e.tipo === 'aerodromo') for (const t in UNID) if (UNID[t].aire) aro(e, UNID[t].radioVuelo); if (EDIF[e.tipo].intercepta) aro(e, EDIF[e.tipo].intercepta); }
          else if (UNID[e.tipo].aire && e.casa && m.porId.has(e.casa)) aro(m.porId.get(e.casa), UNID[e.tipo].radioVuelo);
        }
        ctx.setLineDash([]); ctx.globalAlpha = 1;
      }
      for (let k = flotantes.length - 1; k >= 0; k--) {
        const q = flotantes[k], fr = (performance.now() - q.t0) / 1100;
        if (fr >= 1) { flotantes.splice(k, 1); continue; }
        ctx.globalAlpha = 1 - fr * fr; ctx.fillStyle = q.color; ctx.textAlign = 'center';
        ctx.fillText(q.txt, ox + q.x * z, oy + q.y * z - 14 - fr * 18);
        ctx.textAlign = 'left'; ctx.globalAlpha = 1;
      }
      for (const s of signos) { // ! pide apoyo, ✓ acude
        const k = 6 + (s[2] === '!' ? Math.sin(performance.now() * 0.012) * 1.5 : 0);
        ctx.fillStyle = s[2] === '!' ? P.mal : P.bien; ctx.beginPath(); ctx.arc(s[0], s[1], k + 2, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.beginPath();
        if (s[2] === '!') { ctx.moveTo(s[0], s[1] - 4); ctx.lineTo(s[0], s[1] + 0.5); ctx.moveTo(s[0], s[1] + 3.6); ctx.lineTo(s[0], s[1] + 3.7); }
        else { ctx.moveTo(s[0] - 3.5, s[1]); ctx.lineTo(s[0] - 1, s[1] + 2.8); ctx.lineTo(s[0] + 3.8, s[1] - 2.8); }
        ctx.stroke(); ctx.lineCap = 'butt';
      }

      for (const b of barras) {
        ctx.fillStyle = P.fondo; ctx.fillRect(b[0], b[1], b[2], 3);
        ctx.fillStyle = b[3] > 0.5 ? P.bien : b[3] > 0.25 ? P.rival : P.mal; ctx.fillRect(b[0], b[1], b[2] * Math.max(0, b[3]), 3);
        if (b[5] >= 0) { ctx.fillStyle = P.fondo; ctx.fillRect(b[0], b[1] + 4, b[2], 2); ctx.fillStyle = b[5] > 0.3 ? P.tinta : P.mal; ctx.fillRect(b[0], b[1] + 4, b[2] * b[5], 2); } // combustible
        if (b[4]) { // se está curando: una cruz que late junto a la barra
          const cx = b[0] + b[2] + 6, cy = b[1] + 1.5, k = 3 + Math.sin(performance.now() * 0.008);
          ctx.strokeStyle = P.bien; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx - k, cy); ctx.lineTo(cx + k, cy); ctx.moveTo(cx, cy - k); ctx.lineTo(cx, cy + k); ctx.stroke();
        }
      }
      const ahora = performance.now();
      for (let k = marcas.length - 1; k >= 0; k--) {
        const a = (ahora - marcas[k].t0) / 450;
        if (a >= 1) { marcas.splice(k, 1); continue; }
        ctx.strokeStyle = marcas[k].color; ctx.globalAlpha = 1 - a; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(ox + marcas[k].x * z, oy + marcas[k].y * z, z * (0.2 + a * 0.7), 0, TAU); ctx.stroke();
      }
      ctx.globalAlpha = 1;

      if (modo === 'colocar' && EDIF[tipoColocar].sobre) { // señala los sitios donde cabe este edificio
        const f2 = 0.5 + 0.5 * Math.sin(performance.now() * 0.006);
        ctx.strokeStyle = P.bien; ctx.lineWidth = 2; ctx.globalAlpha = 0.4 + 0.5 * f2;
        for (const s of mp.sitios) {
          if (s.tipo !== EDIF[tipoColocar].sobre || fuera(s.x, s.y) || !f[s.y * N + s.x] || m.ocup[s.y * N + s.x]) continue;
          ctx.beginPath(); ctx.arc(ox + (s.x + 0.5) * z, oy + (s.y + 0.5) * z, z * (1.5 + f2 * 0.4), 0, TAU); ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
      if (modo === 'colocar' && raton.dentro) {
        const p = esquinaColocar(tipoColocar), t = EDIF[tipoColocar].tam, vale = W.puedeColocar(m, YO, tipoColocar, p.x, p.y);
        ctx.fillStyle = vale ? P.bien : P.mal; ctx.globalAlpha = 0.45;
        ctx.fillRect(ox + p.x * z, oy + p.y * z, t * z, t * z);
        ctx.globalAlpha = 1; ctx.strokeStyle = vale ? P.bien : P.mal; ctx.lineWidth = 1.5;
        ctx.strokeRect(ox + p.x * z, oy + p.y * z, t * z, t * z);
      }
      if (raton.izq && Math.hypot(raton.x - raton.x0, raton.y - raton.y0) > 5) {
        ctx.strokeStyle = P.tinta; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
        ctx.strokeRect(raton.x0, raton.y0, raton.x - raton.x0, raton.y - raton.y0);
        ctx.setLineDash([]);
      }
      ctx.font = '11px "Fira Code", ui-monospace, monospace';
      if (pausa || modo === 'amover' || modo === 'patrulla' || modo === 'barrido') {
        ctx.fillStyle = P.tinta;
        ctx.fillText(pausa ? 'pausa' : modo === 'amover' ? 'atacar al avanzar: elige destino' : modo === 'barrido' ? 'barrido: elige la zona a revelar' : 'patrulla: elige el punto (con Mayús añades más)', 12, ch - 14);
      }
      if (modo === 'conectar' && raton.dentro) { // la línea que saldría del último edificio marcado, y lo que costaría
        const a = conectaDesde ? m.porId.get(conectaDesde) : null, wx = aMundoX(raton.x), wy = aMundoY(raton.y), e = entEn(wx, wy), vale = e && e.edif && !e.infra && e.j === YO;
        if (a) {
          const bx = vale ? e.cx : wx, by = vale ? e.cy : wy;
          ctx.strokeStyle = vale && e !== a ? P.bien : P.tinta; ctx.lineWidth = 2; ctx.globalAlpha = 0.6; ctx.setLineDash([6, 4]);
          ctx.beginPath(); ctx.moveTo(ox + a.cx * z, oy + a.cy * z); ctx.lineTo(ox + bx * z, oy + by * z); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
          ctx.fillStyle = P.tinta; ctx.fillText(vale && e !== a ? 'línea de servicio: ' + Math.ceil(Math.hypot(bx - a.cx, by - a.cy) * W.ECON.lineaCelda) + ' minerales' : 'toca el edificio que quieres unir', raton.x + 14, raton.y - 8);
        } else { ctx.fillStyle = P.tinta; ctx.fillText('conectar: toca el edificio de partida', raton.x + 14, raton.y - 8); }
      }
      if (modo === 'trazar' && raton.dentro) { // por dónde irá el camino y cuánto costará, a ojo: en rojo si el destino no vale
        const ex = unidadesSel().find((u) => UNID[u.tipo].traza);
        if (ex) {
          const x0 = trazaDesde ? trazaDesde.x : ex.x, y0 = trazaDesde ? trazaDesde.y : ex.y, wx = aMundoX(raton.x), wy = aMundoY(raton.y), L = Math.hypot(wx - x0, wy - y0);
          let costo = 0, mal = wx < 0 || wy < 0 || wx >= N || wy >= N;
          for (let i = 0, n = Math.ceil(L * 2); i <= n && !mal; i++) {
            const t = m.mapa.terreno[Math.floor(y0 + ((wy - y0) * i) / (n || 1)) * N + Math.floor(x0 + ((wx - x0) * i) / (n || 1))];
            if (i === n && t === 1) mal = true;
            costo += t === 3 ? W.ECON.caminoBosque : t === 2 ? W.ECON.caminoAgua : t === 0 ? W.ECON.caminoLlano : 0; // dos muestras por celda y dos celdas de ancho: sale la cuenta
          }
          ctx.strokeStyle = mal ? P.mal : P.bien; ctx.lineWidth = Math.max(3, z * 0.9); ctx.globalAlpha = 0.28; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(ox + x0 * z, oy + y0 * z); ctx.lineTo(raton.x, raton.y); ctx.stroke(); ctx.globalAlpha = 1; ctx.lineCap = 'butt';
          ctx.fillStyle = mal ? P.mal : P.tinta; ctx.fillText(mal ? 'ahí no llega un camino' : 'camino: unos ' + Math.round(costo) + ' minerales · Mayús: más tramos', raton.x + 14, raton.y - 8);
        }
      }
      if (modo === 'lanzar') { // alcance del misil elegido y, bajo el cursor, la zona que arrasará
        const e = misilera(), d = MIS[lanzaTipo];
        if (e && d) {
          if (d.alcance) { ctx.strokeStyle = P.tinta; ctx.globalAlpha = 0.4; ctx.lineWidth = 1.5; ctx.setLineDash([10, 8]); ctx.beginPath(); ctx.arc(ox + e.cx * z, oy + e.cy * z, d.alcance * z, 0, TAU); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1; }
          if (raton.dentro) {
            const wx = aMundoX(raton.x), wy = aMundoY(raton.y), vale = wx >= 0 && wy >= 0 && wx < N && wy < N && m.niebla[YO][Math.floor(wy) * N + Math.floor(wx)] && W.alcanceMisil(m, e, lanzaTipo, wx, wy);
            ctx.strokeStyle = P.mal; ctx.fillStyle = P.mal; ctx.lineWidth = 2; ctx.globalAlpha = vale ? 0.9 : 0.35; ctx.beginPath(); ctx.arc(raton.x, raton.y, d.area * z, 0, TAU); ctx.stroke(); ctx.globalAlpha = vale ? 0.12 : 0.04; ctx.fill(); ctx.globalAlpha = 1;
            ctx.fillStyle = P.tinta; ctx.fillText(vale ? d.nombre + ': daña todo lo que haya en el círculo, también lo tuyo' : 'ahí no llega (o no está explorado)', raton.x + 14, raton.y - 8);
          }
        } else modo = null;
      }
      if (modo === 'barrido' && raton.dentro) { // zona que revelará el barrido
        ctx.strokeStyle = P.tinta; ctx.lineWidth = 1; ctx.setLineDash([6, 4]); ctx.beginPath(); ctx.arc(raton.x, raton.y, W.INTEL.barrido.radio * z, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
      }
      for (let k = avisos.length - 1, fila = 0; k >= 0; k--) { // avisos, arriba al centro
        const a = avisos[k], edad = (performance.now() - a.t0) / 6000;
        if (edad >= 1) { avisos.splice(k, 1); continue; }
        const w = ctx.measureText(a.txt).width + 16, x = (cw - w) / 2, y = 10 + fila++ * 24;
        ctx.globalAlpha = Math.min(1, (1 - edad) * 3);
        ctx.fillStyle = P.tinta; ctx.fillRect(x, y, w, 20); ctx.fillStyle = P.fondo; ctx.fillText(a.txt, x + 8, y + 14);
        ctx.globalAlpha = 1;
      }
      // Etiqueta de lo que hay bajo el cursor.
      if (raton.dentro && !raton.izq && !raton.arrastre && !raton.medio && !giroCerca && !toque) {
        const txt = bajoCursor();
        if (txt) {
          const w = ctx.measureText(txt).width + 12, x = Math.min(raton.x + 14, cw - w - 4), y = Math.min(raton.y + 18, ch - 22);
          ctx.fillStyle = P.fondo; ctx.globalAlpha = 0.92; ctx.fillRect(x, y, w, 18); ctx.globalAlpha = 1;
          ctx.strokeStyle = P.tinta; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, 17);
          ctx.fillStyle = P.tinta; ctx.fillText(txt, x + 6, y + 13);
        }
      }
    }

    function dibujarMini() {
      const k = MS / N, f = m.niebla[YO];
      mctx.imageSmoothingEnabled = false;
      mctx.drawImage(cTerr, 0, 0, MS, MS);
      mctx.fillStyle = P.mineral;
      for (const c of m.minas) if (f[c]) mctx.fillRect((c % N) * k, ((c / N) | 0) * k, 2, 2);
      mctx.fillStyle = P.raro;
      for (const c of m.raros) if (f[c]) mctx.fillRect((c % N) * k, ((c / N) | 0) * k, 2, 2);
      mctx.fillStyle = P.tinta; // yacimientos y campos: cuadro pequeño
      for (const s of m.mapa.sitios) if (f[s.y * N + s.x]) mctx.fillRect(s.x * k - 1, s.y * k - 1, 3, 3);
      for (const e of m.ents) {
        if (e.infra || !veo(e)) continue;
        mctx.fillStyle = e.j === YO ? P.yo : P.rival;
        if (e.edif) mctx.fillRect(e.x * k, e.y * k, Math.max(3, e.tam * k), Math.max(3, e.tam * k)); else mctx.fillRect(e.x * k - 1, e.y * k - 1, 2.5, 2.5);
      }
      mctx.imageSmoothingEnabled = true;
      mctx.drawImage(cNie, 0, 0, MS, MS);
      { // caminos, en el minimapa: una línea fina
        mctx.strokeStyle = P.camino; mctx.lineWidth = 1.5; mctx.beginPath();
        for (const e of m.ents) { if (!e.infra || e.linea) continue; const tr = e.pts; mctx.moveTo(tr[0] * k, tr[1] * k); for (let q = 2; q < tr.length; q += 2) mctx.lineTo(tr[q] * k, tr[q + 1] * k); }
        mctx.stroke();
      }
      for (const q of m.misiles) { // misiles en el minimapa: un punto que parpadea; el propio, con la línea a su blanco
        mctx.fillStyle = q.j === YO ? P.yo : P.mal; mctx.beginPath(); mctx.arc(q.x * k, q.y * k, 2.5 + ((m.t >> 2) % 2), 0, TAU); mctx.fill();
        if (q.j === YO) { mctx.strokeStyle = P.yo; mctx.lineWidth = 1; mctx.setLineDash([3, 3]); mctx.beginPath(); mctx.moveTo(q.x * k, q.y * k); mctx.lineTo(q.tx * k, q.ty * k); mctx.stroke(); mctx.setLineDash([]); }
      }
      for (const p of m.puestos) { // puestos: rombo del color de su dueño
        if (!m.niebla[YO][Math.floor(p.y) * N + Math.floor(p.x)]) continue;
        mctx.fillStyle = p.dueno === YO ? P.yo : p.dueno >= 0 ? P.rival : P.tinta;
        mctx.beginPath(); mctx.moveTo(p.x * k, p.y * k - 3.5); mctx.lineTo(p.x * k + 3.5, p.y * k); mctx.lineTo(p.x * k, p.y * k + 3.5); mctx.lineTo(p.x * k - 3.5, p.y * k); mctx.closePath(); mctx.fill();
      }
      { // patios: los propios, con un aro; del rival, su último patio (o patio móvil) queda a la vista cuando ya ha perdido alguno
        const R = m.jug[1 - YO], delata = R.patiosMax > 1 && (R.cuenta.patio || 0) <= 1;
        mctx.lineWidth = 1.5;
        for (const e of m.ents) {
          if (e.tipo !== 'patio' && e.tipo !== 'patioMovil') continue;
          if (e.j === YO) { if (e.edif) { const lista = J.obras.some((o) => o.listo && o.patio === e.id); mctx.strokeStyle = lista ? P.bien : P.yo; mctx.lineWidth = lista ? 2.5 : 1.5; mctx.beginPath(); mctx.arc(e.cx * k, e.cy * k, lista ? 6 + ((m.t >> 3) % 3) : 5, 0, TAU); mctx.stroke(); mctx.lineWidth = 1.5; } } // con un edificio por colocar, el aro late en verde
          else if (delata && (e.edif || !R.cuenta.patio)) { mctx.strokeStyle = P.rival; mctx.beginPath(); mctx.arc((e.edif ? e.cx : e.x) * k, (e.edif ? e.cy : e.y) * k, 5 + ((m.t >> 3) % 3), 0, TAU); mctx.stroke(); }
        }
      }
      if (J.alerta && m.t - J.alerta.t < 60 && (m.t >> 2) % 2) { mctx.strokeStyle = P.mal; mctx.lineWidth = 2; mctx.beginPath(); mctx.arc(J.alerta.x * k, J.alerta.y * k, 7, 0, TAU); mctx.stroke(); }
      mctx.strokeStyle = P.tinta; mctx.lineWidth = 1;
      mctx.strokeRect((cam.x - cw / 2 / cam.z) * k + 0.5, (cam.y - ch / 2 / cam.z) * k + 0.5, (cw / cam.z) * k, (ch / cam.z) * k);
    }

    // ---------- sonido: se deduce de los cambios del mundo, sin tocar la simulación ----------
    function sonar() {
      const cerca = (x, y) => { // 1 en el centro de la pantalla, 0 fuera de ella
        const dx = Math.abs(x - cam.x) / (cw / cam.z), dy = Math.abs(y - cam.y) / (ch / cam.z);
        return dx > 0.6 || dy > 0.6 ? 0 : 1 - Math.max(dx, dy);
      };
      const paneo = (x) => Math.max(-1, Math.min(1, (x - cam.x) / (cw / cam.z / 2)));
      let n = 0;
      for (const d of m.efectos) { // cada aviso de la simulación se vuelve sonido y partículas, una sola vez
        if (d.t < oido.t) continue;
        if (d.tipo === 'tec') {
          const t = W.TEC[d.clave];
          if (d.j === YO) { aviso('Investigación lista: ' + t.nombre); son.obraLista(); }
          else if (t.sube) { aviso('El rival alcanzó el nivel ' + t.sube); son.alerta(); }
          continue;
        }
        const enVista = visible(d.x2, d.y2);
        if (d.tipo === 'traza' || d.tipo === 'boca') {
          if (!visible(d.x1, d.y1)) continue;
          if (n++ < 6) son.disparo(d.arma, cerca(d.x1, d.y1), paneo(d.x1));
          if (d.tipo === 'boca') parte('humo', d.x1, d.y1, (azar() - 0.5) * 0.4, -0.3, 0.6, 0.16);
          else bala(d);
        } else if (d.tipo === 'impacto') {
          if (!enVista) continue;
          const area = W.ARMAS[d.arma].area || 0; // los obuses de área dejan un cráter mayor
          estallido(d.x2, d.y2, area ? 2 : 1); marcaSuelo('quemado', d.x2, d.y2, area || 0.42, 0, 15000);
          if (n++ < 6) son.impacto(cerca(d.x2, d.y2), paneo(d.x2));
        } else if (d.tipo === 'explorado') {
          if (d.j === YO && performance.now() - (avisoExpl || 0) > 3000) { avisoExpl = performance.now(); aviso(J.tr.mapa ? 'Nada que explorar: el mapa está revelado desde ADMIN' : 'No queda nada por explorar'); }
        } else if (d.tipo === 'lanzamiento') {
          if (d.j === YO) son.explosion(0.5, 0, false); else { aviso('¡Misil enemigo en vuelo: ' + MIS[d.clase].nombre + '!'); son.alerta(); }
          if (visible(d.x1, d.y1)) { estallido(d.x1, d.y1, 2); for (let k = 0; k < 6; k++) parte('humo', d.x1 + (azar() - 0.5), d.y1 + (azar() - 0.5), (azar() - 0.5) * 0.8, (azar() - 0.5) * 0.8, 1.6, 0.35); }
        } else if (d.tipo === 'impactoMisil') {
          for (let k = 0; k < 4 + d.area * 2; k++) { const a = azar() * TAU, r = azar() * d.area * 0.8; estallido(d.x2 + Math.cos(a) * r, d.y2 + Math.sin(a) * r, 3); }
          parte('anillo', d.x2, d.y2, 0, 0, 0.9, d.area * 1.4); marcaSuelo('quemado', d.x2, d.y2, d.area, 0, 60000);
          son.explosion(Math.max(0.5, cerca(d.x2, d.y2)), paneo(d.x2), true); aviso(MIS[d.clase].nombre + (d.j === YO ? ': impacto' : ' enemigo: impacto'));
        } else if (d.tipo === 'intercepta') {
          balas.push({ x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2, t0: performance.now(), dur: 420, k: 'rifle' });
          if (d.derribo) { estallido(d.x2, d.y2, 2); aviso(d.j === YO ? 'Misil enemigo derribado' : 'Te han derribado un misil'); son.explosion(Math.max(0.2, cerca(d.x2, d.y2)), paneo(d.x2), false); }
        } else if (d.tipo === 'misilListo') {
          if (d.j === YO) { aviso(MIS[d.clase].nombre + ' listo en la misilera'); son.unidadLista(); }
        } else if (d.tipo === 'hack') {
          if (d.de === YO) { aviso('¡Te han hackeado: ' + (EDIF[d.clase] || UNID[d.clase]).nombre.toLowerCase() + '!'); son.alerta(); } else if (d.j === YO) aviso('Hackeado: ' + (EDIF[d.clase] || UNID[d.clase]).nombre.toLowerCase());
          if (visible(d.x2, d.y2)) senales.push({ k: 'onda', x: d.x2, y: d.y2, r: 2.2, t0: performance.now(), dur: 700 });
        } else if (d.tipo === 'sinInfo') {
          if (d.j === YO) aviso('Sin información: el hacker no puede (' + W.ECON.hackInfo + ' por hackeo)');
        } else if (d.tipo === 'sinLinea') {
          if (d.j === YO) aviso(d.llegar ? 'El ingeniero civil no puede llegar a ese edificio' : 'Sin minerales: la línea de servicio espera');
        } else if (d.tipo === 'sinCamino') {
          if (d.j === YO) aviso(d.corte ? 'La excavadora no encuentra por dónde seguir' : 'Sin minerales: la excavadora se detiene');
        } else if (d.tipo === 'captura') {
          const que = d.clase === 'antena' ? 'una antena' : d.clase === 'deposito' ? 'un depósito' : 'un taller';
          if (d.j === YO) { son.obraLista(); aviso('Has capturado ' + que); } else if (visible(d.x2, d.y2) || m.puestos.some((p) => p.x === d.x2 && p.y === d.y2)) aviso('El rival ha capturado ' + que);
        } else if (d.tipo === 'despliega') {
          if (d.j === YO) { son.colocar(); aviso('Patio desplegado: ya puedes construir a su alrededor'); }
        } else if (d.tipo === 'muerte') {
          if (d.edif && d.clase === 'patio' && d.j === YO && m.ganador < 0) aviso('¡Has perdido un patio!');
          else if (d.edif && d.clase === 'patio' && m.ganador < 0) aviso('Patio enemigo destruido');
          else if (d.clase === 'camino' && d.j === YO) aviso('Te han cortado un camino');
          else if (d.clase === 'linea' && d.j === YO) aviso('Te han cortado una línea de servicio');
          if (!enVista) continue;
          if (d.edif) {
            for (let k = 0; k < d.tam * 2; k++) estallido(d.x2 + (azar() - 0.5) * d.tam * 0.8, d.y2 + (azar() - 0.5) * d.tam * 0.8, 2);
            estallido(d.x2, d.y2, 3); marcaSuelo('ruina', d.x2, d.y2, d.tam, 0, 45000);
          } else {
            if (UNID[d.clase].cat === 'inf') parte('alma', d.x2, d.y2, (azar() - 0.5) * 0.15, -0.75, 1.5, 0.07); // la infantería no estalla: un puntito que sube y se apaga
            else { // el vehículo se queda en chatarra humeante, sin estallido
              for (let k = 0; k < 4; k++) parte('humo', d.x2 + (azar() - 0.5) * 0.3, d.y2 + (azar() - 0.5) * 0.3, (azar() - 0.5) * 0.3, -0.35 - azar() * 0.5, 1.2 + azar() * 1.2, 0.2 + azar() * 0.12);
              marcaSuelo('quemado', d.x2, d.y2, UNID[d.clase].radio * 1.6, 0, 20000);
            }
            marcaSuelo('resto', d.x2, d.y2, UNID[d.clase].radio, d.ang, 25000, d.clase);
          }
          if (d.edif) son.explosion(Math.max(0.12, cerca(d.x2, d.y2)), paneo(d.x2), true);
          else if (UNID[d.clase].cat !== 'inf') son.explosion(Math.max(0.12, cerca(d.x2, d.y2)) * 0.35, paneo(d.x2), false); // un golpe sordo, no una explosión
        } else if (d.tipo === 'llama') { // onda de la llamada: solo se ve y se oye la propia
          if (d.j !== YO) continue;
          senales.push({ k: 'onda', x: d.x2, y: d.y2, r: d.r, t0: performance.now(), dur: 900 });
          if (performance.now() - oido.llamada > 2500) { oido.llamada = performance.now(); son.llamada(Math.max(0.25, cerca(d.x2, d.y2)), paneo(d.x2)); }
        } else if (d.tipo === 'oye') {
          if (d.j !== YO) continue;
          senales.push({ k: 'enlace', x: d.x1, y: d.y1, x2: d.x2, y2: d.y2, t0: performance.now(), dur: 1100 });
          if (n++ < 6) son.acude(Math.max(0.2, cerca(d.x1, d.y1)), paneo(d.x1));
        } else if (d.tipo === 'flanco') { // golpe por el costado o la espalda de un vehículo
          if (enVista) flotar(d.x1, d.y1, d.s === 2 ? 'espalda +50 %' : 'costado +25 %', d.j === YO ? P.mal : P.bien);
        } else if (d.tipo === 'ascenso') {
          if (d.j === YO) { flotar(d.x1, d.y1, 'veterano ' + '▲'.repeat(d.rango), P.tinta); if (n++ < 6) son.unidadLista(); }
        } else if (d.tipo === 'retira') {
          if (d.j === YO) flotar(d.x1, d.y1, 'se retira a reparar', P.suave || P.tinta);
        } else if (d.tipo === 'huye') {
          if (d.j === YO && performance.now() - (oido.huye || 0) > 4000) { oido.huye = performance.now(); aviso('Cosechadora atacada: se refugia en la refinería'); }
        } else if (d.tipo === 'reposta') {
          if (d.j === YO && performance.now() - (oido.reposta || 0) > 4000) { oido.reposta = performance.now(); aviso('Un avión vuelve a repostar'); }
        } else if (d.tipo === 'venta') {
          for (let k = 0; k < d.tam * 4; k++) parte('polvo', d.x2 + (azar() - 0.5) * d.tam, d.y2 + (azar() - 0.5) * d.tam, (azar() - 0.5) * 0.6, -0.2 - azar() * 0.4, 1 + azar(), 0.4);
          if (d.j === YO) son.colocar();
        }
      }
      oido.t = m.t;
      let cercania = 0, cuantos = 0; // rumor de motores: manda el vehículo más cercano; los demás apenas suman
      for (const e of m.ents) if (!e.edif && UNID[e.tipo].cat === 'veh' && e.v > 0.01 && veo(e)) { const c = cerca(e.x, e.y); if (c > 0) { cuantos++; if (c > cercania) cercania = c; } }
      son.motor(cuantos ? cercania * (0.6 + 0.4 * (1 - Math.pow(0.6, cuantos - 1))) : 0);
      const listas = J.obras.filter((o) => o.listo).length;
      if (listas > oido.listas) son.obraLista();
      oido.listas = listas;
      if (J.producidas > oido.producidas) son.unidadLista();
      oido.producidas = J.producidas;
      let edificios = 0;
      for (const tipo in EDIF) if (!EDIF[tipo].infra) edificios += J.cuenta[tipo] || 0;
      if (edificios > oido.edificios && oido.edificios) son.colocar();
      oido.edificios = edificios;
      if (J.alerta && J.alerta.t > oido.alerta + 300) { oido.alerta = J.alerta.t; if (cerca(J.alerta.x, J.alerta.y) === 0) son.alerta(); }
    }

    // ---------- avisos breves sobre el mapa ----------
    // Textos que suben y se desvanecen sobre el mapa (flancos, ascensos, retiradas).
    const flotantes = [];
    function flotar(x, y, txt, color) { flotantes.push({ x, y, txt, color, t0: performance.now() }); if (flotantes.length > 40) flotantes.shift(); }
    const avisos = []; let avisoExpl = 0;
    function aviso(txt) { avisos.push({ txt, t0: performance.now() }); if (avisos.length > 4) avisos.shift(); }

    // ---------- dibujos de las casillas ----------
    // Cada unidad y edificio se dibuja una vez por tema, con la misma ficha que en el mapa, y queda como fondo de su casilla (.i-tipo).
    function hacerIconos() {
      try {
        const lz = document.createElement('canvas'), c = lz.getContext('2d'); lz.width = 120; lz.height = 52;
        let css = '';
        for (const tipo in UNID) {
          const d = UNID[tipo], r = Math.max(14, Math.min(d.aire ? 19 : 22, d.radio * (d.cat === 'inf' ? 125 : 100))); // en píxeles del lienzo, al doble de la casilla
          c.clearRect(0, 0, 120, 52); c.save(); c.translate(60, 26);
          W.fichaUnidad(c, { tipo, id: 1, j: YO }, r, 2, COL.yo, { ang: d.aire ? -0.5 : -0.3, angT: -0.3, retro: 0, anda: false, tiempo: 0, carga: 0, cosecha: false, raro: false });
          c.restore(); css += '.i-' + tipo + '{background-image:url(' + lz.toDataURL() + ')}';
        }
        for (const tipo in EDIF) {
          if (EDIF[tipo].infra) continue;
          c.clearRect(0, 0, 120, 52); c.save();
          W.fichaEdificio(c, { tipo, id: 1, j: YO }, 38, 4, 44, 2, COL.yo, { tiempo: 0, id: 1, vida: 1, deficit: false, activo: true, descarga: 0, ang: -0.6, retro: 0 });
          c.restore(); css += '.i-' + tipo + '{background-image:url(' + lz.toDataURL() + ')}';
        }
        let st = document.getElementById('icoCss');
        if (!st) { st = document.createElement('style'); st.id = 'icoCss'; document.head.appendChild(st); }
        st.textContent = css;
      } catch (e) { console.error('iconos', e); }
    }

    // ---------- tecnología e inteligencia ----------
    const precioCorto = (d) => { const p = [d.costo ? String(d.costo) : '', d.pet ? d.pet + 'p' : '', d.raros ? d.raros + 'r' : '', d.info ? d.info + 'i' : ''].filter(Boolean); return p.length > 1 ? p.join('+') : precio(d); }; // en la casilla: 1400+100p
    let hayTecG = false; // hay mejoras que mostrar para lo seleccionado
    const precio = (d) => [d.costo ? String(d.costo) : '', d.pet ? d.pet + ' pet' : '', d.raros ? d.raros + ' rar' : '', d.info ? d.info + ' inf' : ''].filter(Boolean).join(' + ');
    let tiposSel = new Set(); // tipos de edificio propios seleccionados: deciden qué muestra la barra
    const botonesTec = [];
    for (const clave in W.TEC) {
      const t = W.TEC[clave], b = document.createElement('button');
      b.className = 'cas txt'; b.type = 'button';
      b.innerHTML = '<span class="n"></span><span class="c"></span><span class="x" title="Cancelar">×</span>';
      b.title = t.nombre + ' · ' + precio(t) + '. ' + t.que + ' Se investiga en: ' + EDIF[t.lugar].nombre + '.';
      b.addEventListener('click', () => { son.activar(); W.orden(m, { t: 'investigar', j: YO, clave }); });
      const cancelar = (ev) => { ev.preventDefault(); ev.stopPropagation(); W.orden(m, { t: 'cancelarInv', j: YO, clave }); };
      b.addEventListener('contextmenu', cancelar); b.querySelector('.x').addEventListener('click', cancelar);
      $('bTec').appendChild(b);
      botonesTec.push({ b, clave, t, n: b.querySelector('.n'), c: b.querySelector('.c') });
    }
    const botonesIntel = [];
    for (const clave in W.INTEL) {
      const it = W.INTEL[clave], b = document.createElement('button');
      b.className = 'cas txt'; b.type = 'button';
      b.innerHTML = '<span class="n"></span><span class="c"></span>';
      b.firstChild.textContent = it.nombre; b.title = it.nombre + '. ' + it.que;
      b.addEventListener('click', () => {
        if (J.nivel < it.nivel || J.info < it.info) return;
        if (clave === 'barrido') modo = 'barrido'; else { W.orden(m, { t: 'intel', j: YO, clave }); son.orden(); }
      });
      $('bIntel').appendChild(b);
      botonesIntel.push({ b, clave, it, c: b.lastChild });
    }
    function actualizarTec() {
      $('nivel').textContent = J.nivel;
      let hayTec = false;
      for (const o of botonesTec) {
        const t = o.t, enCurso = J.inv.find((i) => i.clave === o.clave);
        const hecha = J.mejoras[o.clave] || (t.sube && J.nivel >= t.sube);
        // Se muestran las que se pueden investigar ahora y la siguiente subida de nivel.
        const visible = tiposSel.has(t.lugar) && !hecha && (enCurso || (t.sube ? J.nivel === t.nivel : J.nivel >= t.nivel));
        o.b.hidden = !visible;
        if (!visible) continue;
        hayTec = true;
        let clase = 'cas txt', txt = precioCorto(t), p = 0;
        if (enCurso) { clase += ' hay'; p = enCurso.prog / t.tiempo; txt = Math.floor(p * 100) + '%'; }
        else if (J.inv.some((i) => W.TEC[i.clave].lugar === t.lugar)) clase += ' no';
        else if (!W.puedePagar(J, t)) clase += ' caro';
        if (o.b.className !== clase) o.b.className = clase;
        if (o.n.textContent !== t.nombre) o.n.textContent = t.nombre;
        if (o.c.textContent !== txt) o.c.textContent = txt;
        o.b.style.setProperty('--p', (p * 100).toFixed(1) + '%');
      }
      const hechas = Object.keys(J.mejoras).length;
      const th = hechas ? '· ' + hechas + (hechas === 1 ? ' mejora' : ' mejoras') : '';
      if ($('hechas').textContent !== th) $('hechas').textContent = th;
      hayTecG = hayTec;
      for (const o of botonesIntel) {
        const falta = J.nivel < o.it.nivel, clase = 'cas txt' + (falta ? ' no' : J.info < o.it.info ? ' caro' : ''), txt = falta ? 'nivel ' + o.it.nivel : o.it.info + ' inf';
        if (o.b.className !== clase) o.b.className = clase;
        if (o.c.textContent !== txt) o.c.textContent = txt;
      }
      // Interceptar: mientras dura, se ven los recursos del rival y qué produce.
      let espia = '';
      if (m.t < J.intercepta) {
        const R = m.jug[1 - YO], obras = R.obras.filter((o) => !o.listo).map((o) => EDIF[o.tipo].nombre), tropas = Object.keys(R.colas).filter((t) => R.colas[t].n).map((t) => UNID[t].nombre);
        espia = 'Rival · nivel ' + R.nivel + ' · ' + Math.floor(R.minerales) + ' min · ' + Math.floor(R.petroleo) + ' pet'
          + (obras.length ? ' · construye: ' + obras.join(', ') : '') + (tropas.length ? ' · entrena: ' + tropas.join(', ') : '') + (R.inv.length ? ' · investiga: ' + R.inv.map((i) => W.TEC[i.clave].nombre).join(', ') : '');
      }
      if ($('espia').textContent !== espia) $('espia').textContent = espia;
    }

    // ---------- formación y demolición ----------
    function ponerForma(f) { forma = f; for (const b of $('formas').children) b.classList.toggle('on', b.dataset.f === f); }
    $('formas').addEventListener('click', (ev) => { const b = ev.target.closest('[data-f]'); if (b) ponerForma(b.dataset.f); });
    const vendibles = () => [...sel].map((id) => m.porId.get(id)).filter((e) => e && e.edif && e.j === YO && e.tipo !== 'patio');
    const valorVenta = (e) => Math.floor(EDIF[e.tipo].costo * W.ECON.venta * (e.vida / e.vidaMax));
    function vender() { for (const e of vendibles()) W.orden(m, { t: 'vender', j: YO, id: e.id }); }
    $('vender').addEventListener('click', vender);
    const enPuesto = () => unidadesSel().filter((u) => u.j === YO && u.trin); // los que ocupan (o van a ocupar) una trinchera
    const paraCavar = () => unidadesSel().filter((u) => u.j === YO && UNID[u.tipo].cat === 'inf' && u.orden === 'nada' && !(u.cava > 0) && !W.enTrinchera(m, u));
    function atrincherar() { // la misma tecla: quien está en una trinchera, sale; quien no, cava la suya
      const fuera = enPuesto().map((u) => u.id); if (fuera.length) { W.orden(m, { t: 'salir', j: YO, ids: fuera }); son.orden(); return; }
      const ids = paraCavar().map((u) => u.id); if (ids.length) { W.orden(m, { t: 'trinchera', j: YO, ids }); son.colocar(); } }
    $('trinchera').addEventListener('click', atrincherar);
    // Guardar y cargar: la partida entera va al almacenamiento del navegador (una sola, la última).
    function guardar() {
      try {
        const txt = W.guardar(m, { ia, hist, cam, op: { semilla, N: op.N, inicio: op.inicio, ia: op.ia, estilo: op.estilo, red: op.red, consulta: op.consulta } });
        localStorage.setItem('rts.guardado', txt);
        aviso('Partida guardada (' + Math.round(txt.length / 1024) + ' KB). Se continúa desde el menú inicial.');
      } catch (e) { aviso('No se pudo guardar: ' + (e && e.name === 'QuotaExceededError' ? 'no cabe en el almacenamiento del navegador' : 'el navegador no lo permite')); }
    }
    $('guardar').addEventListener('click', guardar);
    $('recargar').addEventListener('click', () => { let hay = false; try { hay = !!localStorage.getItem('rts.guardado'); } catch (e) { /* nada */ } if (!hay) { aviso('No hay ninguna partida guardada'); return; } location.href = location.pathname + '?cargar=1'; });
    // Historial para el resumen final: lo cosechado, el valor del ejército y las bajas de cada bando.
    function muestra() {
      const ej = [0, 0];
      for (const e of m.ents) if (!e.edif && UNID[e.tipo].arma) ej[e.j] += UNID[e.tipo].costo;
      hist.push({ t: m.t, c: [m.jug[0].cosechado, m.jug[1].cosechado], e: ej, b: [m.jug[0].bajas, m.jug[1].bajas] });
      if (hist.length > 400) hist.splice(0, hist.length - 400);
    }
    function resumen() {
      muestra();
      const cv = $('finGraf'), g = cv.getContext('2d'), Wd = cv.width, Hd = cv.height, n = hist.length;
      g.clearRect(0, 0, Wd, Hd); g.font = '11px "Fira Code", monospace';
      const series = [['minerales cosechados', 'c'], ['valor del ejército', 'e'], ['bajas', 'b']], ancho = Wd / 3;
      series.forEach(([titulo, k], s) => {
        const x0 = s * ancho + 10, w = ancho - 20, y0 = 22, h = Hd - 44;
        let max = 1; for (const q of hist) max = Math.max(max, q[k][0], q[k][1]);
        g.fillStyle = P.tinta; g.fillText(titulo, x0, 12);
        g.strokeStyle = P.suave || '#999'; g.lineWidth = 1; g.strokeRect(x0 + 0.5, y0 + 0.5, w, h);
        for (const j of [1, 0]) { // el rival debajo, tú encima
          g.strokeStyle = j === YO ? P.yo : P.rival; g.lineWidth = 2; g.beginPath();
          hist.forEach((q, i) => { const x = x0 + (n > 1 ? (i / (n - 1)) * w : 0), y = y0 + h - (q[k][j] / max) * h; if (i) g.lineTo(x, y); else g.moveTo(x, y); });
          g.stroke();
        }
        g.fillStyle = P.tinta; g.fillText(String(Math.round(max)), x0 + 3, y0 + 12);
        g.fillStyle = P.yo; g.fillText('tú ' + Math.round(hist[n - 1][k][YO]), x0, Hd - 6); g.fillStyle = P.rival; g.fillText('rival ' + Math.round(hist[n - 1][k][1 - YO]), x0 + w / 2, Hd - 6);
      });
    }
    // Panel ADMIN: cada trampa se prende y se apaga por separado, como en un trainer.
    $('admin').addEventListener('click', (ev) => {
      const b = ev.target.closest('button'); if (!b) return;
      const c = b.dataset.t;
      if (c === 'cerrar') $('admin').hidden = true;
      else if (c === 'ia') iaQuieta = !iaQuieta;
      else if (c === 'vel') W.orden(m, { t: 'trampa', j: YO, clave: 'vel', valor: +b.dataset.v });
      else if (c === 'nivel3' || c === 'mejoras') { W.orden(m, { t: 'trampa', j: YO, clave: c, valor: true }); aviso(c === 'nivel3' ? 'Nivel 3 alcanzado' : 'Todas las mejoras investigadas'); }
      else if (c === 'recursos') W.orden(m, { t: 'trampa', j: YO, clave: c, valor: !J.dios });
      else W.orden(m, { t: 'trampa', j: YO, clave: c, valor: !J.tr[c] });
    });
    function actualizarAdmin() {
      if ($('admin').hidden) return;
      for (const b of $('admin').querySelectorAll('button[data-t]')) {
        const c = b.dataset.t;
        const on = c === 'recursos' ? J.dios : c === 'ia' ? iaQuieta : c === 'vel' ? J.tr.vel === +b.dataset.v : c === 'nivel3' ? J.nivel >= 3 : c === 'mejoras' ? Object.keys(W.TEC).every((q) => W.TEC[q].sube || J.mejoras[q]) : !!J.tr[c];
        if (b.classList.contains('on') !== on) b.classList.toggle('on', on);
      }
    }
    const conCarga = () => unidadesSel().filter((u) => UNID[u.tipo].plazas && u.pasajeros.length);
    function descargar() { const us = conCarga(); if (us.length) { W.orden(m, { t: 'descargar', j: YO, ids: us.map((u) => u.id) }); son.orden(); } }
    $('descargar').addEventListener('click', descargar);
    let conectaDesde = 0, conectaN = 0; // conectar: el último edificio marcado y cuántos tramos van
    function conectar() { if (unidadesSel().some((u) => UNID[u.tipo].tiende)) { modo = 'conectar'; conectaDesde = 0; conectaN = 0; aviso('Conectar: toca el edificio de partida y luego los que quieras unir · Esc termina'); } }
    $('conectar').addEventListener('click', conectar);
    function trazar() { if (unidadesSel().some((u) => UNID[u.tipo].traza)) { modo = 'trazar'; trazaDesde = null; if (tactil) aviso('Arrastra hasta donde debe llegar el camino y suelta'); } }
    $('trazar').addEventListener('click', trazar);
    const paraDesplegar = () => unidadesSel().filter((u) => UNID[u.tipo].despliega);
    function desplegar() {
      const us = paraDesplegar(); if (!us.length) return;
      const ok = us.filter((u) => W.puedeDesplegar(m, u));
      if (!ok.length) { aviso(us.some((u) => u.orden !== 'nada') ? 'El patio móvil tiene que estar detenido' : 'Aquí no cabe un patio: hacen falta 3×3 celdas de llano libre'); return; }
      W.orden(m, { t: 'desplegar', j: YO, ids: ok.map((u) => u.id) });
    }
    $('desplegar').addEventListener('click', desplegar);
    if (!cargado) W.orden(m, { t: 'retiro', j: YO, on: true }); // por defecto, las unidades propias muy dañadas se retiran solas a reparar
    const paraRetiro = () => unidadesSel().filter((u) => !UNID[u.tipo].aire && u.tipo !== 'cosechadora');
    $('retiro').addEventListener('click', () => { const us = paraRetiro(); if (us.length) W.orden(m, { t: 'retiro', j: YO, ids: us.map((u) => u.id), on: !us.every((u) => u.retira) }); });
    // Segundo clic derecho tras ordenar mover: fija hacia dónde queda mirando la unidad (o el frente de la formación).
    let giroPend = null, giroCerca = false;
    const ultClic = { id: 0, t: 0 };
    let trazaDesde = null; // último punto del camino que se está marcando (para encadenar tramos)
    const mismaSel = (ids) => { const a = unidadesSel(); return a.length === ids.length && a.every((u) => ids.includes(u.id)); };
    function flecha(x1, y1, x2, y2, color) {
      const a = Math.atan2(y2 - y1, x2 - x1), k = 9;
      ctx.strokeStyle = color; ctx.lineWidth = 1.6; ctx.beginPath();
      ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
      ctx.moveTo(x2 - Math.cos(a - 0.45) * k, y2 - Math.sin(a - 0.45) * k); ctx.lineTo(x2, y2); ctx.lineTo(x2 - Math.cos(a + 0.45) * k, y2 - Math.sin(a + 0.45) * k);
      ctx.stroke();
    }
    // Leyenda de abajo a la izquierda: solo lo que puede hacer lo seleccionado, y lo que el terreno le aporta.
    function contexto(vivos) {
      const us = vivos.filter((v) => !v.edif && v.j === YO), eds = vivos.filter((v) => v.edif && v.j === YO), L = [];
      const k = (t) => '<kbd>' + t + '</kbd>';
      if (us.length) {
        const armadas = us.some((u) => UNID[u.tipo].arma);
        const soloAire = us.every((u) => UNID[u.tipo].aire);
        if (us.some((u) => UNID[u.tipo].traza)) L.push('<b>excavadora: ' + k('K') + ' trazar camino hasta un punto (abre el bosque; por camino los vehículos corren más)</b>');
        if (us.some((u) => UNID[u.tipo].plazas)) L.push('<b>transporte: la infantería sube con clic derecho sobre él · ' + k('U') + ' descargar</b>');
        if (us.some((u) => UNID[u.tipo].mando)) L.push('<b>mando: los tuyos en su radio ven en redondo y giran más rápido; gasta información</b>');
        if (us.some((u) => UNID[u.tipo].despliega)) L.push('<b>patio móvil: ' + k('D') + ' lo despliega aquí como patio nuevo (no se repliega)</b>');
        if (us.some((u) => UNID[u.tipo].hackea)) L.push('<b>hacker: clic derecho en un vehículo o edificio enemigo lo apaga unos segundos · ' + W.ECON.hackInfo + ' de información</b>');
        if (us.some((u) => UNID[u.tipo].monta)) L.push('<b>gatling: quieta se monta sola (3 s) y entonces dispara; para moverse desmonta</b>');
        if (us.some((u) => UNID[u.tipo].tiende)) L.push('<b>ingeniero civil: ' + k('J') + ' conectar edificios con una línea de servicio (energía y red)</b>');
        if (us.some((u) => UNID[u.tipo].cura)) L.push('<b>médico: cura solo a la infantería herida que tenga cerca</b>');
        if (us.some((u) => UNID[u.tipo].repara)) L.push('<b>ingeniero: repara solo los vehículos y edificios cercanos</b>');
        if (soloAire) L.push('clic derecho: ir y volver, o atacar · ' + k('S') + ' volver ya');
        else L.push('clic derecho: mover' + (armadas ? ' o atacar' : '') + ' · otro clic cerca: orientar');
        if (us.some((u) => u.tipo === 'cosechadora')) L.push('clic derecho en una veta: cosechar');
        if (!soloAire) {
          L.push((armadas ? k('A') + ' atacar al avanzar · ' : '') + k('R') + ' patrulla · ' + k('E') + ' explorar');
          L.push(k('S') + ' detener · ' + k('G') + ' guardia · ' + k('Mayús') + ' encadenar');
        }
        if (us.length > 1) L.push(k('F') + ' formación: ' + forma);
        if (paraCavar().length) L.push(k('Z') + ' atrincherarse');
        const n = {}; for (const u of us) { const ef = efectos(u); if (ef) n[ef] = (n[ef] || 0) + 1; }
        for (const ef in n) L.push('<b>' + (us.length > 1 ? n[ef] + ' en ' : 'en ') + ef + '</b>');
      }
      if (us.some((u) => UNID[u.tipo].aire)) {
        L.push('<b>aviones: al acabar la orden vuelven a su aeródromo</b>');
        L.push(k('R') + ' patrulla aérea: da vueltas sobre el punto; con ' + k('Mayús') + ', más puntos');
        L.push('repostan solos y retoman la patrulla · círculo: radio de vuelo');
      }
      if (eds.some((e) => W.PRODUCE[e.tipo]) && !us.length) L.push('barra: encargar · clic en la cola: cancelar' + (eds.length > 1 ? ' · el encargo va a la cola más corta' : ''));
      if (eds.some((e) => e.tipo === 'cuartel' || e.tipo === 'fabrica') && !us.length) L.push('clic derecho: punto de reunión');
      if (eds.some((e) => e.tipo === 'aerodromo') && !us.length) L.push('clic derecho: punto que patrullarán los aviones nuevos · ' + W.ECON.cupoAviones + ' aviones por aeródromo');
      if (vendibles().length) L.push(k('Supr') + ' demoler y recuperar la mitad');
      if (L.length) L.push(k('Mayús+1…9') + ' guardar grupo · ' + k('Esc') + ' soltar');
      return L.map((t) => '<div>' + t + '</div>').join('');
    }
    let ctxHtml = '';

    // ---------- grupos numerados ----------
    const ultimoGrupo = { n: '', t: 0 };
    let firmaGrupos = '';
    function llamarGrupo(n, ir) {
      if (!grupos[n]) return;
      sel.clear();
      let sx = 0, sy = 0, k = 0;
      for (const id of grupos[n]) {
        const e = m.porId.get(id);
        if (!e) continue;
        sel.add(id); sx += e.edif ? e.cx : e.x; sy += e.edif ? e.cy : e.y; k++;
      }
      if (ir && k) { cam.x = sx / k; cam.y = sy / k; limitarCam(); }
    }
    function listarGrupos() {
      const filas = [];
      for (const n of Object.keys(grupos).sort()) {
        grupos[n] = grupos[n].filter((id) => m.porId.has(id)); // los caídos salen del grupo
        if (!grupos[n].length) { delete grupos[n]; continue; }
        const cuenta = {};
        for (const id of grupos[n]) { const e = m.porId.get(id); cuenta[e.tipo] = (cuenta[e.tipo] || 0) + 1; }
        const txt = Object.keys(cuenta).map((t) => cuenta[t] + ' ' + (EDIF[t] || UNID[t]).nombre.toLowerCase().slice(0, 3)).join(' · ');
        const activo = grupos[n].length === sel.size && grupos[n].every((id) => sel.has(id));
        filas.push(n + '|' + txt + '|' + (activo ? 1 : 0));
      }
      const firma = filas.join(';');
      if (firma === firmaGrupos) return;
      firmaGrupos = firma;
      const cont = $('grupos');
      cont.textContent = '';
      for (const f of filas) {
        const [n, txt, activo] = f.split('|'), b = document.createElement('button');
        b.type = 'button'; b.className = 'grupo' + (activo === '1' ? ' on' : ''); b.dataset.g = n;
        b.innerHTML = '<b></b><span></span>'; b.firstChild.textContent = n; b.lastChild.textContent = txt;
        b.title = 'Clic: seleccionar · doble clic: ir';
        cont.appendChild(b);
      }
      $('secGrupos').hidden = !filas.length;
    }
    $('grupos').addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-g]');
      if (b) llamarGrupo(b.dataset.g, ev.detail >= 2);
    });

    // ---------- barra lateral ----------
    // La barra muestra lo del edificio seleccionado: el patio, los edificios; cuartel, fábrica y aeródromo, sus unidades
    // y su cola; y cada edificio, las mejoras que se investigan en él.
    const LUGAR = { inf: 'cuartel', veh: 'fabrica', aire: 'aerodromo' };
    const edificiosSel = (tipo) => { const out = []; for (const id of sel) { const e = m.porId.get(id); if (e && e.edif && e.j === YO && (!tipo || e.tipo === tipo)) out.push(e); } return out; };
    let firmaCola = '';
    $('cola').addEventListener('click', (ev) => { // clic en un puesto de la cola: lo cancela
      const c = ev.target.closest('.chip');
      if (c) W.orden(m, { t: 'cancelarUnidad', j: YO, id: +c.dataset.id, i: +c.dataset.i });
    });
    $('bucle').addEventListener('click', () => {
      const prod = edificiosSel().filter((e) => W.PRODUCE[e.tipo]);
      if (prod.length) W.orden(m, { t: 'bucle', j: YO, ids: prod.map((e) => e.id), on: !prod.every((e) => e.bucle) });
    });
    function actualizarCola(eds) {
      const todos = eds.filter((e) => W.PRODUCE[e.tipo]), prod = todos.slice(0, 4);
      $('secCola').hidden = !prod.length;
      if (!prod.length) { firmaCola = ''; return; }
      const rep = prod.every((e) => e.bucle), tb = 'repetir: ' + (rep ? 'sí' : prod.some((e) => e.bucle) ? 'algunos' : 'no');
      if ($('bucle').textContent !== tb) { $('bucle').textContent = tb; $('bucle').classList.toggle('on', rep); }
      const firma = todos.length + '#' + prod.map((e) => e.id + ':' + e.cola.join(',') + e.pago.map((p) => (p ? 1 : 0)).join('') + (e.sinAgua ? '!' : '') + (e.sinFondos ? '$' : '')).join('|');
      if (firma !== firmaCola) {
        firmaCola = firma;
        const num = {};
        $('cola').innerHTML = prod.map((e) => {
          num[e.tipo] = (num[e.tipo] || 0) + 1;
          const estado = e.cola.length && e.sinAgua ? '<span class="mal">falta agua</span>' : e.cola.length && e.sinFondos ? '<span class="mal">sin recursos</span>' : e.tipo === 'aerodromo' ? '<span>aviones ' + m.ents.filter((u) => !u.edif && u.casa === e.id).length + '/' + W.ECON.cupoAviones + '</span>' : '';
          const quien = '<span class="quien"><span>' + EDIF[e.tipo].nombre + (todos.length > 1 ? ' ' + num[e.tipo] : '') + '</span>' + estado + '</span>';
          const chips = e.cola.length ? e.cola.slice(0, 5).map((t, i) => '<button type="button" class="chip' + (i === 0 && (e.sinAgua || e.sinFondos) ? ' espera' : !e.pago[i] ? ' debe' : '') + '" data-id="' + e.id + '" data-i="' + i + '" title="' + UNID[t].nombre + ' · ' + (e.pago[i] ? 'clic para cancelar' : 'repetido: se pagará al empezarlo; clic para quitarlo') + '"><i class="ico i-' + t + '"></i></button>').join('') + (e.cola.length > 5 ? '<span class="mas">+' + (e.cola.length - 5) + '</span>' : '') : '<span class="tenue">sin encargos</span>';
          return '<div class="cola-fila" data-id="' + e.id + '">' + quien + chips + '</div>';
        }).join('') + (todos.length > prod.length ? '<div class="tenue">y ' + (todos.length - prod.length) + ' más</div>' : '');
      }
      for (const fila of $('cola').children) { // el primero de cada cola lleva el avance
        if (!fila.dataset.id) continue;
        const e = m.porId.get(+fila.dataset.id), c = fila.querySelector('.chip');
        if (e && c && e.cola.length) c.style.setProperty('--p', ((e.prog / UNID[e.cola[0]].tiempo) * 100).toFixed(1) + '%');
      }
    }
    // Teclas de edificio: seleccionan todos los de ese tipo (el encargo irá a la cola más corta); dos veces, llevan la cámara.
    const ultimoEdif = { tipo: '', t: 0 };
    function elegirEdificios(tipo) {
      const eds = m.ents.filter((e) => e.edif && e.j === YO && e.tipo === tipo);
      if (!eds.length) { aviso('No tienes ' + EDIF[tipo].nombre.toLowerCase()); return; }
      const ahora = performance.now(), ir = ultimoEdif.tipo === tipo && ahora - ultimoEdif.t < 400;
      ultimoEdif.tipo = tipo; ultimoEdif.t = ahora;
      sel.clear(); modo = null;
      for (const e of eds) sel.add(e.id);
      if (ir) { cam.x = eds[0].cx; cam.y = eds[0].cy; limitarCam(); }
    }
    // ---------- misilera: fabricar y lanzar ----------
    const MIS = W.MISILES, misilera = () => edificiosSel('misilera')[0] || null;
    let lanzaTipo = '';
    const casMis = {}, btnLanzar = {};
    for (const tipo in MIS) {
      const d = MIS[tipo], b = document.createElement('button');
      b.className = 'cas txt'; b.type = 'button';
      b.innerHTML = '<span class="n"></span><span class="c"></span><b class="k"></b><span class="x" title="Cancelar uno">×</span>';
      b.querySelector('.n').textContent = d.nombre;
      b.title = d.nombre + ' · ' + precio(d) + '. ' + d.que + ' Pega ' + d.dano + ' en un radio de ' + d.area + ' celdas.';
      b.addEventListener('click', () => { const e = misilera(); if (e) { W.orden(m, { t: 'misil', j: YO, id: e.id, tipo }); son.activar(); } });
      const cancelar = (ev) => { ev.preventDefault(); ev.stopPropagation(); const e = misilera(); if (e) W.orden(m, { t: 'cancelarMisil', j: YO, id: e.id, tipo }); };
      b.addEventListener('contextmenu', cancelar); b.querySelector('.x').addEventListener('click', cancelar);
      $('bMis').appendChild(b); casMis[tipo] = { b, c: b.querySelector('.c'), k: b.querySelector('.k') };
      const l = document.createElement('button'); l.className = 'btn'; l.type = 'button'; l.innerHTML = '<span></span><span class="c"></span>'; l.firstChild.textContent = 'Lanzar ' + d.nombre;
      l.addEventListener('click', () => { const e = misilera(); if (e && e.silo && e.silo[tipo] > 0) { modo = 'lanzar'; lanzaTipo = tipo; aviso('Elige el blanco del ' + d.nombre + (d.alcance ? ' dentro del círculo' : '') + ' · Esc cancela'); } });
      $('bLanzar').appendChild(l); btnLanzar[tipo] = { b: l, c: l.lastChild };
    }
    function actualizarMisiles() {
      const e = misilera(); if (!e) return;
      let total = 0;
      for (const tipo in MIS) {
        const d = MIS[tipo], o = casMis[tipo], enCola = (e.fabMis || []).filter((t) => t === tipo).length, hay = (e.silo && e.silo[tipo]) || 0, primero = e.fabMis && e.fabMis[0] === tipo;
        total += enCola + hay;
        const sinNivel = J.nivel < d.nivel;
        let clase = 'cas txt' + (enCola ? ' hay' : ''); if (sinNivel) clase += ' no'; else if (!W.puedePagar(J, d)) clase += ' caro';
        const txt = sinNivel ? 'nivel ' + d.nivel : primero ? Math.floor(((e.progMis || 0) / d.tiempo) * 100) + '%' : precioCorto(d), cuenta = enCola ? '+' + enCola : '';
        if (o.b.className !== clase) o.b.className = clase; if (o.c.textContent !== txt) o.c.textContent = txt; if (o.k.textContent !== cuenta) o.k.textContent = cuenta;
        o.c.classList.toggle('lg', txt.length > 11);
        o.b.style.setProperty('--p', (primero ? ((e.progMis || 0) / d.tiempo) * 100 : 0).toFixed(1) + '%');
        const l = btnLanzar[tipo], cl = 'btn' + (hay ? (modo === 'lanzar' && lanzaTipo === tipo ? ' listo' : '') : ' no'), tl = hay ? '× ' + hay : 'ninguno';
        if (l.b.className !== cl) l.b.className = cl; if (l.c.textContent !== tl) l.c.textContent = tl;
      }
      const ti = total + ' / ' + W.ECON.misilesMax + ' misiles entre guardados y encargados' + (e.sinLuz ? ' · sin energía: no puede lanzar' : '');
      if ($('misInfo').textContent !== ti) $('misInfo').textContent = ti;
    }
    let pestQuiero = '', pestFirma = '';
    $('pest').addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) pestQuiero = b.dataset.p; });
    const botones = [];
    function boton(cont, tipo, d, esEdif) {
      const b = document.createElement('button');
      b.className = 'cas'; b.type = 'button';
      b.innerHTML = '<i class="ico i-' + tipo + '"></i><span class="n"></span><span class="c"></span><b class="k"></b><span class="x" title="Cancelar uno">×</span>';
      b.querySelector('.n').textContent = d.nombre;
      b.title = d.nombre + ' · ' + precio(d) + '. Requiere: ' + d.req.map((r) => EDIF[r].nombre).join(', ')
        + (d.sobre ? '. Se coloca sobre un ' + (d.sobre === 'petroleo' ? 'yacimiento de petróleo' : 'campo de conocimiento') + ' explorado, en cualquier parte del mapa.' : '')
        + (d.juntoA ? '. Se coloca junto al agua, en cualquier parte explorada.' : '')
        + (d.agua && d.juntoA ? ' Da ' + d.agua + ' de agua.' : '') + (d.agua && !esEdif ? '. Consume ' + d.agua + ' de agua.' : '');
      b.addEventListener('click', () => {
        son.activar();
        if (esEdif) {
          if (obraLista(tipo)) { modo = 'colocar'; tipoColocar = tipo; if (tactil) aviso('Arrastra sobre el mapa y suelta para colocar'); }
          else W.orden(m, { t: 'construir', j: YO, tipo, ids: edificiosSel('patio').map((e) => e.id) });
        } else W.orden(m, { t: 'entrenar', j: YO, tipo, ids: edificiosSel(W.lugarDe(d)).map((e) => e.id) });
      });
      const cancelar = (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        if (esEdif) { W.orden(m, { t: 'cancelarEdif', j: YO, tipo, ids: edificiosSel('patio').map((e) => e.id) }); if (tipoColocar === tipo) modo = null; }
        else W.orden(m, { t: 'cancelarUnidad', j: YO, tipo, ids: edificiosSel(W.lugarDe(d)).map((e) => e.id) });
      };
      b.addEventListener('contextmenu', cancelar);
      b.querySelector('.x').addEventListener('click', cancelar);
      cont.appendChild(b);
      botones.push({ b, tipo, d, esEdif, c: b.querySelector('.c'), k: b.querySelector('.k') });
    }
    for (const tipo in EDIF) if (tipo !== 'patio' && !EDIF[tipo].infra) boton($('bEdif'), tipo, EDIF[tipo], true);
    for (const tipo in UNID) boton($('bUnid'), tipo, UNID[tipo], false);

    function actualizarBarra() {
      { const f = m.t % W.ECON.dia, noche = W.esNoche(m), falta = Math.ceil(((noche ? W.ECON.dia : W.ECON.diaLuz) - f) / 20), t = (noche ? 'noche · amanece en ' : 'día · anochece en ') + Math.floor(falta / 60) + ':' + String(falta % 60).padStart(2, '0'); if ($('rHora').textContent !== t) $('rHora').textContent = t; }
      const num = (v) => (J.dios ? '∞' : String(Math.floor(v)));
      $('rMin').textContent = num(J.minerales); $('rPet').textContent = num(J.petroleo); $('rRar').textContent = num(J.raros); $('rInf').textContent = num(J.info);
      { const otras = J.tr.requisitos || J.tr.libre || J.tr.vel > 1 || J.tr.mapa || J.tr.invulnerable || iaQuieta, t = otras ? 'ADMIN' : 'GOD'; $('dios').hidden = !J.dios && !otras; if ($('dios').textContent !== t) $('dios').textContent = t; } actualizarAdmin(); $('sinColmena').hidden = J.colmena;
      const e = $('rEne'); { let sl = 0; for (const b of m.ents) if (b.edif && b.j === YO && b.sinLuz) sl++; e.textContent = J.uso + ' / ' + J.prod + (sl ? ' · ' + sl + ' sin luz' : ''); e.className = J.uso > J.prod || sl ? 'mal' : ''; }
      const ag = $('rAgu'); ag.textContent = J.aguaUso + ' / ' + (J.dios ? '∞' : J.aguaProd); ag.className = !J.dios && J.aguaUso >= J.aguaProd ? 'mal' : '';
      const eds = edificiosSel(), tipos = new Set(eds.map((e) => e.tipo)), patiosSel = new Set(eds.filter((e) => e.tipo === 'patio').map((e) => e.id));
      tiposSel = tipos;
      let hayUnid = false;
      $('vacio').hidden = eds.length > 0 || sel.size > 0;
      actualizarCola(eds);
      for (const o of botones) {
        const visible = o.esEdif ? tipos.has('patio') : tipos.has(W.lugarDe(o.d));
        if (o.b.hidden === visible) o.b.hidden = !visible;
        if (!visible) continue;
        if (!o.esEdif) hayUnid = true;
        const d = o.d, sinNivel = (d.nivel || 1) > J.nivel, req = W.tieneReq(m, YO, d.req) && !sinNivel;
        let clase = 'cas', txt = sinNivel ? 'nivel ' + d.nivel : precioCorto(d), p = 0, cuenta = '';
        const caro = !W.puedePagar(J, d);
        if (o.esEdif) {
          let n = 0, listas = 0, activa = null; // cada tipo tiene su cola: avanza la primera sin terminar
          for (const a of J.obras) if (a.tipo === o.tipo && (a.listo || patiosSel.has(a.patio))) { n++; if (a.listo) listas++; else if (!activa) activa = a; } // lo de los patios elegidos, y lo ya listo de cualquiera
          if (n > 1) cuenta = '×' + n;
          if (n) clase += ' hay';
          if (listas) { clase += ' listo'; txt = 'colocar' + (activa ? '·' + Math.floor((activa.prog / d.tiempo) * 100) + '%' : ''); }
          else if (activa) { p = activa.prog / d.tiempo; txt = Math.floor(p * 100) + '%'; }
          else if (!req) clase += ' no';
          else if (caro) clase += ' caro';
        } else {
          let n = 0, enCurso = null; // lo encargado de este tipo en los edificios seleccionados
          for (const e of eds) if (e.tipo === W.lugarDe(d)) { for (const t of e.cola) if (t === o.tipo) n++; if (!enCurso && e.cola[0] === o.tipo) enCurso = e; }
          const q = { sinAgua: !!enCurso && enCurso.sinAgua };
          if (n) { cuenta = '×' + n; clase += ' hay'; }
          if (enCurso) { p = enCurso.prog / d.tiempo; if (q.sinAgua) txt = 'falta agua'; }
          if (d.aire && J.cuenta.aerodromo) { const c = W.cupoAire(m, YO); if (c.hay >= c.cupo) { txt = 'cupo ' + c.hay + '/' + c.cupo; clase += ' caro'; } }
          if (!req) clase += ' no'; else if (caro || (n && q.sinAgua)) clase += ' caro';
        }
        if (o.b.className !== clase) o.b.className = clase;
        if (o.c.textContent !== txt) o.c.textContent = txt;
        if (o.k.textContent !== cuenta) o.k.textContent = cuenta;
        if (o.c.classList.contains('lg') !== txt.length > 11) o.c.classList.toggle('lg', txt.length > 11);
        o.b.style.setProperty('--p', (p * 100).toFixed(1) + '%');
      }
      listarGrupos(); actualizarTec(); actualizarTactil();
      { // pestañas: una sola rejilla a la vista, la que toca según lo seleccionado (o la que elija el jugador)
        const disp = { edif: tipos.has('patio'), unid: hayUnid, tec: hayTecG, intel: tipos.has('estacion'), mis: tipos.has('misilera') }, firma = [...tipos].sort().join(',');
        if (firma !== pestFirma) { pestFirma = firma; pestQuiero = ''; }
        const lista = Object.keys(disp).filter((k) => disp[k]), ver = disp[pestQuiero] ? pestQuiero : lista[0] || '';
        $('pest').hidden = lista.length < 2;
        for (const b of $('pest').children) { const k = b.dataset.p; if (b.hidden === disp[k]) b.hidden = !disp[k]; b.classList.toggle('on', k === ver); }
        $('secEdif').hidden = ver !== 'edif'; $('secUnid').hidden = ver !== 'unid'; $('secTec').hidden = ver !== 'tec'; $('secIntel').hidden = ver !== 'intel'; $('secMis').hidden = ver !== 'mis'; if (ver === 'mis') actualizarMisiles();
      }
      let enCurso = 0; // en el patio más cargado de los elegidos
      for (const id of patiosSel) enCurso = Math.max(enCurso, new Set(J.obras.filter((a) => !a.listo && a.patio === id).map((a) => a.tipo)).size);
      const reparto = (enCurso > 1 ? enCurso + ' tipos a la vez en un patio: cada uno a 1/' + enCurso + ' de velocidad' : '') + ((J.cuenta.patio || 0) > 1 ? (enCurso > 1 ? ' · ' : '') + J.cuenta.patio + ' patios: cada uno lleva sus obras' : '');
      if ($('obras').textContent !== reparto) $('obras').textContent = reparto;
      let s = '';
      const vivos = [...sel].map((id) => m.porId.get(id)).filter(Boolean);
      if (vivos.length === 1) { const v = vivos[0]; s = (v.edif ? EDIF : UNID)[v.tipo].nombre + ' · ' + Math.ceil(v.vida) + ' / ' + v.vidaMax; }
      else if (vivos.length > 1) s = vivos.length + (vivos.every((v) => v.edif) ? ' edificios' : ' unidades');
      if ($('sel').textContent !== s) $('sel').textContent = s;
      const tropas = vivos.filter((v) => !v.edif).length;
      $('secFormas').hidden = tropas < 2;
      const dem = vendibles(), bv = $('vender');
      const dentroT = enPuesto().length, cav = dentroT ? 0 : paraCavar().length, bt = $('trinchera');
      bt.hidden = !cav && !dentroT;
      if (dentroT) { const t = 'Salir de la trinchera · ' + dentroT; if (bt.textContent !== t) bt.textContent = t; }
      $('desplegar').hidden = !paraDesplegar().length;
      { const hay = unidadesSel().some((u) => UNID[u.tipo].tiende), bc = $('conectar'); bc.hidden = !hay; bc.classList.toggle('listo', modo === 'conectar'); if (!hay && modo === 'conectar') modo = null; }
      { const hay = unidadesSel().some((u) => UNID[u.tipo].traza), bz = $('trazar'); bz.hidden = !hay; bz.classList.toggle('listo', modo === 'trazar'); }
      { const us = conCarga(), bd = $('descargar'); bd.hidden = !us.length; if (us.length) { const t = 'Descargar · ' + us.reduce((a, u) => a + u.pasajeros.length, 0) + ' dentro'; if (bd.textContent !== t) bd.textContent = t; } }
      { const us = paraRetiro(), br = $('retiro'); br.hidden = !us.length;
        if (us.length) { const t = 'Retirada automática: ' + (us.every((u) => u.retira) ? 'sí' : us.some((u) => u.retira) ? 'algunas' : 'no'); if (br.textContent !== t) br.textContent = t; } }
      if (cav) { const t = 'Atrincherarse · ' + cav + (cav === 1 ? ' soldado' : ' soldados'); if (bt.textContent !== t) bt.textContent = t; }
      const h = contexto(vivos);
      if (h !== ctxHtml) { ctxHtml = h; $('contexto').innerHTML = h; $('contexto').hidden = !h; }
      bv.hidden = !dem.length;
      if (dem.length) { const t = 'Demoler · +' + dem.reduce((a, e) => a + valorVenta(e), 0) + ' minerales'; if (bv.textContent !== t) bv.textContent = t; }
    }

    // ---------- entrada ----------
    function posRaton(ev) { const r = lienzo.getBoundingClientRect(); raton.x = ev.clientX - r.left; raton.y = ev.clientY - r.top; }
    const marca = (x, y, color) => marcas.push({ x, y, color, t0: performance.now() });

    lienzo.addEventListener('contextmenu', (ev) => ev.preventDefault());
    lienzo.addEventListener('mouseenter', () => { raton.dentro = true; });
    lienzo.addEventListener('mouseleave', () => { raton.dentro = false; });
    lienzo.addEventListener('mousedown', (ev) => {
      son.activar();
      posRaton(ev);
      const wx = aMundoX(raton.x), wy = aMundoY(raton.y);
      if (ev.button === 1) { raton.medio = true; ev.preventDefault(); return; }
      if (ev.button === 0) {
        if (modo === 'colocar') {
          const p = esquinaColocar(tipoColocar);
          if (W.puedeColocar(m, YO, tipoColocar, p.x, p.y)) { W.orden(m, { t: 'colocar', j: YO, tipo: tipoColocar, x: p.x, y: p.y }); modo = null; }
          return;
        }
        if (modo === 'barrido') { W.orden(m, { t: 'intel', j: YO, clave: 'barrido', x: wx, y: wy }); son.orden(); modo = null; return; }
        if (modo === 'lanzar') { // blanco del misil
          const e = misilera(), d = MIS[lanzaTipo];
          if (!e || !d) { modo = null; return; }
          if (wx < 0 || wy < 0 || wx >= N || wy >= N || !m.niebla[YO][Math.floor(wy) * N + Math.floor(wx)]) { aviso('Solo se puede apuntar a terreno explorado'); return; }
          if (!W.alcanceMisil(m, e, lanzaTipo, wx, wy)) { aviso('Fuera del alcance del ' + d.nombre); return; }
          W.orden(m, { t: 'lanzar', j: YO, id: e.id, tipo: lanzaTipo, x: wx, y: wy }); marca(wx, wy, P.mal); modo = null;
          return;
        }
        if (modo === 'conectar') { // cada clic en un edificio propio lo une con el anterior
          const e = entEn(wx, wy), ids = unidadesSel().filter((u) => UNID[u.tipo].tiende).map((u) => u.id);
          if (!e || !e.edif || e.infra || e.j !== YO) { aviso('Toca un edificio tuyo'); return; }
          if (conectaDesde && conectaDesde !== e.id && ids.length) { W.orden(m, { t: 'conectar', j: YO, ids, edifs: [conectaDesde, e.id], enc: conectaN > 0 }); conectaN++; son.orden(); }
          conectaDesde = e.id; marca(e.cx, e.cy, P.bien);
          return;
        }
        if (modo === 'trazar') { // destino del camino; con Mayús se siguen añadiendo tramos
          const ids = unidadesSel().filter((u) => UNID[u.tipo].traza).map((u) => u.id), t = m.mapa.terreno[Math.floor(wy) * N + Math.floor(wx)];
          if (t === 1 || wx < 0 || wy < 0 || wx >= N || wy >= N) { aviso('Ahí no se puede llevar un camino'); return; }
          if (ids.length) { W.orden(m, { t: 'trazar', j: YO, ids, x: wx, y: wy, enc: ev.shiftKey }); trazaDesde = { x: wx, y: wy }; marca(wx, wy, P.bien); son.orden(); }
          if (!ev.shiftKey) { modo = null; trazaDesde = null; }
          return;
        }
        if (modo === 'amover' || modo === 'patrulla') {
          const ids = unidadesSel().map((u) => u.id);
          if (ids.length) {
            W.orden(m, { t: modo, j: YO, ids, x: wx, y: wy, enc: ev.shiftKey, forma }); marca(wx, wy, P.mal); son.orden();
            if (modo === 'amover' && !ev.shiftKey) giroPend = { tipo: 'amover', ids, x: wx, y: wy, forma, t0: performance.now() };
          }
          if (!(modo === 'patrulla' && ev.shiftKey)) modo = null; // con Mayús se siguen añadiendo puntos de patrulla
          return;
        }
        raton.izq = true; raton.x0 = raton.x; raton.y0 = raton.y;
        return;
      }
      if (ev.button === 2) { raton.der = true; raton.arrastre = false; raton.xd = raton.x; raton.yd = raton.y; }
    });
    // Clic derecho sin mover = orden; clic derecho arrastrando = desplazar el mapa (como en Red Alert).
    // Con Mayús la orden se encadena detrás de las que ya tiene la unidad.
    // Segundo clic (con cualquier botón) cerca del destino recién ordenado: fija hacia dónde queda mirando el grupo.
    function orientar(wx, wy) {
      if (!giroPend || !mismaSel(giroPend.ids)) return false;
      const g = giroPend, d = Math.hypot(wx - g.x, wy - g.y), en = entEn(wx, wy);
      if (d <= 0.4 || d >= 9 || en) return false; // sobre una unidad o un edificio, el clic es para ellos
      const rumbo = Math.atan2(wy - g.y, wx - g.x);
      W.orden(m, { t: g.tipo, j: YO, ids: g.ids, x: g.x, y: g.y, forma: g.forma, rumbo });
      senales.push({ k: 'flecha', x: g.x, y: g.y, x2: g.x + Math.cos(rumbo) * 2.4, y2: g.y + Math.sin(rumbo) * 2.4, t0: performance.now(), dur: 1400 });
      giroPend = null; son.orden();
      return true;
    }
    function ordenar(wx, wy, enc) {
        if (modo) { modo = null; return; }
        if (wx < 0 || wy < 0 || wx >= N || wy >= N) return;
        if (!enc && orientar(wx, wy)) return;
        giroPend = null;
        const us = unidadesSel();
        if (!us.length) { // con un cuartel o una fábrica seleccionados: punto de reunión
          let puesto = false;
          for (const id of sel) { const e = m.porId.get(id); if (e && e.edif && W.PRODUCE[e.tipo]) { W.orden(m, { t: 'reunion', j: YO, id, x: wx, y: wy }); puesto = true; } }
          if (puesto) { marca(wx, wy, P.bien); son.orden(); }
          return;
        }
        const ids = us.map((u) => u.id), o = entEn(wx, wy), c = Math.floor(wy) * N + Math.floor(wx);
        if (o && o.j !== YO) {
          { const hk = us.filter((u) => UNID[u.tipo].hackea).map((u) => u.id); if (hk.length) { if (W.hackeable(us.find((u) => UNID[u.tipo].hackea), o)) { W.orden(m, { t: 'hackear', j: YO, ids: hk, obj: o.id }); marca(wx, wy, P.mal); son.orden(); } else aviso('El hacker solo puede con vehículos y edificios'); if (hk.length === us.length) return; } }
          if (!us.some((u) => UNID[u.tipo].arma && W.puedeAtacar(u, o))) aviso(UNID[o.tipo] && UNID[o.tipo].aire ? 'Estas unidades no alcanzan a los aviones' : 'Estas unidades no pueden atacar eso');
          W.orden(m, { t: 'atacar', j: YO, ids, obj: o.id, enc }); marca(wx, wy, P.mal); return;
        }
        if (o && o.j === YO && !o.edif && UNID[o.tipo].plazas && us.some((u) => UNID[u.tipo].cat === 'inf')) { // clic derecho sobre un transporte propio: la infantería sube
          const libres = UNID[o.tipo].plazas - o.pasajeros.length;
          if (libres <= 0) { aviso('El transporte está lleno'); return; }
          W.orden(m, { t: 'cargar', j: YO, ids: us.filter((u) => UNID[u.tipo].cat === 'inf').map((u) => u.id), en: o.id }); marca(wx, wy, P.bien); son.orden();
          return;
        }
        if (us.some((u) => { const b = UNID[u.tipo].aire && u.casa ? m.porId.get(u.casa) : null; return b && Math.hypot(wx - b.cx, wy - b.cy) > UNID[u.tipo].radioVuelo; })) aviso('Fuera del radio de vuelo: el avión llegará hasta el límite');
        if (m.trincheras.has(c) && us.some((u) => UNID[u.tipo].cat === 'inf')) { // clic derecho sobre una trinchera: la infantería la ocupa; el resto va al lado
          const q = m.trincheras.get(c), ajena = (q.dentro || []).some((id) => { const o = id ? m.porId.get(id) : null; return o && o.j !== YO; });
          if (ajena) aviso('La trinchera está ocupada por el enemigo');
          else {
            const infs = us.filter((u) => UNID[u.tipo].cat === 'inf').map((u) => u.id), resto = us.filter((u) => UNID[u.tipo].cat !== 'inf').map((u) => u.id);
            W.orden(m, { t: 'ocupar', j: YO, ids: infs, c }); if (resto.length) W.orden(m, { t: 'mover', j: YO, ids: resto, x: wx, y: wy, enc, forma });
            marca(wx, wy, P.bien); son.orden(); return;
          }
        }
        const cos = us.filter((u) => u.tipo === 'cosechadora').map((u) => u.id);
        if (cos.length && m.mapa.tipoMin[c] >= 1 && m.niebla[YO][c]) {
          W.orden(m, { t: 'cosechar', j: YO, ids: cos, x: wx, y: wy });
          const resto = us.filter((u) => u.tipo !== 'cosechadora').map((u) => u.id);
          if (resto.length) W.orden(m, { t: 'mover', j: YO, ids: resto, x: wx, y: wy, enc, forma });
        } else {
          W.orden(m, { t: 'mover', j: YO, ids, x: wx, y: wy, enc, forma });
          if (!enc && us.some((u) => !UNID[u.tipo].aire)) giroPend = { tipo: 'mover', ids, x: wx, y: wy, forma, t0: performance.now() }; // a un avión no se le orienta: vuelve a casa
        }
        marca(wx, wy, P.bien); son.orden();
    }
    window.addEventListener('mousemove', (ev) => {
      const ax = raton.x, ay = raton.y;
      posRaton(ev);
      if (raton.der && !raton.arrastre && Math.hypot(raton.x - raton.xd, raton.y - raton.yd) > 5) raton.arrastre = true;
      if (raton.medio || raton.arrastre) { cam.x -= (raton.x - ax) / cam.z; cam.y -= (raton.y - ay) / cam.z; limitarCam(); }
    });
    window.addEventListener('mouseup', (ev) => {
      if (ev.button === 1) { raton.medio = false; return; }
      if (ev.button === 2 && raton.der) {
        const fue = raton.arrastre;
        raton.der = false; raton.arrastre = false;
        if (!fue) ordenar(aMundoX(raton.x), aMundoY(raton.y), ev.shiftKey);
        return;
      }
      if (ev.button !== 0 || !raton.izq) return;
      raton.izq = false;
      const clic = Math.hypot(raton.x - raton.x0, raton.y - raton.y0) <= 5;
      if (clic && !ev.shiftKey && orientar(aMundoX(raton.x), aMundoY(raton.y))) return; // el clic izquierdo también orienta
      if (!ev.shiftKey) sel.clear();
      if (clic) {
        const e = entEn(aMundoX(raton.x), aMundoY(raton.y));
        if (e && e.j === YO) { if (ev.shiftKey && sel.has(e.id)) sel.delete(e.id); else sel.add(e.id); }
        const ahora = performance.now();
        if (e && e.j === YO && !e.edif && ultClic.id === e.id && ahora - ultClic.t < 380) { // doble clic: todas las de su tipo que estén en pantalla
          const c = lienzo.getBoundingClientRect(), ax = aMundoX(0), bx = aMundoX(c.width), ay = aMundoY(0), by = aMundoY(c.height);
          for (const u of m.ents) if (!u.edif && u.j === YO && u.tipo === e.tipo && u.x >= ax && u.x <= bx && u.y >= ay && u.y <= by) sel.add(u.id);
        }
        ultClic.id = e ? e.id : 0; ultClic.t = ahora;
        return;
      }
      const ax = aMundoX(Math.min(raton.x, raton.x0)), bx = aMundoX(Math.max(raton.x, raton.x0));
      const ay = aMundoY(Math.min(raton.y, raton.y0)), by = aMundoY(Math.max(raton.y, raton.y0));
      for (const e of m.ents) if (!e.edif && e.j === YO && e.x >= ax && e.x <= bx && e.y >= ay && e.y <= by) sel.add(e.id);
      // La caja prioriza tropa: suelta edificios y, si hay combatientes, también cosechadoras.
      const cosas = [...sel].map((id) => m.porId.get(id)).filter(Boolean);
      const hayTropa = cosas.some((e) => !e.edif && UNID[e.tipo].arma);
      for (const e of cosas) if ((e.edif && sel.size > 1) || (hayTropa && e.tipo === 'cosechadora')) sel.delete(e.id);
    });
    // Zoom que mantiene fijo el punto bajo el cursor.
    function zoom(factor) {
      const wx = aMundoX(raton.x), wy = aMundoY(raton.y);
      cam.z *= factor; limitarCam();
      cam.x = wx - (raton.x - cw / 2) / cam.z; cam.y = wy - (raton.y - ch / 2) / cam.z; limitarCam();
    }
    // Rueda de ratón: zoom. Trackpad: dos dedos desplazan y el pellizco hace zoom.
    // Un trackpad se reconoce porque también desliza en horizontal; la tecla M cambia el modo a mano.
    let deslizar = false;
    lienzo.addEventListener('wheel', (ev) => {
      ev.preventDefault(); posRaton(ev);
      const u = ev.deltaMode === 1 ? 16 : 1;
      if (ev.ctrlKey || ev.metaKey) { zoom(Math.exp(-Math.max(-30, Math.min(30, ev.deltaY * u)) * 0.01)); return; } // pellizco (Chrome, Firefox)
      if (ev.deltaX !== 0) deslizar = true;
      if (deslizar) { cam.x += (ev.deltaX * u) / cam.z; cam.y += (ev.deltaY * u) / cam.z; limitarCam(); }
      else zoom(Math.exp(-ev.deltaY * u * 0.0015));
    }, { passive: false });
    // Pellizco en Safari: usa sus propios eventos de gesto.
    let escalaGesto = 1;
    lienzo.addEventListener('gesturestart', (ev) => { ev.preventDefault(); escalaGesto = 1; });
    lienzo.addEventListener('gesturechange', (ev) => { ev.preventDefault(); if (ev.scale > 0) { zoom(ev.scale / escalaGesto); escalaGesto = ev.scale; } });
    lienzo.addEventListener('gestureend', (ev) => ev.preventDefault());

    // ---------- táctil (dedo o lápiz) ----------
    // Los toques se traducen a los mismos gestos de ratón, para que todo siga un solo camino:
    // toque sobre algo propio = clic (elegir); toque en el mapa con tropa elegida = clic derecho (ordenar);
    // arrastrar un dedo = caja de selección; dos dedos = desplazar y hacer zoom. En un modo (colocar, patrulla…),
    // arrastrar mueve el cursor y al soltar se confirma.
    let tactil = false, toque = null;
    function activarTactil() { if (tactil) return; tactil = true; document.body.classList.add('tactil'); $('tactil').hidden = false; }
    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) activarTactil();
    window.addEventListener('touchstart', activarTactil, { passive: true });
    const raton2 = (tipo, x, y, boton) => (tipo === 'mousedown' ? lienzo : window).dispatchEvent(new MouseEvent(tipo, { clientX: x, clientY: y, button: boton, bubbles: true }));
    const entreDedos = (ts) => ({ d: Math.hypot(ts[0].clientX - ts[1].clientX, ts[0].clientY - ts[1].clientY), x: (ts[0].clientX + ts[1].clientX) / 2, y: (ts[0].clientY + ts[1].clientY) / 2 });
    function tocar(x, y) {
      posRaton({ clientX: x, clientY: y });
      const wx = aMundoX(raton.x), wy = aMundoY(raton.y), e = entEn(wx, wy, 14 / cam.z);
      const hayTropa = unidadesSel().length > 0, hayFabrica = edificiosSel().some((b) => W.PRODUCE[b.tipo]);
      if (e && !e.edif) { const r = lienzo.getBoundingClientRect(); x = r.left + cw / 2 + (e.x - cam.x) * cam.z; y = r.top + ch / 2 + (e.y - cam.y) * cam.z; } // el toque se centra en la unidad
      const sube = e && e.j === YO && !e.edif && UNID[e.tipo].plazas && unidadesSel().some((u) => UNID[u.tipo].cat === 'inf'); // toque en un transporte con infantería elegida: suben
      const boton = sube ? 2 : e && e.j === YO ? 0 : hayTropa || (hayFabrica && !e) ? 2 : 0;
      raton2('mousedown', x, y, boton); raton2('mouseup', x, y, boton);
    }
    lienzo.addEventListener('touchstart', (ev) => {
      ev.preventDefault(); activarTactil(); son.activar();
      const ts = ev.touches;
      if (ts.length === 1) {
        toque = { x0: ts[0].clientX, y0: ts[0].clientY, x: ts[0].clientX, y: ts[0].clientY, caja: false, dos: false };
        raton.dentro = true; raton2('mousemove', toque.x, toque.y, 0);
      } else if (ts.length === 2) {
        if (toque && toque.caja) { raton.izq = false; } // la caja a medias se descarta
        toque = Object.assign({ dos: true }, entreDedos(ts));
      }
    }, { passive: false });
    lienzo.addEventListener('touchmove', (ev) => {
      ev.preventDefault();
      const ts = ev.touches;
      if (!toque) return;
      if (toque.dos) {
        if (ts.length < 2) return;
        const g = entreDedos(ts);
        cam.x -= (g.x - toque.x) / cam.z; cam.y -= (g.y - toque.y) / cam.z; limitarCam();
        posRaton({ clientX: g.x, clientY: g.y });
        if (toque.d > 0 && g.d > 0) zoom(g.d / toque.d);
        toque.d = g.d; toque.x = g.x; toque.y = g.y;
        return;
      }
      toque.x = ts[0].clientX; toque.y = ts[0].clientY;
      if (!modo && !toque.caja && Math.hypot(toque.x - toque.x0, toque.y - toque.y0) > 12) { toque.caja = true; raton2('mousedown', toque.x0, toque.y0, 0); }
      raton2('mousemove', toque.x, toque.y, 0);
    }, { passive: false });
    const finToque = (ev) => {
      ev.preventDefault();
      if (!toque) return;
      if (toque.dos) { if (ev.touches.length === 0) { toque = null; raton.dentro = false; } return; }
      const q = toque; toque = null;
      if (q.caja) raton2('mouseup', q.x, q.y, 0);
      else if (modo) { raton2('mousedown', q.x, q.y, 0); raton2('mouseup', q.x, q.y, 0); }
      else tocar(q.x, q.y);
      raton.dentro = false;
    };
    lienzo.addEventListener('touchend', finToque, { passive: false });
    lienzo.addEventListener('touchcancel', (ev) => { ev.preventDefault(); if (toque && toque.caja) raton.izq = false; toque = null; raton.dentro = false; }, { passive: false });
    // Botonera: cada botón hace lo mismo que su tecla.
    $('tactil').addEventListener('click', (ev) => {
      const b = ev.target.closest('button'); if (!b) return;
      const c = b.dataset.c;
      window.dispatchEvent(new KeyboardEvent('keydown', { code: c, key: c.startsWith('Key') ? c.slice(3).toLowerCase() : c === 'Space' ? ' ' : c }));
      window.dispatchEvent(new KeyboardEvent('keyup', { code: c }));
    });
    function actualizarTactil() {
      if (!tactil) return;
      const hay = unidadesSel().length > 0;
      for (const b of $('tactil').children) {
        if (b.dataset.u !== undefined && b.hidden === hay) b.hidden = !hay;
        if (b.dataset.c === 'KeyK') b.hidden = !unidadesSel().some((u) => UNID[u.tipo].traza);
        if (b.dataset.c === 'KeyJ') b.hidden = !unidadesSel().some((u) => UNID[u.tipo].tiende);
        const on = (b.dataset.c === 'KeyK' && modo === 'trazar') || (b.dataset.c === 'KeyA' && modo === 'amover') || (b.dataset.c === 'KeyR' && modo === 'patrulla') || (b.dataset.c === 'KeyP' && pausa);
        if (b.classList.contains('on') !== on) b.classList.toggle('on', on);
      }
    }

    let miniAbajo = false;
    function irMini(ev) { const r = mini.getBoundingClientRect(); cam.x = ((ev.clientX - r.left) / r.width) * N; cam.y = ((ev.clientY - r.top) / r.height) * N; limitarCam(); }
    mini.addEventListener('mousedown', (ev) => { miniAbajo = true; irMini(ev); });
    for (const tipo of ['touchstart', 'touchmove']) mini.addEventListener(tipo, (ev) => { ev.preventDefault(); if (ev.touches[0]) irMini(ev.touches[0]); }, { passive: false });
    window.addEventListener('mousemove', (ev) => { if (miniAbajo) irMini(ev); });
    window.addEventListener('mouseup', () => { miniAbajo = false; });

    window.addEventListener('keydown', (ev) => {
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      son.activar();
      teclas.add(ev.code);
      if (ev.key.length === 1) {
        tecleado = (tecleado + ev.key.toLowerCase()).slice(-5);
        if (tecleado.endsWith('god')) { W.orden(m, { t: 'dios', j: YO }); tecleado = ''; }
        if (tecleado === 'admin') { // abre o cierra el panel de interruptores; no activa nada por sí solo
          tecleado = ''; modo = null; deslizar = !deslizar; // deshace lo que las letras a y m hicieron por el camino (la n no llega a actuar)
          $('admin').hidden = !$('admin').hidden; actualizarAdmin();
          return;
        }
      }
      if (ev.code.startsWith('Arrow') || ev.code === 'Space') ev.preventDefault();
      const digito = /^Digit([1-9])$/.exec(ev.code);
      if (digito) {
        if (ev.shiftKey) { if (sel.size) grupos[digito[1]] = [...sel]; else delete grupos[digito[1]]; }
        else { // una pulsación selecciona; dos seguidas llevan la cámara al grupo
          const ahora = performance.now();
          llamarGrupo(digito[1], ultimoGrupo.n === digito[1] && ahora - ultimoGrupo.t < 400);
          ultimoGrupo.n = digito[1]; ultimoGrupo.t = ahora;
        }
        return;
      }
      switch (ev.code) {
        case 'KeyA': if (unidadesSel().length) modo = 'amover'; break;
        case 'KeyR': if (unidadesSel().length) modo = 'patrulla'; break;
        case 'KeyZ': atrincherar(); break;
        case 'KeyD': desplegar(); break;
        case 'F6': ev.preventDefault(); guardar(); break;
        case 'KeyK': trazar(); break;
        case 'KeyJ': conectar(); break;
        case 'KeyU': descargar(); break;
        case 'KeyB': elegirEdificios('patio'); break;
        case 'KeyQ': elegirEdificios('cuartel'); break;
        case 'KeyV': elegirEdificios('fabrica'); break;
        case 'KeyX': elegirEdificios('aerodromo'); break;
        case 'KeyG': { const ids = unidadesSel().map((u) => u.id); if (ids.length) { W.orden(m, { t: 'guardia', j: YO, ids }); son.orden(); } break; }
        case 'KeyC': W.orden(m, { t: 'colmena', j: YO }); aviso(J.colmena ? 'Colmena desactivada: nadie acude solo' : 'Colmena activada'); break;
        case 'KeyF': ponerForma(FORMAS[(FORMAS.indexOf(forma) + 1) % FORMAS.length]); break;
        case 'Delete': case 'Backspace': vender(); break;
        case 'KeyE': { const ids = unidadesSel().map((u) => u.id); if (ids.length) { W.orden(m, { t: 'explorar', j: YO, ids }); son.orden(); } break; }
        case 'KeyS': { const ids = unidadesSel().map((u) => u.id); if (ids.length) W.orden(m, { t: 'detener', j: YO, ids }); break; }
        case 'KeyH': cam.x = m.mapa.bases[YO].x; cam.y = m.mapa.bases[YO].y; break;
        case 'Space': if (J.alerta) { cam.x = J.alerta.x; cam.y = J.alerta.y; } break;
        case 'KeyL': if (conRed) { verRed = !verRed; aviso(verRed ? 'Vista de la red: lo sombreado es tu cobertura; en rojo, las líneas que no llegan a tu red' : 'Vista de la red apagada'); } else aviso('Partida clásica: sin red'); break;
        case 'KeyP': pausa = !pausa; if (pausa) son.motor(0); break;
        case 'KeyM': deslizar = !deslizar; break;
        case 'KeyN': son.alternar(); break;
        case 'Equal': case 'NumpadAdd': raton.x = cw / 2; raton.y = ch / 2; zoom(1.25); break;
        case 'Minus': case 'NumpadSubtract': raton.x = cw / 2; raton.y = ch / 2; zoom(0.8); break;
        case 'KeyT': ponerTema(tema === 'clara' ? 'oscura' : 'clara'); break;
        case 'Escape': modo = null; sel.clear(); break;
      }
    });
    window.addEventListener('keyup', (ev) => teclas.delete(ev.code));
    window.addEventListener('blur', () => { teclas.clear(); raton.izq = false; raton.medio = false; raton.der = false; raton.arrastre = false; });
    window.addEventListener('resize', ajustar);

    $('titulo').addEventListener('click', () => location.reload());
    $('semilla').textContent = 'semilla ' + semilla + ' · ' + W.VERSION;
    $('finRep').href = '?' + op.consulta + '&ya=1';
    $('finVer').hidden = !rep && !m.registro; // una partida cargada no tiene apuntado su principio
    const verRepeticion = () => { // apunta la partida en la pestaña y la vuelve a abrir como repetición, hasta el tick en que estaba
      try { if (!rep) sessionStorage.setItem('rts.rep', JSON.stringify({ q: op.consulta, c: m.registro, fin: m.t })); location.href = '?' + op.consulta + '&ya=1&rep=1'; }
      catch (e) { aviso('La repetición no cabe en la memoria del navegador'); }
    };
    W.verRepeticion = verRepeticion; // a mano en la consola, también a media partida
    $('finVer').addEventListener('click', (ev) => { ev.preventDefault(); verRepeticion(); });
    if (rep) {
      $('repBar').hidden = false; $('repSalir').href = location.pathname;
      $('repBar').addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (!b) return; repVel = +b.dataset.v; for (const q of $('repBar').querySelectorAll('button')) q.classList.toggle('on', q === b); });
    }
    $('finNueva').href = location.pathname;

    // ---------- rendimiento: tablita de abajo a la izquierda ----------
    // Tiempos medios del último segundo. A 20 ticks por segundo, la simulación dispone de 50 ms por tick;
    // a 60 cuadros por segundo, el dibujo dispone de 16,7 ms por cuadro.
    const R = { sim: 0, ticks: 0, dib: 0, cuadros: 0, ms: 0, niebla: 0, pasadas: 0 };
    const nieblaBase = W.actualizarNiebla;
    W.actualizarNiebla = function (mm) { const t0 = performance.now(); nieblaBase(mm); R.niebla += performance.now() - t0; R.pasadas++; };
    function rendimiento() {
      const f = (v) => (v < 10 ? v.toFixed(2) : v.toFixed(1)).replace('.', ',');
      const fps = R.cuadros / (R.ms / 1000), sim = R.ticks ? R.sim / R.ticks : 0, dib = R.dib / R.cuadros, nie = R.pasadas ? R.niebla / R.pasadas : 0;
      const fila = (n, v, mal) => '<tr' + (mal ? ' class="mal"' : '') + '><td>' + n + '</td><td>' + v + '</td></tr>';
      $('rend').innerHTML = fila('cuadros/s', Math.round(fps), fps < 30) + fila('dibujo', f(dib) + ' ms', dib > 16.7) + fila('simulación', f(sim) + ' ms/tick', sim > 25)
        + fila('· niebla', f(nie) + ' ms', nie > 10) + fila('entidades', m.ents.length + ' · ' + parts.length + ' part.', false);
      R.sim = R.ticks = R.dib = R.cuadros = R.ms = R.niebla = R.pasadas = 0;
    }
    $('rend').addEventListener('click', () => $('rend').classList.toggle('plegado'));

    { const patio = m.ents.find((e) => e.edif && e.j === YO && e.tipo === 'patio'); if (patio) sel.add(patio.id); } // se empieza con el patio seleccionado: su lista a la vista

    // ---------- bucle ----------
    const PASO = 1000 / W.TPS;
    let antes = performance.now(), acum = 0, finMostrado = false;
    function cuadro(ahora) {
      const dt = Math.min(250, ahora - antes); antes = ahora;
      dtCuadro = dt;
      const v = (dt / 1000) * 420 / cam.z;
      if (teclas.has('ArrowLeft')) cam.x -= v; if (teclas.has('ArrowRight')) cam.x += v;
      if (teclas.has('ArrowUp')) cam.y -= v; if (teclas.has('ArrowDown')) cam.y += v;
      limitarCam();
      if (!pausa && m.ganador < 0) {
        acum += dt * (rep ? repVel : 1);
        let n = 0;
        const t0 = performance.now();
        while (acum >= PASO && n < (rep ? 4 * Math.max(1, repVel) : 4) && !(rep && m.t >= repFin)) {
          if (rep) while (repI < rep.length && rep[repI] <= m.t) { W.orden(m, rep[repI + 1], true); repI += 2; }
          if (ia && !iaQuieta) W.iaTick(m, ia); W.tick(m); acum -= PASO; n++;
        }
        R.sim += performance.now() - t0; R.ticks += n;
        if (n && Math.floor(m.t / 600) !== Math.floor((m.t - n) / 600)) muestra();
        if (n >= (rep ? 4 * Math.max(1, repVel) : 4) || (rep && m.t >= repFin)) acum = 0;
        if (rep && m.t >= repFin && !repAvisado) { repAvisado = true; if (m.ganador < 0) aviso('Fin de la repetición'); }
        if (rep && n) { const s = Math.floor(m.t / 20), t = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); if ($('repT').textContent !== t) $('repT').textContent = t; }
        if (n) sonar();
      }
      for (const id of sel) if (!m.porId.has(id)) sel.delete(id);
      if (modo === 'colocar' && !obraLista(tipoColocar)) modo = null;
      const td = performance.now();
      if (terrVisto !== m.terrenoV) { terrVisto = m.terrenoV; pintarTerreno(); } // un camino nuevo cambia el terreno
      if (nieblaVista !== m.nieblaV) pintarNiebla();
      dibujar(pausa || m.ganador >= 0 ? 1 : Math.min(1, acum / PASO));
      if (cuadros % 6 === 0) { dibujarMini(); actualizarBarra(); }
      R.dib += performance.now() - td; R.cuadros++; R.ms += dt;
      if (R.ms >= 1000) rendimiento();
      if (cuadros % 900 === 0) for (const id of giros.keys()) if (!m.porId.has(id)) giros.delete(id);
      cuadros++;
      if (m.ganador >= 0 && !finMostrado) {
        finMostrado = true;
        $('finTxt').textContent = m.ganador === YO ? 'victoria' : m.ganador === 2 ? 'empate' : 'derrota';
        son.fin(m.ganador === YO);
        $('finSub').textContent = 'semilla ' + semilla + ' · ' + Math.round(m.t / W.TPS / 60) + ' min';
        $('fin').hidden = false; resumen();
      }
      requestAnimationFrame(cuadro);
    }
    ajustar(); ponerTema(tema);
    requestAnimationFrame(cuadro);
  };
})();
