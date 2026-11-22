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
    if (tipo && typeof tipo === 'object') return W.mapaDeJSON(tipo); // un mapa propio (del editor)
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

  // ---------- Mapas propios (editor) ----------
  // Formato en JSON: el terreno por tramos repetidos (letra del terreno y cuántas celdas: «l120r3b7»), los recursos como lista dispersa
  // con el índice en diferencias, y sitios, puestos y bases tal cual. Lo que se deduce (por dónde se pasa, qué celda es sitio) se recalcula al cargar.
  const LETRA = 'lrabcp'; // llano, roca, agua, bosque, camino, puente (el orden de W.TERRENO)
  W.FORMATO_MAPA = 'rts.mapa';
  W.mapaAJSON = function (mapa, extra) {
    const N = mapa.N, NN = N * N, t = mapa.terreno; let ter = '';
    for (let i = 0; i < NN;) { let k = i + 1; while (k < NN && t[k] === t[i]) k++; ter += LETRA[t[i]] + (k - i > 1 ? k - i : ''); i = k; }
    const rec = []; let ant = 0;
    for (let i = 0; i < NN; i++) if (mapa.mineral[i] && mapa.tipoMin[i]) { rec.push(i - ant, mapa.mineral[i], mapa.tipoMin[i]); ant = i; }
    const pts = (L) => L.map((p) => ({ x: p.x, y: p.y, tipo: p.tipo }));
    return Object.assign({ formato: W.FORMATO_MAPA, v: 1, nombre: mapa.nombre || '', N, espejo: mapa.espejo !== false, terreno: ter, recursos: rec, sitios: pts(mapa.sitios), puestos: pts(mapa.puestos), bases: mapa.bases.map((b) => ({ x: b.x, y: b.y })) }, extra || {});
  };
  W.mapaDeJSON = function (o) {
    if (typeof o === 'string') o = JSON.parse(o);
    if (!o || o.formato !== W.FORMATO_MAPA) throw new Error('no es un mapa de rts.warfare');
    const N = o.N | 0, NN = N * N; if (N < 32 || N > 1024) throw new Error('tamaño de mapa no válido: ' + o.N);
    const terreno = new Uint8Array(NN), mineral = new Uint16Array(NN), tipoMin = new Uint8Array(NN);
    let c = 0; const s = o.terreno || '';
    for (let k = 0; k < s.length;) { const v = LETRA.indexOf(s[k++]); if (v < 0) throw new Error('terreno ilegible'); let n = 0; while (k < s.length && s[k] >= '0' && s[k] <= '9') n = n * 10 + (s.charCodeAt(k++) - 48); n = n || 1; terreno.fill(v, c, Math.min(NN, c + n)); c += n; }
    if (c !== NN) throw new Error('terreno incompleto: ' + c + ' de ' + NN + ' celdas');
    const r = o.recursos || []; for (let k = 0, i = 0; k + 2 < r.length; k += 3) { i += r[k]; if (i >= 0 && i < NN) { mineral[i] = Math.min(65535, r[k + 1]); tipoMin[i] = r[k + 2]; } }
    const lim = (p) => ({ x: Math.max(0, Math.min(N - 1, p.x | 0)), y: Math.max(0, Math.min(N - 1, p.y | 0)), tipo: p.tipo });
    if (!Array.isArray(o.bases) || o.bases.length !== 2) throw new Error('el mapa necesita dos bases');
    return W.completarMapa({ N, semilla: 0, tipo: 'propio', nombre: o.nombre || '', espejo: o.espejo !== false, terreno, mineral, tipoMin, sitios: (o.sitios || []).map(lim), puestos: (o.puestos || []).map(lim), bases: o.bases.map((b) => { const q = lim(b); return { x: q.x, y: q.y }; }) });
  };
  // Lo que se deduce del resto: qué celdas son sitio (ahí no se construye otra cosa) y hasta dónde se llega a pie desde la primera base.
  W.completarMapa = function (mp) {
    const N = mp.N, NN = N * N, T = W.TERRENO, sitioEn = new Uint8Array(NN);
    for (const s of mp.sitios.concat(mp.puestos)) sitioEn[s.y * N + s.x] = 1;
    mp.sitioEn = sitioEn; mp.sitioTipo = new Map(mp.sitios.map((s) => [s.y * N + s.x, s.tipo]));
    mp.alcanzable = inundar(mp, mp.bases[0], (t) => t === T.LLANO || t === T.BOSQUE || t >= T.CAMINO);
    delete mp.veta; delete mp.vetas;
    return mp;
  };
  function inundar(mp, desde, pasa) {
    const N = mp.N, NN = N * N, visto = new Uint8Array(NN), cola = new Int32Array(NN), t = mp.terreno; let ini = 0, fin = 0;
    const s = desde.y * N + desde.x; if (!pasa(t[s])) return visto; visto[s] = 1; cola[fin++] = s;
    while (ini < fin) { const c = cola[ini++], cx = c % N;
      if (cx > 0 && !visto[c - 1] && pasa(t[c - 1])) { visto[c - 1] = 1; cola[fin++] = c - 1; }
      if (cx < N - 1 && !visto[c + 1] && pasa(t[c + 1])) { visto[c + 1] = 1; cola[fin++] = c + 1; }
      if (c >= N && !visto[c - N] && pasa(t[c - N])) { visto[c - N] = 1; cola[fin++] = c - N; }
      if (c < NN - N && !visto[c + N] && pasa(t[c + N])) { visto[c + N] = 1; cola[fin++] = c + N; } }
    return visto;
  }
  // Las bases donde las pone el generador (a la misma distancia de su esquina), para un mapa que empieza de cero.
  W.basesDe = (N) => { const O = Math.round(14 + (N / 128 - 1) * 4); return [{ x: O, y: N - 1 - O }, { x: N - 1 - O, y: O }]; };
  W.mapaVacio = function (N, relleno, espejo) {
    const T = W.TERRENO, NN = N * N, terreno = new Uint8Array(NN).fill(relleno === 'roca' ? T.ROCA : T.LLANO), bases = W.basesDe(N);
    if (relleno === 'roca') for (const b of bases) for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) if (Math.hypot(dx, dy) <= 6.5) terreno[(b.y + dy) * N + b.x + dx] = T.LLANO; // sitio para la base
    return W.completarMapa({ N, semilla: 0, tipo: 'propio', nombre: '', espejo: espejo !== false, terreno, mineral: new Uint16Array(NN), tipoMin: new Uint8Array(NN), sitios: [], puestos: [], bases });
  };
  // La celda espejo (giro de 180°).
  W.espejoDe = (N, i) => N * N - 1 - i;

  // Revisión de un mapa: lo que lo hace injugable (errores) y lo que lo hace malo (avisos). Para el editor.
  // Entradas de una base: las bocas por las que se sale de su entorno hacia la otra base sin cruzar roca ni agua (el bosque cuenta: lo cruza
  // la infantería y la excavadora lo abre; la roca no). Se miran anillos de 12 a 36 celdas
  // (más en los mapas grandes), de dos en dos: en cada uno se cuentan los tramos de anillo transitables que conectan por dentro con la base y por fuera con el rival.
  // Un tramo de 16 celdas de ancho o más cuenta como abierto (dos o más: no se tapona con una torre). Vale el anillo más cerrado: un cuello cerca o lejos es un cuello.
  W.revisarMapa = function (mp) {
    const N = mp.N, NN = N * N, T = W.TERRENO, errores = [], avisos = [], t = mp.terreno;
    const veh = (v) => v === T.LLANO || v >= T.CAMINO, pie = (v) => veh(v) || v === T.BOSQUE;
    const [A, B] = mp.bases, nb = ['la base 1', 'la base 2'];
    mp.bases.forEach((b, j) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const x = b.x + dx, y = b.y + dy, i = y * N + x; if (x < 1 || y < 1 || x >= N - 1 || y >= N - 1 || t[i] !== T.LLANO || mp.mineral[i] || mp.sitioEn[i]) { errores.push(nb[j] + ' no tiene sitio para el patio (3×3 de llano libre)'); return; } } });
    if (Math.hypot(A.x - B.x, A.y - B.y) < 30) errores.push('las bases están demasiado cerca (menos de 30 celdas)');
    const aV = inundar(mp, A, veh), aP = inundar(mp, A, pie);
    if (!aP[B.y * N + B.x]) errores.push('no hay paso entre las bases, ni a pie');
    else if (!aV[B.y * N + B.x]) avisos.push('entre las bases solo se pasa a pie (por bosque): los vehículos no llegan');
    const bP = inundar(mp, B, pie), K = N / 128, radios = []; for (let r = 12; r <= Math.round(36 * Math.max(1, Math.sqrt(K))); r += 2) radios.push(r);
    const cuellos = [[], []];
    const entradas = [A, B].map((b, j) => {
      const rival = j ? aP : bP; let menor = Infinity;
      for (const R of radios) {
        // celdas del anillo [R-1, R+1] transitables, alcanzables desde la base sin salir del disco, y que tocan una celda de fuera unida al rival
        const den = new Uint8Array(NN), cola = []; const ib = b.y * N + b.x; if (!pie(t[ib])) continue;
        den[ib] = 1; cola.push(ib);
        for (let q = 0; q < cola.length; q++) { const c = cola[q], cx = c % N, cy = (c / N) | 0; for (const d of [1, -1, N, -N]) { const n = c + d, nx = n % N, ny = (n / N) | 0; if (n < 0 || n >= NN || Math.abs(nx - cx) > 1 || den[n] || !pie(t[n]) || Math.hypot(nx - b.x, ny - b.y) > R + 1) continue; den[n] = 1; cola.push(n); } }
        const boca = new Uint8Array(NN); let hay = false;
        for (const c of cola) { const cx = c % N, cy = (c / N) | 0, d0 = Math.hypot(cx - b.x, cy - b.y); if (d0 < R - 1) continue;
          for (const d of [1, -1, N, -N]) { const n = c + d, nx = n % N, ny = (n / N) | 0; if (n < 0 || n >= NN || Math.abs(nx - cx) > 1) continue; if (Math.hypot(nx - b.x, ny - b.y) > R + 1 && pie(t[n]) && rival[n]) { boca[c] = 1; hay = true; break; } } }
        if (!hay) { menor = Math.min(menor, 0); continue; }
        // tramos: componentes conexas (en 8 direcciones) de las celdas de boca; se mide el arco que abarca cada una
        const vista = new Uint8Array(NN); let n = 0; const celdas = [];
        for (const c of cola) { if (!boca[c] || vista[c]) continue; const pila = [c]; vista[c] = 1; const angs = [];
          while (pila.length) { const q = pila.pop(), qx = q % N, qy = (q / N) | 0; angs.push(Math.atan2(qy - b.y, qx - b.x)); for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const x = qx + dx, y = qy + dy, k = y * N + x; if (x < 0 || y < 0 || x >= N || y >= N || vista[k] || !boca[k]) continue; vista[k] = 1; pila.push(k); } }
          angs.sort((p, q) => p - q); let hueco = 2 * Math.PI - (angs[angs.length - 1] - angs[0]); for (let k = 1; k < angs.length; k++) hueco = Math.max(hueco, angs[k] - angs[k - 1]);
          n += (2 * Math.PI - hueco) * R >= 16 ? 2 : 1; }
        if (n < menor && n < 2) { for (const c of cola) if (boca[c]) celdas.push(c); cuellos[j] = celdas; } // dónde está el cuello, para señalarlo en el editor
        menor = Math.min(menor, n);
      }
      return menor === Infinity ? 0 : menor;
    });
    entradas.forEach((n, j) => { if (n < 2) avisos.push(nb[j] + (n === 0 ? ' no tiene salida' : ' tiene una sola entrada: es fácil de taponar')); });
    const cerca = (b, R, f) => { for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { const x = b.x + dx, y = b.y + dy; if (x < 0 || y < 0 || x >= N || y >= N || dx * dx + dy * dy > R * R) continue; if (f(y * N + x)) return true; } return false; };
    const alc = [aP, bP];
    mp.bases.forEach((b, j) => {
      if (!cerca(b, 14, (i) => t[i] === T.AGUA)) avisos.push(nb[j] + ' no tiene agua a menos de 14 celdas (la primera bomba)');
      if (!cerca(b, 20, (i) => mp.tipoMin[i] === 1 && mp.mineral[i] > 0 && alc[j][i])) avisos.push(nb[j] + ' no tiene minerales a menos de 20 celdas');
      if (!mp.sitios.some((s) => s.tipo === 'petroleo' && Math.hypot(s.x - b.x, s.y - b.y) <= 24)) avisos.push(nb[j] + ' no tiene petróleo a menos de 24 celdas');
    });
    let sueltos = 0; for (let i = 0; i < NN; i++) if (mp.mineral[i] && !aP[i]) sueltos++;
    if (sueltos) avisos.push(sueltos + ' celdas de mineral a las que no se llega');
    const malSitio = mp.sitios.concat(mp.puestos).filter((s) => t[s.y * N + s.x] !== T.LLANO || !aP[s.y * N + s.x] || mp.mineral[s.y * N + s.x]).length;
    if (malSitio) avisos.push(malSitio + ' sitios o puestos fuera del llano o donde no se llega');
    return { errores, avisos, entradas, cuellos };
  };
})();
