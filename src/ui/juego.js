// rts.warfare — interfaz: dibujo en canvas, entrada y barra lateral. Lee el mundo y emite comandos.
(function () {
  const W = globalThis.W;
  const EDIF = W.EDIF, UNID = W.UNID;
  const TAU = Math.PI * 2;

  // Toda la paleta vive aquí: cambiar de tema no cuesta nada.
  const PALETAS = {
    // Grises para todo lo que es interfaz y terreno; el color queda para bandos y recursos.
    clara:  { fondo: '#ededed', llano: '#f5f5f5', roca: '#5a5a5a', agua: '#aebfcc', bosque: '#c6cfbd', tinta: '#1a1a1a', mineral: '#4d7a38', raro: '#7d5aa6', niebla: [178, 178, 178], velo: 150, yo: '#3b6ea5', rival: '#c9622b', bien: '#4d7a38', mal: '#b0362f' },
    oscura: { fondo: '#1c1c1c', llano: '#2c2c2c', roca: '#666666', agua: '#27353f', bosque: '#343d2f', tinta: '#e6e6e6', mineral: '#8fb574', raro: '#b08ad6', niebla: [8, 8, 8],       velo: 140, yo: '#6aa0d8', rival: '#e08a4f', bien: '#8fb574', mal: '#d0554a' },
  };
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

  W.iniciar = function () {
    const $ = (id) => document.getElementById(id);
    const params = new URLSearchParams(location.search);
    let semilla = parseInt(params.get('s'), 10);
    if (!Number.isFinite(semilla)) semilla = Math.floor(Date.now() % 1000000);
    const m = W.crearMundo(semilla), ia = W.iaCrear(1), N = m.N, YO = 0, J = m.jug[YO];
    W.mundo = m; // a mano en la consola, para depurar

    let tema = 'clara';
    try { tema = localStorage.getItem('rts.tema') === 'oscura' ? 'oscura' : 'clara'; } catch (e) { /* sin almacenamiento: tema por defecto */ }
    let P = PALETAS[tema];

    const lienzo = $('lienzo'), ctx = lienzo.getContext('2d');
    const mini = $('mini'), mctx = mini.getContext('2d'), MS = mini.width;
    let cw = 0, ch = 0, dpr = 1;
    const cam = { x: m.mapa.bases[YO].x, y: m.mapa.bases[YO].y, z: 14 };
    W.cam = cam;
    let tecleado = ''; // últimas letras escritas, para el código "god"
    const sel = new Set(), grupos = {}, teclas = new Set(), marcas = [];
    let modo = null; // null | 'colocar' | 'amover'
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
      cam.z = Math.max(Math.max(cw, ch) / N, Math.min(40, cam.z));
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
        ctx.moveTo(px + r, py); ctx.arc(px, py, r, 0, TAU);
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

      const barras = [];
      for (const e of m.ents) {
        if (!e.edif || !veo(e) || fuera(e.cx, e.cy) && fuera(e.x, e.y)) continue;
        const px = ox + e.x * z, py = oy + e.y * z, t = e.tam * z, cx = px + t / 2, cy = py + t / 2;
        ctx.fillStyle = e.j === YO ? P.yo : P.rival;
        ctx.strokeStyle = P.llano; ctx.lineWidth = Math.max(1, z * 0.1);
        if (e.tipo === 'torreta') {
          ctx.beginPath(); ctx.arc(cx, cy, t * 0.46, 0, TAU); ctx.fill();
          ctx.beginPath(); ctx.arc(cx, cy, t * 0.2, 0, TAU); ctx.stroke();
        } else {
          ctx.fillRect(px + 1, py + 1, t - 2, t - 2);
          ctx.beginPath();
          const g = t * 0.24;
          if (e.tipo === 'patio') ctx.rect(cx - g, cy - g, g * 2, g * 2);
          else if (e.tipo === 'central') ctx.arc(cx, cy, g, 0, TAU);
          else if (e.tipo === 'refineria') { ctx.moveTo(cx, cy - g); ctx.lineTo(cx + g, cy); ctx.lineTo(cx, cy + g); ctx.lineTo(cx - g, cy); ctx.closePath(); }
          else if (e.tipo === 'cuartel') { ctx.moveTo(cx - g, cy); ctx.lineTo(cx + g, cy); ctx.moveTo(cx, cy - g); ctx.lineTo(cx, cy + g); }
          else if (e.tipo === 'fabrica') { ctx.moveTo(cx, cy - g); ctx.lineTo(cx + g, cy + g); ctx.lineTo(cx - g, cy + g); ctx.closePath(); }
          ctx.stroke();
        }
        if (sel.has(e.id)) { ctx.strokeStyle = P.tinta; ctx.lineWidth = 1.5; ctx.strokeRect(px - 1, py - 1, t + 2, t + 2); }
        if (sel.has(e.id) || e.vida < e.vidaMax) barras.push([px, py - 5, t, e.vida / e.vidaMax]);
      }
      for (const e of m.ents) {
        if (e.edif || !veo(e)) continue;
        const wx = e.px + (e.x - e.px) * alfa, wy = e.py + (e.y - e.py) * alfa;
        if (fuera(wx, wy)) continue;
        const px = ox + wx * z, py = oy + wy * z, r = Math.max(2, UNID[e.tipo].radio * z);
        ctx.fillStyle = e.j === YO ? P.yo : P.rival;
        ctx.beginPath();
        if (e.tipo === 'infanteria') ctx.arc(px, py, r, 0, TAU);
        else if (e.tipo === 'tanque') { ctx.moveTo(px, py - r * 1.15); ctx.lineTo(px + r * 1.15, py); ctx.lineTo(px, py + r * 1.15); ctx.lineTo(px - r * 1.15, py); ctx.closePath(); }
        else ctx.rect(px - r, py - r, r * 2, r * 2);
        ctx.fill();
        if (e.tipo === 'cosechadora') { // el relleno interior muestra la carga
          const q = e.carga / UNID.cosechadora.carga, i = r * 0.62;
          ctx.fillStyle = P.llano; ctx.fillRect(px - i, py - i, i * 2, i * 2);
          if (q > 0) { ctx.fillStyle = P.mineral; ctx.fillRect(px - i, py + i - i * 2 * q, i * 2, i * 2 * q); }
        }
        if (sel.has(e.id)) { ctx.strokeStyle = P.tinta; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(px, py, r * 1.5 + 2, 0, TAU); ctx.stroke(); }
        if (sel.has(e.id) || e.vida < e.vidaMax) barras.push([px - r * 1.3, py - r * 1.5 - 7, r * 2.6, e.vida / e.vidaMax]);
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
      if (pausa || modo === 'amover') {
        ctx.fillStyle = P.tinta; ctx.font = '12px "Fira Code", ui-monospace, monospace';
        ctx.fillText(pausa ? 'pausa' : 'atacar al avanzar: elige destino', 12, 20);
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

    // ---------- barra lateral ----------
    const botones = [];
    function boton(cont, tipo, d, esEdif) {
      const b = document.createElement('button');
      b.className = 'btn'; b.type = 'button';
      b.innerHTML = '<span class="n"></span><span class="d"><span class="c"></span><span class="x" title="Cancelar">×</span></span>';
      b.querySelector('.n').textContent = d.nombre;
      b.title = 'Requiere: ' + d.req.map((r) => EDIF[r].nombre).join(', ');
      b.addEventListener('click', () => {
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
      posRaton(ev);
      const wx = aMundoX(raton.x), wy = aMundoY(raton.y);
      if (ev.button === 1) { raton.medio = true; ev.preventDefault(); return; }
      if (ev.button === 0) {
        if (modo === 'colocar') {
          const p = esquinaColocar(tipoColocar);
          if (W.puedeColocar(m, YO, tipoColocar, p.x, p.y)) { W.orden(m, { t: 'colocar', j: YO, tipo: tipoColocar, x: p.x, y: p.y }); modo = null; }
          return;
        }
        if (modo === 'amover') {
          const ids = unidadesSel().map((u) => u.id);
          if (ids.length) { W.orden(m, { t: 'amover', j: YO, ids, x: wx, y: wy }); marca(wx, wy, P.mal); }
          modo = null; return;
        }
        raton.izq = true; raton.x0 = raton.x; raton.y0 = raton.y;
        return;
      }
      if (ev.button === 2) { raton.der = true; raton.arrastre = false; raton.xd = raton.x; raton.yd = raton.y; }
    });
    // Clic derecho sin mover = orden; clic derecho arrastrando = desplazar el mapa (como en Red Alert).
    function ordenar(wx, wy) {
        if (modo) { modo = null; return; }
        const us = unidadesSel();
        if (!us.length || wx < 0 || wy < 0 || wx >= N || wy >= N) return;
        const ids = us.map((u) => u.id), o = entEn(wx, wy), c = Math.floor(wy) * N + Math.floor(wx);
        if (o && o.j !== YO) { W.orden(m, { t: 'atacar', j: YO, ids, obj: o.id }); marca(wx, wy, P.mal); return; }
        const cos = us.filter((u) => u.tipo === 'cosechadora').map((u) => u.id);
        if (cos.length && m.mapa.tipoMin[c] === 1 && m.niebla[YO][c]) {
          W.orden(m, { t: 'cosechar', j: YO, ids: cos, x: wx, y: wy });
          const resto = us.filter((u) => u.tipo !== 'cosechadora').map((u) => u.id);
          if (resto.length) W.orden(m, { t: 'mover', j: YO, ids: resto, x: wx, y: wy });
        } else W.orden(m, { t: 'mover', j: YO, ids, x: wx, y: wy });
        marca(wx, wy, P.bien);
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
        if (!fue) ordenar(aMundoX(raton.x), aMundoY(raton.y));
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
      teclas.add(ev.code);
      if (ev.key.length === 1) {
        tecleado = (tecleado + ev.key.toLowerCase()).slice(-3);
        if (tecleado === 'god') { W.orden(m, { t: 'dios', j: YO }); tecleado = ''; }
      }
      if (ev.code.startsWith('Arrow') || ev.code === 'Space') ev.preventDefault();
      const digito = /^Digit([1-9])$/.exec(ev.code);
      if (digito) {
        if (ev.shiftKey) grupos[digito[1]] = [...sel];
        else if (grupos[digito[1]]) { sel.clear(); for (const id of grupos[digito[1]]) if (m.porId.has(id)) sel.add(id); }
        return;
      }
      switch (ev.code) {
        case 'KeyA': if (unidadesSel().length) modo = 'amover'; break;
        case 'KeyS': { const ids = unidadesSel().map((u) => u.id); if (ids.length) W.orden(m, { t: 'detener', j: YO, ids }); break; }
        case 'KeyH': cam.x = m.mapa.bases[YO].x; cam.y = m.mapa.bases[YO].y; break;
        case 'Space': if (J.alerta) { cam.x = J.alerta.x; cam.y = J.alerta.y; } break;
        case 'KeyP': pausa = !pausa; break;
        case 'KeyM': deslizar = !deslizar; break;
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
    $('finRep').href = '?s=' + semilla;
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
        while (acum >= PASO && n < 4) { W.iaTick(m, ia); W.tick(m); acum -= PASO; n++; }
        if (n === 4) acum = 0;
      }
      for (const id of sel) if (!m.porId.has(id)) sel.delete(id);
      if (modo === 'colocar' && !obraLista(tipoColocar)) modo = null;
      if (nieblaVista !== m.nieblaV) pintarNiebla();
      dibujar(pausa || m.ganador >= 0 ? 1 : Math.min(1, acum / PASO));
      if (cuadros % 6 === 0) { dibujarMini(); actualizarBarra(); }
      cuadros++;
      if (m.ganador >= 0 && !finMostrado) {
        finMostrado = true;
        $('finTxt').textContent = m.ganador === YO ? 'victoria' : m.ganador === 2 ? 'empate' : 'derrota';
        $('finSub').textContent = 'semilla ' + semilla + ' · ' + Math.round(m.t / W.TPS / 60) + ' min';
        $('fin').hidden = false;
      }
      requestAnimationFrame(cuadro);
    }
    ajustar(); ponerTema(tema);
    requestAnimationFrame(cuadro);
  };
})();
