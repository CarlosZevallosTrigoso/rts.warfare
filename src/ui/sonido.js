// rts.warfare — sonido sintetizado con Web Audio, sin archivos.
// Cada sonido se arma por capas (golpe grave + cuerpo + chasquido) y pasa por un bus propio
// que lo coloca en el estéreo y lo apaga con la distancia. Una reverberación generada da la cola.
(function () {
  const W = globalThis.W;

  W.crearSonido = function () {
    let ctx = null, salida = null, rev = null, bufRuido = null, motor = null, mudo = false;
    const s = { sonados: 0 };
    const VOL = 0.6, vari = () => 0.9 + Math.random() * 0.2;

    // Los navegadores solo dejan arrancar el audio tras un gesto del usuario.
    s.activar = function () {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        ctx = new AC();
        const comp = ctx.createDynamicsCompressor(); // evita que una batalla sature
        comp.threshold.value = -16; comp.ratio.value = 6; comp.connect(ctx.destination);
        salida = ctx.createGain(); salida.gain.value = VOL; salida.connect(comp);

        const sr = ctx.sampleRate;
        bufRuido = ctx.createBuffer(1, sr * 2, sr);
        const d = bufRuido.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

        // Reverberación: respuesta al impulso hecha de ruido que decae.
        const n = Math.floor(sr * 1.7), ir = ctx.createBuffer(2, n, sr);
        for (let c = 0; c < 2; c++) { const x = ir.getChannelData(c); for (let i = 0; i < n; i++) x[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.8); }
        const conv = ctx.createConvolver(); conv.buffer = ir;
        rev = ctx.createGain(); rev.gain.value = 0.2; rev.connect(conv); conv.connect(salida);

        // Motores: dos osciladores graves filtrados; el volumen sigue a los vehículos en pantalla.
        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 160; f.Q.value = 1.5;
        const g = ctx.createGain(); g.gain.value = 0; f.connect(g); g.connect(salida);
        for (const hz of [47, 70.5, 94.3]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz; o.connect(f); o.start(); }
        motor = { f, g };

        // Viento de fondo, muy bajo, con un vaivén lento.
        const v = ctx.createBufferSource(); v.buffer = bufRuido; v.loop = true;
        const vf = ctx.createBiquadFilter(); vf.type = 'lowpass'; vf.frequency.value = 380;
        const vg = ctx.createGain(); vg.gain.value = 0.03;
        const lfo = ctx.createOscillator(); lfo.frequency.value = 0.11;
        const lg = ctx.createGain(); lg.gain.value = 0.015; lfo.connect(lg); lg.connect(vg.gain);
        v.connect(vf); vf.connect(vg); vg.connect(salida); v.start(); lfo.start();
      }
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    };
    s.alternar = function () {
      mudo = !mudo;
      if (ctx) salida.gain.setTargetAtTime(mudo ? 0 : VOL, ctx.currentTime, 0.03);
      return mudo;
    };
    s.mudo = () => mudo;

    // Bus de un evento: v = cercanía (0 a 1), pan = posición horizontal (-1 a 1).
    function bus(v, pan, eco) {
      const g = ctx.createGain(); g.gain.value = Math.max(0, Math.min(1, v));
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700 + v * v * 11000; // lejos suena más apagado
      g.connect(lp);
      let fin = lp;
      if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan || 0)); lp.connect(p); fin = p; }
      fin.connect(salida);
      const e = ctx.createGain(); e.gain.value = eco === undefined ? 1 : eco; fin.connect(e); e.connect(rev);
      return g;
    }
    function env(b, vol, dur, cuando) {
      const g = ctx.createGain(), t = ctx.currentTime + (cuando || 0);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      g.connect(b);
      return { g, t };
    }
    function tono(b, forma, f0, f1, dur, vol, cuando) {
      const { g, t } = env(b, vol, dur, cuando), o = ctx.createOscillator();
      o.type = forma; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
      o.connect(g); o.start(t); o.stop(t + dur + 0.03);
    }
    function ruido(b, filtro, f0, f1, dur, vol, cuando) {
      const { g, t } = env(b, vol, dur, cuando), n = ctx.createBufferSource(), f = ctx.createBiquadFilter();
      n.buffer = bufRuido; f.type = filtro; f.Q.value = 0.8;
      f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
      n.connect(f); f.connect(g); n.start(t, Math.random() * 1.5, dur + 0.03);
    }
    const listo = (v) => ctx && !mudo && v > 0.02 && ++s.sonados;

    s.disparo = function (arma, v, pan) {
      if (!listo(v)) return;
      const b = bus(v, pan), k = vari();
      if (arma === 'fusil') {
        ruido(b, 'highpass', 2400 * k, 2000, 0.04, 0.5); // chasquido
        ruido(b, 'lowpass', 900 * k, 260, 0.1, 0.4); // cuerpo
      } else if (arma === 'canon') {
        tono(b, 'sine', 125 * k, 34, 0.42, 1); // golpe grave
        ruido(b, 'lowpass', 1500 * k, 150, 0.4, 0.8); // estampido
        ruido(b, 'highpass', 3200, 2600, 0.03, 0.4); // chasquido de boca
      } else { // batería de la torreta: dos tiros seguidos
        for (const dt of [0, 0.075]) { tono(b, 'sine', 175 * k, 55, 0.2, 0.7, dt); ruido(b, 'bandpass', 950 * k, 380, 0.15, 0.6, dt); }
      }
    };
    s.impacto = function (v, pan) {
      if (!listo(v)) return;
      const b = bus(v, pan), k = vari();
      tono(b, 'sine', 95 * k, 38, 0.28, 0.7); ruido(b, 'lowpass', 1000 * k, 140, 0.32, 0.7);
      for (let i = 0; i < 3; i++) ruido(b, 'highpass', 3500 + Math.random() * 2500, 3000, 0.02, 0.25, 0.03 + Math.random() * 0.15); // esquirlas
    };
    s.explosion = function (v, pan, grande) {
      if (!listo(v)) return;
      const b = bus(v, pan, 1.6), k = vari(), dur = grande ? 1.5 : 0.85;
      tono(b, 'sine', 78 * k, 22, dur, 1);
      ruido(b, 'lowpass', 1700 * k, 85, dur, 0.95);
      for (let i = 0, n = grande ? 11 : 6; i < n; i++) ruido(b, 'bandpass', 1200 + Math.random() * 3200, 600, 0.035, 0.3, 0.08 + Math.random() * dur * 0.7); // escombros
      if (grande) ruido(b, 'lowpass', 300, 60, 1.6, 0.6, 0.25); // derrumbe
    };

    // Avisos de interfaz: sin posición, más secos.
    const ui = () => (ctx && !mudo && ++s.sonados ? bus(1, 0, 0.5) : null);
    s.obraLista = function () { const b = ui(); if (!b) return; tono(b, 'triangle', 523, 523, 0.16, 0.3); tono(b, 'sine', 1046, 1046, 0.1, 0.1); tono(b, 'triangle', 784, 784, 0.28, 0.32, 0.13); tono(b, 'sine', 1568, 1568, 0.2, 0.1, 0.13); };
    s.colocar = function () { const b = ui(); if (!b) return; tono(b, 'sine', 115, 46, 0.24, 0.9); ruido(b, 'lowpass', 500, 120, 0.16, 0.5); ruido(b, 'bandpass', 2700, 2400, 0.05, 0.3, 0.02); };
    s.unidadLista = function () { const b = ui(); if (!b) return; tono(b, 'sine', 880, 880, 0.07, 0.16); tono(b, 'sine', 1320, 1320, 0.09, 0.14, 0.07); };
    s.orden = function () { const b = ui(); if (!b) return; tono(b, 'triangle', 560, 680, 0.05, 0.12); };
    s.alerta = function () { const b = ui(); if (!b) return; for (let i = 0; i < 3; i++) { tono(b, 'sawtooth', 640, 470, 0.24, 0.14, i * 0.27); tono(b, 'square', 320, 235, 0.24, 0.06, i * 0.27); } };
    s.fin = function (gano) { const b = ui(); if (!b) return; (gano ? [392, 494, 587, 784] : [392, 349, 294, 196]).forEach((f, i) => { tono(b, 'triangle', f, f, 0.5, 0.3, i * 0.24); tono(b, 'sine', f / 2, f / 2, 0.6, 0.25, i * 0.24); }); };

    // nivel: de 0 a 1, cuántos vehículos se mueven cerca.
    s.motor = function (nivel) {
      if (!ctx) return;
      motor.g.gain.setTargetAtTime(mudo ? 0 : Math.min(1, nivel) * 0.16, ctx.currentTime, 0.3);
      motor.f.frequency.setTargetAtTime(140 + Math.min(1, nivel) * 220, ctx.currentTime, 0.3);
    };
    return s;
  };
})();
