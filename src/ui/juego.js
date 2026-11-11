// rts.warfare — interfaz: dibujo en canvas, entrada y barra lateral. Lee el mundo y emite comandos.
(function () {
  const W = globalThis.W;
  const EDIF = W.EDIF, UNID = W.UNID;
  const TAU = Math.PI * 2;

  // Toda la paleta vive aquí: cambiar de tema no cuesta nada.
  const PALETAS = {
    // Grises para todo lo que es interfaz y terreno; el color queda para bandos y recursos.
    clara:  { fondo: '#ededed', llano: '#f5f5f5', roca: '#5a5a5a', agua: '#aebfcc', bosque: '#c6cfbd', tinta: '#1a1a1a', mineral: '#4d7a38', raro: '#7d5aa6', niebla: [178, 178, 178], velo: 150, yo: '#3b6ea5', yoOsc: '#22466b', rival: '#c9622b', rivalOsc: '#853d15', bien: '#4d7a38', mal: '#b0362f' },
    oscura: { fondo: '#1c1c1c', llano: '#2c2c2c', roca: '#666666', agua: '#27353f', bosque: '#343d2f', tinta: '#e6e6e6', mineral: '#8fb574', raro: '#b08ad6', niebla: [8, 8, 8],       velo: 140, yo: '#6aa0d8', yoOsc: '#35597f', rival: '#e08a4f', rivalOsc: '#96552a', bien: '#8fb574', mal: '#d0554a' },
  };
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

  // Pantalla inicial: opciones de la partida. Los mismos valores viajan en la dirección
  // (?s=semilla&n=lado&min=minerales&ia=nivel); con &ya=1 se salta el menú.
  W.iniciar = function () {
    const $ = (id) => document.getElementById(id);
    const params = new URLSearchParams(location.search);
    try { if (localStorage.getItem('rts.tema') === 'oscura') document.body.dataset.tema = 'oscura'; } catch (e) { /* tema por defecto */ }
    const op = { n: '512', min: '2500', ia: 'normal' };
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
      const q = 's=' + semilla + '&n=' + op.n + '&min=' + op.min + '&ia=' + op.ia;
      try { history.replaceState(null, '', location.pathname + '?' + q); } catch (e) { /* en file:// puede no dejar */ }
      $('menu').hidden = true;
      W.jugar({ semilla, N: +op.n, inicio: +op.min, ia: op.ia, consulta: q });
    };
    $('empezar').addEventListener('click', empezar);
    $('op-s').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') empezar(); });
    $('tituloMenu').addEventListener('click', () => location.reload());
    if (params.has('ya')) empezar();
  };

  W.jugar = function (op) {
    const $ = (id) => document.getElementById(id);
    const semilla = op.semilla;
    const m = W.crearMundo(semilla, { N: op.N, inicio: op.inicio }), ia = op.ia === 'no' ? null : W.iaCrear(1, op.ia), N = m.N, YO = 0, J = m.jug[YO];
    W.mundo = m; // a mano en la consola, para depurar

    let tema = 'clara';
    try { tema = localStorage.getItem('rts.tema') === 'oscura' ? 'oscura' : 'clara'; } catch (e) { /* sin almacenamiento: tema por defecto */ }
    let P = PALETAS[tema], COL = null; // COL: colores de ficha por bando

    const lienzo = $('lienzo'), ctx = lienzo.getContext('2d');
    const mini = $('mini'), mctx = mini.getContext('2d'), MS = mini.width;
    let cw = 0, ch = 0, dpr = 1;
    const cam = { x: m.mapa.bases[YO].x, y: m.mapa.bases[YO].y, z: 22 };
    W.cam = cam;
    const son = W.crearSonido();
    W.son = son;
    const oido = { t: m.t, listas: 0, producidas: J.producidas, edificios: 0, bajas: 0, alerta: -999 };
    let tecleado = ''; // últimas letras escritas, para el código "god"
    const sel = new Set(), grupos = {}, teclas = new Set(), marcas = [];
    let modo = null; // null | 'colocar' | 'amover' | 'patrulla'
    let tipoColocar = null; // edificio que se está colocando
    const obraLista = (tipo) => J.obras.some((o) => o.listo && o.tipo === tipo);
    let pausa = false, cuadros = 0, nieblaVista = -1;
    const raton = { x: 0, y: 0, izq: false, x0: 0, y0: 0, medio: false, dentro: false, der: false, arrastre: false, xd: 0, yd: 0 };

    // ---------- capas pre-dibujadas ----------
    const cTerr = document.createElement('canvas'); cTerr.width = cTerr.height = N;
    const xTerr = cTerr.getContext('2d');
    const cNie = document.createElement('canvas'); cNie.width = cNie.height = N;
    const xNie = cNie.getContext('2d'), imgNie = xNie.createImageData(N, N);
    function pintarTerreno() {
      const img = xTerr.createImageData(N, N), cols = [P.llano, P.roca, P.agua, P.bosque].map(hex);
      for (let i = 0; i < N * N; i++) { const c = cols[m.mapa.terreno[i]]; img.data[i * 4] = c[0]; img.data[i * 4 + 1] = c[1]; img.data[i * 4 + 2] = c[2]; img.data[i * 4 + 3] = 255; }
      xTerr.putImageData(img, 0, 0);
    }
    function pintarNiebla() {
      const f = m.niebla[YO], d = imgNie.data, c = P.niebla;
      for (let i = 0; i < N * N; i++) { d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]; d[i * 4 + 3] = f[i] === 2 ? 0 : f[i] === 1 ? P.velo : 255; }
      xNie.putImageData(imgNie, 0, 0);
      nieblaVista = m.nieblaV;
    }
    function ponerTema(t) {
      tema = t; P = PALETAS[t]; document.body.dataset.tema = t;
      try { localStorage.setItem('rts.tema', t); } catch (e) { /* no pasa nada */ }
      const comun = { luz: P.llano, suelo: P.llano, mineral: P.mineral, humo: P.roca, fuego: '#e8912d', mal: P.mal };
      COL = { yo: Object.assign({ base: P.yo, osc: P.yoOsc }, comun), rival: Object.assign({ base: P.rival, osc: P.rivalOsc }, comun) };
      pintarTerreno(); pintarNiebla();
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
      cam.z = Math.max(Math.max(cw, ch) / N, Math.min(72, cam.z));
      const mx = cw / 2 / cam.z, my = ch / 2 / cam.z;
      cam.x = Math.max(mx, Math.min(N - mx, cam.x)); cam.y = Math.max(my, Math.min(N - my, cam.y));
    }
    const aMundoX = (sx) => cam.x + (sx - cw / 2) / cam.z, aMundoY = (sy) => cam.y + (sy - ch / 2) / cam.z;
    const visible = (x, y) => x >= 0 && y >= 0 && x < N && y < N && m.niebla[YO][Math.floor(y) * N + Math.floor(x)] === 2;
    const veo = (e) => e.j === YO || visible(e.edif ? e.cx : e.x, e.edif ? e.cy : e.y);

    function entEn(wx, wy) {
      let mejor = null, md = Infinity;
      for (const e of m.ents) {
        if (!veo(e)) continue;
        if (e.edif) { if (wx >= e.x && wx < e.x + e.tam && wy >= e.y && wy < e.y + e.tam && md > 50) { mejor = e; md = 50; } }
        else { const d = Math.hypot(e.x - wx, e.y - wy); if (d < UNID[e.tipo].radio + 0.3 && d < md) { mejor = e; md = d; } }
      }
      return mejor;
    }
    const unidadesSel = () => { const out = []; for (const id of sel) { const e = m.porId.get(id); if (e && !e.edif) out.push(e); } return out; };
    const esquinaColocar = (tipo) => { const t = EDIF[tipo].tam; return { x: Math.round(aMundoX(raton.x) - t / 2), y: Math.round(aMundoY(raton.y) - t / 2) }; };

    const NOMBRE_TERRENO = ['Llano', 'Roca · no se puede pasar', 'Agua · no se puede pasar', 'Bosque · paso lento'];
    const sitioPorCelda = new Map(m.mapa.sitios.map((s) => [s.y * N + s.x, s.tipo]));
    function bajoCursor() {
      const wx = aMundoX(raton.x), wy = aMundoY(raton.y);
      if (wx < 0 || wy < 0 || wx >= N || wy >= N) return '';
      const c = Math.floor(wy) * N + Math.floor(wx);
      if (!m.niebla[YO][c]) return 'Sin explorar';
      const e = entEn(wx, wy);
      if (e) {
        let t = (e.edif ? EDIF : UNID)[e.tipo].nombre + (e.j === YO ? '' : ' rival') + ' · ' + Math.ceil(e.vida) + '/' + e.vidaMax;
        if (e.tipo === 'cosechadora' && e.j === YO) t += ' · carga ' + e.carga;
        return t;
      }
      const sitio = sitioPorCelda.get(c);
      if (sitio) return sitio === 'petroleo' ? 'Yacimiento de petróleo' : 'Campo de conocimiento';
      if (m.mapa.tipoMin[c] === 1) return 'Minerales · ' + m.mapa.mineral[c];
      if (m.mapa.tipoMin[c] === 2) return 'Minerales raros · ' + m.mapa.mineral[c];
      return NOMBRE_TERRENO[m.mapa.terreno[c]];
    }

    // Orientación visual de cada ficha: rumbo del casco (a) y de la torreta o el arma (t).
    const giros = new Map();
    const hacia = (a, b, k) => a + ((((b - a + Math.PI) % TAU) + TAU) % TAU - Math.PI) * k;
    function giro(e) {
      const x = e.edif ? e.cx : e.x, y = e.edif ? e.cy : e.y;
      let g = giros.get(e.id);
      if (!g) { const a0 = Math.atan2(N / 2 - y, N / 2 - x); g = { a: a0, t: a0 }; giros.set(e.id, g); }
      if (!e.edif) { const dx = e.x - e.px, dy = e.y - e.py; if (dx * dx + dy * dy > 1e-6) g.a = hacia(g.a, Math.atan2(dy, dx), 0.25); }
      const o = e.obj ? m.porId.get(e.obj) : null;
      g.t = hacia(g.t, o ? Math.atan2((o.edif ? o.cy : o.y) - y, (o.edif ? o.cx : o.x) - x) : g.a, 0.3);
      return g;
    }
    const retroceso = (e, arma) => Math.max(0, (e.recarga / W.ARMAS[arma].recarga - 0.7) / 0.3); // 1 justo al disparar

    // ---------- dibujo ----------
    function dibujar(alfa) {
      const z = cam.z, ox = cw / 2 - cam.x * z, oy = ch / 2 - cam.y * z, f = m.niebla[YO], mp = m.mapa;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = P.fondo; ctx.fillRect(0, 0, cw, ch);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(cTerr, ox, oy, N * z, N * z);
      const x0 = Math.floor(-ox / z) - 1, x1 = Math.floor((cw - ox) / z) + 1, y0 = Math.floor(-oy / z) - 1, y1 = Math.floor((ch - oy) / z) + 1;
      const fuera = (x, y) => x < x0 || x > x1 || y < y0 || y > y1;

      ctx.fillStyle = P.mineral; ctx.beginPath();
      for (const c of m.minas) {
        const x = c % N, y = (c / N) | 0;
        if (fuera(x, y) || !f[c]) continue;
        const r = z * (0.13 + 0.25 * Math.min(1, mp.mineral[c] / 600)), px = ox + (x + 0.5) * z, py = oy + (y + 0.5) * z;
        if (z < 8) { ctx.moveTo(px + r, py); ctx.arc(px, py, r, 0, TAU); continue; }
        for (let k = 0; k < 3; k++) { // de cerca, cada celda es un racimo de tres cristales
          const a = c * 1.7 + k * 2.1, qx = px + Math.cos(a) * z * 0.2, qy = py + Math.sin(a) * z * 0.2, h = r * (1.05 - k * 0.2), w = h * 0.55;
          ctx.moveTo(qx, qy - h); ctx.lineTo(qx + w, qy); ctx.lineTo(qx, qy + h); ctx.lineTo(qx - w, qy); ctx.closePath();
        }
      }
      ctx.fill();
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
        if (fuera(s.x, s.y) || !f[s.y * N + s.x]) continue;
        const px = ox + (s.x + 0.5) * z, py = oy + (s.y + 0.5) * z;
        if (s.tipo === 'petroleo') {
          ctx.beginPath(); ctx.arc(px, py, z * 0.5, 0, TAU); ctx.stroke();
          ctx.beginPath(); ctx.arc(px, py, z * 0.17, 0, TAU); ctx.fill();
        } else {
          ctx.beginPath(); ctx.arc(px, py, z * 0.55, 0, TAU); ctx.moveTo(px + z * 0.28, py); ctx.arc(px, py, z * 0.28, 0, TAU);
          ctx.moveTo(px - z * 0.85, py); ctx.lineTo(px + z * 0.85, py); ctx.moveTo(px, py - z * 0.85); ctx.lineTo(px, py + z * 0.85); ctx.stroke();
        }
      }

      const barras = [], tiempo = performance.now();
      const lod = z >= 16 ? 2 : z >= 8 ? 1 : 0; // nivel de detalle según el zoom
      const descargando = new Set();
      for (const e of m.ents) if (!e.edif && e.est === 'descargar') descargando.add(e.ref);
      for (const e of m.ents) {
        if (!e.edif || !veo(e) || fuera(e.cx, e.cy) && fuera(e.x, e.y)) continue;
        const px = ox + e.x * z, py = oy + e.y * z, t = e.tam * z, Je = m.jug[e.j];
        const est = { tiempo, id: e.id, vida: e.vida / e.vidaMax, deficit: Je.uso > Je.prod, activo: false, descarga: descargando.has(e.id), ang: 0, retro: 0 };
        if (e.tipo === 'patio') est.activo = Je.obras.some((o) => !o.listo);
        else if (e.tipo === 'fabrica') est.activo = Je.colas.veh.lista.length > 0;
        else if (e.tipo === 'torreta') { est.ang = giro(e).t; est.retro = retroceso(e, 'bateria'); }
        W.fichaEdificio(ctx, e, px, py, t, lod, e.j === YO ? COL.yo : COL.rival, est);
        if (sel.has(e.id)) {
          const g = Math.max(4, t * 0.18), a = px - 2, b = py - 2, c2 = px + t + 2, d2 = py + t + 2; // escuadras de selección
          ctx.strokeStyle = P.tinta; ctx.lineWidth = 1.5; ctx.beginPath();
          ctx.moveTo(a, b + g); ctx.lineTo(a, b); ctx.lineTo(a + g, b); ctx.moveTo(c2 - g, b); ctx.lineTo(c2, b); ctx.lineTo(c2, b + g);
          ctx.moveTo(c2, d2 - g); ctx.lineTo(c2, d2); ctx.lineTo(c2 - g, d2); ctx.moveTo(a + g, d2); ctx.lineTo(a, d2); ctx.lineTo(a, d2 - g); ctx.stroke();
          if (e.tipo === 'torreta') { // alcance
            ctx.setLineDash([5, 5]); ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.arc(px + t / 2, py + t / 2, W.ARMAS.bateria.alcance * z, 0, TAU); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
          }
        }
        if (sel.has(e.id) && e.reunion && e.j === YO) { // punto de reunión: línea y banderín
          const rx = ox + e.reunion.x * z, ry = oy + e.reunion.y * z;
          ctx.strokeStyle = P.bien; ctx.fillStyle = P.bien; ctx.lineWidth = 1.2; ctx.setLineDash([3, 3]);
          ctx.beginPath(); ctx.moveTo(px + t / 2, py + t / 2); ctx.lineTo(rx, ry); ctx.stroke(); ctx.setLineDash([]);
          ctx.beginPath(); ctx.moveTo(rx, ry); ctx.lineTo(rx, ry - 14); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(rx, ry - 14); ctx.lineTo(rx + 9, ry - 10.5); ctx.lineTo(rx, ry - 7); ctx.closePath(); ctx.fill();
        }
        if (sel.has(e.id) || e.vida < e.vidaMax) barras.push([px, py - 6, t, e.vida / e.vidaMax]);
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

      for (const e of m.ents) {
        if (e.edif || !veo(e)) continue;
        const wx = e.px + (e.x - e.px) * alfa, wy = e.py + (e.y - e.py) * alfa;
        if (fuera(wx, wy)) continue;
        const d = UNID[e.tipo], px = ox + wx * z, py = oy + wy * z, r = Math.max(2, d.radio * z), g = giro(e);
        const anda = (e.x - e.px) ** 2 + (e.y - e.py) ** 2 > 1e-6;
        ctx.save(); ctx.translate(px, py);
        W.fichaUnidad(ctx, e, r, lod, e.j === YO ? COL.yo : COL.rival, {
          ang: e.tipo === 'infanteria' && e.obj && !anda ? g.t : g.a, angT: g.t, retro: d.arma ? retroceso(e, d.arma) : 0,
          anda, tiempo, carga: e.carga / (d.carga || 1), cosecha: e.est === 'cosechar',
        });
        ctx.restore();
        if (sel.has(e.id)) { ctx.strokeStyle = P.tinta; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(px, py, r * 1.9 + 2, 0, TAU); ctx.stroke(); }
        if (sel.has(e.id) || e.vida < e.vidaMax) barras.push([px - r * 1.3, py - r * 1.9 - 8, r * 2.6, e.vida / e.vidaMax]);
      }

      ctx.lineWidth = Math.max(1, z * 0.07);
      for (const d of m.efectos) {
        const edad = m.t - d.t;
        if (edad > 3 || !(visible(d.x1, d.y1) || visible(d.x2, d.y2))) continue;
        ctx.strokeStyle = d.j === YO ? P.yo : P.rival; ctx.globalAlpha = 1 - edad * 0.28;
        ctx.beginPath(); ctx.moveTo(ox + d.x1 * z, oy + d.y1 * z); ctx.lineTo(ox + d.x2 * z, oy + d.y2 * z); ctx.stroke();
        ctx.beginPath(); ctx.arc(ox + d.x2 * z, oy + d.y2 * z, z * 0.22, 0, TAU); ctx.stroke();
      }
      ctx.globalAlpha = 1;

      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(cNie, ox, oy, N * z, N * z);
      ctx.strokeStyle = P.tinta; ctx.lineWidth = 1; ctx.strokeRect(ox - 0.5, oy - 0.5, N * z + 1, N * z + 1);

      for (const b of barras) {
        ctx.fillStyle = P.fondo; ctx.fillRect(b[0], b[1], b[2], 3);
        ctx.fillStyle = b[3] > 0.5 ? P.bien : b[3] > 0.25 ? P.rival : P.mal; ctx.fillRect(b[0], b[1], b[2] * Math.max(0, b[3]), 3);
      }
      const ahora = performance.now();
      for (let k = marcas.length - 1; k >= 0; k--) {
        const a = (ahora - marcas[k].t0) / 450;
        if (a >= 1) { marcas.splice(k, 1); continue; }
        ctx.strokeStyle = marcas[k].color; ctx.globalAlpha = 1 - a; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(ox + marcas[k].x * z, oy + marcas[k].y * z, z * (0.2 + a * 0.7), 0, TAU); ctx.stroke();
      }
      ctx.globalAlpha = 1;

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
      if (pausa || modo === 'amover' || modo === 'patrulla') {
        ctx.fillStyle = P.tinta;
        ctx.fillText(pausa ? 'pausa' : modo === 'amover' ? 'atacar al avanzar: elige destino' : 'patrulla: elige el punto (con Mayús añades más)', 12, 20);
      }
      // Etiqueta de lo que hay bajo el cursor.
      if (raton.dentro && !raton.izq && !raton.arrastre && !raton.medio) {
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
      for (const e of m.ents) {
        if (!veo(e)) continue;
        mctx.fillStyle = e.j === YO ? P.yo : P.rival;
        if (e.edif) mctx.fillRect(e.x * k, e.y * k, Math.max(3, e.tam * k), Math.max(3, e.tam * k)); else mctx.fillRect(e.x * k - 1, e.y * k - 1, 2.5, 2.5);
      }
      mctx.imageSmoothingEnabled = true;
      mctx.drawImage(cNie, 0, 0, MS, MS);
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
      let n = 0;
      for (const d of m.efectos) {
        if (d.t < oido.t || n >= 5) continue;
        const v = visible(d.x2, d.y2) || visible(d.x1, d.y1) ? cerca(d.x2, d.y2) : 0;
        if (v > 0) { son.disparo(d.arma, v); n++; }
      }
      oido.t = m.t;
      const listas = J.obras.filter((o) => o.listo).length;
      if (listas > oido.listas) son.obraLista();
      oido.listas = listas;
      if (J.producidas > oido.producidas) son.unidadLista();
      oido.producidas = J.producidas;
      let edificios = 0;
      for (const tipo in EDIF) edificios += J.cuenta[tipo] || 0;
      if (edificios > oido.edificios && oido.edificios) son.colocar();
      oido.edificios = edificios;
      const bajas = m.jug[0].bajas + m.jug[1].bajas;
      if (bajas > oido.bajas) son.explosion(0.5);
      oido.bajas = bajas;
      if (J.alerta && J.alerta.t > oido.alerta + 300) { oido.alerta = J.alerta.t; if (cerca(J.alerta.x, J.alerta.y) === 0) son.alerta(); }
    }

    // ---------- barra lateral ----------
    const botones = [];
    function boton(cont, tipo, d, esEdif) {
      const b = document.createElement('button');
      b.className = 'btn'; b.type = 'button';
      b.innerHTML = '<span class="n"></span><span class="d"><span class="c"></span><span class="x" title="Cancelar">×</span></span>';
      b.querySelector('.n').textContent = d.nombre;
      b.title = 'Requiere: ' + d.req.map((r) => EDIF[r].nombre).join(', ');
      b.addEventListener('click', () => {
        son.activar();
        if (esEdif) {
          if (obraLista(tipo)) { modo = 'colocar'; tipoColocar = tipo; }
          else W.orden(m, { t: 'construir', j: YO, tipo });
        } else W.orden(m, { t: 'entrenar', j: YO, tipo });
      });
      const cancelar = (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        if (esEdif) { W.orden(m, { t: 'cancelarEdif', j: YO, tipo }); if (tipoColocar === tipo) modo = null; }
        else W.orden(m, { t: 'cancelarUnidad', j: YO, tipo });
      };
      b.addEventListener('contextmenu', cancelar);
      b.querySelector('.x').addEventListener('click', cancelar);
      cont.appendChild(b);
      botones.push({ b, tipo, d, esEdif, c: b.querySelector('.c'), n: b.querySelector('.n') });
    }
    for (const tipo in EDIF) if (tipo !== 'patio') boton($('bEdif'), tipo, EDIF[tipo], true);
    for (const tipo in UNID) boton($('bUnid'), tipo, UNID[tipo], false);

    function actualizarBarra() {
      $('rMin').textContent = J.dios ? '∞' : Math.floor(J.minerales);
      $('dios').hidden = !J.dios;
      const e = $('rEne'); e.textContent = J.prod + ' / ' + J.uso; e.className = J.uso > J.prod ? 'mal' : '';
      for (const o of botones) {
        const d = o.d, req = W.tieneReq(m, YO, d.req);
        let clase = 'btn', txt = String(d.costo), p = 0, nombre = d.nombre;
        if (o.esEdif) {
          let n = 0, listas = 0, avance = 0;
          for (const a of J.obras) if (a.tipo === o.tipo) { n++; if (a.listo) listas++; else avance = Math.max(avance, a.prog / d.tiempo); }
          if (n > 1) nombre += ' ×' + n;
          if (n) clase += ' con-x';
          if (listas) { clase += ' listo'; txt = 'colocar'; }
          else if (n) { p = avance; txt = Math.floor(p * 100) + '%'; }
          else if (!req) clase += ' no';
          else if (J.minerales < d.costo) clase += ' caro';
        } else {
          const q = J.colas[d.cat], n = q.lista.filter((t) => t === o.tipo).length;
          if (n) { nombre += ' ×' + n; clase += ' con-x'; }
          if (q.lista[0] === o.tipo) p = q.prog / d.tiempo;
          if (!req) clase += ' no'; else if (J.minerales < d.costo) clase += ' caro';
        }
        if (o.b.className !== clase) o.b.className = clase;
        if (o.c.textContent !== txt) o.c.textContent = txt;
        if (o.n.textContent !== nombre) o.n.textContent = nombre;
        o.b.style.setProperty('--p', (p * 100).toFixed(1) + '%');
      }
      const enCurso = J.obras.filter((a) => !a.listo).length;
      const reparto = enCurso > 1 ? enCurso + ' obras a la vez: cada una a 1/' + enCurso + ' de velocidad' : '';
      if ($('obras').textContent !== reparto) $('obras').textContent = reparto;
      const nc = J.cuenta.cuartel || 0, nf = J.cuenta.fabrica || 0;
      const bono = (n, uno, varios) => n + ' ' + (n > 1 ? varios : uno) + ' ×' + W.ritmo(n);
      const ritmos = nc > 1 || nf > 1 ? [nc ? bono(nc, 'cuartel', 'cuarteles') : '', nf ? bono(nf, 'fábrica', 'fábricas') : ''].filter(Boolean).join(' · ') : '';
      if ($('ritmo').textContent !== ritmos) $('ritmo').textContent = ritmos;
      let s = '';
      const vivos = [...sel].map((id) => m.porId.get(id)).filter(Boolean);
      if (vivos.length === 1) { const v = vivos[0]; s = (v.edif ? EDIF : UNID)[v.tipo].nombre + ' · ' + Math.ceil(v.vida) + ' / ' + v.vidaMax; }
      else if (vivos.length > 1) s = vivos.length + ' unidades';
      if ($('sel').textContent !== s) $('sel').textContent = s;
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
        if (modo === 'amover' || modo === 'patrulla') {
          const ids = unidadesSel().map((u) => u.id);
          if (ids.length) { W.orden(m, { t: modo, j: YO, ids, x: wx, y: wy, enc: ev.shiftKey }); marca(wx, wy, P.mal); son.orden(); }
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
    function ordenar(wx, wy, enc) {
        if (modo) { modo = null; return; }
        if (wx < 0 || wy < 0 || wx >= N || wy >= N) return;
        const us = unidadesSel();
        if (!us.length) { // con un cuartel o una fábrica seleccionados: punto de reunión
          let puesto = false;
          for (const id of sel) { const e = m.porId.get(id); if (e && e.edif && (e.tipo === 'cuartel' || e.tipo === 'fabrica')) { W.orden(m, { t: 'reunion', j: YO, id, x: wx, y: wy }); puesto = true; } }
          if (puesto) { marca(wx, wy, P.bien); son.orden(); }
          return;
        }
        const ids = us.map((u) => u.id), o = entEn(wx, wy), c = Math.floor(wy) * N + Math.floor(wx);
        if (o && o.j !== YO) { W.orden(m, { t: 'atacar', j: YO, ids, obj: o.id, enc }); marca(wx, wy, P.mal); return; }
        const cos = us.filter((u) => u.tipo === 'cosechadora').map((u) => u.id);
        if (cos.length && m.mapa.tipoMin[c] === 1 && m.niebla[YO][c]) {
          W.orden(m, { t: 'cosechar', j: YO, ids: cos, x: wx, y: wy });
          const resto = us.filter((u) => u.tipo !== 'cosechadora').map((u) => u.id);
          if (resto.length) W.orden(m, { t: 'mover', j: YO, ids: resto, x: wx, y: wy, enc });
        } else W.orden(m, { t: 'mover', j: YO, ids, x: wx, y: wy, enc });
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
      if (!ev.shiftKey) sel.clear();
      if (Math.hypot(raton.x - raton.x0, raton.y - raton.y0) <= 5) {
        const e = entEn(aMundoX(raton.x), aMundoY(raton.y));
        if (e && e.j === YO) { if (ev.shiftKey && sel.has(e.id)) sel.delete(e.id); else sel.add(e.id); }
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

    let miniAbajo = false;
    function irMini(ev) { const r = mini.getBoundingClientRect(); cam.x = ((ev.clientX - r.left) / r.width) * N; cam.y = ((ev.clientY - r.top) / r.height) * N; limitarCam(); }
    mini.addEventListener('mousedown', (ev) => { miniAbajo = true; irMini(ev); });
    window.addEventListener('mousemove', (ev) => { if (miniAbajo) irMini(ev); });
    window.addEventListener('mouseup', () => { miniAbajo = false; });

    window.addEventListener('keydown', (ev) => {
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      son.activar();
      teclas.add(ev.code);
      if (ev.key.length === 1) {
        tecleado = (tecleado + ev.key.toLowerCase()).slice(-3);
        if (tecleado === 'god') { W.orden(m, { t: 'dios', j: YO }); tecleado = ''; }
      }
      if (ev.code.startsWith('Arrow') || ev.code === 'Space') ev.preventDefault();
      const digito = /^Digit([1-9])$/.exec(ev.code);
      if (digito) {
        if (ev.shiftKey) grupos[digito[1]] = [...sel];
        else if (grupos[digito[1]]) { // selecciona el grupo y lleva la cámara a su centro
          sel.clear();
          let sx = 0, sy = 0, n = 0;
          for (const id of grupos[digito[1]]) {
            const e = m.porId.get(id);
            if (!e) continue;
            sel.add(id); sx += e.edif ? e.cx : e.x; sy += e.edif ? e.cy : e.y; n++;
          }
          if (n) { cam.x = sx / n; cam.y = sy / n; limitarCam(); }
        }
        return;
      }
      switch (ev.code) {
        case 'KeyA': if (unidadesSel().length) modo = 'amover'; break;
        case 'KeyR': if (unidadesSel().length) modo = 'patrulla'; break;
        case 'KeyE': { const ids = unidadesSel().map((u) => u.id); if (ids.length) { W.orden(m, { t: 'explorar', j: YO, ids }); son.orden(); } break; }
        case 'KeyS': { const ids = unidadesSel().map((u) => u.id); if (ids.length) W.orden(m, { t: 'detener', j: YO, ids }); break; }
        case 'KeyH': cam.x = m.mapa.bases[YO].x; cam.y = m.mapa.bases[YO].y; break;
        case 'Space': if (J.alerta) { cam.x = J.alerta.x; cam.y = J.alerta.y; } break;
        case 'KeyP': pausa = !pausa; break;
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
    $('semilla').textContent = 'semilla ' + semilla;
    $('finRep').href = '?' + op.consulta + '&ya=1';
    $('finNueva').href = location.pathname;

    // ---------- bucle ----------
    const PASO = 1000 / W.TPS;
    let antes = performance.now(), acum = 0, finMostrado = false;
    function cuadro(ahora) {
      const dt = Math.min(250, ahora - antes); antes = ahora;
      const v = (dt / 1000) * 420 / cam.z;
      if (teclas.has('ArrowLeft')) cam.x -= v; if (teclas.has('ArrowRight')) cam.x += v;
      if (teclas.has('ArrowUp')) cam.y -= v; if (teclas.has('ArrowDown')) cam.y += v;
      limitarCam();
      if (!pausa && m.ganador < 0) {
        acum += dt;
        let n = 0;
        while (acum >= PASO && n < 4) { if (ia) W.iaTick(m, ia); W.tick(m); acum -= PASO; n++; }
        if (n === 4) acum = 0;
        if (n) sonar();
      }
      for (const id of sel) if (!m.porId.has(id)) sel.delete(id);
      if (modo === 'colocar' && !obraLista(tipoColocar)) modo = null;
      if (nieblaVista !== m.nieblaV) pintarNiebla();
      dibujar(pausa || m.ganador >= 0 ? 1 : Math.min(1, acum / PASO));
      if (cuadros % 6 === 0) { dibujarMini(); actualizarBarra(); }
      if (cuadros % 900 === 0) for (const id of giros.keys()) if (!m.porId.has(id)) giros.delete(id);
      cuadros++;
      if (m.ganador >= 0 && !finMostrado) {
        finMostrado = true;
        $('finTxt').textContent = m.ganador === YO ? 'victoria' : m.ganador === 2 ? 'empate' : 'derrota';
        son.fin(m.ganador === YO);
        $('finSub').textContent = 'semilla ' + semilla + ' · ' + Math.round(m.t / W.TPS / 60) + ' min';
        $('fin').hidden = false;
      }
      requestAnimationFrame(cuadro);
    }
    ajustar(); ponerTema(tema);
    requestAnimationFrame(cuadro);
  };
})();
