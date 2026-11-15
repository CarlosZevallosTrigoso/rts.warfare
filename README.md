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
  humo. El rival es provisional y los drones aún no se mandan.
