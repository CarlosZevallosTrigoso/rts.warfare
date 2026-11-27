// Dibujo horneado ("nivel 100"): cada vehículo se dibuja una sola vez por orientación, con todo el detalle de maqueta
// (camuflaje en dos tonos del bando, grano de pintura, luz), y en la partida solo se pega. Casco y torreta van por separado;
// la sombra es su propia silueta, horneada aparte y pegada donde cae según la hora. Lo que se mueve sigue en vivo.
// Solo de cerca (lod 2). Se hornea poco a poco (unas pocas imágenes por cuadro) y lo menos usado se tira al pasar del límite.
(function () {
  'use strict';
  const W = globalThis.W, TAU = Math.PI * 2, { orugas, ruedas, rr } = W.auxF;
  const BASE = { base: '#3b6ea5', osc: '#22466b', claro: 'rgb(118,153,192)', luz: '#f5f5f5', humo: '#5a5a5a', fuego: '#e8912d', mal: '#b0362f', tinta: '#1a1a1a', horm: '#d3cfc6', horm2: '#b3aea3', saco: '#c9b990', tierra: '#e6dfcf', mineral: '#7fa7c9', raro: '#9b7fc9', suelo: '#e9e4d8', agua: '#aebfcc', pared: '#5a7591' };
  const TINTA = '#1a1a1a', VERDE = '#5d6b4a', METAL = '#8d969e', tiempo = 0, VAR = 'nuevo';
  let K = BASE; // la paleta del bando que se está horneando
  const lodDe = (z) => (z < 22 ? 0 : z < 50 ? 1 : 2);
  function st(o, id) { return Object.assign({ ang: 0, angT: 0, anda: false, rodilla: 0, te: 0, retro: 0, tiempo, fino: true, hombro: 0, cabeza: 0, inc: 0, resp: 1, pies: null, marcha: 0, fI: 0, fD: 0, rod: 0, dir: 0, hx: 0, hy: 0, id }, o); }
  const rgb = (s) => { if (s[0] === '#') return [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16)); return s.match(/\d+/g).slice(0, 3).map(Number); };
  const mezcla = (a, b, f) => { const p = rgb(a), q = rgb(b); return 'rgb(' + p.map((v, i) => Math.round(v + (q[i] - v) * f)).join(',') + ')'; };
  const NUEVO = () => VAR === 'nuevo';
  // la luz: fija en el mundo, desde el noroeste. En coordenadas de una pieza girada un ángulo a, ¿hacia dónde queda?
  const luzL = (a) => { const ca = Math.cos(-a), sa = Math.sin(-a), x = -Math.SQRT1_2, y = -Math.SQRT1_2; return [x * ca - y * sa, x * sa + y * ca]; };
  function relleno(c, base, a, R, k) { const [dx, dy] = luzL(a), g = c.createLinearGradient(dx * R, dy * R, -dx * R, -dy * R); g.addColorStop(0, mezcla(base, '#ffffff', 0.38 * (k || 1))); g.addColorStop(0.5, base); g.addColorStop(1, mezcla(base, '#000000', 0.28 * (k || 1))); return g; }
  function canto(c, a, R, lw) { const [dx, dy] = luzL(a), g = c.createLinearGradient(dx * R, dy * R, -dx * R, -dy * R); g.addColorStop(0, 'rgba(255,255,255,0.75)'); g.addColorStop(0.45, 'rgba(255,255,255,0)'); g.addColorStop(0.55, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.4)'); c.strokeStyle = g; c.lineWidth = lw; c.stroke(); }
  function brillo(c, x, y, R, a) { const [dx, dy] = luzL(a); c.fillStyle = 'rgba(255,255,255,0.55)'; c.beginPath(); c.arc(x + dx * R * 0.35, y + dy * R * 0.35, R * 0.28, 0, TAU); c.fill(); }
  // una pieza con luz: el camino ya trazado se rellena con degradado, se perfila y lleva su canto
  function pieza(c, fill, a, R, lw, k) { c.fillStyle = relleno(c, fill, a, R, k); c.fill(); c.strokeStyle = K.osc; c.lineWidth = 1; c.stroke(); canto(c, a, R, lw); }
  const P = (c, pts) => { c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); };
  const disco = (c, x, y, R, fill, sto) => { c.beginPath(); c.arc(x, y, R, 0, TAU); c.fillStyle = fill; c.fill(); if (sto) { c.strokeStyle = sto; c.lineWidth = 1; c.stroke(); } };
  const rayas = (c, x0, x1, y0, y1, n, cl, al, hor) => { c.strokeStyle = cl; c.globalAlpha = al; c.lineWidth = 1; c.beginPath(); for (let k = 1; k < n; k++) { if (hor) { const y = y0 + (y1 - y0) * k / n; c.moveTo(x0, y); c.lineTo(x1, y); } else { const x = x0 + (x1 - x0) * k / n; c.moveTo(x, y0); c.lineTo(x, y1); } } c.stroke(); c.globalAlpha = 1; };
  function antena(c, x, y, dx, dy, w, T, id) { const v = Math.sin(T * 5 + (id || 0)) * w * 0.06; c.strokeStyle = K.osc; c.globalAlpha = 0.7; c.lineWidth = 1; c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + dx * 0.55, y + dy * 0.55 + v, x + dx, y + dy + v * 1.8); c.stroke(); c.globalAlpha = 1; } // antena de látigo que se cimbrea

  // ---------- unidades: las que se redibujan enteras (llevaban un emblema blanco donde iba la máquina) ----------
  const REDO = {
    tanque(c, r, lod, col, e) { carro(c, r, lod, col, e, false); },
    pesado(c, r, lod, col, e) { carro(c, r, lod, col, e, true); },
    blindado(c, r, lod, col, e) {
      const L = r * 1.35, w = r * 0.9, a = e.ang, T = tiempo / 1000; c.save(); c.rotate(a); c.lineJoin = 'round';
      ruedas(c, col, e, lod, [-L * 0.75, L * 0.3], w * 0.73, L * 0.45, w * 0.32);
      P(c, [[-L, -w * 0.72], [L * 0.45, -w * 0.72], [L, -w * 0.3], [L, w * 0.3], [L * 0.45, w * 0.72], [-L, w * 0.72]]); pieza(c, col.base, a, L, Math.max(1, r * 0.06));
      c.strokeStyle = col.osc; c.lineWidth = 1; c.beginPath(); for (const x of [-L * 0.75, L * 0.3]) for (const s of [-1, 1]) { c.moveTo(x - L * 0.05, s * w * 0.72); c.lineTo(x + L * 0.5, s * w * 0.72); } c.moveTo(L * 0.45, -w * 0.72); c.lineTo(L * 0.45, w * 0.72); c.stroke();
      c.fillStyle = TINTA; P(c, [[L * 0.5, -w * 0.52], [L * 0.66, -w * 0.4], [L * 0.66, -w * 0.06], [L * 0.5, -w * 0.06]]); c.fill(); P(c, [[L * 0.5, w * 0.52], [L * 0.66, w * 0.4], [L * 0.66, w * 0.06], [L * 0.5, w * 0.06]]); c.fill();
      c.strokeStyle = 'rgba(255,255,255,0.6)'; c.beginPath(); c.moveTo(L * 0.53, -w * 0.42); c.lineTo(L * 0.6, -w * 0.18); c.stroke();
      c.fillStyle = col.luz; for (const s of [-1, 1]) c.fillRect(L * 0.9, s * w * 0.36 - w * 0.06, L * 0.06, w * 0.12);
      disco(c, -L * 1.04, 0, w * 0.3, col.osc); disco(c, -L * 1.04, 0, w * 0.12, col.claro);
      c.fillStyle = VERDE; for (const s of [-1, 1]) c.fillRect(-L * 0.92, s > 0 ? w * 0.4 : -w * 0.62, L * 0.18, w * 0.22);
      c.fillStyle = col.osc; rr(c, -L * 0.62, -w * 0.3, L * 0.32, w * 0.6, w * 0.08); c.fill();
      antena(c, -L * 0.7, w * 0.55, -L * 0.55, w * 0.3, w, T, e.id);
      c.rotate(e.angT - a);
      c.fillStyle = col.osc; c.fillRect(0, -w * 0.07, L * (0.95 - e.retro * 0.1), w * 0.14);
      c.beginPath(); c.arc(0, 0, w * 0.4, 0, TAU); pieza(c, col.base, e.angT, w * 0.4, Math.max(1, r * 0.07));
      c.strokeStyle = col.osc; c.lineWidth = Math.max(1, w * 0.1); c.beginPath(); c.arc(0, 0, w * 0.5, -0.7, 0.7); c.stroke(); disco(c, -w * 0.1, 0, w * 0.17, col.claro); brillo(c, -w * 0.1, 0, w * 0.17, e.angT);
      if (e.retro > 0.5) disco(c, L * 1.05, 0, w * 0.2, col.fuego);
      c.restore();
    },
    blindadoP(c, r, lod, col, e, parte) {
      const L = r * 1.35, w = r * 0.9, a = e.ang, T = tiempo / 1000; c.save(); c.rotate(a); c.lineJoin = 'round';
      if (parte !== 'torre') {
      ruedas(c, col, e, lod, [-L * 0.75, L * 0.3], w * 0.73, L * 0.45, w * 0.32);
      P(c, [[-L, -w * 0.72], [L * 0.45, -w * 0.72], [L, -w * 0.3], [L, w * 0.3], [L * 0.45, w * 0.72], [-L, w * 0.72]]); pieza(c, col.base, a, L, Math.max(1, r * 0.06));
      c.strokeStyle = col.osc; c.lineWidth = 1; c.beginPath(); for (const x of [-L * 0.75, L * 0.3]) for (const s of [-1, 1]) { c.moveTo(x - L * 0.05, s * w * 0.72); c.lineTo(x + L * 0.5, s * w * 0.72); } c.moveTo(L * 0.45, -w * 0.72); c.lineTo(L * 0.45, w * 0.72); c.stroke();
      c.fillStyle = TINTA; P(c, [[L * 0.5, -w * 0.52], [L * 0.66, -w * 0.4], [L * 0.66, -w * 0.06], [L * 0.5, -w * 0.06]]); c.fill(); P(c, [[L * 0.5, w * 0.52], [L * 0.66, w * 0.4], [L * 0.66, w * 0.06], [L * 0.5, w * 0.06]]); c.fill();
      c.strokeStyle = 'rgba(255,255,255,0.6)'; c.beginPath(); c.moveTo(L * 0.53, -w * 0.42); c.lineTo(L * 0.6, -w * 0.18); c.stroke();
      c.fillStyle = col.luz; for (const s of [-1, 1]) c.fillRect(L * 0.9, s * w * 0.36 - w * 0.06, L * 0.06, w * 0.12);
      disco(c, -L * 1.04, 0, w * 0.3, col.osc); disco(c, -L * 1.04, 0, w * 0.12, col.claro);
      c.fillStyle = VERDE; for (const s of [-1, 1]) c.fillRect(-L * 0.92, s > 0 ? w * 0.4 : -w * 0.62, L * 0.18, w * 0.22);
      c.fillStyle = col.osc; rr(c, -L * 0.62, -w * 0.3, L * 0.32, w * 0.6, w * 0.08); c.fill();
      antena(c, -L * 0.7, w * 0.55, -L * 0.55, w * 0.3, w, T, e.id);
      }
      if (parte === 'casco') { c.restore(); return; }
      c.rotate(e.angT - a);
      c.fillStyle = col.osc; c.fillRect(0, -w * 0.07, L * (0.95 - e.retro * 0.1), w * 0.14);
      c.beginPath(); c.arc(0, 0, w * 0.4, 0, TAU); pieza(c, col.base, e.angT, w * 0.4, Math.max(1, r * 0.07));
      c.strokeStyle = col.osc; c.lineWidth = Math.max(1, w * 0.1); c.beginPath(); c.arc(0, 0, w * 0.5, -0.7, 0.7); c.stroke(); disco(c, -w * 0.1, 0, w * 0.17, col.claro); brillo(c, -w * 0.1, 0, w * 0.17, e.angT);
      if (e.retro > 0.5) disco(c, L * 1.05, 0, w * 0.2, col.fuego);
      c.restore();
    },
    camionSum(c, r, lod, col, e) {
      const L = r * 1.3, w = r * 0.72, a = e.ang; c.save(); c.rotate(a); c.lineJoin = 'round';
      ruedas(c, col, e, lod, [-L * 0.82, -L * 0.5, L * 0.4], w * 0.88, L * 0.28, w * 0.28);
      c.fillStyle = col.osc; c.fillRect(-L, -w * 0.9, L * 1.42, w * 1.8);
      c.beginPath(); c.rect(-L * 0.98, -w * 0.86, L * 1.36, w * 1.72); pieza(c, col.claro, a, L, Math.max(1, r * 0.06), 0.8);
      rayas(c, -L * 0.98, L * 0.38, -w * 0.86, w * 0.86, 5, 'rgba(0,0,0,1)', 0.3); c.strokeStyle = 'rgba(255,255,255,0.35)'; c.beginPath(); c.moveTo(-L * 0.98, 0); c.lineTo(L * 0.38, 0); c.stroke();
      c.strokeStyle = TINTA; c.globalAlpha = 0.5; c.beginPath(); for (let k = 0; k < 8; k++) { const x = -L * 0.92 + k * L * 0.17; c.moveTo(x, -w * 0.86); c.lineTo(x + L * 0.08, -w * 0.94); } c.stroke(); c.globalAlpha = 1;
      c.fillStyle = VERDE; for (let k = 0; k < 4; k++) c.fillRect(-L * 0.9 + k * L * 0.2, w * 0.88, L * 0.15, w * 0.16);
      c.beginPath(); rr(c, L * 0.46, -w * 0.78, L * 0.5, w * 1.56, w * 0.18); pieza(c, col.base, a, L * 0.5, Math.max(1, r * 0.06));
      c.fillStyle = TINTA; c.fillRect(L * 0.8, -w * 0.62, L * 0.1, w * 1.24); c.strokeStyle = 'rgba(255,255,255,0.6)'; c.beginPath(); c.moveTo(L * 0.82, -w * 0.5); c.lineTo(L * 0.88, -w * 0.1); c.stroke();
      c.fillStyle = col.osc; for (const s of [-1, 1]) c.fillRect(L * 0.74, s * w * 0.86 - w * 0.06, L * 0.1, w * 0.12);
      disco(c, L * 0.6, 0, w * 0.22, col.osc); disco(c, L * 0.6, 0, w * 0.13, col.claro);
      c.fillStyle = col.luz; for (const s of [-1, 1]) c.fillRect(L * 0.95, s * w * 0.5 - w * 0.08, L * 0.04, w * 0.16);
      c.restore();
    },
    antiaereoMovil(c, r, lod, col, e, parte) {
      const L = r * 1.35, w = r * 0.95, a = e.ang, T = tiempo / 1000; c.save(); c.rotate(a); c.lineJoin = 'round';
      if (parte !== 'torre') {
      orugas(c, col, e, lod, -L, L, w, w * 0.4); faldones(c, col, a, -L * 0.88, L * 1.6, w, w * 0.2);
      c.beginPath(); c.rect(-L * 0.92, -w * 0.64, L * 1.84, w * 1.28); pieza(c, col.base, a, L, Math.max(1, r * 0.06));
      rayas(c, -L * 0.88, -L * 0.5, -w * 0.45, w * 0.45, 5, col.osc, 0.8); c.fillStyle = TINTA; for (const s of [-1, 1]) c.fillRect(-L * 0.98, s * w * 0.42 - w * 0.07, L * 0.07, w * 0.14);
      c.fillStyle = col.osc; rr(c, L * 0.6, -w * 0.4, L * 0.18, w * 0.3, w * 0.06); c.fill(); c.fillStyle = col.luz; for (const s of [-1, 1]) c.fillRect(L * 0.86, s * w * 0.45 - w * 0.06, L * 0.06, w * 0.12);
      }
      if (parte === 'casco') { c.restore(); return; }
      c.rotate(e.angT - a); const rec = e.retro * L * 0.2;
      for (const s of [-1, 1]) { c.fillStyle = col.osc; c.fillRect(w * 0.3 - rec, s * w * 0.28 - w * 0.06, L * 1.05, w * 0.12); c.fillRect(L * 1.1 - rec, s * w * 0.28 - w * 0.08, L * 0.12, w * 0.16); c.strokeStyle = 'rgba(255,255,255,0.3)'; c.lineWidth = 1; c.beginPath(); c.moveTo(w * 0.35 - rec, s * w * 0.28 - w * 0.03); c.lineTo(L * 1.1 - rec, s * w * 0.28 - w * 0.03); c.stroke(); } // los dos cañones, con su camisa
      P(c, [[w * 0.45, -w * 0.4], [w * 0.2, -w * 0.55], [-w * 0.55, -w * 0.55], [-w * 0.62, -w * 0.3], [-w * 0.62, w * 0.3], [-w * 0.55, w * 0.55], [w * 0.2, w * 0.55], [w * 0.45, w * 0.4]]); pieza(c, col.base, e.angT, w, Math.max(1, r * 0.07));
      c.save(); c.translate(-w * 0.55, 0); c.rotate(T * 2.2); c.fillStyle = col.osc; c.fillRect(-w * 0.06, -w * 0.32, w * 0.12, w * 0.64); c.fillStyle = col.claro; c.fillRect(-w * 0.03, -w * 0.28, w * 0.04, w * 0.56); c.restore(); disco(c, -w * 0.55, 0, w * 0.07, TINTA); // el radar de búsqueda, girando atrás
      disco(c, w * 0.12, 0, w * 0.13, col.osc); disco(c, w * 0.12, 0, w * 0.06, TINTA); // el radar de tiro, delante
      disco(c, -w * 0.15, w * 0.3, w * 0.11, col.claro, col.osc); brillo(c, -w * 0.15, w * 0.3, w * 0.11, e.angT);
      if (e.retro > 0.6) { disco(c, L * 1.35, -w * 0.28, w * 0.2, col.fuego); disco(c, L * 1.35, w * 0.28, w * 0.2, col.fuego); }
      c.restore();
    },
  };
  function faldones(c, col, a, x0, l, w, h) { for (const s of [-1, 1]) { c.beginPath(); c.rect(x0, s > 0 ? w - h - w * 0.02 : -w + w * 0.02, l, h); c.fillStyle = relleno(c, col.claro, a, l / 2, 0.7); c.fill(); c.strokeStyle = col.osc; c.lineWidth = 1; c.stroke(); rayas(c, x0, x0 + l, s > 0 ? w - h : -w, s > 0 ? w : -w + h, 5, col.osc, 0.5); } }
  function carro(c, r, lod, col, e, pesado, parte) {
    const L = r * 1.4, w = r, a = e.ang, aT = e.angT, T = tiempo / 1000; c.save(); c.rotate(a); c.lineJoin = 'round';
    if (parte !== 'torre') {
    orugas(c, col, e, lod, -L, L, w, w * 0.44);
    c.fillStyle = mezcla(col.osc, '#000000', 0.25); for (const s of [-1, 1]) for (let k = 0; k < 6; k++) { c.beginPath(); c.arc(-L * 0.78 + k * L * 0.31, s * (w - w * 0.22), w * 0.09, 0, TAU); c.fill(); }
    P(c, [[-L * 0.92, -w * 0.64], [L * 0.6, -w * 0.64], [L * 0.96, -w * 0.3], [L * 0.96, w * 0.3], [L * 0.6, w * 0.64], [-L * 0.92, w * 0.64]]); pieza(c, col.base, a, L, Math.max(1, r * 0.06));
    faldones(c, col, a, -L * 0.86, L * 1.5, w * 0.86, w * 0.22);
    P(c, [[L * 0.5, -w * 0.64], [L * 0.6, -w * 0.64], [L * 0.96, -w * 0.3], [L * 0.96, w * 0.3], [L * 0.6, w * 0.64], [L * 0.5, w * 0.64]]); pieza(c, mezcla(col.base, '#ffffff', 0.12), a, L, 1);
    if (pesado) { c.fillStyle = mezcla(col.base, '#000000', 0.18); c.strokeStyle = col.osc; for (let i = 0; i < 4; i++) for (const s of [-1, 1]) { c.beginPath(); c.rect(L * (0.62 + i * 0.07), s * w * (0.36 - i * 0.04) - w * 0.08, L * 0.06, w * 0.16); c.fill(); c.stroke(); } } // bloques de blindaje reactivo en la proa
    c.fillStyle = col.luz; for (const s of [-1, 1]) c.fillRect(L * 0.86, s * w * 0.42 - w * 0.06, L * 0.06, w * 0.12);
    c.fillStyle = col.osc; rr(c, L * 0.6, -w * 0.32, L * 0.16, w * 0.3, w * 0.06); c.fill(); c.fillStyle = col.luz; for (let k = 0; k < 3; k++) c.fillRect(L * 0.77, -w * 0.3 + k * w * 0.1, L * 0.03, w * 0.06);
    rayas(c, -L * 0.88, -L * 0.45, -w * 0.46, w * 0.46, 6, col.osc, 0.9);
    c.fillStyle = TINTA; for (const s of [-1, 1]) c.fillRect(-L * 0.98, s * w * 0.44 - w * 0.08, L * 0.08, w * 0.16);
    c.fillStyle = '#8a6a45'; c.fillRect(-L * 1.02, -w * 0.36, L * 0.07, w * 0.72);
    c.fillStyle = col.saco; c.strokeStyle = col.osc; for (const s of [-1, 1]) { c.beginPath(); c.rect(-L * 0.36, s > 0 ? w * 0.42 : -w * 0.58, L * 0.3, w * 0.16); c.fill(); c.stroke(); }
    c.strokeStyle = TINTA; c.globalAlpha = 0.55; c.lineWidth = 1; c.beginPath(); c.moveTo(-L * 0.5, -w * 0.52); c.quadraticCurveTo(0, -w * 0.62, L * 0.45, -w * 0.52); c.stroke(); c.globalAlpha = 1;
    }
    if (parte === 'casco') { c.restore(); return; }
    c.rotate(aT - a); const rec = e.retro * L * 0.25;
    for (const o of pesado ? [-0.18, 0.18] : [0]) { c.save(); c.translate(0, w * o); c.fillStyle = relleno(c, col.osc, aT, L, 0.8); P(c, [[w * 0.42 - rec, -w * 0.11], [L * 1.3 - rec, -w * 0.075], [L * 1.3 - rec, w * 0.075], [w * 0.42 - rec, w * 0.11]]); c.fill(); c.fillStyle = col.osc; c.fillRect(L * 0.72 - rec, -w * 0.11, L * 0.16, w * 0.22); c.fillRect(L * 1.26 - rec, -w * 0.13, L * 0.12, w * 0.26); c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = 1; c.beginPath(); c.moveTo(w * 0.5 - rec, -w * 0.05); c.lineTo(L * 1.26 - rec, -w * 0.035); c.stroke(); c.restore(); }
    c.strokeStyle = col.osc; c.lineWidth = 1; c.beginPath(); c.rect(-w * 1.12, -w * 0.4, w * 0.3, w * 0.8); c.stroke(); c.beginPath(); for (const y of [-0.13, 0.13]) { c.moveTo(-w * 1.12, w * y); c.lineTo(-w * 0.82, w * y); } c.stroke(); c.fillStyle = col.saco; rr(c, -w * 1.08, -w * 0.34, w * 0.18, w * 0.4, w * 0.06); c.fill();
    const k = pesado ? 1.12 : 1; P(c, [[w * 0.64 * k, -w * 0.26 * k], [w * 0.36 * k, -w * 0.55 * k], [-w * 0.55 * k, -w * 0.55 * k], [-w * 0.84, -w * 0.38 * k], [-w * 0.84, w * 0.38 * k], [-w * 0.55 * k, w * 0.55 * k], [w * 0.36 * k, w * 0.55 * k], [w * 0.64 * k, w * 0.26 * k]]); pieza(c, col.base, aT, w, Math.max(1, r * 0.07));
    if (pesado) { c.fillStyle = mezcla(col.base, '#000000', 0.18); c.strokeStyle = col.osc; for (const s of [-1, 1]) for (let i = 0; i < 3; i++) { c.beginPath(); c.rect(w * (0.2 + i * 0.13), s * w * 0.5 - w * 0.07, w * 0.11, w * 0.14); c.fill(); c.stroke(); } }
    c.fillStyle = col.osc; c.fillRect(w * 0.4, -w * (pesado ? 0.36 : 0.2), w * 0.28, w * (pesado ? 0.72 : 0.4));
    disco(c, -w * 0.22, w * 0.24, w * 0.19, col.claro, col.osc); c.fillStyle = TINTA; for (let q = 0; q < 6; q++) { const b = q / 6 * TAU; c.fillRect(-w * 0.22 + Math.cos(b) * w * 0.15 - 1, w * 0.24 + Math.sin(b) * w * 0.15 - 1, 2, 2); } brillo(c, -w * 0.22, w * 0.24, w * 0.19, aT);
    c.strokeStyle = TINTA; c.lineWidth = Math.max(1, w * 0.06); c.beginPath(); c.moveTo(-w * 0.1, w * 0.3); c.lineTo(w * 0.32, w * 0.34); c.stroke();
    disco(c, -w * 0.26, -w * 0.26, w * 0.14, col.base, col.osc); brillo(c, -w * 0.26, -w * 0.26, w * 0.14, aT);
    c.fillStyle = TINTA; c.fillRect(w * 0.12, w * 0.36, w * 0.16, w * 0.1);
    c.fillStyle = col.osc; for (const s of [-1, 1]) for (let q = 0; q < 3; q++) { c.beginPath(); c.arc(w * (0.26 + q * 0.09), s * w * 0.6 * k, w * 0.045, 0, TAU); c.fill(); }
    c.strokeStyle = col.luz; c.globalAlpha = 0.85; c.lineWidth = Math.max(1, w * 0.05); c.beginPath(); c.moveTo(-w * 0.62, -w * 0.12); c.lineTo(-w * 0.5, 0); c.lineTo(-w * 0.62, w * 0.12); c.stroke(); c.globalAlpha = 1;
    for (const s of [-1, 1]) antena(c, -w * 0.66, s * w * 0.44, -w * 0.7, s * w * 0.14, w, T + s, e.id);
    if (e.retro > 0.6) disco(c, L * 1.5, 0, w * 0.34, col.fuego);
    c.restore();
  }

  // ---------- unidades: piezas que se añaden encima del dibujo de hoy, en sus mismas medidas ----------
  const casco = (c, a, pts, R, r) => { P(c, pts); canto(c, a, R, Math.max(1, r * 0.06)); }; // el canto con luz sobre el contorno de hoy
  const parab = (c, x, y, w, h) => { c.fillStyle = TINTA; c.fillRect(x, y, w, h); c.strokeStyle = 'rgba(255,255,255,0.6)'; c.lineWidth = 1; c.beginPath(); c.moveTo(x + w * 0.25, y + h * 0.15); c.lineTo(x + w * 0.7, y + h * 0.5); c.stroke(); }; // un parabrisas con su reflejo
  const faros = (c, x, h, w, col) => { c.fillStyle = col.luz; for (const s of [-1, 1]) c.fillRect(x, s * h - w * 0.06, w * 0.08, w * 0.12); };
  const baliza = (c, x, y, R, cl, id) => { disco(c, x, y, R, Math.sin(tiempo / 180 + (id || 0)) > 0 ? cl : 'rgba(0,0,0,0.35)'); };
  const caja = (c, x, y, w, h, fill) => { c.fillStyle = fill; c.strokeStyle = K.osc; c.lineWidth = 1; c.beginPath(); c.rect(x, y, w, h); c.fill(); c.stroke(); };
  const EXTRA = {
    artilleria(c, r, lod, col, e) { const L = r * 1.4, w = r * 0.85, a = e.ang, mar = e.marcha === undefined ? (e.anda ? 1 : 0) : e.marcha, dp = 1 - mar, rec = e.retro * L * 0.5, Lb = L * 2.3 * (1 - 0.2 * dp); c.save(); c.rotate(a); c.translate(-e.retro * e.retro * r * 0.16, 0);
      casco(c, a, [[-L * 0.88, -w * 0.64], [L * 0.42, -w * 0.64], [L * 0.62, -w * 0.38], [L * 0.62, w * 0.38], [L * 0.42, w * 0.64], [-L * 0.88, w * 0.64]], L, r); faros(c, L * 0.55, w * 0.3, w, col); antena(c, -L * 0.8, w * 0.55, -L * 0.5, w * 0.3, w, tiempo / 1000, 3);
      c.rotate(e.angT - a); c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = 1; c.beginPath(); c.moveTo(Lb * 0.42 - rec, -w * 0.06); c.lineTo(Lb * 0.94 - rec, -w * 0.06); c.stroke();
      casco(c, e.angT, [[-w * 0.62, -w * 0.5], [w * 0.36, -w * 0.5], [w * 0.52, -w * 0.26], [w * 0.52, w * 0.26], [w * 0.36, w * 0.5], [-w * 0.62, w * 0.5]], w, r);
      disco(c, -w * 0.2, -w * 0.22, w * 0.12, col.claro, col.osc); brillo(c, -w * 0.2, -w * 0.22, w * 0.12, e.angT); c.strokeStyle = TINTA; c.beginPath(); c.moveTo(-w * 0.12, -w * 0.28); c.lineTo(w * 0.25, -w * 0.32); c.stroke(); c.fillStyle = TINTA; c.fillRect(w * 0.18, w * 0.3, w * 0.14, w * 0.1); c.restore(); },
    excavadora(c, r, lod, col, e) { const L = r * 1.35, w = r * 0.95, a = e.ang; c.save(); c.rotate(a); casco(c, a, [[-L * 0.9, -w * 0.6], [L * 0.55, -w * 0.6], [L * 0.55, w * 0.6], [-L * 0.9, w * 0.6]], L, r);
      c.strokeStyle = 'rgba(255,255,255,0.5)'; c.lineWidth = Math.max(1, r * 0.07); c.beginPath(); c.moveTo(L * 0.6, -w * 0.45); c.lineTo(L * 0.9, -w * 0.45); c.moveTo(L * 0.6, w * 0.45); c.lineTo(L * 0.9, w * 0.45); c.stroke(); // los cilindros hidráulicos
      c.fillStyle = TINTA; for (let k = 0; k < 7; k++) c.fillRect(L * 1.2, -w * 0.95 + k * w * 0.3, L * 0.05, w * 0.1); disco(c, L * 0.2, -w * 0.38, w * 0.09, TINTA); baliza(c, -L * 0.55, 0, w * 0.08, col.fuego, 1); rayas(c, -L * 0.25, L * 0.45, -w * 0.5, w * 0.5, 5, col.osc, 0.5); c.restore(); },
    patioMovil(c, r, lod, col, e) { const L = r * 1.5, w = r * 0.95, a = e.ang; c.save(); c.rotate(a); casco(c, a, [[-L, -w * 0.8], [L, -w * 0.8], [L, w * 0.8], [-L, w * 0.8]], L, r); parab(c, L * 0.8, -w * 0.45, L * 0.07, w * 0.9);
      for (const [x, y] of [[-0.95, -0.8], [-0.95, 0.8], [0.45, -0.8], [0.45, 0.8]]) caja(c, L * x - w * 0.08, w * y - w * 0.08, w * 0.16, w * 0.16, col.osc); for (let k = 0; k < 5; k++) { c.fillStyle = k % 2 ? TINTA : '#e0b83a'; c.fillRect(-L, -w * 0.8 + k * w * 0.32, L * 0.05, w * 0.32); } baliza(c, L * 0.7, -w * 0.5, w * 0.07, col.fuego, 2); baliza(c, L * 0.7, w * 0.5, w * 0.07, col.fuego, 5); c.restore(); },
    tallerMovil(c, r, lod, col, e) { const L = r * 1.3, w = r * 0.75, a = e.ang; c.save(); c.rotate(a); parab(c, L * 0.8, -w * 0.6, L * 0.08, w * 1.2); for (let k = 0; k < 3; k++) caja(c, -L * 0.95 + k * L * 0.28, w * 0.7, L * 0.22, w * 0.24, col.saco); disco(c, -L * 0.2, -w * 0.62, w * 0.14, col.mal, col.osc); disco(c, L * 0.0, -w * 0.62, w * 0.14, col.claro, col.osc); disco(c, -L * 1.05, 0, w * 0.3, col.osc); c.restore(); },
    ambulancia(c, r, lod, col, e) { const L = r * 1.25, w = r * 0.72, a = e.ang; c.save(); c.rotate(a); parab(c, L * 0.78, -w * 0.6, L * 0.1, w * 1.2); c.fillStyle = Math.sin(tiempo / 120) > 0 ? '#2f6fd1' : '#c0392b'; c.fillRect(L * 0.5, -w * 0.4, L * 0.06, w * 0.8); caja(c, -L * 0.75, -w * 0.12, L * 0.2, w * 0.24, '#d9d6cf'); c.strokeStyle = col.osc; c.beginPath(); c.moveTo(-L * 0.9, 0); c.lineTo(-L * 0.9, w * 0.0); c.stroke(); c.fillStyle = '#c0392b'; c.fillRect(-L * 0.9, w * 0.74, L * 1.35, w * 0.08); c.fillRect(-L * 0.9, -w * 0.82, L * 1.35, w * 0.08); c.restore(); },
    motoTrans(c, r, lod, col, e) { const L = r * 1.6, w = r * 0.5; c.save(); c.rotate(e.ang); disco(c, L * 0.95, 0, w * 0.16, col.luz); c.strokeStyle = TINTA; c.lineWidth = Math.max(1, w * 0.12); c.beginPath(); c.moveTo(-L * 0.2, w * 0.4); c.lineTo(-L * 0.85, w * 0.42); c.stroke(); c.restore(); },
    motoSum(c, r, lod, col, e) { const L = r * 1.5, w = r * 0.5; c.save(); c.rotate(e.ang); disco(c, L * 0.92, 0, w * 0.16, col.luz); c.strokeStyle = '#8f8160'; c.lineWidth = 1; c.beginPath(); for (const q of [-1, 1]) for (const x of [-0.6, -0.36]) { c.moveTo(L * x, q * w * 0.55); c.lineTo(L * x, q * w * 1.35); } c.stroke(); c.restore(); },
    avanzadaMovil(c, r, lod, col, e) { const L = r * 1.45, w = r * 0.8; c.save(); c.rotate(e.ang); parab(c, L * 0.82, -w * 0.55, L * 0.08, w * 1.1); caja(c, L * 0.2, -w * 0.62, L * 0.2, w * 0.22, col.horm); antena(c, L * 0.3, w * 0.6, -L * 0.6, w * 0.4, w, tiempo / 1000, 4); c.strokeStyle = col.osc; c.lineWidth = Math.max(1, w * 0.1); c.beginPath(); c.moveTo(-L * 0.9, w * 0.86); c.lineTo(L * 0.4, w * 0.86); c.stroke(); for (let k = 0; k < 3; k++) caja(c, -L * 1.0 - k * L * 0.06, -w * 0.3, L * 0.05, w * 0.6, col.horm2); c.restore(); },
    camioneta(c, r, lod, col, e) { const L = r * 1.5, w = r * 0.72, a = e.ang; c.save(); c.rotate(a); casco(c, a, [[-L, -w * 0.72], [L * 0.75, -w * 0.72], [L, -w * 0.45], [L, w * 0.45], [L * 0.75, w * 0.72], [-L, w * 0.72]], L, r); faros(c, L * 0.92, w * 0.4, w, col);
      c.strokeStyle = TINTA; c.lineWidth = Math.max(1, w * 0.1); c.beginPath(); c.moveTo(L * 0.05, -w * 0.62); c.lineTo(L * 0.05, w * 0.62); c.stroke(); disco(c, -L * 0.78, w * 0.32, w * 0.2, col.osc); caja(c, -L * 0.85, -w * 0.5, L * 0.2, w * 0.3, VERDE); caja(c, -L * 0.62, -w * 0.5, L * 0.2, w * 0.3, VERDE); antena(c, L * 0.2, -w * 0.6, -L * 0.7, -w * 0.3, w, tiempo / 1000, 6); c.restore(); },
    vci(c, r, lod, col, e) { const L = r * 1.45, w = r * 0.95, a = e.ang; c.save(); c.rotate(a); casco(c, a, [[-L * 0.95, -w * 0.68], [L * 0.5, -w * 0.68], [L * 0.98, -w * 0.3], [L * 0.98, w * 0.3], [L * 0.5, w * 0.68], [-L * 0.95, w * 0.68]], L, r); faros(c, L * 0.9, w * 0.38, w, col);
      c.fillStyle = TINTA; for (const s of [-1, 1]) for (let k = 0; k < 4; k++) c.fillRect(-L * 0.7 + k * L * 0.22, s * w * 0.62 - 1, L * 0.06, 2); antena(c, -L * 0.8, -w * 0.55, -L * 0.6, -w * 0.3, w, tiempo / 1000, 7);
      c.translate(L * 0.12, 0); c.rotate(e.angT - a); casco(c, e.angT, [[-r * 0.38, -r * 0.34], [r * 0.22, -r * 0.34], [r * 0.38, -r * 0.16], [r * 0.38, r * 0.16], [r * 0.22, r * 0.34], [-r * 0.38, r * 0.34]], r * 0.4, r); c.fillStyle = col.osc; for (const s of [-1, 1]) for (let q = 0; q < 2; q++) { c.beginPath(); c.arc(r * (0.1 + q * 0.1), s * r * 0.4, r * 0.05, 0, TAU); c.fill(); } c.fillStyle = TINTA; c.fillRect(r * 0.0, -r * 0.3, r * 0.16, r * 0.1); c.restore(); },
    cazacarros(c, r, lod, col, e) { const L = r * 1.5, w = r * 0.8, a = e.ang; c.save(); c.rotate(a); casco(c, a, [[-L * 0.95, -w * 0.7], [L * 0.55, -w * 0.7], [L, -w * 0.25], [L, w * 0.25], [L * 0.55, w * 0.7], [-L * 0.95, w * 0.7]], L, r); faros(c, L * 0.92, w * 0.3, w, col); antena(c, -L * 0.7, w * 0.6, -L * 0.5, w * 0.3, w, tiempo / 1000, 8); caja(c, -L * 0.6, -w * 0.62, L * 0.3, w * 0.18, col.saco);
      c.translate(-L * 0.12, 0); c.rotate(e.angT - a); c.fillStyle = TINTA; c.fillRect(r * 0.15, -r * 0.08, r * 0.2, r * 0.16); disco(c, r * 0.32, 0, r * 0.05, '#6fa8dc'); c.restore(); }, // la mira del lanzador
    guerraE(c, r, lod, col, e) { const L = r * 1.5, w = r * 0.78; c.save(); c.rotate(e.ang); parab(c, L * 0.72, -w * 0.5, L * 0.12, w); for (const s of [-1, 1]) { disco(c, -L * 0.55, s * w * 0.62, w * 0.14, col.osc); disco(c, -L * 0.55, s * w * 0.62, w * 0.06, col.claro); } c.fillStyle = TINTA; c.fillRect(L * 0.1, -w * 0.6, L * 0.06, w * 0.18); c.fillStyle = col.osc; for (const s of [-1, 1]) c.fillRect(L * 0.65, s * w * 0.72 - w * 0.05, L * 0.08, w * 0.1); c.restore(); },
    transporte(c, r, lod, col, e) { const L = r * 1.45, w = r * 0.9, a = e.ang; c.save(); c.rotate(a); casco(c, a, [[-L, -w * 0.78], [L * 0.6, -w * 0.78], [L, -w * 0.45], [L, w * 0.45], [L * 0.6, w * 0.78], [-L, w * 0.78]], L, r); faros(c, L * 0.92, w * 0.35, w, col);
      c.save(); c.translate(L * 0.45, w * 0.2); c.rotate(e.angT - a); caja(c, -w * 0.15, -w * 0.13, w * 0.3, w * 0.26, col.osc); c.fillStyle = TINTA; c.fillRect(w * 0.1, -w * 0.03, w * 0.45, w * 0.06); disco(c, -w * 0.02, 0, w * 0.06, '#6fa8dc'); c.restore(); // la torreta a distancia, con su cámara
      c.fillStyle = col.osc; for (const s of [-1, 1]) for (let k = 0; k < 6; k++) c.fillRect(-L * 0.9 + k * L * 0.28, s * w * 0.72 - 1, 2, 2); antena(c, -L * 0.85, -w * 0.6, -L * 0.6, -w * 0.3, w, tiempo / 1000, 9); c.restore(); },
    lanzacohetes(c, r, lod, col, e) { const L = r * 1.4, w = r * 0.9, a = e.ang; c.save(); c.rotate(a); parab(c, L * 0.76, -w * 0.42, L * 0.08, w * 0.84); c.strokeStyle = col.osc; c.lineWidth = 1; c.beginPath(); for (let k = 0; k < 4; k++) { const x = -L * 0.85 + k * L * 0.31 - e.retro * L * 0.1; c.moveTo(x, -w * 0.56); c.lineTo(x, w * 0.56); } c.stroke(); for (const s of [-1, 1]) caja(c, L * 0.1, s * w * 0.6 - w * 0.06, L * 0.4, w * 0.12, col.horm2); c.fillStyle = TINTA; for (const s of [-1, 1]) c.fillRect(L * 0.45, s * w * 0.62 - w * 0.05, L * 0.08, w * 0.1); c.restore(); },
    mando(c, r, lod, col, e) { const L = r * 1.35, w = r * 0.9; c.save(); c.rotate(e.ang); parab(c, L * 0.84, -w * 0.5, L * 0.06, w); disco(c, L * 0.25, -w * 0.4, w * 0.2, col.luz, col.osc); brillo(c, L * 0.25, -w * 0.4, w * 0.2, e.ang); for (const [x, y] of [[-0.8, -0.6], [-0.85, 0.55], [0.5, 0.6]]) antena(c, L * x, w * y, -L * 0.6, w * y * 0.5, w, tiempo / 1000 + x, 10); caja(c, -L * 0.95, -w * 0.2, L * 0.15, w * 0.4, col.horm2); c.restore(); },
    vehRadio(c, r, lod, col, e) { const L = r * 1.3, w = r * 0.8; c.save(); c.rotate(e.ang); parab(c, L * 0.78, -w * 0.5, L * 0.06, w); for (const k of [0.32, 0.26, 0.2]) { c.strokeStyle = col.osc; c.lineWidth = 1; c.beginPath(); c.arc(-L * 0.35, 0, w * k, 0, TAU); c.stroke(); } c.strokeStyle = TINTA; c.globalAlpha = 0.5; c.beginPath(); for (const b of [0.6, 2.7, 4.8]) { c.moveTo(-L * 0.35, 0); c.lineTo(-L * 0.35 + Math.cos(b) * w * 0.95, Math.sin(b) * w * 0.95); } c.stroke(); c.globalAlpha = 1; c.restore(); }, // el mástil telescópico y sus vientos
    comandoDrones(c, r, lod, col, e) { const L = r * 1.35, w = r * 0.85; c.save(); c.rotate(e.ang); c.fillStyle = TINTA; c.fillRect(L * 0.72, -w * 0.5, L * 0.08, w); for (let k = 0; k < 3; k++) caja(c, L * 0.05, -w * 0.72 + k * w * 0.24, L * 0.3, w * 0.2, col.osc); for (let k = 0; k < 4; k++) { const b = k / 4 * TAU + 0.78; disco(c, -L * 0.35 + Math.cos(b) * w * 0.55, Math.sin(b) * w * 0.55, w * 0.06, Math.sin(tiempo / 300 + k) > 0 ? '#7fd36b' : col.osc); } c.restore(); }, // cajas de drones y las luces de la plataforma
    cosechadora(c, r, lod, col, e) { const L = r * 1.45, w = r * 0.95, a = e.ang; c.save(); c.rotate(a); casco(c, a, [[-L, -w * 0.8], [L * 0.7, -w * 0.8], [L * 0.7, w * 0.8], [-L, w * 0.8]], L, r); disco(c, -L * 0.55, -w * 0.62, w * 0.1, TINTA); baliza(c, -L * 0.75, 0, w * 0.08, col.fuego, 3); c.fillStyle = TINTA; for (let k = 0; k < 5; k++) c.fillRect(L * 1.18, -w * 0.7 + k * w * 0.35, L * 0.05, w * 0.1); rayas(c, -L * 0.45, L * 0.57, -w * 0.56, w * 0.56, 4, col.osc, 0.35); c.restore(); },
    // aéreos
    dron(c, r, lod, col, e) { avion(c, r, col, e, 'dron'); }, dronEspia(c, r, lod, col, e) { avion(c, r, col, e, 'espia'); }, dronRadio(c, r, lod, col, e) { avion(c, r, col, e, 'radio'); },
    caza(c, r, lod, col, e) { const L = r * 1.9; c.save(); c.rotate(e.ang); c.strokeStyle = col.osc; c.globalAlpha = 0.5; c.lineWidth = 1; c.beginPath(); c.moveTo(-L * 0.45, -L * 0.62); c.lineTo(-L * 0.3, -L * 0.2); c.moveTo(-L * 0.45, L * 0.62); c.lineTo(-L * 0.3, L * 0.2); c.moveTo(L * 0.1, -L * 0.25); c.lineTo(-L * 0.2, -L * 0.25); c.moveTo(L * 0.1, L * 0.25); c.lineTo(-L * 0.2, L * 0.25); c.stroke(); c.globalAlpha = 1;
      c.fillStyle = TINTA; for (const s of [-1, 1]) c.fillRect(-L * 0.62, s * L * 0.78 - L * 0.02, L * 0.42, L * 0.04); for (const s of [-1, 1]) c.fillRect(-L * 0.2, s * L * 0.45 - L * 0.025, L * 0.32, L * 0.05); escarapela(c, -L * 0.4, -L * 0.45, L * 0.07, col); escarapela(c, -L * 0.4, L * 0.45, L * 0.07, col); c.strokeStyle = col.osc; c.beginPath(); c.moveTo(L * 0.35, -L * 0.09); c.lineTo(L * 0.35, L * 0.09); c.stroke(); c.restore(); },
    avAtaque(c, r, lod, col, e) { const L = r * 1.6; c.save(); c.rotate(e.ang); c.strokeStyle = col.osc; c.globalAlpha = 0.45; c.lineWidth = 1; c.beginPath(); for (const s of [-1, 1]) { c.moveTo(L * 0.12, s * L * 0.7); c.lineTo(L * 0.3, s * L * 0.7); c.moveTo(L * 0.18, s * L * 1.0); c.lineTo(L * 0.18, s * L * 0.3); } c.stroke(); c.globalAlpha = 1; escarapela(c, L * 0.2, -L * 0.85, L * 0.06, col); escarapela(c, L * 0.2, L * 0.85, L * 0.06, col); c.strokeStyle = col.osc; c.beginPath(); c.moveTo(L * 0.62, -L * 0.07); c.lineTo(L * 0.62, L * 0.07); c.stroke(); c.restore(); },
    bombardero(c, r, lod, col, e) { const L = r * 1.7; c.save(); c.rotate(e.ang); c.strokeStyle = col.osc; c.globalAlpha = 0.45; c.lineWidth = 1; c.beginPath(); for (const s of [-1, 1]) { c.moveTo(-L * 0.2, s * L * 0.95); c.lineTo(-L * 0.2, s * L * 0.3); } c.rect(-L * 0.35, -L * 0.1, L * 0.5, L * 0.2); c.stroke(); c.globalAlpha = 1; for (const s of [-1, 1]) { disco(c, L * 0.42, s * L * 0.63, L * 0.06, TINTA); escarapela(c, 0, s * L * 0.92, L * 0.08, col); } c.strokeStyle = col.osc; c.beginPath(); c.moveTo(L * 0.6, -L * 0.1); c.lineTo(L * 0.6, L * 0.1); c.moveTo(L * 0.7, -L * 0.08); c.lineTo(L * 0.7, L * 0.08); c.stroke(); c.restore(); },
    helicoptero(c, r, lod, col, e) { heli(c, r, col, e, 1.6, 1.05, 0.1); }, heliSum(c, r, lod, col, e) { heli(c, r, col, e, 1.6, 1.05, 0.1, 'carga'); }, heliCarga(c, r, lod, col, e) { heli(c, r, col, e, 1.6, 1.05, 0.1, 'carga'); }, heliTropa(c, r, lod, col, e) { heli(c, r, col, e, 1.6, 1.05, 0.1, 'tropa'); },
    heliLigero(c, r, lod, col, e) { heli(c, r, col, e, 1.5, 0.95, 0.1, 'ligero'); },
    dronRec(c, r, lod, col, e) { quad(c, r, col, e); }, dronFpv(c, r, lod, col, e) { quad(c, r, col, e); }, dronBomba(c, r, lod, col, e) { quad(c, r, col, e); },
  };
  function escarapela(c, x, y, R, col) { disco(c, x, y, R, col.luz, col.osc); disco(c, x, y, R * 0.55, col.base); disco(c, x, y, R * 0.22, col.luz); }
  function avion(c, r, col, e, k) { const L = r * 1.8; c.save(); c.rotate(e.ang); c.strokeStyle = col.osc; c.globalAlpha = 0.5; c.lineWidth = 1; c.beginPath(); for (const s of [-1, 1]) { c.moveTo(-L * 0.05, s * L * 0.7); c.lineTo(-L * 0.05, s * L * 1.2); c.moveTo(L * 0.07, s * L * 0.2); c.lineTo(L * 0.07, s * L * 1.2); } c.stroke(); c.globalAlpha = 1; // alerones y larguero
    disco(c, L * 0.35, 0, L * 0.09, mezcla(col.osc, '#ffffff', 0.3)); escarapela(c, L * 0.07, -L * 0.95, L * 0.07, col); escarapela(c, L * 0.07, L * 0.95, L * 0.07, col); // la cúpula del satélite y las escarapelas
    if (k === 'dron') { c.fillStyle = TINTA; for (const s of [-1, 1]) c.fillRect(-L * 0.05, s * L * 0.5 - L * 0.025, L * 0.32, L * 0.05); } // dos misiles bajo el ala
    if (k === 'espia') { disco(c, L * 0.6, 0, L * 0.08, TINTA); disco(c, L * 0.62, -L * 0.02, L * 0.03, '#6fa8dc'); } // la bola de cámaras
    if (k === 'radio') { c.strokeStyle = TINTA; c.lineWidth = 1; c.beginPath(); for (const s of [-1, 1]) { c.moveTo(-L * 0.4, s * L * 0.1); c.lineTo(-L * 0.55, s * L * 0.3); } c.stroke(); }
    c.restore(); }
  function heli(c, r, col, e, kL, kR, cx, tipo) { const L = r * kL, T = tiempo / 1000; c.save(); c.rotate(e.ang);
    c.globalAlpha = 0.35; c.fillStyle = col.luz; c.beginPath(); c.ellipse(-L * 1.24, 0, L * 0.05, L * 0.32, 0, 0, TAU); c.fill(); c.globalAlpha = 1; // el rotor de cola, girando: de canto, una franja borrosa
    c.strokeStyle = col.osc; c.globalAlpha = 0.6; c.lineWidth = 1; c.beginPath(); c.moveTo(L * 0.32, -L * 0.22); c.lineTo(L * 0.32, L * 0.22); c.moveTo(L * 0.6, -L * 0.15); c.lineTo(L * 0.6, L * 0.15); c.stroke(); c.globalAlpha = 1; // marcos de la cabina
    for (const s of [-1, 1]) disco(c, -L * 0.25, s * L * 0.16, L * 0.06, TINTA); // escapes de las turbinas
    if (tipo === 'carga') { c.strokeStyle = TINTA; c.lineWidth = 1; c.beginPath(); c.moveTo(0, 0); c.lineTo(L * 0.05, L * 0.55); c.stroke(); caja(c, -L * 0.15, L * 0.5, L * 0.4, L * 0.3, K.saco); }
    if (tipo === 'tropa') { for (const s of [-1, 1]) { disco(c, L * 0.05, s * L * 0.36, L * 0.07, col.osc); c.strokeStyle = TINTA; c.beginPath(); c.moveTo(L * 0.05, s * L * 0.36); c.lineTo(L * 0.25, s * L * 0.5); c.stroke(); } } // tiradores en las puertas
    if (tipo === 'ligero') { c.fillStyle = TINTA; for (const s of [-1, 1]) for (let k = 0; k < 3; k++) disco(c, L * 0.37, s * L * 0.5 + (k - 1) * L * 0.035, L * 0.02, TINTA); }
    disco(c, L * cx, 0, L * 0.09, col.osc); disco(c, L * cx, 0, L * 0.04, METAL); // el buje del rotor
    c.restore(); void kR; void T; }
  function quad(c, r, col, e) { const L = r * 1.5; c.save(); c.rotate(e.ang); for (const [fx, fy] of [[-0.7, -0.7], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7]]) disco(c, L * fx, L * fy, L * 0.1, TINTA); disco(c, L * 0.3, 0, L * 0.07, '#6fa8dc'); disco(c, L * 0.7, -L * 0.7, L * 0.05, '#7fd36b'); disco(c, L * 0.7, L * 0.7, L * 0.05, col.mal); c.strokeStyle = TINTA; c.lineWidth = 1; c.beginPath(); for (const s of [-1, 1]) { c.moveTo(-L * 0.3, s * L * 0.15); c.lineTo(-L * 0.6, s * L * 0.3); } c.stroke(); c.restore(); }


  // ---------- el horno ----------
  const NF = 32, CUBOS = [36, 44, 54, 66, 80, 98, 120, 146, 178];
  const HORNEA_ENTERO = new Set(['camionSum', 'transporte', 'ambulancia', 'avanzadaMovil', 'patioMovil', 'tallerMovil', 'excavadora', 'comandoDrones', 'lanzacohetes', 'motoSum']);
  const CON_TORRE = new Set(['tanque', 'pesado', 'blindado', 'antiaereoMovil']);
  const cache = new Map(); let mem = 0, presupuesto = 0, hechas = 0, msHorno = 0; const LIMITE = 64 * 1048576;
  const dprH = () => Math.min(2, window.devicePixelRatio || 1);
  let azarS = 7; const az = () => { azarS = (azarS * 16807) % 2147483647; return azarS / 2147483647; };
  const GRANO = (() => { const o = document.createElement('canvas'); o.width = o.height = 96; const x = o.getContext('2d'); for (let i = 0; i < 2600; i++) { const v = az(); x.fillStyle = v < 0.7 ? 'rgba(0,0,0,' + (0.05 + az() * 0.25) + ')' : 'rgba(255,255,255,' + (0.05 + az() * 0.2) + ')'; x.fillRect(az() * 96, az() * 96, 1 + (az() < 0.1 ? 1 : 0), 1); } return o; })();
  const CAMO = new Map();
  function camo(col) { if (CAMO.has(col.base)) return CAMO.get(col.base); azarS = 7; const o = document.createElement('canvas'); o.width = o.height = 128; const x = o.getContext('2d'); for (let i = 0; i < 26; i++) { x.fillStyle = i % 2 ? mezcla(col.base, '#000000', 0.35) : mezcla(col.base, '#d8d0b0', 0.35); x.beginPath(); const cx = az() * 128, cy = az() * 128, R = 8 + az() * 16; for (let k = 0; k < 9; k++) { const b = k / 9 * TAU, q = R * (0.6 + az() * 0.6); x.lineTo(cx + Math.cos(b) * q, cy + Math.sin(b) * q * 0.7); } x.closePath(); x.fill(); } CAMO.set(col.base, o); return o; }
  function lienzo(S) { const d = dprH(), o = document.createElement('canvas'); o.width = o.height = Math.max(1, Math.ceil(S * d)); const x = o.getContext('2d'); x.setTransform(d, 0, 0, d, S / 2 * d, S / 2 * d); return [o, x]; }
  function acabado(o, col, conCamo) { const x = o.getContext('2d'), n = o.width; x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = 'source-atop';
    if (conCamo) { x.globalAlpha = 0.3; x.fillStyle = x.createPattern(camo(col), 'repeat'); x.fillRect(0, 0, n, n); }
    x.globalAlpha = 0.3; x.fillStyle = x.createPattern(GRANO, 'repeat'); x.fillRect(0, 0, n, n);
    x.globalAlpha = 1; const g = x.createLinearGradient(n * 0.2, n * 0.2, n * 0.8, n * 0.8); g.addColorStop(0, 'rgba(255,250,235,0.16)'); g.addColorStop(0.5, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(10,20,40,0.2)'); x.fillStyle = g; x.fillRect(0, 0, n, n); x.globalCompositeOperation = 'source-over'; return o; }
  function silueta(o, blur) { const s = document.createElement('canvas'); s.width = o.width; s.height = o.height; const x = s.getContext('2d'); x.filter = 'brightness(0) blur(' + blur.toFixed(1) + 'px)'; x.drawImage(o, 0, 0); return s; } // la sombra: la silueta en negro y desenfocada
  const cubo = (z) => { for (const b of CUBOS) if (z <= b * 1.1) return b; return CUBOS[CUBOS.length - 1]; };
  function st0(o) { return Object.assign({ ang: 0, angT: 0, retro: 0, anda: false, tiempo: 0, carga: 0, cosecha: false, raro: false, marcha: 0, fI: 0, fD: 0, rod: 0, dir: 0, hx: 0, hy: 0, fino: true, id: 1 }, o); }
  function hornea(tipo, colK, ladoK, j, zb, f, parte) { // una imagen: casco (con su canto) o torreta, en la orientación f
    const t0 = performance.now(), u = W.UNID[tipo], r = u.radio * zb, a = f / NF * TAU, canto = Math.max(1, r * 0.26), col = Object.assign({}, BASE, colK); K = col;
    const S = Math.ceil(r * (parte === 'torre' ? (tipo === 'pesado' || tipo === 'tanque' ? 4.6 : 3.4) : 3.8) + canto * 2 + 6), [o, x] = lienzo(S), e = st0({ ang: a, angT: a });
    if (parte === 'torre') { x.translate(0, -canto); if (tipo === 'tanque' || tipo === 'pesado') carro(x, r, 2, col, e, tipo === 'pesado', 'torre'); else if (tipo === 'blindado') REDO.blindadoP(x, r, 2, col, e, 'torre'); else REDO.antiaereoMovil(x, r, 2, col, e, 'torre'); }
    else { W.fichaUnidad(x, { tipo, id: 1, j }, r, 1, ladoK, e); x.translate(0, -canto); // el canto: la silueta en el tono del lado, y encima el cuerpo
      if (tipo === 'tanque' || tipo === 'pesado') carro(x, r, 2, col, e, tipo === 'pesado', 'casco'); else if (tipo === 'blindado') REDO.blindadoP(x, r, 2, col, e, 'casco'); else if (tipo === 'antiaereoMovil') REDO.antiaereoMovil(x, r, 2, col, e, 'casco');
      else if (REDO[tipo]) REDO[tipo](x, r, 2, col, e); else { W.fichaUnidad(x, { tipo, id: 1, j }, r, 2, col, e); if (EXTRA[tipo]) EXTRA[tipo](x, r, 2, col, e); } }
    acabado(o, col, u.cat === 'veh' && tipo !== 'ambulancia' && tipo !== 'avanzadaMovil');
    const sombra = parte === 'torre' ? null : silueta(o, Math.max(1, r * 0.12 * dprH()));
    msHorno += performance.now() - t0; hechas++;
    return { img: o, sombra, S, zb, bytes: o.width * o.height * 4 * (sombra ? 2 : 1) };
  }
  function pide(tipo, colK, ladoK, j, z, f, parte) {
    const zb = cubo(z), k = tipo + '|' + colK.base + '|' + ladoK.base + '|' + zb + '|' + f + '|' + parte; let q = cache.get(k);
    if (q) { cache.delete(k); cache.set(k, q); return q; } // la más reciente, al final: la que se tira es la que lleva más tiempo sin usarse
    if (presupuesto <= 0) return null; presupuesto--;
    q = hornea(tipo, colK, ladoK, j, zb, f, parte); cache.set(k, q); mem += q.bytes;
    for (const [kk, v] of cache) { if (mem <= LIMITE) break; cache.delete(kk); mem -= v.bytes; }
    return q;
  }
  W.horno = {
    activo: (() => { try { return localStorage.getItem('rts.horno') !== 'no'; } catch (_) { return true; } })(),
    tiene: (tipo) => CON_TORRE.has(tipo) || HORNEA_ENTERO.has(tipo),
    cuadro() { presupuesto = 4; }, // cuántas imágenes nuevas se hornean como mucho en un cuadro: así no se nota
    // Dibuja la unidad ya horneada en el contexto trasladado a su centro. Devuelve false si aún no está: entonces se dibuja como siempre.
    dibuja(ctx, e, r, z, ang, angT, col, lado, st, sox, soy) {
      const f = ((Math.round(ang / TAU * NF) % NF) + NF) % NF, cas = pide(e.tipo, col, lado, e.j, z, f, 'casco'); if (!cas) return false;
      let tor = null; if (CON_TORRE.has(e.tipo)) { const g = ((Math.round(angT / TAU * NF) % NF) + NF) % NF; tor = pide(e.tipo, col, lado, e.j, z, g, 'torre'); if (!tor) return false; }
      const k = z / cas.zb, S = cas.S * k, hx = st.hx || 0, hy = st.hy || 0;
      ctx.globalAlpha = 0.42; ctx.drawImage(cas.sombra, -S / 2 + sox, -S / 2 + soy, S, S); ctx.globalAlpha = 1; // la sombra cae según la hora
      ctx.drawImage(cas.img, -S / 2 + hx, -S / 2 + hy, S, S);
      if (tor) { const ST = tor.S * k, rec = (st.retro || 0) * r * 0.35, rx = -Math.cos(angT) * rec + hx, ry = -Math.sin(angT) * rec + hy; ctx.drawImage(tor.img, -ST / 2 + rx, -ST / 2 + ry, ST, ST);
        if ((st.retro || 0) > 0.6) { const L = r * (e.tipo === 'blindado' ? 1.3 : e.tipo === 'antiaereoMovil' ? 1.85 : 2.1), cn = Math.max(1, r * 0.26); ctx.fillStyle = '#e8912d'; ctx.beginPath(); ctx.arc(Math.cos(angT) * L + rx, Math.sin(angT) * L - cn + ry, r * 0.34, 0, TAU); ctx.fill(); } } // el fogonazo, en vivo
      return true;
    },
    info: () => ({ imagenes: cache.size, mb: mem / 1048576, hechas, msHorno }),
    vacia() { cache.clear(); mem = 0; },
    cambia(v) { this.activo = v; try { localStorage.setItem('rts.horno', v ? 'si' : 'no'); } catch (_) {} },
  };
})();
