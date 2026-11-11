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
    torreta:   { nombre: 'Torreta',   tam: 1, vida: 600,  costo: 500,  tiempo: 300, energia: -25, vision: 8, req: ['cuartel'], arma: 'bateria' },
    estacion:  { nombre: 'Estación',  tam: 2, vida: 500,  costo: 900,  tiempo: 400, energia: -30, vision: 7, req: ['cuartel'], sobre: 'conocimiento', libre: true, da: { rec: 'info', cada: 20 } },
  };

  // vel en celdas por tick. cat: cola de producción (inf = cuartel, veh = fábrica).
  // agua: cuánta agua consume mientras vive (el agua es un balance, como la energía, y limita la tropa).
  W.UNID = {
    infanteria:  { nombre: 'Infantería',  cat: 'inf', vida: 60,  vel: 0.06, costo: 100, tiempo: 100, blindaje: 'ligero', arma: 'fusil', vision: 6, radio: 0.24, req: ['cuartel'], agua: 1 },
    tanque:      { nombre: 'Tanque',      cat: 'veh', vida: 300, vel: 0.10, costo: 600, pet: 50, tiempo: 300, blindaje: 'pesado', arma: 'canon', vision: 7, radio: 0.40, req: ['fabrica'], agua: 2 },
    cosechadora: { nombre: 'Cosechadora', cat: 'veh', vida: 450, vel: 0.07, costo: 900, pet: 30, tiempo: 360, blindaje: 'pesado', arma: null,    vision: 5, radio: 0.44, req: ['fabrica', 'refineria'], carga: 500, agua: 1 },
  };

  // Tabla de daño: arma contra blindaje.
  W.ARMAS = {
    fusil:   { alcance: 4,   dano: 8,  recarga: 16, vs: { ligero: 1,   pesado: 0.25, edificio: 0.3 } },
    canon:   { alcance: 5,   dano: 40, recarga: 50, vs: { ligero: 0.4, pesado: 1,    edificio: 0.9 } },
    bateria: { alcance: 6.5, dano: 30, recarga: 30, vs: { ligero: 0.8, pesado: 1,    edificio: 0.5 } },
  };

  W.ECON = { inicio: 2500, petInicio: 150, cosecha: 5, descarga: 25, colaMax: 9, separacionColocar: 3, goteoCada: 5, obrasMax: 8, bonoProd: 0.5, bonoMax: 2.5 };
})();
