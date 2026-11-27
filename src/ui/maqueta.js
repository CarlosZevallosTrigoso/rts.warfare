// Nivel 100, segunda parte: edificios (B), suelo (C), luz (D) y efectos (E). Todo es dibujo: la simulación no lo conoce.
// B · Edificios: cada uno con el detalle de maqueta (luz en cada caja y cilindro, chapa, equipos de techo, lo añadido a mano,
//     grano y churretes), dibujado en vivo: todo lo que se mueve en ellos sigue a su ritmo. Cables y oleoductos, con volumen.
// C · Suelo: una textura fija al mundo (manchas, piedritas, matas y grano) y la memoria: rodadas, cráteres y quemaduras
//     se estampan en trozos del mapa y se quedan toda la partida.
// D · Luz: de noche el mapa se multiplica por un tono (cálido al atardecer, azul de noche) y las luces se suman con imágenes
//     horneadas: faros en 32 rumbos, ventanas encendidas, fogonazos y explosiones.
// E · Efectos: el humo y el polvo son bocanadas horneadas, no círculos lisos; los fogonazos llevan su resplandor.
(function () {
  'use strict';
  const W = globalThis.W, TAU = Math.PI * 2, H = W.horno, TINTA = '#1a1a1a';
  const CAPA = H.capas = { edificios: true, grano: true, luzCajas: true, auto: true, mas: true, cil: true, cables: true, suelo: true, memoria: true, luz: true, efectos: true }; // para medir cada capa por separado
  const dprH = () => Math.min(2, window.devicePixelRatio || 1);
  let azS = 13; const az = () => { azS = (azS * 16807) % 2147483647; return azS / 2147483647; };
  const lienzo = (w, h) => { const o = document.createElement('canvas'); o.width = Math.max(1, Math.ceil(w)); o.height = Math.max(1, Math.ceil(h)); return [o, o.getContext('2d')]; };
  const rgb = (s) => { if (s[0] === '#') return [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16)); return s.match(/\d+/g).slice(0, 3).map(Number); };
  const rgba = (s, a) => 'rgba(' + rgb(s).join(',') + ',' + a + ')';
  const disco = (c, x, y, R, fill) => { c.moveTo(x + R, y); c.arc(x, y, R, 0, TAU); void fill; };

  // ================= B · edificios =================
  // Muchas rayas del mismo estilo en un solo trazo: dentro de f, k.linea solo añade su tramo al camino. Es lo que más ahorra.
  function tanda(k, cl, w, f) { const c = k.c, l0 = k.linea; c.beginPath(); k.linea = (pts) => { pts.forEach(([x, y], i) => (i ? c.lineTo(k.X(x), k.Y(y)) : c.moveTo(k.X(x), k.Y(y)))); }; f(); k.linea = l0; c.strokeStyle = cl; c.lineWidth = (w || 1) * k.lw; c.stroke(); }
  W.kitMaqueta = function (k, c, col, tipo) { // el kit de siempre, con luz y piezas en cada caja y cada cilindro
    k.c = c; k.sinAuto = !!MAS[tipo]; const caja = k.caja, cil = k.cil; acabadoEdif(k, c);
    k.caja = (x, y, w, h, a, fill, sto) => { caja(x, y, w, h, a, fill, sto); if (w * h < 0.03) return; const X0 = k.X(x), Y0 = k.Y(y), W0 = w * k.u, H0 = h * k.u;
      const g = c.createLinearGradient(X0, Y0, X0 + W0, Y0 + H0); g.addColorStop(0, 'rgba(255,255,255,0.24)'); g.addColorStop(0.5, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,0.13)'); c.fillStyle = g; if (CAPA.luzCajas) c.fillRect(X0, Y0, W0, H0); if (k.acab && w * h >= 0.1) { c.globalAlpha = 0.7; c.fillStyle = k.acab; c.fillRect(X0, Y0, W0, H0); c.globalAlpha = 1; }
      c.strokeStyle = 'rgba(255,255,255,0.55)'; c.lineWidth = 1; c.beginPath(); c.moveTo(X0 + 1, Y0 + H0 - 1); c.lineTo(X0 + 1, Y0 + 1); c.lineTo(X0 + W0 - 1, Y0 + 1); c.stroke(); // el canto que mira a la luz
      if (CAPA.auto && !k.sinAuto && a >= 0.12 && Math.min(w, h) >= 0.34 && w * h >= 0.2) { const m = 0.045, hor = w >= h; c.strokeStyle = 'rgba(0,0,0,0.2)'; c.strokeRect(k.X(x + m), k.Y(y + m), (w - 2 * m) * k.u, (h - 2 * m) * k.u); // el pretil
        k.c.save(); k.c.globalAlpha = 0.13; tanda(k, TINTA, 0.6, () => { if (hor) { for (let q = x + 0.08; q < x + w - 0.05; q += 0.07) k.linea([[q, y + m], [q, y + h - m]]); } else { for (let q = y + 0.08; q < y + h - 0.05; q += 0.07) k.linea([[x + m, q], [x + w - m, q]]); } }); k.c.restore(); // la chapa
        const n = Math.max(1, Math.min(3, Math.floor((hor ? w : h) / 0.42))); for (let i = 0; i < n; i++) { const ex = hor ? x + w * (i + 0.5) / n - 0.07 : x + 0.08, ey = hor ? y + 0.08 : y + h * (i + 0.5) / n - 0.05; caja(ex, ey, 0.14, 0.1, 0.04, col.horm); k.aspas(ex + 0.07, ey + 0.05, 0.035, k.on ? k.T * 6 + i + x : i, 3, col.osc, 0.8); } // equipos de techo en fila, junto al borde
        if (w * h > 0.5) { const lx = hor ? x + w * 0.2 : x + w * 0.45, ly = hor ? y + h * 0.48 : y + h * 0.2, lw = hor ? w * 0.6 : 0.1, lh = hor ? 0.1 : h * 0.6; k.rect(lx, ly, lw, lh, 'rgba(255,255,255,0.45)'); k.linea([[lx, ly], [lx + lw, ly], [lx + lw, ly + lh], [lx, ly + lh], [lx, ly]], col.osc, 0.5); } } }; // y un lucernario en los grandes
    k.cil = (x, y, r, a, fill, sto) => { cil(x, y, r, a, fill, sto); if (!CAPA.cil || r < 0.08) return; const X0 = k.X(x), Y0 = k.Y(y), R = r * k.u, g = c.createRadialGradient(X0 - R * 0.35, Y0 - R * 0.35, R * 0.08, X0, Y0, R); g.addColorStop(0, 'rgba(255,255,255,0.4)'); g.addColorStop(0.6, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,0.15)'); c.fillStyle = g; c.beginPath(); c.arc(X0, Y0, R, 0, TAU); c.fill(); if (k.acab && r >= 0.15) { c.globalAlpha = 0.7; c.fillStyle = k.acab; c.fill(); c.globalAlpha = 1; }
      if (r >= 0.15) { c.strokeStyle = 'rgba(0,0,0,0.16)'; c.lineWidth = 1; c.beginPath(); c.arc(X0, Y0, R * 0.78, 0, TAU); c.stroke(); if (a > 0.1) { c.strokeStyle = col.osc; c.globalAlpha = 0.6; c.beginPath(); c.moveTo(X0 + R * 0.7, Y0 + R * 0.3); c.lineTo(X0 + R, Y0 + R * 0.42); c.moveTo(X0 + R * 0.62, Y0 + R * 0.44); c.lineTo(X0 + R * 0.92, Y0 + R * 0.56); c.stroke(); c.globalAlpha = 1; } } }; // costura y una escalerilla
  };
  function chapa(k, x, y, w, h, hor, paso, al) { k.c.save(); k.c.globalAlpha = al || 0.28; tanda(k, TINTA, 0.6, () => { if (hor) { for (let q = x + paso; q < x + w; q += paso) k.linea([[q, y], [q, y + h]]); } else { for (let q = y + paso; q < y + h; q += paso) k.linea([[x, q], [x + w, q]]); } }); k.c.restore(); }
  function extractor(k, x, y, col) { k.cil(x, y, 0.06, 0.06, col.horm); k.aspas(x, y, 0.05, k.on ? k.T * 5 + x : 0.4, 3, col.osc, 1); }
  function equipoAC(k, x, y, col) { k.caja(x, y, 0.16, 0.12, 0.05, col.horm); k.aro(x + 0.08, y + 0.06, 0.04, col.osc, 0.8); k.aspas(x + 0.08, y + 0.06, 0.035, k.on ? k.T * 9 + y : 0, 3, col.osc, 0.8); }
  const MAS = { // a mano, en los que más se ven
    patio(k, s, col) { chapa(k, 0.25, 0.65, 1.75, 1.55, true, 0.08, 0.14); for (const x of [1.25, 1.5, 1.75]) equipoAC(k, x, 0.75, col); k.sombraL(1.55, 1.15, 1.55, 1.15, 2.6, 1.1); k.cil(1.55, 1.15, 0.03, 0, col.osc); for (const [dx, dy] of [[-0.25, -0.2], [0.25, -0.15], [0.1, 0.25]]) k.linea([[1.55, 1.15], [1.55 + dx, 1.15 + dy]], col.osc, 0.5); k.baliza(1.55, 1.15, col.mal, 0.7);
      for (let i = 0; i < 5; i++) k.linea([[0.3 + i * 0.32, 2.35], [0.3 + i * 0.32, 2.75]], 'rgba(255,255,255,0.85)', 1); k.carro(0.62, 2.55, Math.PI / 2, 0.3, 0.16, col.base, true); for (const x of [2.85, 0.1]) { k.sombraL(x, 2.9, x, 2.9, 2.2, 1); k.cil(x, 2.9, 0.03, 0, col.osc); k.punto(x, 2.9, 0.05, k.on ? 'rgba(246,211,107,0.9)' : col.humo); } },
    refineria(k, s, col) { for (const x of [0.72, 1.78]) { tanda(k, 'rgba(0,0,0,0.12)', 0.5, () => { for (let i = 0; i < 10; i++) { const b = i / 10 * TAU; k.linea([[x + Math.cos(b) * 0.12, 0.72 + Math.sin(b) * 0.12], [x + Math.cos(b) * 0.42, 0.72 + Math.sin(b) * 0.42]]); } }); k.aro(x, 0.72, 0.42, col.osc, 0.8, 0.6, 1.6); k.cil(x + 0.3, 1.08, 0.05, 0, '#b0362f'); }
      k.linea([[0.95, 0.68], [1.55, 0.68]], col.osc, 0.6); k.linea([[0.95, 0.76], [1.55, 0.76]], col.osc, 0.6); for (const [x, y] of [[1.2, 0.72], [2.2, 0.72], [2.55, 1.1], [1.5, 1.4], [1.5, 1.9]]) k.punto(x, y, 0.05, col.osc);
      k.cil(2.55, 1.75, 0.07, 1.2, col.osc); if (k.on) k.fuego(2.55, 1.75, 0.08); chapa(k, 0.22, 1.4, 0.36, 1.35, false, 0.08, 0.2); },
    hospital(k, s, col) { for (const [x, y] of [[0.85, 0.3], [1.55, 0.85], [0.3, 0.85]]) equipoAC(k, x, y, col); for (let i = 0; i < 5; i++) { k.rect(0.74 + i * 0.1, 0.18, 0.05, 0.03, col.claro); k.rect(0.74 + i * 0.1, 1.79, 0.05, 0.03, col.claro); }
      for (const [x, y] of [[0.3, 0.3], [1.7, 0.3], [0.3, 1.7]]) { k.punto(x, y, 0.13, '#6f8a52'); k.punto(x - 0.04, y - 0.04, 0.06, '#58703f'); } k.linea([[0.15, 1.45], [0.6, 1.45], [0.6, 1.9]], 'rgba(255,255,255,0.85)', 1); },
    aerodromo(k, s, col) { const c = k.c; c.save(); c.translate(k.X(1.5), k.Y(1.5)); c.rotate(-0.5); const u = k.u; for (let i = -6; i <= 6; i++) for (const sy of [-1, 1]) { c.fillStyle = k.on ? '#f6d36b' : col.humo; c.beginPath(); c.arc(i * u * 0.2, sy * u * 0.36, Math.max(0.8, u * 0.02), 0, TAU); c.fill(); } c.fillStyle = col.luz; for (const sx of [-1, 1]) for (let i = -3; i <= 3; i++) c.fillRect(sx * u * 1.22 - u * 0.04, i * u * 0.08 - u * 0.025, u * 0.08, u * 0.05); c.restore(); // luces de borde y franjas de cabecera
      chapa(k, 0.2, 0.2, 0.9, 0.275, true, 0.07, 0.25); chapa(k, 0.2, 0.475, 0.9, 0.275, true, 0.07, 0.18); k.linea([[1.1, 0.75], [1.4, 1.1], [1.5, 1.3]], '#e0b83a', 1, [0.06, 0.05]); k.carro(2.3, 0.55, 0.4, 0.3, 0.14, '#e0b83a', col.osc); },
    inteligencia(k, s, col) { for (const x of [0.4, 0.75, 1.1]) equipoAC(k, x, 1.08, col); for (const [x, y] of [[1.45, 1.1], [1.6, 1.15], [1.72, 1.08]]) { k.sombraL(x, y, x, y, 1.6, 0.8); k.linea([[x, y], [x + 0.04, y - 0.12]], col.osc, 0.7); }
      tanda(k, 'rgba(0,0,0,0.15)', 0.5, () => { for (let i = 0; i < 8; i++) { const b = i / 8 * TAU; k.linea([[0.7 + Math.cos(b) * 0.25, 0.62 + Math.sin(b) * 0.25], [0.7 + Math.cos(b) * 0.4, 0.62 + Math.sin(b) * 0.4]]); } }); k.linea([[0.18, 1.88], [1.82, 1.88]], col.horm2, 1.6); },
    laboratorio(k, s, col) { k.linea([[1.52, 0.32], [1.52, 0.92]], col.osc, 1.4); for (const [x, y] of [[0.4, 0.62], [0.95, 0.62]]) { k.cil(x, y, 0.06, 0.12, col.horm); k.punto(x, y, 0.025, col.tinta); } k.linea([[1.28, 1.45], [1.23, 1.45]], col.horm2, 2.2); k.linea([[1.52, 1.21], [1.52, 0.94]], col.horm2, 1.6); },
    logistica(k, s, col) { for (let i = 0; i < 8; i++) { const b = i / 8 * TAU; k.baliza(0.72 + Math.cos(b) * 0.52, 1.24 + Math.sin(b) * 0.52, '#f6d36b', 0.6); } k.c.fillStyle = '#4f5a3c'; W.auxF.rr(k.c, k.X(1.3), k.Y(1.55), 0.45 * k.u, 0.3 * k.u, 0.1 * k.u); k.c.fill(); k.linea([[1.3, 1.7], [1.75, 1.7]], 'rgba(0,0,0,0.3)', 0.6); chapa(k, 1.25, 0.15, 0.3, 0.5, false, 0.07, 0.25); },
    almacen(k, s, col) { chapa(k, 0.18, 0.2, 1.64, 0.525, true, 0.07, 0.2); chapa(k, 0.18, 0.725, 1.64, 0.525, true, 0.07, 0.14); for (const x of [0.35, 0.85, 1.35]) k.rect(x, 0.42, 0.3, 0.08, 'rgba(255,255,255,0.5)'); for (const x of [0.3, 1.35]) { k.rect(x, 1.22, 0.32, 0.05, col.osc); for (let i = 1; i < 4; i++) k.linea([[x + i * 0.08, 1.22], [x + i * 0.08, 1.27]], col.claro, 0.5); } },
    radar(k, s, col) { tanda(k, 'rgba(255,255,255,0.15)', 0.6, () => { for (let i = 0; i < 12; i++) { const b = i / 12 * TAU; k.linea([[1 + Math.cos(b) * 0.38, 1 + Math.sin(b) * 0.38], [1 + Math.cos(b) * 0.6, 1 + Math.sin(b) * 0.6]]); } }); k.aro(1, 1, 0.82, col.horm2, 1, 0, TAU); k.c.save(); k.c.setLineDash([3, 3]); k.aro(1, 1, 0.86, col.osc, 0.6); k.c.restore(); k.linea([[0.52, 1.67], [0.75, 1.45]], col.horm2, 1.4); k.punto(0.2, 1.55, 0.04, col.tinta); },
    cuartel(k, s, col) {
      for (const y of [0.18, 0.74]) { chapa(k, 0.15, y, 1.12, 0.21, true, 0.06); chapa(k, 0.15, y + 0.21, 1.12, 0.21, true, 0.06, 0.18); for (const x of [0.4, 0.71, 1.02]) extractor(k, x, y + 0.21, col); k.caja(0.3, y + 0.42, 0.14, 0.05, 0.04, col.osc); k.caja(0.98, y + 0.42, 0.14, 0.05, 0.04, col.osc); }
      equipoAC(k, 1.47, 0.48, col); equipoAC(k, 1.47, 0.66, col); k.sombraL(1.74, 0.36, 1.74, 0.36, 2.2, 1.1); k.cil(1.74, 0.36, 0.035, 0, col.osc); k.linea([[1.74, 0.36], [1.64, 0.26]], col.osc, 0.7); k.cil(1.76, 0.86, 0.07, 0.08, col.luz);
      k.linea([[0.55, 1.42], [1.3, 1.42], [1.3, 1.9], [0.55, 1.9], [0.55, 1.42]], 'rgba(255,255,255,0.9)', 1.2); k.linea([[0.92, 1.42], [0.92, 1.9]], 'rgba(255,255,255,0.7)', 0.8);
      for (let i = 0; i < 7; i++) { const b = Math.PI * (0.15 + i * 0.12); k.cil(1.55 + Math.cos(b) * 0.22, 1.68 - Math.sin(b) * 0.22, 0.05, 0.04, col.saco, '#8f8160'); }
      k.carro(0.32, 1.88, 0, 0.3, 0.16, col.base, true); },
    fabrica(k, s, col) {
      for (let i = 0; i < 4; i++) { const x = 0.2 + i * 0.52; tanda(k, col.osc, 0.6, () => { for (let y = 0.44; y < 1.84; y += 0.14) k.linea([[x + 0.03, y], [x + 0.18, y]]); }); chapa(k, x + 0.18, 0.3, 0.34, 1.62, false, 0.07, 0.22); extractor(k, x + 0.36, 0.62, col); extractor(k, x + 0.36, 1.42, col); }
      k.linea([[0.2, 1.98], [2.28, 1.98]], col.osc, 0.8); tanda(k, '#e0b83a', 2.4, () => { for (let x = 0.24; x < 2.2; x += 0.16) k.linea([[x, 1.98], [x + 0.08, 1.98]]); });
      if (s.activo && Math.sin(k.T * 23) > 0.2) { k.punto(1.32 + Math.sin(k.T * 3) * 0.2, 1.97, 0.04, '#fff6c8'); k.punto(1.32 + Math.sin(k.T * 3) * 0.2, 1.97, 0.07, 'rgba(255,230,150,0.35)'); }
      for (let y = 2.05; y < 2.85; y += 0.2) k.linea([[1.02, y], [1.98, y]], 'rgba(224,184,58,0.7)', 0.8, [0.08, 0.06]);
      k.linea([[2.1, 0.4], [2.1, 1.85]], col.horm2, 2.2); for (let y = 0.5; y < 1.85; y += 0.25) k.punto(2.1, y, 0.03, col.osc); },
    central(k, s, col) {
      for (const x of [0.48, 1.3]) { tanda(k, 'rgba(0,0,0,0.12)', 0.6, () => { for (let i = 0; i < 16; i++) { const b = i / 16 * TAU; k.linea([[x + Math.cos(b) * 0.23, 0.48 + Math.sin(b) * 0.23], [x + Math.cos(b) * 0.35, 0.48 + Math.sin(b) * 0.35]]); } }); k.aro(x, 0.48, 0.22, '#7c858d', 1.4); }
      chapa(k, 0.15, 1.0, 1.15, 0.41, true, 0.07); k.rect(0.2, 1.37, 1.05, 0.07, col.claro); tanda(k, col.osc, 0.5, () => { for (let x = 0.24; x < 1.25; x += 0.1) k.linea([[x, 1.37], [x, 1.44]]); });
      for (const x of [0.35, 0.72, 1.09]) extractor(k, x, 1.62, col);
      for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) k.punto(1.5 + j * 0.09, 1.18 + i * 0.16, 0.025, col.horm); for (const y of [1.18, 1.34, 1.5]) k.linea([[1.48, y], [1.8, y]], col.horm, 0.6);
      for (const x of [0.48, 1.3]) k.linea([[x, 0.84], [x, 1.0]], col.horm2, 2.6); },
  };

  // El acabado de los edificios: grano de pintura y churretes de lluvia en una loseta que se repite, a píxel de pantalla,
  // anclada a la esquina de cada edificio (así no resbala al mover el mapa). Va sobre cada caja y cada cilindro.
  const ACAB = (() => { azS = 5; const n = 192, [o, x] = lienzo(n, n); for (let i = 0; i < 9000; i++) { x.fillStyle = az() < 0.7 ? 'rgba(0,0,0,' + (0.04 + az() * 0.2) + ')' : 'rgba(255,255,255,' + (0.05 + az() * 0.18) + ')'; x.fillRect(az() * n | 0, az() * n | 0, 1, 1); }
    for (let i = 0; i < 18; i++) { const px = az() * n | 0, py = az() * n, l = 12 + az() * 26, g = x.createLinearGradient(0, 0, 0, l); g.addColorStop(0, 'rgba(60,50,40,0.2)'); g.addColorStop(1, 'rgba(60,50,40,0)'); x.fillStyle = g; for (const dy of [0, -n]) { x.save(); x.translate(px, py + dy); x.fillRect(0, 0, 1 + (az() * 2 | 0), l); x.restore(); } } return o; })(); // y los churretes, de arriba abajo
  const patAcab = new WeakMap();
  function acabadoEdif(k, c) { if (!CAPA.grano) return; let p = patAcab.get(c); if (!p) { p = c.createPattern(ACAB, 'repeat'); patAcab.set(c, p); } const d = c.getTransform().a || 1; p.setTransform(new DOMMatrix([1 / d, 0, 0, 1 / d, Math.round(k.X(0) * d) / d, Math.round(k.Y(0) * d) / d])); k.acab = p; }
  // Los edificios de maqueta se dibujan en vivo (todo en ellos se mueve a su ritmo): el kit de siempre con el detalle añadido.
  // Probado: hornearlos doce veces por segundo costaba de 1 a 9 ms más por cuadro; en vivo, medio milisegundo.
  H.edificio = function (ctx, e, px, py, t, lod, col, est) {
    if (!H.activo || !CAPA.edificios || lod !== 2 || !W.EDIF_VOL[e.tipo]) return false;
    est.maqueta = true; W.fichaEdificio(ctx, e, px, py, t, lod, col, est); return true;
  };
  const VIVO_E = new Set(['torreta', 'antiaerea', 'torreCanon', 'nidoMG', 'artFija', 'camara', 'vigia']); // defensas: sin ventanas
  // Ventanas encendidas de noche: unas pocas luces cálidas por edificio, siempre en el mismo sitio.
  H.ventanas = function (e, px, py, t, z, est, luces) {
    if (!H.activo || est.deficit || VIVO_E.has(e.tipo) || !W.EDIF_VOL[e.tipo] || e.tipo === 'deposito' || e.tipo === 'mina') return;
    for (let i = 0; i < e.tam; i++) { const a = Math.sin(e.id * 12.9898 + i * 78.233) * 43758.5453, b = Math.sin(e.id * 39.346 + i * 11.135) * 24634.6345, fx = 0.2 + (a - Math.floor(a)) * 0.6, fy = 0.2 + (b - Math.floor(b)) * 0.6; luces.push([px + fx * t, py + fy * t, 0, 3, z * 0.6]); }
  };

  // Cables y oleoductos con volumen: postes con cruceta y aisladores, dos hilos, y sus sombras; el tubo sobre soportes, con bridas.
  // Todo en pocas pasadas (un trazo por estilo para todas las piezas a la vista), que es lo que cuesta.
  const SV = [0.7 * 0.32, 0.75 * 0.32];
  H.lineas = function (ctx, lineas, ox, oy, z, verRed, rota, colMal, T, fuera) {
    if (!H.activo || !CAPA.cables || z < 16) return false;
    const X = (v) => ox + v * z, Y = (v) => oy + v * z, A = 0.13, Hp = 0.55, hm = Hp * 0.35, piezas = [];
    for (const e of lineas) { const p = e.pts; if (fuera(p[0], p[1]) && fuera(p[2], p[3]) && fuera((p[0] + p[2]) / 2, (p[1] + p[3]) / 2)) continue; const dx = p[2] - p[0], dy = p[3] - p[1], L = Math.hypot(dx, dy) || 1; piezas.push({ p, dx, dy, nx: -dy / L, ny: dx / L, n: Math.max(1, Math.round(L / 2)), mal: rota(e) }); }
    if (!piezas.length) return true;
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.13)'; ctx.lineWidth = 1; ctx.beginPath(); // la sombra de los hilos: cuelgan entre poste y poste
    for (const q of piezas) for (let k = 0; k < q.n; k++) { const ax = q.p[0] + q.dx * k / q.n, ay = q.p[1] + q.dy * k / q.n, bx = ax + q.dx / q.n, by = ay + q.dy / q.n; for (const o of [-A, A]) { const sx = SV[0] * Hp, sy = SV[1] * Hp, mx = (ax + bx) / 2 + q.nx * o + SV[0] * (2 * hm - Hp), my = (ay + by) / 2 + q.ny * o + SV[1] * (2 * hm - Hp); ctx.moveTo(X(ax + q.nx * o + sx), Y(ay + q.ny * o + sy)); ctx.quadraticCurveTo(X(mx), Y(my), X(bx + q.nx * o + sx), Y(by + q.ny * o + sy)); } }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.lineWidth = Math.max(1, z * 0.05); ctx.beginPath(); // la sombra de los postes
    for (const q of piezas) for (let k = 0; k <= q.n; k++) { const x = q.p[0] + q.dx * k / q.n, y = q.p[1] + q.dy * k / q.n; ctx.moveTo(X(x), Y(y)); ctx.lineTo(X(x + SV[0] * Hp), Y(y + SV[1] * Hp)); }
    ctx.stroke();
    for (const mal of [false, true]) { ctx.strokeStyle = mal ? colMal : verRed ? '#2a2a2a' : 'rgba(30,30,30,0.72)'; ctx.lineWidth = verRed || mal ? 1.4 : 1; ctx.beginPath(); // los hilos
      for (const q of piezas) { if (q.mal !== mal) continue; for (const o of [-A, A]) { ctx.moveTo(X(q.p[0] + q.nx * o), Y(q.p[1] + q.ny * o)); ctx.lineTo(X(q.p[2] + q.nx * o), Y(q.p[3] + q.ny * o)); } }
      ctx.stroke(); }
    ctx.strokeStyle = '#5a4a38'; ctx.lineWidth = Math.max(1.2, z * 0.04); ctx.beginPath(); // las crucetas
    for (const q of piezas) for (let k = 0; k <= q.n; k++) { const x = q.p[0] + q.dx * k / q.n, y = q.p[1] + q.dy * k / q.n; ctx.moveTo(X(x - q.nx * 0.17), Y(y - q.ny * 0.17)); ctx.lineTo(X(x + q.nx * 0.17), Y(y + q.ny * 0.17)); }
    ctx.stroke();
    ctx.fillStyle = '#6b5a45'; ctx.beginPath(); for (const q of piezas) for (let k = 0; k <= q.n; k++) disco(ctx, X(q.p[0] + q.dx * k / q.n), Y(q.p[1] + q.dy * k / q.n), Math.max(1.6, z * 0.07)); ctx.fill(); // los postes
    ctx.fillStyle = '#ece8de'; ctx.beginPath(); for (const q of piezas) for (let k = 0; k <= q.n; k++) for (const o of [-A, A]) disco(ctx, X(q.p[0] + q.dx * k / q.n + q.nx * o), Y(q.p[1] + q.dy * k / q.n + q.ny * o), Math.max(1, z * 0.028)); ctx.fill(); // los aisladores
    if (verRed) { ctx.fillStyle = '#f2c14e'; ctx.beginPath(); for (const q of piezas) { if (q.mal) continue; for (let k = 0; k < q.n; k++) for (let s = 0; s < 2; s++) { const f = (T * 0.8 + s / 2 + k * 0.13) % 1, x = q.p[0] + q.dx * (k + f) / q.n, y = q.p[1] + q.dy * (k + f) / q.n; for (const o of [-A, A]) disco(ctx, X(x + q.nx * o), Y(y + q.ny * o), Math.max(1.5, z * 0.035)); } } ctx.fill(); } // la corriente que pasa
    ctx.lineCap = 'butt'; return true;
  };
  H.tubos = function (ctx, tubos, ox, oy, z, verRed, T, fuera, veo) {
    if (!H.activo || !CAPA.cables || z < 16) return false;
    const X = (v) => ox + v * z, Y = (v) => oy + v * z, R = 0.085, Hp = 0.22, piezas = [];
    for (const e of tubos) { if (!veo(e)) continue; const p = e.pts; if (fuera(p[0], p[1]) && fuera(p[2], p[3])) continue; const dx = p[2] - p[0], dy = p[3] - p[1], L = Math.hypot(dx, dy) || 1; let nx = -dy / L, ny = dx / L; if (nx + ny > 0) { nx = -nx; ny = -ny; } piezas.push({ p, ux: dx / L, uy: dy / L, nx, ny, L }); }
    if (!piezas.length) return true;
    const pasa = (cl, w, f) => { ctx.strokeStyle = cl; ctx.lineWidth = w; ctx.beginPath(); for (const q of piezas) f(q); ctx.stroke(); };
    const seg = (x0, y0, x1, y1) => { ctx.moveTo(X(x0), Y(y0)); ctx.lineTo(X(x1), Y(y1)); };
    pasa('rgba(0,0,0,0.15)', 2 * R * z, (q) => seg(q.p[0] + SV[0] * Hp, q.p[1] + SV[1] * Hp, q.p[2] + SV[0] * Hp, q.p[3] + SV[1] * Hp)); // su sombra, separada: va en alto
    pasa('#5e5140', Math.max(1.5, z * 0.05), (q) => { for (let d = 0.6; d < q.L; d += 1.4) { const x = q.p[0] + q.ux * d, y = q.p[1] + q.uy * d; seg(x - q.nx * R * 1.6, y - q.ny * R * 1.6, x + q.nx * R * 1.6, y + q.ny * R * 1.6); } }); // los soportes
    pasa('#8a7a62', 2 * R * z, (q) => seg(q.p[0], q.p[1], q.p[2], q.p[3])); // el tubo
    pasa('#5e5140', Math.max(1, z * 0.025), (q) => seg(q.p[0] - q.nx * R * 0.85, q.p[1] - q.ny * R * 0.85, q.p[2] - q.nx * R * 0.85, q.p[3] - q.ny * R * 0.85)); // el lado en sombra
    pasa('#c9bca4', Math.max(1, z * 0.025), (q) => seg(q.p[0] + q.nx * R * 0.45, q.p[1] + q.ny * R * 0.45, q.p[2] + q.nx * R * 0.45, q.p[3] + q.ny * R * 0.45)); // el brillo
    pasa('#6e6250', Math.max(2, z * 0.07), (q) => { for (let d = 1.3; d < q.L - 0.2; d += 2.8) { const x = q.p[0] + q.ux * d, y = q.p[1] + q.uy * d; seg(x - q.nx * R * 1.25, y - q.ny * R * 1.25, x + q.nx * R * 1.25, y + q.ny * R * 1.25); } }); // las bridas
    if (verRed) { ctx.setLineDash([z * 0.18, z * 0.22]); ctx.lineDashOffset = -T * z * 1.2; pasa('#f2c14e', Math.max(1.5, z * 0.05), (q) => seg(q.p[0], q.p[1], q.p[2], q.p[3])); ctx.setLineDash([]); ctx.lineDashOffset = 0; } // el petróleo que corre
    return true;
  };

  // ================= C · el suelo que recuerda =================
  const PXC = 48; // píxeles por celda de la loseta del suelo (8 × 8 celdas)
  let TIL = null, GRS = null;
  function horneaTil() { const n = 8 * PXC, [o, x] = lienzo(n, n); azS = 11;
    const nueve = (f) => { for (const dx of [-n, 0, n]) for (const dy of [-n, 0, n]) f(dx, dy); }; // cada cosa, también al otro lado del borde: la loseta empalma sin costura
    for (let i = 0; i < 26; i++) { const cx = az() * n, cy = az() * n, R = (0.8 + az() * 2.2) * PXC, cl = az() < 0.45 ? 'rgba(120,104,76,0.035)' : 'rgba(255,250,235,0.1)'; nueve((dx, dy) => { const g = x.createRadialGradient(cx + dx, cy + dy, 0, cx + dx, cy + dy, R); g.addColorStop(0, cl); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(cx + dx - R, cy + dy - R, 2 * R, 2 * R); }); } // manchas de tierra más clara y más oscura
    for (let i = 0; i < 200; i++) { const cx = az() * n, cy = az() * n, r = PXC * (0.012 + az() * 0.018), al = 0.16 + az() * 0.22; nueve((dx, dy) => { x.fillStyle = 'rgba(100,92,80,' + al + ')'; x.beginPath(); x.arc(cx + dx, cy + dy, r, 0, TAU); x.fill(); x.fillStyle = 'rgba(255,255,255,' + al * 0.6 + ')'; x.fillRect(cx + dx - r * 0.5, cy + dy - r * 0.6, r * 0.6, r * 0.5); }); } // piedritas, con su brillo
    x.lineCap = 'round'; for (let i = 0; i < 120; i++) { const cx = az() * n, cy = az() * n, cl = az() < 0.5 ? 'rgba(122,128,78,0.42)' : 'rgba(104,112,70,0.36)', h = []; for (let k = 0; k < 5; k++) h.push(-Math.PI / 2 + (az() - 0.5) * 1.3, PXC * (0.05 + az() * 0.05)); nueve((dx, dy) => { x.strokeStyle = cl; x.lineWidth = 0.9; x.beginPath(); for (let k = 0; k < h.length; k += 2) { x.moveTo(cx + dx, cy + dy); x.lineTo(cx + dx + Math.cos(h[k]) * h[k + 1], cy + dy + Math.sin(h[k]) * h[k + 1]); } x.stroke(); }); } // matas de hierba seca
    return o; }
  function horneaGrano() { azS = 3; const [o, x] = lienzo(128, 128); for (let i = 0; i < 1300; i++) { x.fillStyle = az() < 0.55 ? 'rgba(0,0,0,' + (0.02 + az() * 0.05) + ')' : 'rgba(255,255,255,' + (0.04 + az() * 0.1) + ')'; x.fillRect(az() * 128 | 0, az() * 128 | 0, 1, 1); } return o; }
  // El suelo entero (colores del terreno, textura, grano y agua lisa) se pinta en una imagen algo mayor que la pantalla y en
  // cada cuadro solo se pega: se repinta al cambiar el zoom, el terreno o el tema, o al salirse la vista de su margen.
  // Mientras se hace zoom se estira la que hay, y se repinta cuando el zoom para.
  const MARG = 96; let BUF = null, bz = 0, bwx = 0, bwy = 0, bw = 0, bh = 0, bclave = '', zCambio = 0, zVisto = 0;
  function pintaBuf(ox, oy, z, cw, ch, N, dpr, cTerr, T, P) {
    const W0 = cw + 2 * MARG, H0 = ch + 2 * MARG, n = Math.ceil(W0 * dpr), m = Math.ceil(H0 * dpr);
    if (!BUF || BUF.width !== n || BUF.height !== m) { BUF = document.createElement('canvas'); BUF.width = n; BUF.height = m; }
    const x = BUF.getContext('2d'); bz = z; bwx = (-ox - MARG) / z; bwy = (-oy - MARG) / z; bw = W0; bh = H0;
    const qx = -bwx * z, qy = -bwy * z; // dónde cae la esquina del mapa en la imagen
    x.setTransform(dpr, 0, 0, dpr, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over'; x.fillStyle = P.fondo; x.fillRect(0, 0, W0, H0);
    x.imageSmoothingEnabled = false; x.drawImage(cTerr, qx, qy, N * z, N * z);
    const x0 = Math.max(0, qx), y0 = Math.max(0, qy), x1 = Math.min(W0, qx + N * z), y1 = Math.min(H0, qy + N * z);
    if (x1 > x0 && y1 > y0) {
      x.imageSmoothingEnabled = true; const p = x.createPattern(TIL, 'repeat'), s = z / PXC; p.setTransform(new DOMMatrix([s, 0, 0, s, qx, qy])); x.fillStyle = p; x.fillRect(x0, y0, x1 - x0, y1 - y0);
      x.imageSmoothingEnabled = false; const g = x.createPattern(GRS, 'repeat'); g.setTransform(new DOMMatrix([1 / dpr, 0, 0, 1 / dpr, Math.round(qx * dpr) / dpr, Math.round(qy * dpr) / dpr])); x.fillStyle = g; x.fillRect(x0, y0, x1 - x0, y1 - y0);
      x.fillStyle = P.agua; x.beginPath(); const cx0 = Math.max(0, Math.floor(bwx)), cy0 = Math.max(0, Math.floor(bwy)), cx1 = Math.min(N - 1, Math.floor(bwx + W0 / z)), cy1 = Math.min(N - 1, Math.floor(bwy + H0 / z)); // el agua, lisa: sin matas ni piedras
      for (let cy = cy0; cy <= cy1; cy++) { let ini = -1; for (let cx = cx0; cx <= cx1 + 1; cx++) { const t = cx <= cx1 ? T[cy * N + cx] : 0, ag = t === 2 || t === 5; if (ag && ini < 0) ini = cx; else if (!ag && ini >= 0) { x.rect(qx + ini * z, qy + cy * z, (cx - ini) * z, z); ini = -1; } } } // por tramos de una fila
      x.fill();
    }
  }
  // Pinta el suelo de maqueta en lugar del terreno liso. Devuelve false si no le toca (lejos, o desactivado).
  H.suelo = function (ctx, ox, oy, z, cw, ch, N, dpr, cTerr, T, P, version) {
    if (!H.activo || !CAPA.suelo || z < 16) return false;
    if (!TIL) { TIL = horneaTil(); GRS = horneaGrano(); }
    const ahora = performance.now(), clave = cw + '|' + ch + '|' + dpr + '|' + version + '|' + P.llano + P.agua + P.fondo;
    if (z !== zVisto) { zVisto = z; zCambio = ahora; }
    const dentro = BUF && -ox / z >= bwx && -oy / z >= bwy && (-ox + cw) / z <= bwx + bw / bz && (-oy + ch) / z <= bwy + bh / bz;
    const estira = BUF && bz !== z && ahora - zCambio < 160 && dentro && clave === bclave && Math.abs(z / bz - 1) < 0.35; // en pleno zoom: se estira la de antes
    if (!estira && (!BUF || bz !== z || !dentro || clave !== bclave)) { pintaBuf(ox, oy, z, cw, ch, N, dpr, cTerr, T, P); bclave = clave; }
    const k = z / bz, X = ox + bwx * z, Y = oy + bwy * z;
    if (k === 1) ctx.drawImage(BUF, Math.round(X * dpr) / dpr, Math.round(Y * dpr) / dpr, bw, bh); else { ctx.imageSmoothingEnabled = true; ctx.drawImage(BUF, X, Y, bw * k, bh * k); ctx.imageSmoothingEnabled = false; }
    return true;
  };
  // La memoria del suelo: trozos de 16 × 16 celdas a 8 píxeles por celda; solo existen los que han recibido alguna marca.
  const TR = 16, PX = 8, trozos = new Map();
  function enTrozos(x0, y0, x1, y1, f) { for (let cy = Math.max(0, Math.floor(y0 / TR)); cy <= Math.floor(y1 / TR); cy++) for (let cx = Math.max(0, Math.floor(x0 / TR)); cx <= Math.floor(x1 / TR); cx++) { const k = cy * 4096 + cx; let o = trozos.get(k); if (!o) { o = document.createElement('canvas'); o.width = o.height = TR * PX; trozos.set(k, o); } const x = o.getContext('2d'); x.setTransform(PX, 0, 0, PX, -cx * TR * PX, -cy * TR * PX); f(x); } }
  H.marca = function (k, x, y, s, a, o) {
    if (!H.activo) return;
    if (k === 'rodada') { const w = s, c0 = Math.cos(o.a0), s0 = Math.sin(o.a0), c1 = Math.cos(a), s1 = Math.sin(a); enTrozos(Math.min(x, o.x0) - 1, Math.min(y, o.y0) - 1, Math.max(x, o.x0) + 1, Math.max(y, o.y0) + 1, (c) => { c.strokeStyle = o.barro ? 'rgba(92,74,50,0.11)' : 'rgba(80,66,48,0.06)'; c.lineWidth = o.oruga ? 0.17 : 0.12; c.beginPath(); c.moveTo(o.x0 - s0 * w, o.y0 + c0 * w); c.lineTo(x - s1 * w, y + c1 * w); c.moveTo(o.x0 + s0 * w, o.y0 - c0 * w); c.lineTo(x + s1 * w, y - c1 * w); c.stroke(); }); return; }
    if (k === 'crater' || k === 'quemado') { const R = s * (k === 'crater' ? 1.15 : 1), fuerte = k === 'crater' ? 0.42 : 0.26; enTrozos(x - R, y - R, x + R, y + R, (c) => { const g = c.createRadialGradient(x, y, 0, x, y, R); g.addColorStop(0, 'rgba(48,40,32,' + fuerte + ')'); g.addColorStop(0.55, 'rgba(70,58,44,' + fuerte * 0.45 + ')'); g.addColorStop(1, 'rgba(70,58,44,0)'); c.fillStyle = g; c.beginPath(); c.arc(x, y, R, 0, TAU); c.fill(); if (k === 'crater') { c.fillStyle = 'rgba(50,42,34,0.45)'; for (let i = 0; i < 8; i++) { const b = a + i * 0.8, d = R * (0.75 + Math.abs(Math.sin(i * 7.3 + a)) * 0.6); c.fillRect(x + Math.cos(b) * d, y + Math.sin(b) * d, 0.12, 0.12); } } }); return; } // y la tierra que saltó alrededor
    if (k === 'ruina') { const h = s / 2; enTrozos(x - h - 0.3, y - h - 0.3, x + h + 0.3, y + h + 0.3, (c) => { for (const [g, al] of [[0.3, 0.08], [0.12, 0.12], [-0.05, 0.16]]) { c.fillStyle = 'rgba(52,46,38,' + al + ')'; c.fillRect(x - h - g, y - h - g, s + 2 * g, s + 2 * g); } }); } // la planta de lo que hubo, con el borde desvaído
  };
  H.recuerdo = function (ctx, ox, oy, z, cw, ch) {
    if (!H.activo || !CAPA.memoria || z < 8 || !trozos.size) return;
    const L = TR * z, cx0 = Math.max(0, Math.floor(-ox / L)), cy0 = Math.max(0, Math.floor(-oy / L)), cx1 = Math.floor((cw - ox) / L), cy1 = Math.floor((ch - oy) / L);
    ctx.imageSmoothingEnabled = true;
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) { const o = trozos.get(cy * 4096 + cx); if (o) ctx.drawImage(o, ox + cx * L, oy + cy * L, L, L); }
    ctx.imageSmoothingEnabled = false;
  };

  // ================= D · la luz =================
  const NFL = 32, CONO = [], R_CONO = 80; let BRI = null, VEN = null;
  function horneaLuces() {
    for (let f = 0; f < NFL; f++) { const [o, x] = lienzo(2 * R_CONO, 2 * R_CONO), a = f / NFL * TAU; x.translate(R_CONO, R_CONO); x.rotate(a); const g = x.createRadialGradient(0, 0, 0, 0, 0, R_CONO); g.addColorStop(0, 'rgba(255,236,190,0.5)'); g.addColorStop(0.5, 'rgba(255,236,190,0.18)'); g.addColorStop(1, 'rgba(255,236,190,0)'); x.fillStyle = g; x.beginPath(); x.moveTo(0, 0); x.arc(0, 0, R_CONO, -0.34, 0.34); x.closePath(); x.fill(); CONO.push(o); } // el haz de los faros, en cada rumbo
    const brillo = (R, c0, c1) => { const [o, x] = lienzo(2 * R, 2 * R), g = x.createRadialGradient(R, R, 0, R, R, R); g.addColorStop(0, c0); g.addColorStop(0.35, c1); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, 2 * R, 2 * R); return o; };
    BRI = brillo(64, 'rgba(255,200,120,0.9)', 'rgba(255,170,80,0.32)'); VEN = brillo(48, 'rgba(255,214,150,0.75)', 'rgba(255,200,130,0.22)');
  }
  const mezclaC = (a, b, f) => a.map((v, i) => Math.round(v + (b[i] - v) * f));
  const BLANCO = [255, 255, 255], OCASO = [250, 216, 182], NOCHE = [104, 118, 166];
  // La noche: el mapa por un tono que va del cálido del atardecer al azul de noche; encima, las luces sumadas.
  // luces: [x, y, rumbo, clase, radio] · clase 0 faros, 1 linterna, 2 disparo, 3 ventana, 4 explosión o llama
  H.noche = function (ctx, luz, luces, z, cw, ch) {
    if (!H.activo || !CAPA.luz) return false;
    if (!BRI) horneaLuces();
    const k = 1 - luz, c = k < 0.35 ? mezclaC(BLANCO, OCASO, k / 0.35) : mezclaC(OCASO, NOCHE, (k - 0.35) / 0.65);
    ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = 'rgb(' + c.join(',') + ')'; ctx.fillRect(0, 0, cw, ch);
    ctx.globalCompositeOperation = 'lighter';
    for (const [x, y, a, cl, r] of luces) {
      if (cl === 0 || cl === 1) { const f = ((Math.round(a / TAU * NFL) % NFL) + NFL) % NFL, L = z * (cl ? 1.8 : 3.4), x0 = x + Math.cos(a) * r, y0 = y + Math.sin(a) * r; ctx.globalAlpha = k * (cl ? 0.55 : 0.9); ctx.drawImage(CONO[f], x0 - L, y0 - L, 2 * L, 2 * L); }
      else if (cl === 2) { const R = z * 1.3, gx = x + Math.cos(a) * r * 2, gy = y + Math.sin(a) * r * 2; ctx.globalAlpha = 0.7 * k; ctx.drawImage(BRI, gx - R, gy - R, 2 * R, 2 * R); }
      else if (cl === 3) { ctx.globalAlpha = 0.42 * k; ctx.drawImage(VEN, x - r, y - r, 2 * r, 2 * r); }
      else { ctx.globalAlpha = Math.min(1, k * 1.2); ctx.drawImage(BRI, x - r, y - r, 2 * r, 2 * r); }
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; return true;
  };

  // ================= E · efectos =================
  const BOC = new Map();
  // Bocanada: unos cuantos lóbulos difuminados que se solapan; tres variantes por color.
  H.bocanada = function (col, v) { let L = BOC.get(col); if (!L) { L = []; azS = 31; for (let i = 0; i < 3; i++) { const R = 48, [o, x] = lienzo(2 * R, 2 * R); for (let j = 0; j < 7; j++) { const a = az() * TAU, d = az() * R * 0.38, rr = R * (0.36 + az() * 0.3), cx = R + Math.cos(a) * d, cy = R + Math.sin(a) * d, g = x.createRadialGradient(cx, cy, 0, cx, cy, rr); g.addColorStop(0, rgba(col, 0.5)); g.addColorStop(1, rgba(col, 0)); x.fillStyle = g; x.beginPath(); x.arc(cx, cy, rr, 0, TAU); x.fill(); } L.push(o); } BOC.set(col, L); } return L[v % 3]; };
  H.resplandor = () => { if (!BRI) horneaLuces(); return BRI; };

  W.MAS_EDIF = MAS;

  // ================= el horno, ampliado =================
  const info0 = H.info;
  H.info = () => Object.assign(info0(), { trozos: trozos.size, mbSuelo: trozos.size * TR * PX * TR * PX * 4 / 1048576 });
})();
