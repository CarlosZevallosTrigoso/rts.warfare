// rts.warfare — A* sobre la rejilla (8 direcciones, sin cortar esquinas).
(function () {
  const W = globalThis.W || (globalThis.W = {});

  W.crearRuta = function (N) {
    const NN = N * N;
    const g = new Float32Array(NN), padre = new Int32Array(NN), visto = new Uint32Array(NN), cerrado = new Uint32Array(NN);
    // El montículo va en tablas de tamaño fijo que crecen si hace falta: sin basura que recoger en cada búsqueda.
    let hI = new Int32Array(4096), hF = new Float64Array(4096), hn = 0;
    let gen = 0;
    function mete(i, f) {
      if (hn === hI.length) { const a = new Int32Array(hn * 2), b = new Float64Array(hn * 2); a.set(hI); b.set(hF); hI = a; hF = b; }
      let k = hn++;
      while (k > 0) { const p = (k - 1) >> 1; if (hF[p] <= f) break; hI[k] = hI[p]; hF[k] = hF[p]; k = p; }
      hI[k] = i; hF[k] = f;
    }
    function saca() {
      const top = hI[0]; hn--;
      const li = hI[hn], lf = hF[hn], n = hn;
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
    // Comprobación barata antes de buscar: ¿está el destino (o la salida) encerrado en un recinto pequeño al que no pertenece el otro extremo?
    // Se inunda desde las celdas de destino, y luego desde la salida, hasta TOPE celdas: si la inundación se agota sin tocar el otro extremo, no hay ruta
    // (y se sabe en unas cientos de celdas, no explorando el mapa entero). Si no se agota, no se sabe: decide la búsqueda de verdad.
    const TOPE = 500, marca = new Uint32Array(NN), colaI = new Int32Array(TOPE + 8); let gm = 0;
    function sinSalida(paso, abre, x0, y0, mx, my, r2) {
      const ini = y0 * N + x0, libre = (i) => paso[i] || (abre && abre[i]);
      const R = Math.ceil(Math.sqrt(r2)), gx = Math.floor(mx), gy = Math.floor(my);
      // 1) desde el destino
      gm++; let a = 0, b = 0, tocaIni = false;
      for (let y = Math.max(0, gy - R); y <= Math.min(N - 1, gy + R) && b < TOPE; y++) for (let x = Math.max(0, gx - R); x <= Math.min(N - 1, gx + R) && b < TOPE; x++) {
        const ex = x + 0.5 - mx, ey = y + 0.5 - my, i = y * N + x;
        if (ex * ex + ey * ey > r2) continue;
        if (i === ini) return false; // ya está en el destino
        if (libre(i)) { marca[i] = gm; colaI[b++] = i; }
      }
      if (!b) return true; // no hay ninguna celda de destino transitable
      while (a < b && b < TOPE) {
        const c = colaI[a++], cx = c % N;
        if (cx > 0) { const n = c - 1; if (n === ini) { tocaIni = true; break; } if (marca[n] !== gm && libre(n)) { marca[n] = gm; colaI[b++] = n; } }
        if (cx < N - 1) { const n = c + 1; if (n === ini) { tocaIni = true; break; } if (marca[n] !== gm && libre(n)) { marca[n] = gm; colaI[b++] = n; } }
        if (c >= N) { const n = c - N; if (n === ini) { tocaIni = true; break; } if (marca[n] !== gm && libre(n)) { marca[n] = gm; colaI[b++] = n; } }
        if (c < NN - N) { const n = c + N; if (n === ini) { tocaIni = true; break; } if (marca[n] !== gm && libre(n)) { marca[n] = gm; colaI[b++] = n; } }
      }
      if (tocaIni) return false;
      if (a >= b) return true; // el recinto del destino se agotó sin llegar a la salida
      // 2) desde la salida (la celda de salida vale aunque no sea transitable: la unidad ya está en ella)
      gm++; a = 0; b = 0; marca[ini] = gm; colaI[b++] = ini;
      while (a < b && b < TOPE) {
        const c = colaI[a++], cx = c % N, cy = (c / N) | 0, ex = cx + 0.5 - mx, ey = cy + 0.5 - my;
        if (ex * ex + ey * ey <= r2) return false;
        if (cx > 0 && marca[c - 1] !== gm && libre(c - 1)) { marca[c - 1] = gm; colaI[b++] = c - 1; }
        if (cx < N - 1 && marca[c + 1] !== gm && libre(c + 1)) { marca[c + 1] = gm; colaI[b++] = c + 1; }
        if (c >= N && marca[c - N] !== gm && libre(c - N)) { marca[c - N] = gm; colaI[b++] = c - N; }
        if (c < NN - N && marca[c + N] !== gm && libre(c + N)) { marca[c + N] = gm; colaI[b++] = c + N; }
      }
      return a >= b; // la salida está encerrada y el destino no está dentro
    }

    // Devuelve la lista de celdas desde (x0,y0) hasta la primera cuyo centro
    // quede a `radio` o menos de (mx,my); [] si ya está ahí; null si no hay paso.
    // kh: factor de la estimación (1 normal; 0,62 cuando hay caminos, para que el cálculo los encuentre y los prefiera).
    // via: las celdas de camino propias (solo esas abaratan la ruta: el camino ajeno se cruza, pero no se busca).
    // abre: celdas que para esta unidad también son transitables (sus puertas; o todos los muros, cuando busca por dónde abrirse paso).
    // caro: celdas que cuestan mucho más (los muros que tendría que derribar).
    // max: tope de celdas exploradas (0 = sin tope); pasado el tope, la búsqueda se rinde (null). buscar.nodos: cuántas exploró la última.
    const buscar = function (paso, terreno, x0, y0, mx, my, radio, kh, via, abre, caro, max) {
      kh = kh || 1;
      gen++; hn = 0; let nn = 0;
      const r2 = Math.max(radio, 0.75) ** 2, ini = y0 * N + x0;
      if (sinSalida(paso, abre, x0, y0, mx, my, r2)) { buscar.nodos = 60; return null; }
      const h = (x, y) => { const dx = Math.abs(x + 0.5 - mx), dy = Math.abs(y + 0.5 - my); return (Math.max(dx, dy) + 0.4142 * Math.min(dx, dy)) * kh; };
      g[ini] = 0; padre[ini] = -1; visto[ini] = gen; mete(ini, h(x0, y0));
      while (hn) {
        const c = saca();
        if (cerrado[c] === gen) continue;
        cerrado[c] = gen;
        if (max && ++nn > max) { buscar.nodos = nn; return null; }
        if (!max) nn++;
        const cx = c % N, cy = (c / N) | 0, ex = cx + 0.5 - mx, ey = cy + 0.5 - my;
        if (ex * ex + ey * ey <= r2) {
          const out = [];
          for (let k = c; k !== ini; k = padre[k]) out.push(k);
          buscar.nodos = nn; return out.reverse();
        }
        for (let d = 0; d < 8; d++) {
          const nx = cx + DX[d], ny = cy + DY[d];
          if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
          const n = ny * N + nx;
          if ((!paso[n] && !(abre && abre[n])) || cerrado[n] === gen) continue;
          if (d >= 4) { const a = cy * N + nx, b = ny * N + cx; if ((!paso[a] && !(abre && abre[a])) || (!paso[b] && !(abre && abre[b]))) continue; }
          const ng = g[c] + (d >= 4 ? 1.4142 : 1) * (caro && caro[n] ? 9 : via && via[n] ? 0.62 : terreno[n] === 3 ? 1.7 : terreno[n] === 2 ? 3 : 1); // camino y puente, baratos; el agua solo la cruza la excavadora tendiendo un puente, y le sale cara
          if (visto[n] !== gen || ng < g[n]) { visto[n] = gen; g[n] = ng; padre[n] = c; mete(n, ng + h(nx, ny)); }
        }
      }
      buscar.nodos = nn; return null;
    };
    buscar.nodos = 0;
    return buscar;
  };
})();
