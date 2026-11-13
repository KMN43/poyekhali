// Genera src/land.js: la malla de puntos del mapa del mundo (1 = tierra) a partir de Natural Earth (world-atlas).
//   node make-land.mjs
// Se ejecuta solo cuando se quiera cambiar la resolución; el resultado va en el repositorio.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { geoContains } from 'd3-geo';
import { feature } from 'topojson-client';

const HERE = dirname(fileURLToPath(import.meta.url));
const STEP = 2;                 // grados entre puntos
const LAT_N = 78, LAT_S = -58;  // se recorta la Antártida y el Ártico lejano, como en los mapas de puntos clásicos
const topo = JSON.parse(readFileSync(join(HERE, 'node_modules/world-atlas/land-110m.json'), 'utf8'));
// se separa en polígonos con su caja envolvente: geoContains contra todo el continente es muy lento
const polys = feature(topo, topo.objects.land).features.flatMap(f =>
  f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates.map(c => ({ type: 'Polygon', coordinates: c })) : [f.geometry]);
const boxed = polys.map(p => {
  const xs = p.coordinates[0].map(c => c[0]), ys = p.coordinates[0].map(c => c[1]);
  const span = Math.max(...xs) - Math.min(...xs);
  return { p, w: Math.min(...xs), e: Math.max(...xs), s: Math.min(...ys), n: Math.max(...ys), wide: span > 180 };
});
const land = { contains: ([x, y]) => boxed.some(b => (b.wide || (x >= b.w && x <= b.e)) && y >= b.s - 1 && y <= b.n + 1 && geoContains(b.p, [x, y])) };

const rows = [];
for (let lat = LAT_N - STEP / 2; lat > LAT_S; lat -= STEP) {
  let r = '';
  for (let lon = -180 + STEP / 2; lon < 180; lon += STEP) {
    // se mira el centro y 4 puntos cercanos: así las islas y penínsulas estrechas no desaparecen
    const d = STEP * 0.3;
    const hit = [[0, 0], [d, 0], [-d, 0], [0, d], [0, -d]].filter(([a, b]) => land.contains([lon + a, lat + b])).length;
    r += hit >= 2 ? '1' : '0';
  }
  rows.push(r);
}
const out = `// generado por make-land.mjs — no editar a mano\nwindow.LAND = ${JSON.stringify({ step: STEP, latN: LAT_N, latS: LAT_S, rows })};\n`;
writeFileSync(join(HERE, 'src', 'land.js'), out);
console.log(`land.js: ${rows.length} filas × ${rows[0].length} columnas, ${rows.join('').split('1').length - 1} puntos de tierra`);
