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
- Estado: se juega la parte de infantería. Equipos de fuerzas especiales que se seleccionan y se mueven (con sigilo y fuego
  contenido), detección por cobertura, luz y línea de visión, combate entre soldados, la carga que vuela edificios y el final
  (el atacante gana si vuela el centro; el defensor, si amanece). Tacto de Company of Heroes: obstáculos bajos, cobertura
  con dirección y vista previa de puestos al ordenar, supresión en dos grados (agachado y clavado), retirada, granada y
  humo. Drones: el de reconocimiento se manda a vigilar un punto y vuelve solo a recargar; los FPV (de radio y de fibra) se
  lanzan contra lo que se ve; cada dron en el aire ocupa a un piloto; el de radio necesita enlace (antenas y observadores) y
  lo tumba el inhibidor; la escopeta los derriba; el taller repone FPV. El centro está oculto (ningún dron lo ve; a pie, a 50 m) y se encuentra por rastros: rumbos de radio
  hacia lo que emite el rival (los dan observadores y la estación de escucha) e hilos de fibra. La máquina lleva cualquiera de los dos papeles con lo que su bando sabe (guardia y reacción, FPV con
  prioridades, reunión antes de entrar, registro por sectores, humo para cubrir la carga).
