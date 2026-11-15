# rts.warfare

RTS minimalista para navegador. Primer juego de la saga *warfare*.

- Jugar: abrir `index.html` (o GitHub Pages). `?s=1234` fija la semilla del mapa.
- Código fuente en `src/`; `index.html` se genera con `node build.js`.
- Pruebas de la simulación: `node tests/sim.test.js`.

`src/sim/` no toca el DOM: mapa, rutas, economía, combate e IA se prueban en Node.
Las unidades, edificios y armas son tablas en `src/sim/datos.js`.

## drone.warfare

Juego hermano, en la carpeta `drone/`: el mismo conflicto visto con lupa. Un centro de operaciones de drones y los equipos de
fuerzas especiales que van a destruirlo, en un sector de casi un kilómetro cuadrado, urbano o mixto. Se elige papel: cazar
pilotos (ataque) o defender el centro.

- Jugar: `drone/index.html` (en línea, `…/rts.warfare/drone/`).
- Construir: `node drone/build.js`. Pruebas: `node drone/tests/sim.test.js`.
- Estado: se juegan los dos papeles contra la máquina. La partida simula 24 horas (un minuto por hora), de las 22:00 a las
  22:00 del día siguiente, cuando llegan los refuerzos aéreos de la defensa. Misión del atacante: entrar, destruir y huir
  (encontrar el centro, volarlo a mano y sacar a los supervivientes por la zona de extracción). Posiciones al azar: el
  atacante sale de cualquier borde; el centro, el taller, el barracón y las antenas del defensor caen separados por el casco
  urbano, y hay patios señuelo. Escuadrones numerados por bando (teclas 1–6). Infantería al estilo Company of Heroes
  (cobertura con dirección, supresión, retirada, granada, humo); drones (reconocimiento, FPV de radio y de fibra, pilotos,
  batería, enlace, inhibidor); rastros (rumbos de radio, hilos de fibra); día y noche con cuatro visiones (teclas 7 8 9 0).