// drone.warfare — la vista: cámara, las cuatro visiones (con día y noche), el marco de transmisión y el panel.
(function () {
  const D = globalThis.D, T = D.T, TAU = Math.PI * 2, PX = 14; // PX: píxeles por celda en las capas de terreno ya pintadas
  const $ = (id) => document.getElementById(id);
  const lienzo = $('lienzo'), ctx = lienzo.getContext('2d');
  const par = new URLSearchParams(location.search);
  const semilla = Number(par.get('s')) || Math.floor(Math.random() * 99999) + 1;
  const escenario = par.get('esc') === 'urbano' ? 'urbano' : 'mixto', YO = par.get('rol') === 'defensa' ? 1 : 0, elegido = par.has('rol'); // el bando 0 ataca; el 1 defiende
  const m = (D.mundo = D.crearMundo(semilla, { escenario, ia: [YO !== 0, YO !== 1], t: par.has('hora') ? (((Number(par.get('hora')) - D.ECON.hora0 + 48) % 24) * D.ECON.dia) / 24 : undefined })), N = m.N, mapa = m.mapa, mio = (j) => (j === YO ? 0 : j === 1 - YO ? 1 : null);
  const cam = (D.cam = { x: mapa.bases[YO].x + Math.cos(mapa.bases[YO].frente) * 7, y: mapa.bases[YO].y + Math.sin(mapa.bases[YO].frente) * 7, z: 15 });
  let cw = 0, ch = 0, dpr = 1, vision = 'optica', raton = { x: -1, y: -1, dentro: false };
  const todo = par.get('todo') === '1', sel = new Set(), fx = [], marcas = []; // todo: ver también lo que no se ha descubierto (para probar); sel: escuadrones seleccionados (por su id interno, eq)
  let giro = null; // tras ordenar ir (o con T): { eqs, x, y, t0 } — un clic cerca fija hacia dónde se orienta el escuadrón
  const enGiro = (p) => { if (!giro || tiempo - giro.t0 > 6 || !giro.eqs.every((q) => sel.has(q))) { giro = null; return false; } const d = Math.hypot(p.x - giro.x, p.y - giro.y); return d > 0.8 && d < 9; };
  let caja = null, pausa = false, selDron = 0; // selDron: el dron de reconocimiento elegido
  const VISIONES = [
    ['optica', 'Óptica', 'A simple vista. De día se ve lo que no está bajo cobertura; de noche, solo lo cercano a los tuyos.'],
    ['nocturna', 'Nocturna', 'Intensificador de luz: todo en verde. No distingue bandos; los tuyos llevan una baliza que parpadea.'],
    ['termica', 'Térmica', 'Calor en blanco: cuerpos y motores brillan también bajo los árboles. No distingue bandos.'],
    ['espectro', 'Espectro', 'Lo que emite por radio: antenas, drones de radio e inhibidores. La fibra y el soldado callado no aparecen. Las líneas amarillas son rumbos: en esa dirección (con algo de error) hay una antena, un repetidor o un inhibidor del rival emitiendo.'],
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
    for (const q of mapa.muretes) { // obstáculos bajos: escombro, coche calcinado, sacos, murete de piedra
      const x = X(q.x), y = X(q.y); c.strokeStyle = P.tinta; c.lineWidth = 1.1;
      if (q.tipo === 'coche') { c.save(); c.translate(x + PX / 2, y + PX / 2); c.rotate(q.ang); c.fillStyle = P.col('metal'); c.beginPath(); c.rect(-PX * 0.46, -PX * 0.27, PX * 0.92, PX * 0.54); c.fill(); c.stroke(); c.fillStyle = P.col('trinchera'); c.fillRect(-PX * 0.2, -PX * 0.2, PX * 0.34, PX * 0.4); c.restore(); }
      else if (q.tipo === 'piedra') { c.fillStyle = P.col('ruina'); c.fillRect(x, y + PX * 0.22, PX, PX * 0.56); c.strokeRect(x + 0.5, y + PX * 0.22 + 0.5, PX - 1, PX * 0.56 - 1); c.fillStyle = P.col('ruinaS'); c.fillRect(x + 3, y + PX * 0.38, 3, 3); c.fillRect(x + 8, y + PX * 0.45, 3, 3); }
      else if (q.tipo === 'sacos') { c.fillStyle = P.col('tierra'); for (const [dx, dy] of [[0.25, 0.3], [0.62, 0.3], [0.44, 0.62], [0.78, 0.66], [0.2, 0.68]]) { c.beginPath(); c.ellipse(x + PX * dx, y + PX * dy, PX * 0.2, PX * 0.13, 0, 0, TAU); c.fill(); c.stroke(); } }
      else { c.fillStyle = P.col('ruina'); c.beginPath(); c.moveTo(x + PX * 0.1, y + PX * 0.7); c.lineTo(x + PX * 0.3, y + PX * 0.2); c.lineTo(x + PX * 0.62, y + PX * 0.12); c.lineTo(x + PX * 0.92, y + PX * 0.55); c.lineTo(x + PX * 0.7, y + PX * 0.9); c.lineTo(x + PX * 0.28, y + PX * 0.92); c.closePath(); c.fill(); c.stroke(); c.fillStyle = P.col('ruinaS'); c.fillRect(x + PX * 0.4, y + PX * 0.4, 3, 3); }
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
  let tiempo = 0, tDib = 0, nDib = 0, cuadros = 0, tSeg = 0; const visibles = [], COB = { pesada: '#3f8f3a', ligera: '#d6a21e', ninguna: '#9aa0a6', expuesto: '#c2552d' };
  let lanza = null; // 'granada' | 'humo' | 'fpvRadio' | 'fpvFibra': esperando a que se elija dónde
  const esFpv = (k) => k === 'fpvRadio' || k === 'fpvFibra', taller = () => m.ents.find((e) => e.clase === 'edif' && e.j === YO && e.tipo === 'taller');
  // Hasta dónde llegan mis drones: el enlace de radio (antenas y observadores) o el carrete de fibra desde el taller.
  function zona(k, z, ox, oy, col) { ctx.strokeStyle = col; ctx.lineWidth = 1.2; ctx.globalAlpha = 0.55; ctx.setLineDash([8, 6]); if (k === 'fpvFibra') { const t = taller(); if (t) { ctx.beginPath(); ctx.arc(ox + t.x * z, oy + t.y * z, D.ECON.fibraAlc * z, 0, TAU); ctx.stroke(); } } else for (const f of D.enlaces(m, YO)) { ctx.beginPath(); ctx.arc(ox + f.x * z, oy + f.y * z, f.r * z, 0, TAU); ctx.stroke(); } ctx.setLineDash([]); ctx.globalAlpha = 1; }
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
    if (YO === 0 || todo || m.caido) { const q = m.extraccion, x = ox + q.x * z, y = oy + q.y * z; ctx.strokeStyle = COLYO; ctx.fillStyle = COLYO; ctx.lineWidth = m.caido ? 2.2 : 1.2; ctx.globalAlpha = m.caido ? 0.9 : 0.5; ctx.setLineDash([10, 6]); ctx.beginPath(); ctx.arc(x, y, q.r * z, 0, TAU); ctx.stroke(); ctx.setLineDash([]); ctx.font = '10px ui-monospace, Menlo, Consolas, monospace'; ctx.textAlign = 'center'; ctx.fillText('EXTRACCIÓN', x, y - q.r * z - 5); ctx.textAlign = 'left'; ctx.globalAlpha = 1; } // la zona de extracción (el defensor solo la ve cuando ya le han volado el centro)
    for (const h of m.hilos) { if (!(h.visto[YO] || todo) || h.pts.length < 2) continue; const mia = h.j === YO; ctx.strokeStyle = mia ? COLYO : '#c2552d'; ctx.globalAlpha = mia ? 0.3 : 0.85; ctx.lineWidth = mia ? 1 : 1.4; if (!mia) ctx.setLineDash([3, 3]); ctx.beginPath(); h.pts.forEach((p, i) => (i ? ctx.lineTo(ox + p[0] * z, oy + p[1] * z) : ctx.moveTo(ox + p[0] * z, oy + p[1] * z))); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1; } // hilos de fibra en el suelo: los míos, tenues; los del rival que he visto, en naranja
    for (const e of mios) { if (e.clase !== 'sol' || !sel.has(e.eq)) continue; const x = ox + e.x * z, y = oy + e.y * z;
      if (e.ruta && e.ri < e.ruta.length) { ctx.strokeStyle = COLYO; ctx.globalAlpha = 0.45; ctx.lineWidth = 1; ctx.setLineDash(e.sigilo ? [2, 5] : [6, 5]); ctx.beginPath(); ctx.moveTo(x, y); for (let i = e.ri; i < e.ruta.length; i++) ctx.lineTo(ox + e.ruta[i][0] * z, oy + e.ruta[i][1] * z); ctx.stroke(); ctx.setLineDash([]); const f = e.ruta[e.ruta.length - 1]; ctx.beginPath(); ctx.arc(ox + f[0] * z, oy + f[1] * z, 2.5, 0, TAU); ctx.fillStyle = COLYO; ctx.fill(); ctx.globalAlpha = 1; }
      ctx.strokeStyle = COLYO; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, sS * 6.5, 0, TAU); ctx.stroke(); }
    for (const e of visibles) { if (e.clase !== 'sol' || fuera(e.x, e.y, 2)) continue; const x = ox + e.x * z, y = oy + e.y * z;
      D.fig.soldado(ctx, P, x, y, e.ang, e.tipo, mio(e.j), sS, { anda: e.movio, oculto: e.j === YO && e.firma < 0.35 });
      if (e.vida < e.vidaMax || (e.j === YO && sel.has(e.eq))) { const w = sS * 11, f = e.vida / e.vidaMax; ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(x - w / 2, y - sS * 9, w, 2.5); ctx.fillStyle = f < 0.35 ? '#c2552d' : modo === 'dia' ? '#4d7a38' : '#9be08a'; ctx.fillRect(x - w / 2, y - sS * 9, w * f, 2.5); }
      { const ns = D.nivelSupr(e); if (ns || e.orden === 'retirada') { ctx.strokeStyle = ns === 2 ? '#c2552d' : COLYO; ctx.lineWidth = ns === 2 ? 1.8 : 1.2; ctx.beginPath(); const yy = y + sS * 7; if (e.orden === 'retirada') { ctx.moveTo(x - 5, yy + 2); ctx.lineTo(x + 5, yy + 2); ctx.moveTo(x - 5, yy + 2); ctx.lineTo(x - 2, yy - 1); ctx.moveTo(x - 5, yy + 2); ctx.lineTo(x - 2, yy + 5); } else { ctx.moveTo(x - 4, yy); ctx.lineTo(x, yy + 3); ctx.lineTo(x + 4, yy); if (ns === 2) { ctx.moveTo(x - 4, yy + 4); ctx.lineTo(x, yy + 7); ctx.lineTo(x + 4, yy + 4); } } ctx.stroke(); } } // agachado: un galón; clavado: dos, en naranja; en retirada: una flecha
      if (e.j === YO && sel.has(e.eq) && !e.movio) { const v = D.cobFrente(m, e.x, e.y, e.x + Math.cos(e.mira) * 20, e.y + Math.sin(e.mira) * 20); ctx.fillStyle = COB[D.cobNivel(v)]; ctx.strokeStyle = P.tinta; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x + sS * 6, y - sS * 6, 3, 0, TAU); ctx.fill(); ctx.stroke(); } // su cobertura de cara a donde mira
      if (e.canal > 0) { ctx.strokeStyle = '#c2552d'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(x, y, sS * 8, -Math.PI / 2, -Math.PI / 2 + TAU * (e.canal / D.ECON.cargaTicks)); ctx.stroke(); } // poniendo la carga
    }
    ctx.globalAlpha = modo === 'termica' ? 0.45 : modo === 'espectro' ? 0.5 : 0.93; ctx.drawImage(L.copas, ox, oy, lado, lado); ctx.globalAlpha = 1;
    { const g = new Map(); for (const e of mios) if (e.clase === 'sol') { let q = g.get(e.eq); if (!q) g.set(e.eq, (q = { x: 0, y: 1e9, n: 0, num: e.num })); q.x += e.x; q.y = Math.min(q.y, e.y); q.n++; } // el número de cada escuadrón mío, encima del grupo
      ctx.font = 'bold 11px ui-monospace, Menlo, Consolas, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; for (const [eq, q] of g) { const x = ox + (q.x / q.n) * z, y = oy + q.y * z - Math.max(16, z * 1.1), on = sel.has(eq); ctx.fillStyle = on ? COLYO : 'rgba(255,255,255,0.9)'; ctx.strokeStyle = COLYO; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.rect(x - 8, y - 8, 16, 16); ctx.fill(); ctx.stroke(); ctx.fillStyle = on ? '#fff' : COLYO; ctx.fillText(String(q.num), x, y + 0.5); } ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; } // las copas tapan lo de debajo (a la térmica, menos)
    for (const e of visibles) if (e.clase === 'dron' && e.alt && !fuera(e.x, e.y, 3)) D.fig.dron(ctx, P, ox + e.x * z, oy + e.y * z, e.ang, e.tipo, mio(e.j), sD, e.alt * z * 0.6);
    for (const e of visibles) { if (e.clase !== 'dron' || e.j !== YO || e.estado === 'posado' || fuera(e.x, e.y, 3)) continue; const x = ox + e.x * z, y = oy + e.y * z, f = e.bat / e.batMax, w = sD * 12; // mis drones: batería y, si está elegido, su órbita
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(x - w / 2, y + sD * 9, w, 2.5); ctx.fillStyle = f < 0.25 ? '#c2552d' : COLYO; ctx.fillRect(x - w / 2, y + sD * 9, w * f, 2.5);
      if (e.id === selDron) { ctx.strokeStyle = COLYO; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, sD * 9, 0, TAU); ctx.stroke(); if (e.orbita) { const o = e.orbita; ctx.globalAlpha = 0.5; ctx.setLineDash([4, 5]); ctx.beginPath(); ctx.ellipse(ox + o.x * z, oy + o.y * z, o.r * z, o.r * z * 0.7, 0, 0, TAU); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ox + o.x * z, oy + o.y * z); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1; } } }
    if (selDron && !lanza) zona('recon', z, ox, oy, COLYO); else if (esFpv(lanza)) { zona(lanza, z, ox, oy, COLYO); if (raton.dentro) { const p = { x: cam.x + (raton.x - cw / 2) / z, y: cam.y + (raton.y - ch / 2) / z }, t = taller(), bien = !!t && D.alcanza(m, YO, lanza, p.x, p.y, t); ctx.strokeStyle = bien ? COLYO : '#c2552d'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.arc(raton.x, raton.y, D.ECON.fpvRadio * z, 0, TAU); ctx.stroke(); ctx.setLineDash([]); } }
    // disparos, explosiones y avisos sobre el mapa
    for (let i = fx.length - 1; i >= 0; i--) { const q = fx[i], k = (tiempo - q.t0) / q.dur; if (k >= 1) { fx.splice(i, 1); continue; }
      if (q.k === 'tiro') { const x1 = ox + q.x1 * z, y1 = oy + q.y1 * z, x2 = ox + q.x2 * z, y2 = oy + q.y2 * z, a = Math.min(1, k * 1.6), b = Math.max(0, a - 0.35); ctx.strokeStyle = modo === 'dia' ? '#b8862b' : '#ffe9a8'; ctx.globalAlpha = 0.9 * (1 - k); ctx.lineWidth = q.gordo ? 1.8 : 1.1; ctx.beginPath(); ctx.moveTo(x1 + (x2 - x1) * b, y1 + (y2 - y1) * b); ctx.lineTo(x1 + (x2 - x1) * a, y1 + (y2 - y1) * a); ctx.stroke(); if (k < 0.25) { ctx.fillStyle = '#ffe9a8'; ctx.beginPath(); ctx.arc(x1, y1, 2.5, 0, TAU); ctx.fill(); } if (k > 0.6) { ctx.fillStyle = q.da ? '#c2552d' : P.tinta; ctx.globalAlpha = (1 - k) * 2; ctx.beginPath(); ctx.arc(x2, y2, q.da ? 2.5 : 1.5, 0, TAU); ctx.fill(); } }
      else if (q.k === 'anillo') { ctx.strokeStyle = q.c; ctx.globalAlpha = 1 - k; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(ox + q.x * z, oy + q.y * z, q.r * z * (0.2 + 0.8 * k), 0, TAU); ctx.stroke(); }
      else if (q.k === 'boom') { const x = ox + q.x * z, y = oy + q.y * z; ctx.globalAlpha = 1 - k; ctx.fillStyle = k < 0.15 ? '#fff3c4' : 'rgba(90,86,78,0.7)'; ctx.beginPath(); ctx.arc(x, y, z * (0.8 + k * 3.2) * (q.r || 1), 0, TAU); ctx.fill(); ctx.strokeStyle = P.tinta; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, z * (1 + k * 5) * (q.r || 1), 0, TAU); ctx.stroke(); }
      ctx.globalAlpha = 1; }
    for (const h of m.humos) { const x = ox + h.x * z, y = oy + h.y * z, k = Math.min(1, (h.hasta - m.t) / 100); ctx.globalAlpha = (modo === 'termica' ? 0.18 : 0.8) * k; ctx.fillStyle = modo === 'dia' ? '#d9dadb' : modo === 'nocturna' ? '#5fae6c' : modo === 'termica' ? '#555' : '#3a4654'; for (let i = 0; i < 7; i++) { const a = i * 0.9 + tiempo * 0.15, d = i ? h.r * 0.45 : 0; ctx.beginPath(); ctx.arc(x + Math.cos(a) * d * z, y + Math.sin(a) * d * z, h.r * z * 0.62, 0, TAU); ctx.fill(); } ctx.globalAlpha = 1; } // humo: tapa a la vista, no a la térmica
    for (const p of m.proy) { if (p.j !== YO && !todo && !cercaDeMios({ x: p.x2, y: p.y2 }, 14)) continue; const k = Math.min(1, (m.t - p.t0) / (p.t1 - p.t0)), x = ox + (p.x1 + (p.x2 - p.x1) * k) * z, y = oy + (p.y1 + (p.y2 - p.y1) * k) * z - Math.sin(k * Math.PI) * z * 1.2; ctx.fillStyle = P.tinta; ctx.beginPath(); ctx.arc(x, y, 2.5, 0, TAU); ctx.fill(); }
    if (raton.dentro && sel.size && !caja && !m.fin) { // la vista previa: dónde quedaría cada uno y lo cubierto que estaría (o, si se va a lanzar algo, hasta dónde llega)
      const p = { x: cam.x + (raton.x - cw / 2) / z, y: cam.y + (raton.y - ch / 2) / z }, us = mios.filter((e) => e.clase === 'sol' && sel.has(e.eq));
      if (esFpv(lanza)) { /* la zona del FPV ya está pintada */ } else if (lanza && us.length) { const alc = lanza === 'granada' ? D.ECON.granadaAlc : D.ECON.humoAlc; let md = 1e9; for (const u of us) md = Math.min(md, Math.hypot(u.x - p.x, u.y - p.y)); const bien = md <= alc; ctx.strokeStyle = bien ? COLYO : '#c2552d'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.arc(raton.x, raton.y, (lanza === 'granada' ? D.ECON.granadaRadio : D.ECON.humoRadio) * z, 0, TAU); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 0.35; for (const u of us) { ctx.beginPath(); ctx.arc(ox + u.x * z, oy + u.y * z, alc * z, 0, TAU); ctx.stroke(); } ctx.globalAlpha = 1; }
      else if (us.length && enGiro(p)) { const porEq = new Map(), gx = ox + giro.x * z, gy = oy + giro.y * z, am = D.haciaDonde(giro.x, giro.y, p.x, p.y), a = Math.atan2(p.y - giro.y, p.x - giro.x); for (const u of us) { if (!porEq.has(u.eq)) porEq.set(u.eq, []); porEq.get(u.eq).push(u); } // orientar: la flecha sale de donde van y sigue al cursor; los puntos, sus puestos mirando allí
        for (const g of porEq.values()) for (const q of D.puestos(m, giro.x, giro.y, g.length, am)) { const x = ox + q.x * z, y = oy + q.y * z; ctx.fillStyle = COB[D.cobNivel(q.cob)]; ctx.strokeStyle = P.tinta; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, Math.max(3.5, z * 0.22), 0, TAU); ctx.fill(); ctx.stroke(); }
        ctx.strokeStyle = COLYO; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(raton.x, raton.y); ctx.lineTo(raton.x - Math.cos(a - 0.4) * 9, raton.y - Math.sin(a - 0.4) * 9); ctx.moveTo(raton.x, raton.y); ctx.lineTo(raton.x - Math.cos(a + 0.4) * 9, raton.y - Math.sin(a + 0.4) * 9); ctx.stroke(); ctx.fillStyle = P.tinta; ctx.font = '10px ui-monospace, Menlo, Consolas, monospace'; ctx.fillText('clic: mirar hacia aquí', raton.x + 14, raton.y - 8); }
      else if (us.length && p.x >= 0 && p.y >= 0 && p.x < N && p.y < N) { const porEq = new Map(); for (const u of us) { if (!porEq.has(u.eq)) porEq.set(u.eq, []); porEq.get(u.eq).push(u); }
        for (const g of porEq.values()) { const cx = g.reduce((s, u) => s + u.x, 0) / g.length, cy = g.reduce((s, u) => s + u.y, 0) / g.length, am = D.amenaza(m, YO, p.x, p.y, cx, cy), ps = D.puestos(m, p.x, p.y, g.length, am);
          for (const q of ps) { const x = ox + q.x * z, y = oy + q.y * z; ctx.fillStyle = COB[D.cobNivel(q.cob)]; ctx.strokeStyle = P.tinta; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, Math.max(3.5, z * 0.22), 0, TAU); ctx.fill(); ctx.stroke(); }
          const a = Math.atan2(am.y - p.y, am.x - p.x); ctx.strokeStyle = am.visto ? '#c2552d' : COLYO; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(raton.x + Math.cos(a) * z * 1.2, raton.y + Math.sin(a) * z * 1.2); ctx.lineTo(raton.x + Math.cos(a) * z * 2.4, raton.y + Math.sin(a) * z * 2.4); ctx.lineTo(raton.x + Math.cos(a - 0.35) * z * 1.9, raton.y + Math.sin(a - 0.35) * z * 1.9); ctx.moveTo(raton.x + Math.cos(a) * z * 2.4, raton.y + Math.sin(a) * z * 2.4); ctx.lineTo(raton.x + Math.cos(a + 0.35) * z * 1.9, raton.y + Math.sin(a + 0.35) * z * 1.9); ctx.stroke(); } } // la flecha: de dónde se espera el peligro (naranja si hay enemigo a la vista)
    }
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
    for (const r of m.rumbo[YO]) { const x = ox + r.x * z, y = oy + r.y * z, L = 150 * z, E = D.ECON.rumboError; ctx.strokeStyle = '#ffd24a'; ctx.lineWidth = 1.6; ctx.globalAlpha = 0.9; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(r.ang) * L, y + Math.sin(r.ang) * L); ctx.stroke(); ctx.globalAlpha = 0.12; ctx.fillStyle = '#ffd24a'; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(r.ang - E) * L, y + Math.sin(r.ang - E) * L); ctx.lineTo(x + Math.cos(r.ang + E) * L, y + Math.sin(r.ang + E) * L); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1; } // rumbos: la línea y el abanico de su error
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
      else if (d.tipo === 'explosion') { if (veo(d.x, d.y)) fx.push({ k: 'boom', x: d.x, y: d.y, t0: tiempo, dur: 0.7, r: 0.45 }); }
      else if (d.tipo === 'noPuede' && d.j === YO) aviso({ recarga: 'Ese escuadrón aún está recargando', lejos: 'Demasiado lejos: acércate más', nadie: 'Nadie del escuadrón puede lanzar ahora', sinFpv: 'No queda ningún FPV de ese tipo posado', pilotos: 'No hay piloto libre: todos tienen un dron en el aire', noVisto: 'Ese blanco ya no está a la vista', enlace: 'Ahí no llega el enlace de radio', fibra: 'Ahí no llega el carrete de fibra' }[d.que]);
      else if (d.tipo === 'fpvBoom') { if (d.j === YO || veo(d.x, d.y)) fx.push({ k: 'boom', x: d.x, y: d.y, t0: tiempo, dur: 0.7, r: 0.4 }); }
      else if (d.tipo === 'perdido') { if (d.j === YO) aviso({ enlace: 'Dron perdido: se quedó sin enlace', bateria: 'Dron perdido: sin batería', inhibidor: 'FPV tumbado por un inhibidor enemigo', derribo: 'FPV derribado a tiros', fibra: 'FPV perdido: se acabó el carrete' }[d.que]); else if (veo(d.x, d.y) && (d.que === 'derribo' || d.que === 'inhibidor')) aviso(d.que === 'derribo' ? 'FPV enemigo derribado' : 'Tu inhibidor ha tumbado un FPV'); if (d.j === YO || veo(d.x, d.y)) fx.push({ k: 'anillo', x: d.x, y: d.y, r: 1.2, c: '#c2552d', t0: tiempo, dur: 0.6 }); }
      else if (d.tipo === 'fpvCerca' && d.j === YO) { aviso('¡FPV enemigo entrando!'); fx.push({ k: 'anillo', x: d.x, y: d.y, r: 2.5, c: '#c2552d', t0: tiempo, dur: 0.9 }); }
      else if (d.tipo === 'rumbo' && d.j === YO) aviso('Emisión del rival captada: mira el rumbo en Espectro (0)');
      else if (d.tipo === 'huida') aviso(YO === 0 ? '¡Centro destruido! Ahora, todos a la zona de extracción (R)' : 'Han volado el centro: que no salga nadie');
      else if (d.tipo === 'hilo' && d.j === YO) { aviso('Hilo de fibra en el suelo: síguelo hasta su taller'); fx.push({ k: 'anillo', x: d.x, y: d.y, r: 2, c: '#c2552d', t0: tiempo, dur: 1.2 }); }
      else if (d.tipo === 'vuelve' && d.j === YO) aviso('El dron de reconocimiento vuelve a recargar');
      else if (d.tipo === 'recortado' && d.j === YO) aviso('Más allá no hay enlace: se queda en el borde');
      else if (d.tipo === 'fabricado' && d.j === YO) aviso('Taller: listo un ' + nomDe(d.clase));
      else if (d.tipo === 'volado') { fx.push({ k: 'boom', x: d.x, y: d.y, t0: tiempo, dur: 1.6 }); aviso((d.de === YO ? 'Has perdido: ' : 'Volado: ') + nomDe(d.clase)); }
    }
    m.efectos.length = 0; if (marcas.length > 60) marcas.splice(0, marcas.length - 60);
  }
  const mios = () => m.ents.filter((e) => e.j === YO && e.clase === 'sol');
  const equipos = () => { const o = new Map(); for (const e of m.ents) if (e.j === YO && e.clase === 'sol') { if (!o.has(e.eq)) o.set(e.eq, []); o.get(e.eq).push(e); } return o; };

  // ---------- panel ----------
  function ponVision(v) { vision = v; for (const b of document.querySelectorAll('#visiones button')) b.classList.toggle('on', b.dataset.v === v); $('notaVision').textContent = VISIONES.find((x) => x[0] === v)[2]; }
  VISIONES.forEach(([v, n], i) => { const b = document.createElement('button'); b.type = 'button'; b.dataset.v = v; b.innerHTML = '<span>' + n + '</span><kbd>' + '7890'[i] + '</kbd>'; b.addEventListener('click', () => ponVision(v)); $('visiones').appendChild(b); });
  const ir = (rol, esc, s) => { location.search = '?rol=' + rol + '&esc=' + esc + '&s=' + s; };
  $('semilla').textContent = m.semilla + ' · ' + escenario; $('semilla').addEventListener('click', (ev) => { ev.preventDefault(); ir(D.ROL[YO].clave, escenario, Math.floor(Math.random() * 99999) + 1); });
  $('rol').textContent = D.ROL[YO].nombre; $('rolQue').textContent = YO === 0 ? 'Entrar, destruir y huir: encuentra el centro, vuélalo y saca a tu gente por la zona de extracción antes de las 22:00.' : 'Aguanta hasta las 22:00, cuando llegan tus refuerzos aéreos. Si te vuelan el centro, que no salga nadie.';
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
  const retirada = () => { if (sel.size) { orden({ t: 'retirada' }); aviso('Retirada: corren al barracón'); } }, apunta = (k) => { if (!sel.size) return; lanza = lanza === k ? null : k; aviso(lanza ? (k === 'granada' ? 'Granada: clic donde la quieres' : 'Humo: clic donde lo quieres') + ' · Esc cancela' : 'Cancelado'); };
  const orienta = () => { const us = seleccionados(); if (!us.length) return; giro = { eqs: [...sel], x: us.reduce((s, u) => s + u.x, 0) / us.length, y: us.reduce((s, u) => s + u.y, 0) / us.length, t0: tiempo }; lanza = null; aviso('Orientar: clic hacia donde deben mirar y cubrirse · Esc cancela'); };
  $('bOrienta').addEventListener('click', orienta); $('bRetira').addEventListener('click', retirada); $('bGranada').addEventListener('click', () => apunta('granada')); $('bHumo').addEventListener('click', () => apunta('humo'));
  $('bSigilo').addEventListener('click', () => alterna('sigilo')); $('bFuego').addEventListener('click', () => alterna('fuego')); $('bAlto').addEventListener('click', () => orden({ t: 'detener' }));
  $('equipos').addEventListener('click', (ev) => { const b = ev.target.closest('[data-eq]'); if (!b) return; selDron = 0; const eq = Number(b.dataset.eq); if (!ev.shiftKey) sel.clear(); sel.add(eq); const us = mios().filter((e) => e.eq === eq); if (us.length && !ev.shiftKey) { cam.x = us[0].x; cam.y = us[0].y; } firmaP = ''; });
  $('otra').addEventListener('click', () => ir(D.ROL[YO].clave, escenario, Math.floor(Math.random() * 99999) + 1)); $('otraRol').addEventListener('click', () => ir(D.ROL[1 - YO].clave, escenario, m.semilla));
  let firmaP = '', firmaD = '';
  const apuntaFpv = (k) => { lanza = lanza === k ? null : k; aviso(lanza ? D.DRON[k].nombre + ': clic en el blanco · Esc cancela' : 'Cancelado'); }, recoge = () => { if (selDron) { D.orden(m, { t: 'reconCasa', j: YO, id: selDron }); aviso('El dron vuelve al taller'); } };
  $('bFpvR').addEventListener('click', () => apuntaFpv('fpvRadio')); $('bFpvF').addEventListener('click', () => apuntaFpv('fpvFibra')); $('bCasa').addEventListener('click', recoge);
  $('drones').addEventListener('click', (ev) => { const b = ev.target.closest('[data-dron]'); if (!b) return; selDron = Number(b.dataset.dron); sel.clear(); firmaP = ''; const e = m.porId.get(selDron); if (e) { cam.x = e.x; cam.y = e.y; } });
  function panel() {
    const noche = D.luz(m) < 0.5; $('hora').textContent = D.hora(m) + (noche ? ' · noche' : ' · día'); $('amanece').textContent = mmss(D.faltaRefuerzos(m));
    $('pers').textContent = m.jug[YO].personas + ' / ' + D.ECON.tope[YO] + ' · bajas ' + m.jug[YO].bajas;
    { const nr = m.rumbo[YO].length, nh = m.hilos.filter((h) => h.j !== YO && h.visto[YO]).length, ne = D.emisores(m, YO).length; $('rastros').textContent = nr || nh ? [nr ? nr + (nr === 1 ? ' rumbo' : ' rumbos') : '', nh ? nh + (nh === 1 ? ' hilo' : ' hilos') : ''].filter(Boolean).join(' · ') : 'ninguno'; $('emito').textContent = ne ? 'sí · ' + ne + (ne === 1 ? ' fuente' : ' fuentes') : 'no, en silencio'; }
    // equipos: una línea por equipo; los seleccionados, con sus miembros
    const eqs = equipos(); for (const eq of [...sel]) if (!eqs.has(eq)) sel.delete(eq);
    let h = ''; for (const [eq, us] of eqs) { const on = sel.has(eq), visto = us.some((u) => m.visto[1 - YO].has(u.id));
      h += '<div class="eq' + (on ? ' on' : '') + '" data-eq="' + eq + '"><b>Escuadrón ' + us[0].num + '</b> · ' + us.length + (us[0].sigilo ? ' · sigilo' : '') + (us[0].fuego ? '' : ' · fuego contenido') + (us.some((u) => D.nivelSupr(u) === 2) ? ' · <i>clavado</i>' : us.some((u) => D.nivelSupr(u) === 1) ? ' · <i>bajo fuego</i>' : '') + (us[0].orden === 'retirada' ? ' · en retirada' : '') + (visto ? ' · <i>localizado</i>' : '');
      if (on) for (const u of us) h += '<div class="mi"><span>' + D.SOL[u.tipo].nombre + '</span><span class="tenue">firma ' + Math.round(Math.min(1.4, u.firma) * 100) + ' %</span><i><b style="width:' + Math.round((u.vida / u.vidaMax) * 100) + '%"' + (u.vida / u.vidaMax < 0.35 ? ' class="mal"' : '') + '></b></i></div>';
      h += '</div>'; }
    if (!h) h = '<div class="tenue">No te queda nadie en el campo.</div>';
    if (h !== firmaP) { firmaP = h; $('equipos').innerHTML = h; }
    { const ds = m.ents.filter((e) => e.clase === 'dron' && e.j === YO), posados = (t) => ds.filter((e) => e.tipo === t && e.estado === 'posado').length; if (selDron && !ds.some((e) => e.id === selDron)) selDron = 0;
      $('pil').textContent = D.pilotosLibres(m, YO) + ' de ' + m.jug[YO].pilotos; $('nFpvR').textContent = posados('fpvRadio'); $('nFpvF').textContent = posados('fpvFibra'); $('bFpvR').classList.toggle('on', lanza === 'fpvRadio'); $('bFpvF').classList.toggle('on', lanza === 'fpvFibra'); $('bCasa').hidden = !selDron;
      const EST = { posado: 'posado', vuelo: 'en el aire', vuelve: 'volviendo', carga: 'recargando' }; let hd = ''; for (const e of ds) if (e.tipo === 'recon' || (D.DRON[e.tipo].fpv && e.estado !== 'posado')) hd += '<div class="eq' + (e.id === selDron ? ' on' : '') + '"' + (e.tipo === 'recon' ? ' data-dron="' + e.id + '"' : '') + '><div class="mi"><span>' + (e.tipo === 'recon' ? 'Reconocimiento' : D.DRON[e.tipo].nombre) + ' · ' + EST[e.estado] + '</span><i><b style="width:' + Math.round((e.bat / e.batMax) * 100) + '%"' + (e.bat / e.batMax < 0.25 ? ' class="mal"' : '') + '></b></i></div></div>';
      if (!hd) hd = '<div class="tenue">Ningún dron en el aire.</div>'; if (hd !== firmaD) { firmaD = hd; $('drones').innerHTML = hd; } }
    const us = seleccionados(); $('ordenes').hidden = !us.length; if (us.length) { $('bSigilo').classList.toggle('on', us.every((u) => u.sigilo)); $('bFuego').classList.toggle('on', !us.every((u) => u.fuego)); $('bGranada').classList.toggle('on', lanza === 'granada'); $('bHumo').classList.toggle('on', lanza === 'humo');
      const cd = (k) => { const t = Math.min(...us.map((u) => u[k])) - m.t; return t > 0 ? Math.ceil(t / 20) + ' s' : 'lista'; }; $('cdGranada').textContent = cd('cdGranada'); $('cdHumo').textContent = cd('cdHumo').replace('lista', 'listo'); } else if (lanza && !esFpv(lanza)) lanza = null;
    let b = 'Pasa el cursor por el sector.';
    if (raton.dentro) {
      const x = cam.x + (raton.x - cw / 2) / cam.z, y = cam.y + (raton.y - ch / 2) / cam.z; let mejor = null, md = 1.1;
      for (const e of visibles) { const d = Math.hypot(e.x - x, e.y - y) / (e.clase === 'edif' ? 1.6 : 1); if (d < md) { md = d; mejor = e; } }
      for (const t of mapa.tubos) for (const q of [t.a, t.b]) if (Math.hypot(q.x - x, q.y - y) < md) { md = Math.hypot(q.x - x, q.y - y); mejor = { clase: 'edif', tipo: 'boca', j: -1 }; }
      if (mejor) { const tipo = mejor.j === 1 - YO && mejor.tipo === 'falsa' && !todo ? 'antena' : mejor.tipo, d = (mejor.clase === 'sol' ? D.SOL : mejor.clase === 'dron' ? D.DRON : D.EDIF)[tipo]; b = '<b style="color:' + (mejor.j === YO ? 'var(--yo)' : mejor.j === 1 - YO ? 'var(--rival)' : 'var(--tinta)') + '">' + d.nombre + (mejor.j === YO ? ' · tuyo' : mejor.j === 1 - YO ? ' · rival' : '') + '</b>' + d.que + (mejor.clase === 'sol' ? '<br>' + D.ARMA[d.arma].nombre + (mejor.j === YO ? ' · escuadrón ' + mejor.num : '') : ''); }
      else if (x >= 0 && y >= 0 && x < N && y < N) { const t = mapa.terreno[Math.floor(y) * N + Math.floor(x)]; b = '<b style="color:var(--tinta)">' + D.TERRENO[t] + '</b>' + (mapa.paso[Math.floor(y) * N + Math.floor(x)] ? 'se pasa a pie' : 'no se pasa') + ' · cobertura ' + Math.round(D.COBERTURA[t] * 100) + ' %'; }
    }
    if ($('bajo').innerHTML !== b) $('bajo').innerHTML = b;
    if (m.fin && $('fin').hidden) { const gano = m.fin.gana === YO, por = { extraccion: 'El centro ha volado y ' + (m.fin.salen === 1 ? 'ha salido 1 persona' : 'han salido ' + m.fin.salen + ' personas') + ' por la zona de extracción.', refuerzos: 'Son las 22:00: llegan los refuerzos aéreos de la defensa y el centro sigue en pie.', atrapados: 'El centro ha volado, pero a las 22:00 llegan los refuerzos y el atacante sigue dentro.', 'sin extraccion': 'El centro ha volado, pero nadie ha llegado a la zona de extracción.', 'sin asalto': 'Al atacante no le queda nadie que pueda poner la carga.' }[m.fin.motivo]; $('finT').textContent = gano ? 'Victoria' : 'Derrota'; $('finQ').textContent = por + ' Bajas: ' + m.jug[YO].bajas + ' tuyas, ' + m.jug[1 - YO].bajas + ' del rival.'; $('fin').hidden = false; }
  }

  // ---------- entrada ----------
  const teclas = new Set();
  function medir() { dpr = Math.min(2, window.devicePixelRatio || 1); const r = lienzo.getBoundingClientRect(); cw = Math.max(1, r.width); ch = Math.max(1, r.height); lienzo.width = Math.round(cw * dpr); lienzo.height = Math.round(ch * dpr); }
  const limita = () => { cam.z = Math.max(5, Math.min(44, cam.z)); cam.x = Math.max(0, Math.min(N, cam.x)); cam.y = Math.max(0, Math.min(N, cam.y)); };
  const aMundo = (px, py) => ({ x: cam.x + (px - cw / 2) / cam.z, y: cam.y + (py - ch / 2) / cam.z });
  addEventListener('resize', medir);
  addEventListener('keydown', (ev) => {
    if (ev.metaKey || ev.ctrlKey) return; teclas.add(ev.code);
    if (/^Digit[7890]$/.test(ev.code)) ponVision(VISIONES['7890'.indexOf(ev.code.slice(5))][0]);
    else if (/^Digit[1-6]$/.test(ev.code)) { const n = Number(ev.code.slice(5)), us = mios().filter((e) => e.num === n); if (us.length) { const ya = sel.size === 1 && sel.has(us[0].eq); if (!ev.shiftKey) sel.clear(); sel.add(us[0].eq); selDron = 0; firmaP = ''; if (ya) { cam.x = us[0].x; cam.y = us[0].y; } } } // el número elige el escuadrón; pulsado otra vez, lleva la cámara a él
    else if (ev.code === 'KeyH') { cam.x = mapa.bases[YO].x; cam.y = mapa.bases[YO].y; }
    else if (ev.code === 'KeyT') orienta(); else if (ev.code === 'KeyR') retirada(); else if (ev.code === 'KeyG') apunta('granada'); else if (ev.code === 'KeyB') apunta('humo');
    else if (ev.code === 'KeyV') apuntaFpv('fpvRadio'); else if (ev.code === 'KeyN') apuntaFpv('fpvFibra'); else if (ev.code === 'KeyZ') recoge();
    else if (ev.code === 'KeyC') alterna('sigilo'); else if (ev.code === 'KeyF') alterna('fuego'); else if (ev.code === 'KeyX') orden({ t: 'detener' });
    else if (ev.code === 'Escape') { if (lanza) lanza = null; else if (giro) giro = null; else { sel.clear(); selDron = 0; firmaP = ''; } } else if (ev.code === 'KeyP') { pausa = !pausa; aviso(pausa ? 'Pausa' : 'Sigue'); }
    else if (ev.code === 'Tab') { ev.preventDefault(); const ids = [...equipos().keys()]; selDron = 0; if (ids.length) { const i = ids.indexOf([...sel][0]); sel.clear(); const eq = ids[(i + 1) % ids.length]; sel.add(eq); const u = mios().find((e) => e.eq === eq); cam.x = u.x; cam.y = u.y; firmaP = ''; } }
    if (ev.code.startsWith('Arrow') || ev.code === 'Space') ev.preventDefault();
  });
  addEventListener('keyup', (ev) => teclas.delete(ev.code)); addEventListener('blur', () => teclas.clear());
  let arrastre = null;
  lienzo.addEventListener('pointerdown', (ev) => {
    const r = lienzo.getBoundingClientRect(), px = ev.clientX - r.left, py = ev.clientY - r.top; lienzo.setPointerCapture(ev.pointerId);
    if (ev.button === 1 || (ev.button === 0 && teclas.has('Space'))) arrastre = { x: ev.clientX, y: ev.clientY, cx: cam.x, cy: cam.y }; // desplazar: botón central o Espacio + arrastrar
    else if ((ev.button === 0 || ev.button === 2) && !lanza && sel.size && !m.fin && enGiro(aMundo(px, py))) { const p = aMundo(px, py); D.orden(m, { t: 'mover', j: YO, eqs: giro.eqs, x: giro.x, y: giro.y, hacia: { x: p.x, y: p.y } }); aviso('Orientados hacia allí'); giro = null; } // el segundo clic, cerca: orientar
    else if (ev.button === 0 && esFpv(lanza)) { // el FPV: contra el enemigo a la vista o el edificio descubierto que esté bajo el clic; si no hay, al punto
      const p = aMundo(px, py); let ob = null, md = 1.6; for (const e of m.ents) { if (e.j === YO || e.clase === 'dron' || !(e.clase === 'sol' ? m.visto[YO].has(e.id) : m.conocido[YO].has(e.id))) continue; const d = Math.hypot(e.x - p.x, e.y - p.y); if (d < md) { md = d; ob = e; } }
      D.orden(m, ob ? { t: 'fpv', j: YO, tipo: lanza, obj: ob.id } : { t: 'fpv', j: YO, tipo: lanza, x: p.x, y: p.y }); fx.push({ k: 'anillo', x: ob ? ob.x : p.x, y: ob ? ob.y : p.y, r: 1.6, c: '#c2552d', t0: tiempo, dur: 0.6 }); lanza = null; }
    else if (ev.button === 0 && lanza) { const p = aMundo(px, py); orden({ t: lanza, x: p.x, y: p.y }); lanza = null; } // con granada o humo en la mano, el clic dice dónde
    else if (ev.button === 0) caja = { x0: px, y0: py, x1: px, y1: py, mayus: ev.shiftKey };
    else if (ev.button === 2 && lanza) lanza = null;
    else if (ev.button === 2 && selDron && !m.fin) { const p = aMundo(px, py); D.orden(m, { t: 'recon', j: YO, id: selDron, x: p.x, y: p.y }); fx.push({ k: 'anillo', x: p.x, y: p.y, r: D.ECON.reconRadio, c: '#1f6f78', t0: tiempo, dur: 0.6 }); }
    else if (ev.button === 2 && sel.size && !m.fin) { // la orden: sobre un edificio enemigo descubierto, volarlo; si no, ir allí
      const p = aMundo(px, py); let ob = null, md = 1.8; for (const e of m.ents) if (e.clase === 'edif' && e.j !== YO && m.conocido[YO].has(e.id)) { const d = Math.hypot(e.x - p.x, e.y - p.y); if (d < md) { md = d; ob = e; } }
      if (ob) { if (seleccionados().some((u) => D.SOL[u.tipo].carga)) { orden({ t: 'volar', obj: ob.id }); fx.push({ k: 'anillo', x: ob.x, y: ob.y, r: 2.5, c: '#c2552d', t0: tiempo, dur: 0.7 }); } else aviso('En ese escuadrón nadie lleva carga: hace falta un asaltante o un zapador'); }
      else if (p.x >= 0 && p.y >= 0 && p.x < N && p.y < N) { if (!m.paso[Math.floor(p.y) * N + Math.floor(p.x)]) aviso('Ahí no se puede pisar: irán a lo más cercano'); orden({ t: 'mover', x: p.x, y: p.y }); giro = { eqs: [...sel], x: p.x, y: p.y, t0: tiempo }; fx.push({ k: 'anillo', x: p.x, y: p.y, r: 1.2, c: '#1f6f78', t0: tiempo, dur: 0.5 }); }
    }
  });
  lienzo.addEventListener('pointermove', (ev) => { const r = lienzo.getBoundingClientRect(); raton.x = ev.clientX - r.left; raton.y = ev.clientY - r.top; raton.dentro = true; if (arrastre) { cam.x = arrastre.cx - (ev.clientX - arrastre.x) / cam.z; cam.y = arrastre.cy - (ev.clientY - arrastre.y) / cam.z; limita(); } if (caja) { caja.x1 = raton.x; caja.y1 = raton.y; } });
  lienzo.addEventListener('pointerup', () => {
    arrastre = null; if (!caja) return; const c = caja; caja = null; if (!c.mayus) sel.clear(); firmaP = ''; selDron = 0;
    if (Math.abs(c.x1 - c.x0) < 6 && Math.abs(c.y1 - c.y0) < 6) { const p = aMundo(c.x1, c.y1); let mejor = null, md = 1.4;
      for (const e of m.ents) if (e.clase === 'dron' && e.j === YO && e.tipo === 'recon' && Math.hypot(e.x - p.x, e.y - p.y) < 1.3) { selDron = e.id; sel.clear(); return; } // un clic sobre mi dron de reconocimiento lo elige
      for (const e of mios()) { const d = Math.hypot(e.x - p.x, e.y - p.y); if (d < md) { md = d; mejor = e; } } if (mejor) sel.add(mejor.eq); } // un clic: el equipo del soldado tocado
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
