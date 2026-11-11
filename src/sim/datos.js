// rts.warfare — tablas de datos y utilidades base. Enriquecer el juego = editar estas tablas.
(function () {
  const W = globalThis.W || (globalThis.W = {});

  // PRNG determinista (mulberry32)
  W.prng = function (semilla) {
    let a = semilla >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  W.N = 512; // lado del mapa en celdas (la cantidad de recursos se escala sola)
  W.TPS = 20; // ticks de simulación por segundo
  W.TERRENO = { LLANO: 0, ROCA: 1, AGUA: 2, BOSQUE: 3 };

  // nivel: nivel tecnológico mínimo (1 si no se indica). raros / info: costo en esos recursos.
  // energia > 0 produce, < 0 consume. tiempo en ticks. costo en minerales; pet = petróleo.
  // agua: cuánta agua aporta. Edificios de extracción (libre: true): no necesitan estar junto a la base,
  // pero sí sobre su recurso (sobre: tipo de sitio; juntoA: 'agua') y en terreno ya explorado.
  // da: recurso que producen solos y cada cuántos ticks dan una unidad.
  W.EDIF = {
    patio:     { nombre: 'Patio',     tam: 3, vida: 2000, costo: 0,    tiempo: 0,   energia: 0,   vision: 8, req: [], agua: 8 },
    central:   { nombre: 'Central',   tam: 2, vida: 500,  costo: 300,  tiempo: 200, energia: 100, vision: 5, req: ['patio'] },
    refineria: { nombre: 'Refinería', tam: 3, vida: 900,  costo: 1200, tiempo: 400, energia: -30, vision: 6, req: ['central'] },
    bomba:     { nombre: 'Bomba de agua', tam: 2, vida: 450, costo: 400, tiempo: 240, energia: -15, vision: 5, req: ['central'], agua: 12, juntoA: 'agua', libre: true },
    cuartel:   { nombre: 'Cuartel',   tam: 2, vida: 700,  costo: 400,  tiempo: 300, energia: -20, vision: 5, req: ['central'] },
    extractor: { nombre: 'Extractor', tam: 2, vida: 600,  costo: 700,  tiempo: 300, energia: -20, vision: 5, req: ['refineria'], sobre: 'petroleo', libre: true, da: { rec: 'petroleo', cada: 6 } },
    fabrica:   { nombre: 'Fábrica',   tam: 3, vida: 1000, costo: 1400, pet: 100, tiempo: 500, energia: -40, vision: 5, req: ['refineria'] },
    torreta:   { nombre: 'Torreta',   tam: 1, vida: 600,  costo: 500,  tiempo: 300, energia: -25, vision: 8, req: ['cuartel'], arma: 'bateria', giroT: 0.2 },
    torreCanon: { nombre: 'Torre de cañón', tam: 2, vida: 1100, costo: 1200, pet: 60, tiempo: 500, energia: -40, vision: 9, req: ['fabrica'], arma: 'canonTorre', nivel: 2, giroT: 0.1 },
    aerodromo: { nombre: 'Aeródromo', tam: 3, vida: 900,  costo: 1600, pet: 150, tiempo: 500, energia: -40, vision: 6, req: ['fabrica'], nivel: 2 },
    antiaerea: { nombre: 'Antiaérea', tam: 1, vida: 500,  costo: 600,  tiempo: 300, energia: -20, vision: 9, req: ['cuartel'], arma: 'flak', nivel: 2, giroT: 0.28 },
    estacion:  { nombre: 'Estación',  tam: 2, vida: 500,  costo: 900,  tiempo: 400, energia: -30, vision: 7, req: ['cuartel'], sobre: 'conocimiento', libre: true, da: { rec: 'info', cada: 20 } },
  };

  // Frente: una unidad dispara solo hacia donde apunta. giroT: tiene torreta y gira así de rápido (rad por tick) sin mover el casco;
  // sin giroT gira el cuerpo entero. arco: cuánto puede desviarse el tiro del frente (por defecto ECON.arco).
  // La visión sigue, simplificado, el campo visual humano: una zona central (±60°, donde se ve con los dos ojos) que llega
  // más lejos (ECON.visAd); una periferia hasta ±105° (ECON.periferia), que es donde acaba el campo de cada ojo, con menos
  // alcance (visLado); y detrás, donde no se ve y solo se oye lo muy cercano (visAt). Los vehículos sufren más por costados y espalda.
  // vel en celdas por tick. cat: cola de producción (inf = cuartel, veh = fábrica).
  // giro: radianes por tick que puede girar; acel: cuánto gana de velocidad por tick.
  // agua: cuánta agua consume mientras vive (el agua es un balance, como la energía, y limita la tropa).
  W.UNID = {
    infanteria:  { nombre: 'Infantería',  cat: 'inf', vida: 60,  vel: 0.06, costo: 100, tiempo: 100, blindaje: 'ligero', arma: 'fusil', vision: 6, radio: 0.24, req: ['cuartel'], agua: 1, giro: 0.5, acel: 0.02, arco: 0.5 },
    tanque:      { nombre: 'Tanque',      cat: 'veh', vida: 300, vel: 0.10, costo: 600, pet: 50, tiempo: 300, blindaje: 'pesado', arma: 'canon', vision: 7, radio: 0.40, req: ['fabrica'], agua: 2, giro: 0.13, acel: 0.006, giroT: 0.16 },
    antitanque:  { nombre: 'Antitanque',  cat: 'inf', vida: 70,  vel: 0.055, costo: 250, tiempo: 160, blindaje: 'ligero', arma: 'cohete', vision: 6, radio: 0.25, req: ['cuartel'], agua: 1, giro: 0.5, acel: 0.02, nivel: 2, arco: 0.35 },
    artilleria:  { nombre: 'Artillería',  cat: 'veh', vida: 180, vel: 0.06, costo: 900, pet: 70, tiempo: 400, blindaje: 'pesado', arma: 'obus', vision: 7, radio: 0.42, req: ['fabrica'], agua: 2, giro: 0.08, acel: 0.004, nivel: 2 },
    pesado:      { nombre: 'Tanque pesado', cat: 'veh', vida: 700, vel: 0.07, costo: 1500, pet: 120, raros: 60, tiempo: 520, blindaje: 'pesado', arma: 'canonPesado', vision: 7, radio: 0.52, req: ['fabrica'], agua: 3, giro: 0.08, acel: 0.004, nivel: 3, giroT: 0.1 },
    // Aviación (cat 'aire', sale del aeródromo): vuela sobre cualquier terreno y en línea recta. fuel: ticks de vuelo;
    // Cada avión tiene su aeródromo (ECON.cupoAviones por aeródromo): sale de él, no se aleja más de radioVuelo celdas y
    // vuelve a aterrizar al acabar su orden o cuando le queda el combustible justo. En tierra reposta y no se le puede atacar
    // (cae con su aeródromo). En patrulla, tras repostar despega y la retoma. Sin combustible ni base, cae.
    caza:        { nombre: 'Caza',        cat: 'aire', aire: true, vida: 160, vel: 0.22, costo: 900, pet: 120, tiempo: 360, blindaje: 'aire', arma: 'misil', vision: 9, radio: 0.42, req: ['aerodromo'], agua: 1, giro: 0.16, acel: 0.012, nivel: 2, fuel: 1800, arco: 0.3, radioVuelo: 70 },
    bombardero:  { nombre: 'Bombardero',  cat: 'aire', aire: true, vida: 260, vel: 0.15, costo: 1600, pet: 200, raros: 40, tiempo: 520, blindaje: 'aire', arma: 'bomba', vision: 8, radio: 0.55, req: ['aerodromo'], agua: 2, giro: 0.09, acel: 0.008, nivel: 3, fuel: 2400, radioVuelo: 90 },
    cosechadora: { nombre: 'Cosechadora', cat: 'veh', vida: 450, vel: 0.07, costo: 900, pet: 30, tiempo: 360, blindaje: 'pesado', arma: null,    vision: 5, radio: 0.44, req: ['fabrica', 'refineria'], carga: 500, agua: 1, giro: 0.1, acel: 0.004 },
  };

  // Tabla de daño: arma contra blindaje. vuelo: celdas por tick del proyectil (sin vuelo, impacta al instante).
  // vs.aire: daño contra aviones; un arma sin vs.aire no puede dispararles (y una sin vs de tierra, solo a aviones).
  // alcanceMin: no puede disparar más cerca que eso. area: radio de la explosión (daña a todo enemigo dentro).
  W.ARMAS = {
    fusil:   { alcance: 4,   dano: 8,  recarga: 16, vs: { ligero: 1,   pesado: 0.25, edificio: 0.3, aire: 0.4 } },
    canon:   { alcance: 5,   dano: 40, recarga: 50, vuelo: 0.9, vs: { ligero: 0.4, pesado: 1,    edificio: 0.9 } },
    cohete:  { alcance: 5,   dano: 45, recarga: 60, vuelo: 0.6, vs: { ligero: 0.3, pesado: 1.2,  edificio: 0.7, aire: 1.1 } },
    obus:    { alcance: 11,  alcanceMin: 3, area: 1.4, dano: 70, recarga: 110, vuelo: 0.45, vs: { ligero: 1, pesado: 0.7, edificio: 1.3 } },
    canonPesado: { alcance: 6, dano: 90, recarga: 60, vuelo: 0.9, vs: { ligero: 0.5, pesado: 1.1, edificio: 1.1 } },
    canonTorre:  { alcance: 8, dano: 75, recarga: 60, vuelo: 1.0, vs: { ligero: 0.5, pesado: 1.2, edificio: 0.6 } },
    bateria: { alcance: 6.5, dano: 30, recarga: 30, vuelo: 1.1, vs: { ligero: 0.8, pesado: 1,    edificio: 0.5, aire: 0.8 } },
    flak:    { alcance: 9,   dano: 34, recarga: 22, vuelo: 1.3, vs: { aire: 1 } },
    misil:   { alcance: 6,   dano: 40, recarga: 45, vuelo: 1.0, vs: { ligero: 0.6, pesado: 0.6, edificio: 0.3, aire: 1.3 } },
    bomba:   { omni: true, alcance: 1.6, area: 1.7, dano: 150, recarga: 90, vuelo: 0.12, vs: { ligero: 1, pesado: 1, edificio: 1.4 } },
  };

  // Tecnología. lugar: edificio donde se investiga (uno a la vez por tipo de edificio). nivel: nivel mínimo.
  // sube: nivel que otorga. Los efectos de cada mejora están en mundo.js (buscar "mejoras.").
  W.TEC = {
    nivel2:     { nombre: 'Nivel 2 · Mecanizado', lugar: 'patio', costo: 1500, info: 150, tiempo: 1200, nivel: 1, sube: 2, que: 'Antitanque, artillería, torre de cañón, más mejoras y el barrido.' },
    nivel3:     { nombre: 'Nivel 3 · Avanzado', lugar: 'patio', costo: 3000, info: 400, raros: 200, tiempo: 1800, nivel: 2, sube: 3, que: 'Tanque pesado, las últimas mejoras, interceptar y cartografía.' },
    perforante: { nombre: 'Munición perforante', lugar: 'cuartel', info: 60, tiempo: 600, nivel: 1, que: '+25 % de daño de la infantería.' },
    chalecos:   { nombre: 'Chalecos', lugar: 'cuartel', info: 120, tiempo: 700, nivel: 2, que: '+30 % de vida de la infantería.' },
    motores:    { nombre: 'Motores', lugar: 'fabrica', info: 80, tiempo: 600, nivel: 1, que: '+15 % de velocidad de los vehículos.' },
    reactivo:   { nombre: 'Blindaje reactivo', lugar: 'fabrica', info: 150, tiempo: 800, nivel: 2, que: '+25 % de vida de los vehículos.' },
    canonLargo: { nombre: 'Cañón largo', lugar: 'fabrica', info: 200, raros: 80, tiempo: 900, nivel: 3, que: '+1 de alcance de los vehículos armados.' },
    tolva:      { nombre: 'Tolva ampliada', lugar: 'refineria', info: 60, tiempo: 500, nivel: 1, que: '+50 % de carga de las cosechadoras.' },
    turbinas:   { nombre: 'Turbinas', lugar: 'central', info: 120, tiempo: 700, nivel: 2, que: '+50 % de energía por central.' },
    depuracion: { nombre: 'Depuración', lugar: 'bomba', info: 100, tiempo: 600, nivel: 2, que: '+50 % de agua por bomba.' },
    telemetro:  { nombre: 'Telémetro', lugar: 'torreta', info: 120, tiempo: 700, nivel: 2, que: '+1,5 de alcance de torretas y torres.' },
    analisis:   { nombre: 'Análisis', lugar: 'estacion', info: 250, raros: 60, tiempo: 900, nivel: 3, que: '+50 % de información por estación.' },
  };
  // Inteligencia: gastos puntuales de información, con una estación en pie.
  W.INTEL = {
    barrido:     { nombre: 'Barrido', info: 30, nivel: 2, radio: 16, dura: 400, que: 'Revela una zona del mapa durante 20 segundos.' },
    interceptar: { nombre: 'Interceptar', info: 60, nivel: 3, dura: 1200, que: 'Durante un minuto ves los recursos del rival y qué produce.' },
    cartografia: { nombre: 'Cartografía', info: 200, nivel: 3, que: 'Revela el terreno de todo el mapa.' },
  };

  W.ECON = { inicio: 2500, petInicio: 150, cosecha: 5, descarga: 25, colaMax: 9, separacionColocar: 3, goteoCada: 5, vistaInicial: 22, obrasMax: 8, curaUnidad: 0.01, curaEdificio: 0.0025, curaCosto: 0.15, venta: 0.5, trinchera: 0.45, arco: 0.14, arcoTrinchera: 1.05, visAd: 1.3, visLado: 0.75, visAt: 0.3, cono: 1.05, periferia: 1.83, flanco: 1.25, espalda: 1.5, bosqueVeh: 0.6, bosqueCubre: 0.7, reposta: 12, cupoAviones: 5, orbita: 3.5, fuelCae: 80, cavar: 80, aplasta: 10, bonoProd: 0.5, bonoMax: 2.5 };
})();
