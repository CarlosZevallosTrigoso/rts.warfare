// drone.warfare — el rival. Decide cada dos segundos y solo con lo que su bando sabe (lo que ve, los edificios que ha
// descubierto, sus rumbos de radio y los hilos que ha encontrado). Da las mismas órdenes que el jugador.
//
// El defensor: un equipo de guardia pegado al centro y otro de reacción que sale a cortar el paso; un dron de reconocimiento
// se queda encima de quien se acerca (o busca a lo largo del rumbo de la escucha); los FPV eligen blanco y tipo; si le están
// poniendo una carga, todo acude.
// El atacante: los equipos de asalto se reúnen antes de entrar; el del tirador y el observador se queda detrás, de apoyo;
// registran por sectores alrededor de la mejor pista; vuelan las antenas que encuentran de paso; tiran humo cuando los
// clavan y para cubrir la carga.
(function () {
  const D = globalThis.D || (globalThis.D = {});
  const E = D.ECON, dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  D.iaCrear = function (m, j) { return { j, eqs: {}, tFpv: -999, ultimo: null, tListos: 0, entra: false, ronda: 0 }; };

  // Un FPV contra el mejor blanco a la vista. De fibra si el blanco tiene un inhibidor cerca o está bajo techo; si no, de radio.
  // No se lanza si caería sobre los propios (salvo urgencia) ni si ya va otro hacia el mismo blanco.
  function fpvIA(m, ia, vistos, propios, valor, cada) {
    const j = ia.j; if (!vistos.length || m.t - ia.tFpv < cada || D.pilotosLibres(m, j) < 1) return;
    const enVuelo = new Set(); for (const q of m.ents) if (q.clase === 'dron' && q.j === j && q.obj && q.estado === 'vuelo') enVuelo.add(q.obj);
    let ob = null, mejor = -1e9, urgente = false; for (const o of vistos) { if (enVuelo.has(o.id)) continue; const v = valor(o); if (v === null) continue; const urg = v >= 1000; if (!urg && propios.some((u) => dist(u, o) <= E.fpvRadio + 0.6)) continue; if (v > mejor) { mejor = v; ob = o; urgente = urg; } }
    if (!ob) return;
    const inhib = vistos.some((q) => q.tipo === 'inhibidor' && dist(q, ob) <= E.inhibeRadio + 1), techo = m.mapa.terreno[Math.floor(ob.y) * m.N + Math.floor(ob.x)] === D.T.RUINA;
    for (const tipo of inhib ? ['fpvFibra'] : techo ? ['fpvFibra', 'fpvRadio'] : ['fpvRadio', 'fpvFibra']) { const e = m.ents.find((q) => q.clase === 'dron' && q.j === j && q.tipo === tipo && q.estado === 'posado'); if (e && D.alcanza(m, j, tipo, ob.x, ob.y, e.casa)) { D.orden(m, { t: 'fpv', j, tipo, obj: ob.id }); ia.tFpv = m.t - (urgente ? cada : 0); return; } }
  }

  D.iaTick = function (m, ia) {
    if ((m.t + ia.j * 11) % 40) return;
    const j = ia.j, mapa = m.mapa, U = mapa.urbano, N = m.N, porEq = {}, propios = [];
    for (const e of m.ents) if (e.clase === 'sol' && e.j === j) { (porEq[e.eq] || (porEq[e.eq] = [])).push(e); propios.push(e); }
    const vistos = []; for (const id of m.visto[j]) { const o = m.porId.get(id); if (o) vistos.push(o); }
    const eqs = []; for (const k in porEq) { const us = porEq[k], eq = Number(k), cx = us.reduce((s, u) => s + u.x, 0) / us.length, cy = us.reduce((s, u) => s + u.y, 0) / us.length;
      const st = ia.eqs[eq] || (ia.eqs[eq] = { paso: 0, puesto: { x: cx, y: cy }, tOrden: -999, tHumo: -999, apoyo: us.some((u) => u.tipo === 'tirador'), listo: false, meta: null });
      let cerca = null, dc = 1e9, n = 0; for (const o of vistos) { const d = Math.hypot(o.x - cx, o.y - cy); if (d < 14) n++; if (d < dc) { dc = d; cerca = o; } }
      const pelea = us.some((u) => m.t - u.tTiro < 120 || m.t - (u.tHerido || -999) < 120); // hay tiros de verdad: no basta con que un dron vea a alguien detrás de un muro
      eqs.push({ eq, us, st, x: cx, y: cy, cerca, dc, n, pelea, parado: us.every((u) => u.orden === 'nada'), carga: us.some((u) => D.SOL[u.tipo].carga), salud: us.reduce((s, u) => s + u.vida / u.vidaMax, 0) / us.length, clavado: us.some((u) => D.nivelSupr(u) === 2), enRetirada: us.some((u) => u.orden === 'retirada') }); }
    const ir = (q, x, y, cada) => { if (m.t - q.st.tOrden < (cada || 0)) return false; x = Math.max(1.5, Math.min(N - 1.5, x)); y = Math.max(1.5, Math.min(N - 1.5, y)); if (q.st.meta && Math.hypot(q.st.meta.x - x, q.st.meta.y - y) < 2.5 && !q.parado) return false; D.orden(m, { t: 'mover', j, eqs: [q.eq], x, y }); q.st.tOrden = m.t; q.st.meta = { x, y }; return true; };
    // Lo de todos: granada a quien se pone a tiro; humo delante cuando lo clavan.
    for (const q of eqs) { if (!q.cerca || q.enRetirada) continue;
      if (q.dc <= E.granadaAlc - 0.5 && q.dc > 2.2 && q.us[0].cdGranada <= m.t) D.orden(m, { t: 'granada', j, eqs: [q.eq], x: q.cerca.x, y: q.cerca.y });
      if (q.clavado && q.us[0].cdHumo <= m.t && q.dc > 4) { const k = Math.min(0.5, (E.humoAlc - 1.5) / q.dc); D.orden(m, { t: 'humo', j, eqs: [q.eq], x: q.x + (q.cerca.x - q.x) * k, y: q.y + (q.cerca.y - q.y) * k }); } }
    if (j === 0) atacante(m, ia, eqs, vistos, propios, ir); else defensor(m, ia, eqs, vistos, propios, ir);
  };

  // ---------- el defensor ----------
  function defensor(m, ia, eqs, vistos, propios, ir) {
    const b = m.mapa.bases[1], c = m.ents.find((e) => e.clase === 'edif' && e.j === 1 && e.tipo === 'centro') || b;
    if (m.caido) { // el centro ha volado: que no salgan. Todos a por quien se vea; los FPV, a quien esté más cerca de escapar
      for (const q of eqs) { if (q.enRetirada) continue; if (q.cerca) { if (q.dc > 8) ir(q, q.cerca.x, q.cerca.y, 100); } else if (ia.ultimo && m.t - ia.ultimo.t < 900) ir(q, ia.ultimo.x, ia.ultimo.y, 200); }
      if (vistos.length) ia.ultimo = { x: vistos[0].x, y: vistos[0].y, t: m.t };
      fpvIA(m, ia, vistos, propios, (o) => 200 - dist(o, m.extraccion), 100); return; }
    if (!ia.roles) { ia.roles = true; let g = null; for (const q of eqs) if (!g || dist(q, c) < dist(g, c)) g = q; for (const q of eqs) q.st.guardia = q === g; }
    let am = null, da = 40; for (const o of vistos) { const d = dist(o, c); if (d < da) { da = d; am = o; } }
    if (am) ia.ultimo = { x: am.x, y: am.y, t: m.t };
    const poniendo = m.ents.some((e) => e.clase === 'sol' && e.j === 0 && e.canal > 0 && e.obj === c.id); // le están poniendo la carga: se sabe (salta el aviso)
    for (const q of eqs) { const st = q.st;
      if (poniendo) { if (dist(q, c) > 3.5) ir(q, c.x, c.y, 60); continue; }
      if (q.enRetirada) continue;
      if (!st.guardia && q.salud < 0.4 && q.cerca && q.dc < 12 && dist(q, c) > 10) { D.orden(m, { t: 'retirada', j: 1, eqs: [q.eq] }); st.tOrden = m.t; st.meta = null; continue; } // muy tocado y lejos: se repliega al barracón (junto al centro)
      if (st.guardia) { // la guardia no se aleja: se coloca del lado por donde viene el peligro
        if (am && da < 22) { const d = dist(am, c) || 1; ir(q, c.x + ((am.x - c.x) / d) * 3.5, c.y + ((am.y - c.y) / d) * 3.5, 200); }
        else if (!am && dist(q, st.puesto) > 4 && (!ia.ultimo || m.t - ia.ultimo.t > 400)) ir(q, st.puesto.x, st.puesto.y, 200);
      } else if (am) { // la reacción sale a cortar el paso: se planta entre la amenaza y el centro, a tiro de fusil
        const d = dist(am, c) || 1; if (vistos.length > q.us.length + 3) { const a = Math.atan2(am.y - c.y, am.x - c.x) + 0.6; ir(q, c.x + Math.cos(a) * 5.5, c.y + Math.sin(a) * 5.5, 200); } // vienen muchos: no sale a que lo arrollen; se cierra sobre el centro, al lado de la guardia
        else { const k = Math.max(0, d - 8) / d; if (dist(q, am) > 10) ir(q, c.x + (am.x - c.x) * k, c.y + (am.y - c.y) * k, 120); }
      } else if (dist(q, st.puesto) > 4 && (!ia.ultimo || m.t - ia.ultimo.t > 400)) ir(q, st.puesto.x, st.puesto.y, 200);
    }
    // FPV: primero quien está poniendo la carga; luego, quien lleva carga y está más cerca del centro.
    fpvIA(m, ia, vistos, propios, (o) => (o.canal > 0 && o.obj === c.id ? 2000 : 0) + 100 - dist(o, c) + (D.SOL[o.tipo].carga ? 25 : 0) + (o.tipo === 'inhibidor' ? 10 : 0) + D.nivelSupr(o) * 12, 100); // y mejor si está clavado: no puede dispararle al dron
    // Reconocimiento: el primero no se mueve de su vuelta a la base; el segundo se queda encima de la amenaza; si no la hay,
    // busca a lo largo del rumbo que da la escucha (allí está el inhibidor o el repetidor del atacante) o patrulla hacia el frente.
    if (m.t % 200 === 0) { const rs = m.ents.filter((e) => e.clase === 'dron' && e.j === 1 && e.tipo === 'recon' && e.estado !== 'posado'), r = rs[rs.length - 1]; if (r && rs.length > 1) {
      let p = null; if (ia.ultimo && m.t - ia.ultimo.t < 600) p = ia.ultimo;
      else if (m.rumbo[1].length) { const ru = m.rumbo[1][ia.ronda % m.rumbo[1].length], d = 22 + (ia.ronda % 4) * 9; p = { x: ru.x + Math.cos(ru.ang) * d, y: ru.y + Math.sin(ru.ang) * d }; ia.ronda++; }
      else { const a = b.frente + ((ia.ronda % 3) - 1) * 0.5, d = 24 + (ia.ronda % 2) * 12; p = { x: b.x + Math.cos(a) * d, y: b.y + Math.sin(a) * d }; ia.ronda++; }
      if (!r.orbita || Math.hypot(r.orbita.x - p.x, r.orbita.y - p.y) > 3) D.orden(m, { t: 'recon', j: 1, id: r.id, x: p.x, y: p.y }); } }
  }

  // ---------- el atacante ----------
  // La mejor pista de por dónde está el centro: el punto medio de los edificios enemigos descubiertos y del origen de un hilo
  // de fibra; si no hay, donde apuntan los rumbos de radio; si no, el casco urbano.
  function pistaDe(m) {
    let n = 0, sx = 0, sy = 0; for (const id of m.conocido[0]) { const o = m.porId.get(id); if (!o) continue; n++; sx += o.x; sy += o.y; }
    const h = m.hilos.find((q) => q.j === 1 && q.visto[0]); if (h) { n++; sx += h.pts[0][0]; sy += h.pts[0][1]; }
    if (n) return { x: sx / n, y: sy / n, r: 16 };
    const rs = m.rumbo[0], U = m.mapa.urbano, ux = (U.x0 + U.x1) / 2, uy = (U.y0 + U.y1) / 2;
    // Dos rumbos que se cruzan con buen ángulo dan un punto; si los dos observadores están juntos, el cruce no vale nada: entonces
    // se toma la dirección media y se supone que la antena está a la altura del casco urbano.
    for (let a = 0; a < rs.length; a++) for (let b = a + 1; b < rs.length; b++) { const p = rs[a], q = rs[b]; if (p.a !== q.a || p.de === q.de) continue; const d = Math.cos(p.ang) * Math.sin(q.ang) - Math.sin(p.ang) * Math.cos(q.ang); if (Math.abs(d) < 0.4) continue; const k = ((q.x - p.x) * Math.sin(q.ang) - (q.y - p.y) * Math.cos(q.ang)) / d; if (k < 3) continue; return { x: Math.max(3, Math.min(m.N - 3, p.x + Math.cos(p.ang) * k)), y: Math.max(3, Math.min(m.N - 3, p.y + Math.sin(p.ang) * k)), r: 14 }; }
    if (rs.length) { let ox = 0, oy = 0, dx = 0, dy = 0; for (const r of rs) { ox += r.x; oy += r.y; dx += Math.cos(r.ang); dy += Math.sin(r.ang); } ox /= rs.length; oy /= rs.length; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L; const t = Math.max(12, Math.min(110, (ux - ox) * dx + (uy - oy) * dy)); return { x: Math.max(3, Math.min(m.N - 3, ox + dx * t)), y: Math.max(3, Math.min(m.N - 3, oy + dy * t)), r: 16 }; }
    return { x: ux, y: uy, r: Math.min(U.x1 - U.x0, U.y1 - U.y0) / 2 };
  }
  function atacante(m, ia, eqs, vistos, propios, ir) {
    if (m.caido) { for (const q of eqs) if (!q.enRetirada && dist(q, m.extraccion) > m.extraccion.r - 1.5 && m.t - q.st.tOrden >= 80) { D.orden(m, { t: 'retirada', j: 0, eqs: [q.eq] }); q.st.tOrden = m.t; q.st.meta = null; } return; } // hecho: a la zona de extracción
    const b = m.mapa.bases[0], G = pistaDe(m); let centro = null; for (const id of m.conocido[0]) { const o = m.porId.get(id); if (o && o.tipo === 'centro') centro = o; }
    const asalto = eqs.filter((q) => !q.st.apoyo && q.carga), punta = asalto[0] || eqs[0]; if (!punta) return;
    // El punto de reunión: a 160 m de la pista, del lado por donde se viene.
    if (!ia.reunion || (!ia.entra && Math.hypot(ia.G.x - G.x, ia.G.y - G.y) > 12 && m.t - (ia.tReu || 0) > 600)) { ia.tReu = m.t; const d = Math.hypot(b.x - G.x, b.y - G.y) || 1, k = Math.min(1, (G.r + 12) / d); ia.reunion = { x: G.x + (b.x - G.x) * k, y: G.y + (b.y - G.y) * k, lado: Math.atan2(b.y - G.y, b.x - G.x) + Math.PI / 2 }; ia.G = G; }
    // Dónde mirar: el centro está en un patio despejado, y en el plano se ven varios (el de verdad y los señuelos). Se da por mirado el que alguien ha pisado sin encontrar nada.
    const P = m.mapa.patios.map((p) => ({ x: (p.x0 + p.x1 + 1) / 2, y: (p.y0 + p.y1 + 1) / 2 })); if (!ia.mirados) ia.mirados = new Set();
    P.forEach((p, i) => { if (!ia.mirados.has(i) && propios.some((u) => Math.hypot(u.x - p.x, u.y - p.y) < 4)) ia.mirados.add(i); });
    const pend = P.map((p, i) => i).filter((i) => !ia.mirados.has(i)).sort((a, c) => Math.hypot(P[a].x - G.x, P[a].y - G.y) - Math.hypot(P[c].x - G.x, P[c].y - G.y));
    const R = ia.reunion, aCubierto = (q) => { if (q.st.cubierto) return; q.st.cubierto = true; D.orden(m, { t: 'mover', j: 0, eqs: [q.eq], x: q.x, y: q.y }); q.st.tOrden = m.t; q.st.meta = null; }; // «mover» al sitio donde ya está: cada uno busca el puesto más cubierto de cara al enemigo
    if (!ia.entra) { const n = asalto.filter((q) => q.st.listo).length; if (n && !ia.tListos) ia.tListos = m.t; if (centro || (asalto.length && n === asalto.length) || (ia.tListos && m.t - ia.tListos > 1200)) ia.entra = true; } // entran cuando están todos, o un minuto después de llegar el primero
    asalto.forEach((q, i) => { const st = q.st;
      if (centro) { // el asalto: todos a poner la carga; humo entre el centro y quien lo defiende
        if (q.parado || m.t - st.tOrden > 400) { D.orden(m, { t: 'modo', j: 0, eqs: [q.eq], sigilo: false }); D.orden(m, { t: 'volar', j: 0, eqs: [q.eq], obj: centro.id }); st.tOrden = m.t; st.meta = null; }
        if (q.cerca && dist(q, centro) < 9 && q.us[0].cdHumo <= m.t) { const d = dist(q.cerca, centro) || 1, k = Math.min(0.5, 3 / d); D.orden(m, { t: 'humo', j: 0, eqs: [q.eq], x: centro.x + (q.cerca.x - centro.x) * k, y: centro.y + (q.cerca.y - centro.y) * k }); }
        return; }
      if (!ia.entra) { const lat = (i - (asalto.length - 1) / 2) * 5, x = R.x + Math.cos(R.lado) * lat, y = R.y + Math.sin(R.lado) * lat; // a reunirse
        if (Math.hypot(q.x - x, q.y - y) < 5) st.listo = true; else if (!(q.cerca && q.dc < 11 && q.pelea)) { st.cubierto = false; if (ir(q, x, y, 400)) D.orden(m, { t: 'modo', j: 0, eqs: [q.eq], sigilo: false }); } else aCubierto(q);
        return; }
      // dentro, registrando
      if (q.cerca && q.dc < 11 && q.pelea && G.r > 6) { // contacto: se pone a cubierto donde está y pelea; si lo superan y está tocado, se echa atrás hacia la reunión. Con el taller ya localizado no se para: el centro está al lado
        if (q.salud < 0.45 && q.n > q.us.length) { if (ir(q, R.x, R.y, 300)) D.orden(m, { t: 'modo', j: 0, eqs: [q.eq], sigilo: false }); }
        else aCubierto(q);
        return; } st.cubierto = false;
      // una antena descubierta a mano (sea de verdad o falsa): se vuela, que sin antenas no hay drones de radio
      let an = null, da = 10; for (const id of m.conocido[0]) { const o = m.porId.get(id); if (o && (o.tipo === 'antena' || o.tipo === 'falsa')) { const d = dist(q, o); if (d < da) { da = d; an = o; } } }
      if (an) { st.volando = true; if (q.parado || m.t - st.tOrden > 300) { D.orden(m, { t: 'volar', j: 0, eqs: [q.eq], obj: an.id }); st.tOrden = m.t; st.meta = null; } return; } st.volando = false;
      if (pend.length) { const p = P[pend[i % pend.length]]; if (ir(q, p.x, p.y, 0)) D.orden(m, { t: 'modo', j: 0, eqs: [q.eq], sigilo: D.luz(m) > 0.5 && !q.n && Math.hypot(q.x - p.x, q.y - p.y) < 22 }); return; } // a mirar el patio pendiente que le toca: los más cercanos a la pista, primero
      if (q.parado || m.t - st.tOrden > 700) { const a = st.paso * 2.4 + i * 2.1, d = G.r * (0.35 + 0.65 * ((st.paso * 0.618) % 1)); st.paso++; if (ir(q, G.x + Math.cos(a) * d, G.y + Math.sin(a) * d, 0)) D.orden(m, { t: 'modo', j: 0, eqs: [q.eq], sigilo: D.luz(m) > 0.5 && !q.n }); }
    });
    // El apoyo (tirador y observador): detrás de la punta, a cubierto; da enlace y rumbo, y el tirador hace el resto.
    for (const q of eqs) { if (!q.st.apoyo && q.carga) continue; if (q.cerca && q.dc < 9) continue; const d = Math.hypot(b.x - punta.x, b.y - punta.y) || 1, x = punta.x + ((b.x - punta.x) / d) * 8, y = punta.y + ((b.y - punta.y) / d) * 8; if (Math.hypot(q.x - x, q.y - y) > 6) ir(q, x, y, 240); }
    // FPV contra quien estorba a los equipos; el dron de reconocimiento, por delante de la punta hacia la pista.
    fpvIA(m, ia, vistos, propios, (o) => { let d = 1e9; for (const q of eqs) d = Math.min(d, dist(q, o)); return 60 - d + (o.tipo === 'tirador' ? 15 : 0) + (o.tipo === 'inhibidor' ? 8 : 0); }, 240);
    if (m.t % 400 === 0) { const r = m.ents.find((q) => q.clase === 'dron' && q.j === 0 && q.tipo === 'recon' && q.estado !== 'posado'); if (r) { const o = centro || G, d = Math.hypot(o.x - punta.x, o.y - punta.y) || 1, k = Math.min(1, 12 / d); D.orden(m, { t: 'recon', j: 0, id: r.id, x: punta.x + (o.x - punta.x) * k, y: punta.y + (o.y - punta.y) * k }); } }
  }
})();
