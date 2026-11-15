// drone.warfare — rutas a pie: A* sobre la rejilla (8 direcciones, sin cortar esquinas), con el coste de cada celda.
// El sector es pequeño (96 × 96), así que se busca al momento; no hace falta cola de peticiones.
(function () {
  const D = globalThis.D || (globalThis.D = {});
  const DX = [1, -1, 0, 0, 1, 1, -1, -1], DY = [0, 0, 1, -1, 1, -1, 1, -1];
  let g = null, padre = null, marca = null, gen = 0, hI = new Int32Array(4096), hF = new Float64Array(4096), hn = 0;
  function mete(i, f) { if (hn === hI.length) { const a = new Int32Array(hn * 2), b = new Float64Array(hn * 2); a.set(hI); b.set(hF); hI = a; hF = b; } let k = hn++; while (k > 0) { const p = (k - 1) >> 1; if (hF[p] <= f) break; hI[k] = hI[p]; hF[k] = hF[p]; k = p; } hI[k] = i; hF[k] = f; }
  function saca() { const top = hI[0], li = hI[--hn], lf = hF[hn]; let k = 0; for (;;) { let c = 2 * k + 1; if (c >= hn) break; if (c + 1 < hn && hF[c + 1] < hF[c]) c++; if (hF[c] >= lf) break; hI[k] = hI[c]; hF[k] = hF[c]; k = c; } hI[k] = li; hF[k] = lf; return top; }
  // paso: 1 donde se puede pisar. coste: lo que cuesta entrar en cada celda (≥ 0,5). Devuelve la lista de puntos [x, y]
  // (centros de celda, ya sin los intermedios en línea recta) o null si no hay camino. La celda de salida vale aunque no sea pisable.
  D.ruta = function (N, paso, coste, x0, y0, x1, y1) {
    x0 = Math.floor(x0); y0 = Math.floor(y0); x1 = Math.floor(x1); y1 = Math.floor(y1);
    if (x1 < 0 || y1 < 0 || x1 >= N || y1 >= N || !paso[y1 * N + x1]) return null;
    if (!g || g.length !== N * N) { g = new Float32Array(N * N); padre = new Int32Array(N * N); marca = new Uint32Array(N * N); }
    const ini = y0 * N + x0, fin = y1 * N + x1; gen += 2; hn = 0; g[ini] = 0; padre[ini] = -1; marca[ini] = gen; mete(ini, 0);
    while (hn) {
      const c = saca(); if (marca[c] === gen + 1) continue; marca[c] = gen + 1; if (c === fin) break;
      const cx = c % N, cy = (c / N) | 0;
      for (let d = 0; d < 8; d++) {
        const x = cx + DX[d], y = cy + DY[d]; if (x < 0 || y < 0 || x >= N || y >= N) continue; const n = y * N + x; if (!paso[n] || marca[n] === gen + 1) continue;
        if (d >= 4 && (!paso[cy * N + x] || !paso[y * N + cx])) continue; // en diagonal no se rozan las esquinas
        const ng = g[c] + coste[n] * (d >= 4 ? 1.4142 : 1); if (marca[n] === gen && ng >= g[n]) continue;
        g[n] = ng; padre[n] = c; marca[n] = gen; const ax = Math.abs(x - x1), ay = Math.abs(y - y1); mete(n, ng + (Math.max(ax, ay) + 0.4142 * Math.min(ax, ay)) * 0.5);
      }
    }
    if (marca[fin] !== gen + 1) return null;
    const pts = []; for (let c = fin; c !== -1; c = padre[c]) pts.push([(c % N) + 0.5, ((c / N) | 0) + 0.5]); pts.reverse();
    const o = [pts[0]]; for (let i = 1; i + 1 < pts.length; i++) { const a = o[o.length - 1], b = pts[i], c = pts[i + 1]; if ((b[0] - a[0]) * (c[1] - b[1]) !== (b[1] - a[1]) * (c[0] - b[0])) o.push(b); } if (pts.length > 1) o.push(pts[pts.length - 1]);
    return o;
  };
  // Línea de visión entre dos puntos, celda a celda: la cortan los muros; los árboles, solo si hay más de tres celdas de arboleda en medio.
  D.seVe = function (mapa, ax, ay, bx, by) {
    const N = mapa.N, T = D.T, t = mapa.terreno, n = Math.ceil(Math.hypot(bx - ax, by - ay) * 2); let arb = 0, ult = -1;
    const c0 = Math.floor(ay) * N + Math.floor(ax), c1 = Math.floor(by) * N + Math.floor(bx);
    for (let k = 1; k < n; k++) { const x = ax + ((bx - ax) * k) / n, y = ay + ((by - ay) * k) / n, c = Math.floor(y) * N + Math.floor(x); if (c === ult || c === c0 || c === c1) continue; ult = c; const q = t[c]; if (q === T.MURO) return false; if (q === T.BOSQUE && ++arb > 3) return false; }
    return true;
  };
})();
