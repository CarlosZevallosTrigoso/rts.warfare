// rts.warfare — IA rival básica. Solo emite comandos, igual que el jugador.
// Limitación declarada: no usa la niebla (sabe dónde está la base rival).
// Cada rival tiene un estilo (W.ESTILOS_IA) que cambia qué construye, con qué ejército ataca y cuándo.
(function () {
  const W = globalThis.W || (globalThis.W = {});
  const EDIF = W.EDIF, UNID = W.UNID, TEC = W.TEC;

  // Orden de construcción: [tipo, cantidad deseada].
  const PLAN = [['central', 1], ['refineria', 1], ['cuartel', 1], ['bomba', 1], ['extractor', 1], ['fabrica', 1], ['torreta', 1], ['refineria', 2],
    ['estacion', 1], ['torreta', 2], ['cuartel', 2], ['extractor', 2], ['torreta', 3], ['fabrica', 2], ['torreCanon', 1], ['aerodromo', 1], ['antiaerea', 1], ['torreCanon', 2], ['antiaerea', 2]];
  // Orden fijo de investigación.
  const ORDEN_TEC = ['tolva', 'perforante', 'nivel2', 'motores', 'chalecos', 'reactivo', 'telemetro', 'dronesFpv', 'turbinas', 'depuracion', 'nivel3', 'canonLargo', 'dronesPes', 'analisis'];

  // Estilos de rival. oleada: factor sobre el tamaño de las oleadas. infMax: tope de infantería (0 = sin tope).
  // blindados: cuántos blindados ligeros abre. aire: aeródromos que quiere y factor de aviones. extra: edificios añadidos al plan.
  const ESTILOS = {
    equilibrado: { nombre: 'equilibrado', oleada: 1, infMax: 0, blindados: 2, aerodromos: 1, aviones: 1, extra: [] },
    blindado:    { nombre: 'blindado', tras: 'estacion', oleada: 1.2, infMax: 10, blindados: 1, aerodromos: 1, aviones: 0.6, extra: [['fabrica', 2]] },
    aereo:       { nombre: 'aéreo', tras: 'estacion', oleada: 1, infMax: 12, blindados: 2, aerodromos: 2, aviones: 2, extra: [['aerodromo', 1], ['aerodromo', 2], ['antiaerea', 2]] },
    defensivo:   { nombre: 'defensivo', oleada: 1.6, infMax: 0, blindados: 0, aerodromos: 1, aviones: 1, extra: [['torreta', 3], ['torreta', 5], ['torreCanon', 3], ['antiaerea', 3]] },
    asalto:      { nombre: 'de asalto', oleada: 0.6, infMax: 0, blindados: 6, aerodromos: 1, aviones: 0.6, extra: [['cuartel', 2], ['fabrica', 2]] },
  };
  W.ESTILOS_IA = ESTILOS;
  // El plan de cada estilo: sus edificios propios se adelantan, justo después de tener fábrica.
  function planDe(estilo) {
    const E = ESTILOS[estilo], i = PLAN.findIndex((p) => p[0] === (E.tras || 'fabrica')) + 1;
    return PLAN.slice(0, i).concat(E.extra, PLAN.slice(i));
  }
  // nivel: 'tranquilo' | 'normal' | 'agresivo' (tamaño de la primera oleada). estilo: clave de ESTILOS.
  W.iaCrear = function (j, nivel, estilo) {
    const e = ESTILOS[estilo] ? estilo : 'equilibrado';
    return { j, estilo: e, plan: planDe(e), oleada: Math.max(3, Math.round((nivel === 'tranquilo' ? 12 : nivel === 'agresivo' ? 4 : 6) * ESTILOS[e].oleada)), atacantes: new Set(), reunidos: new Set(), capturan: new Set(), puesto: -1, tPuesto: 0, lado: 1, fallos: 0 };
  };

  // Hasta dónde llegan los vehículos desde un punto (el bosque no lo cruzan): relleno por inundación sobre el paso de vehículos.
  function alcanceVehiculos(m, x, y) {
    const N = m.N, visto = new Uint8Array(N * N), cola = new Int32Array(N * N), ini = W.cercaLibre(m, x, y, true);
    let a = 0, b = 0;
    visto[ini] = 1; cola[b++] = ini;
    while (a < b) {
      const c = cola[a++], cx = c % N;
      if (cx > 0 && !visto[c - 1] && m.pasoV[c - 1]) { visto[c - 1] = 1; cola[b++] = c - 1; }
      if (cx < N - 1 && !visto[c + 1] && m.pasoV[c + 1]) { visto[c + 1] = 1; cola[b++] = c + 1; }
      if (c >= N && !visto[c - N] && m.pasoV[c - N]) { visto[c - N] = 1; cola[b++] = c - N; }
      if (c < N * N - N && !visto[c + N] && m.pasoV[c + N]) { visto[c + N] = 1; cola[b++] = c + N; }
    }
    return visto;
  }
  function siguienteEdificio(m, j, patio, plan) {
    const J = m.jug[j];
    const conEnergia = (tipo) => (tipo !== 'central' && J.prod - J.uso + EDIF[tipo].energia < 0 ? 'central' : tipo);
    // Agua justa: otra bomba antes que nada, o la tropa deja de crecer.
    if (J.cuenta.central && J.aguaProd - J.aguaUso < 4 && (J.cuenta.bomba || 0) < 6 && buscarSitio(m, j, 'bomba', patio)) return conEnergia('bomba');
    for (const [tipo, n] of plan || PLAN) {
      const d = EDIF[tipo];
      if ((J.cuenta[tipo] || 0) >= n) continue;
      if ((d.nivel || 1) > J.nivel) continue; // aún sin el nivel: se salta
      if (!W.tieneReq(m, j, d.req)) return null;
      if (d.libre && !buscarSitio(m, j, tipo, patio)) { if (tipo === 'estacion' && !J.cuenta.laboratorio && W.tieneReq(m, j, EDIF.laboratorio.req)) return conEnergia('laboratorio'); continue; } // sin yacimiento explorado: se salta (y sin campo de conocimiento a mano, un laboratorio)
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
    if (d0.sobreMineral) { // sobre el yacimiento de minerales explorado más cercano
      for (let k = 0; k < m.minas.length; k += 2) {
        const c = m.minas[k], x = c % N, y = (c / N) | 0, dd = Math.hypot(x - patio.cx, y - patio.cy);
        if (dd >= mp || m.mapa.tipoMin[c] !== 1) continue;
        for (const [ox, oy] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) if (W.puedeColocar(m, j, tipo, x + ox, y + oy)) { mp = dd; mejor = { x: x + ox, y: y + oy }; break; }
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
    const E = ESTILOS[ia.estilo];
    const tk = (m.t + ia.j * 7) / 20; // cuántas veces ha pensado: las reglas que van cada cierto tiempo se cuentan con esto (con m.t, las del jugador 2 no caían nunca en su turno)
    let patio = null, objetivo = null, dObj = Infinity;
    const soldados = [], aviones = [], patios = [], moviles = [], sinArma = [];
    for (const e of m.ents) {
      if (e.j === j) {
        if (e.tipo === 'patio') patios.push(e);
        else if (e.tipo === 'patioMovil') moviles.push(e);
        else if (!e.edif && UNID[e.tipo].mini) continue; // los drones pequeños van con su portador
        else if (!e.edif && (e.bunk || e.aBunk || UNID[e.tipo].ambu)) continue; // la guarnición de un búnker se queda en él; las ambulancias van solas
        else if (!e.edif && UNID[e.tipo].aire) aviones.push(e); // la aviación no va con el ejército
        else if (!e.edif && UNID[e.tipo].arma) soldados.push(e);
        else if (!e.edif && e.tipo !== 'cosechadora') sinArma.push(e);
      }
    }
    patio = patios[0]; // el principal: el más antiguo que siga en pie
    if (!patio) { // sin patios: lo único que queda es desplegar el patio móvil donde esté
      for (const u of moviles) if (W.puedeDesplegar(m, u)) W.orden(m, { t: 'desplegar', j, ids: [u.id] }); else if (u.orden === 'nada') W.orden(m, { t: 'mover', j, ids: [u.id], x: u.x + ((m.t / 20) % 5) - 2, y: u.y + ((m.t / 40) % 5) - 2 });
      return;
    }
    for (const e of m.ents) { // objetivo: el patio rival más cercano; si no queda ninguno, el edificio rival más cercano
      if (e.j === j || !e.edif || e.infra) continue;
      const d = Math.hypot(e.cx - patio.cx, e.cy - patio.cy) - (e.tipo === 'patio' ? 10000 : 0);
      if (d < dObj) { dObj = d; objetivo = e; }
    }
    if (!objetivo) { const pm = m.ents.find((e) => e.j !== j && e.tipo === 'patioMovil'); if (pm) objetivo = { cx: pm.x, cy: pm.y, id: pm.id }; } // solo le queda un patio móvil: a por él

    // Sin cosechadoras no hay economía: reponerlas va antes que todo lo demás.
    const cosech = (J.cuenta.cosechadora || 0) + J.colas.cosechadora.n;
    const urgente = cosech === 0 && J.cuenta.fabrica && J.cuenta.refineria;

    // Construcción
    const obra = J.obras[0]; // la IA levanta un edificio a la vez
    // Segunda base: con un patio nuevo, lo primero es su refinería y una torreta que la cubra.
    const segundo = patios[1];
    let donde = patio, planBase = null;
    if (segundo && !obra && !urgente) {
      const cerca = (tipo) => m.ents.some((e) => e.j === j && e.tipo === tipo && Math.hypot(e.cx - segundo.cx, e.cy - segundo.cy) < 16);
      if (!cerca('refineria') && W.tieneReq(m, j, EDIF.refineria.req)) planBase = 'refineria'; else if (m.logistica !== false && !cerca('central')) planBase = 'central'; /* su red es otra: necesita su propia central */ else if (!cerca('torreta') && W.tieneReq(m, j, EDIF.torreta.req)) planBase = 'torreta';
    }
    if (obra && segundo && (obra.tipo === 'refineria' || obra.tipo === 'torreta' || (obra.tipo === 'central' && m.logistica !== false)) && !m.ents.some((e) => e.j === j && e.tipo === obra.tipo && Math.hypot(e.cx - segundo.cx, e.cy - segundo.cy) < 16)) donde = segundo;
    // La red: terminada su vía, levanta un depósito en la punta, para que la cobertura (suministro y territorio) llegue hasta allí.
    const quiereDeposito = m.logistica !== false && ia.via && ia.viaFin && !J.cuenta.deposito && W.tieneReq(m, j, EDIF.deposito.req) && J.minerales > 900 && !!J.cuenta.obras;
    if (obra && obra.tipo === 'deposito' && ia.viaFin) donde = { cx: ia.viaFin.x, cy: ia.viaFin.y };
    // Radio: torres escalonadas cada 38 celdas en la línea hacia el rival, para que sus oleadas vean y obedezcan a tiempo.
    const rivB = m.mapa.bases[1 - j], rvx = rivB.x - patio.cx, rvy = rivB.y - patio.cy, rvd = Math.hypot(rvx, rvy) || 1, nTorres = J.cuenta.torreRadio || 0;
    const quiereTorre = m.logistica !== false && !urgente && J.cuenta.fabrica && m.t > 9000 && J.minerales > 1200 && !(ia.tAhorro > 0) && !ia.pn && nTorres < Math.min(5, Math.floor((rvd - 50) / 38)) && (ia.torresHechas || 0) < 8 && W.disponible(m, j, EDIF.torreRadio); // (con la base ya en marcha y dinero de sobra; y sin reponerlas sin fin si se las tiran)
    if (obra && (obra.tipo === 'vigia' || obra.tipo === 'bunker' || obra.tipo === 'artFija')) { const D = obra.tipo === 'vigia' ? 16 : obra.tipo === 'bunker' ? 11 : 7; donde = { cx: patio.cx + (rvx / rvd) * D, cy: patio.cy + (rvy / rvd) * D }; } // las defensas, de cara al rival
    if (obra && obra.tipo === 'torreRadio') donde = { cx: patio.cx + (rvx / rvd) * 38 * (nTorres + 1), cy: patio.cy + (rvy / rvd) * 38 * (nTorres + 1) };
    const quiereObras = m.logistica !== false && !J.cuenta.obras && J.cuenta.cuartel && W.tieneReq(m, j, EDIF.obras.req) && J.minerales > 600 && (J.cuenta.fabrica || m.ents.some((e) => e.edif && !e.infra && e.j === j && !e.conRed)); // en cuanto tiene algo que conectar (o fábrica), sus obras civiles
    // Misiles: pasada la primera media hora y con dinero de sobra, una misilera; y un interceptor en cuanto ve volar un misil enemigo o conoce una misilera rival.
    if (!ia.misilVisto && (m.misiles.some((q) => q.j !== j) || m.ents.some((e) => e.tipo === 'misilera' && e.j !== j && m.niebla[j][Math.floor(e.cy) * m.N + Math.floor(e.cx)]))) ia.misilVisto = true;
    const lejosObj = objetivo ? Math.hypot(objetivo.cx - patio.cx, objetivo.cy - patio.cy) : 0, llegaMisil = J.nivel >= 3 || lejosObj < W.MISILES.scud.alcance - 12; // con nivel 2 solo tiene el Scud: si no alcanza al rival, la misilera no le sirve
    const quiereMisil = J.nivel >= 2 && W.tieneReq(m, j, EDIF.misilera.req) && (ia.misilVisto && !J.cuenta.interceptor && J.minerales > 2200 ? 'interceptor' : !J.cuenta.misilera && llegaMisil && m.t > 36000 && J.minerales > 4000 ? 'misilera' : null);
    // Lo que no está en el plan fijo, cuando sobra dinero: estación de drones, una cámara, la central de inteligencia y el puesto logístico.
    let quiereNuevo = null;
    if (!urgente && J.cuenta.cuartel && J.cuenta.fabrica && !(ia.tAhorro > 0) && !ia.pn) {
      const c = J.cuenta, puede = (t) => W.disponible(m, j, EDIF[t]);
      if (J.nivel >= 2 && (c.mina || 0) < (m.t > 48000 ? 3 : 1) && J.minerales > 1600 && puede('mina') && buscarSitio(m, j, 'mina', patio)) quiereNuevo = 'mina'; // minas: ingreso que no depende de cosechadoras ni se agota pronto
      else if ((c.bunker || 0) < (ia.estilo === 'defensivo' ? 2 : 1) && m.t > 8000 && J.minerales > 900 && puede('bunker')) quiereNuevo = 'bunker'; // un búnker de cara al rival, que luego guarnece
      else if ((c.vigia || 0) < 1 && m.t > 7000 && J.minerales > 900 && puede('vigia')) quiereNuevo = 'vigia';
      else if (!c.hospital && m.t > 12000 && J.minerales > 1500 && puede('hospital')) quiereNuevo = 'hospital';
      else if (!c.artFija && J.nivel >= 2 && m.t > 20000 && J.minerales > 2600 && ia.estilo !== 'asalto' && puede('artFija')) quiereNuevo = 'artFija';
      else if (!c.estDrones && m.t > 9000 && J.minerales > 1200 && puede('estDrones')) quiereNuevo = 'estDrones';
      else if (!c.camara && m.t > 14000 && J.minerales > 1200 && puede('camara')) quiereNuevo = 'camara';
      else if (!c.logistica && m.logistica !== false && m.t > 18000 && J.minerales > 2000 && puede('logistica')) quiereNuevo = 'logistica'; // (antes que la central de inteligencia: sin suministro, sus oleadas pelean a media fuerza)
      else if (!c.inteligencia && m.t > 24000 && J.minerales > 3200 && puede('inteligencia')) quiereNuevo = 'inteligencia';
    }
    // Almacenes: cuando la caja roza la capacidad, otro almacén (hasta cuatro); y lo mismo con el petróleo (hasta dos tanques).
    const quiereAlmacen = urgente || !J.cuenta.refineria ? null : isFinite(J.capMin) && J.minerales > J.capMin * 0.6 && (J.cuenta.almacen || 0) < 5 ? 'almacen' : isFinite(J.capPet) && J.petroleo > J.capPet * 0.9 && !(J.cuenta.tanqueComb || 0) && J.cuenta.fabrica && J.minerales > 1500 ? 'tanqueComb' : null; // un solo tanque, y sin prisa: a la IA el petróleo le sobra
    const plan = obra || urgente ? null : planBase || (quiereAlmacen ? quiereAlmacen : quiereMisil ? quiereMisil : quiereObras ? 'obras' : quiereDeposito ? 'deposito' : quiereNuevo || siguienteEdificio(m, j, patio, ia.plan) || (quiereTorre ? 'torreRadio' : null)); // las torres de radio, cuando el plan de la base no pide nada
    if (obra && obra.listo) {
      const p = buscarSitio(m, j, obra.tipo, donde) || buscarSitio(m, j, obra.tipo, patio);
      if (p) { W.orden(m, { t: 'colocar', j, tipo: obra.tipo, x: p.x, y: p.y }); ia.fallos = 0; }
      else if (++ia.fallos > 15) { W.orden(m, { t: 'cancelarEdif', j, tipo: obra.tipo }); ia.fallos = 0; }
    } else if (plan && W.puedePagar(J, EDIF[plan]) && !((ia.tAhorro > 0 || ia.pn) && plan !== 'central' && plan !== 'bomba' && plan !== planBase && plan !== quiereAlmacen)) { // mientras ahorra para la segunda base, solo lo urgente
      W.orden(m, { t: 'construir', j, tipo: plan });
      if (plan === 'torreRadio') ia.torresHechas = (ia.torresHechas || 0) + 1;
    }

    // Caminos: si a sus vehículos ya casi no les quedan minerales a los que llegar (el resto está tras el bosque),
    // encarga una excavadora y abre camino hasta el campo cerrado más cercano.
    if (tk % 30 === 0) {
      const alc = alcanceVehiculos(m, patio.cx, patio.cy + 2.5);
      let hay = 0, lejos = -1, dl = Infinity;
      for (let k = 0; k < m.minas.length; k += 3) {
        const cel = m.minas[k];
        if (m.mapa.tipoMin[cel] !== 1) continue;
        if (alc[cel]) { hay += m.mapa.mineral[cel] * 3; continue; }
        const d0 = Math.hypot((cel % m.N) - patio.cx, ((cel / m.N) | 0) - patio.cy);
        if (d0 < dl && Math.hypot((cel % m.N) - m.mapa.bases[1 - j].x, ((cel / m.N) | 0) - m.mapa.bases[1 - j].y) > 30) { dl = d0; lejos = cel; }
      }
      ia.campoCerrado = hay < 6000 && lejos >= 0 ? lejos : -1;
    }
    // La red: un extractor, una estación o un depósito sin conexión no rinde. Un ingeniero civil le tiende una línea de servicio desde el edificio conectado más cercano.
    const suelto = m.logistica !== false && J.cuenta.obras && J.minerales > 250 ? m.ents.find((e) => e.edif && !e.infra && e.j === j && !e.conRed && (EDIF[e.tipo].da || e.tipo === 'deposito') && m.t - e.nace > 40) : null;
    if (suelto && tk % 2 === 0) {
      const civil = sinArma.find((u) => u.tipo === 'civil');
      if (!civil) { if (!J.colas.civil.n && W.puedePagar(J, UNID.civil)) W.orden(m, { t: 'entrenar', j, tipo: 'civil' }); }
      else if (civil.orden === 'nada') {
        let desde = null, md = Infinity;
        for (const e of m.ents) { if (!e.edif || e.infra || e.j !== j || !e.conRed) continue; const d0 = Math.hypot(e.cx - suelto.cx, e.cy - suelto.cy); if (d0 < md) { md = d0; desde = e; } }
        if (desde) W.orden(m, { t: 'conectar', j, ids: [civil.id], edifs: [desde.id, suelto.id] });
      }
    }
    if (ia.campoCerrado >= 0 && J.cuenta.obras) {
      const exc = sinArma.find((u) => u.tipo === 'excavadora');
      if (!exc) { if (!J.colas.excavadora.n && W.puedePagar(J, UNID.excavadora)) W.orden(m, { t: 'entrenar', j, tipo: 'excavadora' }); }
      else if (exc.orden === 'nada' && J.minerales > 300) { W.orden(m, { t: 'trazar', j, ids: [exc.id], x: (ia.campoCerrado % m.N) + 0.5, y: ((ia.campoCerrado / m.N) | 0) + 0.5 }); ia.campoCerrado = -1; }
    } else if (!ia.via && J.cuenta.obras && m.t > 7200 && J.minerales > 1800 && objetivo) {
      // Con la economía en marcha, tiende una vía desde su base hacia el frente (hasta medio camino): sus refuerzos llegan antes.
      const exc = sinArma.find((u) => u.tipo === 'excavadora');
      if (!exc) { if (!J.colas.excavadora.n && W.puedePagar(J, UNID.excavadora)) W.orden(m, { t: 'entrenar', j, tipo: 'excavadora' }); }
      else if (exc.orden === 'nada') {
        const c = W.cercaLibre(m, patio.cx + (objetivo.cx - patio.cx) * 0.45, patio.cy + (objetivo.cy - patio.cy) * 0.45, true);
        W.orden(m, { t: 'trazar', j, ids: [exc.id], x: (c % m.N) + 0.5, y: ((c / m.N) | 0) + 0.5 }); ia.via = true;
        ia.viaFin = { x: (c % m.N) + 0.5, y: ((c / m.N) | 0) + 0.5 }; ia.viaIni = { x: exc.x, y: exc.y }; ia.viaN = 0;
      }
    } else if (ia.via && ia.viaFin && tk % 20 === 0) {
      // Mantenimiento: si le han destruido tramos de su vía, la excavadora la recorre de punta a punta reponiéndolos (lo que sigue en pie no cuesta).
      let n = 0; for (const e of m.ents) if (e.infra && e.j === j) n++;
      const exc = sinArma.find((u) => u.tipo === 'excavadora');
      if (exc && exc.orden === 'trazar') ia.viaN = 0; // aún trazando: la cuenta se toma al terminar
      else if (exc && exc.orden === 'nada') {
        if (!ia.viaN || n > ia.viaN) ia.viaN = n;
        else if (n < ia.viaN && J.minerales > 600) {
          const a = Math.hypot(exc.x - ia.viaFin.x, exc.y - ia.viaFin.y) < Math.hypot(exc.x - ia.viaIni.x, exc.y - ia.viaIni.y) ? ia.viaIni : ia.viaFin;
          W.orden(m, { t: 'trazar', j, ids: [exc.id], x: a.x, y: a.y }); ia.viaN = 0;
        }
      }
    }

    // Segunda base: pasado un rato, con nivel 2 y un solo patio, ahorra para un patio móvil (deja de comprar otros vehículos,
    // aviones, mejoras y edificios que no sean urgentes). Si en tres minutos no lo consigue, lo deja para más tarde.
    const quiereBase = J.nivel >= 2 && J.cuenta.fabrica && patios.length < 2 && !moviles.length && !J.colas.patioMovil.n && m.t > 12000 && (J.cuenta.cosechadora || 0) >= 2 && m.t > (ia.sinBaseHasta || 0);
    if (quiereBase && !ia.tAhorro) ia.tAhorro = m.t;
    if (!quiereBase) ia.tAhorro = 0;
    else if (m.t - ia.tAhorro > 4800) { ia.sinBaseHasta = m.t + 6000; ia.tAhorro = 0; }
    // Subir de nivel: cuando ya tiene la información (y los raros) del siguiente nivel y solo le faltan minerales, deja de gastar hasta reunirlos.
    const sigNivel = J.nivel < 3 ? TEC['nivel' + (J.nivel + 1)] : null;
    const paraNivel = !!sigNivel && m.t > 8400 && J.info >= (sigNivel.info || 0) && J.raros >= (sigNivel.raros || 0) && !J.inv.some((i) => TEC[i.clave].sube) && soldados.length >= 6;
    const ahorra = (quiereBase && ia.tAhorro > 0) || paraNivel;
    ia.pn = paraNivel; // (para la construcción del turno siguiente: mientras ahorra para el nivel, solo lo urgente)

    // Unidades
    let dinero = J.minerales - (plan ? EDIF[plan].costo : 0);
    const deseadas = Math.min(2 * (J.cuenta.refineria || 0), 4);
    if (J.cuenta.fabrica && cosech < deseadas && W.puedePagar(J, UNID.cosechadora)) {
      W.orden(m, { t: 'entrenar', j, tipo: 'cosechadora' }); dinero -= UNID.cosechadora.costo;
    }
    if (soldados.length < 40 && !urgente) {
      // Vehículo: pesado si hay nivel y raros; una artillería por cada cuatro tanques; si no, tanque.
      const c = J.cuenta, enFabrica = J.colas.tanque.n + J.colas.artilleria.n + J.colas.pesado.n + J.colas.blindado.n + J.colas.antiaereoMovil.n + J.colas.lanzacohetes.n + J.colas.mando.n + J.colas.patioMovil.n;
      let veh = (c.blindado || 0) < E.blindados && (c.tanque || 0) < Math.max(2, E.blindados) ? 'blindado' : 'tanque'; // blindados ligeros para empezar, según el estilo
      if (J.nivel >= 3 && (c.lanzacohetes || 0) < 2 && (c.lanzacohetes || 0) * 5 < (c.tanque || 0) + (c.pesado || 0) && W.puedePagar(J, UNID.lanzacohetes)) veh = 'lanzacohetes';
      else if (J.nivel >= 3 && !c.mando && J.info > 250 && soldados.length >= 8) veh = 'mando';
      else if (m.logistica !== false && !c.vehRadio && !J.colas.vehRadio.n && soldados.length >= 8 && m.t > 6000) veh = 'vehRadio'; // la radio va con el ejército
      // Segunda base: un patio móvil cuando la economía lo permite y aún solo hay un patio.
      const paraBase = quiereBase && ia.tAhorro > 0;
      if (paraBase) veh = 'patioMovil'; // (solo cuando ahorra para la segunda base: si ahorra para subir de nivel, no compra vehículos)
      if (J.nivel >= 2 && (c.antiaereoMovil || 0) < 1 + Math.floor(((c.tanque || 0) + (c.pesado || 0)) / 8)) veh = 'antiaereoMovil'; // escolta antiaérea para las columnas
      else if (J.nivel >= 3 && (c.pesado || 0) < 5 && W.puedePagar(J, UNID.pesado)) veh = 'pesado';
      else if (J.nivel >= 2 && (c.artilleria || 0) * 4 < (c.tanque || 0)) veh = 'artilleria';
      // Aviación: cazas, un dron y, con nivel 3, helicópteros y bombarderos; uno a la vez. El estilo aéreo la compra antes que los tanques.
      let av = null;
      if (c.aerodromo && !(J.colas.caza.n + J.colas.bombardero.n + J.colas.helicoptero.n + J.colas.dron.n)) {
        const k = E.aviones, cupo = W.cupoAire(m, j);
        if (cupo.hay < cupo.cupo) av = J.nivel >= 3 && (c.helicoptero || 0) < Math.round(2 * k) ? 'helicoptero'
          : J.nivel >= 3 && (c.bombardero || 0) < Math.round(2 * k) && J.raros >= UNID.bombardero.raros ? 'bombardero'
          : !c.dron && J.info >= 120 ? 'dron' : (c.caza || 0) < Math.round(3 * k) ? 'caza' : null;
      }
      const guardaAire = av && E.aviones > 1 && !ahorra ? UNID[av].costo : 0; // lo que el estilo aéreo aparta para su próximo avión
      if (c.fabrica && !enFabrica && !(paraNivel && !paraBase) && dinero >= UNID[veh].costo + guardaAire && W.puedePagar(J, UNID[veh])) { W.orden(m, { t: 'entrenar', j, tipo: veh }); dinero -= UNID[veh].costo; }
      if (av && !ahorra && dinero >= UNID[av].costo + (E.aviones > 1 ? 0 : 600) && W.puedePagar(J, UNID[av])) { W.orden(m, { t: 'entrenar', j, tipo: av }); dinero -= UNID[av].costo; }
      // Infantería: un antitanque por cada dos fusileros desde el nivel 2.
      let inf = J.nivel >= 2 && (c.antitanque || 0) * 2 < (c.infanteria || 0) ? 'antitanque' : J.nivel < 2 && (c.infanteria || 0) >= 4 && (c.granadero || 0) * 3 < (c.infanteria || 0) ? 'granadero' : 'infanteria'; // en nivel 1, un granadero por cada tres fusileros
      if (!c.explorador && !J.colas.explorador.n && ((c.extractor || 0) < 2 || !c.estacion)) inf = 'explorador'; // uno para descubrir yacimientos
      else if (J.nivel >= 2 && (c.ingeniero || 0) + J.colas.ingeniero.n < (ia.estilo === 'defensivo' ? 2 : 1)) inf = 'ingeniero'; // repara la base él solo
      else if ((c.medico || 0) + J.colas.medico.n < 1 && (c.infanteria || 0) >= 6) inf = 'medico'; // uno, para la tropa que vuelve herida
      else if (J.nivel >= 2 && (c.francotirador || 0) < 3 && (c.francotirador || 0) * 5 < (c.infanteria || 0)) inf = 'francotirador';
      const topeInf = E.infMax && (c.infanteria || 0) + (c.antitanque || 0) >= E.infMax && (inf === 'infanteria' || inf === 'antitanque');
      if (c.cuartel && !topeInf && !(ahorra && soldados.length >= 6) && J.colas.infanteria.n + J.colas.granadero.n + J.colas.antitanque.n + J.colas.explorador.n + J.colas.ingeniero.n + J.colas.francotirador.n < 2 && dinero >= UNID[inf].costo + guardaAire && W.puedePagar(J, UNID[inf])) { W.orden(m, { t: 'entrenar', j, tipo: inf }); dinero -= UNID[inf].costo; }
    }

    // Tecnología: la primera pendiente de la lista que se pueda empezar y pagar sin dejar la caja vacía.
    for (const clave of ORDEN_TEC) {
      const t = TEC[clave];
      if (J.mejoras[clave] || (t.sube && J.nivel >= t.sube) || J.inv.some((i) => i.clave === clave)) continue;
      if (!J.cuenta[t.lugar] || J.nivel < t.nivel || J.inv.some((i) => TEC[i.clave].lugar === t.lugar)) continue;
      if ((!ahorra || (paraNivel && t.sube)) && W.puedePagar(J, t) && dinero >= (t.costo || 0) + (t.sube && paraNivel ? 0 : 300)) { W.orden(m, { t: 'investigar', j, clave }); dinero -= t.costo || 0; }
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

    // Aviación: los aviones posados y sin tarea salen a patrullar por delante de la base, hacia el rival.
    {
      const riv = m.mapa.bases[1 - j], ax = riv.x - patio.cx, ay = riv.y - patio.cy, ad = Math.hypot(ax, ay) || 1;
      const ociosos = aviones.filter((u) => u.enTierra && !u.repostando && !u.patrulla);
      const patrulla = [];
      for (const u of ociosos) { // el dron espía, a dar vueltas sobre la base rival; bombarderos y helicópteros atacan lo que tengan a su alcance de vuelo y ya esté explorado; el resto patrulla
        if (u.tipo === 'dronEspia') { if (u.fuel >= UNID.dronEspia.fuel * 0.9) W.orden(m, { t: 'patrulla', j, ids: [u.id], x: riv.x, y: riv.y }); continue; }
        const d = UNID[u.tipo], casa = m.porId.get(u.casa);
        let blanco = null, mb = Infinity;
        if (casa && (u.tipo === 'bombardero' || u.tipo === 'helicoptero') && u.fuel >= d.fuel * 0.9) {
          for (const e of m.ents) {
            if (e.j === j || e.vida <= 0 || e.infra || (!e.edif && (u.tipo === 'bombardero' || UNID[e.tipo].aire)) || !W.puedeAtacar(u, e)) continue;
            const ex = e.edif ? e.cx : e.x, ey = e.edif ? e.cy : e.y, dd = Math.hypot(ex - casa.cx, ey - casa.cy);
            if (dd < d.radioVuelo - 3 && dd < mb && m.niebla[j][Math.floor(ey) * m.N + Math.floor(ex)] >= (e.edif ? 1 : 2)) { mb = dd; blanco = e; }
          }
        }
        if (!blanco && casa && u.tipo === 'bombardero' && u.fuel >= d.fuel * 0.9) { // sin nada mejor que hacer, el bombardero corta caminos: primero los puentes
          for (const e of m.ents) {
            if (!e.infra || e.j === j || e.vida <= 0) continue;
            const dd = Math.hypot(e.cx - casa.cx, e.cy - casa.cy) - (e.puente ? 1000 : 0);
            if (dd + (e.puente ? 1000 : 0) < d.radioVuelo - 3 && dd < mb && m.niebla[j][Math.floor(e.cy) * m.N + Math.floor(e.cx)] >= 1) { mb = dd; blanco = e; }
          }
        }
        if (blanco) W.orden(m, { t: 'atacar', j, ids: [u.id], obj: blanco.id }); else patrulla.push(u.id);
      }
      if (patrulla.length) W.orden(m, { t: 'patrulla', j, ids: patrulla, x: patio.cx + (ax / ad) * 16, y: patio.cy + (ay / ad) * 16 });
    }

    // Misilera: guarda un par de misiles (el mejor que pueda pagar sin quedarse seca) y los lanza al edificio rival explorado más valioso que tenga a su alcance.
    if (J.cuenta.misilera && tk % 5 === 2) {
      const MIS = W.MISILES;
      for (const e of m.ents) {
        if (e.tipo !== 'misilera' || e.j !== j || e.vida <= 0) continue;
        let hay = 0; if (e.silo) for (const k in e.silo) hay += e.silo[k];
        // El mejor edificio rival explorado que alcance cada clase de misil.
        const blancoDe = (tipo) => { let b = null, mv = 0; for (const o of m.ents) { if (!o.edif || o.infra || o.j === j || o.vida <= 0 || !m.niebla[j][Math.floor(o.cy) * m.N + Math.floor(o.cx)] || !W.alcanceMisil(m, e, tipo, o.cx, o.cy)) continue; const v = o.tipo === 'patio' ? 5000 : o.tipo === 'interceptor' ? 1 : EDIF[o.tipo].costo; if (v > mv) { mv = v; b = o; } } return b; };
        if (hay + (e.fabMis ? e.fabMis.length : 0) < 2) { // fabrica el mejor que pueda pagar sin quedarse seca, pero solo uno que llegue a algo
          const tipo = ['sarmat', 'minuteman', 'scud'].find((k) => J.nivel >= MIS[k].nivel && W.puedePagar(J, MIS[k]) && J.minerales > MIS[k].costo + 1500 && blancoDe(k));
          if (tipo) W.orden(m, { t: 'misil', j, id: e.id, tipo });
        }
        if (!hay || e.sinLuz || m.t - (ia.ultMisil || -9999) < 600) continue;
        for (const tipo of ['scud', 'minuteman', 'sarmat']) { // lanza el más barato que tenga y que llegue
          if (!(e.silo[tipo] > 0)) continue;
          const blanco = blancoDe(tipo);
          if (blanco) { W.orden(m, { t: 'lanzar', j, id: e.id, tipo, x: blanco.cx, y: blanco.cy }); ia.ultMisil = m.t; break; }
        }
      }
    }

    // ---------- lo añadido después: mejoras de edificio, gatling, hacker, operadores, alambrada, inteligencia y puente aéreo ----------
    {
      const c = J.cuenta, riv = m.mapa.bases[1 - j], vx = riv.x - patio.cx, vy = riv.y - patio.cy, vd = Math.hypot(vx, vy) || 1;
      const entrena = (t, margen) => { if (W.disponible(m, j, UNID[t]) && W.puedePagar(J, UNID[t]) && dinero >= UNID[t].costo + margen) { W.orden(m, { t: 'entrenar', j, tipo: t }); dinero -= UNID[t].costo; return true; } return false; };
      // Mejorar edificios: la central si la energía va justa, la bomba si falta agua; con dinero de sobra, lo que da información y la estación de drones.
      if (tk % 20 === 7 && !ahorra) {
        const busca = (tipo) => m.ents.find((e) => e.edif && e.j === j && e.tipo === tipo && e.vida > 0 && (e.nivelE || 1) < W.ECON.mejoraMax && e.conRed !== false);
        let cand = J.prod - J.uso < 40 ? busca('central') : null;
        if (!cand && J.aguaProd - J.aguaUso < 6) cand = busca('bomba');
        if (!cand && J.minerales > 4000) cand = busca('estDrones') || busca('laboratorio') || busca('estacion') || busca('extractor');
        if (cand && J.minerales > W.costoMejora(cand) + 1500) W.orden(m, { t: 'mejorarEdif', j, id: cand.id });
      }
      if (c.fabrica && J.nivel >= 2 && !ahorra && !urgente && tk % 10 === 4 && !(c.tallerMovil || 0) && !J.colas.tallerMovil.n && soldados.length >= 12) entrena('tallerMovil', 800); // un taller de campaña
      // Infantería especial: dos gatling para sostener el punto de reunión, un hacker y dos operadores de drones.
      if (c.cuartel && !ahorra && !urgente && tk % 5 === 3) {
        if ((c.gatling || 0) + J.colas.gatling.n < 2 && (c.infanteria || 0) >= 8) entrena('gatling', 500);
        else if ((c.hacker || 0) + J.colas.hacker.n < 1 && soldados.length >= 10) entrena('hacker', 500);
        else if (c.estDrones && (c.operador || 0) + J.colas.operador.n < 2 && soldados.length >= 8) entrena('operador', 500);
      }
      // El hacker apaga la torre o el vehículo armado enemigo que tenga más cerca y a la vista.
      if (tk % 5 === 4) for (const u of sinArma) {
        if (u.tipo !== 'hacker' || u.orden !== 'nada') continue;
        let b = null, md = 28;
        for (const e of m.ents) {
          if (e.j === j || e.vida <= 0 || e.infra || e.hack > m.t || !(e.edif ? EDIF[e.tipo].arma : UNID[e.tipo].cat === 'veh' && UNID[e.tipo].arma)) continue;
          const ex = e.edif ? e.cx : e.x, ey = e.edif ? e.cy : e.y, d0 = Math.hypot(ex - u.x, ey - u.y);
          if (d0 < md && m.niebla[j][Math.floor(ey) * m.N + Math.floor(ex)] === 2) { md = d0; b = e; }
        }
        if (b) W.orden(m, { t: 'hackear', j, ids: [u.id], obj: b.id });
      }
      const civil = sinArma.find((u) => u.tipo === 'civil');
      if (civil && civil.orden === 'nada' && !civil.auto && tk % 10 === 6) W.orden(m, { t: 'autoCivil', j, ids: [civil.id], on: true });
      // Guarnición: cada búnker con sitio recibe infantería de fusil que esté ociosa cerca y no vaya en la oleada.
      if (c.bunker && tk % 20 === 13) for (const b of m.ents) {
        if (b.j !== j || b.tipo !== 'bunker' || b.vida <= 0) continue;
        let libres = EDIF.bunker.bunker - W.enBunker(m, b); for (const u of m.ents) if (!u.edif && u.aBunk === b.id) libres--;
        if (libres <= 0) continue;
        const ids = soldados.filter((u) => u.tipo === 'infanteria' && u.orden === 'nada' && !ia.atacantes.has(u.id) && u.id !== ia.explorador && !ia.capturan.has(u.id) && Math.hypot(u.x - b.cx, u.y - b.cy) < 28).slice(0, libres).map((u) => u.id);
        if (ids.length) W.orden(m, { t: 'guarnecer', j, ids, en: b.id });
      }
      // Ingeniero militar (solo el rival de estilo defensivo): ocho minas en un arco por delante de la base, de cara al rival.
      if (ia.estilo === 'defensivo' && tk % 20 === 11 && m.t > 12000 && J.minerales > 500 && (ia.minasP || 0) < 8 && !urgente) {
        const z = sinArma.find((u) => u.tipo === 'ingeniero' && u.orden === 'nada' && !u.arregla);
        if (z) { const k = ia.minasP || 0, px = -vy / vd, py = vx / vd, mx = patio.cx + (vx / vd) * 17 + px * (k - 3.5) * 2.5, my = patio.cy + (vy / vd) * 17 + py * (k - 3.5) * 2.5; W.orden(m, { t: 'zapar', j, ids: [z.id], que: 'minar', x: Math.max(2, Math.min(m.N - 3, mx)), y: Math.max(2, Math.min(m.N - 3, my)) }); ia.minasP = k + 1; }
      }
      // Desminado: si una unidad suya pisa una mina, apunta dónde y manda a un ingeniero a limpiar la zona (si no tiene, entrena uno).
      if (J.minaVista && J.minaVista.t > (ia.tMina || 0)) { ia.tMina = J.minaVista.t; ia.minaEn = { x: J.minaVista.x, y: J.minaVista.y }; }
      if (ia.minaEn && tk % 5 === 0) {
        const z = sinArma.find((u) => u.tipo === 'ingeniero' && u.orden !== 'zapar');
        if (z) { W.orden(m, { t: 'zapar', j, ids: [z.id], que: 'desminar', x: ia.minaEn.x, y: ia.minaEn.y }); ia.minaEn = null; }
        else if (c.cuartel && !(c.ingeniero || 0) && !J.colas.ingeniero.n) entrena('ingeniero', 0);
      }
      // Central de inteligencia: un dron espía y un espía; y con información de sobra, mapeo satelital sobre el objetivo (así sus misiles y bombarderos lo ven).
      if (c.inteligencia && tk % 10 === 8 && !ahorra) {
        const cupo = W.cupoAire(m, j, 'inteligencia');
        if (!c.dronEspia && !J.colas.dronEspia.n && cupo.hay < cupo.cupo) entrena('dronEspia', 800);
        else if (!c.espia && !J.colas.espia.n) entrena('espia', 800);
        if (objetivo && J.info > 500 && (c.misilera || c.bombardero) && m.t - (ia.tSat || -9999) > 6000) { W.orden(m, { t: 'intel', j, clave: 'satelite', x: objetivo.cx, y: objetivo.cy }); ia.tSat = m.t; }
      }
      if (objetivo && tk % 10 === 9) for (const u of sinArma) if (u.tipo === 'espia' && u.orden === 'nada' && !u.infiltrado) { const cc = W.cercaLibre(m, objetivo.cx - (vx / vd) * 4, objetivo.cy - (vy / vd) * 4); W.orden(m, { t: 'mover', j, ids: [u.id], x: (cc % m.N) + 0.5, y: ((cc / m.N) | 0) + 0.5 }); }
      // Puente aéreo: con puesto logístico, un puesto móvil que se despliega a medio camino del rival: allí hay suministro, hospital y pista.
      if (c.logistica && m.logistica !== false) {
        const av = sinArma.find((u) => u.tipo === 'avanzadaMovil');
        if ((c.camionSum || 0) + J.colas.camionSum.n < (soldados.length >= 20 ? 2 : 1) && tk % 10 === 2 && !ahorra && soldados.length >= 8) entrena('camionSum', 400);
        if (!av) { if (!c.avanzada && !J.colas.avanzadaMovil.n && tk % 10 === 1 && !ahorra) entrena('avanzadaMovil', 800); }
        else if (av.orden === 'nada') {
          if (!ia.avz) { const cc = W.cercaLibre(m, patio.cx + vx * 0.5, patio.cy + vy * 0.5, true); ia.avz = { x: (cc % m.N) + 0.5, y: ((cc / m.N) | 0) + 0.5, n: 0 }; }
          const z = ia.avz;
          if (Math.hypot(av.x - z.x, av.y - z.y) < 5 && W.puedeDesplegar(m, av)) { W.orden(m, { t: 'desplegar', j, ids: [av.id] }); ia.avz = null; }
          else { const a = z.n * 2.4, r = Math.min(8, z.n * 0.8); z.n++; const cc = W.cercaLibre(m, z.x + Math.cos(a) * r, z.y + Math.sin(a) * r, true); W.orden(m, { t: 'mover', j, ids: [av.id], x: (cc % m.N) + 0.5, y: ((cc / m.N) | 0) + 0.5 }); if (z.n > 40) ia.avz = null; }
        }
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
      expl = soldados.find((u) => u.tipo === 'explorador' && u.orden === 'nada' && !u.obj) || (m.logistica === false && !J.cuenta.explorador && soldados.find((u) => u.tipo === 'infanteria' && !ia.atacantes.has(u.id) && u.orden === 'nada' && !u.obj)); // (con red de radio, un soldado lejos de la base no ve casi nada: explora solo el explorador, que lleva radio propia)
      if (expl) { ia.explorador = expl.id; W.orden(m, { t: 'explorar', j, ids: [expl.id] }); }
    }
    // Patio móvil: va al campo de minerales libre más cercano que quede lejos de las dos bases, y allí se despliega.
    for (const u of moviles) {
      if (u.orden !== 'nada') continue;
      if (!ia.expansion) {
        if (!ia.alcV || m.t - ia.tAlc > 1200) { ia.alcV = alcanceVehiculos(m, u.x, u.y); ia.tAlc = m.t; } // solo campos a los que el patio móvil pueda llegar
        let mejor = -1, md = Infinity;
        for (let k = 0; k < m.minas.length; k += 5) {
          const cel = m.minas[k], x = cel % m.N, y = (cel / m.N) | 0, d0 = Math.hypot(x - patio.cx, y - patio.cy);
          if (m.mapa.tipoMin[cel] !== 1 || d0 < 28 || d0 >= md || Math.hypot(x - rival.x, y - rival.y) < 40) continue;
          const kk = 6 / d0, tx = Math.floor(x + (patio.cx - x) * kk), ty = Math.floor(y + (patio.cy - y) * kk);
          if (!ia.alcV[W.cercaLibre(m, tx, ty, true)] || Math.hypot((W.cercaLibre(m, tx, ty, true) % m.N) - tx, ((W.cercaLibre(m, tx, ty, true) / m.N) | 0) - ty) > 4) continue;
          md = d0; mejor = cel;
        }
        if (mejor < 0) break;
        const x = mejor % m.N, y = (mejor / m.N) | 0, k = 6 / (md || 1);
        ia.expansion = { x: x + (patio.cx - x) * k, y: y + (patio.cy - y) * k, n: 0 };
      }
      const ex = ia.expansion;
      if (Math.hypot(u.x - ex.x, u.y - ex.y) < 4 && W.puedeDesplegar(m, u)) { W.orden(m, { t: 'desplegar', j, ids: [u.id] }); ia.expansion = null; }
      else { // aún lejos, o aquí no cabe: prueba un poco más allá, en espiral
        const a = ex.n * 2.4, r = Math.min(8, ex.n * 0.8); ex.n++;
        const c = W.cercaLibre(m, ex.x + Math.cos(a) * r, ex.y + Math.sin(a) * r, true);
        W.orden(m, { t: 'mover', j, ids: [u.id], x: (c % m.N) + 0.5, y: ((c / m.N) | 0) + 0.5 });
        if (ex.n > 40) ia.expansion = null;
      }
    }
    // Puestos neutrales: dos soldados van a capturar el más cercano que no sea suyo; al lograrlo vuelven a la reserva.
    for (const id of ia.capturan) if (!vivos.has(id)) ia.capturan.delete(id);
    {
      let p = ia.puesto >= 0 ? m.puestos[ia.puesto] : null;
      if (p && (p.dueno === j || !ia.capturan.size || m.t - ia.tPuesto > 4000)) { ia.capturan.clear(); ia.puesto = -1; p = null; }
      if (!p && soldados.length >= 6) {
        let md = m.N * 0.5;
        for (const q of m.puestos) { const d0 = Math.hypot(q.x - patio.cx, q.y - patio.cy); if (q.dueno !== j && d0 < md && Math.hypot(q.x - rival.x, q.y - rival.y) > 18) { md = d0; p = q; } }
        if (p) {
          const van = soldados.filter((u) => UNID[u.tipo].cat === 'inf' && u.tipo !== 'explorador' && !ia.atacantes.has(u.id) && u.orden === 'nada' && !u.obj).slice(0, 2);
          if (van.length) { ia.puesto = p.id; ia.tPuesto = m.t; for (const u of van) ia.capturan.add(u.id); W.orden(m, { t: 'mover', j, ids: van.map((u) => u.id), x: p.x + 0.6, y: p.y + 0.6 }); }
        }
      }
    }
    // Cortar caminos: hasta tres atacantes que se han quedado sin nada que hacer disparan al tramo enemigo que tengan a la vista y cerca.
    if (tk % 10 === 0) {
      const libres = soldados.filter((u) => ia.atacantes.has(u.id) && u.orden === 'nada' && !u.obj).slice(0, 3);
      if (libres.length) {
        let tramo = null, md = 8;
        for (const e of m.ents) { if (!e.infra || e.j === j || e.vida <= 0 || m.niebla[j][Math.floor(e.cy) * m.N + Math.floor(e.cx)] !== 2) continue; const d0 = Math.hypot(e.cx - libres[0].x, e.cy - libres[0].y) - (e.puente ? 3 : 0); if (d0 < md) { md = d0; tramo = e; } }
        if (tramo) W.orden(m, { t: 'atacar', j, ids: libres.filter((u) => W.puedeAtacar(u, tramo)).map((u) => u.id), obj: tramo.id });
      }
    }
    // El vehículo de mando y los ingenieros sobrantes acompañan al punto de reunión.
    if (J.nivel >= 2 && ia.estilo !== 'aereo' && !J.cuenta.comandoDrones && !J.colas.comandoDrones.n && soldados.length >= 10 && J.cuenta.fabrica && W.puedePagar(J, UNID.comandoDrones) && J.minerales > 1600) W.orden(m, { t: 'entrenar', j, tipo: 'comandoDrones' }); // un comando de drones que acompaña al grueso
    for (const u of sinArma) if ((u.tipo === 'mando' || u.tipo === 'comandoDrones' || u.tipo === 'vehRadio') && u.orden === 'nada' && Math.hypot(u.x - rx, u.y - ry) > 7) W.orden(m, { t: 'mover', j, ids: [u.id], x: rx - (dx / dd) * 2, y: ry - (dy / dd) * 2 });
    if (tk % 5 === 1) { // hackers y operadores de drones: con la oleada, unos pasos por detrás; sin oleada, en el punto de reunión
      let ax = 0, ay = 0, na = 0; for (const u of soldados) if (ia.atacantes.has(u.id)) { ax += u.x; ay += u.y; na++; }
      const tx = na >= 4 ? ax / na - (dx / dd) * 4 : rx - (dx / dd) * 2, ty = na >= 4 ? ay / na - (dy / dd) * 4 : ry - (dy / dd) * 2;
      if (na >= 4) for (const u of sinArma) if (u.tipo === 'tallerMovil' && u.orden === 'nada' && Math.hypot(u.x - tx, u.y - ty) > 12) { const cc = W.cercaLibre(m, tx, ty, true); W.orden(m, { t: 'mover', j, ids: [u.id], x: (cc % m.N) + 0.5, y: ((cc / m.N) | 0) + 0.5 }); } // el taller de campaña, detrás de la oleada: repara y recupera cascos él solo
      if (na >= 4) for (const u of sinArma) if (u.tipo === 'camionSum' && (!u.sumi || Math.hypot(u.sumi.x - tx, u.sumi.y - ty) > 14)) { const cc = W.cercaLibre(m, tx, ty, true); W.orden(m, { t: 'mover', j, ids: [u.id], x: (cc % m.N) + 0.5, y: ((cc / m.N) | 0) + 0.5 }); } // el camión de suministro, detrás de la oleada
      for (const u of sinArma) if (u.tipo === 'operador' && u.sinDron && u.orden === 'nada') { const b = m.ents.find((e) => e.edif && e.j === j && (e.tipo === 'estDrones' || e.tipo === 'logistica') && e.vida > 0); if (b && Math.hypot(u.x - b.cx, u.y - b.cy) > 4) { const cc = W.cercaLibre(m, b.cx, b.cy + b.tam / 2 + 1.5); W.orden(m, { t: 'mover', j, ids: [u.id], x: (cc % m.N) + 0.5, y: ((cc / m.N) | 0) + 0.5 }); } } // el operador sin drones vuelve a reponer
      if (objetivo) for (const u of sinArma) if (u.tipo === 'operador' && !u.sinDron && u.orden === 'nada' && !u.dronMis && Math.hypot(u.x - tx, u.y - ty) <= 8 && Math.hypot(objetivo.cx - u.x, objetivo.cy - u.y) <= UNID.operador.misionDron) W.orden(m, { t: 'dronMision', j, ids: [u.id], x: objetivo.cx, y: objetivo.cy }); // el operador, en su sitio y con el objetivo a tiro: dron en misión sobre él
      for (const u of sinArma) if ((u.tipo === 'hacker' || (u.tipo === 'operador' && !u.sinDron)) && u.orden === 'nada' && Math.hypot(u.x - tx, u.y - ty) > 8) { const cc = W.cercaLibre(m, tx, ty); W.orden(m, { t: 'mover', j, ids: [u.id], x: (cc % m.N) + 0.5, y: ((cc / m.N) | 0) + 0.5 }); }
    }
    if (tk % 5 === 2) { // sin munición lejos de casa: deja la oleada y vuelve a reponer (allí entra otra vez en la reserva)
      const ids = []; for (const u of soldados) if (u.mun === 0 && ia.atacantes.has(u.id)) { ia.atacantes.delete(u.id); if (ia.espera) ia.espera.delete(u.id); ia.reunidos.delete(u.id); ids.push(u.id); }
      if (ids.length) { const cc = W.cercaLibre(m, patio.cx + (dx / dd) * 8, patio.cy + (dy / dd) * 8); W.orden(m, { t: 'mover', j, ids, x: (cc % m.N) + 0.5, y: ((cc / m.N) | 0) + 0.5 }); }
    }
    const reserva = soldados.filter((u) => !ia.atacantes.has(u.id) && u.id !== ia.explorador && !ia.capturan.has(u.id) && u.mun !== 0);

    if (J.alerta && m.t - J.alerta.t < 100) { // defensa: acude la reserva ociosa
      const ids = reserva.filter((u) => u.orden === 'nada' && !u.obj).map((u) => u.id);
      if (ids.length) W.orden(m, { t: 'amover', j, ids, x: J.alerta.x, y: J.alerta.y });
    } else {
      const ids = reserva.filter((u) => u.orden === 'nada' && !u.obj && !ia.reunidos.has(u.id)).map((u) => u.id);
      if (ids.length) { W.orden(m, { t: 'amover', j, ids, x: rx, y: ry, rumbo: Math.atan2(dy, dx) }); for (const id of ids) ia.reunidos.add(id); } // esperan encarados al rival
    }
    if (objetivo) {
      // La oleada no entra en goteo: primero se junta en un punto a unas 26 celdas del objetivo (fuera del alcance de sus torres);
      // cuando ha llegado la mayoría —o ha pasado demasiado tiempo— entra toda a la vez, en pinza.
      if (!ia.espera) ia.espera = new Set();
      for (const id of ia.espera) if (!vivos.has(id)) ia.espera.delete(id);
      const ox = objetivo.cx - patio.cx, oy = objetivo.cy - patio.cy, od = Math.hypot(ox, oy) || 1, lim = (v) => Math.max(4, Math.min(m.N - 4, v));
      if (reserva.length >= ia.oleada) {
        if (!ia.espera.size || !ia.punto) { const c = W.cercaLibre(m, lim(objetivo.cx - (ox / od) * Math.min(26, od * 0.5)), lim(objetivo.cy - (oy / od) * Math.min(26, od * 0.5))); ia.punto = { x: (c % m.N) + 0.5, y: ((c / m.N) | 0) + 0.5 }; ia.tOla = m.t; }
        W.orden(m, { t: 'amover', j, ids: reserva.map((u) => u.id), x: ia.punto.x, y: ia.punto.y });
        for (const u of reserva) { ia.atacantes.add(u.id); ia.espera.add(u.id); }
        const tope = Math.round((m.t > 48000 ? 28 : 18) * E.oleada); // pasados 40 minutos, oleadas mayores para romper el empate
        ia.oleada = Math.min(ia.oleada + 2, tope);
      }
      if (ia.espera.size && ia.punto) {
        let cerca = 0; const grupo = soldados.filter((u) => ia.espera.has(u.id));
        for (const u of grupo) if (Math.hypot(u.x - ia.punto.x, u.y - ia.punto.y) < 12) cerca++;
        if (cerca >= Math.max(3, grupo.length * 0.7) || m.t - ia.tOla > od / 0.045 + 1500) { // (el plazo da tiempo a que llegue la infantería a pie desde su base) // ya están: al asalto. La mitad de frente; la otra rodea por un costado (que alterna) y entra por el flanco.
          const frente = grupo.filter((u, i) => i % 2 === 0), flanco = grupo.filter((u, i) => i % 2 === 1);
          if (frente.length) W.orden(m, { t: 'amover', j, ids: frente.map((u) => u.id), x: objetivo.cx, y: objetivo.cy });
          if (flanco.length) {
            const c = W.cercaLibre(m, lim(objetivo.cx - (ox / od) * 10 - (oy / od) * 16 * ia.lado), lim(objetivo.cy - (oy / od) * 10 + (ox / od) * 16 * ia.lado));
            const ids = flanco.map((u) => u.id);
            W.orden(m, { t: 'amover', j, ids, x: (c % m.N) + 0.5, y: ((c / m.N) | 0) + 0.5 });
            W.orden(m, { t: 'amover', j, ids, x: objetivo.cx, y: objetivo.cy, enc: true });
            ia.lado = -ia.lado;
          }
          ia.espera.clear();
        } else { // los que se han quedado parados por el camino, al punto
          const ids = grupo.filter((u) => u.orden === 'nada' && !u.obj && Math.hypot(u.x - ia.punto.x, u.y - ia.punto.y) >= 12).map((u) => u.id);
          if (ids.length) W.orden(m, { t: 'amover', j, ids, x: ia.punto.x, y: ia.punto.y });
        }
      }
      const ociosos = soldados.filter((u) => ia.atacantes.has(u.id) && !ia.espera.has(u.id) && u.orden === 'nada' && !u.obj).map((u) => u.id);
      if (ociosos.length) W.orden(m, { t: 'amover', j, ids: ociosos, x: objetivo.cx, y: objetivo.cy });
    }
  };
})();
