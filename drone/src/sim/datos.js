// drone.warfare — datos: terreno, soldados, drones, edificios y constantes.
(function () {
  const D = globalThis.D || (globalThis.D = {});
  D.N = 96; // el sector: 96 × 96 celdas de 10 m (casi un kilómetro cuadrado)
  D.T = { SUELO: 0, CAMPO: 1, HIERBA: 2, BOSQUE: 3, CAMINO: 4, AGUA: 5, VADO: 6, PUENTE: 7, MURO: 8, RUINA: 9, TRINCHERA: 10, CRATER: 11 };
  D.TERRENO = ['Suelo', 'Campo arado', 'Hierba', 'Arboleda', 'Camino', 'Arroyo', 'Vado', 'Puente', 'Muro', 'Ruina', 'Trinchera', 'Cráter'];
  // Cuánto tapa cada terreno a quien está quieto dentro (0 = nada, 1 = del todo). Lo usará la detección (entrega 2).
  D.COBERTURA = [0, 0, 0.1, 0.7, 0, 0, 0, 0.2, 0, 0.8, 0.6, 0.35];
  D.prng = function (semilla) { let a = semilla >>> 0; return function () { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

  // Fuerzas especiales. (Las cifras de combate llegan con la entrega 2; aquí está lo que hace falta para verlos.)
  D.SOL = {
    asaltante:  { nombre: 'Asaltante', que: 'Fusil. Llega y coloca la carga que destruye el centro enemigo.', proto: true },
    escopetero: { nombre: 'Escopetero', que: 'Última defensa del equipo contra el FPV que entra.', proto: true },
    zapador:    { nombre: 'Zapador', que: 'Cargas, minas, túneles; corta y sigue el hilo de fibra.' },
    inhibidor:  { nombre: 'Operador de inhibidor', que: 'Burbuja que tumba los FPV de radio de los dos bandos. Emite.' },
    observador: { nombre: 'Observador', que: 'Marca blancos para tus drones.' },
    tirador:    { nombre: 'Tirador', que: 'Largo alcance contra pilotos y antenas; se oculta mejor.' },
    sanitario:  { nombre: 'Sanitario', que: 'Estabiliza heridos para evacuarlos.' },
    piloto:     { nombre: 'Piloto', que: 'Vuela un dron a la vez desde el centro de operaciones.', proto: true },
  };
  D.DRON = {
    recon:       { nombre: 'Dron de reconocimiento', que: 'Los ojos: encuentra equipos, antenas e hilo de fibra.', alt: 3.2, radio: true, proto: true },
    fpvRadio:    { nombre: 'FPV de radio', que: 'Golpe barato de un solo uso. Lo tumba el inhibidor.', alt: 1.4, radio: true, proto: true },
    fpvFibra:    { nombre: 'FPV de fibra', que: 'Inmune al inhibidor y entra en edificios; deja hilo.', alt: 1.2, radio: false, proto: true },
    bombardero:  { nombre: 'Bombardero', que: 'Granadas sobre gente parada.', alt: 2.2, radio: true },
    interceptor: { nombre: 'Interceptor', que: 'Derriba drones.', alt: 3.2, radio: true },
    repetidor:   { nombre: 'Repetidor', que: 'Alarga el enlace de radio.', alt: 3.8, radio: true },
    carga:       { nombre: 'Dron de carga', que: 'Lleva munición y baterías al equipo.', alt: 2, radio: true },
    ugv:         { nombre: 'Robot terrestre', que: 'Suministro y heridos por tierra.', alt: 0, radio: true },
  };
  D.EDIF = {
    centro:   { nombre: 'Centro de operaciones', que: 'El objetivo. Enterrado: solo cae con una carga puesta a mano.', tam: 3, proto: true },
    taller:   { nombre: 'Taller de drones', que: 'Fabrica y recarga drones.', tam: 3, proto: true },
    antena:   { nombre: 'Antena', que: 'Da alcance de radio a los drones. Emite y delata.', tam: 1, emite: true, proto: true },
    barracon: { nombre: 'Barracón', que: 'De aquí salen las fuerzas especiales.', tam: 3, proto: true },
    falsa:    { nombre: 'Antena falsa', que: 'Señuelo: parece una antena y está fría.', tam: 1 },
    escucha:  { nombre: 'Estación de escucha', que: 'Da el rumbo hacia lo que emite el enemigo.', tam: 2 },
    red:      { nombre: 'Red antidron', que: 'Detiene FPV sobre un tramo.', tam: 2 },
    pozo:     { nombre: 'Posición enterrada', que: 'Oculta y protege a un equipo.', tam: 1 },
    suministro: { nombre: 'Punto de suministro', que: 'Munición y baterías a mano.', tam: 2 },
    boca:     { nombre: 'Boca de tubería', que: 'Entrada a un paso bajo tierra: ningún dron ve dentro.', tam: 1 },
  };
  D.ECON = { dia: 9600, diaLuz: 5760, crepusculo: 480, tope: [30, 20] }; // un día dura 8 min (4:48 de luz); el anochecer dura 24 s; tope de personas: 30 el atacante, 20 el defensor
  // Los dos papeles. El bando 0 ataca (caza pilotos: muchos equipos, pocos drones); el bando 1 defiende (el centro de drones: muchos pilotos y medios, una guardia corta).
  D.ROL = [
    { clave: 'ataque', nombre: 'Cazar pilotos', que: 'Mandas varios equipos de fuerzas especiales y pocos drones. Tienes que encontrar el centro de operaciones enemigo, llegar a pie y volarlo.' },
    { clave: 'defensa', nombre: 'Defender el centro', que: 'Mandas el centro de drones: más pilotos, antenas, redes y un equipo de guardia. Tienes que encontrar a los equipos que vienen y pararlos antes de que lleguen.' },
  ];
  D.ESCENARIO = { mixto: 'Mixto: campo abierto, un arroyo y, al fondo, el pueblo', urbano: 'Urbano: calles, manzanas y bloques de pisos' };
})();
