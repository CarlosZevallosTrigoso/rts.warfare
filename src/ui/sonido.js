// rts.warfare — sonido sintetizado con Web Audio. Sin archivos: todo son osciladores y ruido.
(function () {
  const W = globalThis.W;

  W.crearSonido = function () {
    let ctx = null, salida = null, mudo = false, bufRuido = null;
    const s = { sonados: 0 };

    // Los navegadores solo dejan arrancar el audio tras un gesto del usuario.
    s.activar = function () {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        ctx = new AC();
        salida = ctx.createGain(); salida.gain.value = 0.3; salida.connect(ctx.destination);
        bufRuido = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const d = bufRuido.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    };
    s.alternar = function () { mudo = !mudo; return mudo; };
    s.mudo = () => mudo;

    function envolvente(vol, dur, cuando) {
      const g = ctx.createGain(), t = ctx.currentTime + (cuando || 0);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      g.connect(salida);
      return { g, t };
    }
    function tono(f0, f1, dur, forma, vol, cuando) {
      if (!ctx || mudo) return;
      const { g, t } = envolvente(vol, dur, cuando), o = ctx.createOscillator();
      o.type = forma; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      o.connect(g); o.start(t); o.stop(t + dur + 0.02);
      s.sonados++;
    }
    function ruido(frec, dur, vol, cuando) {
      if (!ctx || mudo) return;
      const { g, t } = envolvente(vol, dur, cuando), n = ctx.createBufferSource(), f = ctx.createBiquadFilter();
      n.buffer = bufRuido; f.type = 'bandpass'; f.frequency.value = frec; f.Q.value = 0.9;
      n.connect(f); f.connect(g); n.start(t, Math.random() * 0.5, dur + 0.02);
      s.sonados++;
    }

    // v: cercanía a la cámara, de 0 a 1.
    s.disparo = function (arma, v) {
      if (arma === 'fusil') ruido(2400, 0.05, 0.18 * v);
      else if (arma === 'canon') { ruido(420, 0.22, 0.5 * v); tono(150, 45, 0.2, 'sine', 0.45 * v); }
      else { ruido(900, 0.12, 0.35 * v); tono(320, 110, 0.12, 'square', 0.12 * v); }
    };
    s.explosion = function (v) { ruido(180, 0.5, 0.6 * v); tono(90, 30, 0.45, 'sine', 0.5 * v); };
    s.obraLista = function () { tono(440, 440, 0.12, 'triangle', 0.3); tono(660, 660, 0.18, 'triangle', 0.3, 0.12); };
    s.colocar = function () { tono(120, 60, 0.18, 'sine', 0.6); ruido(300, 0.12, 0.25); };
    s.unidadLista = function () { tono(880, 880, 0.07, 'square', 0.12); };
    s.orden = function () { tono(520, 620, 0.05, 'triangle', 0.12); };
    s.alerta = function () { for (let k = 0; k < 3; k++) tono(740, 520, 0.16, 'sawtooth', 0.16, k * 0.2); };
    s.fin = function (gano) {
      const notas = gano ? [392, 494, 587, 784] : [392, 349, 294, 196];
      notas.forEach((f, k) => tono(f, f, 0.35, 'triangle', 0.3, k * 0.22));
    };
    return s;
  };
})();
