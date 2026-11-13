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
  W.TERRENO = { LLANO: 0, ROCA: 1, AGUA: 2, BOSQUE: 3, CAMINO: 4, PUENTE: 5 }; // el bosque solo lo cruza la infantería; el camino lo abre la excavadora

  // nivel: nivel tecnológico mínimo (1 si no se indica). raros / info: costo en esos recursos.
  // energia > 0 produce, < 0 consume. tiempo en ticks. costo en minerales; pet = petróleo.
  // agua: cuánta agua aporta. Edificios de extracción (libre: true): no necesitan estar junto a la base,
  // pero sí sobre su recurso (sobre: tipo de sitio; juntoA: 'agua') y en terreno ya explorado.
  // da: recurso que producen solos y cada cuántos ticks dan una unidad.
  W.EDIF = {
    patio:     { nombre: 'Patio',     tam: 3, vida: 2000, costo: 0,    tiempo: 0,   energia: 0,   vision: 8, req: [], agua: 8, guarda: { min: 3000, pet: 500 }, radioCom: 60 },
    central:   { nombre: 'Central térmica', tam: 2, vida: 500,  costo: 300,  tiempo: 200, energia: 100, vision: 5, req: ['patio'], mejora: true, quema: true }, // quema petróleo; sin él da el 30 %
    // Energía sin petróleo: la eólica da poco y es barata; la hidroeléctrica da mucho, pero solo va junto al agua.
    eolica:    { nombre: 'Eólica', tam: 1, vida: 250, costo: 200, tiempo: 140, energia: 25, vision: 4, req: ['patio'] },
    hidro:     { nombre: 'Hidroeléctrica', tam: 2, vida: 700, costo: 1000, tiempo: 400, energia: 160, vision: 5, req: ['central'], nivel: 2, juntoA: 'agua', libre: true },
    refineria: { nombre: 'Refinería', tam: 3, vida: 900,  costo: 1200, tiempo: 400, energia: -30, vision: 6, req: ['central'] },
    bomba:     { nombre: 'Bomba de agua', tam: 2, vida: 450, costo: 400, tiempo: 240, energia: -15, vision: 5, req: ['central'], agua: 12, juntoA: 'agua', libre: true, mejora: true },
    cuartel:   { nombre: 'Cuartel',   tam: 2, vida: 700,  costo: 400,  tiempo: 300, energia: -20, vision: 5, req: ['central'] },
    extractor: { nombre: 'Extractor', tam: 2, vida: 600,  costo: 700,  tiempo: 300, energia: -20, vision: 5, req: ['refineria'], sobre: 'petroleo', libre: true, da: { rec: 'petroleo', cada: 6 }, mejora: true },
    fabrica:   { nombre: 'Fábrica',   tam: 3, vida: 1000, costo: 1400, pet: 100, tiempo: 500, energia: -40, vision: 5, req: ['refineria'] },
    torreta:   { nombre: 'Torreta',   tam: 1, vida: 600,  costo: 350,  tiempo: 300, energia: -25, vision: 8, req: ['cuartel'], arma: 'bateria', giroT: 0.2 },
    torreCanon: { nombre: 'Torre de cañón', tam: 2, vida: 1100, costo: 900, pet: 60, tiempo: 500, energia: -40, vision: 9, req: ['fabrica'], arma: 'canonTorre', nivel: 2, giroT: 0.1 },
    aerodromo: { nombre: 'Aeródromo', tam: 3, vida: 900,  costo: 1600, pet: 150, tiempo: 500, energia: -40, vision: 6, req: ['fabrica'], nivel: 2 },
    antiaerea: { nombre: 'Antiaérea', tam: 1, vida: 500,  costo: 450,  tiempo: 300, energia: -20, vision: 9, req: ['cuartel'], arma: 'flak', nivel: 2, giroT: 0.28 },
    estacion:  { nombre: 'Estación',  tam: 2, vida: 500,  costo: 900,  tiempo: 400, energia: -30, vision: 7, req: ['cuartel'], sobre: 'conocimiento', libre: true, da: { rec: 'info', cada: 20 }, mejora: true },
    // Obras civiles: produce las unidades civiles (el ingeniero civil, que conecta edificios con líneas de servicio, y la excavadora).
    obras:     { nombre: 'Obras civiles', tam: 2, vida: 600, costo: 500, tiempo: 240, energia: -15, vision: 5, req: ['central'] },
    // Misilera: fabrica y guarda hasta diez misiles balísticos (W.MISILES) y los lanza a un punto explorado dentro de su alcance.
    misilera:  { nombre: 'Misilera', tam: 3, vida: 1000, costo: 2500, pet: 200, tiempo: 600, energia: -50, vision: 6, req: ['fabrica'], nivel: 2, misiles: true },
    // Interceptor: derriba los misiles enemigos que entran en su radio. Tiene pocas cargas y tarda en reponerlas.
    interceptor: { nombre: 'Interceptor', tam: 2, vida: 700, costo: 1500, pet: 100, tiempo: 500, energia: -40, vision: 7, req: ['fabrica'], nivel: 2, intercepta: 14, cargas: 4, reponeCarga: 600 },
    // Laboratorio: da información sin depender de los campos de conocimiento (a la mitad de ritmo que una estación sobre su campo). Vale como estación para lo que la pida.
    // Central de inteligencia: entrena espías, aloja hasta dos drones espía de largo alcance y permite el mapeo satelital.
    inteligencia: { nombre: 'Central de inteligencia', tam: 2, vida: 600, costo: 1400, tiempo: 400, energia: -40, vision: 7, req: ['estacion'], nivel: 2, hangar: 2 },
    laboratorio: { nombre: 'Laboratorio', tam: 2, vida: 500, costo: 700, tiempo: 320, energia: -30, vision: 5, req: ['cuartel'], da: { rec: 'info', cada: 40 }, mejora: true },
    // Puente aéreo. Puesto logístico: en la base; de él salen los helicópteros de carga. Puesto de avanzada: no se construye, lo despliega el puesto móvil
    // donde haga falta; mientras le llegue carga está en tu red (cobertura para suministro y para construir), cura a la infantería cercana y tiene pista.
    logistica: { nombre: 'Puesto logístico', tam: 2, vida: 700, costo: 900, tiempo: 300, energia: -20, vision: 6, req: ['fabrica'], pista: true, hangar: 2 }, // (aloja hasta dos helicópteros de suministro)
    avanzada:  { nombre: 'Puesto de avanzada', tam: 2, vida: 800, costo: 0, tiempo: 1, energia: 0, vision: 8, req: ['logistica'], pista: true, hospital: 5, oculto: true, radioCom: 35 },
    // Estación de drones: barata; mantiene dos drones de reconocimiento dando vueltas a su alrededor.
    estDrones: { nombre: 'Estación de drones', tam: 1, vida: 350, costo: 300, tiempo: 160, energia: -10, vision: 5, req: ['cuartel'], drones: { rec: 2 }, radioDron: 16, mejora: true, dronesN: { 2: { rec: 2, bomba: 1, radio: 18 }, 3: { rec: 3, bomba: 2, fpv: 2, radio: 20 } } }, // mejorada lleva más drones, y de ataque
    // Torreta de muro: solo se monta sobre un muro reforzado propio (y ahí puede ir fuera de la cobertura). Cámara: ve lejos y en redondo, descubre a los escondidos y avisa; en la cobertura o sobre un muro propio.
    camara:    { nombre: 'Cámara', tam: 1, vida: 150, costo: 150, tiempo: 100, energia: -5, vision: 11, req: ['obras'], detecta: 11, enMuro: true, datos: true },
    // Depósito: nodo de la red. Conectado por camino (o por cercanía) a un patio, extiende la cobertura: suministro, energía y dónde se puede construir.
    // Pista avanzada: va en cualquier terreno explorado, sin red ni energía. Los helicópteros de combate pueden tomarla por base: repostan en ella y su radio de vuelo se cuenta desde allí.
    pistaAv:   { nombre: 'Pista avanzada', tam: 2, vida: 400, costo: 600, pet: 40, tiempo: 240, energia: 0, vision: 6, req: ['aerodromo'], nivel: 2, libre: true, hangar: 2, helipuerto: true },
    // Almacenes: los minerales y el petróleo se guardan en edificios. Lo que entra con todo lleno se pierde; si destruyen uno, se pierde su parte y la mitad queda en el suelo como botín.
    almacen:   { nombre: 'Almacén', tam: 2, vida: 700, costo: 500, tiempo: 200, energia: -5, vision: 4, req: ['refineria'], guarda: { min: 3000, pet: 0 } },
    tanqueComb: { nombre: 'Tanque de combustible', tam: 2, vida: 450, costo: 400, tiempo: 200, energia: -5, vision: 4, req: ['refineria'], guarda: { min: 0, pet: 800 } },
    // Torre de radio: va en cualquier terreno explorado, con su propio generador. Dentro de la cobertura de radio se ve lo que ven las unidades y las órdenes llegan al instante.
    torreRadio: { nombre: 'Torre de radio', tam: 1, vida: 300, costo: 300, tiempo: 160, energia: 0, vision: 6, req: ['cuartel'], libre: true, radioCom: 60 },
    // Enlace de datos (datos: true): cámara, torre de vigilancia y artillería fija solo te sirven si están unidas a tu red por cable o dentro de tu cobertura
    // de radio. Sin enlace siguen en pie, pero no te dan visión ni descubren a nadie, y la artillería solo tira a lo que ve ella misma.
    // Defensas baratas. Búnker: hasta 4 de infantería entran (clic derecho sobre él) y disparan desde dentro recibiendo la cuarta parte del daño.
    // Torre de vigilancia: sin armas, ve muy lejos y descubre a los escondidos. Artillería fija: mucho alcance, no dispara a lo que tiene encima.
    bunker:    { nombre: 'Búnker', tam: 1, vida: 900, costo: 250, tiempo: 200, energia: 0, vision: 7, req: ['cuartel'], bunker: 4 },
    vigia:     { nombre: 'Torre de vigilancia', tam: 1, vida: 250, costo: 150, tiempo: 120, energia: 0, vision: 16, req: ['cuartel'], libre: true, detecta: 8, datos: true },
    artFija:   { nombre: 'Artillería fija', tam: 2, vida: 700, costo: 1000, pet: 50, tiempo: 450, energia: -30, vision: 8, req: ['fabrica'], arma: 'obusFijo', nivel: 2, giroT: 0.06, datos: true },
    // Hospital: cura a la infantería que tenga a 6 celdas y aloja hasta 3 ambulancias (llega con una). Las ambulancias salen solas a curar a los heridos
    // que haya a 30 celdas de su puesto (el hospital, o el punto adonde las mandes), y vuelven a recargar cuando se les acaba el material.
    hospital:  { nombre: 'Hospital', tam: 2, vida: 700, costo: 600, tiempo: 300, energia: -20, vision: 6, req: ['cuartel'], cura: 6, ambulancias: 3, radioAmb: 30 },
    radar:     { nombre: 'Radar', tam: 2, vida: 400, costo: 700, tiempo: 300, energia: -40, vision: 6, req: ['fabrica'], nivel: 2, radar: 60 }, // no levanta la niebla: marca con un punto lo que se mueve dentro de su alcance
    // Mina: se construye sobre un yacimiento de minerales y saca de un pozo profundo, de forma continua y sin cosechadoras. Hay que conectarla a la red.
    mina:      { nombre: 'Mina', tam: 2, vida: 800, costo: 1200, tiempo: 400, energia: -30, vision: 5, req: ['refineria'], nivel: 2, sobreMineral: true, libre: true, da: { rec: 'minerales', cada: 3 }, mejora: true },
    deposito:  { nombre: 'Depósito',  tam: 1, vida: 450,  costo: 500,  tiempo: 240, energia: -10, vision: 6, req: ['cuartel'], libre: true },
    // Infraestructura: cada tramo de camino. No se construye desde el patio (lo deja la excavadora), no ocupa celdas y no se ataca solo: hay que ordenarlo.
    // Línea de servicio: cable, tubería y pista de servicio en una pieza. Une edificios a la red; cruza cualquier terreno; no acelera a nadie.
    tubo:      { nombre: 'Oleoducto', infra: true, linea: true, tubo: true, tam: 1, vida: 220, costo: 0, tiempo: 1, energia: 0, vision: 0, req: [] }, // lleva el petróleo del extractor a la refinería, al tanque o al patio; se tiende solo
    linea:     { nombre: 'Línea de servicio', infra: true, linea: true, tam: 1, vida: 180, costo: 16, tiempo: 1, energia: 0, vision: 0, req: [] },
    camino:    { nombre: 'Camino', infra: true, tam: 1, vida: 320, costo: 24, tiempo: 1, energia: 0, vision: 0, req: [] },
  };

  // Frente: una unidad dispara solo hacia donde apunta. giroT: tiene torreta y gira así de rápido (rad por tick) sin mover el casco;
  // sin giroT gira el cuerpo entero. arco: cuánto puede desviarse el tiro del frente (por defecto ECON.arco).
  // La visión sigue, simplificado, el campo visual humano: una zona central (±60°, donde se ve con los dos ojos) que llega
  // más lejos (ECON.visAd); una periferia hasta ±105° (ECON.periferia), que es donde acaba el campo de cada ojo, con menos
  // alcance (visLado); y detrás, donde no se ve y solo se oye lo muy cercano (visAt). Los vehículos sufren más por costados y espalda.
  // radio: tamaño de la unidad en celdas (se dibuja y se separa con él). La escala va con los edificios: un tanque mide
  // menos de media celda y una fábrica tres; la infantería es la mitad de un tanque, el pesado un tercio más, y los
  // aviones son mayores que los vehículos (el bombardero, casi el doble que un tanque).
  // vel en celdas por tick. cat: cola de producción (inf = cuartel, veh = fábrica).
  // giro: radianes por tick que puede girar; acel: cuánto gana de velocidad por tick.
  // agua: cuánta agua consume mientras vive (el agua es un balance, como la energía, y limita la tropa).
  W.UNID = {
    infanteria:  { nombre: 'Infantería',  cat: 'inf', vida: 60,  vel: 0.06, costo: 100, tiempo: 100, blindaje: 'ligero', arma: 'fusil', vision: 6, radio: 0.11, req: ['cuartel'], agua: 1, giro: 0.5, acel: 0.02, arco: 0.5 },
    tanque:      { nombre: 'Tanque',      cat: 'veh', vida: 300, vel: 0.10, costo: 600, pet: 50, tiempo: 300, blindaje: 'pesado', arma: 'canon', vision: 7, radio: 0.20, req: ['fabrica'], agua: 2, giro: 0.13, acel: 0.006, giroT: 0.16, cono: 0.85 },
    // Granadero: desde el nivel 1; granadas de mano a corta distancia, con explosión en área. La respuesta temprana a los primeros vehículos.
    granadero:   { nombre: 'Granadero',   cat: 'inf', vida: 65,  vel: 0.058, costo: 160, tiempo: 130, blindaje: 'ligero', arma: 'granadaMano', vision: 6, radio: 0.11, req: ['cuartel'], agua: 1, giro: 0.5, acel: 0.02, arco: 0.5 },
    antitanque:  { nombre: 'Antitanque',  cat: 'inf', vida: 70,  vel: 0.055, costo: 250, tiempo: 160, blindaje: 'ligero', arma: 'cohete', vision: 6, radio: 0.115, req: ['cuartel'], agua: 1, giro: 0.5, acel: 0.02, nivel: 2, arco: 0.35 },
    artilleria:  { nombre: 'Artillería',  cat: 'veh', vida: 180, vel: 0.06, costo: 900, pet: 70, tiempo: 400, blindaje: 'pesado', arma: 'obus', vision: 7, radio: 0.21, req: ['fabrica'], agua: 2, giro: 0.08, acel: 0.004, nivel: 2, cono: 0.7 },
    pesado:      { nombre: 'Tanque pesado', cat: 'veh', vida: 700, vel: 0.07, costo: 1500, pet: 120, raros: 60, tiempo: 520, blindaje: 'pesado', arma: 'canonPesado', vision: 7, radio: 0.27, req: ['fabrica'], agua: 3, giro: 0.08, acel: 0.004, nivel: 3, giroT: 0.1, cono: 0.8 },
    // Aviación (cat 'aire', sale del aeródromo): vuela sobre cualquier terreno y en línea recta. fuel: ticks de vuelo;
    // pasada: ataca de pasada, como un avión: entra hacia el blanco disparando, sigue de largo, vira y vuelve a entrar.
    // (El helicóptero no: se queda en el aire frente al blanco.)
    // Cada avión tiene su aeródromo (ECON.cupoAviones por aeródromo): sale de él, no se aleja más de radioVuelo celdas y
    // vuelve a aterrizar al acabar su orden o cuando le queda el combustible justo. En tierra reposta y no se le puede atacar
    // (cae con su aeródromo). En patrulla, tras repostar despega y la retoma. Sin combustible ni base, cae.
    // Fase 1c. cono: medio ángulo del campo central de visión (por defecto ECON.cono; Math.PI = ve en todas direcciones).
    // repara: arregla sola los vehículos y edificios propios cercanos. cavaRapido: cava trincheras al doble de velocidad.
    explorador:  { enlace: true, nombre: 'Explorador',  cat: 'inf', vida: 45,  vel: 0.10, costo: 120, tiempo: 80, blindaje: 'ligero', arma: 'pistola', vision: 10, radio: 0.10, req: ['cuartel'], agua: 1, giro: 0.5, acel: 0.03, arco: 0.5, cono: 1.4 },
    ingeniero:   { nombre: 'Ingeniero',   cat: 'inf', vida: 60,  vel: 0.06, costo: 200, tiempo: 160, blindaje: 'ligero', arma: null, vision: 6, radio: 0.11, req: ['cuartel'], agua: 1, giro: 0.5, acel: 0.02, nivel: 2, repara: true, cavaRapido: true, zapador: true, minasQ: 4 }, // zapador: mina y desmina, tiende pontones y vuela caminos y puentes
    medico:      { nombre: 'Médico',      cat: 'inf', vida: 60,  vel: 0.06, costo: 220, tiempo: 160, blindaje: 'ligero', arma: null, vision: 6, radio: 0.11, req: ['cuartel'], agua: 1, giro: 0.5, acel: 0.02, cura: true },
    blindado:    { nombre: 'Blindado ligero', cat: 'veh', vida: 150, vel: 0.15, costo: 350, pet: 20, tiempo: 180, blindaje: 'pesado', arma: 'ametralladora', vision: 8, radio: 0.17, req: ['fabrica'], agua: 1, giro: 0.2, acel: 0.012, giroT: 0.3, cono: 1.2 },
    antiaereoMovil: { nombre: 'Antiaéreo móvil', cat: 'veh', vida: 220, vel: 0.09, costo: 700, pet: 40, tiempo: 300, blindaje: 'pesado', arma: 'flakMovil', vision: 8, radio: 0.20, req: ['fabrica'], agua: 2, giro: 0.12, acel: 0.006, giroT: 0.28, nivel: 2, cono: 1.25 },
    // Fase 2a. despliega: se convierte en un patio donde está (orden 'desplegar'); no hay vuelta atrás.
    // traza: con la orden 'trazar' deja camino a su paso (y solo entonces entra al bosque, talándolo).
    excavadora:  { nombre: 'Excavadora', cat: 'veh', vida: 300, vel: 0.07, costo: 500, pet: 20, tiempo: 240, blindaje: 'pesado', arma: null, vision: 6, radio: 0.24, req: ['obras'], lugar: 'obras', agua: 1, giro: 0.12, acel: 0.006, traza: true },
    // Ingeniero civil: no combate. Los edificios se cablean solos al construirse; él repara los edificios y repone los cables cortados (o tiende los que quedan demasiado lejos).
    civil:       { nombre: 'Ingeniero civil', cat: 'inf', vida: 60, vel: 0.065, costo: 200, tiempo: 160, blindaje: 'ligero', arma: null, vision: 6, radio: 0.11, req: ['obras'], lugar: 'obras', agua: 1, giro: 0.5, acel: 0.02, tiende: true, repara: true, soloEdif: true, reparaR: 40 }, // en automático: repara los edificios dañados de la base y vuelve a tender los cables cortados
    patioMovil:  { nombre: 'Patio móvil', cat: 'veh', vida: 600, vel: 0.05, costo: 2500, pet: 100, tiempo: 600, blindaje: 'pesado', arma: null, vision: 6, radio: 0.30, req: ['fabrica'], agua: 2, giro: 0.07, acel: 0.003, nivel: 2, despliega: true },
    // Puesto móvil: se despliega como puesto de avanzada. Helicópteros (mini: autónomos): el de carga va y viene manteniendo el enlace; el de tropa lleva infantería de una pista a otra.
    // Suministro móvil: va al punto que se le marca, se planta y abastece a las unidades de alrededor mientras le dura la carga
    // (se gasta según a cuántas atiende); vacío, vuelve solo al puesto logístico, recarga y regresa al mismo punto.
    // Taller de campaña: parado, repara los vehículos que tenga a 4 celdas aunque no haya suministro; y recupera vehículos destruidos (propios o enemigos) a mitad de precio.
    tallerMovil: { nombre: 'Taller de campaña', cat: 'veh', vida: 320, vel: 0.07, costo: 700, pet: 40, tiempo: 300, blindaje: 'pesado', arma: null, vision: 5, radio: 0.27, req: ['fabrica'], agua: 1, giro: 0.1, acel: 0.005, nivel: 2, taller: 4, recupera: true },
    ambulancia:  { nombre: 'Ambulancia', cat: 'veh', lugar: 'hospital', vida: 180, vel: 0.11, costo: 250, pet: 10, tiempo: 160, blindaje: 'ligero', arma: null, vision: 5, radio: 0.22, req: ['hospital'], agua: 1, giro: 0.12, acel: 0.008, ambu: { carga: 400, cura: 5, radio: 2.2 } },
    camionSum:   { nombre: 'Camión de suministro', cat: 'veh', lugar: 'logistica', vida: 220, vel: 0.085, costo: 350, pet: 20, tiempo: 200, blindaje: 'ligero', arma: null, vision: 5, radio: 0.24, req: ['logistica'], agua: 1, giro: 0.1, acel: 0.006, suministro: { carga: 1200, radio: 8, recarga: 80 } },
    heliSum:     { nombre: 'Helicóptero de suministro', cat: 'aire', aire: true, lugar: 'logistica', vida: 130, vel: 0.17, costo: 700, pet: 60, tiempo: 300, blindaje: 'aire', arma: null, vision: 6, radio: 0.24, req: ['logistica'], agua: 1, giro: 0.2, acel: 0.01, nivel: 2, fuel: 5000, radioVuelo: 140, cono: Math.PI, suministro: { carga: 600, radio: 8, recarga: 60 } },
    avanzadaMovil: { nombre: 'Puesto móvil', cat: 'veh', vida: 400, vel: 0.06, costo: 1200, pet: 80, tiempo: 400, blindaje: 'pesado', arma: null, vision: 6, radio: 0.28, req: ['logistica'], agua: 2, giro: 0.08, acel: 0.004, despliega: 'avanzada' },
    heliCarga:   { nombre: 'Helicóptero de carga', cat: 'aire', aire: true, mini: true, heli: true, lugar: 'ninguno', vida: 90, vel: 0.16, costo: 100, tiempo: 1, blindaje: 'aire', arma: null, vision: 4, radio: 0.2, req: [], agua: 0, giro: 0.3, acel: 0.05, cono: Math.PI },
    heliTropa:   { nombre: 'Helicóptero de tropa', cat: 'aire', aire: true, mini: true, heli: true, lugar: 'ninguno', vida: 140, vel: 0.16, costo: 60, tiempo: 1, blindaje: 'aire', arma: null, vision: 4, radio: 0.22, req: [], agua: 0, giro: 0.3, acel: 0.05, cono: Math.PI, plazas: 8 },
    // Fase 2b. sigilo: quieto, no se le ve hasta tenerlo muy cerca. plazas: lleva infantería dentro (órdenes 'cargar' y 'descargar').
    // mando: radio en el que los suyos ven en redondo y giran más rápido; gasta información mientras funciona.
    francotirador: { nombre: 'Francotirador', cat: 'inf', vida: 40, vel: 0.055, costo: 300, tiempo: 200, blindaje: 'ligero', arma: 'rifle', vision: 9, radio: 0.105, req: ['cuartel'], agua: 1, giro: 0.25, acel: 0.02, nivel: 2, arco: 0.1, cono: 0.55, sigilo: true },
    // Gatling: un equipo de dos. Tarda en montar el arma (monta, en ticks) antes de poder disparar, y en desmontarla antes de moverse.
    gatling:     { nombre: 'Gatling',     cat: 'inf', vida: 110, vel: 0.045, costo: 380, tiempo: 240, blindaje: 'ligero', arma: 'gatling', vision: 6.5, radio: 0.16, req: ['cuartel'], agua: 2, giro: 0.12, acel: 0.015, nivel: 2, monta: 60, arco: 0.5 },
    // Hacker: no combate. Por orden, apaga desde lejos un vehículo o un edificio enemigo durante unos segundos; cada hackeo cuesta información.
    hacker:      { nombre: 'Hacker',      cat: 'inf', vida: 45,  vel: 0.06, costo: 400, info: 30, tiempo: 240, blindaje: 'ligero', arma: null, vision: 8, radio: 0.105, req: ['estacion'], agua: 1, giro: 0.5, acel: 0.02, nivel: 2, hackea: true, alcanceHack: 9 },
    transporte:  { nombre: 'Transporte', cat: 'veh', vida: 260, vel: 0.13, costo: 500, pet: 30, tiempo: 220, blindaje: 'pesado', arma: null, vision: 7, radio: 0.24, req: ['fabrica'], agua: 1, giro: 0.14, acel: 0.008, nivel: 2, plazas: 6 },
    lanzacohetes: { nombre: 'Lanzacohetes', cat: 'veh', vida: 200, vel: 0.07, costo: 1300, pet: 90, raros: 50, tiempo: 480, blindaje: 'pesado', arma: 'salva', vision: 7, radio: 0.23, req: ['fabrica'], agua: 2, giro: 0.07, acel: 0.004, nivel: 3, arco: 0.1, cono: 0.7 },
    mando:       { nombre: 'Vehículo de mando', cat: 'veh', vida: 300, vel: 0.08, costo: 1200, pet: 60, tiempo: 420, blindaje: 'pesado', arma: null, vision: 8, radio: 0.24, req: ['fabrica'], agua: 2, giro: 0.1, acel: 0.005, nivel: 3, mando: 7, radioCom: 30, enlace: true },
    caza:        { nombre: 'Caza',        cat: 'aire', aire: true, vida: 160, vel: 0.22, costo: 900, pet: 120, tiempo: 360, blindaje: 'aire', arma: 'misil', vision: 9, radio: 0.25, req: ['aerodromo'], agua: 1, giro: 0.16, acel: 0.012, nivel: 2, fuel: 1800, arco: 0.3, radioVuelo: 70, pasada: true },
    bombardero:  { nombre: 'Bombardero',  cat: 'aire', aire: true, vida: 260, vel: 0.15, costo: 1600, pet: 200, raros: 40, tiempo: 520, blindaje: 'aire', arma: 'bomba', vision: 8, radio: 0.38, req: ['aerodromo'], agua: 2, giro: 0.09, acel: 0.008, nivel: 3, fuel: 2400, radioVuelo: 90, pasada: true },
    dron:        { nombre: 'Dron', cat: 'aire', aire: true, vida: 50, vel: 0.16, costo: 250, info: 40, tiempo: 200, blindaje: 'aire', arma: null, vision: 12, radio: 0.14, req: ['aerodromo'], agua: 0, giro: 0.2, acel: 0.01, nivel: 2, fuel: 4200, radioVuelo: 110, cono: Math.PI },
    // Drones pequeños (mini): no se fabrican ni se mandan uno a uno; los saca y los lleva su portador (estación, operador o comando de drones).
    // rec: da vueltas alrededor del portador, viendo. fpv: kamikaze de un solo uso contra vehículos y edificios. bomba: suelta una granada y vuelve a recargar.
    dronRec:     { nombre: 'Dron de reconocimiento', cat: 'aire', aire: true, mini: true, lugar: 'ninguno', vida: 22, vel: 0.2, costo: 40, tiempo: 1, blindaje: 'aire', arma: null, vision: 8, radio: 0.12, req: [], agua: 0, giro: 0.5, acel: 0.05, cono: Math.PI },
    dronFpv:     { nombre: 'Dron kamikaze', cat: 'aire', aire: true, mini: true, lugar: 'ninguno', vida: 14, vel: 0.3, costo: 40, tiempo: 1, blindaje: 'aire', arma: null, vision: 3, radio: 0.11, req: [], agua: 0, giro: 0.5, acel: 0.05, cono: Math.PI },
    dronBomba:   { nombre: 'Dron bombardero', cat: 'aire', aire: true, mini: true, lugar: 'ninguno', vida: 28, vel: 0.17, costo: 50, tiempo: 1, blindaje: 'aire', arma: null, vision: 5, radio: 0.13, req: [], agua: 0, giro: 0.5, acel: 0.05, cono: Math.PI },
    // Portadores. drones: cuántos de cada clase mantiene en el aire. radioDron: hasta dónde llegan desde él.
    // Espía: sin arma y oculto aunque se mueva (solo se le ve de muy cerca o con cámaras). Junto a edificios enemigos, ves lo que produce el rival y gana información.
    espia:       { enlace: true, nombre: 'Espía', cat: 'inf', lugar: 'inteligencia', vida: 35, vel: 0.07, costo: 400, info: 60, tiempo: 300, blindaje: 'ligero', arma: null, vision: 10, radio: 0.105, req: ['inteligencia'], agua: 1, giro: 0.5, acel: 0.02, nivel: 2, espia: true, cono: Math.PI },
    // Dron espía: vuela muy lejos y mucho rato desde su central; no ataca.
    // Radio móvil: llevan la cobertura de radio con el ejército (a pie, 15 celdas; el vehículo, 36; el dron, 30 mientras le dure el combustible).
    radioOp:     { enlace: true, radioCom: 15, nombre: 'Radioperador', cat: 'inf', vida: 45, vel: 0.075, costo: 140, tiempo: 100, blindaje: 'ligero', arma: 'pistola', vision: 7, radio: 0.105, req: ['cuartel'], agua: 1, giro: 0.5, acel: 0.02, arco: 0.5, cono: 1.4 },
    vehRadio:    { enlace: true, radioCom: 36, nombre: 'Vehículo de radio', cat: 'veh', vida: 220, vel: 0.09, costo: 500, pet: 20, tiempo: 240, blindaje: 'ligero', arma: null, vision: 7, radio: 0.22, req: ['fabrica'], agua: 2, giro: 0.1, acel: 0.006 },
    dronRadio:   { radioCom: 30, nombre: 'Dron de radio', cat: 'aire', aire: true, lugar: 'inteligencia', vida: 60, vel: 0.2, costo: 400, tiempo: 240, blindaje: 'aire', arma: null, vision: 8, radio: 0.15, req: ['inteligencia'], agua: 0, giro: 0.2, acel: 0.01, nivel: 2, fuel: 9000, radioVuelo: 220, cono: Math.PI },
    dronEspia:   { nombre: 'Dron espía', cat: 'aire', aire: true, lugar: 'inteligencia', vida: 60, vel: 0.2, costo: 500, info: 80, tiempo: 300, blindaje: 'aire', arma: null, vision: 14, radio: 0.15, req: ['inteligencia'], agua: 0, giro: 0.2, acel: 0.01, nivel: 2, fuel: 9000, radioVuelo: 220, cono: Math.PI },
    operador:    { misionDron: 45, dronStock: 3, fpvStock: 4, nombre: 'Operador de drones', cat: 'inf', vida: 45, vel: 0.06, costo: 150, tiempo: 120, blindaje: 'ligero', arma: null, vision: 6, radio: 0.105, req: ['cuartel'], agua: 1, giro: 0.5, acel: 0.02, drones: { rec: 1 }, radioDron: 12, quieto: true },
    comandoDrones: { nombre: 'Comando de drones', cat: 'veh', vida: 260, vel: 0.085, costo: 900, pet: 60, tiempo: 360, blindaje: 'pesado', arma: null, vision: 7, radio: 0.24, req: ['fabrica'], agua: 2, giro: 0.1, acel: 0.006, nivel: 2, drones: { rec: 3, bomba: 2, fpv: 5 }, radioDron: 25 },
    helicoptero: { enPista: true, nombre: 'Helicóptero', cat: 'aire', aire: true, vida: 180, vel: 0.13, costo: 1400, pet: 150, tiempo: 460, blindaje: 'aire', arma: 'coheteAire', vision: 8, radio: 0.27, req: ['aerodromo'], agua: 2, giro: 0.2, acel: 0.01, nivel: 3, fuel: 2000, radioVuelo: 45, arco: 0.3 },
    cosechadora: { nombre: 'Cosechadora', cat: 'veh', vida: 450, vel: 0.07, costo: 900, pet: 30, tiempo: 360, blindaje: 'pesado', arma: null,    vision: 5, radio: 0.25, req: ['fabrica', 'refineria'], carga: 500, agua: 1, giro: 0.1, acel: 0.004, cono: 0.9 },
  };

  // Tabla de daño: arma contra blindaje. vuelo: celdas por tick del proyectil (sin vuelo, impacta al instante).
  // vs.aire: daño contra aviones; un arma sin vs.aire no puede dispararles (y una sin vs de tierra, solo a aviones).
  // indirecto: tira por encima; le basta con que cualquier unidad propia vea el blanco (hace de observador).
  // alcanceMin: no puede disparar más cerca que eso. area: radio de la explosión (daña a todo enemigo dentro).
  W.ARMAS = {
    fusil:   { alcance: 4,   dano: 8,  recarga: 16, vs: { ligero: 1,   pesado: 0.25, edificio: 0.3, aire: 0.4 } },
    canon:   { alcance: 5,   dano: 40, recarga: 50, vuelo: 0.9, vs: { ligero: 0.4, pesado: 1,    edificio: 0.9 } },
    cohete:  { alcance: 5,   dano: 45, recarga: 60, vuelo: 0.6, vs: { ligero: 0.3, pesado: 1.2,  edificio: 0.7, aire: 1.1 } },
    obus:    { indirecto: true, alcance: 11,  alcanceMin: 3, area: 1.4, dano: 70, recarga: 110, vuelo: 0.45, vs: { ligero: 1, pesado: 0.7, edificio: 1.3 } },
    canonPesado: { alcance: 6, dano: 90, recarga: 60, vuelo: 0.9, vs: { ligero: 0.5, pesado: 1.1, edificio: 1.1 } },
    obusFijo: { indirecto: true, alcance: 20, alcanceMin: 6, area: 1.6, dano: 90, recarga: 160, vuelo: 0.4, vs: { ligero: 1, pesado: 0.75, edificio: 1.3 } }, // la artillería fija: tira sobre lo que vea cualquiera de los suyos
    canonTorre:  { alcance: 8, dano: 75, recarga: 60, vuelo: 1.0, vs: { ligero: 0.5, pesado: 1.2, edificio: 0.6 } },
    bateria: { alcance: 6.5, dano: 30, recarga: 30, vuelo: 1.1, vs: { ligero: 0.8, pesado: 1,    edificio: 0.5, aire: 0.8 } },
    flak:    { alcance: 9,   dano: 34, recarga: 22, vuelo: 1.3, vs: { aire: 1 } },
    flakMovil: { alcance: 8, dano: 26, recarga: 22, vuelo: 1.3, vs: { aire: 1 } },
    rifle:   { alcance: 9,   dano: 70, recarga: 90, vs: { ligero: 1,   pesado: 0.05, edificio: 0.02 } },
    // rafaga: cohetes por salva; caen repartidos alrededor del blanco.
    salva:   { indirecto: true, rafaga: 4, alcance: 14, alcanceMin: 5, area: 2, dano: 50, recarga: 220, vuelo: 0.5, vs: { ligero: 1, pesado: 0.8, edificio: 1.2 } },
    coheteAire: { alcance: 5.5, dano: 50, recarga: 55, vuelo: 0.7, vs: { ligero: 0.4, pesado: 1.3, edificio: 0.6 } },
    pistola: { alcance: 3,   dano: 4,  recarga: 18, vs: { ligero: 1,   pesado: 0.1,  edificio: 0.1 } },
    ametralladora: { alcance: 4.5, dano: 6, recarga: 5, vs: { ligero: 1, pesado: 0.15, edificio: 0.15, aire: 0.25 } },
    fpv:     { dano: 150, area: 0.9, vs: { ligero: 0.5, pesado: 1, edificio: 0.5 } }, // el dron kamikaze al estrellarse
    mina:    { dano: 150, area: 1.3, vs: { ligero: 1, pesado: 1, edificio: 0 } }, // mina terrestre: la pisa quien no sea zapador
    granadaMano: { alcance: 4.5, alcanceMin: 1, area: 1.1, dano: 38, recarga: 70, vuelo: 0.3, vs: { ligero: 0.8, pesado: 0.75, edificio: 0.4 } }, // la del granadero
    granada: { dano: 42, area: 1.2, vs: { ligero: 1, pesado: 0.25, edificio: 0.15 } }, // lo que suelta el dron bombardero
    gatling: { alcance: 5.5, dano: 5, recarga: 2, vs: { ligero: 1, pesado: 0.2, edificio: 0.2, aire: 0.5 } }, // diez tiros por segundo: tritura infantería y aviones bajos
    misil:   { alcance: 6,   dano: 40, recarga: 14, vuelo: 1.0, vs: { ligero: 0.6, pesado: 0.6, edificio: 0.3, aire: 1.3 } },
    bomba:   { omni: true, alcance: 1.6, area: 1.7, dano: 190, recarga: 90, vuelo: 0.12, vs: { ligero: 1, pesado: 1, edificio: 1.4 } },
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
    dronesFpv:  { nombre: 'Operadores de ataque', lugar: 'estDrones', info: 80, tiempo: 600, nivel: 1, que: 'Cada operador lleva además 2 drones kamikaze.' },
    dronesPes:  { nombre: 'Drones pesados', lugar: 'estDrones', info: 150, tiempo: 800, nivel: 2, que: 'Cada operador lleva además un bombardero, y sus drones llegan más lejos.' },
    analisis:   { nombre: 'Análisis', lugar: 'estacion', info: 250, raros: 60, tiempo: 900, nivel: 3, que: '+50 % de información por estación.' },
  };
  // Inteligencia: gastos puntuales de información, con una estación en pie.
  W.INTEL = {
    barrido:     { nombre: 'Barrido', info: 30, nivel: 2, radio: 16, dura: 400, zona: true, que: 'Revela una zona del mapa durante 20 segundos.' },
    interceptar: { nombre: 'Interceptar', info: 60, nivel: 3, dura: 1200, que: 'Durante un minuto ves los recursos del rival y qué produce.' },
    satelite:    { nombre: 'Mapeo satelital', info: 150, nivel: 2, radio: 40, dura: 900, zona: true, pide: 'inteligencia', que: 'Revela una zona enorme durante 45 segundos. Pide una central de inteligencia.' },
    cartografia: { nombre: 'Cartografía', info: 200, nivel: 3, que: 'Revela el terreno de todo el mapa.' },
  };

  // Muros: los levanta el ingeniero civil, celda a celda, en línea. n: código en la tabla del mapa. ticks: lo que tarda cada celda.
  // La alambrada no cierra el paso: frena mucho a la infantería enemiga y los vehículos la aplastan. La puerta deja pasar a su dueño.
  W.MUROS = {
    alambrada: { n: 1, nombre: 'Alambrada', costo: 2, vida: 60, ticks: 4, que: 'Frena mucho a la infantería enemiga; los vehículos la aplastan.' },
    muro:      { n: 2, nombre: 'Muro', costo: 10, vida: 400, ticks: 8, que: 'Cierra el paso a todo lo que va por tierra, hasta que lo derriben.' },
    reforzado: { n: 3, nombre: 'Muro reforzado', costo: 30, vida: 1200, ticks: 14, nivel: 2, que: 'Tres veces más duro, y admite torretas de muro.' },
    puerta:    { n: 4, nombre: 'Puerta', costo: 40, vida: 500, ticks: 14, que: 'Para el enemigo es un muro; los tuyos pasan.' },
  };
  W.MURO_N = [null, W.MUROS.alambrada, W.MUROS.muro, W.MUROS.reforzado, W.MUROS.puerta];
  // Munición que lleva encima cada arma (disparos; una salva cuenta como uno). Los edificios con arma guardan cuatro veces más.
  W.MUN = { obusFijo: 10, fusil: 100, canon: 30, cohete: 12, obus: 14, canonPesado: 24, canonTorre: 30, bateria: 50, flak: 70, flakMovil: 70, rifle: 16, salva: 6, pistola: 60, ametralladora: 300, gatling: 700, granadaMano: 12, misil: 40 };
  W.munDe = (tipo, edif) => { const a = (edif ? W.EDIF[tipo] : W.UNID[tipo]).arma; return a ? (W.MUN[a] || 60) * (edif ? 4 : 1) : 0; };
  // Misiles balísticos. alcance en celdas desde la misilera (0 = todo el mapa); vel en celdas por tick; aguante: impactos de interceptor que resiste.
  W.MISILES = {
    scud:      { nombre: 'Scud',      que: 'Local: alcance parecido al de un aeródromo.', alcance: 70,  costo: 800,  pet: 100, tiempo: 400,  dano: 420,  area: 2.6, vel: 0.5,  aguante: 1, nivel: 2 },
    minuteman: { nombre: 'Minuteman', que: 'Intercontinental: el doble de alcance y de pegada.', alcance: 140, costo: 1800, pet: 200, raros: 30, tiempo: 800, dano: 950, area: 3.6, vel: 0.6, aguante: 1, nivel: 3 },
    sarmat:    { nombre: 'Sarmat',    que: 'Global: llega a cualquier punto del mapa; hacen falta dos interceptores para pararlo.', alcance: 0, costo: 4000, pet: 400, raros: 120, tiempo: 1500, dano: 2200, area: 5, vel: 0.7, aguante: 2, nivel: 3 },
  };
  W.ECON = {
    minaCosto: 40, minaTiempo: 40, minasMax: 60, minaPisa: 0.7, minaVe: 4, desminaRadio: 5, desminaTiempo: 30, volarTiempo: 60, pontonMax: 14, pontonCelda: 12, pontonCada: 12, pontonVida: 160,
    recuperaTiempo: 160, recuperaCosto: 0.5, recuperaVida: 0.5, recuperaAuto: 10, cascoDura: 3600,
    combMax: 450, combCarga: 30, combPet: 0.02, // combustible de los vehículos de combate: celdas de autonomía, lo que repostan por ciclo (medio segundo) y el petróleo que cuesta cada celda repostada
    radioDemora: 60, // ticks que tarda en llegar una orden a quien está fuera de la cobertura de radio
    dronBat: 1800, dronCargaT: 200, dronCura: 0.15, dronVuelve: 0.4, dronReponeDist: 5, dronReponeCada: 60, dronReponeCarga: 150, // drones: batería (ticks de vuelo), lo que tarda en cargarla, lo que se repara por tick posado, con cuánta vida se retira; y la reposición del operador
    minaPozo: 40000, // minerales del pozo de una mina (más lo que hubiera en la superficie que tapa)
    vigilaRadio: 8, vigilaMax: 14, protegeDist: 4,
    espiaRadio: 6, espiaInfo: 2, sumiBase: 1, sumiUnidad: 0.5, sumiCarga: 40, // suministro móvil: gasto por ciclo (medio segundo) en vacío y por unidad atendida; y lo que carga por ciclo en el puesto logístico
    dronMisRadio: 8, autoReserva: 400, autoLargo: 70, cableMax: 24, sinEnlaceVision: 2, ruinaVale: 0.25, despejaT: 200, craterMax: 300, craterArea: 1.4, craterFreno: 0.5, ruinaFreno: 0.4, craterDano: 150, rellenaT: 60, /* ruinas: lo que se recupera al reconstruir encima y lo que tarda en despejarse una; cráteres: tope, radio mínimo de explosión que los deja, freno a los vehículos, daño a cables y caminos, y lo que tarda en rellenarse uno */ tuboMax: 30, sinTubo: 0.3, quemaCada: 80, sinCombEnergia: 0.3, /* oleoducto: largo máximo y rendimiento del extractor sin él; central: cada cuántos ticks quema 1 de petróleo y qué fracción da sin él */ bunkerDano: 0.25, ambCarga: 8, hospitalCura: 0.6, /* largo máximo del cable que un edificio nuevo tiende solo hasta la red */
    rutaNodos: 30000, // presupuesto de celdas que se exploran por tick buscando rutas
    misilesMax: 10, mejoraMax: 3, mejoraCosto: 0.6, mejoraBono: 0.5, // mejora de un edificio: hasta nivel 3; cada nivel cuesta el 60 % del edificio por el nivel que tiene y rinde un 50 % más
    inicio: 2500, petInicio: 150, cosecha: 5, descarga: 25, colaMax: 9, separacionColocar: 3, goteoCada: 5, vistaInicial: 22, obrasMax: 8, curaUnidad: 0.01, curaEdificio: 0.0025, curaCosto: 0.15, venta: 0.5, trinchera: 0.45, arco: 0.14, arcoTrinchera: 1.05, visAd: 1.3, visLado: 0.75, visAt: 0.3, cono: 1.05, periferia: 1.83, flanco: 1.25, espalda: 1.5, bosqueVeh: 0.6, bosqueCubre: 0.7, reposta: 12, retiroBajo: 0.3, retiroAlto: 0.9, huida: 300, dia: 9600, diaLuz: 6000, nocheVis: 0.7, caminoVel: 1.6, tramoLargo: 4, enlace: 5, cobNodo: 14, cobEdif: 6, lineaVel: 0.12, lineaCelda: 3, sinSum: 400, sinSumRecarga: 1.5, abastDura: 1500, heliRepone: 300, cobAvanzada: 10, hospitalCura: 2, dronFpv: 40, dronBomba: 15, dronRepone: 200, dronFpvCada: 60, hackInfo: 25, hackVeh: 240, hackEdif: 300, hackRecarga: 200, hackCanal: 40, trazaVel: 0.45, caminoLlano: 4, caminoBosque: 12, caminoAgua: 30, mandoCada: 40, mandoGiro: 1.5, captura: 600, capturaRadio: 2, antenaRadio: 12, depositoCada: 8, tallerRadio: 4, ocultaVe: 2.5, chatarra: 0.25, reparaRadio: 8, reparaVeh: 0.5, curaMedico: 0.35, reparaEdif: 0.8, rangos: [2, 5, 10], rangoDano: 0.1, rangoVida: 0.1, cupoAviones: 5, pasada: 7, orbita: 3.5, fuelCae: 80, cavar: 80, aplasta: 10, bonoProd: 0.5, bonoMax: 2.5 };
})();
