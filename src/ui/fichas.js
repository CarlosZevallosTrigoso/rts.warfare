// rts.warfare — dibujo de las fichas (unidades y edificios) en canvas.
// Tres niveles de detalle: 0 lejos (forma plana), 1 medio (silueta), 2 cerca (todo).
// col = { base, osc, luz, suelo, mineral, humo, fuego, mal }
(function () {
  const W = globalThis.W, TAU = Math.PI * 2;

  // ---------- unidades ----------
  // El contexto llega trasladado al centro de la unidad. r = radio en píxeles.
  // e = { ang, angT, retro (0..1), anda, tiempo, carga (0..1), cosecha }
  W.fichaUnidad = function (c, u, r, lod, col, e) {
    const inf = W.UNID[u.tipo].cat === 'inf', at = u.tipo === 'antitanque', pesado = u.tipo === 'pesado';
    if (lod === 0) {
      c.fillStyle = col.base; c.beginPath();
      if (inf) c.arc(0, 0, r, 0, TAU);
      else if (u.tipo !== 'cosechadora') { c.moveTo(0, -r * 1.15); c.lineTo(r * 1.15, 0); c.lineTo(0, r * 1.15); c.lineTo(-r * 1.15, 0); c.closePath(); }
      else c.rect(-r, -r, r * 2, r * 2);
      c.fill();
      return;
    }
    c.save(); c.rotate(e.ang); c.lineJoin = 'round';
    if (inf) {
      const R = r * 1.4;
      c.strokeStyle = col.osc; c.lineCap = at ? 'butt' : 'round'; c.lineWidth = Math.max(1.4, R * (at ? 0.55 : 0.3)); // fusil, o tubo lanzacohetes al hombro
      c.beginPath(); c.moveTo(R * (at ? -0.7 : 0.1), R * 0.5); c.lineTo(R * ((at ? 1.3 : 1.55) - e.retro * 0.3), R * 0.5); c.stroke();
      if (lod === 2) { c.fillStyle = col.osc; c.fillRect(-R * 0.95, -R * 0.5, R * 0.5, R); } // mochila
      c.fillStyle = col.base; c.beginPath(); c.ellipse(0, 0, R * 0.62, R, 0, 0, TAU); c.fill(); // hombros
      c.strokeStyle = col.osc; c.lineWidth = 1; c.stroke();
      c.fillStyle = at ? col.osc : col.luz; c.strokeStyle = at ? col.luz : col.osc; c.beginPath(); c.arc(R * 0.08, 0, R * 0.42, 0, TAU); c.fill(); c.stroke(); // casco
      if (e.retro > 0.5) { c.fillStyle = col.fuego; c.beginPath(); c.arc(R * 1.75, R * 0.5, R * 0.3, 0, TAU); c.fill(); }
    } else if (u.tipo === 'tanque' || pesado) {
      const L = r * 1.4, w = r;
      c.fillStyle = col.osc; c.fillRect(-L, -w, L * 2, w * 0.44); c.fillRect(-L, w * 0.56, L * 2, w * 0.44); // orugas
      if (lod === 2) { // eslabones, que corren al avanzar
        const paso = L * 0.3, fase = e.anda ? (e.tiempo * 0.02) % paso : 0;
        c.strokeStyle = col.luz; c.globalAlpha = 0.45; c.lineWidth = 1; c.beginPath();
        for (let x = -L + fase; x < L; x += paso) { c.moveTo(x, -w); c.lineTo(x, -w * 0.56); c.moveTo(x, w * 0.56); c.lineTo(x, w); }
        c.stroke(); c.globalAlpha = 1;
      }
      c.fillStyle = col.base; c.strokeStyle = col.osc; c.lineWidth = 1; c.beginPath(); // casco con proa en bisel
      c.moveTo(-L * 0.92, -w * 0.64); c.lineTo(L * 0.6, -w * 0.64); c.lineTo(L * 0.96, -w * 0.3); c.lineTo(L * 0.96, w * 0.3); c.lineTo(L * 0.6, w * 0.64); c.lineTo(-L * 0.92, w * 0.64); c.closePath();
      c.fill(); c.stroke();
      if (lod === 2) { // rejilla del motor
        c.strokeStyle = col.osc; c.beginPath();
        for (let k = 0; k < 3; k++) { const x = -L * (0.8 - k * 0.13); c.moveTo(x, -w * 0.4); c.lineTo(x, w * 0.4); }
        c.stroke();
      }
      c.rotate(e.angT - e.ang); // la torreta gira aparte
      const rec = e.retro * L * 0.25;
      c.fillStyle = col.osc;
      for (const o of pesado ? [-0.2, 0.2] : [0]) { // cañón con freno de boca; el pesado lleva dos
        c.fillRect(w * 0.2 - rec, w * (o - 0.12), L * 1.25, w * 0.24); c.fillRect(w * 0.2 - rec + L * 1.12, w * (o - 0.18), L * 0.16, w * 0.36);
      }
      c.fillStyle = col.base; c.strokeStyle = col.luz; c.lineWidth = Math.max(1, r * 0.14); c.beginPath();
      for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU; c.lineTo(Math.cos(a) * w * 0.52, Math.sin(a) * w * 0.52); }
      c.closePath(); c.fill(); c.stroke();
      if (lod === 2) { c.fillStyle = col.luz; c.beginPath(); c.arc(-w * 0.12, w * 0.12, w * 0.13, 0, TAU); c.fill(); } // escotilla
      if (e.retro > 0.6) { c.fillStyle = col.fuego; c.beginPath(); c.arc(w * 0.2 + L * 1.45, 0, w * 0.34, 0, TAU); c.fill(); }
    } else if (u.tipo === 'artilleria') {
      const L = r * 1.4, w = r * 0.85;
      c.strokeStyle = col.osc; c.lineWidth = Math.max(1.5, r * 0.22); c.beginPath(); // patas de anclaje
      c.moveTo(-L * 0.7, -w * 0.4); c.lineTo(-L * 1.4, -w); c.moveTo(-L * 0.7, w * 0.4); c.lineTo(-L * 1.4, w); c.stroke();
      c.fillStyle = col.osc; c.fillRect(-L * 0.9, -w, L * 1.5, w * 0.4); c.fillRect(-L * 0.9, w * 0.6, L * 1.5, w * 0.4); // orugas cortas
      c.fillStyle = col.base; c.lineWidth = 1; c.beginPath(); c.rect(-L * 0.85, -w * 0.62, L * 1.45, w * 1.24); c.fill(); c.stroke();
      c.rotate(e.angT - e.ang);
      const rec = e.retro * L * 0.45;
      c.fillStyle = col.osc; c.fillRect(-w * 0.1 - rec, -w * 0.12, L * 2.1, w * 0.24); c.fillRect(L * 1.85 - rec, -w * 0.21, L * 0.2, w * 0.42); // tubo largo
      c.fillStyle = col.base; c.strokeStyle = col.luz; c.lineWidth = Math.max(1, r * 0.14); c.beginPath(); c.rect(-w * 0.55, -w * 0.42, w * 0.95, w * 0.84); c.fill(); c.stroke();
      if (e.retro > 0.6) { c.fillStyle = col.fuego; c.beginPath(); c.arc(L * 2.3, 0, w * 0.45, 0, TAU); c.fill(); }
    } else { // cosechadora
      const L = r * 1.45, w = r * 0.95;
      const mand = e.cosecha ? Math.sin(e.tiempo * 0.012) * w * 0.14 : 0;
      c.fillStyle = col.osc;
      if (lod === 2) for (const x of [-L * 0.8, L * 0.15]) { c.fillRect(x, -w * 1.08, L * 0.5, w * 0.3); c.fillRect(x, w * 0.78, L * 0.5, w * 0.3); } // ruedas
      c.beginPath(); // pala con mandíbulas
      c.moveTo(L * 0.62, -w * 0.95); c.lineTo(L * 1.22, -w * 0.78 - mand); c.lineTo(L * 0.98, 0); c.lineTo(L * 1.22, w * 0.78 + mand); c.lineTo(L * 0.62, w * 0.95); c.closePath(); c.fill();
      c.fillStyle = col.base; c.strokeStyle = col.osc; c.lineWidth = 1;
      c.beginPath(); c.rect(-L, -w * 0.8, L * 1.7, w * 1.6); c.fill(); c.stroke(); // cuerpo
      c.fillStyle = col.osc; c.fillRect(-L * 0.93, -w * 0.52, L * 0.36, w * 1.04); // cabina
      if (lod === 2) { c.fillStyle = col.luz; c.fillRect(-L * 0.68, -w * 0.4, L * 0.07, w * 0.8); }
      const bx = -L * 0.45, bw = L * 1.02; // tolva: se llena con la carga
      c.fillStyle = col.luz; c.fillRect(bx, -w * 0.56, bw, w * 1.12);
      if (e.carga > 0) { c.fillStyle = e.raro ? col.raro : col.mineral; c.fillRect(bx, -w * 0.56, bw * e.carga, w * 1.12); }
      c.strokeStyle = col.osc; c.strokeRect(bx, -w * 0.56, bw, w * 1.12);
    }
    c.restore();
  };

  // ---------- edificios ----------
  // (px, py) esquina, t = lado en píxeles.
  // s = { tiempo, id, vida (0..1), deficit, activo, descarga, ang, retro }
  W.fichaEdificio = function (c, e, px, py, t, lod, col, s) {
    const X = (f) => px + f * t, Y = (f) => py + f * t, cx = X(0.5), cy = Y(0.5);
    const lw = Math.max(1, t * 0.035);
    c.lineJoin = 'round'; c.lineCap = 'butt';

    if (e.tipo === 'torreta') {
      const R = t * 0.47;
      c.fillStyle = lod ? col.osc : col.base; c.beginPath();
      for (let k = 0; k < 8; k++) { const a = (k + 0.5) / 8 * TAU; c.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); }
      c.closePath(); c.fill();
      if (!lod) return;
      c.fillStyle = col.base; c.beginPath(); c.arc(cx, cy, R * 0.72, 0, TAU); c.fill();
      if (lod === 2) { // pernos de la base
        c.fillStyle = col.luz;
        for (let k = 0; k < 4; k++) { const a = k / 4 * TAU + 0.78; c.fillRect(cx + Math.cos(a) * R * 0.86 - 1, cy + Math.sin(a) * R * 0.86 - 1, 2, 2); }
      }
      c.save(); c.translate(cx, cy); c.rotate(s.ang);
      const rec = s.retro * R * 0.35;
      c.fillStyle = s.deficit ? col.humo : col.osc;
      c.fillRect(R * 0.1 - rec, -R * 0.36, R * 1.25, R * 0.26); c.fillRect(R * 0.1 - rec, R * 0.1, R * 1.25, R * 0.26); // doble cañón
      c.fillStyle = col.luz; c.strokeStyle = col.osc; c.lineWidth = 1;
      c.beginPath(); c.arc(0, 0, R * 0.42, 0, TAU); c.fill(); c.stroke();
      if (s.retro > 0.6) { c.fillStyle = col.fuego; c.beginPath(); c.arc(R * 1.5, 0, R * 0.36, 0, TAU); c.fill(); }
      c.restore();
      danos(c, cx, cy, t, col, s);
      return;
    }

    if (e.tipo === 'torreCanon') { // casamata con un cañón grande que gira
      c.fillStyle = col.osc; c.fillRect(px + 1, py + 1, t - 2, t - 2);
      if (!lod) return;
      const R = t * 0.41;
      c.fillStyle = col.base; c.beginPath();
      for (let k = 0; k < 8; k++) { const a = (k + 0.5) / 8 * TAU; c.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); }
      c.closePath(); c.fill(); c.strokeStyle = col.luz; c.lineWidth = lw; c.stroke();
      if (lod === 2) { c.fillStyle = col.luz; for (const [fx, fy] of [[0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9]]) c.fillRect(X(fx) - 1.5, Y(fy) - 1.5, 3, 3); }
      c.save(); c.translate(cx, cy); c.rotate(s.ang);
      const rec = s.retro * R * 0.4;
      c.fillStyle = s.deficit ? col.humo : col.osc; c.fillRect(R * 0.1 - rec, -R * 0.2, R * 1.75, R * 0.4); c.fillRect(R * 1.6 - rec, -R * 0.3, R * 0.32, R * 0.6);
      c.fillStyle = col.luz; c.strokeStyle = col.osc; c.lineWidth = 1; c.beginPath(); c.arc(0, 0, R * 0.52, 0, TAU); c.fill(); c.stroke();
      if (s.retro > 0.6) { c.fillStyle = col.fuego; c.beginPath(); c.arc(R * 2.2, 0, R * 0.5, 0, TAU); c.fill(); }
      c.restore();
      danos(c, cx, cy, t, col, s);
      return;
    }

    if (lod === 0) { c.fillStyle = col.base; c.fillRect(px + 1, py + 1, t - 2, t - 2); return; }

    // Placa: borde oscuro y cuerpo del color del bando.
    const b = Math.max(1.5, t * 0.045);
    c.fillStyle = col.osc; c.fillRect(px + 1, py + 1, t - 2, t - 2);
    c.fillStyle = col.base; c.fillRect(px + 1 + b, py + 1 + b, t - 2 - 2 * b, t - 2 - 2 * b);
    c.strokeStyle = col.luz; c.lineWidth = lw;

    if (e.tipo === 'patio') {
      const g = 0.1, h = 0.22; // escuadras en las esquinas
      c.beginPath();
      c.moveTo(X(g), Y(h)); c.lineTo(X(g), Y(g)); c.lineTo(X(h), Y(g));
      c.moveTo(X(1 - h), Y(g)); c.lineTo(X(1 - g), Y(g)); c.lineTo(X(1 - g), Y(h));
      c.moveTo(X(1 - g), Y(1 - h)); c.lineTo(X(1 - g), Y(1 - g)); c.lineTo(X(1 - h), Y(1 - g));
      c.moveTo(X(h), Y(1 - g)); c.lineTo(X(g), Y(1 - g)); c.lineTo(X(g), Y(1 - h));
      c.stroke();
      if (lod === 2) { // radio de giro de la grúa y pila de material
        c.globalAlpha = 0.45; c.setLineDash([lw * 2, lw * 2]); c.beginPath(); c.arc(cx, cy, t * 0.33, 0, TAU); c.stroke(); c.setLineDash([]); c.globalAlpha = 1;
        c.fillStyle = col.osc; c.fillRect(X(0.16), Y(0.7), t * 0.1, t * 0.1); c.fillRect(X(0.28), Y(0.74), t * 0.08, t * 0.08); c.fillRect(X(0.18), Y(0.6), t * 0.07, t * 0.07);
      }
      const a = s.activo ? s.tiempo * 0.0016 : -0.8; // la grúa gira mientras hay obras
      c.save(); c.translate(cx, cy); c.rotate(a);
      c.strokeStyle = col.osc; c.lineWidth = lw * 3.2; c.beginPath(); c.moveTo(0, 0); c.lineTo(-t * 0.15, 0); c.stroke(); // contrapeso
      c.strokeStyle = col.luz; c.lineWidth = lw * 1.6; c.beginPath(); c.moveTo(-t * 0.04, 0); c.lineTo(t * 0.33, 0); c.stroke(); // brazo
      c.fillStyle = col.osc; c.beginPath(); c.arc(t * 0.33, 0, lw * 1.8, 0, TAU); c.fill();
      c.restore();
      c.fillStyle = col.luz; c.beginPath(); c.arc(cx, cy, t * 0.07, 0, TAU); c.fill();
    } else if (e.tipo === 'central') {
      const tinta = s.deficit ? col.mal : col.luz;
      c.strokeStyle = tinta;
      if (lod === 2) { // transformadores y cable
        c.fillStyle = col.osc; c.fillRect(X(0.12), Y(0.12), t * 0.14, t * 0.2); c.fillRect(X(0.74), Y(0.68), t * 0.14, t * 0.2);
        c.lineWidth = 1; c.beginPath(); c.moveTo(X(0.26), Y(0.22)); c.lineTo(X(0.36), Y(0.36)); c.moveTo(X(0.74), Y(0.78)); c.lineTo(X(0.64), Y(0.64)); c.stroke();
      }
      c.lineWidth = lw * 1.3; c.beginPath(); c.arc(cx, cy, t * 0.2, 0, TAU); c.stroke();
      c.fillStyle = tinta; c.beginPath(); c.arc(cx, cy, t * 0.08, 0, TAU); c.fill();
      if (!s.deficit) { // anillo que late: la central produce
        const f = ((s.tiempo + s.id * 137) * 0.0007) % 1;
        c.globalAlpha = 1 - f; c.lineWidth = lw; c.beginPath(); c.arc(cx, cy, t * (0.2 + f * 0.24), 0, TAU); c.stroke(); c.globalAlpha = 1;
      }
    } else if (e.tipo === 'refineria') {
      c.fillStyle = s.descarga ? col.mineral : col.suelo; c.fillRect(X(0.36), Y(0.72), t * 0.28, t * 0.28); // muelle de descarga
      c.strokeStyle = col.osc; c.lineWidth = 1; c.strokeRect(X(0.36), Y(0.72), t * 0.28, t * 0.28);
      c.strokeStyle = col.luz; c.lineWidth = lw * 1.2; c.beginPath(); // tuberías
      c.moveTo(X(0.3), Y(0.32)); c.lineTo(X(0.7), Y(0.32)); c.moveTo(cx, Y(0.32)); c.lineTo(cx, Y(0.72)); c.stroke();
      for (const fx of [0.3, 0.7]) { // silos
        c.fillStyle = col.osc; c.beginPath(); c.arc(X(fx), Y(0.32), t * 0.16, 0, TAU); c.fill();
        c.strokeStyle = col.luz; c.lineWidth = lw; c.stroke();
        if (lod === 2) { c.beginPath(); c.arc(X(fx), Y(0.32), t * 0.09, 3.6, 5.4); c.stroke(); }
      }
      if (lod === 2) { // chimenea con humo
        c.fillStyle = col.osc; c.beginPath(); c.arc(X(0.84), Y(0.62), t * 0.055, 0, TAU); c.fill();
        c.fillStyle = col.humo;
        for (let k = 0; k < 3; k++) {
          const f = ((s.tiempo * 0.0004 + k / 3 + s.id * 0.1) % 1);
          c.globalAlpha = 0.5 * (1 - f); c.beginPath(); c.arc(X(0.84) + f * t * 0.16, Y(0.62) - f * t * 0.26, t * (0.03 + f * 0.05), 0, TAU); c.fill();
        }
        c.globalAlpha = 1;
      }
    } else if (e.tipo === 'cuartel') {
      c.fillStyle = col.suelo; c.fillRect(X(0.38), Y(0.78), t * 0.24, t * 0.22); // puerta
      c.lineWidth = lw * 1.3; c.beginPath(); // galones
      for (let k = 0; k < 3; k++) { const y = 0.28 + k * 0.15; c.moveTo(X(0.3), Y(y + 0.12)); c.lineTo(cx, Y(y)); c.lineTo(X(0.7), Y(y + 0.12)); }
      c.stroke();
      if (lod === 2) { // banderín
        const o = Math.sin(s.tiempo * 0.005 + s.id) * t * 0.03;
        c.fillStyle = col.luz; c.beginPath(); c.moveTo(X(0.82), Y(0.12)); c.lineTo(X(0.82) - t * 0.17, Y(0.17) + o); c.lineTo(X(0.82), Y(0.22)); c.closePath(); c.fill();
        c.fillStyle = col.osc; c.fillRect(X(0.82) - 1, Y(0.1), 2, t * 0.2);
      }
    } else if (e.tipo === 'fabrica') {
      c.fillStyle = col.osc; c.beginPath(); // techo en diente de sierra
      c.moveTo(X(0.08), Y(0.3));
      for (let k = 0; k < 4; k++) { const x0 = 0.08 + k * 0.21; c.lineTo(X(x0), Y(0.1)); c.lineTo(X(x0 + 0.21), Y(0.3)); }
      c.closePath(); c.fill();
      c.lineWidth = lw; c.beginPath();
      for (let k = 0; k < 4; k++) { const x0 = 0.08 + k * 0.21; c.moveTo(X(x0), Y(0.3)); c.lineTo(X(x0), Y(0.1)); c.lineTo(X(x0 + 0.21), Y(0.3)); }
      c.stroke();
      c.fillStyle = col.suelo; c.fillRect(X(0.34), Y(0.74), t * 0.32, t * 0.26); // portón
      c.setLineDash([lw * 3, lw * 2]); c.lineDashOffset = s.activo ? -s.tiempo * 0.02 : 0; // cinta: corre al producir
      c.lineWidth = lw * 1.2; c.beginPath(); c.moveTo(X(0.42), Y(0.38)); c.lineTo(X(0.42), Y(0.74)); c.moveTo(X(0.58), Y(0.38)); c.lineTo(X(0.58), Y(0.74)); c.stroke();
      c.setLineDash([]); c.lineDashOffset = 0;
      if (lod === 2) { // engranaje
        const gx = X(0.2), gy = Y(0.58), gr = t * 0.085, ga = s.activo ? s.tiempo * 0.003 : 0;
        c.lineWidth = lw; c.beginPath(); c.arc(gx, gy, gr, 0, TAU);
        for (let k = 0; k < 6; k++) { const a = ga + k / 6 * TAU; c.moveTo(gx + Math.cos(a) * gr, gy + Math.sin(a) * gr); c.lineTo(gx + Math.cos(a) * gr * 1.55, gy + Math.sin(a) * gr * 1.55); }
        c.stroke();
        c.fillStyle = col.osc; c.fillRect(X(0.74), Y(0.44), t * 0.12, t * 0.12); c.fillRect(X(0.74), Y(0.6), t * 0.12, t * 0.08);
      }
    } else if (e.tipo === 'bomba') {
      c.lineWidth = lw * 1.4; c.beginPath(); c.moveTo(cx, cy); c.lineTo(X(0.5), Y(0.95)); c.moveTo(cx, cy); c.lineTo(X(0.95), Y(0.5)); c.stroke(); // tuberías
      c.fillStyle = col.agua; c.beginPath(); c.arc(cx, cy, t * 0.3, 0, TAU); c.fill(); c.lineWidth = lw * 1.2; c.stroke(); // depósito
      c.save(); c.translate(cx, cy); c.rotate(s.deficit ? 0.4 : s.tiempo * 0.004 + s.id); // rodete: gira si hay energía
      c.strokeStyle = col.luz; c.lineWidth = lw * 1.6; c.beginPath();
      for (let k = 0; k < 3; k++) { const a = k / 3 * TAU; c.moveTo(0, 0); c.quadraticCurveTo(Math.cos(a + 0.6) * t * 0.14, Math.sin(a + 0.6) * t * 0.14, Math.cos(a) * t * 0.22, Math.sin(a) * t * 0.22); }
      c.stroke(); c.restore();
      c.fillStyle = col.osc; c.beginPath(); c.arc(cx, cy, t * 0.06, 0, TAU); c.fill();
      if (lod === 2) { c.fillStyle = col.osc; c.fillRect(X(0.12), Y(0.12), t * 0.16, t * 0.12); c.fillRect(X(0.12), Y(0.28), t * 0.1, t * 0.08); }
    } else if (e.tipo === 'extractor') {
      c.fillStyle = col.tinta; c.beginPath(); c.arc(X(0.3), Y(0.62), t * 0.07, 0, TAU); c.fill(); // boca del pozo
      c.fillStyle = col.osc; c.beginPath(); c.arc(X(0.76), Y(0.26), t * 0.15, 0, TAU); c.fill(); c.lineWidth = lw; c.stroke(); // tanque
      if (lod === 2) { c.beginPath(); c.arc(X(0.76), Y(0.26), t * 0.08, 3.6, 5.4); c.stroke(); c.beginPath(); c.moveTo(X(0.62), Y(0.3)); c.lineTo(X(0.4), Y(0.5)); c.stroke(); }
      c.lineWidth = lw * 1.4; c.beginPath(); c.moveTo(X(0.5), Y(0.86)); c.lineTo(X(0.6), Y(0.56)); c.lineTo(X(0.7), Y(0.86)); c.stroke(); // caballete
      const bal = s.deficit ? 0.2 : Math.sin(s.tiempo * 0.004 + s.id) * 0.32; // balancín: cabecea al bombear
      c.save(); c.translate(X(0.6), Y(0.56)); c.rotate(bal);
      c.strokeStyle = col.luz; c.lineWidth = lw * 2; c.beginPath(); c.moveTo(-t * 0.34, 0); c.lineTo(t * 0.2, 0); c.stroke();
      c.fillStyle = col.luz; c.beginPath(); c.arc(-t * 0.34, 0, t * 0.07, 0.5 * Math.PI, 1.5 * Math.PI); c.fill(); // cabeza de mula
      c.fillStyle = col.osc; c.fillRect(t * 0.12, -t * 0.06, t * 0.12, t * 0.12); // contrapeso
      c.restore();
    } else if (e.tipo === 'estacion') {
      const tinta = s.deficit ? col.mal : col.luz;
      c.strokeStyle = tinta; c.lineWidth = lw * 1.3;
      c.beginPath(); c.arc(cx, cy, t * 0.26, 0, TAU); c.stroke(); // plato
      c.lineWidth = lw; c.beginPath(); c.arc(cx, cy, t * 0.14, 0, TAU); c.stroke();
      if (!s.deficit) { // barrido y ondas: la estación escucha
        const a = s.tiempo * 0.002 + s.id;
        c.lineWidth = lw * 1.4; c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(a) * t * 0.26, cy + Math.sin(a) * t * 0.26); c.stroke();
        const f = ((s.tiempo + s.id * 211) * 0.0005) % 1;
        c.globalAlpha = 1 - f; c.setLineDash([lw * 2, lw * 2]); c.lineWidth = lw; c.beginPath(); c.arc(cx, cy, t * (0.26 + f * 0.2), 0, TAU); c.stroke(); c.setLineDash([]); c.globalAlpha = 1;
      }
      c.fillStyle = tinta; c.beginPath(); c.arc(cx, cy, t * 0.05, 0, TAU); c.fill();
      if (lod === 2) { c.fillStyle = col.osc; c.fillRect(X(0.1), Y(0.76), t * 0.2, t * 0.12); c.fillRect(X(0.74), Y(0.1), t * 0.14, t * 0.14); }
    }
    danos(c, cx, cy, t, col, s);
  };

  // Fuego y humo cuando el edificio está por debajo de media vida.
  function danos(c, cx, cy, t, col, s) {
    if (s.vida >= 0.5) return;
    const n = s.vida < 0.25 ? 3 : 1;
    for (let k = 0; k < n; k++) {
      const a = s.id * 2.4 + k * 2.1, x = cx + Math.cos(a) * t * 0.24, y = cy + Math.sin(a) * t * 0.24;
      const p = 0.6 + 0.4 * Math.sin(s.tiempo * 0.02 + k * 2);
      c.fillStyle = col.fuego; c.beginPath(); c.arc(x, y, Math.max(2, t * 0.07 * p), 0, TAU); c.fill();
      const f = (s.tiempo * 0.0006 + k * 0.4) % 1;
      c.fillStyle = col.humo; c.globalAlpha = 0.45 * (1 - f); c.beginPath(); c.arc(x + f * t * 0.1, y - f * t * 0.35, Math.max(2, t * (0.05 + f * 0.08)), 0, TAU); c.fill(); c.globalAlpha = 1;
    }
  }
})();
