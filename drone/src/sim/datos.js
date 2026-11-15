// drone.warfare — datos: terreno, soldados, drones, edificios y constantes.
(function () {
  const D = globalThis.D || (globalThis.D = {});
  D.N = 96; // el sector: 96 × 96 celdas de 10 m (casi un kilómetro cuadrado)
  D.T = { SUELO: 0, CAMPO: 1, HIERBA: 2, BOSQUE: 3, CAMINO: 4, AGUA: 5, VADO: 6, PUENTE: 7, MURO: 8, RUINA: 9, TRINCHERA: 10, CRATER: 11 };
  D.TERRENO = ['Suelo', 'Campo arado', 'Hierba', 'Arboleda', 'Camino', 'Arroyo', 'Vado', 'Puente', 'Muro', 'Ruina', 'Trinchera', 'Cráter'];
  // Cuánto tapa cada terreno a quien está quieto dentro (0 = nada, 1 = del todo). Lo usará la detección (entrega 2).
  D.COBERTURA = [0, 0, 0.1, 0.7, 0, 0, 0, 0.2, 0, 0.8, 0.6, 0.35];
  D.prng = function (semilla) { let a = semilla >>> 0; return function () { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

  // Fuerzas especiales.
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
  // Lo que cada soldado lleva y cómo se le ve. ver: hasta dónde ve de día (celdas); firma: cuánto se le ve a él (1 = normal);
  // carga: puede colocar la carga que vuela un edificio; cura: atiende a los suyos.
  for (const k in D.SOL) Object.assign(D.SOL[k], { vida: 100, vel: 0.026, ver: 20, firma: 1, arma: 'pistola' });
  Object.assign(D.SOL.asaltante, { arma: 'fusil', carga: true }); Object.assign(D.SOL.escopetero, { arma: 'escopeta' }); Object.assign(D.SOL.zapador, { arma: 'fusil', carga: true });
  Object.assign(D.SOL.inhibidor, { arma: 'fusil' }); Object.assign(D.SOL.observador, { ver: 25 }); Object.assign(D.SOL.tirador, { arma: 'rifle', ver: 27, firma: 0.6 }); Object.assign(D.SOL.sanitario, { cura: true });
  // Armas: alcance (celdas), ticks entre disparos, daño y puntería de partida.
  D.ARMA = {
    fusil:    { nombre: 'fusil', alc: 14, cad: 14, dano: 17, prec: 0.5 },
    escopeta: { nombre: 'escopeta', alc: 5, cad: 18, dano: 36, prec: 0.7 },
    rifle:    { nombre: 'rifle de precisión', alc: 26, cad: 70, dano: 85, prec: 0.8 },
    pistola:  { nombre: 'pistola', alc: 6, cad: 16, dano: 9, prec: 0.4 },
  };
  // Cuánto frena cada terreno a quien va a pie (1 = paso normal).
  D.PASO = [1, 0.9, 0.95, 0.8, 1.1, 0, 0.5, 1.1, 0, 0.7, 0.8, 0.8];
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
  D.ECON = {
    dia: 28800, diaLuz: 14400, crepusculo: 600, inicio: 9600, tope: [30, 30], // el día dura 24 min: 12 de luz y 12 de noche. La partida empieza 4 min antes de anochecer y acaba al amanecer (16 min). 30 personas por bando
    verNoche: 0.45, verEdif: 14, dronVe: 12, dronVeEdif: 10, // de noche el soldado ve el 45 % (lleva visor); a qué distancia se descubre un edificio; lo que ve un dron de reconocimiento
    sigiloVel: 0.5, sigiloFirma: 0.6, quietoCob: 1, andaCob: 0.35, firmaTiro: 1.4, tiroDelata: 40, // en sigilo: media velocidad y menos firma; quieto, la cobertura tapa del todo; andando, un tercio; quien dispara se delata 2 s
    supr: 50, suprVel: 0.5, suprPrec: 0.6, cobTiro: 0.6, andaPrec: 0.5, curaRadio: 2.5, cura: 0.15, // bajo fuego: 2,5 s agachado, lento y con peor puntería; la cobertura quita hasta el 60 % de los impactos; el sanitario
    cargaTicks: 100, cargaDist: 2.2, // colocar la carga: 5 s pegado al edificio
  };
  // Los dos papeles. El bando 0 ataca (caza pilotos: muchos equipos, pocos drones); el bando 1 defiende (el centro de drones: muchos pilotos y medios, una guardia corta).
  D.ROL = [
    { clave: 'ataque', nombre: 'Cazar pilotos', que: 'Mandas varios equipos de fuerzas especiales y pocos drones. Tienes que encontrar el centro de operaciones enemigo, llegar a pie y volarlo.' },
    { clave: 'defensa', nombre: 'Defender el centro', que: 'Mandas el centro de drones: más pilotos, antenas, redes y un equipo de guardia. Tienes que encontrar a los equipos que vienen y pararlos antes de que lleguen.' },
  ];
  D.ESCENARIO = { mixto: 'Mixto: campo abierto, un arroyo y, al fondo, el pueblo', urbano: 'Urbano: calles, manzanas y bloques de pisos' };
})();
