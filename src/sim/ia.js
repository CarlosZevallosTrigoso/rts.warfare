// rts.warfare — IA rival básica. Solo emite comandos, igual que el jugador.
// Limitación declarada: no usa la niebla (sabe dónde está la base rival).
(function () {
  const W = globalThis.W || (globalThis.W = {});
  const EDIF = W.EDIF, UNID = W.UNID;

  // Orden de construcción: [tipo, cantidad deseada].
  const PLAN = [['central', 1], ['refineria', 1], ['cuartel', 1], ['bomba', 1], ['extractor', 1], ['fabrica', 1], ['torreta', 1], ['refineria', 2],
    ['estacion', 1], ['torreta', 2], ['cuartel', 2], ['extractor', 2], ['torreta', 3], ['fabrica', 2]];

  // nivel: 'tranquilo' | 'normal' | 'agresivo'. Cambia el tamaño de la primera oleada.
  W.iaCrear = function (j, nivel) {
    return { j, oleada: nivel === 'tranquilo' ? 12 : nivel === 'agresivo' ? 4 : 6, atacantes: new Set(), reunidos: new Set(), fallos: 0 };
  };

  function siguienteEdificio(m, j, patio) {
    const J = m.jug[j];
    const conEnergia = (tipo) => (tipo !== 'central' && J.prod - J.uso + EDIF[tipo].energia < 0 ? 'central' : tipo);
    // Agua justa: otra bomba antes que nada, o la tropa deja de crecer.
    if (J.cuenta.central && J.aguaProd - J.aguaUso < 4 && (J.cuenta.bomba || 0) < 6 && buscarSitio(m, j, 'bomba', patio)) return conEnergia('bomba');
    for (const [tipo, n] of PLAN) {
      const d = EDIF[tipo];
      if ((J.cuenta[tipo] || 0) >= n) continue;
      if (!W.tieneReq(m, j, d.req)) return null;
      if (d.libre && !buscarSitio(m, j, tipo, patio)) continue; // sin yacimiento explorado: se salta
      if ((d.pet || 0) > J.petroleo && !J.cuenta.extractor) continue; // sin petróleo ni forma de sacarlo: se salta
      return conEnergia(tipo);
    }
    return J.uso > J.prod ? 'central' : null;
  }

  function buscarSitio(m, j, tipo, patio) {
    const N = m.N, d0 = EDIF[tipo], t = d0.tam, rival = m.mapa.bases[1 - j];
    let mejor = null, mp = Infinity;
    if (d0.sobre) { // sobre el yacimiento o campo explorado más cercano
      for (const s of m.mapa.sitios) {
        const dd = Math.hypot(s.x - patio.cx, s.y - patio.cy);
        if (s.tipo !== d0.sobre || dd >= mp) continue;
        for (const [ox, oy] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) if (W.puedeColocar(m, j, tipo, s.x + ox, s.y + oy)) { mp = dd; mejor = { x: s.x + ox, y: s.y + oy }; break; }
      }
      return mejor;
    }
    if (d0.juntoA) { // junto al agua más cercana
      for (let dy = -24; dy <= 24; dy++) for (let dx = -24; dx <= 24; dx++) {
        const x = Math.floor(patio.cx) + dx, y = Math.floor(patio.cy) + dy, p = Math.hypot(dx, dy);
        if (p < mp && W.puedeColocar(m, j, tipo, x, y)) { mp = p; mejor = { x, y }; }
      }
      return mejor;
    }
    const cerca = tipo !== 'refineria' ? [] : m.minas.filter((c) => Math.abs((c % N) - patio.cx) < 60 && Math.abs(((c / N) | 0) - patio.cy) < 60);
    for (let dy = -14; dy <= 14; dy++) for (let dx = -14; dx <= 14; dx++) {
      const x = Math.floor(patio.cx) + dx, y = Math.floor(patio.cy) + dy;
      if (x < 1 || y < 1 || x + t >= N || y + t >= N) continue;
      if (!W.puedeColocar(m, j, tipo, x, y)) continue;
      let libre = true; // un anillo libre alrededor, para no cerrarse el paso
      for (let yy = y - 1; yy <= y + t && libre; yy++) for (let xx = x - 1; xx <= x + t; xx++) if (m.ocup[yy * N + xx] || m.mapa.mineral[yy * N + xx]) { libre = false; break; }
      if (!libre) continue;
      const cx = x + t / 2, cy = y + t / 2;
      let p = Math.hypot(cx - patio.cx, cy - patio.cy);
      if (tipo === 'refineria') {
        let dm = 40;
        for (let k = 0; k < cerca.length; k++) { const c = cerca[k]; const d = Math.hypot((c % N) + 0.5 - cx, ((c / N) | 0) + 0.5 - cy); if (d < dm) dm = d; }
        p = p * 0.3 + dm * 2;
      } else if (tipo === 'torreta') {
        p = p * 0.5 + Math.hypot(cx - rival.x, cy - rival.y) * 0.4;
      }
      if (p < mp) { mp = p; mejor = { x, y }; }
    }
    return mejor;
  }

  W.iaTick = function (m, ia) {
    if ((m.t + ia.j * 7) % 20 !== 0 || m.ganador >= 0) return;
    const j = ia.j, J = m.jug[j];
    if (!J.vivo) return;
    let patio = null, objetivo = null, dObj = Infinity;
    const soldados = [];
    for (const e of m.ents) {
      if (e.j === j) {
        if (e.tipo === 'patio') patio = e;
        else if (!e.edif && UNID[e.tipo].arma) soldados.push(e);
      }
    }
    if (!patio) return;
    for (const e of m.ents) { // objetivo: el patio rival; si no, el edificio rival más cercano
      if (e.j === j || !e.edif) continue;
      const d = e.tipo === 'patio' ? -1 : Math.hypot(e.cx - patio.cx, e.cy - patio.cy);
      if (d < dObj) { dObj = d; objetivo = e; }
    }

    // Sin cosechadoras no hay economía: reponerlas va antes que todo lo demás.
    const cosech = (J.cuenta.cosechadora || 0) + J.colas.cosechadora.n;
    const urgente = cosech === 0 && J.cuenta.fabrica && J.cuenta.refineria;

    // Construcción
    const obra = J.obras[0]; // la IA levanta un edificio a la vez
    const plan = obra || urgente ? null : siguienteEdificio(m, j, patio);
    if (obra && obra.listo) {
      const p = buscarSitio(m, j, obra.tipo, patio);
      if (p) { W.orden(m, { t: 'colocar', j, tipo: obra.tipo, x: p.x, y: p.y }); ia.fallos = 0; }
      else if (++ia.fallos > 15) { W.orden(m, { t: 'cancelarEdif', j, tipo: obra.tipo }); ia.fallos = 0; }
    } else if (plan && W.puedePagar(J, EDIF[plan])) {
      W.orden(m, { t: 'construir', j, tipo: plan });
    }

    // Unidades
    let dinero = J.minerales - (plan ? EDIF[plan].costo : 0);
    const deseadas = Math.min(2 * (J.cuenta.refineria || 0), 4);
    if (J.cuenta.fabrica && cosech < deseadas && W.puedePagar(J, UNID.cosechadora)) {
      W.orden(m, { t: 'entrenar', j, tipo: 'cosechadora' }); dinero -= UNID.cosechadora.costo;
    }
    if (soldados.length < 40 && !urgente) {
      if (J.cuenta.fabrica && !J.colas.tanque.n && dinero >= UNID.tanque.costo && J.petroleo >= UNID.tanque.pet) { W.orden(m, { t: 'entrenar', j, tipo: 'tanque' }); dinero -= UNID.tanque.costo; }
      if (J.cuenta.cuartel && J.colas.infanteria.n < 2 && dinero >= UNID.infanteria.costo) W.orden(m, { t: 'entrenar', j, tipo: 'infanteria' });
    }

    // Ejército
    const vivos = new Set(soldados.map((u) => u.id));
    for (const id of ia.atacantes) if (!vivos.has(id)) ia.atacantes.delete(id);
    for (const id of ia.reunidos) if (!vivos.has(id)) ia.reunidos.delete(id);
    const rival = m.mapa.bases[1 - j];
    const dx = rival.x - patio.cx, dy = rival.y - patio.cy, dd = Math.hypot(dx, dy) || 1;
    const rx = patio.cx + (dx / dd) * 9, ry = patio.cy + (dy / dd) * 9;
    // Un explorador mientras falten yacimientos por encontrar (la niebla sí cuenta para construir sobre ellos).
    let expl = ia.explorador ? m.porId.get(ia.explorador) : null;
    const faltaVer = (J.cuenta.extractor || 0) < 2 || !J.cuenta.estacion;
    if (expl && (!faltaVer || !expl.explora && expl.orden === 'nada')) { if (!faltaVer) W.orden(m, { t: 'detener', j, ids: [expl.id] }); expl = null; ia.explorador = 0; }
    if (!expl && faltaVer) {
      expl = soldados.find((u) => u.tipo === 'infanteria' && !ia.atacantes.has(u.id) && u.orden === 'nada' && !u.obj);
      if (expl) { ia.explorador = expl.id; W.orden(m, { t: 'explorar', j, ids: [expl.id] }); }
    }
    const reserva = soldados.filter((u) => !ia.atacantes.has(u.id) && u.id !== ia.explorador);

    if (J.alerta && m.t - J.alerta.t < 100) { // defensa: acude la reserva ociosa
      const ids = reserva.filter((u) => u.orden === 'nada' && !u.obj).map((u) => u.id);
      if (ids.length) W.orden(m, { t: 'amover', j, ids, x: J.alerta.x, y: J.alerta.y });
    } else {
      const ids = reserva.filter((u) => u.orden === 'nada' && !u.obj && !ia.reunidos.has(u.id)).map((u) => u.id);
      if (ids.length) { W.orden(m, { t: 'amover', j, ids, x: rx, y: ry }); for (const id of ids) ia.reunidos.add(id); }
    }
    if (objetivo) {
      if (reserva.length >= ia.oleada) {
        W.orden(m, { t: 'amover', j, ids: reserva.map((u) => u.id), x: objetivo.cx, y: objetivo.cy });
        for (const u of reserva) ia.atacantes.add(u.id);
        ia.oleada = Math.min(ia.oleada + 2, 18);
      }
      const ociosos = soldados.filter((u) => ia.atacantes.has(u.id) && u.orden === 'nada' && !u.obj).map((u) => u.id);
      if (ociosos.length) W.orden(m, { t: 'amover', j, ids: ociosos, x: objetivo.cx, y: objetivo.cy });
    }
  };
})();
