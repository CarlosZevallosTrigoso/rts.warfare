// rts.warfare — IA rival básica. Solo emite comandos, igual que el jugador.
// Limitación declarada: no usa la niebla (sabe dónde está la base rival).
(function () {
  const W = globalThis.W || (globalThis.W = {});
  const EDIF = W.EDIF, UNID = W.UNID, TEC = W.TEC;

  // Orden de construcción: [tipo, cantidad deseada].
  const PLAN = [['central', 1], ['refineria', 1], ['cuartel', 1], ['bomba', 1], ['extractor', 1], ['fabrica', 1], ['torreta', 1], ['refineria', 2],
    ['estacion', 1], ['torreta', 2], ['cuartel', 2], ['extractor', 2], ['torreta', 3], ['fabrica', 2], ['torreCanon', 1], ['aerodromo', 1], ['antiaerea', 1], ['torreCanon', 2], ['antiaerea', 2]];
  // Orden fijo de investigación.
  const ORDEN_TEC = ['tolva', 'perforante', 'nivel2', 'motores', 'chalecos', 'reactivo', 'telemetro', 'turbinas', 'depuracion', 'nivel3', 'canonLargo', 'analisis'];

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
      if ((d.nivel || 1) > J.nivel) continue; // aún sin el nivel: se salta
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
      // Vehículo: pesado si hay nivel y raros; una artillería por cada cuatro tanques; si no, tanque.
      const c = J.cuenta, enFabrica = J.colas.tanque.n + J.colas.artilleria.n + J.colas.pesado.n;
      let veh = 'tanque';
      if (J.nivel >= 3 && (c.pesado || 0) < 5 && W.puedePagar(J, UNID.pesado)) veh = 'pesado';
      else if (J.nivel >= 2 && (c.artilleria || 0) * 4 < (c.tanque || 0)) veh = 'artilleria';
      if (c.fabrica && !enFabrica && dinero >= UNID[veh].costo && W.puedePagar(J, UNID[veh])) { W.orden(m, { t: 'entrenar', j, tipo: veh }); dinero -= UNID[veh].costo; }
      // Aviación: hasta tres cazas y, con nivel 3, dos bombarderos; uno a la vez y sin vaciar la caja.
      if (c.aerodromo && !(J.colas.caza.n + J.colas.bombardero.n)) {
        const av = J.nivel >= 3 && (c.bombardero || 0) < 2 && W.puedePagar(J, UNID.bombardero) ? 'bombardero' : (c.caza || 0) < 3 ? 'caza' : null;
        if (av && dinero >= UNID[av].costo + 600 && W.puedePagar(J, UNID[av])) { W.orden(m, { t: 'entrenar', j, tipo: av }); dinero -= UNID[av].costo; }
      }
      // Infantería: un antitanque por cada dos fusileros desde el nivel 2.
      const inf = J.nivel >= 2 && (c.antitanque || 0) * 2 < (c.infanteria || 0) ? 'antitanque' : 'infanteria';
      if (c.cuartel && J.colas.infanteria.n + J.colas.antitanque.n < 2 && dinero >= UNID[inf].costo) { W.orden(m, { t: 'entrenar', j, tipo: inf }); dinero -= UNID[inf].costo; }
    }

    // Tecnología: la primera pendiente de la lista que se pueda empezar y pagar sin dejar la caja vacía.
    for (const clave of ORDEN_TEC) {
      const t = TEC[clave];
      if (J.mejoras[clave] || (t.sube && J.nivel >= t.sube) || J.inv.some((i) => i.clave === clave)) continue;
      if (!J.cuenta[t.lugar] || J.nivel < t.nivel || J.inv.some((i) => TEC[i.clave].lugar === t.lugar)) continue;
      if (W.puedePagar(J, t) && dinero >= (t.costo || 0) + 300) { W.orden(m, { t: 'investigar', j, clave }); dinero -= t.costo || 0; }
      break;
    }
    // Minerales raros para el nivel 3: una cosechadora se dedica a la veta más cercana.
    if (J.nivel >= 2 && J.raros < 350 && m.raros.length && (J.cuenta.cosechadora || 0) >= 3) {
      const rar = ia.rarera ? m.porId.get(ia.rarera) : null;
      if (!rar || rar.quiere !== 2) {
        const cos = m.ents.find((e) => e.j === j && e.tipo === 'cosechadora');
        let veta = -1, dv = Infinity;
        for (const cel of m.raros) { const d = Math.hypot((cel % m.N) - patio.cx, ((cel / m.N) | 0) - patio.cy); if (d < dv) { dv = d; veta = cel; } }
        if (cos && veta >= 0) { ia.rarera = cos.id; W.orden(m, { t: 'cosechar', j, ids: [cos.id], x: (veta % m.N) + 0.5, y: ((veta / m.N) | 0) + 0.5 }); }
      }
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
