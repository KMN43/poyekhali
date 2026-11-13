// Fichas de los satélites: planos estilo blueprint (dibujos propios a partir de su forma real) y datos.
// La órbita (altura, inclinación y periodo) no se escribe aquí: la app la calcula del TLE actual.
(() => {
  'use strict';
  // ------------------------------------------------------------------ ayudas de dibujo (viewBox 160 × 180)
  const T = (x, y, s, a = 'start') => `<text x="${x}" y="${y}" text-anchor="${a}" class="bpx">${s}</text>`;
  const thin = d => `<path d="${d}" class="bpt"/>`;
  // llamada: punto en la pieza → línea → texto
  const lab = (x1, y1, x2, y2, s) => {
    const left = x2 < x1;
    return `<circle cx="${x1}" cy="${y1}" r="1.2" class="bpdot"/>${thin(`M${x1} ${y1}L${x2} ${y2}H${x2 + (left ? -6 : 6)}`)}` +
      T(x2 + (left ? -7.5 : 7.5), y2 + 2, s, left ? 'end' : 'start');
  };
  // cota horizontal con marcas
  const dim = (x1, x2, y, s) => thin(`M${x1} ${y}H${x2}M${x1} ${y - 3}V${y + 3}M${x2} ${y - 3}V${y + 3}`) + T((x1 + x2) / 2, y - 3, s, 'middle');
  const wrap = (body, fig) => `<svg viewBox="0 0 160 180" class="bp" role="img" aria-label="Plano del satélite">
    <defs><pattern id="bpg" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M8 0H0V8" class="bpgrid"/></pattern></defs>
    <rect x="1.5" y="1.5" width="157" height="177" fill="url(#bpg)" class="bpframe"/>
    ${thin('M1.5 166.5H158.5')}
    <g class="bpl">${body}</g>${T(6, 175, fig)}</svg>`;
  // malla de células solares dentro de un rectángulo
  const cells = (x, y, w, h, nx, ny) => {
    let d = '';
    for (let i = 1; i < nx; i++) d += `M${x + w * i / nx} ${y}V${y + h}`;
    for (let j = 1; j < ny; j++) d += `M${x} ${y + h * j / ny}H${x + w}`;
    return thin(d);
  };
  // caja isométrica: frente (x, y, lado s) + desplazamiento de fondo (dx, dy)
  const box = (x, y, s, dx, dy) =>
    `<path d="M${x} ${y}H${x + s}V${y + s}H${x}Z"/><path d="M${x} ${y}L${x + dx} ${y + dy}H${x + s + dx}L${x + s} ${y}"/><path d="M${x + s + dx} ${y + dy}V${y + s + dy}L${x + s} ${y + s}"/>`;

  const BP = {
    meteor: () => wrap(
      `<rect x="68" y="44" width="24" height="84" rx="3"/><ellipse cx="80" cy="44" rx="12" ry="3.5"/>` +
      thin('M68 62H92M68 86H92M68 108H92') +
      `<path d="M68 72H50M92 72H110"/>` +
      `<rect x="8" y="50" width="42" height="44"/>${cells(8, 50, 42, 44, 4, 4)}` +
      `<rect x="110" y="50" width="42" height="44"/>${cells(110, 50, 42, 44, 4, 4)}` +
      `<path d="M62 128H98L94 138H66Z"/><rect x="70" y="138" width="8" height="7"/><rect x="82" y="138" width="8" height="5"/>` +
      `<path d="M86 143V153"/><circle cx="86" cy="155" r="2"/>` +
      lab(29, 50, 40, 30, 'panel solar') + lab(74, 145, 46, 158, 'MSU-MR') + lab(88, 155, 112, 158, 'LRPT') + lab(92, 96, 118, 112, 'cuerpo'),
      'FIG. METEOR-M · ≈2,8 t'),

    iss: () => wrap(
      [16, 32, 116, 132].map(x => `<rect x="${x}" y="46" width="12" height="38"/>${cells(x, 46, 12, 38, 1, 5)}<rect x="${x}" y="96" width="12" height="38"/>${cells(x, 96, 12, 38, 1, 5)}`).join('') +
      `<rect x="72" y="56" width="16" height="28" rx="4"/><rect x="72" y="94" width="16" height="36" rx="4"/><rect x="62" y="83" width="36" height="12" rx="3"/>` +
      `<rect x="51" y="98" width="8" height="22"/><rect x="101" y="98" width="8" height="22"/>${cells(51, 98, 8, 22, 1, 4)}${cells(101, 98, 8, 22, 1, 4)}` +
      `<rect x="6" y="86" width="148" height="6"/>` + thin('M6 92L14 86L22 92L30 86L38 92L46 86L54 92M106 92L114 86L122 92L130 86L138 92L146 86L154 92') +
      lab(22, 46, 30, 26, '8 alas solares') + lab(80, 62, 112, 30, 'módulos') + lab(55, 120, 46, 148, 'radiador') +
      dim(6, 154, 158, '109 m'),
      'FIG. ISS · 109 × 73 m · 420 t'),

    so50: () => wrap(
      box(62, 82, 36, 14, -10) + cells(62, 82, 36, 36, 2, 2) + thin('M105 77V113') +
      thin('M76 72L66 24M112 72L134 32M62 118L40 150M98 118L108 152') +
      lab(66, 24, 50, 18, 'antenas') + lab(70, 100, 38, 92, 'células') +
      dim(62, 98, 132, '≈ 20 cm'),
      'FIG. SAUDISAT-1C · 10 kg'),

    po101: () => wrap(
      box(60, 74, 40, 14, -10) +
      `<path d="M60 80L20 72V104L60 112Z"/>` + thin('M46.7 77.3V109.3M33.3 74.7V106.7M20 88L60 96') +
      `<path d="M114 66L150 58V92L114 100Z"/>` + thin('M132 62V96M114 83L150 75') +
      `<circle cx="80" cy="95" r="6"/><circle cx="80" cy="95" r="2.6"/><circle cx="92" cy="83" r="2.4"/>` +
      thin('M74 64L68 42M94 69L100 44') +
      lab(80, 95, 52, 140, 'cámaras') + lab(30, 72, 40, 52, 'panel desplegable') +
      dim(60, 100, 126, '50 cm'),
      'FIG. DIWATA-2 · 50 kg'),

    ao73: () => wrap(
      box(65, 85, 30, 12, -9) +
      `<rect x="68.5" y="89" width="23" height="10"/><rect x="68.5" y="101" width="23" height="10"/>` + thin('M66.5 86.5V113.5M93.5 86.5V113.5') +
      thin('M65 85L30 50M107 76L144 42M65 115L30 150M107 106L144 146') +
      lab(30, 50, 40, 36, 'antenas de cinta') + lab(91, 94, 124, 70, 'células') +
      dim(65, 95, 128, '10 cm'),
      'FIG. FUNCUBE-1 · 1U · ≈1 kg'),

    ao7: () => wrap(
      `<path d="M54 72L66 68H94L106 72V112L94 116H66L54 112Z"/><path d="M66 68V116M94 68V116"/>` +
      thin('M66 80H94M66 92H94M66 104H94M80 68V116M54 92H66M94 92H106') +
      `<path d="M8 60H152"/>` + thin('M80 68V60') +
      thin('M70 116L58 150M90 116L102 150') +
      lab(132, 60, 128, 42, 'dipolo 10 m') + lab(58, 150, 66, 158, '2 m / 70 cm') + lab(84, 98, 124, 92, 'células') +
      dim(54, 106, 130, 'Ø 42 cm'),
      'FIG. AMSAT-OSCAR 7 · 1974'),

    rs44: () => wrap(
      `<rect x="14" y="64" width="72" height="52" rx="10"/><ellipse cx="50" cy="90" rx="26" ry="14"/><ellipse cx="50" cy="90" rx="10" ry="5"/>` +
      `<path d="M14 82L4 76V104L14 98"/>` +
      `<rect x="86" y="72" width="30" height="36"/>` + cells(86, 72, 30, 36, 2, 3) +
      thin('M116 80L150 66M116 90L154 90M116 100L150 114') +
      lab(40, 64, 48, 44, 'etapa Briz-KM') + lab(101, 72, 112, 48, 'DOSAAF-85') + lab(150, 114, 132, 138, 'antenas'),
      'FIG. RS-44 · sigue unido a su etapa'),

    generic: () => wrap(
      box(64, 76, 32, 12, -9) + `<path d="M64 92H30M108 83H136"/><rect x="10" y="82" width="20" height="20"/><rect x="136" y="73" width="20" height="20"/>`,
      'FIG. SATÉLITE'),
  };

  // ------------------------------------------------------------------ datos
  window.SAT_INFO = {
    meteor23: { title: 'Meteor-M Nº 2-3', org: 'Roscosmos · Roshydromet', flag: 'Rusia', kind: 'Heliosíncrona', year: '27 jun 2023', fig: 'meteor',
      sends: 'Imágenes LRPT del radiómetro MSU-MR: 3 de sus 6 canales visibles e infrarrojos, a ~1 km/píxel, en 137 MHz. También HRPT en 1,7 GHz.',
      purpose: 'Meteorología: nubes, temperatura de la superficie, hielo y nieve para la predicción del tiempo.',
      note: 'Su antena LRPT no se desplegó del todo: la señal es débil en algunos pases.' },
    meteor24: { title: 'Meteor-M Nº 2-4', org: 'Roscosmos · Roshydromet', flag: 'Rusia', kind: 'Heliosíncrona', year: '29 feb 2024', fig: 'meteor',
      sends: 'Imágenes LRPT del radiómetro MSU-MR: 3 de sus 6 canales visibles e infrarrojos, a ~1 km/píxel, en 137 MHz. También HRPT en 1,7 GHz.',
      purpose: 'Meteorología: nubes, temperatura de la superficie, hielo y nieve para la predicción del tiempo.',
      note: 'Su LRPT se enciende y apaga a ratos: si un pase sale vacío, prueba otro.' },
    iss: { title: 'Estación Espacial Internacional', org: 'NASA · Roscosmos · ESA · JAXA · CSA', flag: 'Internacional', kind: 'Órbita baja', year: '20 nov 1998 (primer módulo)', fig: 'iss',
      sends: 'Voz FM de los astronautas (ARISS) en 145,800 MHz, imágenes SSTV en eventos especiales y APRS en 145,825 MHz.',
      purpose: 'Laboratorio tripulado de investigación en microgravedad. Hace contactos por radio con colegios.' },
    so50: { title: 'SaudiSat-1C · SO-50', org: 'KACST', flag: 'Arabia Saudí', kind: 'Órbita baja inclinada', year: '20 dic 2002', fig: 'so50',
      sends: 'Repetidor FM: escucha en 145,850 MHz (tono 67 Hz) y retransmite en 436,795 MHz.',
      purpose: 'Satélite de radioaficionado para contactos de voz. Es uno de los repetidores FM más usados.' },
    po101: { title: 'Diwata-2 · PO-101', org: 'PhilSA · DOST · Univ. de Filipinas', flag: 'Filipinas', kind: 'Heliosíncrona', year: '29 oct 2018', fig: 'po101',
      sends: 'Repetidor FM (sube en 437,500 y baja en 145,900 MHz) y digipeater APRS cuando está activado.',
      purpose: 'Observación de la Tierra con cámaras, para agricultura y desastres. Lleva un módulo de radioaficionado.' },
    ao73: { title: 'FUNcube-1 · AO-73', org: 'AMSAT-UK · AMSAT-NL · ISIS', flag: 'Reino Unido · Países Bajos', kind: 'Heliosíncrona', year: '21 nov 2013', fig: 'ao73',
      sends: 'Telemetría BPSK en 145,935 MHz (temperaturas, paneles y un experimento de materiales) y transpondedor lineal U/V.',
      purpose: 'Educativo: que los colegios reciban y analicen datos reales de un satélite.' },
    ao7: { title: 'AMSAT-OSCAR 7 · AO-7', org: 'AMSAT', flag: 'Internacional', kind: 'Heliosíncrona', year: '15 nov 1974', fig: 'ao7',
      sends: 'Balizas CW (145,977 y 435,100 MHz) y transpondedores lineales de radioaficionado.',
      purpose: 'El satélite de radioaficionado activo más antiguo. Calló en 1981 por la batería; en 2002 se descubrió que volvía a funcionar, pero solo al sol.' },
    rs44: { title: 'DOSAAF-85 · RS-44', org: 'DOSAAF', flag: 'Rusia', kind: 'Elíptica baja', year: '26 dic 2019', fig: 'rs44',
      sends: 'Transpondedor lineal SSB/CW (sube en 145,935–145,995, baja en 435,610–435,670 MHz) y baliza CW en 435,605 MHz.',
      purpose: 'Comunicaciones de radioaficionado. Nunca se separó de su etapa Briz-KM, que sigue unida a él.' },
  };
  window.SAT_BLUEPRINT = id => (BP[(window.SAT_INFO[id] || {}).fig] || BP.generic)();
})();
