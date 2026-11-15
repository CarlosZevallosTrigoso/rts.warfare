// drone.warfare — las figuras: soldados, drones y edificios vistos desde arriba, y la paleta de cada visión.
// Todo se pinta con un «pintor» P: sabe en qué visión estamos y da el color que toca (P.col, P.tinta, P.bando).
(function () {
  const D = globalThis.D || (globalThis.D = {});
  const TAU = Math.PI * 2;
  // ---------- color: una paleta de día y una regla para derivar las demás ----------
  const DIA = { suelo: '#e6e4da', campo: '#dcd8c4', surco: '#cbc5ab', hierba: '#d3dbc3', arbol: '#7f9a6b', arbol2: '#6a8758', camino: '#cdc6b6', agua: '#b4c7d2', ruina: '#b9b4aa', ruinaS: '#8b867c', trinchera: '#75695a', crater: '#bbb5a4', tierra: '#a8977a', red: '#55606a', lona: '#93a07c', metal: '#8d949c', caja: '#b49a6a', calle: '#bcb9b1', acera: '#e0ded6', bloque: '#aeb0b0', tejado: '#9a9c9c' };
  const CALOR = { suelo: 0.2, campo: 0.22, surco: 0.18, hierba: 0.18, arbol: 0.28, arbol2: 0.24, camino: 0.27, agua: 0.04, ruina: 0.36, ruinaS: 0.2, trinchera: 0.13, crater: 0.2, tierra: 0.25, red: 0.14, lona: 0.3, metal: 0.16, caja: 0.2, calle: 0.3, acera: 0.26, bloque: 0.42, tejado: 0.36 };
  const rgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const mezcla = (a, b, k) => 'rgb(' + a.map((v, i) => Math.round(v + (b[i] - v) * k)).join(',') + ')';
  const lum = (c) => (0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]) / 255;
  const cache = {};
  function colDe(modo, k) {
    const id = modo + k; if (cache[id]) return cache[id];
    const c = rgb(DIA[k]), L = lum(c); let r;
    if (modo === 'dia') r = DIA[k];
    else if (modo === 'noche') r = mezcla(c.map((v) => v * 0.5 + L * 255 * 0.5), [18, 24, 38], 0.72);
    else if (modo === 'nocturna') { const g = Math.pow(L, 1.5); r = 'rgb(' + Math.round(20 + g * 60) + ',' + Math.round(48 + g * 190) + ',' + Math.round(28 + g * 70) + ')'; }
    else if (modo === 'termica') { const g = Math.round(22 + CALOR[k] * 150); r = 'rgb(' + g + ',' + g + ',' + (g + 4) + ')'; }
    else r = mezcla([11, 17, 24], [34, 52, 68], L * 0.55);
    return (cache[id] = r);
  }
  const TINTA = { dia: '#20242a', noche: '#0b0e14', nocturna: '#072a12', termica: '#0c0c0e', espectro: '#3a4c5c' };
  const BANDO = { dia: ['#1f6f78', '#c2552d'], noche: ['#1c3f46', '#5a3324'], nocturna: ['#b9f7c3', '#b9f7c3'], termica: ['#ffffff', '#ffffff'], espectro: ['#39c6d6', '#ff8a4c'] };
  // modo: 'dia' | 'noche' | 'nocturna' | 'termica' | 'espectro'. t: segundos, para lo que se anima.
  D.pintor = function (modo, t) {
    return { modo, t, col: (k) => colDe(modo, k), tinta: TINTA[modo], bando: (b) => (b === 0 || b === 1 ? BANDO[modo][b] : TINTA[modo]), sombras: modo === 'dia', fantasma: modo === 'espectro',
      brillo: (ctx, on) => { ctx.shadowColor = '#fff'; ctx.shadowBlur = on && modo === 'termica' ? 9 : 0; } };
  };
  D.DIA = DIA;

  // ---------- figuras ----------
  function soldado(ctx, P, x, y, ang, rol, b, s, o) {
    const modo = P.modo, t = P.t;
    o = o || {}; ctx.save(); ctx.translate(x, y);
    if (P.sombras) { ctx.fillStyle = 'rgba(30,34,40,0.22)'; ctx.beginPath(); ctx.ellipse(3.2 * s, 4.2 * s, 4.6 * s, 2.4 * s, 0.6, 0, TAU); ctx.fill(); }
    ctx.rotate(ang); ctx.globalAlpha = P.fantasma && rol !== 'inhibidor' && rol !== 'observador' ? 0.22 : o.oculto ? 0.55 : 1;
    const c = P.bando(b), ti = P.tinta, paso = o.anda ? Math.sin(t * 9 + x) * 1.6 * s : 0;
    ctx.strokeStyle = ti; ctx.lineWidth = Math.max(1, 1.1 * s); ctx.lineCap = 'round';
    if (o.anda) { ctx.beginPath(); ctx.moveTo(-1.5 * s, -1.6 * s); ctx.lineTo(-1.5 * s + paso, -1.6 * s); ctx.moveTo(-1.5 * s, 1.6 * s); ctx.lineTo(-1.5 * s - paso, 1.6 * s); ctx.stroke(); }
    P.brillo(ctx, true);
    // mochila o carga a la espalda, según el rol
    ctx.fillStyle = modo === 'termica' ? '#9a9a9a' : P.col('metal');
    if (rol === 'zapador') { ctx.fillRect(-5.6 * s, -2.2 * s, 2.8 * s, 4.4 * s); ctx.strokeRect(-5.6 * s, -2.2 * s, 2.8 * s, 4.4 * s); ctx.beginPath(); ctx.moveTo(-5.2 * s, 3.4 * s); ctx.lineTo(-1 * s, 4.6 * s); ctx.stroke(); }
    if (rol === 'inhibidor') { ctx.fillRect(-6 * s, -2.6 * s, 3.2 * s, 5.2 * s); ctx.strokeRect(-6 * s, -2.6 * s, 3.2 * s, 5.2 * s); ctx.beginPath(); ctx.moveTo(-5 * s, -2.6 * s); ctx.lineTo(-7.5 * s, -6.5 * s); ctx.moveTo(-5 * s, 2.6 * s); ctx.lineTo(-7.5 * s, 6.5 * s); ctx.stroke(); }
    if (rol === 'sanitario') { ctx.fillStyle = modo === 'dia' ? '#fff' : ctx.fillStyle; ctx.fillRect(-5.4 * s, -2.2 * s, 2.8 * s, 4.4 * s); ctx.strokeRect(-5.4 * s, -2.2 * s, 2.8 * s, 4.4 * s); ctx.strokeStyle = modo === 'dia' ? '#b3261e' : ti; ctx.beginPath(); ctx.moveTo(-4 * s, -1.2 * s); ctx.lineTo(-4 * s, 1.2 * s); ctx.moveTo(-5 * s, 0); ctx.lineTo(-3 * s, 0); ctx.stroke(); ctx.strokeStyle = ti; }
    // hombros y casco
    ctx.fillStyle = c; if (rol === 'tirador') ctx.setLineDash([1.5 * s, 1.2 * s]); // el tirador lleva traje de camuflaje: contorno roto
    ctx.beginPath(); ctx.ellipse(-0.6 * s, 0, 2.5 * s, 4.3 * s, 0, 0, TAU); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = modo === 'dia' ? (b ? '#8f3e21' : '#16525a') : c; ctx.beginPath(); ctx.arc(0.6 * s, 0, 2.3 * s, 0, TAU); ctx.fill(); ctx.stroke();
    P.brillo(ctx, false);
    // arma en las manos
    ctx.lineWidth = Math.max(1.2, 1.5 * s); ctx.beginPath();
    if (rol === 'asaltante') { ctx.moveTo(1.5 * s, 2.2 * s); ctx.lineTo(8.2 * s, 1.4 * s); }
    else if (rol === 'escopetero') { ctx.lineWidth = Math.max(1.6, 2.2 * s); ctx.moveTo(1.5 * s, 2.2 * s); ctx.lineTo(6.4 * s, 1.6 * s); }
    else if (rol === 'tirador') { ctx.lineWidth = Math.max(1, 1.1 * s); ctx.moveTo(1.5 * s, 2 * s); ctx.lineTo(12 * s, 1 * s); }
    else if (rol === 'zapador' || rol === 'inhibidor') { ctx.moveTo(1.5 * s, 2.2 * s); ctx.lineTo(6.6 * s, 1.6 * s); }
    else if (rol === 'observador') { ctx.stroke(); ctx.beginPath(); ctx.fillStyle = modo === 'dia' ? '#e9edf0' : c; ctx.rect(3.2 * s, -1.8 * s, 2.6 * s, 3.6 * s); ctx.fill(); }
    ctx.stroke();
    if (rol === 'escopetero') { ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(6.4 * s, 1.6 * s, 1.5 * s, 0, TAU); ctx.stroke(); }
    ctx.globalAlpha = 1;
    if (modo === 'nocturna' && !b && Math.sin(t * 7 + x) > 0.2) { ctx.fillStyle = '#fff'; ctx.shadowColor = '#fff'; ctx.shadowBlur = 8; ctx.beginPath(); ctx.arc(0.6 * s, 0, 1.1 * s, 0, TAU); ctx.fill(); ctx.shadowBlur = 0; } // baliza infrarroja propia
    ctx.restore();
  }
  function rotor(ctx, P, x, y, r, gira) { const t = P.t; ctx.globalAlpha *= 0.55; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke(); ctx.globalAlpha /= 0.55; if (gira) { const a = t * 40 + x; ctx.beginPath(); ctx.moveTo(x - Math.cos(a) * r, y - Math.sin(a) * r); ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); ctx.stroke(); } }
  function dron(ctx, P, x, y, ang, tipo, b, s, alt) {
    const modo = P.modo;
    const emite = tipo === 'fpvRadio' || tipo === 'repetidor' || tipo === 'recon' || tipo === 'bombardero' || tipo === 'interceptor' || tipo === 'carga' || tipo === 'ugv';
    ctx.save(); const posado = !alt;
    if (P.sombras && tipo !== 'ugv') { ctx.fillStyle = 'rgba(30,34,40,0.2)'; ctx.beginPath(); ctx.ellipse(x + alt * 0.4, y + alt * 0.55, 5 * s, 2.6 * s, 0, 0, TAU); ctx.fill(); }
    ctx.translate(x, y); ctx.rotate(ang); ctx.globalAlpha = P.fantasma && !emite ? 0.22 : 1;
    const c = P.bando(b), ti = P.tinta; ctx.strokeStyle = ti; ctx.fillStyle = c; ctx.lineWidth = Math.max(1, 1.1 * s); ctx.lineCap = 'round';
    P.brillo(ctx, !posado);
    if (tipo === 'recon') { // ala fija: fuselaje, ala y cola en V
      ctx.beginPath(); ctx.moveTo(-6 * s, 0); ctx.lineTo(6 * s, 0); ctx.lineWidth = Math.max(2, 2.4 * s); ctx.stroke(); ctx.lineWidth = Math.max(1, 1.1 * s);
      ctx.beginPath(); ctx.moveTo(1 * s, -9 * s); ctx.lineTo(3 * s, -9 * s); ctx.lineTo(3 * s, 9 * s); ctx.lineTo(1 * s, 9 * s); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-6 * s, 0); ctx.lineTo(-8 * s, -3 * s); ctx.moveTo(-6 * s, 0); ctx.lineTo(-8 * s, 3 * s); ctx.stroke();
      ctx.fillStyle = modo === 'dia' ? '#20242a' : c; ctx.beginPath(); ctx.arc(5 * s, 0, 1.5 * s, 0, TAU); ctx.fill();
    } else if (tipo === 'ugv') { // robot terrestre: caja con dos orugas
      ctx.fillStyle = ti; ctx.fillRect(-6 * s, -5 * s, 12 * s, 2.2 * s); ctx.fillRect(-6 * s, 2.8 * s, 12 * s, 2.2 * s);
      ctx.fillStyle = c; ctx.fillRect(-5 * s, -3 * s, 10 * s, 6 * s); ctx.strokeRect(-5 * s, -3 * s, 10 * s, 6 * s);
      ctx.fillStyle = modo === 'termica' ? '#777' : P.col('caja'); ctx.fillRect(-3.5 * s, -2 * s, 5 * s, 4 * s); ctx.strokeRect(-3.5 * s, -2 * s, 5 * s, 4 * s);
    } else {
      const n = tipo === 'bombardero' ? 6 : 4, R = (tipo === 'bombardero' ? 7.5 : tipo === 'interceptor' ? 3.6 : tipo === 'carga' ? 6.5 : 5) * s, rr = (tipo === 'interceptor' ? 1.8 : 2.6) * s;
      ctx.beginPath(); for (let i = 0; i < n; i++) { const a = (i + 0.5) * (TAU / n); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * R, Math.sin(a) * R); } ctx.stroke(); // brazos
      for (let i = 0; i < n; i++) { const a = (i + 0.5) * (TAU / n); rotor(ctx, P, Math.cos(a) * R, Math.sin(a) * R, rr, !posado); }
      if (tipo === 'interceptor') { ctx.beginPath(); ctx.ellipse(0, 0, 5.2 * s, 1.9 * s, 0, 0, TAU); ctx.fill(); ctx.stroke(); } // cuerpo de bala
      else { ctx.beginPath(); ctx.rect(-2.6 * s, -1.9 * s, 5.2 * s, 3.8 * s); ctx.fill(); ctx.stroke(); }
      if (tipo === 'fpvRadio' || tipo === 'fpvFibra') { ctx.beginPath(); ctx.moveTo(2.6 * s, 0); ctx.lineTo(6.2 * s, 0); ctx.stroke(); ctx.fillStyle = ti; ctx.beginPath(); ctx.arc(6.2 * s, 0, 1.2 * s, 0, TAU); ctx.fill(); } // la carga, por delante
      if (tipo === 'fpvRadio') { ctx.beginPath(); ctx.moveTo(-2.6 * s, -1 * s); ctx.lineTo(-5.4 * s, -3.4 * s); ctx.stroke(); } // antena
      if (tipo === 'fpvFibra') { ctx.fillStyle = modo === 'dia' ? '#f3f1ea' : c; ctx.beginPath(); ctx.arc(-3.6 * s, 0, 2 * s, 0, TAU); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.arc(-3.6 * s, 0, 0.8 * s, 0, TAU); ctx.stroke(); } // la bobina
      if (tipo === 'bombardero') { ctx.fillStyle = ti; for (const k of [-1.6, 1.6]) { ctx.beginPath(); ctx.arc(0, k * s, 1.1 * s, 0, TAU); ctx.fill(); } }
      if (tipo === 'repetidor') { ctx.setLineDash([2 * s, 1.5 * s]); ctx.beginPath(); ctx.arc(0, 0, 8.6 * s, 0, TAU); ctx.stroke(); ctx.setLineDash([]); }
      if (tipo === 'carga') { ctx.fillStyle = modo === 'termica' ? '#666' : P.col('caja'); ctx.fillRect(-2.2 * s, -2.2 * s, 4.4 * s, 4.4 * s); ctx.strokeRect(-2.2 * s, -2.2 * s, 4.4 * s, 4.4 * s); ctx.beginPath(); ctx.moveTo(-2.2 * s, 0); ctx.lineTo(2.2 * s, 0); ctx.stroke(); }
    }
    P.brillo(ctx, false); ctx.restore();
  }
  const sacos = (ctx, P, x, y, w, h, s) => { ctx.fillStyle = P.col('tierra'); ctx.strokeStyle = P.tinta; ctx.lineWidth = 1; const n = Math.max(3, Math.round((w + h) / (5 * s))); for (let i = 0; i < n; i++) { const a = (i / n) * TAU; ctx.beginPath(); ctx.ellipse(x + Math.cos(a) * w, y + Math.sin(a) * h, 2.6 * s, 1.7 * s, a + 1.57, 0, TAU); ctx.fill(); ctx.stroke(); } };
  const sombraE = (ctx, P, x, y, w, h) => { if (P.sombras) { ctx.fillStyle = 'rgba(30,34,40,0.18)'; ctx.fillRect(x + 4, y + 5, w, h); } };
  function edificio(ctx, P, x, y, tipo, b, s, o) {
    const modo = P.modo;
    o = o || {}; ctx.save(); ctx.translate(x, y); const c = P.bando(b), ti = P.tinta; ctx.strokeStyle = ti; ctx.lineWidth = Math.max(1, 1.2 * s); ctx.lineJoin = 'round';
    const frio = modo === 'termica'; ctx.globalAlpha = P.fantasma && tipo !== 'antena' && tipo !== 'escucha' ? 0.25 : 1;
    if (tipo === 'centro') { // búnker enterrado: sacos, losa cubierta de tierra y una escotilla
      sombraE(ctx, P, -16 * s, -12 * s, 32 * s, 24 * s); sacos(ctx, P, 0, 0, 17 * s, 13 * s, s);
      ctx.fillStyle = P.col('tierra'); ctx.beginPath(); ctx.rect(-13 * s, -9 * s, 26 * s, 18 * s); ctx.fill(); ctx.stroke();
      ctx.fillStyle = P.col('hierba'); ctx.fillRect(-11 * s, -7 * s, 22 * s, 14 * s);
      ctx.fillStyle = frio ? '#8c8c8c' : c; ctx.beginPath(); ctx.rect(-4 * s, -3.5 * s, 8 * s, 7 * s); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-4 * s, -3.5 * s); ctx.lineTo(4 * s, 3.5 * s); ctx.moveTo(4 * s, -3.5 * s); ctx.lineTo(-4 * s, 3.5 * s); ctx.stroke();
    } else if (tipo === 'taller') { // lona de camuflaje con plataforma de despegue
      sombraE(ctx, P, -15 * s, -10 * s, 30 * s, 20 * s); P.brillo(ctx, true);
      ctx.fillStyle = frio ? '#b5b5b5' : P.col('lona'); ctx.beginPath(); ctx.rect(-15 * s, -10 * s, 20 * s, 20 * s); ctx.fill(); ctx.stroke(); P.brillo(ctx, false);
      ctx.beginPath(); for (let i = -12; i < 5; i += 4) { ctx.moveTo(i * s, -10 * s); ctx.lineTo((i + 3) * s, 10 * s); } ctx.globalAlpha *= 0.4; ctx.stroke(); ctx.globalAlpha /= 0.4;
      ctx.fillStyle = P.col('camino'); ctx.beginPath(); ctx.arc(11 * s, 0, 6 * s, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = c; ctx.lineWidth = Math.max(1.4, 1.8 * s); ctx.beginPath(); ctx.moveTo(8.5 * s, -2.5 * s); ctx.lineTo(8.5 * s, 2.5 * s); ctx.moveTo(13.5 * s, -2.5 * s); ctx.lineTo(13.5 * s, 2.5 * s); ctx.moveTo(8.5 * s, 0); ctx.lineTo(13.5 * s, 0); ctx.stroke();
    } else if (tipo === 'antena' || tipo === 'falsa') { // mástil con vientos; la falsa, para su dueño, va punteada
      if (P.sombras) { ctx.strokeStyle = 'rgba(30,34,40,0.25)'; ctx.lineWidth = 2 * s; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(13 * s, 17 * s); ctx.stroke(); ctx.strokeStyle = ti; ctx.lineWidth = Math.max(1, 1.2 * s); }
      if (tipo === 'falsa') ctx.setLineDash([2.5 * s, 2 * s]);
      ctx.beginPath(); for (let i = 0; i < 3; i++) { const a = -1.57 + i * (TAU / 3); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * 11 * s, Math.sin(a) * 11 * s); } ctx.globalAlpha *= 0.55; ctx.stroke(); ctx.globalAlpha /= 0.55;
      P.brillo(ctx, tipo === 'antena'); ctx.fillStyle = frio ? (tipo === 'antena' ? '#f0f0f0' : '#3c3c3c') : c; ctx.beginPath(); ctx.rect(-3 * s, -3 * s, 6 * s, 6 * s); ctx.fill(); ctx.stroke(); P.brillo(ctx, false);
      ctx.beginPath(); ctx.arc(0, 0, 1.2 * s, 0, TAU); ctx.fillStyle = ti; ctx.fill(); ctx.setLineDash([]);
    } else if (tipo === 'barracon') { // refugio de troncos medio enterrado
      sombraE(ctx, P, -13 * s, -8 * s, 26 * s, 16 * s); ctx.fillStyle = P.col('tierra'); ctx.beginPath(); ctx.rect(-13 * s, -8 * s, 26 * s, 16 * s); ctx.fill(); ctx.stroke();
      ctx.beginPath(); for (let i = -10; i <= 10; i += 3.3) { ctx.moveTo(i * s, -8 * s); ctx.lineTo(i * s, 8 * s); } ctx.globalAlpha *= 0.5; ctx.stroke(); ctx.globalAlpha /= 0.5;
      ctx.fillStyle = frio ? '#7d7d7d' : c; ctx.beginPath(); ctx.rect(-3 * s, 4 * s, 6 * s, 4 * s); ctx.fill(); ctx.stroke();
    } else if (tipo === 'escucha') { // estación de escucha: tres antenas en abanico sobre una caja
      sombraE(ctx, P, -8 * s, -6 * s, 16 * s, 12 * s); ctx.fillStyle = P.col('metal'); ctx.beginPath(); ctx.rect(-8 * s, -6 * s, 16 * s, 12 * s); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = c; ctx.lineWidth = Math.max(1.3, 1.6 * s); for (const a of [-0.7, 0, 0.7]) { ctx.beginPath(); ctx.arc(0, 2 * s, 9 * s, -1.57 + a - 0.25, -1.57 + a + 0.25); ctx.stroke(); }
      ctx.fillStyle = c; ctx.beginPath(); ctx.arc(0, 2 * s, 1.8 * s, 0, TAU); ctx.fill();
    } else if (tipo === 'red') { // red antidron sobre un tramo: malla y postes
      const w = (o.w || 34) * s, h = 12 * s; ctx.globalAlpha *= 0.85; ctx.strokeStyle = P.col('red'); ctx.lineWidth = 0.8;
      ctx.beginPath(); for (let i = -w / 2; i <= w / 2; i += 3.5 * s) { ctx.moveTo(i, -h / 2); ctx.lineTo(i + h * 0.5, h / 2); ctx.moveTo(i, h / 2); ctx.lineTo(i + h * 0.5, -h / 2); } ctx.stroke();
      ctx.strokeStyle = ti; ctx.lineWidth = Math.max(1, 1.1 * s); ctx.strokeRect(-w / 2, -h / 2, w + h * 0.5, h);
      ctx.fillStyle = ti; for (const [px, py] of [[-w / 2, -h / 2], [-w / 2, h / 2], [w / 2 + h * 0.5, -h / 2], [w / 2 + h * 0.5, h / 2]]) { ctx.beginPath(); ctx.arc(px, py, 1.4 * s, 0, TAU); ctx.fill(); }
    } else if (tipo === 'pozo') { // posición enterrada: hoyo con parapeto
      sacos(ctx, P, 0, 0, 7 * s, 5.5 * s, s * 0.8); ctx.fillStyle = P.col('trinchera'); ctx.beginPath(); ctx.ellipse(0, 0, 5 * s, 3.6 * s, 0, 0, TAU); ctx.fill(); ctx.stroke();
    } else if (tipo === 'suministro') { // cajas apiladas bajo una red
      sombraE(ctx, P, -9 * s, -6 * s, 18 * s, 12 * s); ctx.fillStyle = P.col('caja');
      for (const [bx, by, bw, bh] of [[-9, -6, 8, 6], [0, -6, 9, 5], [-7, 1, 7, 5], [1, 0, 8, 6]]) { ctx.beginPath(); ctx.rect(bx * s, by * s, bw * s, bh * s); ctx.fill(); ctx.stroke(); }
      ctx.strokeStyle = c; ctx.lineWidth = Math.max(1.4, 1.8 * s); ctx.beginPath(); ctx.moveTo(-3 * s, -3 * s); ctx.lineTo(3 * s, 3 * s); ctx.moveTo(3 * s, -3 * s); ctx.lineTo(-3 * s, 3 * s); ctx.globalAlpha *= 0; ctx.stroke(); ctx.globalAlpha = 1;
    } else if (tipo === 'boca') { // boca de túnel: agujero negro y la tierra sacada al lado (lo que la delata)
      ctx.fillStyle = P.col('tierra'); ctx.beginPath(); ctx.ellipse(6 * s, 3 * s, 8 * s, 4.5 * s, 0.4, 0, TAU); ctx.fill(); ctx.globalAlpha *= 0.5; ctx.stroke(); ctx.globalAlpha /= 0.5;
      ctx.fillStyle = modo === 'termica' ? '#5a5a5a' : '#15171b'; ctx.beginPath(); ctx.ellipse(-2 * s, 0, 5 * s, 3.8 * s, 0, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-6 * s, 0); ctx.lineTo(2 * s, 0); ctx.moveTo(-5 * s, -2 * s); ctx.lineTo(1 * s, -2 * s); ctx.globalAlpha *= 0.5; ctx.stroke();
    }
    ctx.restore();
  }

  D.fig = { soldado, dron, edificio, sombraE };
})();
