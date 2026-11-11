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
  const ORDEN_TEC = ['tolva', 'perforante', 'nivel2', 'motores', 'chalecos', 'reactivo', 'telemetro', 'turbinas', 'depuracion', 'nivel3', 'canonLargo', 'analisis'];

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
    const E = ESTILOS[ia.estilo];
    let patio = null, objetivo = null, dObj = Infinity;
    const soldados = [], aviones = [], patios = [], moviles = [], sinArma = [];
    for (const e of m.ents) {
      if (e.j === j) {
        if (e.tipo === 'patio') patios.push(e);
        else if (e.tipo === 'patioMovil') moviles.push(e);
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
    const quiereDeposito = m.logistica !== false && ia.via && ia.viaFin && !J.cuenta.deposito && W.tieneReq(m, j, EDIF.deposito.req) && J.minerales > 900 && m.ents.some((e) => e.infra && e.j === j && e.conRed);
    if (obra && obra.tipo === 'deposito' && ia.viaFin) donde = { cx: ia.viaFin.x, cy: ia.viaFin.y };
    const plan = obra || urgente ? null : planBase || (quiereDeposito ? 'deposito' : siguienteEdificio(m, j, patio, ia.plan));
    if (obra && obra.listo) {
      const p = buscarSitio(m, j, obra.tipo, donde) || buscarSitio(m, j, obra.tipo, patio);
      if (p) { W.orden(m, { t: 'colocar', j, tipo: obra.tipo, x: p.x, y: p.y }); ia.fallos = 0; }
      else if (++ia.fallos > 15) { W.orden(m, { t: 'cancelarEdif', j, tipo: obra.tipo }); ia.fallos = 0; }
    } else if (plan && W.puedePagar(J, EDIF[plan]) && !(ia.tAhorro > 0 && plan !== 'central' && plan !== 'bomba' && plan !== planBase)) { // mientras ahorra para la segunda base, solo lo urgente
      W.orden(m, { t: 'construir', j, tipo: plan });
    }

    // Caminos: si a sus vehículos ya casi no les quedan minerales a los que llegar (el resto está tras el bosque),
    // encarga una excavadora y abre camino hasta el campo cerrado más cercano.
    if (m.t % 600 === ia.j * 20) {
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
    // La red: un extractor o una estación sin conexión rinde la mitad. La excavadora le lleva un camino desde donde esté (que es la red: su base o su vía).
    const suelto = m.logistica !== false && J.cuenta.fabrica && J.minerales > 300 ? m.ents.find((e) => e.edif && !e.infra && e.j === j && !e.conRed && EDIF[e.tipo].da && m.t - e.nace > 40) : null;
    if (suelto) {
      const exc = sinArma.find((u) => u.tipo === 'excavadora');
      if (!exc) { if (!J.colas.excavadora.n && W.puedePagar(J, UNID.excavadora)) W.orden(m, { t: 'entrenar', j, tipo: 'excavadora' }); }
      else if (exc.orden === 'nada' && m.t % 40 === 0) { // primero hasta el patio (lo que ya es camino no cuesta), para que el camino salga de la red, y de ahí al edificio
        const p0 = W.cercaLibre(m, patio.cx, patio.y + patio.tam + 1.5, true), c = W.cercaLibre(m, suelto.cx, suelto.y + suelto.tam + 1.5, true);
        const tr = m.porId.get(m.tramoEn[Math.floor(exc.y) * m.N + Math.floor(exc.x)]), enRed = !!tr && tr.j === j && tr.conRed; // ya está sobre un camino conectado: sigue desde ahí
        if (!enRed) W.orden(m, { t: 'trazar', j, ids: [exc.id], x: (p0 % m.N) + 0.5, y: ((p0 / m.N) | 0) + 0.5 });
        W.orden(m, { t: 'trazar', j, ids: [exc.id], x: (c % m.N) + 0.5, y: ((c / m.N) | 0) + 0.5, enc: !enRed });
      }
    } else if (ia.campoCerrado >= 0 && J.cuenta.fabrica) {
      const exc = sinArma.find((u) => u.tipo === 'excavadora');
      if (!exc) { if (!J.colas.excavadora.n && W.puedePagar(J, UNID.excavadora)) W.orden(m, { t: 'entrenar', j, tipo: 'excavadora' }); }
      else if (exc.orden === 'nada' && J.minerales > 300) { W.orden(m, { t: 'trazar', j, ids: [exc.id], x: (ia.campoCerrado % m.N) + 0.5, y: ((ia.campoCerrado / m.N) | 0) + 0.5 }); ia.campoCerrado = -1; }
    } else if (!ia.via && J.cuenta.fabrica && m.t > 7200 && J.minerales > 1800 && objetivo) {
      // Con la economía en marcha, tiende una vía desde su base hacia el frente (hasta medio camino): sus refuerzos llegan antes.
      const exc = sinArma.find((u) => u.tipo === 'excavadora');
      if (!exc) { if (!J.colas.excavadora.n && W.puedePagar(J, UNID.excavadora)) W.orden(m, { t: 'entrenar', j, tipo: 'excavadora' }); }
      else if (exc.orden === 'nada') {
        const c = W.cercaLibre(m, patio.cx + (objetivo.cx - patio.cx) * 0.45, patio.cy + (objetivo.cy - patio.cy) * 0.45, true);
        W.orden(m, { t: 'trazar', j, ids: [exc.id], x: (c % m.N) + 0.5, y: ((c / m.N) | 0) + 0.5 }); ia.via = true;
        ia.viaFin = { x: (c % m.N) + 0.5, y: ((c / m.N) | 0) + 0.5 }; ia.viaIni = { x: exc.x, y: exc.y }; ia.viaN = 0;
      }
    } else if (ia.via && ia.viaFin && m.t % 400 === ia.j * 20) {
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
      // Segunda base: un patio móvil cuando la economía lo permite y aún solo hay un patio.
      if (ahorra) veh = 'patioMovil';
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
      if (c.fabrica && !enFabrica && dinero >= UNID[veh].costo + guardaAire && W.puedePagar(J, UNID[veh])) { W.orden(m, { t: 'entrenar', j, tipo: veh }); dinero -= UNID[veh].costo; }
      if (av && !ahorra && dinero >= UNID[av].costo + (E.aviones > 1 ? 0 : 600) && W.puedePagar(J, UNID[av])) { W.orden(m, { t: 'entrenar', j, tipo: av }); dinero -= UNID[av].costo; }
      // Infantería: un antitanque por cada dos fusileros desde el nivel 2.
      let inf = J.nivel >= 2 && (c.antitanque || 0) * 2 < (c.infanteria || 0) ? 'antitanque' : 'infanteria';
      if (!c.explorador && !J.colas.explorador.n && ((c.extractor || 0) < 2 || !c.estacion)) inf = 'explorador'; // uno para descubrir yacimientos
      else if (J.nivel >= 2 && (c.ingeniero || 0) + J.colas.ingeniero.n < (ia.estilo === 'defensivo' ? 2 : 1)) inf = 'ingeniero'; // repara la base él solo
      else if ((c.medico || 0) + J.colas.medico.n < 1 && (c.infanteria || 0) >= 6) inf = 'medico'; // uno, para la tropa que vuelve herida
      else if (J.nivel >= 2 && (c.francotirador || 0) < 3 && (c.francotirador || 0) * 5 < (c.infanteria || 0)) inf = 'francotirador';
      const topeInf = E.infMax && (c.infanteria || 0) + (c.antitanque || 0) >= E.infMax && (inf === 'infanteria' || inf === 'antitanque');
      if (c.cuartel && !topeInf && !(ahorra && soldados.length >= 6) && J.colas.infanteria.n + J.colas.antitanque.n + J.colas.explorador.n + J.colas.ingeniero.n + J.colas.francotirador.n < 2 && dinero >= UNID[inf].costo + guardaAire && W.puedePagar(J, UNID[inf])) { W.orden(m, { t: 'entrenar', j, tipo: inf }); dinero -= UNID[inf].costo; }
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
      for (const u of ociosos) { // bombarderos y helicópteros atacan lo que tengan a su alcance de vuelo y ya esté explorado; el resto patrulla
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
      expl = soldados.find((u) => u.tipo === 'explorador' && u.orden === 'nada' && !u.obj) || (!J.cuenta.explorador && soldados.find((u) => u.tipo === 'infanteria' && !ia.atacantes.has(u.id) && u.orden === 'nada' && !u.obj));
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
    if (m.t % 200 === ia.j * 20) {
      const libres = soldados.filter((u) => ia.atacantes.has(u.id) && u.orden === 'nada' && !u.obj).slice(0, 3);
      if (libres.length) {
        let tramo = null, md = 8;
        for (const e of m.ents) { if (!e.infra || e.j === j || e.vida <= 0 || m.niebla[j][Math.floor(e.cy) * m.N + Math.floor(e.cx)] !== 2) continue; const d0 = Math.hypot(e.cx - libres[0].x, e.cy - libres[0].y) - (e.puente ? 3 : 0); if (d0 < md) { md = d0; tramo = e; } }
        if (tramo) W.orden(m, { t: 'atacar', j, ids: libres.filter((u) => W.puedeAtacar(u, tramo)).map((u) => u.id), obj: tramo.id });
      }
    }
    // El vehículo de mando y los ingenieros sobrantes acompañan al punto de reunión.
    for (const u of sinArma) if (u.tipo === 'mando' && u.orden === 'nada' && Math.hypot(u.x - rx, u.y - ry) > 7) W.orden(m, { t: 'mover', j, ids: [u.id], x: rx - (dx / dd) * 2, y: ry - (dy / dd) * 2 });
    const reserva = soldados.filter((u) => !ia.atacantes.has(u.id) && u.id !== ia.explorador && !ia.capturan.has(u.id));

    if (J.alerta && m.t - J.alerta.t < 100) { // defensa: acude la reserva ociosa
      const ids = reserva.filter((u) => u.orden === 'nada' && !u.obj).map((u) => u.id);
      if (ids.length) W.orden(m, { t: 'amover', j, ids, x: J.alerta.x, y: J.alerta.y });
    } else {
      const ids = reserva.filter((u) => u.orden === 'nada' && !u.obj && !ia.reunidos.has(u.id)).map((u) => u.id);
      if (ids.length) { W.orden(m, { t: 'amover', j, ids, x: rx, y: ry, rumbo: Math.atan2(dy, dx) }); for (const id of ids) ia.reunidos.add(id); } // esperan encarados al rival
    }
    if (objetivo) {
      if (reserva.length >= ia.oleada) {
        // Ataque en pinza: la mitad va de frente; la otra rodea por un costado (que alterna) y entra por el flanco.
        const frente = reserva.filter((u, i) => i % 2 === 0), flanco = reserva.filter((u, i) => i % 2 === 1);
        W.orden(m, { t: 'amover', j, ids: frente.map((u) => u.id), x: objetivo.cx, y: objetivo.cy });
        if (flanco.length) {
          const ox = objetivo.cx - patio.cx, oy = objetivo.cy - patio.cy, od = Math.hypot(ox, oy) || 1, lim = (v) => Math.max(4, Math.min(m.N - 4, v));
          const c = W.cercaLibre(m, lim(objetivo.cx - (ox / od) * 10 - (oy / od) * 16 * ia.lado), lim(objetivo.cy - (oy / od) * 10 + (ox / od) * 16 * ia.lado));
          const ids = flanco.map((u) => u.id);
          W.orden(m, { t: 'amover', j, ids, x: (c % m.N) + 0.5, y: ((c / m.N) | 0) + 0.5 });
          W.orden(m, { t: 'amover', j, ids, x: objetivo.cx, y: objetivo.cy, enc: true });
          ia.lado = -ia.lado;
        }
        for (const u of reserva) ia.atacantes.add(u.id);
        const tope = Math.round((m.t > 48000 ? 28 : 18) * E.oleada); // pasados 40 minutos, oleadas mayores para romper el empate
        ia.oleada = Math.min(ia.oleada + 2, tope);
      }
      const ociosos = soldados.filter((u) => ia.atacantes.has(u.id) && u.orden === 'nada' && !u.obj).map((u) => u.id);
      if (ociosos.length) W.orden(m, { t: 'amover', j, ids: ociosos, x: objetivo.cx, y: objetivo.cy });
    }
  };
})();
