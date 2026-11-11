// rts.warfare — guardar y cargar una partida. El mundo entero se pasa a texto (JSON): las tablas grandes van
// comprimidas por tramos repetidos, y los mapas y conjuntos se marcan para reconstruirlos al cargar.
(function () {
  const W = globalThis.W || (globalThis.W = {});
  const TIPOS = { Uint8Array, Int8Array, Uint8ClampedArray, Uint16Array, Int16Array, Int32Array, Uint32Array, Float32Array, Float64Array };
  const FUERA = ['porId', 'ruta', 'vistas', 'pasoT']; // del mundo: se reconstruyen al cargar
  const DE_ENTIDADES = new Set(['victimas', 'agresores', 'embarques']); // listas que apuntan a unidades: se guardan sus números

  function comprimir(a, flotante) { // "valor,veces,valor,veces…"; los enteros, en base 36
    const out = [];
    for (let i = 0; i < a.length;) {
      const v = a[i]; let n = 1;
      while (i + n < a.length && a[i + n] === v) n++;
      out.push(flotante ? String(v) : v.toString(36), n.toString(36)); i += n;
    }
    return out.join(',');
  }
  function expandir(txt, Tipo, largo, flotante) {
    const a = new Tipo(largo), p = txt ? txt.split(',') : [];
    for (let k = 0, i = 0; k < p.length; k += 2) { const v = flotante ? Number(p[k]) : parseInt(p[k], 36), n = parseInt(p[k + 1], 36); a.fill(v, i, i + n); i += n; }
    return a;
  }
  function escribir(clave, v) {
    if (typeof v === 'function') return undefined;
    if (DE_ENTIDADES.has(clave) && Array.isArray(v)) return { __ents: v.map((e) => e.id) };
    if (v instanceof Map) return { __mapa: [...v] };
    if (v instanceof Set) return { __conj: [...v] };
    if (ArrayBuffer.isView(v)) { const t = v.constructor.name, fl = t.startsWith('Float'); return { __tabla: t, n: v.length, d: comprimir(v, fl) }; }
    return v;
  }
  function leer(clave, v) {
    if (v && typeof v === 'object') {
      if (v.__mapa) return new Map(v.__mapa);
      if (v.__conj) return new Set(v.__conj);
      if (v.__tabla && TIPOS[v.__tabla]) return expandir(v.d, TIPOS[v.__tabla], v.n, v.__tabla.startsWith('Float'));
    }
    return v;
  }

  // extra: lo que la interfaz quiera guardar junto al mundo (la IA, la cámara, el historial…).
  W.guardar = function (m, extra) {
    const copia = Object.assign({}, m); for (const k of FUERA) delete copia[k];
    return JSON.stringify({ rts: 1, version: W.VERSION || '', m: copia, extra: extra || null }, escribir);
  };
  W.cargar = function (txt) {
    const g = JSON.parse(txt, leer);
    if (!g || g.rts !== 1 || !g.m || !g.m.ents) throw new Error('No es una partida guardada de rts.warfare');
    const m = g.m;
    m.porId = new Map(m.ents.map((e) => [e.id, e]));
    m.ruta = W.crearRuta(m.N);
    const ents = (v) => (v && v.__ents ? v.__ents.map((id) => m.porId.get(id)).filter(Boolean) : v || []);
    m.embarques = ents(m.embarques);
    for (const lista of m.focos) for (const f of lista) { f.victimas = ents(f.victimas); f.agresores = ents(f.agresores); }
    return { m, extra: g.extra, version: g.version };
  };
})();
