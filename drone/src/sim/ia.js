// drone.warfare — el rival, provisional: lo justo para que haya partida mientras llega la IA de verdad (entrega 5).
// El atacante avanza hacia el casco urbano, lo va registrando por puntos y, cuando alguien descubre el centro, van todos
// a volarlo. El defensor tiene a su guardia en su puesto y manda al equipo más cercano a cortar el paso a quien ve acercarse.
(function () {
  const D = globalThis.D || (globalThis.D = {});
  D.iaCrear = function (m, j) { return { j, eqs: {}, tVisto: -999 }; };
  D.iaTick = function (m, ia) {
    if ((m.t + ia.j * 11) % 40) return;
    const j = ia.j, mapa = m.mapa, U = mapa.urbano, equipos = {};
    for (const e of m.ents) if (e.clase === 'sol' && e.j === j) (equipos[e.eq] || (equipos[e.eq] = [])).push(e);
    const vistos = []; for (const id of m.visto[j]) { const o = m.porId.get(id); if (o) vistos.push(o); }
    // Drones: un FPV cada 15 s contra el enemigo a la vista más cercano a su base (el de radio si llega; si no, el de fibra);
    // y el atacante lleva su dron de reconocimiento por delante de sus equipos.
    if (vistos.length && m.t - (ia.tFpv || -999) >= 300 && D.pilotosLibres(m, j) > 0) {
      const b = mapa.bases[j]; let ob = null, md = 1e9; for (const o of vistos) { const d = Math.hypot(o.x - b.x, o.y - b.y); if (d < md) { md = d; ob = o; } }
      for (const tipo of ['fpvRadio', 'fpvFibra']) { const e = m.ents.find((q) => q.clase === 'dron' && q.j === j && q.tipo === tipo && q.estado === 'posado'); if (e && D.alcanza(m, j, tipo, ob.x, ob.y, e.casa)) { D.orden(m, { t: 'fpv', j, tipo, obj: ob.id }); ia.tFpv = m.t; break; } }
    }
    if (j === 0 && m.t % 400 === 0) { const r = m.ents.find((q) => q.clase === 'dron' && q.j === 0 && q.tipo === 'recon' && q.estado === 'vuelo'), ss = m.ents.filter((q) => q.clase === 'sol' && q.j === 0); if (r && ss.length) { const cx = ss.reduce((s, u) => s + u.x, 0) / ss.length, cy = ss.reduce((s, u) => s + u.y, 0) / ss.length, ux = (U.x0 + U.x1) / 2 - cx, uy = (U.y0 + U.y1) / 2 - cy, L = Math.hypot(ux, uy) || 1; D.orden(m, { t: 'recon', j: 0, id: r.id, x: cx + (ux / L) * 12, y: cy + (uy / L) * 12 }); } }
    // El atacante sigue los rastros: el taller enemigo si lo conoce; si no, el origen de un hilo de fibra; si no, otro edificio
    // descubierto; si no, donde se cruzan dos rumbos de radio hacia la misma antena.
    let pista = null;
    if (j === 0) { let otro = null; for (const id of m.conocido[0]) { const o = m.porId.get(id); if (!o) continue; if (o.tipo === 'taller') pista = o; else otro = o; }
      if (!pista) { const h = m.hilos.find((q) => q.j === 1 && q.visto[0]); if (h) pista = { x: h.pts[0][0], y: h.pts[0][1] }; }
      if (!pista) pista = otro;
      if (!pista) { const rs = m.rumbo[0]; for (let a = 0; a < rs.length && !pista; a++) for (let b = a + 1; b < rs.length; b++) { const p = rs[a], q = rs[b]; if (p.a !== q.a || p.de === q.de) continue; const d = Math.cos(p.ang) * Math.sin(q.ang) - Math.sin(p.ang) * Math.cos(q.ang); if (Math.abs(d) < 0.15) continue; const k = ((q.x - p.x) * Math.sin(q.ang) - (q.y - p.y) * Math.cos(q.ang)) / d; if (k < 3) continue; pista = { x: Math.max(3, Math.min(m.N - 3, p.x + Math.cos(p.ang) * k)), y: Math.max(3, Math.min(m.N - 3, p.y + Math.sin(p.ang) * k)) }; break; } } }
    for (const k in equipos) {
      const us = equipos[k], eq = Number(k), st = ia.eqs[eq] || (ia.eqs[eq] = { paso: 0, puesto: { x: us[0].x, y: us[0].y }, tOrden: -999 });
      const cx = us.reduce((s, u) => s + u.x, 0) / us.length, cy = us.reduce((s, u) => s + u.y, 0) / us.length, parado = us.every((u) => u.orden === 'nada');
      let cerca = null, dc = 1e9; for (const o of vistos) { const d = Math.hypot(o.x - cx, o.y - cy); if (d < dc) { dc = d; cerca = o; } }
      if (cerca && dc <= D.ECON.granadaAlc - 0.5 && dc > 2 && us[0].cdGranada <= m.t) D.orden(m, { t: 'granada', j, eqs: [eq], x: cerca.x, y: cerca.y }); // a tiro de granada, granada
      if (j === 0) { // ---- atacante ----
        let centro = null; for (const id of m.conocido[0]) { const o = m.porId.get(id); if (o && o.tipo === 'centro') centro = o; }
        if (cerca && dc < 11) { if (!parado && !centro) D.orden(m, { t: 'detener', j, eqs: [eq] }); if (!centro) continue; } // contacto: se planta y pelea (si ya sabe dónde está el centro, sigue)
        if (centro) { if (parado || m.t - st.tOrden > 400) { D.orden(m, { t: 'volar', j, eqs: [eq], obj: centro.id }); st.tOrden = m.t; } continue; }
        if (!parado && m.t - st.tOrden < 1200) continue;
        const dentro = cx >= U.x0 && cx <= U.x1 && cy >= U.y0 && cy <= U.y1; let x, y;
        if (st.paso === 0) { x = Math.max(U.x0 + 3, Math.min(U.x1 - 3, cx)); y = Math.max(U.y0 + 3, Math.min(U.y1 - 3, cy)); if (dentro) { x = U.x0 + 4 + m.az() * (U.x1 - U.x0 - 8); y = U.y0 + 4 + m.az() * (U.y1 - U.y0 - 8); } } // primero, al borde del pueblo
        else { x = U.x0 + 4 + m.az() * (U.x1 - U.x0 - 8); y = U.y0 + 4 + m.az() * (U.y1 - U.y0 - 8); } // luego, a registrar: un punto al azar del casco
        if (pista && st.paso > 0) { x = Math.max(2, Math.min(m.N - 2, pista.x + (m.az() - 0.5) * 16)); y = Math.max(2, Math.min(m.N - 2, pista.y + (m.az() - 0.5) * 16)); }
        st.paso++; st.tOrden = m.t; D.orden(m, { t: 'modo', j, eqs: [eq], sigilo: dentro && D.luz(m) > 0.5 }); D.orden(m, { t: 'mover', j, eqs: [eq], x, y });
      } else { // ---- defensor ----
        const b = mapa.bases[1];
        let amenaza = null, da = 28; for (const o of vistos) { const d = Math.hypot(o.x - b.x, o.y - b.y); if (d < da) { da = d; amenaza = o; } }
        if (amenaza) { ia.tVisto = m.t; const d = Math.hypot(amenaza.x - cx, amenaza.y - cy); if (d > 10 && m.t - st.tOrden > 160) { const a = Math.atan2(b.y - amenaza.y, b.x - amenaza.x); D.orden(m, { t: 'mover', j, eqs: [eq], x: amenaza.x + Math.cos(a) * 7, y: amenaza.y + Math.sin(a) * 7 }); st.tOrden = m.t; } }
        else if (m.t - ia.tVisto > 300 && parado && Math.hypot(st.puesto.x - cx, st.puesto.y - cy) > 4) { D.orden(m, { t: 'mover', j, eqs: [eq], x: st.puesto.x, y: st.puesto.y }); st.tOrden = m.t; }
      }
    }
  };
})();
