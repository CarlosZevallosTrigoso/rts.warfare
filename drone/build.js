// Genera drone/index.html uniendo drone/src/. Uso: node drone/build.js
const fs = require('node:fs'), path = require('node:path');
const ORDEN = ['sim/datos.js', 'sim/mapa.js', 'sim/ruta.js', 'sim/mundo.js', 'ui/figuras.js', 'ui/juego.js'];
const src = (f) => fs.readFileSync(path.join(__dirname, 'src', f), 'utf8');
const codigo = ORDEN.map((f) => '// ===== ' + f + ' =====\n' + src(f)).join('\n');
// La versión cuenta los cambios que han tocado esta carpeta: sirve para saber si el navegador muestra una copia vieja.
let version = 'versión local';
try { version = 'versión d' + (Number(require('node:child_process').execSync('git rev-list --count HEAD -- .', { cwd: __dirname }).toString()) + 1); } catch (e) { /* sin git */ }
const html = src('plantilla.html').replace('/*__CODIGO__*/', () => codigo).split('__VERSION__').join(version);
fs.writeFileSync(path.join(__dirname, 'index.html'), html);
console.log('drone/index.html: ' + (html.length / 1024).toFixed(1) + ' KB · ' + version);
