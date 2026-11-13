// Poyekhali · Worker de Cloudflare
// GET /api/catalog → satélites que se pueden escuchar con un RTL-SDR (bandas de 2 m y 70 cm), con sus TLE
//                    actuales (CelesTrak) y los transmisores activos en esas bandas (SatNOGS DB).
// Las respuestas de CelesTrak y SatNOGS se cachean en el borde de Cloudflare (6 h y 12 h) y el catálogo, 1 h.

// Candidatos. Solo se publican los que SatNOGS marca con algún transmisor vivo en las bandas útiles.
const CANDIDATOS = [
  { id: 'meteor23', name: 'Meteor M2-3', norad: 57166, kind: 'meteo', use: 'Imagen LRPT', main: 137.9 },
  { id: 'meteor24', name: 'Meteor M2-4', norad: 59051, kind: 'meteo', use: 'Imagen LRPT', main: 137.9 },
  { id: 'iss', name: 'ISS', norad: 25544, kind: 'tripulada', use: 'Voz FM · SSTV · APRS', main: 145.8 },
  { id: 'so50', name: 'SO-50', norad: 27607, kind: 'amateur', use: 'Repetidor FM', main: 436.795 },
  { id: 'po101', name: 'PO-101', norad: 43678, kind: 'amateur', use: 'Repetidor FM', main: 145.9 },
  { id: 'ao73', name: 'AO-73', norad: 39444, kind: 'amateur', use: 'Telemetría BPSK', main: 145.935 },
  { id: 'ao7', name: 'AO-7', norad: 7530, kind: 'amateur', use: 'Baliza CW', main: 145.978 },
  { id: 'rs44', name: 'RS-44', norad: 44909, kind: 'amateur', use: 'Baliza CW', main: 435.605 },
  { id: 'io117', name: 'IO-117', norad: 53106, kind: 'amateur', use: 'Telemetría FSK', main: 435.31 },
];
const BANDAS = [[136e6, 150e6], [430e6, 440e6]];   // lo que cubre bien un V4 con antenas sencillas
const UA = { 'User-Agent': 'poyekhali-worker (estacion SDR casera)' };
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };

const enBanda = f => BANDAS.some(([a, b]) => f >= a && f <= b);
// época del TLE (columnas 19-32 de la línea 1: AADDD.dddddddd) → días de antigüedad
function tleAgeDays(l1) {
  const yy = parseInt(l1.slice(18, 20), 10), doy = parseFloat(l1.slice(20, 32));
  const epoch = Date.UTC(yy < 57 ? 2000 + yy : 1900 + yy, 0, 1) + (doy - 1) * 86400000;
  return (Date.now() - epoch) / 86400000;
}

// CelesTrak: se piden 3 grupos (pocas peticiones, en serie) y se indexan por número NORAD.
// Si un grupo falla se reintenta con la petición individual del satélite.
const GRUPOS = ['weather', 'amateur', 'stations'];
async function getTle(url) {
  const r = await fetch(url, { headers: UA, cf: { cacheTtl: 21600, cacheEverything: true } });
  if (!r.ok) throw new Error(`CelesTrak ${r.status}`);
  const l = (await r.text()).trim().split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const out = new Map();
  for (let i = 0; i + 2 < l.length + 0; i++) {
    if (l[i + 1]?.startsWith('1 ') && l[i + 2]?.startsWith('2 ')) {
      out.set(parseInt(l[i + 1].slice(2, 7), 10), [l[i + 1], l[i + 2]]);
      i += 2;
    }
  }
  return out;
}
let idxPromise = null;   // los grupos de CelesTrak solo se piden si SatNOGS falla
const lazyIndex = () => (idxPromise ||= tleIndex());
async function tleIndex() {
  const idx = new Map();
  for (const g of GRUPOS) {
    try { for (const [k, v] of await getTle(`https://celestrak.org/NORAD/elements/gp.php?GROUP=${g}&FORMAT=tle`)) idx.set(k, v); } catch {}
  }
  return idx;
}
// Orden: SatNOGS DB (responde bien desde Workers) → grupos de CelesTrak → petición individual a CelesTrak
async function tle(norad, idx) {
  try {
    const r = await fetch(`https://db.satnogs.org/api/tle/?norad_cat_id=${norad}&format=json`,
      { headers: UA, cf: { cacheTtl: 21600, cacheEverything: true } });
    if (r.ok) {
      const t = (await r.json())[0];
      if (t?.tle1?.startsWith('1 ') && t?.tle2?.startsWith('2 ')) return [t.tle1.trim(), t.tle2.trim()];
    }
  } catch {}
  idx = await lazyIndex();
  if (idx.has(norad)) return idx.get(norad);
  const one = await getTle(`https://celestrak.org/NORAD/elements/gp.php?CATNR=${norad}&FORMAT=tle`);
  if (!one.has(norad)) throw new Error('TLE no encontrado');
  return one.get(norad);
}

async function transmisores(norad) {
  const r = await fetch(`https://db.satnogs.org/api/transmitters/?satellite__norad_cat_id=${norad}&format=json`,
    { headers: UA, cf: { cacheTtl: 43200, cacheEverything: true } });
  if (!r.ok) throw new Error(`SatNOGS ${r.status}`);
  const seen = new Set();
  return (await r.json())
    .filter(t => t.alive && t.status === 'active' && t.downlink_low && enBanda(t.downlink_low))
    .map(t => ({ f: +(t.downlink_low / 1e6).toFixed(3), mode: t.mode || '', desc: t.description || '' }))
    .filter(t => { const k = t.f + t.mode; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => a.f - b.f);
}

async function catalogo() {
  idxPromise = null;
  const sats = await Promise.all(CANDIDATOS.map(async c => {
    try {
      const [t, tx] = await Promise.all([tle(c.norad), transmisores(c.norad)]);
      const edad = tleAgeDays(t[0]);
      if (edad > 30) return { ...c, error: `TLE de hace ${Math.round(edad)} días (satélite probablemente inactivo)` };
      return tx.length ? { ...c, tle: t, tx, tleAgeDays: +edad.toFixed(1) } : null;
    } catch (e) {
      return { ...c, error: String(e.message || e) };
    }
  }));
  return { updated: new Date().toISOString(), station: { name: 'Zaragoza', lat: 41.6488, lon: -0.8891, alt: 200 },
    sats: sats.filter(s => s && s.tle && !s.error),
    errors: sats.filter(s => s && s.error && !/inactivo/.test(s.error)).map(s => ({ id: s.id, error: s.error })),
    skipped: sats.filter(s => s && /inactivo/.test(s.error || '')).map(s => ({ id: s.id, reason: s.error })) };
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (url.pathname === '/api/catalog') {
      const cache = caches.default, key = new Request(url.origin + '/api/catalog?v=4');
      let res = await cache.match(key);
      if (!res) {
        const data = await catalogo(), ok = !data.errors.length;
        res = new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': `public, max-age=${ok ? 3600 : 300}`, ...CORS } });
        if (ok) ctx.waitUntil(cache.put(key, res.clone()));   // con errores no se guarda: se reintenta en la siguiente
      }
      return res;
    }
    if (url.pathname === '/') {
      return new Response('Poyekhali · catálogo de satélites en /api/catalog', { headers: { 'Content-Type': 'text/plain; charset=utf-8', ...CORS } });
    }
    return new Response('No encontrado', { status: 404, headers: CORS });
  },
};
