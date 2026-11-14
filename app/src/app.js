// Poyekhali — próximas pasadas sobre Zaragoza de los satélites que se pueden escuchar con un RTL-SDR.
// Las órbitas (TLE) y frecuencias llegan del Worker de Cloudflare; las pasadas se calculan en el móvil (SGP4).
(() => {
  'use strict';
  const API = 'https://poyekhali.biblioscan-galaxia.workers.dev/api/catalog';
  const REPO = 'KMN43/poyekhali';
  const HOME = { name: 'Zaragoza', tag: 'ZGZ', lat: 41.6488, lon: -0.8891, alt: 200, home: true };
  const MIN_EL = 10;          // pasadas con elevación máxima inferior no se listan
  const LOW_EL = 25;          // por debajo, se muestran atenuadas
  const D2R = Math.PI / 180, R2D = 180 / Math.PI, RE = 6378.137;
  const S = satellite;

  const $ = id => document.getElementById(id);
  const ls = {
    get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ------------------------------------------------------------------ estado
  let catalog = null;          // { updated, sats:[{id,name,norad,use,main,tx,tle}] }
  let recs = new Map();        // id → satrec
  let passes = [];             // todas las calculadas
  let selected = null;         // pasada elegida
  let days = ls.get('days', 7);
  let pick = ls.get('pick', '*');   // un solo satélite (su id) o '*' = todos
  let computedAt = 0;
  // dónde se calculan las pasadas: casa (Zaragoza) o el punto elegido (GPS o a mano); se guarda solo en el móvil
  const okStation = s => s && Number.isFinite(s.lat) && Number.isFinite(s.lon) && Math.abs(s.lat) <= 90 && Math.abs(s.lon) <= 180;
  let STATION = okStation(ls.get('station', null)) ? ls.get('station', null) : HOME;
  const obs = {};
  const setObs = () => Object.assign(obs, { longitude: STATION.lon * D2R, latitude: STATION.lat * D2R, height: (STATION.alt || 0) / 1000 });
  setObs();

  // ------------------------------------------------------------------ formato
  const tz = 'Europe/Madrid';
  const fTime = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: tz });
  const fDay = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'short', timeZone: tz });
  const fDayShort = new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric', timeZone: tz });
  const dayKey = d => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d);
  const hhmm = d => fTime.format(d);
  const fTimeS = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: tz });
  const hms = d => fTimeS.format(d);
  const p2 = n => String(n).padStart(2, '0');
  // cuenta atrás: T−hh:mm:ss (o T−d días hh h si falta más de un día)
  function tminus(ms) {
    const t = Math.max(0, Math.floor(ms / 1000)), d = Math.floor(t / 86400), h = Math.floor(t % 86400 / 3600), m = Math.floor(t % 3600 / 60), sec = t % 60;
    return d ? `T−${d} d ${p2(h)} h` : `T−${p2(h)}:${p2(m)}:${p2(sec)}`;
  }
  const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
  const card = az => COMPASS[Math.round((((az % 360) + 360) % 360) / 45) % 8];
  const num = (x, d = 0) => x.toFixed(d).replace('.', ',');
  const mhz = f => f.toFixed(3).replace('.', ',');

  // ------------------------------------------------------------------ iconos de luz (16×16, trazo)
  // ciclo día/noche en disco (texturas de 1 bit): sol lleno, medio disco rayado al amanecer (arriba) y al
  // atardecer (abajo), y la luna de noche
  function hatchHalf(upper) {   // rayas a 45° dentro del medio disco de radio 5,2 centrado en (8, 8)
    const R = 5.2; let d = '';
    for (let c = -7; c <= 7; c += 1.75) {
      const q = 2 * R * R - c * c; if (q <= 0) continue;
      let u1 = (c - Math.sqrt(q)) / 2, u2 = (c + Math.sqrt(q)) / 2;
      if (upper) u2 = Math.min(u2, c); else u1 = Math.max(u1, c);
      if (u2 - u1 < 0.2) continue;
      d += `M${(8 + u1).toFixed(2)} ${(8 + u1 - c).toFixed(2)}L${(8 + u2).toFixed(2)} ${(8 + u2 - c).toFixed(2)}`;
    }
    return d;
  }
  const ICON = {
    day: '<circle cx="8" cy="8" r="5.2" class="sun"/>',
    dawn: `<circle cx="8" cy="8" r="5.2"/><path class="hatch" d="${hatchHalf(true)}"/><path d="M1.6 8h12.8"/>`,
    dusk: `<circle cx="8" cy="8" r="5.2"/><path class="hatch" d="${hatchHalf(false)}"/><path d="M1.6 8h12.8"/>`,
    night: '<path d="M10.6 2.4a5.7 5.7 0 1 0 3 9.9 4.6 4.6 0 0 1-3-9.9Z"/>',
  };
  const LIGHT_TXT = { day: 'de día', dawn: 'amanecer', dusk: 'atardecer', night: 'de noche' };
  const icon = (k, cls = 'ico') => `<svg class="${cls}" viewBox="0 0 16 16" aria-label="${LIGHT_TXT[k]}" role="img">${ICON[k]}</svg>`;

  // ------------------------------------------------------------------ órbitas
  function look(rec, date) {
    const pv = S.propagate(rec, date);
    if (!pv || !pv.position) return null;
    const la = S.ecfToLookAngles(obs, S.eciToEcf(pv.position, S.gstime(date)));
    return { el: la.elevation * R2D, az: la.azimuth * R2D };
  }
  function subpoint(rec, date) {
    const pv = S.propagate(rec, date);
    if (!pv || !pv.position) return null;
    const gd = S.eciToGeodetic(pv.position, S.gstime(date));
    return { lon: S.degreesLong(gd.longitude), lat: S.degreesLat(gd.latitude), h: gd.height };
  }
  const elAt = (rec, t) => { const l = look(rec, new Date(t)); return l ? l.el : -90; };

  function findPasses(sat, t0, t1) {
    const rec = recs.get(sat.id), out = [];
    if (!rec) return out;
    const STEP = 60000;
    const cross = (a, b) => {   // bisección hasta ~0,5 s del cruce del horizonte
      let ea = elAt(rec, a);
      for (let i = 0; i < 7; i++) { const m = (a + b) / 2, em = elAt(rec, m); if ((em >= 0) === (ea >= 0)) { a = m; ea = em; } else b = m; }
      return (a + b) / 2;
    };
    let prevT = t0, prevE = elAt(rec, t0), cur = prevE >= 0 ? { aos: t0, max: prevE, tca: t0 } : null;
    for (let t = t0 + STEP; t <= t1 + 30 * 60000; t += STEP) {
      const e = elAt(rec, t);
      if (prevE < 0 && e >= 0) { if (t - STEP > t1) break; cur = { aos: cross(prevT, t), max: e, tca: t }; }
      if (cur && e > cur.max) { cur.max = e; cur.tca = t; }
      if (cur && prevE >= 0 && e < 0) {
        cur.los = cross(prevT, t);
        let a = cur.tca - STEP, b = cur.tca + STEP;   // afinar el máximo: sección áurea
        for (let i = 0; i < 20; i++) {
          const m1 = b - (b - a) / 1.618, m2 = a + (b - a) / 1.618;
          if (elAt(rec, m1) > elAt(rec, m2)) b = m2; else a = m1;
        }
        cur.tca = (a + b) / 2;
        cur.max = elAt(rec, cur.tca);
        if (cur.max >= MIN_EL) {
          const la = look(rec, new Date(cur.aos)), ll = look(rec, new Date(cur.los));
          out.push({ sat, aos: cur.aos, los: cur.los, tca: cur.tca, max: cur.max, azA: la.az, azL: ll.az, light: light(cur.tca) });
        }
        cur = null;
      }
      prevT = t; prevE = e;
    }
    return out;
  }

  // posición del Sol (baja precisión, suficiente para la luz y el terminador)
  function sunRaDec(date) {
    const d = date.getTime() / 86400000 - 10957.5;
    const g = (357.529 + 0.98560028 * d) * D2R, q = 280.459 + 0.98564736 * d;
    const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * D2R, e = (23.439 - 3.6e-7 * d) * D2R;
    return { ra: Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)), dec: Math.asin(Math.sin(e) * Math.sin(L)), gmst: S.gstime(date) };
  }
  // seno de la elevación del Sol en (lat, lon) en grados
  const sunSin = (s, lat, lon) => {
    const la = lat * D2R, ha = s.gmst + lon * D2R - s.ra;
    return Math.sin(la) * Math.sin(s.dec) + Math.cos(la) * Math.cos(s.dec) * Math.cos(ha);
  };
  const sunEl = date => Math.asin(sunSin(sunRaDec(date), STATION.lat, STATION.lon)) * R2D;
  // día (Sol > 6°), noche (< −6°, fin del crepúsculo civil) y, entre medias, amanecer o atardecer
  function light(t) {
    const e = sunEl(new Date(t));
    if (e > 6) return 'day';
    if (e < -6) return 'night';
    return sunEl(new Date(t + 15 * 60000)) > e ? 'dawn' : 'dusk';
  }

  function compute() {
    const now = Date.now(), t0 = now - 20 * 60000, t1 = now + 14 * 86400000;
    passes = catalog.sats.flatMap(s => findPasses(s, t0, t1)).sort((a, b) => a.aos - b.aos);
    computedAt = now;
  }

  // ------------------------------------------------------------------ catálogo
  async function loadCatalog() {
    const cached = ls.get('catalog', null);
    try {
      const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 9000);
      const r = await fetch(API, { signal: ctl.signal, cache: 'no-cache' });
      clearTimeout(to);
      if (!r.ok) throw new Error(r.status);
      const j = await r.json();
      if (!j.sats?.length) throw new Error('vacío');
      ls.set('catalog', j);
      return j;
    } catch {
      return cached || window.CATALOG_FALLBACK || null;
    }
  }
  function useCatalog(c) {
    catalog = c;
    recs = new Map();
    for (const s of c.sats) { try { recs.set(s.id, S.twoline2satrec(s.tle[0], s.tle[1])); } catch {} }
    if (pick !== '*' && !recs.has(pick)) pick = '*';
  }

  // ------------------------------------------------------------------ interfaz: filtro (selección única) y días
  function renderChips() {
    const chip = (id, name, cls = '') => `<button class="chip ${cls}" role="radio" aria-checked="${pick === id}" data-id="${esc(id)}">${esc(name)}</button>`;
    $('chips').innerHTML = chip('*', 'Todos', 'all') + catalog.sats.map(s => chip(s.id, s.name)).join('');
    $('chips').querySelectorAll('.chip[data-id]').forEach(b => { if (b.dataset.id !== '*') b.insertAdjacentHTML('afterbegin', window.SAT_EMBLEM(b.dataset.id)); });
  }
  $('chips').addEventListener('click', e => {
    const b = e.target.closest('.chip'); if (!b || b.dataset.id === pick) return;
    pick = b.dataset.id;
    ls.set('pick', pick);
    renderChips(); renderList(true);
  });
  document.querySelector('.seg').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    days = +b.dataset.days; ls.set('days', days);
    document.querySelectorAll('.seg button').forEach(x => x.setAttribute('aria-pressed', String(+x.dataset.days === days)));
    renderList(false);
  });

  // ------------------------------------------------------------------ interfaz: tabla
  const visible = () => {
    const now = Date.now(), end = now + days * 86400000;
    return passes.filter(p => p.los > now && p.aos < end && (pick === '*' || p.sat.id === pick));
  };
  function renderList(reselect) {
    const list = visible(), now = Date.now();
    if (reselect || !selected || !list.includes(selected)) selected = list[0] || null;
    const keepScroll = $('list').scrollTop;
    let html = '';
    if (!list.length) {
      html = `<div class="empty">No hay pasadas por encima de ${MIN_EL}° con este filtro.</div>`;
    } else {
      html = '<table><thead><tr><th>Hora</th><th>Satélite</th><th>Máx</th><th>Dur</th><th>Ruta</th><th>Luz</th></tr></thead><tbody>';
      let lastDay = '';
      list.forEach((p, i) => {
        const k = dayKey(new Date(p.aos));
        if (k !== lastDay) { lastDay = k; html += `<tr class="day"><td colspan="6">${esc(fDay.format(new Date(p.aos)))}</td></tr>`; }
        const live = p.aos <= now && p.los > now;
        const cls = ['p', p.max < LOW_EL ? 'low' : '', p === selected ? 'sel' : '', live ? 'live' : ''].join(' ');
        html += `<tr class="${cls}" data-i="${i}">
          <td class="t">${live ? '<span>ahora</span>' : hhmm(new Date(p.aos))}</td>
          <td class="sn">${window.SAT_EMBLEM(p.sat.id)}${esc(p.sat.name)}</td>
          <td><span class="el"><span class="bar"><i style="width:${Math.min(100, p.max / 90 * 100).toFixed(0)}%"></i></span>${num(p.max, 1)}°</span></td>
          <td class="r">${Math.round((p.los - p.aos) / 60000)}′</td>
          <td class="r">${card(p.azA)}→${card(p.azL)}</td>
          <td class="lt">${icon(p.light)}</td></tr>`;
      });
      html += '</tbody></table>';
    }
    const age = catalog.updated ? Math.max(0, Math.round((now - Date.parse(catalog.updated)) / 3600000)) : null;
    html += `<div class="foot">
      <div class="legend">${['day', 'dawn', 'dusk', 'night'].map(k => `<span>${icon(k)}${LIGHT_TXT[k]}</span>`).join('')}</div>
      <div>solo pasadas por encima de ${MIN_EL}° · desde ${esc(STATION.name)} · hora peninsular</div>
      <div>${catalog.sats.length} satélites escuchables · órbitas ${age == null ? '' : age < 1 ? 'de hace menos de 1 h' : `de hace ${age} h`}</div></div>`;
    $('list').innerHTML = html;
    $('list').scrollTop = keepScroll;
    $('list')._rows = list;
    renderDetail(); drawMap(); renderSky();
  }
  $('list').addEventListener('click', e => {
    const tr = e.target.closest('tr.p'); if (!tr) return;
    selected = $('list')._rows[+tr.dataset.i];
    document.querySelectorAll('tr.p.sel').forEach(x => x.classList.remove('sel'));
    tr.classList.add('sel');
    renderDetail(); drawMap(); renderSky();
  });

  // ------------------------------------------------------------------ ficha del satélite (página 2 del mapa)
  // órbita calculada del TLE actual: perigeo/apogeo, inclinación y periodo
  function orbitOf(id) {
    const r = recs.get(id); if (!r) return null;
    const ER = 6378.135, a = r.a * ER;
    return { per: a * (1 - r.ecco) - ER, apo: a * (1 + r.ecco) - ER, inc: r.inclo * R2D, min: 2 * Math.PI / r.no };
  }
  let cardFor = null;
  function renderCard(sat) {
    if (!sat || cardFor === sat.id) return;
    cardFor = sat.id;
    const info = window.SAT_INFO[sat.id] || { title: sat.name, org: '—', flag: '', kind: '', year: '—', sends: sat.use, purpose: '—' };
    const o = orbitOf(sat.id);
    const alt = !o ? '—' : Math.abs(o.apo - o.per) < 40 ? `~${num((o.apo + o.per) / 2)} km` : `${num(o.per)}–${num(o.apo)} km`;
    $('card').innerHTML = `<div class="bpw">${window.SAT_VISUAL(sat.id)}</div>
      <div class="info"><h2>${esc(info.title)}</h2><div class="org">${esc(info.org)}${info.flag ? ' · ' + esc(info.flag) : ''}</div>
        <dl>
          <dt>Órbita</dt><dd>${esc(info.kind)}${o ? ` · ${alt} · ${num(o.inc, 1)}° · ${num(o.min)} min` : ''}</dd>
          <dt>Lanzamiento</dt><dd>${esc(info.year)}</dd>
          <dt>Qué envía</dt><dd>${esc(info.sends)}</dd>
          <dt>Para qué sirve</dt><dd>${esc(info.purpose)}</dd>
        </dl>${info.note ? `<div class="note">${esc(info.note)}</div>` : ''}</div>`;
  }
  $('pager').addEventListener('scroll', () => {
    const pg = $('pager'), i = Math.round(pg.scrollLeft / Math.max(1, pg.clientWidth));
    $('tabs').querySelectorAll('button').forEach((d, k) => d.classList.toggle('on', k === i));
  }, { passive: true });
  $('tabs').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    $('pager').scrollTo({ left: +b.dataset.p * $('pager').clientWidth, behavior: 'smooth' });
  });

  function renderDetail() {
    const p = selected;
    renderCard(p ? p.sat : catalog.sats.find(s => s.id === pick) || catalog.sats[0]);
    if (!p) { $('detail').innerHTML = ''; return; }
    const now = Date.now(), live = p.aos <= now && p.los > now;
    const s = p.sat, extra = (s.tx || []).filter(t => Math.abs(t.f - s.main) > 0.002).slice(0, 2).map(t => `${mhz(t.f)} ${t.mode}`).join(' · ');
    $('detail').innerHTML = `<div class="dl">
      <div class="l1"><b>${esc(s.name)}</b><span>${dayKey(new Date(p.aos)) === dayKey(new Date(now)) ? "" : esc(fDayShort.format(new Date(p.aos))) + " · "}${hms(new Date(p.aos))}–${hms(new Date(p.los))}</span></div>
      <div class="l2">${icon(p.light, 'ico sm')} máx ${num(p.max, 1)}° · ${card(p.azA)}→${card(p.azL)} · <b>${mhz(s.main)} MHz</b> ${esc(s.use)}${extra ? ' · ' + esc(extra) : ''}</div></div>
      <div class="cd ${live ? 'live' : ''}" id="cd"><small>${live ? 'en curso · LOS' : 'AOS'}</small><b></b></div>`;
    tick();
  }
  // la cuenta atrás se actualiza cada segundo sin repintar nada más; al empezar o acabar la pasada, se repinta la tabla
  function tick() {
    const p = selected, el = $('cd'); if (!p || !el) return;
    const now = Date.now(), live = p.aos <= now && p.los > now;
    if (now >= p.los || live !== el.classList.contains('live')) { renderList(false); return; }
    el.querySelector('b').textContent = tminus((live ? p.los : p.aos) - now);
  }
  setInterval(tick, 1000);
  new ResizeObserver(() => { if (catalog) renderSky(); }).observe($('sky'));

  // ------------------------------------------------------------------ cielo (página 3): recorrido polar y perfil de elevación
  // dónde está la antena: «tejado» = horizonte libre; «ventana» = máscara medida (solo ángulos, sin coordenadas)
  const SITES = { roof: { name: 'Tejado' }, window: { name: 'Ventana', az0: 114, az1: 214, el: 10 } };
  let site = ls.get('site', 'roof');
  const siteNow = () => STATION.home ? site : 'roof';   // la máscara de la ventana solo vale en casa
  const seen = (az, el) => { const m = SITES[siteNow()]; return el >= 0 && (m.az0 == null || (el >= m.el && az >= m.az0 && az <= m.az1)); };
  function renderSky() {
    const box = $('sky'), p = selected, rec = p && recs.get(p.sat.id);
    if (!rec) { box.innerHTML = '<div class="empty">Elige una pasada en la tabla.</div>'; return; }
    const pts = [], STEP = 2000;
    for (let t = p.aos; t <= p.los + 1; t += STEP) {
      const l = look(rec, new Date(Math.min(t, p.los))); if (!l) continue;
      pts.push({ t: Math.min(t, p.los), el: Math.max(0, l.el), az: l.az, v: seen(l.az, l.el) });
    }
    const now = Date.now(), live = p.aos <= now && p.los > now, win = siteNow() === 'window', m = SITES[siteNow()];
    // tramos seguidos con o sin visión directa (comparten el punto de corte para que la línea no se rompa)
    const runs = [];
    pts.forEach((q, i) => { if (!i || q.v !== pts[i - 1].v) runs.push({ v: q.v, pts: i ? [pts[i - 1]] : [] }); runs[runs.length - 1].pts.push(q); });
    const vis = pts.filter(q => q.v), visSec = vis.length ? Math.round((vis[vis.length - 1].t - vis[0].t) / 1000) : 0;
    // tamaños reales de la página: el polar es cuadrado; el perfil ocupa el resto, bajo la barra del selector
    const TB = 22, bw = (box.clientWidth || 375) - 32, bh = (box.clientHeight || 220) - TB, ps = Math.round(Math.min(bh, bw * 0.46));
    const f = n => n.toFixed(1);
    const hatch = (id, k) => `<defs><pattern id="${id}" width="${k}" height="${k}" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0V${k}" style="stroke:var(--ink);stroke-opacity:.32" stroke-width="${k / 4}"/></pattern></defs>`;
    // polar: el centro es el cenit, el borde el horizonte; N arriba, E a la derecha
    const R = 50, C = 62;
    const P = (az, el) => { const r = R * (90 - el) / 90; return [C + r * Math.sin(az * D2R), C - r * Math.cos(az * D2R)]; };
    const pp = a => a.map((q, i) => (i ? 'L' : 'M') + P(q.az, q.el).map(f).join(' ')).join('');
    let shadeP = '';
    if (win) {   // todo el disco menos el sector visible (de az0 a az1, por encima de el)
      const r = R * (90 - m.el) / 90, [x0, y0] = P(m.az0, m.el), [x1, y1] = P(m.az1, m.el);
      shadeP = `<path fill="url(#hzp)" fill-rule="evenodd" d="M${C - R} ${C}a${R} ${R} 0 1 0 ${2 * R} 0a${R} ${R} 0 1 0 ${-2 * R} 0Z M${C} ${C}L${f(x0)} ${f(y0)}A${f(r)} ${f(r)} 0 ${m.az1 - m.az0 > 180 ? 1 : 0} 1 ${f(x1)} ${f(y1)}Z"/>
        <path class="g3" d="M${C} ${C}L${f(x0)} ${f(y0)}A${f(r)} ${f(r)} 0 ${m.az1 - m.az0 > 180 ? 1 : 0} 1 ${f(x1)} ${f(y1)}Z"/>`;
    }
    const trkP = runs.map(r => `<path class="${r.v ? 'trk' : 'trk0'}" d="${pp(r.pts)}"/>`).join('');
    const [ax, ay] = P(p.azA, 0), [lx, ly] = P(p.azL, 0), mx = pts.reduce((a, b) => b.el > a.el ? b : a), [tx, ty] = P(mx.az, mx.el);
    const b = pts[Math.max(0, pts.length - 3)], [bx, by] = P(b.az, b.el), ang = Math.atan2(ly - by, lx - bx);
    const arrow = `M${f(lx + 5 * Math.cos(ang))} ${f(ly + 5 * Math.sin(ang))}L${f(lx + 4.5 * Math.cos(ang + 2.5))} ${f(ly + 4.5 * Math.sin(ang + 2.5))}L${f(lx + 4.5 * Math.cos(ang - 2.5))} ${f(ly + 4.5 * Math.sin(ang - 2.5))}Z`;
    let nowMark = '';
    if (live) { const l = look(rec, new Date(now)); if (l) { const [nx, ny] = P(l.az, Math.max(0, l.el)); nowMark = `<circle cx="${f(nx)}" cy="${f(ny)}" r="4" fill="var(--paper)" stroke="var(--ink)" stroke-width="1.4"/>`; } }
    const lab = (az, txt) => { const [x, y] = P(az, -9); return `<text x="${f(x)}" y="${f(y + 3)}" text-anchor="middle" class="k">${txt}</text>`; };
    const polar = `<svg class="polar" viewBox="0 0 124 124" width="${ps}" height="${ps}" role="img" aria-label="Recorrido en el cielo">${hatch('hzp', 2.6)}
      ${shadeP}
      <circle class="g" cx="${C}" cy="${C}" r="${R}"/><circle class="g" cx="${C}" cy="${C}" r="${f(R * 2 / 3)}"/><circle class="g" cx="${C}" cy="${C}" r="${f(R / 3)}"/>
      <path class="g" d="M${C - R} ${C}H${C + R}M${C} ${C - R}V${C + R}"/>
      <text x="${C + 2}" y="${f(C - R / 3 - 2)}">60°</text><text x="${C + 2}" y="${f(C - R * 2 / 3 - 2)}">30°</text>
      ${lab(0, 'N')}${lab(90, 'E')}${lab(180, 'S')}${lab(270, 'O')}
      ${trkP}<path d="${arrow}" fill="var(--ink)"/>
      <circle cx="${f(ax)}" cy="${f(ay)}" r="2.6" fill="var(--paper)" stroke="var(--ink)" stroke-width="1.2"/>
      <circle cx="${f(tx)}" cy="${f(ty)}" r="2.4" fill="var(--ink)"/>
      ${nowMark}</svg>`;
    // perfil: elevación frente al tiempo; en «ventana», bandas rayadas donde no hay visión directa
    const W = Math.max(120, bw - ps - 10), H = bh, l0 = 24, r0 = 6, t0 = 10, b0 = 26, iw = W - l0 - r0, ih = H - t0 - b0;
    const top = Math.max(30, Math.ceil(p.max / 15) * 15);
    const xs = t => l0 + (t - p.aos) / (p.los - p.aos) * iw, ys = e => t0 + ih - e / top * ih;
    let grid = '';
    for (let e = 0; e <= top; e += 15) grid += `<path class="g" d="M${l0} ${f(ys(e))}H${l0 + iw}"/><text x="${l0 - 3}" y="${f(ys(e) + 3)}" text-anchor="end">${e}°</text>`;
    const good = LOW_EL <= top ? `<path class="g2" d="M${l0} ${f(ys(LOW_EL))}H${l0 + iw}"/><text x="${l0 + 3}" y="${f(ys(LOW_EL) - 3)}">buena señal</text>` : '';
    const shadeF = win ? runs.filter(r => !r.v).map(r => { const a = xs(r.pts[0].t), z = xs(r.pts[r.pts.length - 1].t); return `<rect x="${f(a)}" y="${t0}" width="${f(Math.max(0.5, z - a))}" height="${ih}" fill="url(#hzf)"/>`; }).join('') : '';
    const pl = a => a.map((q, i) => (i ? 'L' : 'M') + f(xs(q.t)) + ' ' + f(ys(q.el))).join('');
    const line = pl(pts), trkF = runs.map(r => `<path class="${r.v ? 'trk' : 'trk0'}" d="${pl(r.pts)}"/>`).join('');
    const area = `${line}L${f(xs(p.los))} ${f(ys(0))}L${f(xs(p.aos))} ${f(ys(0))}Z`;
    const tl = (t, txt, anchor) => `<text x="${f(xs(t))}" y="${H - 14}" text-anchor="${anchor}">${txt}</text><text x="${f(xs(t))}" y="${H - 4}" text-anchor="${anchor}" class="k">${hhmm(new Date(t))}</text>`;
    const nowLine = live ? `<path class="now" d="M${f(xs(now))} ${t0}V${t0 + ih}"/>` : '';
    const prof = `<svg class="prof" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Perfil de elevación">${hatch('hzf', 4)}
      ${shadeF}${grid}${good}<path class="area" d="${area}"/>${trkF}${nowLine}
      <circle cx="${f(xs(p.tca))}" cy="${f(ys(p.max))}" r="2.4" fill="var(--ink)"/>
      <text x="${f(xs(p.tca))}" y="${f(ys(p.max) - 5)}" text-anchor="middle" class="k">${num(p.max, 1)}°</text>
      ${tl(p.aos, 'AOS ' + card(p.azA), 'start')}${tl(p.tca, 'máx', 'middle')}${tl(p.los, 'LOS ' + card(p.azL), 'end')}</svg>`;
    // barra: selector y, en «ventana», cuándo hay visión directa
    const info = !STATION.home ? `horizonte libre · ${esc(STATION.name)}` : !win ? 'horizonte libre'
      : vis.length ? `visión directa ${hms(new Date(vis[0].t))}–${hms(new Date(vis[vis.length - 1].t))} · ${Math.floor(visSec / 60)}:${p2(visSec % 60)}`
      : 'sin visión directa';
    const segB = Object.keys(SITES).map(k => `<button data-site="${k}" aria-pressed="${k === site}">${SITES[k].name}</button>`).join('');
    box.innerHTML = `<div class="skt">${STATION.home ? `<div class="seg mini" role="group" aria-label="Dónde está la antena">${segB}</div>` : ''}<span>${info}</span></div><div class="skb">${polar}${prof}</div>`;
  }
  $('sky').addEventListener('click', e => {
    const b = e.target.closest('[data-site]'); if (!b || b.dataset.site === site) return;
    site = b.dataset.site; ls.set('site', site); renderSky();
  });

  // ------------------------------------------------------------------ mapa de puntos
  const cv = $('map'), ctx = cv.getContext('2d');
  const INK = '29,28,26', PAPER = '#efece5';
  function drawMap() {
    const dpr = window.devicePixelRatio || 1, cw = cv.clientWidth, ch = cv.clientHeight;
    if (!cw || !ch) return;
    cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    const L = window.LAND, latSpan = L.latN - L.latS;
    const k = Math.min(cw / 360, ch / latSpan), W = 360 * k, H = latSpan * k, ox = (cw - W) / 2, oy = (ch - H) / 2;
    const X = lon => ox + (lon + 180) * k, Y = lat => oy + (L.latN - lat) * k;

    // horizonte de visión (en la culminación): los puntos de tierra dentro se oscurecen
    let foot = null;
    const rec = selected && recs.get(selected.sat.id);
    if (rec) {
      const sp = subpoint(rec, new Date(selected.tca));
      if (sp) foot = { lat: STATION.lat * D2R, lon: STATION.lon * D2R, r: Math.acos(RE / (RE + sp.h)) };
    }
    const inFoot = (lat, lon) => {
      if (!foot) return false;
      const a = lat * D2R, b = lon * D2R;
      return Math.acos(Math.min(1, Math.sin(a) * Math.sin(foot.lat) + Math.cos(a) * Math.cos(foot.lat) * Math.cos(b - foot.lon))) < foot.r;
    };
    // día y noche en el instante de la culminación (o ahora): de día la tierra apenas se ve; de noche es densa y el mar se puntea
    const sun = sunRaDec(new Date(selected ? selected.tca : Date.now()));
    const r = Math.max(0.8, L.step * k * 0.3);
    L.rows.forEach((row, j) => {
      const lat = L.latN - L.step / 2 - j * L.step;
      for (let i = 0; i < row.length; i++) {
        const lon = -180 + L.step / 2 + i * L.step, night = sunSin(sun, lat, lon) < 0;
        if (row.charCodeAt(i) === 49) {
          ctx.fillStyle = `rgba(${INK},${inFoot(lat, lon) ? 0.9 : night ? 0.5 : 0.13})`;
          ctx.beginPath(); ctx.arc(X(lon), Y(lat), r, 0, 7); ctx.fill();
        } else if (night && (i + j) % 2 === 0) {
          ctx.fillStyle = `rgba(${INK},.26)`;
          ctx.beginPath(); ctx.arc(X(lon), Y(lat), r * 0.5, 0, 7); ctx.fill();
        }
      }
    });
    if (foot) {
      ctx.strokeStyle = `rgba(${INK},.4)`; ctx.lineWidth = 0.8; ctx.setLineDash([1.5, 3]);
      polyline(circlePts(foot), X, Y); ctx.setLineDash([]);
    }

    if (rec) {
      // trayectoria ±50 min: muy fina donde no se ve, gruesa dentro del horizonte (elevación > 0)
      const pts = [];
      for (let t = selected.tca - 50 * 60000; t <= selected.tca + 50 * 60000; t += 20000) {
        const sp = subpoint(rec, new Date(t)); if (!sp) continue;
        sp.vis = elAt(rec, t) >= 0;
        pts.push(sp);
      }
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.strokeStyle = `rgba(${INK},.55)`; ctx.lineWidth = 0.6;
      polyline(pts, X, Y);
      let run = [];
      const flush = () => {
        if (run.length > 1) {
          // tramo visible: halo de papel y trazo grueso de tinta
          ctx.strokeStyle = PAPER; ctx.lineWidth = 5.5; polyline(run, X, Y);
          ctx.strokeStyle = `rgb(${INK})`; ctx.lineWidth = 3; polyline(run, X, Y);
          const a = run[run.length - 2], b = run[run.length - 1];   // flecha en el sentido de avance
          if (Math.abs(b.lon - a.lon) < 180) {
            const ang = Math.atan2(Y(b.lat) - Y(a.lat), X(b.lon) - X(a.lon)), x = X(b.lon), y = Y(b.lat);
            ctx.fillStyle = `rgb(${INK})`; ctx.beginPath();
            ctx.moveTo(x + 6.5 * Math.cos(ang), y + 6.5 * Math.sin(ang));
            ctx.lineTo(x + 5.5 * Math.cos(ang + 2.5), y + 5.5 * Math.sin(ang + 2.5));
            ctx.lineTo(x + 5.5 * Math.cos(ang - 2.5), y + 5.5 * Math.sin(ang - 2.5));
            ctx.fill();
          }
        }
        run = [];
      };
      pts.forEach(p => { if (p.vis) run.push(p); else flush(); });
      flush();
      // satélite en la culminación
      const c = subpoint(rec, new Date(selected.tca));
      if (c) {
        ctx.fillStyle = PAPER; ctx.beginPath(); ctx.arc(X(c.lon), Y(c.lat), 6, 0, 7); ctx.fill();
        ctx.fillStyle = `rgb(${INK})`; ctx.beginPath(); ctx.arc(X(c.lon), Y(c.lat), 4.4, 0, 7); ctx.fill();
        ctx.fillStyle = PAPER; ctx.beginPath(); ctx.arc(X(c.lon), Y(c.lat), 1.5, 0, 7); ctx.fill();
      }
    }

    // la estación
    const sx = X(STATION.lon), sy = Y(STATION.lat);
    ctx.strokeStyle = `rgb(${INK})`; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(sx, sy, 4.5, 0, 7); ctx.stroke();
    ctx.fillStyle = `rgb(${INK})`; ctx.beginPath(); ctx.arc(sx, sy, 1.4, 0, 7); ctx.fill();
  }
  function circlePts(f) {
    const out = [];
    for (let i = 0; i <= 120; i++) {
      const brg = i / 120 * 2 * Math.PI;
      const lat = Math.asin(Math.sin(f.lat) * Math.cos(f.r) + Math.cos(f.lat) * Math.sin(f.r) * Math.cos(brg));
      const lon = f.lon + Math.atan2(Math.sin(brg) * Math.sin(f.r) * Math.cos(f.lat), Math.cos(f.r) - Math.sin(f.lat) * Math.sin(lat));
      out.push({ lat: lat * R2D, lon: ((lon * R2D + 540) % 360) - 180 });
    }
    return out;
  }
  function polyline(pts, X, Y) {   // corta la línea al cruzar el antimeridiano
    ctx.beginPath();
    pts.forEach((p, i) => {
      if (!i || Math.abs(p.lon - pts[i - 1].lon) > 180) ctx.moveTo(X(p.lon), Y(p.lat));
      else ctx.lineTo(X(p.lon), Y(p.lat));
    });
    ctx.stroke();
  }
  new ResizeObserver(() => drawMap()).observe(cv);

  // ------------------------------------------------------------------ actualizaciones
  // al abrir (en silencio) y con «buscar actualizaciones»: mira la última Release de GitHub; si es más nueva,
  // descarga la APK dentro de la app y abre el instalador de Android (va firmada con la misma clave: se instala encima)
  const NATIVE = !!window.Capacitor?.isNativePlatform?.();
  const Installer = NATIVE ? window.Capacitor.registerPlugin('ApkInstaller') : null;
  const vparts = v => String(v || '').replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
  const newer = (a, b) => { const x = vparts(a), y = vparts(b); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };
  let updTimer = 0, installing = false;
  function updBar(html, autohide) {
    const u = $('upd');
    clearTimeout(updTimer);
    u.innerHTML = html; u.hidden = false;
    if (autohide) updTimer = setTimeout(() => { u.hidden = true; }, autohide);
  }
  async function latestRelease() {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { cache: 'no-cache' });
    if (!r.ok) throw new Error(r.status);
    const rel = await r.json(), apk = (rel.assets || []).find(a => /\.apk$/i.test(a.name));
    return { tag: rel.tag_name, apk: apk?.browser_download_url || null };
  }
  async function checkUpdate(manual) {
    const mine = window.APP_VERSION;
    if (manual) updBar('<span>Buscando actualizaciones…</span>');
    try {
      const { tag, apk } = await latestRelease();
      if (apk && newer(tag, mine)) {
        updBar(`<span><b>Nueva versión ${esc(tag.replace(/^v/i, ''))}</b> · tienes la ${esc(mine)}</span>
          <button id="updGo" class="btn">Instalar</button><button id="updNo" class="lnk" aria-label="Ahora no">×</button>
          <i class="prog"><i id="updProg"></i></i>`);
        $('updNo').onclick = () => { $('upd').hidden = true; };
        $('updGo').onclick = () => installUpdate(apk);
      } else if (manual) {
        updBar(`<span>Estás al día · v${esc(mine)}</span>`, 3500);
      }
    } catch {
      if (manual) updBar('<span>No se pudo consultar GitHub · ¿hay conexión?</span>', 4000);
    }
  }
  const say = t => { const s = $('upd').querySelector('span'); if (s) s.textContent = t; };
  const waitPermission = () => new Promise(res => {   // tras abrir Ajustes no llega aviso de vuelta: se pregunta cada segundo
    const t0 = Date.now();
    const tick = async () => {
      let ok = false;
      try { ok = (await Installer.canInstall()).allowed; } catch {}
      if (ok || Date.now() - t0 > 180000) return res(ok);
      setTimeout(tick, 1000);
    };
    setTimeout(tick, 1000);
  });
  async function installUpdate(url) {
    if (!Installer) { location.href = url; return; }   // navegador: descarga normal
    if (installing) return;
    installing = true;
    try {
      if (!(await Installer.canInstall()).allowed) {   // solo la primera vez
        say('Activa «Permitir de esta fuente» y vuelve');
        await Installer.openInstallSettings();
        if (!(await waitPermission())) { say('Sin permiso para instalar · vuelve a intentarlo'); return; }
      }
      say('Descargando…');
      const h = await Installer.addListener('progress', p => {
        say(p.percent >= 0 ? `Descargando ${p.percent} %` : 'Descargando…');
        const bar = $('updProg'); if (bar) bar.style.width = Math.max(0, p.percent) + '%';
      });
      let res;
      try { res = await Installer.download({ url }); } finally { h.remove(); }
      say('Abriendo el instalador…');
      await Installer.install({ path: res.path });
    } catch (e) {
      if (e?.code === 'UNIMPLEMENTED') { location.href = url; return; }
      say('No se pudo actualizar: ' + (e?.message || e));
    } finally { installing = false; }
  }

  // cabecera técnica: estación, satélites y antigüedad del TLE más viejo
  function metaLine() {
    const ages = [...recs.values()].map(r => (Date.now() - (r.jdsatepoch - 2440587.5) * 86400000) / 86400000);
    const tle = ages.length ? `TLE≤${num(Math.max(...ages), 1)} d` : 'TLE —';
    return `${esc(STATION.tag || 'GPS')} ${llTxt(STATION)} · ${recs.size} SAT · ${tle}`;
  }
  const llTxt = s => `${num(Math.abs(s.lat), 2)}${s.lat >= 0 ? 'N' : 'S'} ${num(Math.abs(s.lon), 2)}${s.lon >= 0 ? 'E' : 'O'}`;

  // ------------------------------------------------------------------ ubicación: casa, GPS o a mano (por si vas al campo)
  const tagOf = n => (String(n).normalize('NFD').replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'GPS');
  function setStation(st) {
    STATION = st; ls.set('station', st); setObs();
    if (!st.home) {   // recientes: los 4 últimos puntos que no son casa
      const same = q => Math.abs(q.lat - st.lat) < 0.001 && Math.abs(q.lon - st.lon) < 0.001;
      ls.set('places', [st, ...ls.get('places', []).filter(q => okStation(q) && !same(q))].slice(0, 4));
    }
    $('where').textContent = metaLine();
    if (catalog) { compute(); renderList(true); }
  }
  // «41.65, -0.88» (como lo copia Google Maps), «41,65 -0,88» o «41.65N 0.88O»
  function parseLL(s) {
    s = String(s).trim().toUpperCase();
    const parts = (s.includes('.') ? s.split(/[,;\s]+/) : s.split(/[;\s]+/)).filter(Boolean);
    if (parts.length !== 2) return null;
    const [lat, lon] = parts.map(p => { const n = parseFloat(p.replace(',', '.').replace(/[NSEWO°]/g, '')); return /[SWO]$/.test(p) ? -n : n; });
    return okStation({ lat, lon }) ? { lat, lon } : null;
  }
  const PIN = '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 14.6s4.6-4.3 4.6-7.8a4.6 4.6 0 0 0-9.2 0c0 3.5 4.6 7.8 4.6 7.8Z"/><circle cx="8" cy="6.8" r="1.6"/></svg>';
  function openLoc() {
    const cur = s => !!s.home === !!STATION.home && Math.abs(s.lat - STATION.lat) < 0.001 && Math.abs(s.lon - STATION.lon) < 0.001;
    const opt = (s, i) => `<button class="opt" data-pl="${i}" aria-pressed="${cur(s)}"><b>${s.home ? 'Casa · ' : ''}${esc(s.name)}</b><small>${llTxt(s)}${s.home ? '' : ' · ' + num(s.alt || 0) + ' m'}</small></button>`;
    const places = ls.get('places', []).filter(okStation);
    $('sheetIn').innerHTML = `
      <div class="hd"><span class="pin">${PIN}</span><div><b>Ubicación</b><span>${esc(STATION.name)} · ${llTxt(STATION)}</span></div><button class="x" id="sx" aria-label="Cerrar">×</button></div>
      <p>Las pasadas, el mapa y el cielo se calculan para este punto. Se guarda solo en el móvil.</p>
      <div class="locs">${opt(HOME, -1)}
        <button class="opt" id="lGps"><b>Mi posición (GPS)</b><small id="gpsMsg">usa la ubicación del móvil</small></button>
        ${places.map((s, i) => opt(s, i)).join('')}</div>
      <h3>A mano</h3>
      <div class="man"><input id="lCoord" placeholder="41.65, -0.88" autocomplete="off" spellcheck="false" aria-label="Latitud y longitud">
        <input id="lName" placeholder="Nombre (opcional)" autocomplete="off" aria-label="Nombre del sitio"><button class="btn" id="lOk">Usar</button></div>
      <p class="k" id="manMsg">Latitud y longitud en grados decimales, tal cual las copia Google Maps (mantén pulsado un punto del mapa).</p>`;
    $('sheet').hidden = false;
    $('sx').onclick = closeInfo;
    $('sheetIn').querySelectorAll('[data-pl]').forEach(b => b.onclick = () => {
      const i = +b.dataset.pl; setStation(i < 0 ? HOME : places[i]); closeInfo();
    });
    $('lGps').onclick = () => {
      const msg = $('gpsMsg');
      if (!navigator.geolocation) { msg.textContent = 'este dispositivo no da la ubicación'; return; }
      msg.textContent = 'buscando…';
      navigator.geolocation.getCurrentPosition(pos => {
        const c = pos.coords;
        setStation({ name: 'Mi posición', tag: 'GPS', lat: +c.latitude.toFixed(5), lon: +c.longitude.toFixed(5), alt: Math.round(c.altitude || 0) });
        closeInfo();
      }, err => {
        msg.textContent = err.code === 1 ? 'sin permiso · actívalo en Ajustes › Apps › Poyekhali › Ubicación' : 'no se pudo obtener la posición · prueba al aire libre';
      }, { enableHighAccuracy: false, timeout: 20000, maximumAge: 600000 });
    };
    $('lOk').onclick = () => {
      const ll = parseLL($('lCoord').value);
      if (!ll) { $('manMsg').textContent = 'No lo entiendo: escribe «latitud, longitud», p. ej. 42.12, -0.45'; return; }
      const name = $('lName').value.trim().slice(0, 24) || 'Punto manual';
      setStation({ name, tag: tagOf(name), lat: ll.lat, lon: ll.lon, alt: 0 });
      closeInfo();
    };
  }

  // ------------------------------------------------------------------ banda inferior: info, actualizar y compartir
  const APK_URL = `https://github.com/${REPO}/releases/latest/download/Poyekhali.apk`;
  const Sharer = NATIVE ? window.Capacitor.registerPlugin('Share') : null;
  async function share() {
    const text = 'Poyekhali: las próximas pasadas sobre Zaragoza de los satélites que se pueden escuchar con un RTL-SDR. App para Android:';
    try {
      if (Sharer) { await Sharer.share({ title: 'Poyekhali', text, url: APK_URL, dialogTitle: 'Compartir Poyekhali' }); return; }
      if (navigator.share) { await navigator.share({ title: 'Poyekhali', text, url: APK_URL }); return; }
    } catch (e) {
      if (e?.name === 'AbortError' || /cancel/i.test(e?.message || '')) return;   // el usuario cerró el menú
    }
    try { await navigator.clipboard.writeText(APK_URL); updBar('<span>Enlace de descarga copiado</span>', 3000); }
    catch { updBar(`<span>${esc(APK_URL)}</span>`, 8000); }
  }
  function openInfo() {
    const n = catalog ? catalog.sats.length : 0;
    $('sheetIn').innerHTML = `
      <div class="hd"><svg class="logo" viewBox="0 0 100 100" aria-hidden="true"><use href="#logo"/></svg>
        <div><b>Poyekhali</b><span>Поехали · v${esc(window.APP_VERSION || '')}</span></div><button class="x" id="sx" aria-label="Cerrar">×</button></div>
      <p>Las próximas pasadas sobre <b>${esc(STATION.name)}</b> de los satélites que se pueden escuchar con un RTL-SDR (2 m y 70 cm): ${n} ahora mismo.</p>
      <p>«¡Поехали!» (<i>¡vámonos!</i>) es lo que dijo Gagarin al despegar, el 12 de abril de 1961.</p>
      <h3>Cómo se usa</h3>
      <ul><li>Toca una pasada de la tabla para verla en el mapa.</li>
        <li>Desliza arriba (o toca <b>01 · 02 · 03</b>): mapa, ficha del satélite y cielo con el recorrido y la elevación.</li>
        <li><b>Lugar</b> (o tocar la línea de coordenadas): calcula para tu posición GPS o un punto escrito a mano; vuelve a casa con un toque.</li>
        <li>Por debajo de ${LOW_EL}° la señal suele ser floja: esas pasadas salen atenuadas. Las de menos de ${MIN_EL}° no se listan.</li></ul>
      <h3>Luz en la culminación</h3>
      <div class="legend">${['day', 'dawn', 'dusk', 'night'].map(k => `<span>${icon(k)}${LIGHT_TXT[k]}</span>`).join('')}</div>
      <h3>De dónde salen los datos</h3>
      <ul><li>Órbitas (TLE) de SatNOGS DB, con CelesTrak de reserva, y frecuencias activas de SatNOGS, a través de un servidor propio en Cloudflare. Se renuevan cada hora.</li>
        <li>Las pasadas se calculan en el móvil con SGP4 (satellite.js), con precisión de 1 s. Funciona sin conexión con las últimas órbitas guardadas.</li>
        <li>Mapa: Natural Earth (dominio público).</li></ul>
      <h3>Créditos</h3>
      <ul><li>Tipografías Fira Code y Space Grotesk (SIL OFL 1.1).</li>
        <li>Fotos de los satélites: la licencia de cada una va al pie de su ficha.</li>
        <li>Código abierto: <a href="https://github.com/${REPO}" target="_blank" rel="noopener">github.com/${REPO}</a></li></ul>`;
    $('sheet').hidden = false;
    $('sx').onclick = closeInfo;
  }
  const closeInfo = () => { $('sheet').hidden = true; };
  $('sheet').addEventListener('click', e => { if (e.target === $('sheet')) closeInfo(); });
  $('bInfo').addEventListener('click', openInfo);
  $('bUpd').addEventListener('click', () => checkUpdate(true));
  $('bShare').addEventListener('click', share);
  $('bLoc').addEventListener('click', openLoc);
  $('where').addEventListener('click', openLoc);

  // ------------------------------------------------------------------ arranque
  async function start(fresh) {
    const c = await loadCatalog();
    if (!c) { $('list').innerHTML = '<div class="empty">Sin conexión y sin datos guardados. Abre la app con Internet una vez.</div>'; return; }
    useCatalog(c);
    $('where').textContent = metaLine();
    renderChips();
    compute();
    renderList(fresh);
    if (location.hash === '#info') openInfo();   // para capturas
    if (location.hash === '#lugar') openLoc();
    const pg = { '#ficha': 1, '#cielo': 2 }[location.hash];   // para capturas
    if (pg) requestAnimationFrame(() => $('pager').scrollTo({ left: pg * $('pager').clientWidth }));
  }
  document.querySelectorAll('.seg button').forEach(x => x.setAttribute('aria-pressed', String(+x.dataset.days === days)));
  $('list').innerHTML = '<div class="empty">Calculando pasadas…</div>';
  start(true);
  if (NATIVE) checkUpdate(false);
  setInterval(() => { if (catalog) renderList(false); }, 60000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && catalog && Date.now() - computedAt > 3600000) start(false);
  });
})();
