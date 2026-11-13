// Prepara www/ para Capacitor.
//   node build-www.mjs
// Copia src/, añade satellite.js y la versión, y guarda una copia del catálogo actual como respaldo sin conexión.
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// fs.cpSync de Node 24 se cuelga en Windows con rutas con tilde («Estación»): copia propia
function cpSync(from, to) {
  if (statSync(from).isDirectory()) {
    mkdirSync(to, { recursive: true });
    for (const f of readdirSync(from)) cpSync(join(from, f), join(to, f));
  } else copyFileSync(from, to);
}

const HERE = dirname(fileURLToPath(import.meta.url));
const WWW = join(HERE, 'www');
const API = 'https://poyekhali.biblioscan-galaxia.workers.dev/api/catalog';
const VERSION = JSON.parse(readFileSync(join(HERE, 'package.json'), 'utf8')).version;

rmSync(WWW, { recursive: true, force: true });
mkdirSync(join(WWW, 'vendor'), { recursive: true });
cpSync(join(HERE, 'src'), WWW);
cpSync(join(HERE, 'node_modules', 'satellite.js', 'dist', 'satellite.min.js'), join(WWW, 'vendor', 'satellite.min.js'));

let html = readFileSync(join(WWW, 'index.html'), 'utf8');
html = html.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n<script>window.APP_VERSION = '${VERSION}';</script>\n<script src="capacitor.js"></script>`);
writeFileSync(join(WWW, 'index.html'), html);
cpSync(join(HERE, 'node_modules', '@capacitor', 'core', 'dist', 'capacitor.js'), join(WWW, 'capacitor.js'));

// respaldo: si el móvil abre la app por primera vez sin conexión, al menos tiene las órbitas del día de la compilación
let fallback = 'null';
try {
  const r = await fetch(API);
  if (r.ok) fallback = JSON.stringify(await r.json());
} catch {}
writeFileSync(join(WWW, 'fallback.js'), `window.CATALOG_FALLBACK = ${fallback};\n`);
console.log(`www/ listo (v${VERSION}, respaldo ${fallback === 'null' ? 'vacío' : 'incluido'})`);
