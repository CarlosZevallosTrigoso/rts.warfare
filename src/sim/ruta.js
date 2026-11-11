// rts.warfare — A* sobre la rejilla (8 direcciones, sin cortar esquinas).
(function () {
  const W = globalThis.W || (globalThis.W = {});

  W.crearRuta = function (N) {
    const NN = N * N;
    const g = new Float32Array(NN), padre = new Int32Array(NN), visto = new Uint32Array(NN), cerrado = new Uint32Array(NN);
    const hI = [], hF = [];
    let gen = 0;
    function mete(i, f) {
      let k = hI.length; hI.push(i); hF.push(f);
      while (k > 0) { const p = (k - 1) >> 1; if (hF[p] <= f) break; hI[k] = hI[p]; hF[k] = hF[p]; k = p; }
      hI[k] = i; hF[k] = f;
    }
    function saca() {
      const top = hI[0], li = hI.pop(), lf = hF.pop(), n = hI.length;
      if (n > 0) {
        let k = 0;
        for (;;) {
          let c = 2 * k + 1; if (c >= n) break;
          if (c + 1 < n && hF[c + 1] < hF[c]) c++;
          if (hF[c] >= lf) break;
          hI[k] = hI[c]; hF[k] = hF[c]; k = c;
        }
        hI[k] = li; hF[k] = lf;
      }
      return top;
    }
    const DX = [1, -1, 0, 0, 1, 1, -1, -1], DY = [0, 0, 1, -1, 1, -1, 1, -1];

    // Devuelve la lista de celdas desde (x0,y0) hasta la primera cuyo centro
    // quede a `radio` o menos de (mx,my); [] si ya está ahí; null si no hay paso.
    // kh: factor de la estimación (1 normal; 0,62 cuando hay caminos, para que el cálculo los encuentre y los prefiera).
    return function (paso, terreno, x0, y0, mx, my, radio, kh) {
      kh = kh || 1;
      gen++; hI.length = 0; hF.length = 0;
      const r2 = Math.max(radio, 0.75) ** 2, ini = y0 * N + x0;
      const h = (x, y) => { const dx = Math.abs(x + 0.5 - mx), dy = Math.abs(y + 0.5 - my); return (Math.max(dx, dy) + 0.4142 * Math.min(dx, dy)) * kh; };
      g[ini] = 0; padre[ini] = -1; visto[ini] = gen; mete(ini, h(x0, y0));
      while (hI.length) {
        const c = saca();
        if (cerrado[c] === gen) continue;
        cerrado[c] = gen;
        const cx = c % N, cy = (c / N) | 0, ex = cx + 0.5 - mx, ey = cy + 0.5 - my;
        if (ex * ex + ey * ey <= r2) {
          const out = [];
          for (let k = c; k !== ini; k = padre[k]) out.push(k);
          return out.reverse();
        }
        for (let d = 0; d < 8; d++) {
          const nx = cx + DX[d], ny = cy + DY[d];
          if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
          const n = ny * N + nx;
          if (!paso[n] || cerrado[n] === gen) continue;
          if (d >= 4 && (!paso[cy * N + nx] || !paso[ny * N + cx])) continue;
          const ng = g[c] + (d >= 4 ? 1.4142 : 1) * (terreno[n] === 3 ? 1.7 : terreno[n] >= 4 ? 0.62 : terreno[n] === 2 ? 3 : 1); // camino y puente, baratos; el agua solo la cruza la excavadora tendiendo un puente, y le sale cara
          if (visto[n] !== gen || ng < g[n]) { visto[n] = gen; g[n] = ng; padre[n] = c; mete(n, ng + h(nx, ny)); }
        }
      }
      return null;
    };
  };
})();
