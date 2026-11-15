// drone.warfare — el mundo y su tick. Entrega 1: el sector, las dos bases con su guarnición de muestra y el reloj
// (día y noche); los drones de reconocimiento dan vueltas. Aún no hay órdenes, detección ni combate.
(function () {
  const D = globalThis.D || (globalThis.D = {});
  const ECON = D.ECON, TAU = Math.PI * 2;

  D.esNoche = (m) => m.t % ECON.dia >= ECON.diaLuz;
  // Cuánta luz hay, de 0 (noche cerrada) a 1 (día): baja durante el anochecer y sube al amanecer.
  D.luz = function (m) {
    const h = m.t % ECON.dia, c = ECON.crepusculo;
    if (h < c * 0.5) return 0.5 + (h / (c * 0.5)) * 0.5; // termina de amanecer
    if (h < ECON.diaLuz - c) return 1;
    if (h < ECON.diaLuz) return (ECON.diaLuz - h) / c; // anochece
    if (h < ECON.dia - c * 0.5) return 0;
    return ((h - (ECON.dia - c * 0.5)) / (c * 0.5)) * 0.5; // empieza a clarear
  };
  D.hora = function (m) { const f = ((m.t % ECON.dia) / ECON.dia) * 24, h = Math.floor(f + 6) % 24, mi = Math.floor((f % 1) * 60); return String(h).padStart(2, '0') + ':' + String(mi).padStart(2, '0'); }; // el día empieza a las 06:00

  function crear(m, clase, j, tipo, x, y, extra) { const e = Object.assign({ id: m.sigId++, clase, j, tipo, x, y, ang: 0, vida: 1 }, extra); m.ents.push(e); m.porId.set(e.id, e); return e; }
  // op.escenario: 'mixto' | 'urbano'. op.noche: empezar de noche.
  D.crearMundo = function (semilla, op) {
    op = op || {};
    const mapa = D.generarMapa(semilla, op.escenario), N = mapa.N, az = D.prng(semilla ^ 0x51ED);
    const m = { semilla, t: op.noche ? ECON.diaLuz : ECON.crepusculo * 0.5, // se empieza con el sol ya arriba (o al caer la noche)
       N, mapa, ents: [], porId: new Map(), sigId: 1, jug: [{ personas: 0, pilotos: 0 }, { personas: 0, pilotos: 0 }] };
    const libre = (x, y) => { x = Math.floor(x); y = Math.floor(y); return x >= 0 && y >= 0 && x < N && y < N && mapa.paso[y * N + x] === 1; };
    const cerca = (x, y) => { for (let r = 0; r < 9; r++) for (let k = 0; k < 16; k++) { const a = (k / 16) * TAU + r, X = x + Math.cos(a) * r, Y = y + Math.sin(a) * r; if (libre(X, Y)) return { x: Math.floor(X) + 0.5, y: Math.floor(Y) + 0.5 }; } return { x: x + 0.5, y: y + 0.5 }; };
    let eq = 1;
    const equipo = (j, roles, x, y, ang) => { roles.forEach((r, i) => { const d = (i - (roles.length - 1) / 2) * 1.3, p = cerca(x + Math.cos(ang + 1.57) * d + (az() - 0.5) * 0.5, y + Math.sin(ang + 1.57) * d + (az() - 0.5) * 0.5); crear(m, 'sol', j, r, p.x, p.y, { ang: ang + (az() - 0.5) * 0.5, eq }); m.jug[j].personas++; }); eq++; };
    const edif = (j, t, p) => p && crear(m, 'edif', j, t, p.x + 0.5, p.y + 0.5);
    const pilotos = (j, n) => { m.jug[j].pilotos = n; m.jug[j].personas += n; }; // están dentro: cuentan, pero no se ven
    const posado = (j, t, p, i, ang) => crear(m, 'dron', j, t, p.x + 2.4 + (i % 3) * 1.5, p.y + 0.5 + (Math.floor(i / 3) - 0.5) * 1.6, { alt: 0, ang }); // en fila junto a la plataforma
    const orbita = (j, t, x, y, r) => crear(m, 'dron', j, t, x, y, { alt: D.DRON[t].alt, orbita: { x, y, r, fase: az() * TAU } });

    // El atacante: cuatro equipos de fuerzas especiales y solo dos pilotos.
    { const b = mapa.bases[0], f = b.frente, lado = f + Math.PI / 2;
      edif(0, 'barracon', b.barracon); edif(0, 'taller', b.taller); edif(0, 'antena', b.antenas[0]);
      equipo(0, ['asaltante', 'asaltante', 'escopetero', 'zapador'], b.x + Math.cos(f) * 5 + Math.cos(lado) * 4, b.y + Math.sin(f) * 5 + Math.sin(lado) * 4, f);
      equipo(0, ['asaltante', 'asaltante', 'escopetero', 'observador'], b.x + Math.cos(f) * 5 - Math.cos(lado) * 4, b.y + Math.sin(f) * 5 - Math.sin(lado) * 4, f);
      equipo(0, ['asaltante', 'escopetero', 'inhibidor', 'sanitario'], b.x + Math.cos(f) * 9, b.y + Math.sin(f) * 9, f);
      equipo(0, ['tirador', 'observador'], b.x + Math.cos(f) * 13 + Math.cos(lado) * 6, b.y + Math.sin(f) * 13 + Math.sin(lado) * 6, f);
      pilotos(0, 2); orbita(0, 'recon', b.x + Math.cos(f) * 16, b.y + Math.sin(f) * 16, 9); posado(0, 'fpvRadio', b.taller, 0, f); posado(0, 'fpvFibra', b.taller, 1, f); }
    // El defensor: el centro con seis pilotos, dos antenas y una falsa, la estación de escucha, y una guardia de dos equipos.
    { const b = mapa.bases[1], f = b.frente;
      edif(1, 'centro', b.centro); edif(1, 'taller', b.taller); edif(1, 'barracon', b.barracon); for (const a of b.antenas) edif(1, 'antena', a); edif(1, 'falsa', b.falsa); edif(1, 'escucha', b.escucha);
      equipo(1, ['asaltante', 'asaltante', 'escopetero', 'sanitario'], b.x + Math.cos(f) * 5, b.y + Math.sin(f) * 5, f);
      equipo(1, ['asaltante', 'escopetero', 'tirador', 'inhibidor'], b.x - Math.cos(f) * 4, b.y - Math.sin(f) * 4, f);
      pilotos(1, 6); orbita(1, 'recon', b.x + Math.cos(f) * 12, b.y + Math.sin(f) * 12, 11); orbita(1, 'recon', b.x + Math.cos(f) * 30, b.y + Math.sin(f) * 30, 13);
      ['fpvRadio', 'fpvRadio', 'fpvFibra', 'bombardero', 'interceptor'].forEach((t, i) => posado(1, t, b.taller, i, f)); }
    D.tick(m); m.t--; // coloca lo que se mueve en su sitio desde el primer cuadro
    return m;
  };

  D.tick = function (m) {
    m.t++;
    for (const e of m.ents) if (e.orbita) { const o = e.orbita, a = o.fase + m.t * 0.004; e.x = o.x + Math.cos(a) * o.r; e.y = o.y + Math.sin(a) * o.r * 0.7; e.ang = Math.atan2(Math.cos(a) * 0.7, -Math.sin(a)); }
  };
})();
