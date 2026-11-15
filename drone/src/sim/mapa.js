// drone.warfare — el sector: se genera como dibujo (campos, lindes, calles, edificios, camino, arroyo…) y luego se pasa
// a rejilla. El dibujo queda guardado para pintarlo con detalle; la rejilla es lo que usa la simulación.
// Dos escenarios: 'mixto' (campo abierto que acaba en un pueblo, con un arroyo en medio) y 'urbano' (casi todo ciudad).
// El atacante (bando 0) parte del campo o del borde; el defensor (bando 1) tiene su centro dentro del casco urbano.
(function () {
  const D = globalThis.D || (globalThis.D = {});
  const T = D.T, TAU = Math.PI * 2;

  D.generarMapa = function (semilla, escenario) {
    escenario = escenario === 'urbano' ? 'urbano' : 'mixto';
    const N = D.N, az = D.prng(semilla ^ (escenario === 'urbano' ? 0x7A11 : 0)), terreno = new Uint8Array(N * N);
    const entre = (a, b) => a + az() * (b - a), dentro = (x, y) => x >= 0 && y >= 0 && x < N && y < N;
    const pon = (x, y, t) => { x = Math.floor(x); y = Math.floor(y); if (dentro(x, y)) terreno[y * N + x] = t; };
    const disco = (cx, cy, r, t, solo) => { for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) if (dentro(x, y) && Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r && (!solo || solo(terreno[y * N + x]))) terreno[y * N + x] = t; };
    const trazo = (pts, r, t, solo) => { for (let i = 0; i + 1 < pts.length; i++) { const [ax, ay] = pts[i], [bx, by] = pts[i + 1], L = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(L * 2)); for (let k = 0; k <= n; k++) disco(ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n, r, t, solo); } };
    const enPoli = (p, x, y) => { let d = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) if (p[i][1] > y !== p[j][1] > y && x < ((p[j][0] - p[i][0]) * (y - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) d = !d; return d; };
    const curva = (pasos, desvio) => { const o = [pasos[0]]; for (let i = 0; i + 1 < pasos.length; i++) { const [ax, ay] = pasos[i], [bx, by] = pasos[i + 1]; for (let k = 1; k <= 4; k++) { const f = k / 4, s = k < 4 ? Math.sin(f * Math.PI) : 0; o.push([ax + (bx - ax) * f + (az() - 0.5) * desvio * s, ay + (by - ay) * f + (az() - 0.5) * desvio * s]); } } return o; };
    const blando = (t) => t === T.SUELO || t === T.CAMPO || t === T.HIERBA || t === T.CRATER;
    const libre = (x, y) => { x = Math.floor(x); y = Math.floor(y); return dentro(x, y) && x >= 3 && y >= 3 && x <= N - 4 && y <= N - 4 && blando(terreno[y * N + x]); };

    // El sector se dibuja con el atacante abajo a la izquierda (en cualquier punto de esos dos bordes) y el casco urbano en el
    // cuadrante opuesto (o casi todo, en 'urbano'); al final se le da la vuelta al azar (ocho orientaciones), así que el
    // atacante puede salir de cualquier borde. El centro del defensor cae en una manzana cualquiera lejos del atacante.
    const ataque = az() < 0.5 ? { x: Math.round(entre(10, 36)), y: Math.round(entre(N - 15, N - 10)) } : { x: Math.round(entre(10, 15)), y: Math.round(entre(N - 38, N - 10)) };
    const U = escenario === 'urbano' ? { x0: 5, y0: 4, x1: N - 4, y1: N - 5 } : { x0: Math.round(N * entre(0.44, 0.5)), y0: 4, x1: N - 4, y1: Math.round(N * entre(0.52, 0.58)) };

    // 1. Campo: parcelas aradas, manchas de hierba, lindes de árboles y bosquetes.
    const campos = [], hierbas = []; let arboles = [];
    for (let i = 0; i < 6; i++) { const cx = entre(8, N - 8), cy = entre(8, N - 8), w = entre(12, 24), h = entre(10, 20), a = entre(0, Math.PI), c = Math.cos(a), s = Math.sin(a); campos.push({ pts: [[-w, -h], [w, -h * entre(0.7, 1)], [w * entre(0.7, 1), h], [-w, h]].map(([px, py]) => [cx + px * c - py * s, cy + px * s + py * c]), ang: entre(0, Math.PI) }); }
    for (let i = 0; i < 7; i++) hierbas.push({ x: entre(4, N - 4), y: entre(4, N - 4), rx: entre(6, 15), ry: entre(4, 10), ang: entre(0, Math.PI) });
    for (const h of hierbas) { const c = Math.cos(-h.ang), s = Math.sin(-h.ang); for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const dx = x + 0.5 - h.x, dy = y + 0.5 - h.y, u = (dx * c - dy * s) / h.rx, v = (dx * s + dy * c) / h.ry; if (u * u + v * v <= 1) terreno[y * N + x] = T.HIERBA; } }
    for (const f of campos) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (enPoli(f.pts, x + 0.5, y + 0.5)) terreno[y * N + x] = T.CAMPO;
    const arbol = (x, y, r) => { if (x > 1 && y > 1 && x < N - 1 && y < N - 1) { arboles.push({ x, y, r }); disco(x, y, Math.max(0.6, r * 0.8), T.BOSQUE, (t) => t !== T.CAMINO && t !== T.MURO && t !== T.RUINA && t !== T.AGUA); } };
    for (let i = 0; i < 9; i++) { const x0 = entre(6, N - 6), y0 = entre(6, N - 6), a = entre(0, TAU), L = entre(16, 40); for (let d = 0; d < L; d += entre(0.7, 1.1)) arbol(x0 + Math.cos(a) * d + entre(-0.9, 0.9), y0 + Math.sin(a) * d + entre(-0.9, 0.9), entre(0.75, 1.35)); }
    for (let i = 0; i < 5; i++) { const x0 = entre(10, N - 10), y0 = entre(10, N - 10), R = entre(4, 8); for (let k = 0; k < R * R * 0.9; k++) { const a = entre(0, TAU), d = Math.sqrt(az()) * R; arbol(x0 + Math.cos(a) * d, y0 + Math.sin(a) * d * 0.8, entre(0.75, 1.4)); } }

    // 2. El arroyo (solo en el escenario mixto): cruza el sector entre el campo del atacante y el pueblo.
    const arroyo = escenario === 'mixto' ? curva([[-1, entre(N * 0.3, N * 0.42)], [N * 0.3, entre(N * 0.46, N * 0.56)], [N * 0.6, entre(N * 0.62, N * 0.72)], [N + 1, entre(N * 0.7, N * 0.8)]], 8) : [];
    if (arroyo.length) trazo(arroyo, 1.25, T.AGUA);

    // 3. El casco urbano: se despeja, se trazan calles en retícula y cada manzana se llena de edificios, patios y escombro.
    for (let y = U.y0; y <= U.y1; y++) for (let x = U.x0; x <= U.x1; x++) if (terreno[y * N + x] !== T.AGUA) terreno[y * N + x] = T.SUELO;
    const cortes = (a, b) => { const o = [a]; let p = a; while (p + 16 < b) { p += Math.round(entre(9, 12)); o.push(p); } o.push(b); return o; };
    const cx = cortes(U.x0, U.x1), cy = cortes(U.y0, U.y1), calles = [];
    for (const x of cx) calles.push([[x + 0.5, U.y0 + 0.5], [x + 0.5, U.y1 + 0.5]]); for (const y of cy) calles.push([[U.x0 + 0.5, y + 0.5], [U.x1 + 0.5, y + 0.5]]);
    for (const c of calles) trazo(c, 0.8, T.CAMINO, (t) => t !== T.AGUA);
    const ruinas = [], casa = (x, y, w, h, alto) => {
      x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h); if (w < 3 || h < 3 || x < 2 || y < 2 || x + w > N - 2 || y + h > N - 2) return false;
      if (Math.hypot(x + w / 2 - ataque.x, y + h / 2 - ataque.y) < 11) return false;
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const t = terreno[(y + j) * N + x + i]; if (t === T.CAMINO || t === T.AGUA || t === T.MURO || t === T.RUINA) return false; }
      const huecos = []; for (let k = 0; k < (w + h > 12 ? 4 : 3); k++) { const lado = Math.floor(az() * 4); huecos.push(lado < 2 ? [x + 1 + Math.floor(az() * (w - 2)), lado ? y + h - 1 : y] : [lado === 2 ? x : x + w - 1, y + 1 + Math.floor(az() * (h - 2))]); }
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) pon(x + i, y + j, i === 0 || j === 0 || i === w - 1 || j === h - 1 ? T.MURO : T.RUINA);
      for (const [hx, hy] of huecos) pon(hx, hy, T.RUINA);
      ruinas.push({ x, y, w, h, huecos, alto: !!alto, part: az() < 0.6 ? entre(0.35, 0.65) : 0 }); return true;
    };
    const manzanas = [];
    for (let j = 0; j + 1 < cy.length; j++) for (let i = 0; i + 1 < cx.length; i++) manzanas.push({ x0: cx[i] + 2, y0: cy[j] + 2, x1: cx[i + 1] - 2, y1: cy[j + 1] - 2 });
    // La manzana del defensor: una cualquiera de las que dan la talla y quedan a más de 580 m del atacante. Se deja como patio
    // para el centro. (Si ninguna cumple, la más alejada de entre las interiores.)
    let mia = null, md = -1; for (const b of manzanas) { const mx = (b.x0 + b.x1) / 2, my = (b.y0 + b.y1) / 2, q = az(); if (b.x1 - b.x0 >= 6 && b.y1 - b.y0 >= 5 && Math.hypot(mx - ataque.x, my - ataque.y) >= 58 && q > md) { md = q; mia = b; } }
    if (!mia) for (const b of manzanas) { const mx = (b.x0 + b.x1) / 2, my = (b.y0 + b.y1) / 2, borde = Math.min(mx - U.x0, U.x1 - mx, my - U.y0, U.y1 - my), d = Math.hypot(mx - ataque.x, my - ataque.y) + (borde > 9 ? 12 : 0) + (Math.max(b.x1 - b.x0, b.y1 - b.y0) >= 10 ? 14 : 0) + entre(0, 6); if (b.x1 - b.x0 >= 6 && b.y1 - b.y0 >= 5 && d > md) { md = d; mia = b; } }
    if (!mia) for (const b of manzanas) if (!mia || (b.x1 - b.x0) * (b.y1 - b.y0) > (mia.x1 - mia.x0) * (mia.y1 - mia.y0)) mia = b; // (si ninguna da la talla, la mayor)
    mia.reservada = true;
    // Patios señuelo: otras manzanas que también se dejan vacías y con sacos, para que el patio del centro no se distinga a simple vista.
    const patios = [mia]; { const cand = manzanas.filter((b) => !b.reservada && b.x1 - b.x0 >= 6 && b.y1 - b.y0 >= 5 && Math.hypot((b.x0 + b.x1) / 2 - ataque.x, (b.y0 + b.y1) / 2 - ataque.y) >= 30).map((b) => ({ b, q: az() })).sort((a, c) => a.q - c.q); for (const { b } of cand.slice(0, escenario === 'urbano' ? 5 : 3)) { b.reservada = true; patios.push(b); } }
    patios.sort((a, c) => a.x0 - c.x0 || a.y0 - c.y0);
    for (const b of manzanas) {
      if (b.reservada) continue; const w = b.x1 - b.x0 + 1, h = b.y1 - b.y0 + 1, q = az();
      if (q < 0.1) { for (let k = 0; k < w * h * 0.12; k++) arbol(entre(b.x0, b.x1 + 1), entre(b.y0, b.y1 + 1), entre(0.75, 1.3)); b.tipo = 'parque'; continue; } // plaza arbolada
      if (q < 0.28 && w >= 6 && h >= 5) { casa(b.x0, b.y0, w, h, true); b.tipo = 'bloque'; continue; } // un bloque grande que ocupa la manzana
      for (let k = 0; k < 5; k++) { const cw = Math.round(entre(3, Math.min(6, w))), chh = Math.round(entre(3, Math.min(6, h))); casa(b.x0 + Math.floor(az() * Math.max(1, w - cw + 1)), b.y0 + Math.floor(az() * Math.max(1, h - chh + 1)), cw, chh, az() < 0.25); }
      for (let k = 0; k < 2; k++) if (az() < 0.5) arbol(entre(b.x0, b.x1 + 1), entre(b.y0, b.y1 + 1), entre(0.7, 1.1)); // algún árbol de patio
    }
    // Granjas sueltas en el campo (escenario mixto).
    if (escenario === 'mixto') for (const [gx, gy] of [[entre(N * 0.12, N * 0.36), entre(N * 0.1, N * 0.28)], [entre(N * 0.3, N * 0.5), entre(N * 0.72, N * 0.88)]]) { casa(gx, gy, entre(4, 6), entre(4, 6)); casa(gx + entre(6, 8), gy + entre(-2, 3), entre(3, 5), entre(3, 5)); }

    // 4. El defensor: en su manzana, el centro; a los lados, taller y barracón. Las antenas, en otros patios.
    const defensa = { x: Math.round((mia.x0 + mia.x1) / 2), y: Math.round((mia.y0 + mia.y1) / 2) }, ancha = mia.x1 - mia.x0 >= mia.y1 - mia.y0;
    const bases = [ataque, defensa];
    ataque.frente = Math.atan2(defensa.y - ataque.y, defensa.x - ataque.x); defensa.frente = ataque.frente + Math.PI;
    defensa.centro = { x: defensa.x, y: defensa.y };
    const patio = (dmin, dmax, evita) => { for (let k = 0; k < 400; k++) { const x = Math.round(entre(U.x0 + 2, U.x1 - 2)), y = Math.round(entre(U.y0 + 2, U.y1 - 2)), d = Math.hypot(x - defensa.x, y - defensa.y); if (d >= dmin && d <= dmax && libre(x, y) && terreno[y * N + x] === T.SUELO && !(x >= mia.x0 - 1 && x <= mia.x1 + 1 && y >= mia.y0 - 1 && y <= mia.y1 + 1) && evita.every((e) => Math.hypot(e.x - x, e.y - y) > 9)) return { x, y }; } return null; };
    // El taller no está pegado al centro: a 90–160 m, en otra manzana, donde no pise calle ni agua (los edificios que estorben se quitan luego).
    const sitio = (dmin, dmax, lejosDe) => { for (let k = 0; k < 600; k++) { const x = Math.round(entre(U.x0 + 5, U.x1 - 5)), y = Math.round(entre(U.y0 + 5, U.y1 - 5)), d = Math.hypot(x - defensa.x, y - defensa.y); if (d < dmin || d > dmax || x < 6 || y < 6 || x > N - 7 || y > N - 7 || Math.hypot(x - ataque.x, y - ataque.y) < 40 || (lejosDe && Math.hypot(x - lejosDe.x, y - lejosDe.y) < 9) || (x >= mia.x0 - 4 && x <= mia.x1 + 4 && y >= mia.y0 - 4 && y <= mia.y1 + 4)) continue; let bien = true; for (let j = -3; j <= 3 && bien; j++) for (let i = -3; i <= 3; i++) { const t = terreno[(y + j) * N + x + i]; if (t === T.CAMINO || t === T.AGUA) { bien = false; break; } } if (bien) return { x, y }; } return null; };
    defensa.taller = sitio(9, 16) || sitio(7, 24) || (ancha ? { x: defensa.x + 4, y: defensa.y } : { x: defensa.x, y: defensa.y + 4 });
    defensa.barracon = sitio(7, 14, defensa.taller) || sitio(6, 22, defensa.taller) || (ancha ? { x: defensa.x - 4, y: defensa.y } : { x: defensa.x, y: defensa.y - 4 }); // el barracón tampoco delata al centro
    defensa.antenas = []; for (let k = 0; k < 2; k++) { const p = patio(11, 26, defensa.antenas.concat([defensa.taller])); if (p) defensa.antenas.push(p); }
    defensa.falsa = patio(8, 24, defensa.antenas) || patio(6, 30, []); defensa.escucha = patio(6, 16, defensa.antenas.concat(defensa.falsa ? [defensa.falsa] : [])) || patio(4, 24, []);
    if (!defensa.antenas.length) defensa.antenas.push({ x: mia.x0, y: mia.y0 });

    // 5. Trincheras: una del defensor en el borde del pueblo que mira al atacante, y otra abandonada en tierra de nadie.
    const trincheras = [], firme = (t) => t !== T.AGUA && t !== T.MURO && t !== T.RUINA && t !== T.CAMINO, zanja = (x0, y0, a, L) => { const pts = [], c = Math.cos(a), s = Math.sin(a); for (let i = 0; i <= L / 2.4; i++) { const d = i * 2.4, lado = i % 2 ? 1.1 : -1.1; pts.push([x0 + c * d - s * lado, y0 + s * d + c * lado]); } trincheras.push(pts); trazo(pts, 0.45, T.TRINCHERA, firme); };
    if (escenario === 'mixto') { const a = defensa.frente, d = Math.min(Math.hypot(defensa.x - U.x0, 0) + 4, 30), px = defensa.x + Math.cos(a) * d, py = defensa.y + Math.sin(a) * d; zanja(px - Math.cos(a + Math.PI / 2) * 9, py - Math.sin(a + Math.PI / 2) * 9, a + Math.PI / 2, 18); }
    zanja(ataque.x + Math.cos(ataque.frente) * entre(26, 34) + entre(-6, 6), ataque.y + Math.sin(ataque.frente) * entre(26, 34) + entre(-6, 6), ataque.frente + Math.PI / 2 + entre(-0.4, 0.4), 13);

    // 6. Cráteres: por todas partes, más espesos entre los dos bandos.
    const crateres = [], mx = (ataque.x + defensa.x) / 2, my = (ataque.y + defensa.y) / 2;
    for (let i = 0; i < 44; i++) { const lejos = i > 26, x = lejos ? entre(4, N - 4) : mx + entre(-26, 26), y = lejos ? entre(4, N - 4) : my + entre(-26, 26), r = entre(0.6, 1.5); if (!dentro(Math.floor(x), Math.floor(y)) || !blando(terreno[Math.floor(y) * N + Math.floor(x)])) continue; crateres.push({ x, y, r }); disco(x, y, r * 0.8, T.CRATER, blando); }

    // 7. El camino de fuera: del punto de partida del atacante a la esquina más cercana de la retícula. Manda sobre lo
    // demás: donde cruza el agua hay puente.
    let nudo = [cx[0], cy[cy.length - 1]], nd = 1e9; for (const x of cx) for (const y of cy) { const d = Math.hypot(x - ataque.x, y - ataque.y); if (d < nd) { nd = d; nudo = [x, y]; } }
    const camino = curva([[ataque.x + 3, ataque.y - 3], [(ataque.x + nudo[0]) / 2 + entre(-6, 6), (ataque.y + nudo[1]) / 2 + entre(-6, 6)], [nudo[0] + 0.5, nudo[1] + 0.5]], 9);
    for (let i = 0; i + 1 < camino.length; i++) { const [ax, ay] = camino[i], [bx, by] = camino[i + 1], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * 2)); for (let k = 0; k <= n; k++) { const px = ax + ((bx - ax) * k) / n, py = ay + ((by - ay) * k) / n; for (let y = Math.floor(py - 0.9); y <= py + 0.9; y++) for (let x = Math.floor(px - 0.9); x <= px + 0.9; x++) if (dentro(x, y) && Math.hypot(x + 0.5 - px, y + 0.5 - py) <= 0.95) { const t = terreno[y * N + x]; if (t !== T.MURO && t !== T.RUINA) terreno[y * N + x] = t === T.AGUA || t === T.PUENTE ? T.PUENTE : T.CAMINO; } } }
    // Las calles que cruzan el arroyo también llevan puente.
    for (const c of calles) for (let k = 0; k <= 200; k++) { const x = c[0][0] + ((c[1][0] - c[0][0]) * k) / 200, y = c[0][1] + ((c[1][1] - c[0][1]) * k) / 200; for (const [dx, dy] of [[0, 0], [0.6, 0], [-0.6, 0], [0, 0.6], [0, -0.6]]) { const X = Math.floor(x + dx), Y = Math.floor(y + dy); if (dentro(X, Y) && terreno[Y * N + X] === T.AGUA) terreno[Y * N + X] = T.PUENTE; } }

    // 8. Dos vados en el arroyo.
    const vados = [];
    if (arroyo.length) for (const f of [entre(0.1, 0.25), entre(0.4, 0.55)]) { const i = Math.min(arroyo.length - 2, Math.floor(f * (arroyo.length - 1))), x = (arroyo[i][0] + arroyo[i + 1][0]) / 2, y = (arroyo[i][1] + arroyo[i + 1][1]) / 2; if (!dentro(Math.floor(x), Math.floor(y))) continue; vados.push({ x, y }); disco(x, y, 2.3, T.VADO, (t) => t === T.AGUA); }

    // 9. Pasos bajo tierra: dos tuberías o alcantarillas. Cada una une una boca del lado del atacante con otra dentro del pueblo.
    const tubos = [];
    for (let k = 0; k < 2; k++) {
      const f = k ? entre(0.62, 0.74) : entre(0.4, 0.52), lado = (k ? 1 : -1) * entre(8, 16), bx = ataque.x + (defensa.x - ataque.x) * f - Math.sin(ataque.frente) * lado, by = ataque.y + (defensa.y - ataque.y) * f + Math.cos(ataque.frente) * lado, L = entre(16, 24);
      let a = null, b = null; for (let d = 0; d < 9 && !a; d++) for (let q = 0; q < 8 && !a; q++) { const x = bx - Math.cos(ataque.frente) * L / 2 + Math.cos(q) * d, y = by - Math.sin(ataque.frente) * L / 2 + Math.sin(q) * d; if (libre(x, y)) a = { x: Math.floor(x) + 0.5, y: Math.floor(y) + 0.5 }; }
      for (let d = 0; d < 9 && !b; d++) for (let q = 0; q < 8 && !b; q++) { const x = bx + Math.cos(ataque.frente) * L / 2 + Math.cos(q) * d, y = by + Math.sin(ataque.frente) * L / 2 + Math.sin(q) * d; if (libre(x, y)) b = { x: Math.floor(x) + 0.5, y: Math.floor(y) + 0.5 }; }
      if (a && b && Math.hypot(a.x - b.x, a.y - b.y) > 8) tubos.push({ a, b });
    }

    // 10. El punto de partida del atacante: un claro con barracón, un taller pequeño y, apartada, su antena.
    { const b = ataque, a = b.frente, lado = a + Math.PI / 2;
      disco(b.x + 0.5, b.y + 0.5, 6.5, T.SUELO, (t) => t !== T.CAMINO && t !== T.PUENTE);
      b.barracon = { x: b.x, y: b.y }; b.taller = { x: Math.round(b.x + Math.cos(lado) * 4.5), y: Math.round(b.y + Math.sin(lado) * 4.5) };
      let an = null; for (let d = 12; d > 6 && !an; d--) for (const s of [-1, 1]) { const x = Math.round(b.x + Math.cos(lado) * d * s - Math.cos(a) * 3), y = Math.round(b.y + Math.sin(lado) * d * s - Math.sin(a) * 3); if (!an && libre(x, y)) an = { x, y }; }
      b.antenas = [an || { x: Math.round(b.x - Math.cos(a) * 5), y: Math.round(b.y - Math.sin(a) * 5) }]; }
    for (const b of bases) for (const an of b.antenas) disco(an.x + 0.5, an.y + 0.5, 1.4, T.SUELO, (t) => t === T.BOSQUE || t === T.CRATER);
    // El patio del defensor queda despejado (salvo la calle).
    for (const p of patios) for (let y = p.y0; y <= p.y1; y++) for (let x = p.x0; x <= p.x1; x++) if (terreno[y * N + x] !== T.CAMINO && terreno[y * N + x] !== T.AGUA) terreno[y * N + x] = T.SUELO;
    for (const p of [defensa.taller, defensa.barracon]) { const g = p === defensa.taller ? 4 : 3; disco(p.x + 0.5, p.y + 0.5, g + 0.2, T.SUELO, (t) => t !== T.CAMINO && t !== T.AGUA); for (let i = ruinas.length - 1; i >= 0; i--) { const r = ruinas[i]; if (p.x + g > r.x && p.x - g < r.x + r.w && p.y + g > r.y && p.y - g < r.y + r.h) { for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) terreno[y * N + x] = T.SUELO; ruinas.splice(i, 1); } } } // si el taller o el barracón se salen del patio, se les hace sitio

    // 11. Obstáculos bajos: lo que da cobertura a quien se pone detrás. En el pueblo, escombros y coches calcinados en las aceras;
    // en el campo, tramos de murete de piedra. No se pisan, pero no cortan la vista. Nunca sobre camino ni calle.
    let muretes = []; const bocas = new Set(); for (const t of tubos) for (const b of [t.a, t.b]) bocas.add(Math.floor(b.y) * N + Math.floor(b.x));
    const murete = (x, y, tipo, ang) => { x = Math.floor(x); y = Math.floor(y); if (!dentro(x, y) || x < 2 || y < 2 || x > N - 3 || y > N - 3) return; const c = y * N + x, t = terreno[c]; if ((t !== T.SUELO && t !== T.CAMPO && t !== T.HIERBA) || bocas.has(c)) return; for (const b of bases) if (Math.hypot(x - b.x, y - b.y) < 3) return; for (const p of [defensa.taller, defensa.barracon, ataque.taller]) if (Math.hypot(x - p.x, y - p.y) < 2.6) return; for (const p of [...defensa.antenas, ...ataque.antenas, defensa.falsa, defensa.escucha]) if (p && Math.abs(x - p.x) < 2 && Math.abs(y - p.y) < 2) return; terreno[c] = T.MURETE; muretes.push({ x, y, tipo, ang: ang || 0 }); };
    for (const b of manzanas) { if (b.reservada) continue; for (let k = 0; k < 5; k++) { const lado = Math.floor(az() * 4), x = lado === 0 ? b.x0 - 1 : lado === 1 ? b.x1 + 1 : Math.round(entre(b.x0, b.x1)), y = lado === 2 ? b.y0 - 1 : lado === 3 ? b.y1 + 1 : Math.round(entre(b.y0, b.y1)); murete(x, y, az() < 0.4 ? 'coche' : 'escombro', lado < 2 ? Math.PI / 2 : 0); } }
    for (const p of patios) { for (const [x, y] of [[p.x0, p.y0], [p.x1, p.y0], [p.x0, p.y1], [p.x1, p.y1], [Math.round((p.x0 + p.x1) / 2), p.y0], [Math.round((p.x0 + p.x1) / 2), p.y1]]) murete(x, y, 'sacos', 0); } // el patio del defensor, con sacos en las esquinas
    for (let i = 0; i < 12; i++) { const x0 = entre(6, N - 6), y0 = entre(6, N - 6), a = Math.floor(az() * 4) * (Math.PI / 4), L = Math.round(entre(3, 7)); if (x0 >= U.x0 - 1 && x0 <= U.x1 + 1 && y0 >= U.y0 - 1 && y0 <= U.y1 + 1) continue; for (let d = 0; d < L; d++) murete(x0 + Math.cos(a) * d, y0 + Math.sin(a) * d, 'piedra', a); }
    muretes = muretes.filter((q) => terreno[q.y * N + q.x] === T.MURETE);
    arboles = arboles.filter((a) => terreno[Math.floor(a.y) * N + Math.floor(a.x)] === T.BOSQUE);
    { const con = new Uint8Array(N * N); for (const a of arboles) { const r = Math.max(0.6, a.r * 0.8); for (let y = Math.floor(a.y - r); y <= a.y + r; y++) for (let x = Math.floor(a.x - r); x <= a.x + r; x++) if (dentro(x, y) && Math.hypot(x + 0.5 - a.x, y + 0.5 - a.y) <= r) con[y * N + x] = 1; } for (let c = 0; c < N * N; c++) if (terreno[c] === T.BOSQUE && !con[c]) terreno[c] = c % N >= U.x0 && c % N <= U.x1 && ((c / N) | 0) >= U.y0 && ((c / N) | 0) <= U.y1 ? T.SUELO : T.HIERBA; }

    const paso = new Uint8Array(N * N); for (let c = 0; c < N * N; c++) paso[c] = terreno[c] !== T.AGUA && terreno[c] !== T.MURO && terreno[c] !== T.MURETE ? 1 : 0;
    return voltea({ N, semilla, escenario, terreno, paso, bases, urbano: U, patio: mia, patios, muretes, campos, hierbas, arboles, arroyo, calles, ruinas, trincheras, crateres, camino, vados, tubos }, Math.floor(az() * 8));
  };
  // Le da la vuelta al sector entero (rejilla y dibujo): k de 0 a 7 — bit 1, espejo en x; bit 2, espejo en y; bit 4, cambia x por y.
  function voltea(mp, k) {
    if (!k) return mp;
    const N = mp.N, fx = k & 1, fy = k & 2, tr = k & 4;
    const P = (x, y) => { if (fx) x = N - x; if (fy) y = N - y; return tr ? [y, x] : [x, y]; }, C = (x, y) => { if (fx) x = N - 1 - x; if (fy) y = N - 1 - y; return tr ? [y, x] : [x, y]; };
    const A = (a) => { if (fx) a = Math.PI - a; if (fy) a = -a; return tr ? Math.PI / 2 - a : a; };
    const pc = (o) => { if (o) [o.x, o.y] = C(o.x, o.y); }, pp = (o) => { if (o) [o.x, o.y] = P(o.x, o.y); }, lista = (l) => l.map(([x, y]) => P(x, y));
    const caja = (x0, y0, x1, y1) => { const [ax, ay] = C(x0, y0), [bx, by] = C(x1, y1); return [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)]; };
    const terreno = new Uint8Array(N * N), paso = new Uint8Array(N * N); for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const [X, Y] = C(x, y); terreno[Y * N + X] = mp.terreno[y * N + x]; paso[Y * N + X] = mp.paso[y * N + x]; }
    mp.terreno = terreno; mp.paso = paso;
    for (const b of mp.bases) { pc(b); b.frente = A(b.frente); pc(b.barracon); pc(b.taller); pc(b.falsa); pc(b.escucha); for (const a of b.antenas) pc(a); if (b.centro) pc(b.centro); }
    for (const r of [mp.urbano, ...mp.patios]) [r.x0, r.y0, r.x1, r.y1] = caja(r.x0, r.y0, r.x1, r.y1);
    for (const q of mp.muretes) { pc(q); q.ang = A(q.ang); }
    for (const f of mp.campos) { f.pts = lista(f.pts); f.ang = A(f.ang); }
    for (const h of mp.hierbas) { pp(h); h.ang = A(h.ang); }
    for (const a of mp.arboles) pp(a); for (const q of mp.crateres) pp(q); for (const v of mp.vados) pp(v); for (const t of mp.tubos) { pp(t.a); pp(t.b); }
    mp.arroyo = lista(mp.arroyo); mp.camino = lista(mp.camino); mp.calles = mp.calles.map(lista); mp.trincheras = mp.trincheras.map(lista);
    for (const r of mp.ruinas) { const [x0, y0, x1, y1] = caja(r.x, r.y, r.x + r.w - 1, r.y + r.h - 1); r.x = x0; r.y = y0; r.w = x1 - x0 + 1; r.h = y1 - y0 + 1; r.huecos = r.huecos.map(([x, y]) => C(x, y)); }
    return mp;
  }


  // ¿Se puede ir a pie de una celda a otra? (relleno por vecinos; para las pruebas y para comprobar el mapa)
  D.conectado = function (mapa, ax, ay, bx, by) {
    const N = mapa.N, visto = new Uint8Array(N * N), cola = [ay * N + ax]; visto[cola[0]] = 1;
    for (let i = 0; i < cola.length; i++) { const c = cola[i]; if (c === by * N + bx) return true; const x = c % N, y = (c / N) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= N || Y >= N) continue; const k = Y * N + X; if (!visto[k] && mapa.paso[k]) { visto[k] = 1; cola.push(k); } } }
    return false;
  };
})();
