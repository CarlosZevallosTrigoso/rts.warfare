// rts.warfare — qué hace la rueda (o los dos dedos del trackpad): acercar y alejar, o mover la vista. Lo comparten la partida y el editor.
// El navegador no dice si la rueda viene de un ratón o de un trackpad (no hay forma estándar). Se adivina así:
//   - con Ctrl o Cmd es un pellizco: siempre zoom (eso lo decide quien llama);
//   - un desplazamiento con componente horizontal, o pasos pequeños y enteros en píxeles (|Δ| < 50), son de trackpad: mover;
//   - pasos en líneas, grandes (100, 120: una muesca de rueda) o fraccionarios (la rueda de un ratón en Mac): ratón: zoom.
// La primera vez que se reconoce un trackpad se queda así toda la sesión. Si se elige a mano (botón o tecla M), manda eso, y se recuerda.
(function () {
  const W = globalThis.W, CLAVE = 'rts.rueda';
  let elegido = null; try { elegido = localStorage.getItem(CLAVE); } catch (e) { /* sin almacenamiento: solo esta sesión */ }
  if (elegido !== 'zoom' && elegido !== 'mover') elegido = null;
  let visto = false; const oyentes = new Set();
  const avisar = (porQue) => { for (const f of oyentes) f(W.rueda.modo(), porQue); };
  W.rueda = {
    // ¿Este evento de rueda (sin Ctrl ni Cmd) mueve la vista?
    mueve(ev) {
      if (elegido) return elegido === 'mover';
      if (!visto && (ev.deltaX !== 0 || (ev.deltaMode === 0 && ev.deltaY !== 0 && Number.isInteger(ev.deltaY) && Math.abs(ev.deltaY) < 50))) { visto = true; avisar('trackpad'); }
      return visto;
    },
    modo: () => elegido || (visto ? 'mover' : 'zoom'),
    cambiar() { elegido = W.rueda.modo() === 'mover' ? 'zoom' : 'mover'; try { localStorage.setItem(CLAVE, elegido); } catch (e) { /* da igual */ } avisar('mano'); return elegido; },
    alCambiar(f) { oyentes.add(f); return () => oyentes.delete(f); },
    texto: () => (W.rueda.modo() === 'mover' ? 'rueda: mueve' : 'rueda: zoom'),
    explica: (porQue) => (porQue === 'trackpad' ? 'Trackpad: dos dedos mueven la vista; el pellizco acerca y aleja' : W.rueda.modo() === 'mover' ? 'La rueda mueve la vista; el pellizco (o Ctrl + rueda) acerca y aleja' : 'La rueda acerca y aleja; para mover la vista, arrastra con el botón central o usa las flechas'),
  };
})();
