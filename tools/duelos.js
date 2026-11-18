// Tabla de duelos para la IA: enfrenta en la simulación el mismo valor en minerales de cada tipo contra cada tipo,
// a campo abierto y hasta el final, y apunta quién conserva más. Uso: node tools/duelos.js  (imprime la tabla en JSON)
// Hay que regenerarla cuando cambie el equilibrio de unidades o armas (y pegarla en src/sim/ia.js, entre las marcas DUELOS).
const path = require('path'); for (const f of ['datos', 'mapa', 'ruta', 'mundo', 'ia', 'guardar']) require(path.join(__dirname, '..', 'src', 'sim', f + '.js'));
const W = globalThis.W, UNID = W.UNID, EDIF = W.EDIF, N = 128, VALOR = 3000;
const PROPIAS = W.IA_CANDIDATOS, FIJAS = ['torreta', 'nidoMG', 'torreCanon'], RIVALES = PROPIAS.concat(FIJAS);
function duelo(ta, tb) {
  const m = W.crearMundo(4242, { N, logistica: false });
  for (const e of m.ents) if (!e.edif) e.vida = 0;
  W.tick(m);
  for (let y = 40; y < 90; y++) for (let x = 30; x < 100; x++) { m.mapa.terreno[y * N + x] = 0; m.paso[y * N + x] = 1; }
  m.jug[0].aToda = m.jug[1].aToda = true; m.jug[0].dios = m.jug[1].dios = true; m.sinClima = true;
  const pon = (j, t, x0) => { const fijo = !!EDIF[t], d = fijo ? EDIF[t] : UNID[t], n = Math.max(1, Math.round(VALOR / d.costo)), es = [];
    for (let i = 0; i < n; i++) { const x = x0 + (j ? 1 : -1) * ((i / 8) | 0) * (fijo ? 3 : 1), y = 60 + (i % 8) * (fijo ? 3 : 1) - (Math.min(n, 8) >> 1) * (fijo ? 3 : 1); es.push(fijo ? W.crearEdificio(m, j, t, x, y) : W.crearUnidad(m, j, t, y * N + x)); }
    return { es, v0: n * d.costo, fijo, d }; };
  const A = pon(0, ta, 52), B = pon(1, tb, 74);
  for (const e of B.es) if (B.fijo) { e.obra = 0; e.enObra = false; e.vida = e.vidaMax || B.d.vida; }
  const queda = (S) => S.es.reduce((s, e) => s + (e.vida > 0 && !e.herido ? e.vida / (e.vidaMax || S.d.vida) : 0), 0) * S.d.costo / S.v0;
  const ids = (S) => S.es.filter((e) => e.vida > 0).map((e) => e.id);
  for (let t = 0; t < 3600; t++) {
    if (t % 200 === 0) { W.orden(m, { t: 'amover', j: 0, ids: ids(A), x: B.fijo ? 74.5 : 63.5, y: 60.5 }); if (!B.fijo) W.orden(m, { t: 'amover', j: 1, ids: ids(B), x: 63.5, y: 60.5 }); }
    W.tick(m);
    if (t % 20 === 0 && (!ids(A).length || !ids(B).length)) break;
  }
  return +(queda(A) - queda(B)).toFixed(2);
}
const T = {};
for (const a of PROPIAS) { T[a] = {}; for (const b of RIVALES) { const i = PROPIAS.indexOf(b); T[a][b] = a === b ? 0 : i >= 0 && i < PROPIAS.indexOf(a) ? -T[b][a] : duelo(a, b); } }
if (process.argv[2] === 'tabla') { console.log(''.padEnd(13) + RIVALES.map((b) => b.slice(0, 6).padStart(7)).join('')); for (const a of PROPIAS) console.log(a.padEnd(13) + RIVALES.map((b) => String(T[a][b]).padStart(7)).join('')); }
else console.log(JSON.stringify(T));
