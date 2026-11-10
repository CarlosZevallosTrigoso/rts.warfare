# rts.warfare

RTS minimalista para navegador. Primer juego de la saga *warfare*.

- Jugar: abrir `index.html` (o GitHub Pages). `?s=1234` fija la semilla del mapa.
- Código fuente en `src/`; `index.html` se genera con `node build.js`.
- Pruebas de la simulación: `node tests/sim.test.js`.

`src/sim/` no toca el DOM: mapa, rutas, economía, combate e IA se prueban en Node.
Las unidades, edificios y armas son tablas en `src/sim/datos.js`.
