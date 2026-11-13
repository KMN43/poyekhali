// Poyekhali — próximas pasadas sobre Zaragoza de los satélites que se pueden escuchar con un RTL-SDR.
// Las órbitas (TLE) y frecuencias llegan del Worker de Cloudflare; las pasadas se calculan en el móvil (SGP4).
(() => {
  'use strict';
  const API = 'https://poyekhali.biblioscan-galaxia.workers.dev/api/catalog';
  const REPO = 'KMN43/poyekhali';
  const STATION = { name: 'Zaragoza', lat: 41.6488, lon: -0.8891, alt: 200 };
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
  const obs = { longitude: STATION.lon * D2R, latitude: STATION.lat * D2R, height: STATION.alt / 1000 };

  // ------------------------------------------------------------------ formato
  const tz = 'Europe/Madrid';
  const fTime = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: tz });
  const fDay = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'short', timeZone: tz });
  const fDayShort = new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric', timeZone: tz });
  const dayKey = d => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d);
  const hhmm = d => fTime.format(d);
  const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
  const card = az => COMPASS[Math.round((((az % 360) + 360) % 360) / 45) % 8];
  const mhz = f => f.toFixed(3).replace('.', ',');
  function until(ms) {
    const m = Math.round(ms / 60000);
    if (m < 1) return 'ya';
    if (m < 60) return `en ${m} min`;
    const h = Math.floor(m / 60), r = m % 60;
    if (h < 24) return `en ${h} h${r ? ' ' + r + ' min' : ''}`;
    return `en ${Math.floor(h / 24)} d ${h % 24} h`;
  }

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
          <td class="t">${live ? 'ahora' : hhmm(new Date(p.aos))}</td>
          <td class="sn">${window.SAT_EMBLEM(p.sat.id)}${esc(p.sat.name)}</td>
          <td><span class="el"><span class="bar"><i style="width:${Math.min(100, p.max / 90 * 100).toFixed(0)}%"></i></span>${Math.round(p.max)}°</span></td>
          <td class="r">${Math.round((p.los - p.aos) / 60000)}′</td>
          <td class="r">${card(p.azA)}→${card(p.azL)}</td>
          <td class="lt">${icon(p.light)}</td></tr>`;
      });
      html += '</tbody></table>';
    }
    const age = catalog.updated ? Math.max(0, Math.round((now - Date.parse(catalog.updated)) / 3600000)) : null;
    html += `<div class="foot">
      <div class="legend">${['day', 'dawn', 'dusk', 'night'].map(k => `<span>${icon(k)}${LIGHT_TXT[k]}</span>`).join('')}</div>
      <div>solo pasadas por encima de ${MIN_EL}° · horas de ${esc(STATION.name)}</div>
      <div>${catalog.sats.length} satélites escuchables · órbitas ${age == null ? '' : age < 1 ? 'de hace menos de 1 h' : `de hace ${age} h`}</div>
      <button id="chk" class="lnk">v${esc(window.APP_VERSION || '')} · buscar actualizaciones</button></div>`;
    $('list').innerHTML = html;
    $('list').scrollTop = keepScroll;
    $('list')._rows = list;
    renderDetail(); drawMap();
  }
  $('list').addEventListener('click', e => {
    if (e.target.closest('#chk')) { checkUpdate(true); return; }
    const tr = e.target.closest('tr.p'); if (!tr) return;
    selected = $('list')._rows[+tr.dataset.i];
    document.querySelectorAll('tr.p.sel').forEach(x => x.classList.remove('sel'));
    tr.classList.add('sel');
    renderDetail(); drawMap();
  });

  // ------------------------------------------------------------------ ficha del satélite (página 2 del mapa)
  // órbita calculada del TLE actual: perigeo/apogeo, inclinación y periodo
  function orbitOf(id) {
    const r = recs.get(id); if (!r) return null;
    const ER = 6378.135, a = r.a * ER;
    return { per: a * (1 - r.ecco) - ER, apo: a * (1 + r.ecco) - ER, inc: r.inclo * R2D, min: 2 * Math.PI / r.no };
  }
  const num = (x, d = 0) => x.toFixed(d).replace('.', ',');
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
    $('dots').querySelectorAll('i').forEach((d, k) => d.classList.toggle('on', k === i));
  }, { passive: true });

  function renderDetail() {
    const p = selected;
    renderCard(p ? p.sat : catalog.sats.find(s => s.id === pick) || catalog.sats[0]);
    if (!p) { $('detail').innerHTML = ''; return; }
    const now = Date.now(), live = p.aos <= now && p.los > now;
    const s = p.sat, extra = (s.tx || []).filter(t => Math.abs(t.f - s.main) > 0.002).slice(0, 2).map(t => `${mhz(t.f)} ${t.mode}`).join(' · ');
    $('detail').innerHTML = `
      <div class="l1"><b>${esc(s.name)}</b><span>${esc(fDayShort.format(new Date(p.aos)))} · ${hhmm(new Date(p.aos))}–${hhmm(new Date(p.los))}</span>
        <span class="when ${live ? 'live' : ''}">${live ? 'en curso' : until(p.aos - now)}</span></div>
      <div class="l2">${icon(p.light, 'ico sm')} máx ${Math.round(p.max)}° · ${card(p.azA)}→${card(p.azL)} · <b>${mhz(s.main)} MHz</b> ${esc(s.use)}${extra ? ' · ' + esc(extra) : ''}</div>`;
  }

  // ------------------------------------------------------------------ mapa de puntos
  const cv = $('map'), ctx = cv.getContext('2d');
  const INK = '29,28,26', PAPER = '#efece5', ACC = '#e8ae17';   // ACC = --acc (amarillo sodio)
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
    // día y noche en el instante de la culminación (o ahora): la noche es tierra más densa y mar punteado
    const sun = sunRaDec(new Date(selected ? selected.tca : Date.now()));
    const r = Math.max(0.8, L.step * k * 0.3);
    L.rows.forEach((row, j) => {
      const lat = L.latN - L.step / 2 - j * L.step;
      for (let i = 0; i < row.length; i++) {
        const lon = -180 + L.step / 2 + i * L.step, night = sunSin(sun, lat, lon) < 0;
        if (row.charCodeAt(i) === 49) {
          ctx.fillStyle = `rgba(${INK},${inFoot(lat, lon) ? 0.62 : night ? 0.36 : 0.18})`;
          ctx.beginPath(); ctx.arc(X(lon), Y(lat), r, 0, 7); ctx.fill();
        } else if (night && (i + j) % 3 === 0) {
          ctx.fillStyle = `rgba(${INK},.16)`;
          ctx.beginPath(); ctx.arc(X(lon), Y(lat), r * 0.45, 0, 7); ctx.fill();
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
          // tramo visible: tinta con alma amarilla
          ctx.strokeStyle = `rgb(${INK})`; ctx.lineWidth = 3.8; polyline(run, X, Y);
          ctx.strokeStyle = ACC; ctx.lineWidth = 1.8; polyline(run, X, Y);
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
        ctx.fillStyle = ACC; ctx.strokeStyle = `rgb(${INK})`; ctx.lineWidth = 1.3;
        ctx.beginPath(); ctx.arc(X(c.lon), Y(c.lat), 3.8, 0, 7); ctx.fill(); ctx.stroke();
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

  // ------------------------------------------------------------------ arranque
  async function start(fresh) {
    const c = await loadCatalog();
    if (!c) { $('list').innerHTML = '<div class="empty">Sin conexión y sin datos guardados. Abre la app con Internet una vez.</div>'; return; }
    useCatalog(c);
    $('where').textContent = `Поехали · ${STATION.name}`;
    renderChips();
    compute();
    renderList(fresh);
    if (location.hash === '#ficha') requestAnimationFrame(() => $('pager').scrollTo({ left: $('pager').clientWidth }));   // para capturas
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
