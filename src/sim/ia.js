// rts.warfare — IA rival básica. Solo emite comandos, igual que el jugador.
// Limitación declarada: no usa la niebla (sabe dónde está la base rival).
// Cada rival tiene un estilo (W.ESTILOS_IA) que cambia qué construye, con qué ejército ataca y cuándo.
(function () {
  const W = globalThis.W || (globalThis.W = {});
  const EDIF = W.EDIF, UNID = W.UNID, TEC = W.TEC;

  // Orden de construcción: [tipo, cantidad deseada].
  const PLAN = [['central', 1], ['refineria', 1], ['cuartel', 1], ['bomba', 1], ['extractor', 1], ['fabrica', 1], ['torreta', 1], ['nidoMG', 1], ['refineria', 2],
    ['estacion', 1], ['torreta', 2], ['nidoMG', 2], ['cuartel', 2], ['extractor', 2], ['torreta', 3], ['fabrica', 2], ['torreCanon', 1], ['aerodromo', 1], ['antiaerea', 1], ['torreCanon', 2], ['antiaerea', 2]];
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

  // ---------- La lógica de costes ----------
  // En vez de proporciones fijas, compra lo que mejor le sale contra lo que ha visto del rival y contra lo que le está matando a los suyos.
  const fichaDe = (t) => UNID[t] || EDIF[t];
  const ARMA_DE = {}; // quién suele llevar cada arma (para deducir, de lo que mata a los suyos, qué tiene el rival)
  for (const t of Object.keys(UNID)) { const d = UNID[t]; if (d.arma && !d.mini && !ARMA_DE[d.arma]) ARMA_DE[d.arma] = t; }
  for (const t of Object.keys(EDIF)) { const d = EDIF[t]; if (d.arma && !ARMA_DE[d.arma]) ARMA_DE[d.arma] = t; }
  const PREVIO = { infanteria: 400, tanque: 600, torreta: 350 }; // lo que supone del rival antes de verlo (en valor)
  const C_INF = ['infanteria', 'granadero', 'antitanque', 'francotirador', 'gatling', 'mortero', 'asalto'], C_VEH = ['blindado', 'tanque', 'pesado', 'artilleria', 'lanzacohetes'];
  W.IA_CANDIDATOS = C_INF.concat(C_VEH);
  // La tabla de duelos: medida en la propia simulación (tools/duelos.js), el mismo valor en minerales de cada tipo contra cada tipo, a campo abierto y hasta el final.
  // De 1 (arrasa sin perder nada) a -1 (lo pierde todo sin hacer daño). Hay que regenerarla cuando cambie el equilibrio de unidades o armas.
  /* DUELOS */ const DUELO = {"infanteria":{"infanteria":0,"granadero":0.5,"antitanque":0.86,"francotirador":0.23,"gatling":0.99,"mortero":0.24,"asalto":-0.57,"blindado":-0.9,"tanque":-0.52,"pesado":-0.6,"artilleria":-0.98,"lanzacohetes":-1,"torreta":-0.66,"nidoMG":-0.79,"torreCanon":-0.31},"granadero":{"infanteria":-0.5,"granadero":0,"antitanque":0.66,"francotirador":-1,"gatling":0.89,"mortero":1,"asalto":-0.4,"blindado":-0.67,"tanque":0.51,"pesado":-0.27,"artilleria":-0.94,"lanzacohetes":-1,"torreta":-0.95,"nidoMG":-0.95,"torreCanon":-0.99},"antitanque":{"infanteria":-0.86,"granadero":-0.66,"antitanque":0,"francotirador":-1,"gatling":-0.51,"mortero":-0.62,"asalto":-0.9,"blindado":-0.4,"tanque":0.62,"pesado":0.76,"artilleria":-0.67,"lanzacohetes":-0.63,"torreta":-0.71,"nidoMG":-0.36,"torreCanon":-0.59},"francotirador":{"infanteria":-0.23,"granadero":1,"antitanque":1,"francotirador":0,"gatling":1,"mortero":1,"asalto":-0.59,"blindado":-0.97,"tanque":-0.95,"pesado":-0.94,"artilleria":-0.92,"lanzacohetes":-0.95,"torreta":0.1,"nidoMG":0.08,"torreCanon":0.16},"gatling":{"infanteria":-0.99,"granadero":-0.89,"antitanque":0.51,"francotirador":-1,"gatling":0,"mortero":-1,"asalto":-0.99,"blindado":-0.98,"tanque":-0.9,"pesado":-0.83,"artilleria":-1,"lanzacohetes":-1,"torreta":-0.93,"nidoMG":0.67,"torreCanon":-0.9},"mortero":{"infanteria":-0.24,"granadero":-1,"antitanque":0.62,"francotirador":-1,"gatling":1,"mortero":0,"asalto":-0.64,"blindado":-0.53,"tanque":0.22,"pesado":-0.62,"artilleria":-1,"lanzacohetes":-0.85,"torreta":0.56,"nidoMG":0.58,"torreCanon":-0.08},"asalto":{"infanteria":0.57,"granadero":0.4,"antitanque":0.9,"francotirador":0.59,"gatling":0.99,"mortero":0.64,"asalto":0,"blindado":-0.84,"tanque":-0.12,"pesado":-0.19,"artilleria":-1,"lanzacohetes":-0.2,"torreta":-0.5,"nidoMG":-0.48,"torreCanon":-0.18},"blindado":{"infanteria":0.9,"granadero":0.67,"antitanque":0.4,"francotirador":0.97,"gatling":0.98,"mortero":0.53,"asalto":0.84,"blindado":0,"tanque":-0.8,"pesado":-0.72,"artilleria":-0.69,"lanzacohetes":-0.32,"torreta":-0.92,"nidoMG":-0.56,"torreCanon":-0.93},"tanque":{"infanteria":0.52,"granadero":-0.51,"antitanque":-0.62,"francotirador":0.95,"gatling":0.9,"mortero":-0.22,"asalto":0.12,"blindado":0.8,"tanque":0,"pesado":0.05,"artilleria":0.35,"lanzacohetes":0.63,"torreta":-0.71,"nidoMG":0.5,"torreCanon":-0.74},"pesado":{"infanteria":0.6,"granadero":0.27,"antitanque":-0.76,"francotirador":0.94,"gatling":0.83,"mortero":0.62,"asalto":0.19,"blindado":0.72,"tanque":-0.05,"pesado":0,"artilleria":0.56,"lanzacohetes":0.62,"torreta":0.44,"nidoMG":0.88,"torreCanon":-0.76},"artilleria":{"infanteria":0.98,"granadero":0.94,"antitanque":0.67,"francotirador":0.92,"gatling":1,"mortero":1,"asalto":1,"blindado":0.69,"tanque":-0.35,"pesado":-0.56,"artilleria":0,"lanzacohetes":-0.3,"torreta":0.33,"nidoMG":0.53,"torreCanon":1},"lanzacohetes":{"infanteria":1,"granadero":1,"antitanque":0.63,"francotirador":0.95,"gatling":1,"mortero":0.85,"asalto":0.2,"blindado":0.32,"tanque":-0.63,"pesado":-0.62,"artilleria":0.3,"lanzacohetes":0,"torreta":0.33,"nidoMG":0.61,"torreCanon":0.5}}; /* FIN DUELOS */
  W.IA_DUELO = DUELO;
  // Lo que ha visto del rival (se olvida despacio) y lo que le está matando a los suyos: de ahí sale contra qué compra.
  function iaObserva(m, ia) {
    const j = ia.j, nie = m.niebla[j], N = m.N, ahora = {}, V = ia.visto || (ia.visto = {});
    for (const e of m.ents) {
      if (e.j === j || e.j > 1 || e.vida <= 0 || e.muro || e.infra) continue;
      const d = e.edif ? EDIF[e.tipo] : UNID[e.tipo]; if (!d || !d.arma || d.mini || !d.costo) continue;
      if (nie[Math.floor(e.edif ? e.cy : e.y) * N + Math.floor(e.edif ? e.cx : e.x)] !== 2) continue;
      ahora[e.tipo] = (ahora[e.tipo] || 0) + 1;
    }
    const M = ia.memo || (ia.memo = new Map()); // dónde ha visto tropa enemiga armada, y cuánta (para estimar qué defiende cada blanco)
    for (const e of m.ents) { if (e.edif || e.j === j || e.j > 1 || e.vida <= 0 || e.herido) continue; const d = UNID[e.tipo]; if (!d.arma || d.mini || !d.costo) continue; if (nie[Math.floor(e.y) * N + Math.floor(e.x)] !== 2 || W.oculta(m, e)) continue; M.set(e.id, { x: e.x, y: e.y, v: d.costo * e.vida / (e.vidaMax || 1), t: m.t, aire: !!d.aire }); }
    for (const [id, r] of M) { const e = m.porId.get(id); if (!e || e.vida <= 0 || m.t - r.t > 4800) M.delete(id); }
    for (const t in V) { V[t] *= 0.985; if (V[t] < 0.3) delete V[t]; }
    for (const t in ahora) if (!(V[t] > ahora[t])) V[t] = ahora[t];
    const pa = m.jug[j].cont ? m.jug[j].cont.porArma : {}, ant = ia.armaAnt || (ia.armaAnt = {}), D = ia.dano || (ia.dano = {});
    for (const a in D) { D[a] *= 0.985; if (D[a] < 20) delete D[a]; }
    for (const a in pa) { const dv = pa[a] - (ant[a] || 0); if (dv > 0) { D[a] = (D[a] || 0) + dv; ant[a] = pa[a]; } }
    const am = {}; let tot = 0; // la amenaza, en valor por tipo
    for (const t in PREVIO) am[t] = PREVIO[t] * 0.5;
    for (const t in V) am[t] = (am[t] || 0) + V[t] * fichaDe(t).costo * 0.5;
    for (const a in D) { const t = ARMA_DE[a]; if (t) am[t] = (am[t] || 0) + D[a]; } // lo que de verdad le está matando pesa más que lo que solo ha visto
    for (const t in am) { if (UNID[t] && UNID[t].atras) am[t] *= 0.35; tot += am[t]; } // la artillería, los morteros y el resto del apoyo enemigo no se combaten de frente con tropa de línea: cuentan menos al elegir qué comprar
    ia.amenaza = am; ia.amenazaT = tot;
  }
  // La nota de un candidato: lo que gana menos lo que pierde, promediado sobre lo que tiene el rival (y un 15 % de edificios, que no contestan).
  function nota(ia, c) {
    const am = ia.amenaza, D = DUELO[c]; if (!am || !D) return 0; let n = 0, tot = 0;
    for (const t in am) if (D[t] !== undefined) { const w = EDIF[t] ? am[t] * 0.5 : am[t]; n += w * D[t]; tot += w; } /* (las defensas fijas pesan la mitad: solo cuentan al atacar) */
    return tot ? n / tot : 0;
  }
  W.iaNota = nota;
  // (Sin uso por ahora: con el equilibrio nuevo de granadero y tanque, comprar así perdió 0-5 contra las proporciones fijas. Queda para retomarla con un modelo de combate mejor que el duelo a campo abierto.)
  // Qué comprar de una lista: reparte el gasto entre los candidatos según su nota (los mejores, más) y pide el que va más corto respecto a su parte.
  function elige(m, ia, J, lista) {
    const j = ia.j, c = J.cuenta, ok = [];
    let apoyo = 0, total = 0; for (const t of C_INF.concat(C_VEH)) { const v = ((c[t] || 0) + J.colas[t].n) * UNID[t].costo; total += v; if (UNID[t].atras) apoyo += v; }
    for (const t of lista) { const d = UNID[t]; if ((d.nivel || 1) > J.nivel || !W.tieneReq(m, j, d.req) || J.raros < (d.raros || 0) || (J.acero !== undefined && J.acero < (d.acero || 0))) continue; if (d.atras && (total < 1500 || apoyo > total * 0.3)) continue; /* el apoyo, nunca más de un tercio ni antes de tener línea */ ok.push(t); }
    if (!ok.length) return null;
    let mx = -Infinity, mn = Infinity; const ns = ok.map((t) => { const n = nota(ia, t); if (n > mx) mx = n; if (n < mn) mn = n; return n; });
    const T = 0.3; let sp = 0, sv = 0; const ps = ns.map((n) => { const w = Math.exp((n - mx) / T); sp += w; return w; }), vs = ok.map((t) => { const v = ((c[t] || 0) + J.colas[t].n) * UNID[t].costo; sv += v; return v; });
    let mejor = ok[0], md = -Infinity; for (let i = 0; i < ok.length; i++) { const dlt = ps[i] / sp - (sv ? vs[i] / sv : 0); if (dlt > md) { md = dlt; mejor = ok[i]; } }
    return mejor;
  }

  // ---------- Entrega 3: atacar solo cuando salen las cuentas ----------
  // Cada blanco posible se valora por lo que vale (lo que le duele al rival perderlo) y por lo que lo defiende: las defensas que hay junto a él
  // (que en su sitio valen más de lo que costaron) y la tropa enemiga que la IA ha visto por allí hace poco. La oleada sale contra el blanco
  // que mejor rinde entre los que su reserva puede tomar con holgura; si ninguno, espera y sigue juntando. Cuanto más tiempo lleva sin atacar,
  // menos holgura pide (si no, las partidas se atascan). Cada oleada se cierra con un balance: si fracasa, ese blanco pide más fuerza la vez
  // siguiente, se anota lo que lo defendía de verdad y, si lo que la mató fueron defensas fijas, la IA pide artillería antes de volver.
  const VALOR_BLANCO = { patio: 3200, refineria: 1600, extractor: 1000, central: 900, hidro: 1100, fabrica: 1500, cuartel: 900, aerodromo: 1600, misilera: 2400, inteligencia: 1300, opEsp: 1000, logistica: 1000, hospital: 700, estacion: 900, obras: 700, fundicion: 800, interceptor: 1400, radar: 800 };
  const ARMAS_FIJAS = new Set(Object.keys(EDIF).map((k) => EDIF[k].arma).filter(Boolean));
  const potU = (u) => (u.herido ? 0 : (UNID[u.tipo].costo || 0) * Math.max(0.2, u.vida / (u.vidaMax || 1)));
  function defensaEn(m, ia, x, y, movil) {
    let s = 0, vista = 0;
    for (const e of m.ents) { if (!e.edif || e.j === ia.j || e.j > 1 || e.vida <= 0) continue; const d = EDIF[e.tipo]; if (!d.arma) continue; if (Math.abs(e.cx - x) > 10 || Math.hypot(e.cx - x, e.cy - y) > 10) continue; s += d.costo * 1.6 * Math.max(0.2, e.vida / (e.vidaMax || 1)); }
    if (ia.memo) for (const r of ia.memo.values()) if (Math.hypot(r.x - x, r.y - y) <= 16) vista += r.v * (r.aire ? 0.5 : 1);
    return s + Math.max(vista, movil || 0); // la tropa que ha visto por allí, o la parte de su ejército que acudiría (lo que no ve, no deja de existir)
  }
  W.iaDefensaEn = defensaEn; W.iaDecideAtaque = (m, ia, patio, fz, nSold, propio) => decideAtaque(m, ia, patio, fz, nSold, propio);
  function decideAtaque(m, ia, patio, fz, nSold, propio, holgura) {
    // El ejército móvil del rival: lo visto hace poco o, si ha visto menos, algo parecido al propio (lo que no ve, lo supone).
    let visto = 0; if (ia.memo) for (const r of ia.memo.values()) visto += r.v * (r.aire ? 0.5 : 1);
    const ejercito = Math.max(visto, propio * 0.8);
    let pr = null, dp = Infinity; for (const e of m.ents) if (e.edif && e.j !== ia.j && e.j <= 1 && e.tipo === 'patio') { const d = Math.hypot(e.cx - patio.cx, e.cy - patio.cy); if (d < dp) { dp = d; pr = e; } } // su patio más cercano: alrededor está su ejército
    const relaja = Math.max(0.55, 1 - (m.t - (ia.tUltOla || 0)) / 24000), tope = nSold >= 34 ? 0.6 : 1; // con el cupo lleno, pide menos: quedarse parado con 40 soldados no gana nada
    let mejor = null, mv = 0;
    for (const e of m.ents) {
      if (e.j === ia.j || e.j > 1 || !e.edif || e.infra || e.muro || e.vida <= 0) continue;
      const val = VALOR_BLANCO[e.tipo] || EDIF[e.tipo].costo || 0; if (val < 400) continue;
      const lejos = pr ? Math.hypot(e.cx - pr.cx, e.cy - pr.cy) : 0, acude = ejercito * (lejos < 20 ? 0.7 : lejos < 45 ? 0.5 : 0.3); // cuanto más lejos de su base, menos tropa llega a defenderlo
      const def = defensaEn(m, ia, e.cx, e.cy, acude) + ((ia.extra && ia.extra[e.id]) || 0), pide = (def * 1.5 + 300) * (holgura || 1) * (1 + 0.6 * ((ia.fracasos && ia.fracasos[e.id]) || 0)) * relaja * tope; // (el estilo pesa: el de asalto se lanza con menos margen; el defensivo pide más)
      if (fz < pide) continue; // no le salen las cuentas
      const v = val / (def + 500) / (1 + Math.hypot(e.cx - patio.cx, e.cy - patio.cy) / 90);
      if (v > mv) { mv = v; mejor = { b: e, def, pide }; }
    }
    return mejor;
  }
  // El balance de la oleada en curso: éxito si cae el blanco; fracaso si queda menos de un tercio o pasa demasiado tiempo.
  function cierreOla(m, ia, J, soldados) {
    const O = ia.ola; if (!O) return;
    const b = m.porId.get(O.b), cae = !b || b.vida <= 0 || b.j === ia.j;
    let vivos = 0; for (const id of O.ids) { const u = m.porId.get(id); if (u && u.vida > 0 && !u.herido) vivos++; }
    const perdido = J.cont.perdido - O.p0;
    if (!cae && vivos > O.ids.length * 0.33 && m.t - O.t < 9000) return;
    const fr = ia.fracasos || (ia.fracasos = {}), ex = ia.extra || (ia.extra = {});
    if (cae) fr[O.b] = 0;
    else {
      fr[O.b] = (fr[O.b] || 0) + 1; ex[O.b] = (ex[O.b] || 0) + perdido * 0.5; // lo defendía más de lo que parecía
      let fija = 0, tot = 0; const pa = J.cont.porArma; for (const a in pa) { const dv = pa[a] - (O.pa0[a] || 0); if (dv > 0) { tot += dv; if (ARMAS_FIJAS.has(a)) fija += dv; } }
      if (tot && fija > tot * 0.4) ia.pideArt = m.t; // la mataron sus defensas fijas: antes de volver, artillería
      for (const u of soldados) if (ia.atacantes.has(u.id) && O.ids.includes(u.id)) { ia.atacantes.delete(u.id); ia.reunidos.delete(u.id); } // los que quedan vuelven a la reserva
    }
    (ia.diario || (ia.diario = [])).push({ t: m.t, blanco: O.tipo, fuerza: Math.round(O.fz), defensa: Math.round(O.def), salen: O.ids.length, vuelven: vivos, perdido: Math.round(perdido), cae, operacion: !!O.op });
    ia.ola = null; ia.blanco = 0;
    if (O.op && ia.op) { if (cae) finOp(m, ia, true); else if (++ia.op.intentos >= 2) finOp(m, ia, false); else { ia.op.fase = 'acerca'; ia.op.tFase = m.t; ia.op.paso = null; } } // la operación: si el asalto fracasa, a preparar otra vez (dos intentos)
  }
  // ---------- Entrega 4: operaciones contra posiciones fortificadas ----------
  // Cuando no hay blanco que tomar con holgura (o ya tarde, para ganar) y el patio rival está fortificado, la IA monta una operación por fases:
  // preparación (un observador se acerca; artillería, morteros y aviación golpean sus defensas desde fuera de su alcance; el Delta las marca),
  // aislamiento (el comando va a por la energía que alimenta sus torres; la guerra electrónica corta radios y enlaces) y asalto combinado con un amago
  // por otro lado. Si el asalto fracasa, vuelve a preparar (dos veces como mucho) o lo deja y espera.
  const esIndirecto = (u) => { const d = UNID[u.tipo]; return !!(d.arma && W.ARMAS[d.arma].indirecto); };
  function ejercitoRival(ia, propio) { let v = 0; if (ia.memo) for (const r of ia.memo.values()) v += r.v * (r.aire ? 0.5 : 1); return Math.max(v, propio * 0.8); }
  function defensasFijas(m, ia, b) { const L = []; for (const e of m.ents) { if (!e.edif || e.j === ia.j || e.j > 1 || e.vida <= 0 || !EDIF[e.tipo].arma) continue; if (Math.hypot(e.cx - b.cx, e.cy - b.cy) <= 10) L.push(e); } return L; }
  const valorDe = (L) => L.reduce((s, e) => s + EDIF[e.tipo].costo * 1.6 * Math.max(0.2, e.vida / (e.vidaMax || 1)), 0);
  function patioRival(m, ia, patio) { let pr = null, dp = Infinity; for (const e of m.ents) if (e.edif && e.j !== ia.j && e.j <= 1 && e.tipo === 'patio' && e.vida > 0) { const d = Math.hypot(e.cx - patio.cx, e.cy - patio.cy); if (d < dp) { dp = d; pr = e; } } return pr; }
  W.iaDepura = { defensasFijas, valorDe, patioRival, puntoSeguro: (m, ia, b, patio) => puntoSeguro(m, ia, b, patio) };
  function finOp(m, ia, exito) { if (ia.op) (ia.diario || (ia.diario = [])).push({ t: m.t, operacion: true, blanco: 'patio', fase: ia.op.fase, intentos: ia.op.intentos, exito }); ia.op = null; ia.opDefs = null; ia.tOpFin = m.t; }
  // Sobre la recta del blanco a casa, el primer punto que queda fuera del alcance de todas sus torres (con margen); y la torre más cercana a él, la primera a batir.
  function puntoSeguro(m, ia, b, patio) {
    const L = [];
    for (const e of m.ents) { if (!e.edif || e.j === ia.j || e.j > 1 || e.vida <= 0) continue; const a = EDIF[e.tipo].arma && W.ARMAS[EDIF[e.tipo].arma]; if (!a || a.indirecto || !(a.vs.ligero || a.vs.pesado)) continue; L.push(e, a.alcance + e.tam / 2 + 2.5); }
    const gx = patio.cx - b.cx, gy = patio.cy - b.cy, gd = Math.hypot(gx, gy) || 1;
    for (let d = 8; d <= 60; d += 2) {
      const x = b.cx + (gx / gd) * d, y = b.cy + (gy / gd) * d; let ok = true, foco = null, mf = Infinity;
      for (let k = 0; k < L.length; k += 2) { const d0 = Math.hypot(L[k].cx - x, L[k].cy - y); if (d0 < L[k + 1]) { ok = false; break; } if (d0 < mf) { mf = d0; foco = L[k]; } }
      if (ok) { const c = W.cercaLibre(m, x, y); return { x: (c % m.N) + 0.5, y: ((c / m.N) | 0) + 0.5, foco: foco ? foco.id : 0 }; }
    }
    return null;
  }
  function tickOp(m, ia, J, patio, soldados, sinArma, reserva) {
    const op = ia.op, j = ia.j, b = m.porId.get(op.b);
    if (!b || b.vida <= 0 || b.j === j) { finOp(m, ia, true); return; }
    const defs = defensasFijas(m, ia, b).sort((p, q) => Math.hypot(p.cx - patio.cx, p.cy - patio.cy) - Math.hypot(q.cx - patio.cx, q.cy - patio.cy)), val = valorDe(defs);
    ia.opDefs = new Set(defs.map((e) => e.id)); // la aviación las prefiere
    if (!op.E || m.t - (op.tE || 0) > 240) { op.E = puntoSeguro(m, ia, b, patio) || op.E; op.tE = m.t; } // el punto de reunión: lo más cerca que se puede sin entrar en el alcance de ninguna torre
    let foco = op.E && op.E.foco ? m.porId.get(op.E.foco) : null; if (!foco || foco.vida <= 0) foco = defs[0] || b;
    if (!op.E) { const gx = patio.cx - foco.cx, gy = patio.cy - foco.cy, gd = Math.hypot(gx, gy) || 1, c = W.cercaLibre(m, foco.cx + (gx / gd) * 13, foco.cy + (gy / gd) * 13); op.E = { x: (c % m.N) + 0.5, y: ((c / m.N) | 0) + 0.5, foco: foco.id }; }
    const E = op.E, fx = E.x - foco.cx, fy = E.y - foco.cy, fd = Math.hypot(fx, fy) || 1;
    const sitio = (dd) => { const c = W.cercaLibre(m, foco.cx + (fx / fd) * dd, foco.cy + (fy / fd) * dd); return { x: (c % m.N) + 0.5, y: ((c / m.N) | 0) + 0.5 }; };
    const lejos = (u, p, r) => Math.hypot(u.x - p.x, u.y - p.y) > r;
    // la escolta: buena parte de la reserva acompaña a la artillería y al observador y los cubre desde el punto de reunión
    if (!op.esc) op.esc = new Set();
    for (const id of op.esc) { const u = m.porId.get(id); if (!u || u.vida <= 0) { op.esc.delete(id); op.usa.delete(id); } }
    let obs = op.obs ? m.porId.get(op.obs) : null; // el observador: alguien que vea más lejos de lo que alcanzan sus torres (Delta, explorador o francotirador)
    if (!obs || obs.vida <= 0) { obs = null; if (op.fase !== 'acerca' || op.paso === 'junta') for (const t of ['delta', 'francotirador', 'explorador']) { obs = soldados.find((u) => u.tipo === t && !ia.atacantes.has(u.id) && !ia.capturan.has(u.id)); if (obs) break; } if (obs) { op.obs = obs.id; op.usa.add(obs.id); if (obs.id === ia.explorador) ia.explorador = 0; } else op.sinObs = true; }
    if (obs) op.sinObs = false;
    const dObs = obs ? Math.min(10, UNID[obs.tipo].vision - 0.4) : 9;
    const art = soldados.filter((u) => esIndirecto(u) && !ia.atacantes.has(u.id)); // artillería, lanzacohetes y morteros
    for (const u of art) op.usa.add(u.id);
    const fuego = art.length; let aTiro = 0; for (const u of art) if (!lejos(u, E, 6)) aTiro++;
    const ocioso = (u) => u.orden === 'nada' && !u.obj;
    if (op.fase === 'acerca') { // todos juntos: primero se reúnen en casa; luego marchan en columna, al paso del más lento (sueltos por el camino, los cazan uno a uno)
      if (!op.paso) { op.paso = 'junta'; op.tPaso = m.t; op.A = null; }
      if (!op.A) { const gx = patio.cx - E.x, gy = patio.cy - E.y, gd = Math.hypot(gx, gy) || 1, kk = Math.min(35, gd * 0.6), c = W.cercaLibre(m, E.x + (gx / gd) * kk, E.y + (gy / gd) * kk); op.A = { x: (c % m.N) + 0.5, y: ((c / m.N) | 0) + 0.5 }; }
      const A = op.A;
      if (op.paso === 'junta') {
        // ¿basta la columna? Por el camino le sale al paso el ejército que guarda su base: no marcha hasta tener con qué aguantarlo (va sumando reserva)
        const propio = soldados.reduce((s0, u) => s0 + potU(u), 0), pideE = ejercitoRival(ia, propio) * 0.7 * 1.1;
        let fzC = 0; for (const id of op.esc) fzC += potU(m.porId.get(id)); for (const u of art) fzC += potU(u) * 0.5;
        const frac = fzC >= pideE ? 0.6 : Math.min(1, 0.6 + (m.t - op.tPaso) / 6000);
        const quiere = Math.ceil(frac * (reserva.length + op.esc.size));
        for (const u of reserva) { if (op.esc.size >= quiere) break; if (esIndirecto(u) || UNID[u.tipo].atras) continue; op.esc.add(u.id); op.usa.add(u.id); }
        const todos = art.concat([...op.esc].map((id) => m.porId.get(id))); if (obs) todos.push(obs);
        const ids = todos.filter((u) => ocioso(u) && lejos(u, A, 5)).map((u) => u.id);
        if (ids.length) W.orden(m, { t: 'amover', j, ids, x: A.x, y: A.y });
        let junto = 0; for (const u of todos) if (!lejos(u, A, 9)) junto++;
        if (m.t - op.tPaso > 7200 && fzC < pideE * 0.9 && soldados.length < 34) { finOp(m, ia, false); return; } // no llega a juntar bastante: lo deja (y la reserva vuelve a casa)
        if ((todos.length && junto >= todos.length * 0.75 && (fzC >= pideE || soldados.length >= 34 || m.t - op.tPaso > 7200)) || m.t - op.tPaso > 9600) { W.orden(m, { t: 'amover', j, ids: todos.map((u) => u.id), x: E.x, y: E.y, forma: 'columna', rumbo: Math.atan2(-fy, -fx) }); op.paso = 'marcha'; op.tPaso = m.t; }
      } else {
        const ids = []; for (const id of op.esc) { const u = m.porId.get(id); if (ocioso(u) && lejos(u, E, 4)) ids.push(id); } for (const u of art) if (ocioso(u) && lejos(u, E, 4)) ids.push(u.id); if (obs && ocioso(obs) && lejos(obs, E, 4)) ids.push(obs.id);
        if (ids.length) W.orden(m, { t: 'amover', j, ids, x: E.x, y: E.y });
      }
    } else if (op.fase === 'prep') {
      const ids = []; for (const id of op.esc) { const u = m.porId.get(id); if (ocioso(u) && !u.guardia) ids.push(id); }
      if (ids.length) { const lej = ids.filter((id) => lejos(m.porId.get(id), E, 4)), aqui = ids.filter((id) => !lejos(m.porId.get(id), E, 4)); if (lej.length) W.orden(m, { t: 'amover', j, ids: lej, x: E.x, y: E.y }); if (aqui.length) W.orden(m, { t: 'guardia', j, ids: aqui }); } // en el punto, fijos: que no se vayan detrás de cualquiera hasta sus torres
      if (obs && ocioso(obs)) { const P = sitio(dObs); if (lejos(obs, P, 2)) W.orden(m, { t: 'mover', j, ids: [obs.id], x: P.x, y: P.y }); else if (!obs.guardia) W.orden(m, { t: 'guardia', j, ids: [obs.id] }); } // adelantado y fijo (si no, solo y en inferioridad, se replegaría)
      for (const u of art) if (ocioso(u) && defs.length) { let t = defs[0], md = Infinity; for (const e of defs) { const d0 = Math.hypot(e.cx - u.x, e.cy - u.y); if (d0 < md) { md = d0; t = e; } } W.orden(m, { t: 'atacar', j, ids: [u.id], obj: t.id }); }
    } else { if (obs && ocioso(obs)) { const P = sitio(dObs); if (lejos(obs, P, 2)) W.orden(m, { t: 'mover', j, ids: [obs.id], x: P.x, y: P.y }); else if (!obs.guardia) W.orden(m, { t: 'guardia', j, ids: [obs.id] }); } for (const u of art) if (ocioso(u) && defs.length) W.orden(m, { t: 'atacar', j, ids: [u.id], obj: defs[0].id }); }
    // aislamiento: el comando a la energía que alimenta sus torres; la guerra electrónica, cerca, a cortar radios y enlaces
    for (const u of m.ents) if (!u.edif && u.j === j && u.tipo === 'comando' && u.orden === 'nada' && !(u.recarga > 0) && u.vida > 0) { let t = null, md = 30; for (const e of m.ents) { if (!e.edif || e.j === j || e.vida <= 0 || !(EDIF[e.tipo].energia > 0)) continue; const d0 = Math.hypot(e.cx - b.cx, e.cy - b.cy); if (d0 < md) { md = d0; t = e; } } if (t) W.orden(m, { t: 'carga', j, ids: [u.id], obj: t.id }); }
    for (const u of sinArma) if (u.tipo === 'guerraE' && u.orden === 'nada' && lejos(u, E, 3)) W.orden(m, { t: 'mover', j, ids: [u.id], x: E.x, y: E.y }); // con la escolta: su burbuja cubre el punto de reunión
    const aire = J.cuenta.bombardero || J.cuenta.helicoptero || J.cuenta.avAtaque || J.cuenta.misilera;
    if (op.fase === 'acerca') { // cruzar el mapa lleva minutos: la preparación empieza cuando están en su sitio
      let llegan = 0; for (const id of op.esc) if (!lejos(m.porId.get(id), E, 8)) llegan++;
      if (!fuego && !aire) { op.fase = 'asalto'; op.tFase = m.t; }
      else if ((op.paso === 'marcha' && llegan >= op.esc.size * 0.6 && (aTiro >= fuego * 0.6 || !fuego)) || (op.paso === 'marcha' && m.t - op.tPaso > 6000)) { op.fase = 'prep'; op.tFase = m.t; op.def0 = Math.max(1, val); }
    }
    if (op.fase === 'prep') {
      if (!fuego && !aire && J.nivel >= 2) ia.pideArt = m.t; // sin con qué preparar: que haga artillería
      if (!defs.length || val < op.def0 * 0.45 || m.t - op.tFase > 4800 || (!fuego && !aire && m.t - op.tFase > 1200)) { op.fase = 'asalto'; op.tFase = m.t; }
    }
  }
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
    const energia = m.logistica !== false && J.petroleo < 40 && W.disponible(m, j, EDIF.eolica) ? 'eolica' : 'central'; // sin petróleo que quemar, la central no rinde: eólicas
    const conEnergia = (tipo) => (tipo !== 'central' && tipo !== 'eolica' && J.prod - J.uso + EDIF[tipo].energia < 0 ? energia : tipo);
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
    return J.uso > J.prod ? energia : null;
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
      } else if (tipo === 'torreta' || tipo === 'nidoMG') {
        p = p * 0.5 + Math.hypot(cx - rival.x, cy - rival.y) * 0.4;
      }
      if (p < mp) { mp = p; mejor = { x, y }; }
    }
    return mejor;
  }

  W.iaTick = function (m, ia) {
    if ((m.t + ia.j * 7) % 20 !== 0 || m.ganador >= 0) return;
    const j = ia.j, J = m.jug[j];
    J.esIA = true; // (lo usa la simulación: la IA conserva el alcance antiguo de líneas y depósitos)
    if (!J.vivo) return;
    const E = ESTILOS[ia.estilo];
    if ((m.t + ia.j * 7) % 100 === 60 || !ia.amenaza) iaObserva(m, ia);
    const tk = (m.t + ia.j * 7) / 20; // cuántas veces ha pensado: las reglas que van cada cierto tiempo se cuentan con esto (con m.t, las del jugador 2 no caían nunca en su turno)
    let patio = null, objetivo = null, dObj = Infinity;
    const soldados = [], aviones = [], patios = [], moviles = [], sinArma = [], embos = [];
    for (const e of m.ents) {
      if (e.j === j) {
        if (e.tipo === 'patio') patios.push(e);
        else if (e.tipo === 'patioMovil') moviles.push(e);
        else if (!e.edif && UNID[e.tipo].mini) continue; // los drones pequeños van con su portador
        else if (!e.edif && (e.bunk || e.aBunk || UNID[e.tipo].ambu)) continue; // la guarnición de un búnker se queda en él; las ambulancias van solas
        else if (!e.edif && UNID[e.tipo].aire) aviones.push(e); // la aviación no va con el ejército
        else if (!e.edif && UNID[e.tipo].emboscada) embos.push(e); // los emboscados no van en las oleadas: esperan enterrados en el camino
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
      else if (!c.opEsp && J.nivel >= 2 && m.t > 22000 && J.minerales > 1600 && puede('opEsp')) quiereNuevo = 'opEsp'; // operaciones especiales: de ahí sale el comando
      if (J.acero !== undefined && c.refineria && (c.fundicion || 0) < (m.t > 30000 && J.acero < 150 ? 2 : 1) && (c.fabrica || J.acero < 200) && J.minerales > 900 && puede('fundicion')) quiereNuevo = 'fundicion'; // acero para los tanques: lo primero en cuanto hay fábrica
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
      else if (J.nivel >= 2 && ia.pideArt && m.t - ia.pideArt < 12000 && (c.artilleria || 0) + J.colas.artilleria.n < 4) veh = 'artilleria'; // la última oleada la mataron defensas fijas
      else if (J.nivel >= 3 && !c.guerraE && !J.colas.guerraE.n && soldados.length >= 12) veh = 'guerraE'; // una burbuja de guerra electrónica que acompaña a la oleada
      else if (J.nivel >= 2 && (c.cazacarros || 0) < 1 + Math.floor(((c.tanque || 0) + (c.pesado || 0)) / 4)) veh = 'cazacarros'; // cazacarros, por detrás de los tanques
      else if (J.nivel >= 2 && (c.vci || 0) * 3 < (c.tanque || 0)) veh = 'vci';
      if (J.acero !== undefined && J.acero < (UNID[veh].acero || 0)) veh = 'blindado'; // sin acero para lo pesado: blindados ligeros mientras la fundición trabaja
      // Aviación: cazas, un dron y, con nivel 3, helicópteros y bombarderos; uno a la vez. El estilo aéreo la compra antes que los tanques.
      let av = null;
      if (c.aerodromo && !(J.colas.caza.n + J.colas.bombardero.n + J.colas.helicoptero.n + J.colas.dron.n)) {
        const k = E.aviones, cupo = W.cupoAire(m, j);
        if (cupo.hay < cupo.cupo) av = J.nivel >= 3 && c.opEsp && !(c.avAtaque || 0) ? 'avAtaque' // uno de ataque a tierra, para lo que marquen sus Delta
          : J.nivel >= 3 && (c.helicoptero || 0) < Math.round(2 * k) ? 'helicoptero'
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
      if (c.cuartel && !topeInf && !ahorra && inf === 'infanteria' && m.t > 9000 && !(J.colas.infanteria.n + J.colas.granadero.n + J.colas.medico.n) && dinero >= 1500 + guardaAire && !W.pelNo(m, j, W.PEL.fusileros.de)) { W.orden(m, { t: 'peloton', j, tipo: 'fusileros' }); dinero -= W.pelPrecio(W.PEL.fusileros.de).costo; } // con dinero de sobra, un pelotón de fusileros entero (con su granadero y su médico)
      else if (c.cuartel && !topeInf && !(ahorra && soldados.length >= 6) && J.colas.infanteria.n + J.colas.granadero.n + J.colas.antitanque.n + J.colas.explorador.n + J.colas.ingeniero.n + J.colas.francotirador.n + J.colas.gatling.n + J.colas.mortero.n + J.colas.asalto.n < 2 && dinero >= UNID[inf].costo + guardaAire && W.puedePagar(J, UNID[inf])) { W.orden(m, { t: 'entrenar', j, tipo: inf }); dinero -= UNID[inf].costo; }
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
      const ociosos = aviones.filter((u) => u.enTierra && !u.repostando && !u.patrulla && !UNID[u.tipo].guiaLaser); // (el avión de ataque espera en tierra a que un Delta marque)
      const patrulla = [];
      for (const u of ociosos) { // el dron espía, a dar vueltas sobre la base rival; bombarderos y helicópteros atacan lo que tengan a su alcance de vuelo y ya esté explorado; el resto patrulla
        if (u.tipo === 'dronEspia') { if (u.fuel >= UNID.dronEspia.fuel * 0.9) W.orden(m, { t: 'patrulla', j, ids: [u.id], x: riv.x, y: riv.y }); continue; }
        const d = UNID[u.tipo], casa = m.porId.get(u.casa);
        let blanco = null, mb = Infinity;
        if (casa && (u.tipo === 'bombardero' || u.tipo === 'helicoptero' || u.tipo === 'heliLigero') && u.fuel >= d.fuel * 0.9) {
          for (const e of m.ents) {
            if (e.j === j || e.vida <= 0 || e.infra || (!e.edif && (u.tipo === 'bombardero' || UNID[e.tipo].aire)) || !W.puedeAtacar(u, e)) continue;
            const ex = e.edif ? e.cx : e.x, ey = e.edif ? e.cy : e.y, dd = Math.hypot(ex - casa.cx, ey - casa.cy);
            const pref = ia.opDefs && ia.opDefs.has(e.id) ? 1000 : 0; // (con una operación en marcha, sus defensas primero)
            if (dd < d.radioVuelo - 3 && dd - pref < mb && m.niebla[j][Math.floor(ey) * m.N + Math.floor(ex)] >= (e.edif ? 1 : 2)) { mb = dd; blanco = e; }
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
        if (!c.logistica && (c.motoSum || 0) + J.colas.motoSum.n < 1 && soldados.length >= 5) entrena('motoSum', 300);
        else if (J.nivel < 2 && (c.camioneta || 0) + J.colas.camioneta.n < 2 && soldados.length >= 4) entrena('camioneta', 300); // camionetas artilladas mientras no hay fábrica grande // una moto de suministro mientras no haya puesto logístico
        else if ((c.gatling || 0) + J.colas.gatling.n < 2 && (c.infanteria || 0) >= 8) entrena('gatling', 500);
        else if ((c.hacker || 0) + J.colas.hacker.n < 1 && soldados.length >= 10) entrena('hacker', 500);
        else if (c.estDrones && (c.operador || 0) + J.colas.operador.n < 2 && soldados.length >= 8) entrena('operador', 500);
        else if ((c.mortero || 0) + J.colas.mortero.n < 2 && soldados.length >= 10) entrena('mortero', 600); // fuego indirecto propio, contra trincheras y defensas
        else if ((c.asalto || 0) + J.colas.asalto.n < 2 && soldados.length >= 8) entrena('asalto', 500);
        else if (J.nivel >= 3 && c.opEsp && (c.heliLigero || 0) + J.colas.heliLigero.n < 2 && soldados.length >= 10 && W.cupoAire(m, j, 'opEsp').hay < W.cupoAire(m, j, 'opEsp').cupo) entrena('heliLigero', 800); // helicópteros ligeros de apoyo
        else if (ia.op && ia.op.sinObs && c.opEsp && !J.colas.delta.n) entrena('delta', 400); // un observador para la operación
        else if (ia.op && ia.op.sinObs && J.nivel >= 2 && !c.opEsp && !J.colas.francotirador.n) entrena('francotirador', 300);
        else if (c.opEsp && (c.emboscado || 0) + J.colas.emboscado.n < 2 && soldados.length >= 8) entrena('emboscado', 500); // dos emboscados en el camino del rival
        else if (J.nivel >= 3 && c.opEsp && c.avAtaque && (c.delta || 0) + J.colas.delta.n < 1 && soldados.length >= 8) entrena('delta', 600); // un Delta que marque blancos para su avión de ataque
        else if (J.nivel >= 3 && c.opEsp && (c.comando || 0) + J.colas.comando.n < 1 && soldados.length >= 10) entrena('comando', 800); // un saboteador
        else if ((c.cazadron || 0) + J.colas.cazadron.n < 1 && soldados.length >= 8) entrena('cazadron', 500); // un inhibidor que va con el grueso: los fusiles ya no derriban drones
        else if ((c.manpad || 0) + J.colas.manpad.n < 2 && soldados.length >= 10) entrena('manpad', 600);
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
      for (const u of m.ents) { // el comando: a por el edificio enemigo a la vista que tenga más cerca
        if (u.edif || u.j !== j || u.tipo !== 'comando' || u.orden !== 'nada' || u.recarga > 0 || u.vida <= 0) continue;
        let b = null, md = 60;
        for (const e of m.ents) { if (!e.edif || e.j === j || e.vida <= 0 || e.infra) continue; const d0 = Math.hypot(e.cx - u.x, e.cy - u.y); if (d0 < md && m.niebla[j][Math.floor(e.cy) * m.N + Math.floor(e.cx)] === 2) { md = d0; b = e; } }
        if (b) W.orden(m, { t: 'carga', j, ids: [u.id], obj: b.id });
      }
      const civil = sinArma.find((u) => u.tipo === 'civil');
      if (civil && civil.orden === 'nada' && !civil.auto && tk % 10 === 6) W.orden(m, { t: 'autoCivil', j, ids: [civil.id], on: true });
      // Guarnición: cada búnker con sitio recibe infantería de fusil que esté ociosa cerca y no vaya en la oleada.
      if (c.bunker && tk % 20 === 13) for (const b of m.ents) {
        if (b.j !== j || b.tipo !== 'bunker' || b.vida <= 0) continue;
        let libres = EDIF.bunker.bunker - W.enBunker(m, b); for (const u of m.ents) if (!u.edif && u.aBunk === b.id) libres--;
        if (libres <= 0) continue;
        const ids = soldados.filter((u) => u.tipo === 'infanteria' && u.orden === 'nada' && !ia.atacantes.has(u.id) && u.id !== ia.explorador && !ia.capturan.has(u.id) && !(ia.op && ia.op.usa.has(u.id)) && Math.hypot(u.x - b.cx, u.y - b.cy) < 28).slice(0, libres).map((u) => u.id);
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
      expl = soldados.find((u) => u.tipo === 'explorador' && u.orden === 'nada' && !u.obj) || (m.logistica === false && !J.cuenta.explorador && soldados.find((u) => u.tipo === 'infanteria' && !ia.atacantes.has(u.id) && !(ia.op && ia.op.usa.has(u.id)) && u.orden === 'nada' && !u.obj)); // (con red de radio, un soldado lejos de la base no ve casi nada: explora solo el explorador, que lleva radio propia)
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
          const van = soldados.filter((u) => UNID[u.tipo].cat === 'inf' && u.tipo !== 'explorador' && !ia.atacantes.has(u.id) && !(ia.op && ia.op.usa.has(u.id)) && u.orden === 'nada' && !u.obj).slice(0, 2);
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
      if (na >= 4) for (const u of sinArma) if (u.tipo === 'guerraE' && u.orden === 'nada' && Math.hypot(u.x - tx, u.y - ty) > 6) { const cc = W.cercaLibre(m, tx, ty, true); W.orden(m, { t: 'mover', j, ids: [u.id], x: (cc % m.N) + 0.5, y: ((cc / m.N) | 0) + 0.5 }); } // la guerra electrónica, detrás de la oleada: allí para y despliega
      if (na >= 4) for (const u of sinArma) if (u.tipo === 'tallerMovil' && u.orden === 'nada' && Math.hypot(u.x - tx, u.y - ty) > 12) { const cc = W.cercaLibre(m, tx, ty, true); W.orden(m, { t: 'mover', j, ids: [u.id], x: (cc % m.N) + 0.5, y: ((cc / m.N) | 0) + 0.5 }); } // el taller de campaña, detrás de la oleada: repara y recupera cascos él solo
      if (na >= 4) for (const u of sinArma) if (u.tipo === 'camionSum' && (!u.sumi || Math.hypot(u.sumi.x - tx, u.sumi.y - ty) > 14)) { const cc = W.cercaLibre(m, tx, ty, true); W.orden(m, { t: 'mover', j, ids: [u.id], x: (cc % m.N) + 0.5, y: ((cc / m.N) | 0) + 0.5 }); } // el camión de suministro, detrás de la oleada
      for (const u of sinArma) if (u.tipo === 'operador' && u.sinDron && u.orden === 'nada') { const b = m.ents.find((e) => e.edif && e.j === j && (e.tipo === 'estDrones' || e.tipo === 'logistica') && e.vida > 0); if (b && Math.hypot(u.x - b.cx, u.y - b.cy) > 4) { const cc = W.cercaLibre(m, b.cx, b.cy + b.tam / 2 + 1.5); W.orden(m, { t: 'mover', j, ids: [u.id], x: (cc % m.N) + 0.5, y: ((cc / m.N) | 0) + 0.5 }); } } // el operador sin drones vuelve a reponer
      if (objetivo) for (const u of sinArma) if (u.tipo === 'operador' && !u.sinDron && u.orden === 'nada' && !u.dronMis && Math.hypot(u.x - tx, u.y - ty) <= 8 && Math.hypot(objetivo.cx - u.x, objetivo.cy - u.y) <= UNID.operador.misionDron) W.orden(m, { t: 'dronMision', j, ids: [u.id], x: objetivo.cx, y: objetivo.cy }); // el operador, en su sitio y con el objetivo a tiro: dron en misión sobre él
      for (const u of sinArma) if ((u.tipo === 'hacker' || u.tipo === 'cazadron' || (u.tipo === 'operador' && !u.sinDron)) && u.orden === 'nada' && Math.hypot(u.x - tx, u.y - ty) > 8) { const cc = W.cercaLibre(m, tx, ty); W.orden(m, { t: 'mover', j, ids: [u.id], x: (cc % m.N) + 0.5, y: ((cc / m.N) | 0) + 0.5 }); }
    }
    if (tk % 10 === 7 && embos.length) { // los emboscados, enterrados en el camino del rival, a unas celdas del patio
      const ids = embos.filter((u) => !u.emb && u.orden === 'nada' && !u.herido).map((u) => u.id);
      if (ids.length) { const c0 = W.cercaLibre(m, patio.cx + (dx / dd) * 16, patio.cy + (dy / dd) * 16); W.orden(m, { t: 'vigilar', j, ids, x: (c0 % m.N) + 0.5, y: ((c0 / m.N) | 0) + 0.5, r: 6 }); }
    }
    if (tk % 5 === 3 && J.cuenta.avAtaque) { // el Delta: si ve a su alcance algo que valga la pasada (defensas, blindados, edificios), lo marca para el avión de ataque
      const nie = m.niebla[j], R = UNID.delta.laser;
      for (const u of soldados) {
        if (u.tipo !== 'delta' || u.orden === 'laser' || u.vida <= 0) continue;
        let mejor = null, mv = 0;
        for (const e of m.ents) {
          if (e.j === j || e.j > 1 || e.vida <= 0 || e.infra || e.muro || e.herido) continue; const d = e.edif ? EDIF[e.tipo] : UNID[e.tipo]; if (!d || d.mini || (!e.edif && d.aire)) continue;
          const ex = e.edif ? e.cx : e.x, ey = e.edif ? e.cy : e.y, dd = Math.hypot(ex - u.x, ey - u.y); if (dd > R || nie[Math.floor(ey) * m.N + Math.floor(ex)] !== 2) continue;
          const v = (d.arma ? 2 : 1) * (d.costo || 100) * (e.edif || d.blindaje === 'pesado' ? 1.5 : 0.3); if (v > mv) { mv = v; mejor = e; }
        }
        if (mejor && mv >= 400) W.orden(m, { t: 'laser', j, ids: [u.id], obj: mejor.id });
      }
    }
    if (tk % 5 === 2) { // sin munición lejos de casa: deja la oleada y vuelve a reponer (allí entra otra vez en la reserva)
      const ids = []; for (const u of soldados) if (u.mun === 0 && ia.atacantes.has(u.id)) { ia.atacantes.delete(u.id); if (ia.espera) ia.espera.delete(u.id); ia.reunidos.delete(u.id); ids.push(u.id); }
      if (ids.length) { const cc = W.cercaLibre(m, patio.cx + (dx / dd) * 8, patio.cy + (dy / dd) * 8); W.orden(m, { t: 'mover', j, ids, x: (cc % m.N) + 0.5, y: ((cc / m.N) | 0) + 0.5 }); }
    }
    const reserva = soldados.filter((u) => !(ia.op && ia.op.usa.has(u.id)) && !ia.atacantes.has(u.id) && u.id !== ia.explorador && !ia.capturan.has(u.id) && u.mun !== 0);

    if (J.alerta && m.t - J.alerta.t < 100) { // defensa: acude la reserva ociosa
      const ids = reserva.filter((u) => u.orden === 'nada' && !u.obj).map((u) => u.id);
      if (ids.length) W.orden(m, { t: 'amover', j, ids, x: J.alerta.x, y: J.alerta.y, forma: 'linea' });
    } else {
      const ids = reserva.filter((u) => u.orden === 'nada' && !u.obj && !ia.reunidos.has(u.id)).map((u) => u.id);
      if (ids.length) { W.orden(m, { t: 'amover', j, ids, x: rx, y: ry, rumbo: Math.atan2(dy, dx) }); for (const id of ids) ia.reunidos.add(id); } // esperan encarados al rival
    }
    if (objetivo) {
      // La oleada no entra en goteo: primero se junta en un punto a unas 26 celdas del objetivo (fuera del alcance de sus torres);
      // cuando ha llegado la mayoría —o ha pasado demasiado tiempo— entra toda a la vez, en pinza.
      if (!ia.espera) ia.espera = new Set();
      for (const id of ia.espera) if (!vivos.has(id)) ia.espera.delete(id);
      cierreOla(m, ia, J, soldados);
      let ob = ia.blanco ? m.porId.get(ia.blanco) : null; if (!ob || ob.vida <= 0 || ob.j === j) ob = objetivo; // el blanco de la oleada en curso
      const ox = ob.cx - patio.cx, oy = ob.cy - patio.cy, od = Math.hypot(ox, oy) || 1, lim = (v) => Math.max(4, Math.min(m.N - 4, v));
      if (ia.op && tk % 2 === 0) tickOp(m, ia, J, patio, soldados, sinArma, reserva);
      const esc = ia.op && ia.op.esc ? soldados.filter((u) => ia.op.esc.has(u.id)) : []; // la escolta de la operación: ya está delante, y entra con el asalto
      if (!ia.ola && !ia.espera.size && reserva.length + esc.length >= ia.oleada && tk % 3 === 0) { /* (ia.oleada: el grupo mínimo, según el estilo y el nivel) */ // ¿otra oleada? solo si le salen las cuentas contra algún blanco
        const fz = reserva.reduce((s, u) => s + potU(u), 0) + esc.reduce((s, u) => s + potU(u), 0), propio = soldados.reduce((s, u) => s + potU(u), 0);
        let dec = null, conOp = false;
        if (ia.op) { // operación en marcha: la reserva espera al asalto, y entra cuando las cuentas salen (o el cupo está lleno)
          const b = m.porId.get(ia.op.b);
          if (b && ia.op.fase === 'asalto') {
            const def = defensaEn(m, ia, b.cx, b.cy, ejercitoRival(ia, propio) * 0.7) + ((ia.extra && ia.extra[b.id]) || 0), pide = (def * 1.2 + 300) * E.oleada * Math.max(0.6, 1 - (m.t - ia.op.tFase) / 9600);
            if (fz >= pide || soldados.length >= 34) { dec = { b, def }; conOp = true; ia.op.fase = 'curso'; }
            else if (m.t - ia.op.tFase > 4800) finOp(m, ia, false);
          }
        } else {
          dec = decideAtaque(m, ia, patio, fz, soldados.length, propio, E.oleada);
          const pr = patioRival(m, ia, patio); // ¿nada que tomar con holgura (o ya tarde y no es el patio)? contra su patio fortificado, una operación
          if (pr && soldados.length >= 14 && m.t - (ia.tOpFin || -1e9) > 6000 && (!dec || (m.t > 36000 && dec.b.tipo !== 'patio'))) {
            const L = defensasFijas(m, ia, pr), v = valorDe(L);
            if (v >= 1000) { ia.op = { b: pr.id, fase: 'acerca', t: m.t, tFase: m.t, def0: v, intentos: 0, usa: new Set(), esc: new Set() }; dec = null; for (const u of soldados) if (esIndirecto(u) && ia.atacantes.has(u.id)) { ia.atacantes.delete(u.id); ia.reunidos.delete(u.id); } } // la artillería suelta de oleadas anteriores, a la operación
          }
        }
        if (dec) {
          ob = dec.b; ia.blanco = ob.id; const bx = ob.cx - patio.cx, by = ob.cy - patio.cy, bd = Math.hypot(bx, by) || 1;
          const c = W.cercaLibre(m, lim(ob.cx - (bx / bd) * Math.min(26, bd * 0.5)), lim(ob.cy - (by / bd) * Math.min(26, bd * 0.5))); ia.punto = conOp && ia.op.E ? { x: ia.op.E.x, y: ia.op.E.y } : { x: (c % m.N) + 0.5, y: ((c / m.N) | 0) + 0.5 }; ia.tOla = m.t; ia.tUltOla = m.t;
          if (conOp) for (const u of esc) { ia.op.esc.delete(u.id); ia.op.usa.delete(u.id); }
          const grupo = conOp ? reserva.concat(esc) : reserva;
          W.orden(m, { t: 'amover', j, ids: reserva.map((u) => u.id), x: ia.punto.x, y: ia.punto.y, forma: 'columna' }); // en columna y al paso del más lento: la infantería no se queda atrás, sola
          for (const u of grupo) { ia.atacantes.add(u.id); ia.espera.add(u.id); }
          ia.ola = { b: ob.id, tipo: ob.tipo, ids: grupo.map((u) => u.id), t: m.t, fz, def: dec.def, p0: J.cont.perdido, pa0: Object.assign({}, J.cont.porArma), op: conOp };
          if (conOp) { // el amago: unos pocos y rápidos van antes contra otro edificio, lejos del blanco, para sacar a sus defensores
            let otro = null, md = Infinity; for (const e of m.ents) { if (!e.edif || e.j === j || e.j > 1 || e.vida <= 0 || e.infra || e.muro) continue; const dB = Math.hypot(e.cx - ob.cx, e.cy - ob.cy); if (dB < 15) continue; const d0 = Math.hypot(e.cx - patio.cx, e.cy - patio.cy); if (d0 < md) { md = d0; otro = e; } }
            const fin = otro ? grupo.filter((u) => UNID[u.tipo].vel >= 0.07 && !UNID[u.tipo].atras).sort((p, q) => UNID[q.tipo].vel - UNID[p.tipo].vel).slice(0, 3) : [];
            if (fin.length >= 2) { for (const u of fin) { ia.espera.delete(u.id); } W.orden(m, { t: 'amover', j, ids: fin.map((u) => u.id), x: otro.cx, y: otro.cy, forma: 'columna' }); }
          }
        }
      }
      const oox = ob.cx - patio.cx, ooy = ob.cy - patio.cy, ood = Math.hypot(oox, ooy) || 1;
      if (ia.espera.size && ia.punto) {
        let cerca = 0; const grupo = soldados.filter((u) => ia.espera.has(u.id));
        for (const u of grupo) if (Math.hypot(u.x - ia.punto.x, u.y - ia.punto.y) < 12) cerca++;
        if (cerca >= Math.max(3, grupo.length * 0.7) || m.t - ia.tOla > ood / 0.045 + 1500) { // (el plazo da tiempo a que llegue la infantería a pie desde su base) // ya están: al asalto. La mitad de frente; la otra rodea por un costado (que alterna) y entra por el flanco.
          const frente = grupo.filter((u, i) => i % 2 === 0), flanco = grupo.filter((u, i) => i % 2 === 1);
          if (frente.length) W.orden(m, { t: 'amover', j, ids: frente.map((u) => u.id), x: ob.cx, y: ob.cy, forma: 'linea' });
          if (flanco.length) {
            const c = W.cercaLibre(m, lim(ob.cx - (oox / ood) * 10 - (ooy / ood) * 16 * ia.lado), lim(ob.cy - (ooy / ood) * 10 + (oox / ood) * 16 * ia.lado));
            const ids = flanco.map((u) => u.id);
            W.orden(m, { t: 'amover', j, ids, x: (c % m.N) + 0.5, y: ((c / m.N) | 0) + 0.5, forma: 'columna' });
            W.orden(m, { t: 'amover', j, ids, x: ob.cx, y: ob.cy, enc: true, forma: 'linea' });
            ia.lado = -ia.lado;
          }
          ia.espera.clear();
        } else { // los que se han quedado parados por el camino, al punto
          const ids = grupo.filter((u) => u.orden === 'nada' && !u.obj && Math.hypot(u.x - ia.punto.x, u.y - ia.punto.y) >= 12).map((u) => u.id);
          if (ids.length) W.orden(m, { t: 'amover', j, ids, x: ia.punto.x, y: ia.punto.y });
        }
      }
      // Los que han quedado sueltos de una oleada: si son un puñado, no vuelven a entrar de uno en uno; pasan a la reserva y saldrán con la siguiente.
      const ociosos = soldados.filter((u) => ia.atacantes.has(u.id) && !ia.espera.has(u.id) && u.orden === 'nada' && !u.obj).map((u) => u.id);
      if (ociosos.length >= 4) W.orden(m, { t: 'amover', j, ids: ociosos, x: ob.cx, y: ob.cy, forma: 'linea' });
      else for (const id of ociosos) ia.atacantes.delete(id);
    }
  };
})();
