// drone.warfare — la vista: cámara, las cuatro visiones (con día y noche), el marco de transmisión y el panel.
(function () {
  const D = globalThis.D, T = D.T, TAU = Math.PI * 2, PX = 14; // PX: píxeles por celda en las capas de terreno ya pintadas
  const $ = (id) => document.getElementById(id);
  const lienzo = $('lienzo'), ctx = lienzo.getContext('2d');
  const par = new URLSearchParams(location.search);
  const semilla = Number(par.get('s')) || Math.floor(Math.random() * 99999) + 1;
  const escenario = par.get('esc') === 'urbano' ? 'urbano' : 'mixto', YO = par.get('rol') === 'defensa' ? 1 : 0, elegido = par.has('rol'); // el bando 0 ataca; el 1 defiende
  const m = (D.mundo = D.crearMundo(semilla, { escenario, ia: [YO !== 0, YO !== 1], t: par.get('noche') === '1' ? D.ECON.diaLuz : undefined })), N = m.N, mapa = m.mapa, mio = (j) => (j === YO ? 0 : j === 1 - YO ? 1 : null);
  const cam = (D.cam = { x: mapa.bases[YO].x + Math.cos(mapa.bases[YO].frente) * 7, y: mapa.bases[YO].y + Math.sin(mapa.bases[YO].frente) * 7, z: 15 });
  let cw = 0, ch = 0, dpr = 1, vision = 'optica', raton = { x: -1, y: -1, dentro: false };
  const todo = par.get('todo') === '1', sel = new Set(), fx = [], marcas = []; // todo: ver también lo que no se ha descubierto (para probar); sel: equipos seleccionados
  let caja = null, pausa = false;
  const VISIONES = [
    ['optica', 'Óptica', 'A simple vista. De día se ve lo que no está bajo cobertura; de noche, solo lo cercano a los tuyos.'],
    ['nocturna', 'Nocturna', 'Intensificador de luz: todo en verde. No distingue bandos; los tuyos llevan una baliza que parpadea.'],
    ['termica', 'Térmica', 'Calor en blanco: cuerpos y motores brillan también bajo los árboles. No distingue bandos.'],
    ['espectro', 'Espectro', 'Lo que emite por radio: antenas, drones de radio e inhibidores. La fibra y el soldado callado no aparecen.'],
  ];

  // ---------- capas de terreno: se pintan una vez por paleta y luego se reutilizan como imagen ----------
  const capas = {};
  function capa(modo) {
    if (capas[modo]) return capas[modo];
    const P = D.pintor(modo, 0), suelo = document.createElement('canvas'), copas = document.createElement('canvas'); suelo.width = suelo.height = copas.width = copas.height = N * PX;
    const c = suelo.getContext('2d'), X = (v) => v * PX, linea = (pts) => { c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(X(x), X(y)) : c.moveTo(X(x), X(y)))); };
    c.fillStyle = P.col('suelo'); c.fillRect(0, 0, N * PX, N * PX);
    const U = mapa.urbano;
    for (const h of mapa.hierbas) { c.fillStyle = P.col('hierba'); c.beginPath(); c.ellipse(X(h.x), X(h.y), X(h.rx), X(h.ry), h.ang, 0, TAU); c.fill(); }
    for (const f of mapa.campos) { // campo arado: el polígono y, dentro, los surcos
      c.fillStyle = P.col('campo'); linea(f.pts); c.closePath(); c.fill(); c.save(); c.clip();
      c.strokeStyle = P.col('surco'); c.lineWidth = 1; c.beginPath(); const co = Math.cos(f.ang), si = Math.sin(f.ang), cx = f.pts[0][0], cy = f.pts[0][1];
      for (let d = -70; d < 70; d += 0.5) { c.moveTo(X(cx + co * -70 - si * d), X(cy + si * -70 + co * d)); c.lineTo(X(cx + co * 70 - si * d), X(cy + si * 70 + co * d)); } c.stroke(); c.restore();
    }
    c.fillStyle = P.col('acera'); c.fillRect(X(U.x0), X(U.y0), X(U.x1 - U.x0 + 1), X(U.y1 - U.y0 + 1)); // el casco urbano: suelo de acera
    c.lineCap = 'round'; c.lineJoin = 'round';
    c.strokeStyle = P.col('agua'); c.lineWidth = X(2.6); linea(mapa.arroyo); c.stroke();
    for (const v of mapa.vados) { c.fillStyle = P.col('camino'); c.globalAlpha = 0.55; c.beginPath(); c.arc(X(v.x), X(v.y), X(2.2), 0, TAU); c.fill(); c.globalAlpha = 1; c.fillStyle = P.col('ruina'); for (let i = 0; i < 9; i++) { const a = i * 2.4, d = 0.5 + (i % 3) * 0.55; c.beginPath(); c.arc(X(v.x + Math.cos(a) * d), X(v.y + Math.sin(a) * d), 2 + (i % 2), 0, TAU); c.fill(); } }
    for (const q of mapa.crateres) { c.fillStyle = P.col('crater'); c.beginPath(); c.ellipse(X(q.x), X(q.y), X(q.r), X(q.r * 0.75), 0, 0, TAU); c.fill(); c.fillStyle = P.col('trinchera'); c.globalAlpha = 0.45; c.beginPath(); c.ellipse(X(q.x) + 1, X(q.y) + 1, X(q.r * 0.5), X(q.r * 0.36), 0, 0, TAU); c.fill(); c.globalAlpha = 1; }
    c.lineCap = 'butt'; for (const q of mapa.calles) { c.strokeStyle = P.col('calle'); c.lineWidth = X(1.7); linea(q); c.stroke(); } // calles: asfalto y una línea central gastada
    c.strokeStyle = P.col('acera'); c.lineWidth = 1; c.setLineDash([7, 9]); for (const q of mapa.calles) { linea(q); c.stroke(); } c.setLineDash([]); c.lineCap = 'round';
    { c.fillStyle = P.col('caja'); c.strokeStyle = P.tinta; c.lineWidth = 1; for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (mapa.terreno[y * N + x] === T.PUENTE && !(x >= U.x0 && x <= U.x1 && y >= U.y0 && y <= U.y1 && false)) { c.fillRect(X(x), X(y), PX, PX); } }
    // camino con roderas; donde cruza el arroyo, un puente de tablas
    c.strokeStyle = P.col('camino'); c.lineWidth = X(1.9); linea(mapa.camino); c.stroke();
    c.strokeStyle = P.col('surco'); c.lineWidth = 1; c.setLineDash([9, 7]); for (const d of [-0.32, 0.32]) { c.save(); c.translate(X(d * 0.7), X(d * 0.7)); linea(mapa.camino); c.stroke(); c.restore(); } c.setLineDash([]);
    { const pu = []; for (let i = 0; i + 1 < mapa.camino.length; i++) { const [ax, ay] = mapa.camino[i], [bx, by] = mapa.camino[i + 1]; for (let k = 0; k <= 12; k++) { const x = ax + ((bx - ax) * k) / 12, y = ay + ((by - ay) * k) / 12; if (x >= 0 && y >= 0 && x < N && y < N && mapa.terreno[Math.floor(y) * N + Math.floor(x)] === T.PUENTE) pu.push([x, y]); } }
      if (pu.length > 1) { c.lineCap = 'butt'; c.strokeStyle = P.tinta; c.lineWidth = X(2.5); linea(pu); c.stroke(); c.strokeStyle = P.col('caja'); c.lineWidth = X(2.2); linea(pu); c.stroke(); c.strokeStyle = P.tinta; c.globalAlpha = 0.45; c.setLineDash([1, 4]); linea(pu); c.stroke(); c.setLineDash([]); c.globalAlpha = 1; c.lineCap = 'round'; } }
    c.lineJoin = 'miter'; for (const t of mapa.trincheras) { c.strokeStyle = P.col('tierra'); c.lineWidth = X(0.95); linea(t); c.stroke(); c.strokeStyle = P.col('trinchera'); c.lineWidth = X(0.42); linea(t); c.stroke(); }
    for (const r of mapa.ruinas) { // muros rotos, suelo de escombro, un tabique y cascotes alrededor
      D.fig.sombraE(c, P, X(r.x), X(r.y), X(r.w), X(r.h)); if (r.alto) D.fig.sombraE(c, P, X(r.x) + 4, X(r.y) + 5, X(r.w), X(r.h)); // el bloque de pisos da más sombra
      if (r.alto) { // bloque de pisos entero: se ve el tejado, no el interior; algún boquete de impacto
        c.fillStyle = P.col('bloque'); c.fillRect(X(r.x), X(r.y), X(r.w), X(r.h)); c.fillStyle = P.col('tejado'); c.fillRect(X(r.x) + 4, X(r.y) + 4, X(r.w) - 8, X(r.h) - 8);
        c.strokeStyle = P.col('bloque'); c.lineWidth = 1; c.beginPath(); for (let i = 2; i < r.w; i += 2) { c.moveTo(X(r.x + i), X(r.y) + 4); c.lineTo(X(r.x + i), X(r.y + r.h) - 4); } c.stroke();
        c.fillStyle = P.col('ruinaS'); c.beginPath(); c.ellipse(X(r.x + r.w * (r.part || 0.5)), X(r.y + r.h * 0.5), X(0.8), X(0.6), 0.5, 0, TAU); c.fill();
        c.strokeStyle = P.tinta; c.lineWidth = 1.6; c.strokeRect(X(r.x) + 0.5, X(r.y) + 0.5, X(r.w), X(r.h)); c.fillStyle = P.col('acera'); for (const [hx, hy] of r.huecos) c.fillRect(X(hx) + 3, X(hy) + 3, PX - 6, PX - 6); continue;
      }
      c.fillStyle = P.col('ruina'); c.fillRect(X(r.x), X(r.y), X(r.w), X(r.h)); c.fillStyle = P.col('ruinaS'); c.fillRect(X(r.x + 1), X(r.y + 1), X(r.w - 2), X(r.h - 2));
      for (const [hx, hy] of r.huecos) c.fillRect(X(hx), X(hy), PX, PX);
      if (r.part) { c.fillStyle = P.col('ruina'); c.fillRect(X(r.x + r.w * r.part), X(r.y + 1), 4, X(r.h - 2) * 0.7); }
      c.strokeStyle = P.tinta; c.lineWidth = 1.2; c.setLineDash([14, 5, 4, 6]); c.strokeRect(X(r.x) + 0.5, X(r.y) + 0.5, X(r.w), X(r.h)); c.setLineDash([]);
      c.fillStyle = P.col('ruina'); for (let i = 0; i < 6; i++) c.fillRect(X(r.x) - 5 + ((i * 37) % (X(r.w) + 8)), X(r.y + r.h) + 2 + ((i * 13) % 7), 4, 3);
    }
    for (const t of mapa.tubos) for (const b of [t.a, t.b]) D.fig.edificio(c, P, X(b.x), X(b.y), 'boca', null, PX * 0.085);
    if (P.sombras) { c.fillStyle = 'rgba(30,34,40,0.16)'; for (const a of mapa.arboles) { c.beginPath(); c.arc(X(a.x) + 5, X(a.y) + 7, X(a.r), 0, TAU); c.fill(); } }
    const k = copas.getContext('2d'); for (const a of mapa.arboles) { k.fillStyle = P.col('arbol'); k.beginPath(); k.arc(X(a.x), X(a.y), X(a.r), 0, TAU); k.fill(); } for (const a of mapa.arboles) { k.fillStyle = P.col('arbol2'); k.beginPath(); k.arc(X(a.x + a.r * 0.25), X(a.y + a.r * 0.25), X(a.r * 0.6), 0, TAU); k.fill(); }
    return (capas[modo] = { suelo, copas });
  }

  // ---------- dibujo ----------
  const oscuro = document.createElement('canvas');
  function grano(n, color, a) { ctx.fillStyle = color; ctx.globalAlpha = a; for (let i = 0; i < n; i++) ctx.fillRect(Math.random() * cw, Math.random() * ch, 1.4, 1.4); ctx.globalAlpha = 1; }
  function vineta(color) { const g = ctx.createRadialGradient(cw / 2, ch / 2, ch * 0.42, cw / 2, ch / 2, Math.max(cw, ch) * 0.75); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, color); ctx.fillStyle = g; ctx.fillRect(0, 0, cw, ch); }
  let tiempo = 0, tDib = 0, nDib = 0, cuadros = 0, tSeg = 0; const visibles = [];
  function dibujar() {
    const t0 = performance.now(), z = cam.z, ox = Math.round(cw / 2 - cam.x * z), oy = Math.round(ch / 2 - cam.y * z), luz = D.luz(m);
    const modo = vision === 'optica' ? (luz >= 0.5 ? 'dia' : 'noche') : vision, P = D.pintor(modo, tiempo), L = capa(modo), lado = N * z;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.globalAlpha = 1; ctx.shadowBlur = 0; ctx.fillStyle = P.col('suelo'); ctx.fillRect(0, 0, cw, ch);
    ctx.imageSmoothingEnabled = z < PX; ctx.drawImage(L.suelo, ox, oy, lado, lado);
    if (vision === 'optica' && luz > 0 && luz < 1) { ctx.globalAlpha = modo === 'dia' ? 1 - luz : luz; ctx.drawImage(capa(modo === 'dia' ? 'noche' : 'dia').suelo, ox, oy, lado, lado); ctx.globalAlpha = 1; } // anochece y amanece: las dos capas fundidas
    const fuera = (x, y, r) => ox + (x + r) * z < 0 || oy + (y + r) * z < 0 || ox + (x - r) * z > cw || oy + (y - r) * z > ch;
    const sE = z * 0.092, sS = Math.max(0.8, z * 0.075), sD = Math.max(0.85, z * 0.082);
    // Qué se ve: lo propio siempre; del rival, los soldados que alguien tuyo está viendo, los edificios ya descubiertos y los drones que pasan cerca de los tuyos.
    const mios = m.ents.filter((e) => e.j === YO && e.clase !== 'dron'), cercaDeMios = (e, r) => mios.some((q) => Math.abs(q.x - e.x) < r && Math.abs(q.y - e.y) < r);
    const ve = (e) => e.j === YO || todo || (e.clase === 'sol' ? m.visto[YO].has(e.id) : e.clase === 'edif' ? m.conocido[YO].has(e.id) : cercaDeMios(e, e.alt ? 14 : 6));
    visibles.length = 0; for (const e of m.ents) if (ve(e)) visibles.push(e);
    for (const q of marcas) { const k = 1 - (tiempo - q.t0) / q.dur; if (k <= 0) continue; const x = ox + q.x * z, y = oy + q.y * z; ctx.globalAlpha = 0.5 * k; ctx.strokeStyle = P.tinta; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x - 4, y - 4); ctx.lineTo(x + 4, y + 4); ctx.moveTo(x + 4, y - 4); ctx.lineTo(x - 4, y + 4); ctx.stroke(); } ctx.globalAlpha = 1; // donde cayó alguien
    for (const e of visibles) if (e.clase === 'edif' && !fuera(e.x, e.y, 3)) D.fig.edificio(ctx, P, ox + e.x * z, oy + e.y * z, e.j !== YO && e.tipo === 'falsa' && !todo ? 'antena' : e.tipo, mio(e.j), sE * (e.tipo === 'centro' ? 1.15 : 1)); // la antena falsa, para el rival, es una antena
    for (const e of visibles) if (e.clase === 'dron' && !e.alt && !fuera(e.x, e.y, 2)) D.fig.dron(ctx, P, ox + e.x * z, oy + e.y * z, e.ang, e.tipo, mio(e.j), sD, 0);
    // rutas y aros de lo seleccionado, debajo de las figuras
    const COLYO = { dia: '#1f6f78', noche: '#4fb3c0', nocturna: '#e8fff0', termica: '#fff', espectro: '#39c6d6' }[modo];
    for (const e of mios) { if (e.clase !== 'sol' || !sel.has(e.eq)) continue; const x = ox + e.x * z, y = oy + e.y * z;
      if (e.ruta && e.ri < e.ruta.length) { ctx.strokeStyle = COLYO; ctx.globalAlpha = 0.45; ctx.lineWidth = 1; ctx.setLineDash(e.sigilo ? [2, 5] : [6, 5]); ctx.beginPath(); ctx.moveTo(x, y); for (let i = e.ri; i < e.ruta.length; i++) ctx.lineTo(ox + e.ruta[i][0] * z, oy + e.ruta[i][1] * z); ctx.stroke(); ctx.setLineDash([]); const f = e.ruta[e.ruta.length - 1]; ctx.beginPath(); ctx.arc(ox + f[0] * z, oy + f[1] * z, 2.5, 0, TAU); ctx.fillStyle = COLYO; ctx.fill(); ctx.globalAlpha = 1; }
      ctx.strokeStyle = COLYO; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, sS * 6.5, 0, TAU); ctx.stroke(); }
    for (const e of visibles) { if (e.clase !== 'sol' || fuera(e.x, e.y, 2)) continue; const x = ox + e.x * z, y = oy + e.y * z;
      D.fig.soldado(ctx, P, x, y, e.ang, e.tipo, mio(e.j), sS, { anda: e.movio, oculto: e.j === YO && e.firma < 0.35 });
      if (e.vida < e.vidaMax || (e.j === YO && sel.has(e.eq))) { const w = sS * 11, f = e.vida / e.vidaMax; ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(x - w / 2, y - sS * 9, w, 2.5); ctx.fillStyle = f < 0.35 ? '#c2552d' : modo === 'dia' ? '#4d7a38' : '#9be08a'; ctx.fillRect(x - w / 2, y - sS * 9, w * f, 2.5); }
      if (e.supr > 0) { ctx.strokeStyle = COLYO; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x - 4, y + sS * 7); ctx.lineTo(x, y + sS * 7 + 3); ctx.lineTo(x + 4, y + sS * 7); ctx.stroke(); } // agachado bajo el fuego
      if (e.canal > 0) { ctx.strokeStyle = '#c2552d'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(x, y, sS * 8, -Math.PI / 2, -Math.PI / 2 + TAU * (e.canal / D.ECON.cargaTicks)); ctx.stroke(); } // poniendo la carga
    }
    ctx.globalAlpha = modo === 'termica' ? 0.45 : modo === 'espectro' ? 0.5 : 0.93; ctx.drawImage(L.copas, ox, oy, lado, lado); ctx.globalAlpha = 1; // las copas tapan lo de debajo (a la térmica, menos)
    for (const e of visibles) if (e.clase === 'dron' && e.alt && !fuera(e.x, e.y, 3)) D.fig.dron(ctx, P, ox + e.x * z, oy + e.y * z, e.ang, e.tipo, mio(e.j), sD, e.alt * z * 0.6);
    // disparos, explosiones y avisos sobre el mapa
    for (let i = fx.length - 1; i >= 0; i--) { const q = fx[i], k = (tiempo - q.t0) / q.dur; if (k >= 1) { fx.splice(i, 1); continue; }
      if (q.k === 'tiro') { const x1 = ox + q.x1 * z, y1 = oy + q.y1 * z, x2 = ox + q.x2 * z, y2 = oy + q.y2 * z, a = Math.min(1, k * 1.6), b = Math.max(0, a - 0.35); ctx.strokeStyle = modo === 'dia' ? '#b8862b' : '#ffe9a8'; ctx.globalAlpha = 0.9 * (1 - k); ctx.lineWidth = q.gordo ? 1.8 : 1.1; ctx.beginPath(); ctx.moveTo(x1 + (x2 - x1) * b, y1 + (y2 - y1) * b); ctx.lineTo(x1 + (x2 - x1) * a, y1 + (y2 - y1) * a); ctx.stroke(); if (k < 0.25) { ctx.fillStyle = '#ffe9a8'; ctx.beginPath(); ctx.arc(x1, y1, 2.5, 0, TAU); ctx.fill(); } if (k > 0.6) { ctx.fillStyle = q.da ? '#c2552d' : P.tinta; ctx.globalAlpha = (1 - k) * 2; ctx.beginPath(); ctx.arc(x2, y2, q.da ? 2.5 : 1.5, 0, TAU); ctx.fill(); } }
      else if (q.k === 'anillo') { ctx.strokeStyle = q.c; ctx.globalAlpha = 1 - k; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(ox + q.x * z, oy + q.y * z, q.r * z * (0.2 + 0.8 * k), 0, TAU); ctx.stroke(); }
      else if (q.k === 'boom') { const x = ox + q.x * z, y = oy + q.y * z; ctx.globalAlpha = 1 - k; ctx.fillStyle = k < 0.15 ? '#fff3c4' : 'rgba(90,86,78,0.7)'; ctx.beginPath(); ctx.arc(x, y, z * (0.8 + k * 3.2), 0, TAU); ctx.fill(); ctx.strokeStyle = P.tinta; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, z * (1 + k * 5), 0, TAU); ctx.stroke(); }
      ctx.globalAlpha = 1; }
    if (caja) { ctx.strokeStyle = COLYO; ctx.lineWidth = 1; ctx.setLineDash([4, 3]); ctx.strokeRect(Math.min(caja.x0, caja.x1), Math.min(caja.y0, caja.y1), Math.abs(caja.x1 - caja.x0), Math.abs(caja.y1 - caja.y0)); ctx.setLineDash([]); }
    if (vision === 'optica' && luz < 1) { // la noche: oscuridad con claros alrededor de lo tuyo
      if (oscuro.width !== lienzo.width || oscuro.height !== lienzo.height) { oscuro.width = lienzo.width; oscuro.height = lienzo.height; }
      const o = oscuro.getContext('2d'); o.setTransform(dpr, 0, 0, dpr, 0, 0); o.globalCompositeOperation = 'source-over'; o.clearRect(0, 0, cw, ch); o.fillStyle = 'rgba(6,9,16,' + (0.86 * (1 - luz)).toFixed(3) + ')'; o.fillRect(0, 0, cw, ch); o.globalCompositeOperation = 'destination-out';
      for (const e of m.ents) { if (e.j !== YO || e.clase === 'dron') continue; const r = (e.clase === 'edif' ? 8 : 6) * z, x = ox + e.x * z, y = oy + e.y * z; if (x < -r || y < -r || x > cw + r || y > ch + r) continue; const g = o.createRadialGradient(x, y, r * 0.25, x, y, r); g.addColorStop(0, 'rgba(0,0,0,0.95)'); g.addColorStop(1, 'rgba(0,0,0,0)'); o.fillStyle = g; o.beginPath(); o.arc(x, y, r, 0, TAU); o.fill(); }
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(oscuro, 0, 0); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    if (modo === 'nocturna') { grano(Math.round((cw * ch) / 420), '#d8ffe0', 0.1); vineta('rgba(0,12,4,0.75)'); }
    if (modo === 'termica') { grano(Math.round((cw * ch) / 1100), '#fff', 0.05); vineta('rgba(0,0,0,0.6)'); }
    if (modo === 'espectro') emisiones(z, ox, oy);
    marco(modo, z, ox, oy);
    tDib += performance.now() - t0; nDib++;
  }
  function emisiones(z, ox, oy) { // lo que emite por radio: anillos; el enlace de cada dron con su antena; la burbuja del inhibidor
    const COL = ['#39c6d6', '#ff8a4c'], anillo = (x, y, r, c, n) => { for (let i = 0; i < n; i++) { const k = (tiempo * 0.5 + i / n) % 1; ctx.strokeStyle = c; ctx.globalAlpha = 0.75 * (1 - k); ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(x, y, r * k, 0, TAU); ctx.stroke(); } ctx.globalAlpha = 1; };
    ctx.strokeStyle = 'rgba(57,198,214,0.08)'; ctx.lineWidth = 1; ctx.beginPath(); const p = 5 * z; for (let x = ((ox % p) + p) % p; x < cw; x += p) { ctx.moveTo(x, 0); ctx.lineTo(x, ch); } for (let y = ((oy % p) + p) % p; y < ch; y += p) { ctx.moveTo(0, y); ctx.lineTo(cw, y); } ctx.stroke();
    const antenas = [[], []]; for (const e of visibles) if (e.clase === 'edif' && (e.tipo === 'antena' || (e.tipo === 'falsa' && e.j !== YO && !todo))) { if (e.tipo === 'falsa') continue; antenas[e.j].push(e); anillo(ox + e.x * z, oy + e.y * z, 16 * z, COL[mio(e.j)], 4); }
    for (const e of visibles) {
      if (e.clase === 'dron' && e.alt && D.DRON[e.tipo].radio) { const x = ox + e.x * z, y = oy + e.y * z; let a = null; for (const q of antenas[e.j]) if (!a || Math.hypot(q.x - e.x, q.y - e.y) < Math.hypot(a.x - e.x, a.y - e.y)) a = q; anillo(x, y, 2 * z, COL[mio(e.j)], 2); if (a) { ctx.setLineDash([4, 6]); ctx.strokeStyle = COL[mio(e.j)]; ctx.globalAlpha = 0.7; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(ox + a.x * z, oy + a.y * z); ctx.lineTo(x, y); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1; } }
      if (e.clase === 'sol' && e.tipo === 'inhibidor') { const x = ox + e.x * z, y = oy + e.y * z, r = 6 * z; ctx.save(); ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.clip(); ctx.strokeStyle = COL[mio(e.j)]; ctx.globalAlpha = 0.3; ctx.lineWidth = 1; ctx.beginPath(); for (let i = -r * 2; i < r * 2; i += 9) { ctx.moveTo(x + i, y - r); ctx.lineTo(x + i - r, y + r); } ctx.stroke(); ctx.restore(); ctx.globalAlpha = 1; ctx.strokeStyle = COL[mio(e.j)]; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke(); }
    }
  }
  function marco(modo, z, ox, oy) { // el marco de la transmisión
    const c = { dia: '#20242a', noche: '#8f9bb0', nocturna: '#c9ffd2', termica: '#fff', espectro: '#39c6d6' }[modo]; ctx.strokeStyle = c; ctx.fillStyle = c; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.9;
    for (const [x, y, dx, dy] of [[14, 14, 1, 1], [cw - 14, 14, -1, 1], [14, ch - 14, 1, -1], [cw - 14, ch - 14, -1, -1]]) { ctx.beginPath(); ctx.moveTo(x + dx * 26, y); ctx.lineTo(x, y); ctx.lineTo(x, y + dy * 26); ctx.stroke(); }
    ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cw / 2 - 16, ch / 2); ctx.lineTo(cw / 2 - 5, ch / 2); ctx.moveTo(cw / 2 + 5, ch / 2); ctx.lineTo(cw / 2 + 16, ch / 2); ctx.moveTo(cw / 2, ch / 2 - 16); ctx.lineTo(cw / 2, ch / 2 - 5); ctx.moveTo(cw / 2, ch / 2 + 5); ctx.lineTo(cw / 2, ch / 2 + 16); ctx.stroke();
    ctx.font = '11px ui-monospace, Menlo, Consolas, monospace'; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    const nom = VISIONES.find((v) => v[0] === vision)[1].toUpperCase() + (vision === 'optica' ? (modo === 'dia' ? ' · DÍA' : ' · NOCHE') : '');
    ctx.fillText(D.ROL[YO].clave.toUpperCase() + ' · CÁM 1 · ' + nom, 24, 32); ctx.fillText('ALT ' + Math.round(1800 / z) + ' m   SECTOR ' + m.semilla, 24, ch - 24);
    ctx.textAlign = 'right'; ctx.fillText(D.hora(m) + '   ' + String(Math.floor(cam.x * 10)).padStart(3, '0') + ' E  ' + String(Math.floor(cam.y * 10)).padStart(3, '0') + ' S', cw - 24, 32);
    const barra = 5 * z; ctx.beginPath(); ctx.moveTo(cw - 24 - barra, ch - 28); ctx.lineTo(cw - 24, ch - 28); ctx.moveTo(cw - 24 - barra, ch - 32); ctx.lineTo(cw - 24 - barra, ch - 24); ctx.moveTo(cw - 24, ch - 32); ctx.lineTo(cw - 24, ch - 24); ctx.stroke(); ctx.fillText('50 m', cw - 24, ch - 36);
    if (Math.sin(tiempo * 4) > 0) { ctx.fillStyle = modo === 'dia' ? '#c2552d' : c; ctx.beginPath(); ctx.arc(cw / 2 - 30, 28, 4, 0, TAU); ctx.fill(); } ctx.fillStyle = c; ctx.textAlign = 'left'; ctx.fillText('REC', cw / 2 - 20, 32);
    ctx.globalAlpha = 1;
  }

  // ---------- lo que pasa en el mundo: de los avisos de la simulación a dibujo y texto ----------
  let tAviso = 0;
  function aviso(txt) { const a = $('aviso'); a.textContent = txt; a.classList.add('ver'); tAviso = performance.now() + 2600; }
  const nomDe = (clase) => (D.EDIF[clase] || D.SOL[clase] || D.DRON[clase]).nombre.toLowerCase();
  function sucesos() {
    for (const d of m.efectos) {
      const veo = (x, y) => todo || mios().some((q) => Math.abs(q.x - x) < 16 && Math.abs(q.y - y) < 16);
      if (d.tipo === 'tiro') { if (d.j === YO || veo(d.x1, d.y1) || veo(d.x2, d.y2)) { const fallo = d.da ? 0 : 0.5; fx.push({ k: 'tiro', x1: d.x1, y1: d.y1, x2: d.x2 + (Math.random() - 0.5) * fallo, y2: d.y2 + (Math.random() - 0.5) * fallo, da: d.da, gordo: d.arma === 'rifle' || d.arma === 'escopeta', t0: tiempo, dur: d.arma === 'rifle' ? 0.45 : 0.28 }); } }
      else if (d.tipo === 'baja') { if (d.j === YO) aviso('Baja: ' + nomDe(d.clase)); if (d.j === YO || veo(d.x, d.y)) marcas.push({ x: d.x, y: d.y, t0: tiempo, dur: 40 }); }
      else if (d.tipo === 'hallado' && d.j === YO) { aviso(d.clase === 'centro' ? '¡Centro de operaciones localizado! Clic derecho sobre él para volarlo' : 'Descubierto: ' + (d.clase === 'falsa' ? 'antena' : nomDe(d.clase))); fx.push({ k: 'anillo', x: d.x, y: d.y, r: 4, c: '#c2552d', t0: tiempo, dur: 1.4 }); }
      else if (d.tipo === 'cargando') { if (d.j !== YO) aviso('¡Te están poniendo una carga!'); fx.push({ k: 'anillo', x: d.x, y: d.y, r: 3, c: '#c2552d', t0: tiempo, dur: 1 }); }
      else if (d.tipo === 'volado') { fx.push({ k: 'boom', x: d.x, y: d.y, t0: tiempo, dur: 1.6 }); aviso((d.de === YO ? 'Has perdido: ' : 'Volado: ') + nomDe(d.clase)); }
    }
    m.efectos.length = 0; if (marcas.length > 60) marcas.splice(0, marcas.length - 60);
  }
  const mios = () => m.ents.filter((e) => e.j === YO && e.clase === 'sol');
  const equipos = () => { const o = new Map(); for (const e of m.ents) if (e.j === YO && e.clase === 'sol') { if (!o.has(e.eq)) o.set(e.eq, []); o.get(e.eq).push(e); } return o; };

  // ---------- panel ----------
  function ponVision(v) { vision = v; for (const b of document.querySelectorAll('#visiones button')) b.classList.toggle('on', b.dataset.v === v); $('notaVision').textContent = VISIONES.find((x) => x[0] === v)[2]; }
  VISIONES.forEach(([v, n], i) => { const b = document.createElement('button'); b.type = 'button'; b.dataset.v = v; b.innerHTML = '<span>' + n + '</span><kbd>' + (i + 1) + '</kbd>'; b.addEventListener('click', () => ponVision(v)); $('visiones').appendChild(b); });
  const ir = (rol, esc, s) => { location.search = '?rol=' + rol + '&esc=' + esc + '&s=' + s; };
  $('semilla').textContent = m.semilla + ' · ' + escenario; $('semilla').addEventListener('click', (ev) => { ev.preventDefault(); ir(D.ROL[YO].clave, escenario, Math.floor(Math.random() * 99999) + 1); });
  $('rol').textContent = D.ROL[YO].nombre; $('rolQue').textContent = YO === 0 ? 'Encuentra el centro de operaciones enemigo y vuélalo antes de que amanezca.' : 'Que tu centro siga en pie cuando amanezca.';
  $('cambia').addEventListener('click', () => { $('menu').hidden = false; });
  { // el menú de inicio: primero se elige el papel
    let esc = escenario; const cajaR = $('menuRoles'), cajaE = $('menuEsc');
    D.ROL.forEach((r) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'rol'; b.innerHTML = '<b>' + r.nombre + '</b><span>' + r.que + '</span>'; b.addEventListener('click', () => ir(r.clave, esc, Math.floor(Math.random() * 99999) + 1)); cajaR.appendChild(b); });
    for (const k in D.ESCENARIO) { const b = document.createElement('button'); b.type = 'button'; b.dataset.e = k; b.textContent = D.ESCENARIO[k]; b.classList.toggle('on', k === esc); b.addEventListener('click', () => { esc = k; for (const q of cajaE.children) q.classList.toggle('on', q.dataset.e === k); }); cajaE.appendChild(b); }
    $('menu').hidden = elegido; $('menuCierra').hidden = !elegido; $('menuCierra').addEventListener('click', () => { $('menu').hidden = true; });
  }
  const mmss = (ticks) => { const s = Math.ceil(ticks / 20); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const orden = (o) => { if (sel.size) D.orden(m, Object.assign({ j: YO, eqs: [...sel] }, o)); };
  const seleccionados = () => mios().filter((e) => sel.has(e.eq));
  function alterna(que) { const us = seleccionados(); if (!us.length) return; const v = !us.every((u) => u[que]); orden({ t: 'modo', [que]: v }); aviso(que === 'sigilo' ? (v ? 'Sigilo: despacio y por lo tapado' : 'Paso normal') : v ? 'Fuego libre' : 'Fuego contenido: solo de cerca o si les dan'); }
  $('bSigilo').addEventListener('click', () => alterna('sigilo')); $('bFuego').addEventListener('click', () => alterna('fuego')); $('bAlto').addEventListener('click', () => orden({ t: 'detener' }));
  $('equipos').addEventListener('click', (ev) => { const b = ev.target.closest('[data-eq]'); if (!b) return; const eq = Number(b.dataset.eq); if (!ev.shiftKey) sel.clear(); sel.add(eq); const us = mios().filter((e) => e.eq === eq); if (us.length && !ev.shiftKey) { cam.x = us[0].x; cam.y = us[0].y; } firmaP = ''; });
  $('otra').addEventListener('click', () => ir(D.ROL[YO].clave, escenario, Math.floor(Math.random() * 99999) + 1)); $('otraRol').addEventListener('click', () => ir(D.ROL[1 - YO].clave, escenario, m.semilla));
  let firmaP = '';
  function panel() {
    const noche = D.luz(m) < 0.5; $('hora').textContent = D.hora(m) + (noche ? ' · noche' : ' · día'); $('amanece').textContent = mmss(D.faltaAmanecer(m));
    $('pers').textContent = m.jug[YO].personas + ' / ' + D.ECON.tope[YO] + ' · bajas ' + m.jug[YO].bajas;
    // equipos: una línea por equipo; los seleccionados, con sus miembros
    const eqs = equipos(); for (const eq of [...sel]) if (!eqs.has(eq)) sel.delete(eq);
    let h = ''; for (const [eq, us] of eqs) { const on = sel.has(eq), visto = us.some((u) => m.visto[1 - YO].has(u.id));
      h += '<div class="eq' + (on ? ' on' : '') + '" data-eq="' + eq + '"><b>Equipo ' + eq + '</b> · ' + us.length + (us[0].sigilo ? ' · sigilo' : '') + (us[0].fuego ? '' : ' · fuego contenido') + (us.some((u) => u.supr > 0) ? ' · <i>bajo fuego</i>' : '') + (visto ? ' · <i>localizado</i>' : '');
      if (on) for (const u of us) h += '<div class="mi"><span>' + D.SOL[u.tipo].nombre + '</span><span class="tenue">firma ' + Math.round(Math.min(1.4, u.firma) * 100) + ' %</span><i><b style="width:' + Math.round((u.vida / u.vidaMax) * 100) + '%"' + (u.vida / u.vidaMax < 0.35 ? ' class="mal"' : '') + '></b></i></div>';
      h += '</div>'; }
    if (!h) h = '<div class="tenue">No te queda nadie en el campo.</div>';
    if (h !== firmaP) { firmaP = h; $('equipos').innerHTML = h; }
    const us = seleccionados(); $('ordenes').hidden = !us.length; if (us.length) { $('bSigilo').classList.toggle('on', us.every((u) => u.sigilo)); $('bFuego').classList.toggle('on', !us.every((u) => u.fuego)); }
    let b = 'Pasa el cursor por el sector.';
    if (raton.dentro) {
      const x = cam.x + (raton.x - cw / 2) / cam.z, y = cam.y + (raton.y - ch / 2) / cam.z; let mejor = null, md = 1.1;
      for (const e of visibles) { const d = Math.hypot(e.x - x, e.y - y) / (e.clase === 'edif' ? 1.6 : 1); if (d < md) { md = d; mejor = e; } }
      for (const t of mapa.tubos) for (const q of [t.a, t.b]) if (Math.hypot(q.x - x, q.y - y) < md) { md = Math.hypot(q.x - x, q.y - y); mejor = { clase: 'edif', tipo: 'boca', j: -1 }; }
      if (mejor) { const tipo = mejor.j === 1 - YO && mejor.tipo === 'falsa' && !todo ? 'antena' : mejor.tipo, d = (mejor.clase === 'sol' ? D.SOL : mejor.clase === 'dron' ? D.DRON : D.EDIF)[tipo]; b = '<b style="color:' + (mejor.j === YO ? 'var(--yo)' : mejor.j === 1 - YO ? 'var(--rival)' : 'var(--tinta)') + '">' + d.nombre + (mejor.j === YO ? ' · tuyo' : mejor.j === 1 - YO ? ' · rival' : '') + '</b>' + d.que + (mejor.clase === 'sol' ? '<br>' + D.ARMA[d.arma].nombre + (mejor.j === YO ? ' · equipo ' + mejor.eq : '') : ''); }
      else if (x >= 0 && y >= 0 && x < N && y < N) { const t = mapa.terreno[Math.floor(y) * N + Math.floor(x)]; b = '<b style="color:var(--tinta)">' + D.TERRENO[t] + '</b>' + (mapa.paso[Math.floor(y) * N + Math.floor(x)] ? 'se pasa a pie' : 'no se pasa') + ' · cobertura ' + Math.round(D.COBERTURA[t] * 100) + ' %'; }
    }
    if ($('bajo').innerHTML !== b) $('bajo').innerHTML = b;
    if (m.fin && $('fin').hidden) { const gano = m.fin.gana === YO, por = { centro: 'El centro de operaciones ha volado.', amanecer: 'Ha amanecido y el centro sigue en pie.', 'sin asalto': 'Al atacante no le queda nadie que pueda poner la carga.' }[m.fin.motivo]; $('finT').textContent = gano ? 'Victoria' : 'Derrota'; $('finQ').textContent = por + ' Bajas: ' + m.jug[YO].bajas + ' tuyas, ' + m.jug[1 - YO].bajas + ' del rival.'; $('fin').hidden = false; }
  }

  // ---------- entrada ----------
  const teclas = new Set();
  function medir() { dpr = Math.min(2, window.devicePixelRatio || 1); const r = lienzo.getBoundingClientRect(); cw = Math.max(1, r.width); ch = Math.max(1, r.height); lienzo.width = Math.round(cw * dpr); lienzo.height = Math.round(ch * dpr); }
  const limita = () => { cam.z = Math.max(5, Math.min(44, cam.z)); cam.x = Math.max(0, Math.min(N, cam.x)); cam.y = Math.max(0, Math.min(N, cam.y)); };
  const aMundo = (px, py) => ({ x: cam.x + (px - cw / 2) / cam.z, y: cam.y + (py - ch / 2) / cam.z });
  addEventListener('resize', medir);
  addEventListener('keydown', (ev) => {
    if (ev.metaKey || ev.ctrlKey) return; teclas.add(ev.code);
    if (/^Digit[1-4]$/.test(ev.code)) ponVision(VISIONES[Number(ev.code.slice(5)) - 1][0]);
    else if (ev.code === 'KeyH') { cam.x = mapa.bases[YO].x; cam.y = mapa.bases[YO].y; }
    else if (ev.code === 'KeyC') alterna('sigilo'); else if (ev.code === 'KeyF') alterna('fuego'); else if (ev.code === 'KeyX') orden({ t: 'detener' });
    else if (ev.code === 'Escape') { sel.clear(); firmaP = ''; } else if (ev.code === 'KeyP') { pausa = !pausa; aviso(pausa ? 'Pausa' : 'Sigue'); }
    else if (ev.code === 'Tab') { ev.preventDefault(); const ids = [...equipos().keys()]; if (ids.length) { const i = ids.indexOf([...sel][0]); sel.clear(); const eq = ids[(i + 1) % ids.length]; sel.add(eq); const u = mios().find((e) => e.eq === eq); cam.x = u.x; cam.y = u.y; firmaP = ''; } }
    if (ev.code.startsWith('Arrow') || ev.code === 'Space') ev.preventDefault();
  });
  addEventListener('keyup', (ev) => teclas.delete(ev.code)); addEventListener('blur', () => teclas.clear());
  let arrastre = null;
  lienzo.addEventListener('pointerdown', (ev) => {
    const r = lienzo.getBoundingClientRect(), px = ev.clientX - r.left, py = ev.clientY - r.top; lienzo.setPointerCapture(ev.pointerId);
    if (ev.button === 1 || (ev.button === 0 && teclas.has('Space'))) arrastre = { x: ev.clientX, y: ev.clientY, cx: cam.x, cy: cam.y }; // desplazar: botón central o Espacio + arrastrar
    else if (ev.button === 0) caja = { x0: px, y0: py, x1: px, y1: py, mayus: ev.shiftKey };
    else if (ev.button === 2 && sel.size && !m.fin) { // la orden: sobre un edificio enemigo descubierto, volarlo; si no, ir allí
      const p = aMundo(px, py); let ob = null, md = 1.8; for (const e of m.ents) if (e.clase === 'edif' && e.j !== YO && m.conocido[YO].has(e.id)) { const d = Math.hypot(e.x - p.x, e.y - p.y); if (d < md) { md = d; ob = e; } }
      if (ob) { if (seleccionados().some((u) => D.SOL[u.tipo].carga)) { orden({ t: 'volar', obj: ob.id }); fx.push({ k: 'anillo', x: ob.x, y: ob.y, r: 2.5, c: '#c2552d', t0: tiempo, dur: 0.7 }); } else aviso('En ese equipo nadie lleva carga: hace falta un asaltante o un zapador'); }
      else if (p.x >= 0 && p.y >= 0 && p.x < N && p.y < N) { if (!m.paso[Math.floor(p.y) * N + Math.floor(p.x)]) aviso('Ahí no se puede pisar: irán a lo más cercano'); orden({ t: 'mover', x: p.x, y: p.y }); fx.push({ k: 'anillo', x: p.x, y: p.y, r: 1.2, c: '#1f6f78', t0: tiempo, dur: 0.5 }); }
    }
  });
  lienzo.addEventListener('pointermove', (ev) => { const r = lienzo.getBoundingClientRect(); raton.x = ev.clientX - r.left; raton.y = ev.clientY - r.top; raton.dentro = true; if (arrastre) { cam.x = arrastre.cx - (ev.clientX - arrastre.x) / cam.z; cam.y = arrastre.cy - (ev.clientY - arrastre.y) / cam.z; limita(); } if (caja) { caja.x1 = raton.x; caja.y1 = raton.y; } });
  lienzo.addEventListener('pointerup', () => {
    arrastre = null; if (!caja) return; const c = caja; caja = null; if (!c.mayus) sel.clear(); firmaP = '';
    if (Math.abs(c.x1 - c.x0) < 6 && Math.abs(c.y1 - c.y0) < 6) { const p = aMundo(c.x1, c.y1); let mejor = null, md = 1.4; for (const e of mios()) { const d = Math.hypot(e.x - p.x, e.y - p.y); if (d < md) { md = d; mejor = e; } } if (mejor) sel.add(mejor.eq); } // un clic: el equipo del soldado tocado
    else { const a = aMundo(Math.min(c.x0, c.x1), Math.min(c.y0, c.y1)), b = aMundo(Math.max(c.x0, c.x1), Math.max(c.y0, c.y1)); for (const e of mios()) if (e.x >= a.x && e.x <= b.x && e.y >= a.y && e.y <= b.y) sel.add(e.eq); } // una caja: los equipos con alguien dentro
  });
  lienzo.addEventListener('pointercancel', () => { arrastre = null; caja = null; }); lienzo.addEventListener('pointerleave', () => { raton.dentro = false; });
  lienzo.addEventListener('contextmenu', (ev) => ev.preventDefault());
  lienzo.addEventListener('wheel', (ev) => { ev.preventDefault(); const r = lienzo.getBoundingClientRect(), px = ev.clientX - r.left - cw / 2, py = ev.clientY - r.top - ch / 2, wx = cam.x + px / cam.z, wy = cam.y + py / cam.z; cam.z *= Math.exp(-ev.deltaY * 0.0012); limita(); cam.x = wx - px / cam.z; cam.y = wy - py / cam.z; limita(); }, { passive: false });

  // ---------- bucle ----------
  let antes = performance.now(), deuda = 0, tSim = 0, nSim = 0;
  function cuadro(ahora) {
    const dt = Math.min(100, ahora - antes); antes = ahora; tiempo += dt / 1000;
    const v = (dt / 1000) * 26 * (14 / cam.z + 0.4);
    if (teclas.has('KeyW') || teclas.has('ArrowUp')) cam.y -= v; if (teclas.has('KeyS') || teclas.has('ArrowDown')) cam.y += v; if (teclas.has('KeyA') || teclas.has('ArrowLeft')) cam.x -= v; if (teclas.has('KeyD') || teclas.has('ArrowRight')) cam.x += v; limita();
    if (!pausa && $('menu').hidden) { deuda += dt; let n = 0; while (deuda >= 50 && n < 4) { const t0 = performance.now(); D.tick(m); tSim += performance.now() - t0; nSim++; deuda -= 50; n++; } if (deuda > 200) deuda = 0; }
    sucesos(); dibujar(); cuadros++;
    if (ahora - tSeg >= 1000) { $('rend').textContent = cuadros + ' cuadros/s · dibujo ' + (tDib / Math.max(1, nDib)).toFixed(2).replace('.', ',') + ' ms · simulación ' + (tSim / Math.max(1, nSim)).toFixed(3).replace('.', ',') + ' ms/tick'; cuadros = 0; tDib = 0; nDib = 0; tSim = 0; nSim = 0; tSeg = ahora; panel(); }
    else if (cuadros % 6 === 0) panel();
    if (tAviso && ahora > tAviso) { $('aviso').classList.remove('ver'); tAviso = 0; }
    requestAnimationFrame(cuadro);
  }
  medir(); ponVision('optica'); panel(); requestAnimationFrame(cuadro);
})();
