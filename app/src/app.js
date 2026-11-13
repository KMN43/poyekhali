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
  let chosen = new Set(ls.get('sats', []));   // vacío = todos
  let computedAt = 0;
  const obs = { longitude: STATION.lon * D2R, latitude: STATION.lat * D2R, height: STATION.alt / 1000 };

  // ------------------------------------------------------------------ formato
  const tz = 'Europe/Madrid';
  const fTime = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: tz });
  const fDay = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'short', timeZone: tz });
  const fDayShort = new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz });
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
    const d = Math.floor(h / 24);
    return `en ${d} d ${h % 24} h`;
  }

  // ------------------------------------------------------------------ órbitas
  function look(rec, date) {
    const pv = S.propagate(rec, date);
    if (!pv || !pv.position) return null;
    const gmst = S.gstime(date);
    const la = S.ecfToLookAngles(obs, S.eciToEcf(pv.position, gmst));
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
        // afinar el máximo: sección áurea en ±1 paso
        let a = cur.tca - STEP, b = cur.tca + STEP;
        for (let i = 0; i < 20; i++) {
          const m1 = b - (b - a) / 1.618, m2 = a + (b - a) / 1.618;
          if (elAt(rec, m1) > elAt(rec, m2)) b = m2; else a = m1;
        }
        cur.tca = (a + b) / 2;
        cur.max = elAt(rec, cur.tca);
        if (cur.max >= MIN_EL) {
          const la = look(rec, new Date(cur.aos)), ll = look(rec, new Date(cur.los));
          out.push({ sat, aos: cur.aos, los: cur.los, tca: cur.tca, max: cur.max, azA: la.az, azL: ll.az, sun: sunEl(new Date(cur.tca)) });
        }
        cur = null;
      }
      prevT = t; prevE = e;
    }
    return out;
  }

  // elevación del Sol en la estación (fórmula de baja precisión, suficiente para día/noche)
  function sunEl(date) {
    const d = date.getTime() / 86400000 - 10957.5;
    const g = (357.529 + 0.98560028 * d) * D2R, q = 280.459 + 0.98564736 * d;
    const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * D2R, e = (23.439 - 3.6e-7 * d) * D2R;
    const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)), dec = Math.asin(Math.sin(e) * Math.sin(L));
    const ha = S.gstime(date) + STATION.lon * D2R - ra, la = STATION.lat * D2R;
    return Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(ha)) * R2D;
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
    // la selección guardada solo con satélites que siguen en el catálogo
    chosen = new Set([...chosen].filter(id => recs.has(id)));
  }

  // ------------------------------------------------------------------ interfaz: filtro y días
  function renderChips() {
    const all = !chosen.size;
    $('chips').innerHTML = `<button class="chip all" aria-pressed="${all}" data-id="*">Todos</button>` +
      catalog.sats.map(s => `<button class="chip" aria-pressed="${!all && chosen.has(s.id)}" data-id="${esc(s.id)}">${esc(s.name)}</button>`).join('');
  }
  $('chips').addEventListener('click', e => {
    const b = e.target.closest('.chip'); if (!b) return;
    const id = b.dataset.id;
    if (id === '*') chosen.clear();
    else if (chosen.has(id)) chosen.delete(id);
    else chosen.add(id);
    if (chosen.size === catalog.sats.length) chosen.clear();
    ls.set('sats', [...chosen]);
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
    return passes.filter(p => p.los > now && p.aos < end && (!chosen.size || chosen.has(p.sat.id)));
  };
  function renderList(reselect) {
    const list = visible(), now = Date.now();
    if (reselect || !selected || !list.includes(selected)) selected = list[0] || null;
    if (!list.length) {
      $('list').innerHTML = `<div class="empty">No hay pasadas por encima de ${MIN_EL}° con este filtro.</div>`;
      renderDetail(); drawMap(); return;
    }
    let html = '<table><thead><tr><th>Hora</th><th>Satélite</th><th>Máx</th><th>Dur</th><th>Ruta</th><th>Luz</th></tr></thead><tbody>';
    let lastDay = '';
    list.forEach((p, i) => {
      const k = dayKey(new Date(p.aos));
      if (k !== lastDay) { lastDay = k; html += `<tr class="day"><td colspan="6">${esc(fDay.format(new Date(p.aos)))}</td></tr>`; }
      const live = p.aos <= now && p.los > now;
      const cls = ['p', p.max < LOW_EL ? 'low' : '', p === selected ? 'sel' : ''].join(' ');
      html += `<tr class="${cls}" data-i="${i}">
        <td class="t">${live ? 'ahora' : hhmm(new Date(p.aos))}</td>
        <td>${esc(p.sat.name)}</td>
        <td><span class="el"><span class="bar"><i style="width:${Math.min(100, p.max / 90 * 100).toFixed(0)}%"></i></span>${Math.round(p.max)}°</span></td>
        <td class="r">${Math.round((p.los - p.aos) / 60000)}′</td>
        <td class="r">${card(p.azA)}→${card(p.azL)}</td>
        <td class="sun" title="${p.sun > -6 ? 'de día' : 'de noche'}">${p.sun > -6 ? '○' : '●'}</td></tr>`;
    });
    html += '</tbody></table>';
    const age = catalog.updated ? Math.max(0, Math.round((now - Date.parse(catalog.updated)) / 3600000)) : null;
    html += `<div class="foot">○ de día · ● de noche · solo pasadas por encima de ${MIN_EL}° · horas de ${esc(STATION.name)}<br>` +
      `${catalog.sats.length} satélites escuchables · órbitas ${age == null ? '' : age < 1 ? 'actualizadas hace menos de 1 h' : `de hace ${age} h`} · v${esc(window.APP_VERSION || '')}</div>`;
    $('list').innerHTML = html;
    $('list')._rows = list;
    renderDetail(); drawMap();
  }
  $('list').addEventListener('click', e => {
    const tr = e.target.closest('tr.p'); if (!tr) return;
    selected = $('list')._rows[+tr.dataset.i];
    document.querySelectorAll('tr.p.sel').forEach(x => x.classList.remove('sel'));
    tr.classList.add('sel');
    renderDetail(); drawMap();
  });

  function renderDetail() {
    const p = selected;
    if (!p) { $('detail').innerHTML = ''; return; }
    const now = Date.now(), live = p.aos <= now && p.los > now;
    const s = p.sat, extra = (s.tx || []).filter(t => Math.abs(t.f - s.main) > 0.002).slice(0, 2).map(t => `${mhz(t.f)} ${t.mode}`).join(' · ');
    $('detail').innerHTML = `
      <div class="l1"><b>${esc(s.name)}</b><span>${esc(fDayShort.format(new Date(p.aos)))} · ${hhmm(new Date(p.aos))}–${hhmm(new Date(p.los))}</span>
        <span class="when ${live ? 'live' : ''}">${live ? 'en curso' : until(p.aos - now)}</span></div>
      <div class="l2">máx ${Math.round(p.max)}° · ${card(p.azA)}→${card(p.azL)} · <b>${mhz(s.main)} MHz</b> ${esc(s.use)}${extra ? ' · ' + esc(extra) : ''}</div>`;
  }

  // ------------------------------------------------------------------ mapa de puntos
  const cv = $('map'), ctx = cv.getContext('2d');
  const INK = '29,28,26';
  function drawMap() {
    const dpr = window.devicePixelRatio || 1, cw = cv.clientWidth, ch = cv.clientHeight;
    if (!cw || !ch) return;
    cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    const L = window.LAND, latSpan = L.latN - L.latS;
    const k = Math.min(cw / 360, ch / latSpan), W = 360 * k, H = latSpan * k, ox = (cw - W) / 2, oy = (ch - H) / 2;
    const X = lon => ox + (lon + 180) * k, Y = lat => oy + (L.latN - lat) * k;

    // huella de visibilidad del satélite (en la culminación): los puntos de tierra dentro se oscurecen
    let foot = null;
    if (selected) {
      const rec = recs.get(selected.sat.id), sp = rec && subpoint(rec, new Date(selected.tca));
      if (sp) foot = { lat: STATION.lat * D2R, lon: STATION.lon * D2R, r: Math.acos(RE / (RE + sp.h)) };
    }
    const inFoot = (lat, lon) => {
      if (!foot) return false;
      const a = lat * D2R, b = lon * D2R;
      return Math.acos(Math.min(1, Math.sin(a) * Math.sin(foot.lat) + Math.cos(a) * Math.cos(foot.lat) * Math.cos(b - foot.lon))) < foot.r;
    };

    const r = Math.max(0.8, L.step * k * 0.3);
    L.rows.forEach((row, j) => {
      const lat = L.latN - L.step / 2 - j * L.step;
      for (let i = 0; i < row.length; i++) {
        if (row.charCodeAt(i) !== 49) continue;
        const lon = -180 + L.step / 2 + i * L.step;
        ctx.fillStyle = `rgba(${INK},${inFoot(lat, lon) ? 0.5 : 0.2})`;
        ctx.beginPath(); ctx.arc(X(lon), Y(lat), r, 0, 7); ctx.fill();
      }
    });

    // contorno de la huella (punteado)
    if (foot) {
      ctx.strokeStyle = `rgba(${INK},.4)`; ctx.lineWidth = 0.8; ctx.setLineDash([1.5, 3]);
      polyline(circlePts(foot), X, Y, W); ctx.setLineDash([]);
    }

    if (selected) {
      const rec = recs.get(selected.sat.id), pts = [], pass = [];
      for (let t = selected.tca - 50 * 60000; t <= selected.tca + 50 * 60000; t += 30000) {
        const sp = subpoint(rec, new Date(t)); if (!sp) continue;
        pts.push(sp);
        if (t >= selected.aos - 30000 && t <= selected.los + 30000) pass.push(sp);
      }
      // la órbita completa, tenue y discontinua
      ctx.strokeStyle = `rgba(${INK},.38)`; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
      polyline(pts, X, Y, W); ctx.setLineDash([]);
      // el tramo de la pasada, firme
      ctx.strokeStyle = `rgb(${INK})`; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
      polyline(pass, X, Y, W);
      // flecha al final del tramo
      if (pass.length > 2) {
        const a = pass[pass.length - 2], b = pass[pass.length - 1];
        if (Math.abs(b.lon - a.lon) < 180) {
          const ang = Math.atan2(Y(b.lat) - Y(a.lat), X(b.lon) - X(a.lon)), x = X(b.lon), y = Y(b.lat);
          ctx.fillStyle = `rgb(${INK})`; ctx.beginPath();
          ctx.moveTo(x + 6 * Math.cos(ang), y + 6 * Math.sin(ang));
          ctx.lineTo(x + 5 * Math.cos(ang + 2.5), y + 5 * Math.sin(ang + 2.5));
          ctx.lineTo(x + 5 * Math.cos(ang - 2.5), y + 5 * Math.sin(ang - 2.5));
          ctx.fill();
        }
      }
      // satélite en la culminación
      const c = subpoint(rec, new Date(selected.tca));
      if (c) {
        ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--paper') || '#efece5';
        ctx.beginPath(); ctx.arc(X(c.lon), Y(c.lat), 5.5, 0, 7); ctx.fill();
        ctx.fillStyle = `rgb(${INK})`; ctx.beginPath(); ctx.arc(X(c.lon), Y(c.lat), 3.4, 0, 7); ctx.fill();
      }
    }

    // la estación
    const sx = X(STATION.lon), sy = Y(STATION.lat);
    ctx.strokeStyle = `rgb(${INK})`; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(sx, sy, 4.5, 0, 7); ctx.stroke();
    ctx.fillStyle = `rgb(${INK})`; ctx.beginPath(); ctx.arc(sx, sy, 1.4, 0, 7); ctx.fill();
  }
  function circlePts(f) {   // círculo de radio angular r alrededor de (lat, lon), en grados
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
      if (i && Math.abs(p.lon - pts[i - 1].lon) > 180) ctx.moveTo(X(p.lon), Y(p.lat));
      else if (i) ctx.lineTo(X(p.lon), Y(p.lat));
      else ctx.moveTo(X(p.lon), Y(p.lat));
    });
    ctx.stroke();
  }
  new ResizeObserver(() => drawMap()).observe(cv);

  // ------------------------------------------------------------------ nueva versión
  const vparts = v => String(v || '').replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
  const newer = (a, b) => { const x = vparts(a), y = vparts(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };
  async function checkUpdate() {
    if (!window.APP_VERSION || !window.Capacitor?.isNativePlatform?.()) return;
    try {
      const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`);
      const rel = await r.json(), apk = (rel.assets || []).find(a => /\.apk$/i.test(a.name));
      if (!apk || !newer(rel.tag_name, window.APP_VERSION)) return;
      const u = $('upd');
      u.innerHTML = `<span>Nueva versión ${esc(rel.tag_name.replace(/^v/i, ''))}</span><a href="${esc(apk.browser_download_url)}">Descargar</a>`;
      u.hidden = false;
    } catch {}
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
  }
  document.querySelectorAll('.seg button').forEach(x => x.setAttribute('aria-pressed', String(+x.dataset.days === days)));
  $('list').innerHTML = '<div class="empty">Calculando pasadas…</div>';
  start(true);
  checkUpdate();
  // cada minuto: cuenta atrás, «ahora» y fuera las pasadas terminadas; al volver a la app tras >1 h, recalcula
  setInterval(() => { if (catalog) renderList(false); }, 60000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && catalog && Date.now() - computedAt > 3600000) start(false);
  });
})();
