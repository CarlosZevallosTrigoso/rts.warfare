// rts.warfare — generador de mapa por semilla, con simetría rotacional de 180°.
(function () {
  const W = globalThis.W || (globalThis.W = {});

  // Tipos de mapa. «clasico» es el generador de siempre (el que usan las pruebas); los demás cambian cuánta roca, agua y bosque hay
  // (cuantiles del ruido) y añaden rasgos: franjas de bosque que cruzan la ruta entre bases, ríos con vados, anillo de roca en torno a cada base.
  W.MAPAS = {
    clasico:      { nombre: 'clásico',      roca: 0.87,  agua: 0.08, bosque: 0.84, pasos: 2 },
    equilibrado:  { nombre: 'equilibrado',  roca: 0.87,  agua: 0.07, bosque: 0.64, franjas: [0.32], pasos: 2 },
    llanura:      { nombre: 'llanura',      roca: 0.965, agua: 0.03, bosque: 0.9,  pasos: 2 },
    desfiladeros: { nombre: 'desfiladeros', roca: 0.56,  agua: 0.02, bosque: 0.8,  tallar: true, fino: true, pasos: 2 },
    selva:        { nombre: 'selva',        roca: 0.93,  agua: 0.05, bosque: 0.36, pasos: 1 },
    rios:         { nombre: 'ríos',         roca: 0.91,  agua: 0.03, bosque: 0.72, rios: [0, 0.4], pasos: 2 },
    fortalezas:   { nombre: 'fortalezas',   roca: 0.87,  agua: 0.06, bosque: 0.68, anillo: true, pasos: 2 },
  };
  W.MAPAS_AZAR = ['equilibrado', 'llanura', 'desfiladeros', 'selva', 'rios', 'fortalezas'];
  W.mapaDe = (tipo, semilla) => (W.MAPAS[tipo] ? tipo : tipo === 'azar' ? W.MAPAS_AZAR[Math.abs(semilla | 0) % W.MAPAS_AZAR.length] : 'clasico');
  W.generarMapa = function (semilla, lado, tipo) {
    tipo = W.mapaDe(tipo, semilla); const cfg = W.MAPAS[tipo];
    const N = lado || W.N, NN = N * N, T = W.TERRENO, r = W.prng(semilla);
    const espejo = (i) => NN - 1 - i;

    function capa(esc) {
      const g = Math.ceil(N / esc) + 2, v = new Float32Array(g * g);
      for (let i = 0; i < v.length; i++) v[i] = r();
      return function (x, y) {
        const fx = x / esc, fy = y / esc, x0 = Math.floor(fx), y0 = Math.floor(fy);
        let tx = fx - x0, ty = fy - y0;
        tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
        const a = v[y0 * g + x0], b = v[y0 * g + x0 + 1], c = v[(y0 + 1) * g + x0], d = v[(y0 + 1) * g + x0 + 1];
        return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
      };
    }
    const K = N / 128, AREA = K * K; // factores de escala respecto del mapa base de 128
    const e0 = capa(64), e1 = capa(20), e2 = capa(8), b1 = capa(11), b0 = capa(40);
    const crudoE = new Float32Array(NN), crudoB = new Float32Array(NN);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      crudoE[y * N + x] = cfg.fino ? e0(x, y) * 0.12 + e1(x, y) * 0.6 + e2(x, y) * 0.28 : e0(x, y) * 0.4 + e1(x, y) * 0.42 + e2(x, y) * 0.18; // (fino: relieve más menudo, para que la roca forme pasillos y no un macizo)
      crudoB[y * N + x] = b1(x, y) * 0.6 + b0(x, y) * 0.4;
    }
    // Sumar cada celda con su espejo vuelve simétrico el ruido sin costura.
    const elev = new Float32Array(NN), bosq = new Float32Array(NN);
    for (let i = 0; i < NN; i++) { elev[i] = crudoE[i] + crudoE[espejo(i)]; bosq[i] = crudoB[i] + crudoB[espejo(i)]; }
    const O = Math.round(14 + (K - 1) * 4); // distancia de la base a la esquina
    const A = { x: O, y: N - 1 - O }, B = { x: N - 1 - O, y: O };
    const ejeL = Math.hypot(B.x - A.x, B.y - A.y), ejeX = (B.x - A.x) / ejeL, ejeY = (B.y - A.y) / ejeL;
    const tDe = (x, y) => (((x - A.x) * ejeX + (y - A.y) * ejeY) / ejeL) * 2 - 1; // posición a lo largo del eje entre bases: -1 en una, +1 en la otra
    const sDe = (x, y) => (x - A.x) * -ejeY + (y - A.y) * ejeX; // desvío lateral respecto del eje, en celdas
    if (cfg.franjas) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const t = tDe(x, y); let b = 0; for (const t0 of cfg.franjas) b += Math.exp(-(((Math.abs(t) - t0) / 0.085) ** 2)); bosq[y * N + x] += 0.3 * b; } // bosque en franjas atravesadas a la ruta
    const cuantil = (arr, q) => { const s = Float32Array.from(arr).sort(); return s[Math.floor(q * (s.length - 1))]; };
    const uRoca = cuantil(elev, cfg.roca), uAgua = cuantil(elev, cfg.agua), uBosq = cuantil(bosq, cfg.bosque);

    const terreno = new Uint8Array(NN);
    for (let i = 0; i < NN; i++) terreno[i] = elev[i] > uRoca ? T.ROCA : elev[i] < uAgua ? T.AGUA : bosq[i] > uBosq ? T.BOSQUE : T.LLANO;

    if (cfg.rios) { // ríos atravesados al eje, de lado a lado, con dos vados cada uno
      const medio = 2.4 / (ejeL / 2), vados = [-N * 0.27, N * 0.27];
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const i = y * N + x, tt = tDe(x, y) + (crudoB[i] - crudoB[espejo(i)]) * 0.22, sl = sDe(x, y); // (serpentea con un ruido antisimétrico: así el río y su espejo son el mismo)
        const vado = vados.some((v) => Math.abs(sl - v) < 3.2);
        for (const t0 of cfg.rios) { const d = Math.abs(tt - t0); if (d < medio) { terreno[i] = vado ? T.LLANO : T.AGUA; terreno[espejo(i)] = terreno[i]; } else if (vado && d < medio * 3) { terreno[i] = T.LLANO; terreno[espejo(i)] = T.LLANO; } } // los vados, y sus accesos, siempre despejados
      }
    }
    const bases = [A, B];
    const dBase = (x, y) => Math.min(Math.hypot(x - A.x, y - A.y), Math.hypot(x - B.x, y - B.y));
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (dBase(x, y) <= 11) terreno[y * N + x] = T.LLANO;

    if (cfg.anillo) { // cada base en una hoya: un anillo de roca con tres entradas (hacia el rival y a los lados)
      const haciaB = Math.atan2(B.y - A.y, B.x - A.x), R0 = 20.5, R1 = 25.5;
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const d = Math.hypot(x - A.x, y - A.y); if (d < R0 || d > R1) continue;
        let da = Math.atan2(y - A.y, x - A.x) - haciaB; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
        const i = y * N + x, puerta = [0, 0.62, -0.62].some((g) => Math.abs(da - g) < 0.11);
        terreno[i] = puerta ? T.LLANO : T.ROCA; terreno[espejo(i)] = terreno[i];
      }
    }
    // Un estanque junto a cada base: garantiza agua al alcance para la primera bomba.
    for (let k = 0; k < 80; k++) {
      const ang = r() * Math.PI * 2, x = Math.round(A.x + Math.cos(ang) * 9.5), y = Math.round(A.y + Math.sin(ang) * 9.5);
      if (x < 4 || y < 4 || x >= N - 4 || y >= N - 4) continue;
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        if (Math.hypot(dx, dy) > 2.3) continue;
        const i = (y + dy) * N + x + dx; terreno[i] = T.AGUA; terreno[espejo(i)] = T.AGUA;
      }
      break;
    }

    if (cfg.tallar) corredores(true, 2); // desfiladeros: dos pasos tallados en la roca, antes de repartir recursos
    const transitable = (i) => terreno[i] === T.LLANO || terreno[i] === T.BOSQUE;
    function inundar() {
      const visto = new Uint8Array(NN), cola = new Int32Array(NN);
      let ini = 0, fin = 0;
      const s = A.y * N + A.x; visto[s] = 1; cola[fin++] = s;
      while (ini < fin) {
        const c = cola[ini++], cx = c % N, cy = (c / N) | 0;
        if (cx > 0 && !visto[c - 1] && transitable(c - 1)) { visto[c - 1] = 1; cola[fin++] = c - 1; }
        if (cx < N - 1 && !visto[c + 1] && transitable(c + 1)) { visto[c + 1] = 1; cola[fin++] = c + 1; }
        if (cy > 0 && !visto[c - N] && transitable(c - N)) { visto[c - N] = 1; cola[fin++] = c - N; }
        if (cy < N - 1 && !visto[c + N] && transitable(c + N)) { visto[c + N] = 1; cola[fin++] = c + N; }
      }
      return visto;
    }
    let alcanzable = inundar();
    if (!alcanzable[B.y * N + B.x]) {
      // Sin paso entre bases: se abre un corredor recto de tres celdas.
      const pasos = N * 2;
      for (let k = 0; k <= pasos; k++) {
        const x = Math.round(A.x + (B.x - A.x) * k / pasos), y = Math.round(A.y + (B.y - A.y) * k / pasos);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue;
          const i = yy * N + xx; terreno[i] = T.LLANO; terreno[espejo(i)] = T.LLANO;
        }
      }
      alcanzable = inundar();
    }

    // Recursos cosechables: tipoMin 1 = minerales, 2 = minerales raros.
    const mineral = new Uint16Array(NN), tipoMin = new Uint8Array(NN);
    function campo(cx, cy, rad, tipo, cant) {
      const R = Math.ceil(rad);
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        const x = Math.round(cx) + dx, y = Math.round(cy) + dy, d = Math.hypot(dx, dy);
        const azar = r(), azar2 = r();
        if (x < 1 || y < 1 || x >= N - 1 || y >= N - 1 || d > rad) continue;
        if (azar < 0.2 + (d / rad) * 0.35) continue;
        const i = y * N + x;
        if (terreno[i] !== T.LLANO || !alcanzable[i] || mineral[i] || dBase(x, y) < 6) continue;
        const q = Math.round(cant * 3 * (0.6 + 0.8 * azar2)); // (yacimientos el triple de ricos, sin ocupar más sitio: las partidas largas se quedaban sin minerales)
        mineral[i] = q; tipoMin[i] = tipo; mineral[espejo(i)] = q; tipoMin[espejo(i)] = tipo;
      }
    }
    const llanoLibre = (x, y) => x >= 4 && y >= 4 && x < N - 4 && y < N - 4 && terreno[y * N + x] === T.LLANO && alcanzable[y * N + x];
    const centros = [];
    const lejos = (x, y, lista, d) => lista.every((c) => Math.hypot(c.x - x, c.y - y) >= d);
    const anota = (lista, x, y, extra) => { lista.push(Object.assign({ x, y }, extra)); lista.push(Object.assign({ x: N - 1 - x, y: N - 1 - y }, extra)); };

    for (let k = 0; k < 60; k++) { // campo seguro junto a cada base
      const ang = r() * Math.PI * 2, d = 10 + r() * 3;
      const x = Math.round(A.x + Math.cos(ang) * d), y = Math.round(A.y + Math.sin(ang) * d);
      if (!llanoLibre(x, y)) continue;
      campo(x, y, 3.6, 1, 450); anota(centros, x, y); break;
    }
    for (let k = 0, n = 0; k < 900 * AREA && n < Math.round(4 * AREA); k++) { // campos disputados
      const x = 4 + Math.floor(r() * (N - 8)), y = 4 + Math.floor(r() * (N - 8));
      if (!llanoLibre(x, y) || dBase(x, y) < 24 || !lejos(x, y, centros, 16)) continue;
      campo(x, y, 3 + r() * 2, 1, 450); anota(centros, x, y); n++;
    }
    const mitad = (N - 1) / 2;
    for (let k = 0, n = 0; k < 600 * K && n < Math.round(2 * K); k++) { // vetas raras, hacia el centro
      const ang = r() * Math.PI * 2, d = r() * N * 0.24;
      const x = Math.round(mitad + Math.cos(ang) * d), y = Math.round(mitad + Math.sin(ang) * d);
      if (!llanoLibre(x, y) || !lejos(x, y, centros, 8)) continue;
      campo(x, y, 1.8, 2, 250); anota(centros, x, y); n++;
    }

    // Sitios fijos: yacimientos de petróleo y campos de conocimiento.
    const sitios = [], sitioEn = new Uint8Array(NN);
    const sitioValido = (x, y) => llanoLibre(x, y) && !mineral[y * N + x] && dBase(x, y) >= 7 && lejos(x, y, sitios, 6);
    function sitio(tipo, x, y) {
      anota(sitios, x, y, { tipo });
      sitioEn[y * N + x] = 1; sitioEn[espejo(y * N + x)] = 1;
    }
    for (let k = 0; k < 80; k++) {
      const ang = r() * Math.PI * 2, d = 14 + r() * 4;
      const x = Math.round(A.x + Math.cos(ang) * d), y = Math.round(A.y + Math.sin(ang) * d);
      if (!sitioValido(x, y)) continue;
      sitio('petroleo', x, y); break;
    }
    for (let k = 0, n = 0; k < 600 * AREA && n < Math.round(1.5 * AREA); k++) {
      const x = 4 + Math.floor(r() * (N - 8)), y = 4 + Math.floor(r() * (N - 8));
      if (!sitioValido(x, y) || dBase(x, y) < 26) continue;
      sitio('petroleo', x, y); n++;
    }
    for (let k = 0, n = 0; k < 600 * K && n < Math.round(2 * K); k++) {
      const ang = r() * Math.PI * 2, d = r() * N * 0.3;
      const x = Math.round(mitad + Math.cos(ang) * d), y = Math.round(mitad + Math.sin(ang) * d);
      if (!sitioValido(x, y)) continue;
      sitio('conocimiento', x, y); n++;
    }

    // Puestos neutrales (se sortean al final, para no alterar el resto del mapa): antena, depósito y taller, por parejas simétricas.
    const puestos = [], TIPOS_PUESTO = ['antena', 'deposito', 'taller'];
    for (let k = 0, n = 0; k < 900 * K && n < Math.round(3 * K); k++) {
      const x = 5 + Math.floor(r() * (N - 10)), y = 5 + Math.floor(r() * (N - 10));
      if (!sitioValido(x, y) || dBase(x, y) < 22 || !lejos(x, y, puestos, 14) || Math.hypot(x - mitad, y - mitad) < 4) continue;
      anota(puestos, x, y, { tipo: TIPOS_PUESTO[n % 3] });
      sitioEn[y * N + x] = 1; sitioEn[espejo(y * N + x)] = 1; n++;
    }

    // Corredores para vehículos: el bosque solo lo cruza la infantería, así que entre las dos bases tienen que quedar pasos
    // de llano. Se busca el camino que menos bosque tala (búsqueda 0-1) y se abre con dos celdas de ancho, en espejo.
    // Después se busca un segundo camino lejos del primero, para que haya dos frentes y los ataques no se embotellen.
    function corredores(tallar, cuantos) {
      const INF = 1e9, a0 = A.y * N + A.x, b0 = B.y * N + B.x;
      const buscar = (veto) => {
        const coste = new Int32Array(NN).fill(INF), de = new Int32Array(NN).fill(-1), cola = new Int32Array(NN * 2 + 4);
        let ini = NN, fin = NN; // cola doble: lo gratis entra por delante, lo que cuesta por detrás
        coste[a0] = 0; cola[fin++] = a0;
        while (ini < fin) {
          const c = cola[ini++], cx = c % N, cy = (c / N) | 0;
          if (c === b0) break;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const x = cx + dx, y = cy + dy;
            if (x < 1 || y < 1 || x >= N - 1 || y >= N - 1) continue;
            const n = y * N + x, t = terreno[n];
            if (t === T.AGUA || (t === T.ROCA && !tallar) || (veto && veto[n])) continue;
            const w = t === T.ROCA ? 5 : t === T.BOSQUE ? 1 : 0, nc = coste[c] + w;
            if (nc >= coste[n]) continue;
            coste[n] = nc; de[n] = c;
            if (w) { if (fin < cola.length) cola[fin++] = n; } else if (ini > 0) cola[--ini] = n;
          }
        }
        if (coste[b0] >= INF) return null;
        const camino = []; for (let c = b0; c >= 0 && c !== a0; c = de[c]) camino.push(c);
        return camino;
      };
      const abrir = (camino) => { const ds = tallar ? [0, 1, 2, N, N + 1, N + 2, 2 * N, 2 * N + 1, 2 * N + 2] : [0, 1, N, N + 1]; for (const c of camino) for (const d of ds) { const i = c + d; if (i >= NN) continue; for (const q of [i, espejo(i)]) if (q >= 0 && q < NN && (terreno[q] === T.BOSQUE || (tallar && terreno[q] === T.ROCA))) terreno[q] = T.LLANO; } };
      const primero = buscar(null);
      if (primero) {
        abrir(primero);
        const veto = new Uint8Array(NN), R = Math.max(7, Math.round(N * 0.09)), libre = 16; // franja vetada alrededor del primero, salvo junto a las bases
        for (let k = 0; k < primero.length; k += Math.max(1, R >> 1)) {
          const c = primero[k], cx = c % N, cy = (c / N) | 0;
          if (Math.hypot(cx - A.x, cy - A.y) < libre + R || Math.hypot(cx - B.x, cy - B.y) < libre + R) continue;
          for (let y = Math.max(0, cy - R); y <= Math.min(N - 1, cy + R); y++) for (let x = Math.max(0, cx - R); x <= Math.min(N - 1, cx + R); x++) veto[y * N + x] = 1;
        }
        const segundo = cuantos > 1 ? buscar(veto) : null;
        if (segundo) abrir(segundo);
      }
    }
    corredores(false, cfg.pasos);

    const sitioTipo = new Map(sitios.map((s) => [s.y * N + s.x, s.tipo]));
    return { N, semilla, tipo, terreno, mineral, tipoMin, sitios, sitioEn, sitioTipo, bases, alcanzable, puestos };
  };
})();
