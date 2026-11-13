// Fichas de los satélites: datos e imagen en pixel art (src/px, generada con make-pixel.py).
// · emb-*.png   emblema 16×16 propio: filtros, tabla y ficha cuando no hay foto libre
// · foto-*.png  foto real libre convertida a 1 bit (paneles en damero gris): la ficha
// La órbita (altura, inclinación y periodo) no se escribe aquí: la app la calcula del TLE actual.
(() => {
  'use strict';
  // emblema y foto de cada satélite, con la licencia de la foto original (Wikimedia Commons)
  const PX = {
    meteor23: { emb: 'meteor', photo: 'meteor', credit: 'Foto: El Salvador (Wikipedia rusa) · CC0' },
    meteor24: { emb: 'meteor', photo: 'meteor', credit: 'Foto: El Salvador (Wikipedia rusa) · CC0 · es la misma plataforma' },
    iss: { emb: 'iss', photo: 'iss', credit: 'Foto: NASA · dominio público' },
    so50: { emb: 'so50' },
    po101: { emb: 'po101', photo: 'diwata', credit: 'Imagen: DOST · dominio público' },
    ao73: { emb: 'ao73', photo: 'funcube', credit: 'Foto: Wouter Weggelaar · CC BY 3.0' },
    ao7: { emb: 'ao7' },
    rs44: { emb: 'rs44' },
  };

  window.SAT_INFO = {
    meteor23: { title: 'Meteor-M Nº 2-3', org: 'Roscosmos · Roshydromet', flag: 'Rusia', kind: 'Heliosíncrona', year: '27 jun 2023',
      sends: 'Imágenes LRPT del radiómetro MSU-MR: 3 de sus 6 canales visibles e infrarrojos, a ~1 km/píxel, en 137 MHz. También HRPT en 1,7 GHz.',
      purpose: 'Meteorología: nubes, temperatura de la superficie, hielo y nieve para la predicción del tiempo.',
      note: 'Su antena LRPT no se desplegó del todo: la señal es débil en algunos pases.' },
    meteor24: { title: 'Meteor-M Nº 2-4', org: 'Roscosmos · Roshydromet', flag: 'Rusia', kind: 'Heliosíncrona', year: '29 feb 2024',
      sends: 'Imágenes LRPT del radiómetro MSU-MR: 3 de sus 6 canales visibles e infrarrojos, a ~1 km/píxel, en 137 MHz. También HRPT en 1,7 GHz.',
      purpose: 'Meteorología: nubes, temperatura de la superficie, hielo y nieve para la predicción del tiempo.',
      note: 'Su LRPT se enciende y apaga a ratos: si un pase sale vacío, prueba otro.' },
    iss: { title: 'Estación Espacial Internacional', org: 'NASA · Roscosmos · ESA · JAXA · CSA', flag: 'Internacional', kind: 'Órbita baja', year: '20 nov 1998 (primer módulo)',
      sends: 'Voz FM de los astronautas (ARISS) en 145,800 MHz, imágenes SSTV en eventos especiales y APRS en 145,825 MHz.',
      purpose: 'Laboratorio tripulado de investigación en microgravedad. Hace contactos por radio con colegios.' },
    so50: { title: 'SaudiSat-1C · SO-50', org: 'KACST', flag: 'Arabia Saudí', kind: 'Órbita baja inclinada', year: '20 dic 2002',
      sends: 'Repetidor FM: escucha en 145,850 MHz (tono 67 Hz) y retransmite en 436,795 MHz.',
      purpose: 'Satélite de radioaficionado para contactos de voz. Es uno de los repetidores FM más usados.' },
    po101: { title: 'Diwata-2 · PO-101', org: 'PhilSA · DOST · Univ. de Filipinas', flag: 'Filipinas', kind: 'Heliosíncrona', year: '29 oct 2018',
      sends: 'Repetidor FM (sube en 437,500 y baja en 145,900 MHz) y digipeater APRS cuando está activado.',
      purpose: 'Observación de la Tierra con cámaras, para agricultura y desastres. Lleva un módulo de radioaficionado.' },
    ao73: { title: 'FUNcube-1 · AO-73', org: 'AMSAT-UK · AMSAT-NL · ISIS', flag: 'Reino Unido · Países Bajos', kind: 'Heliosíncrona', year: '21 nov 2013',
      sends: 'Telemetría BPSK en 145,935 MHz (temperaturas, paneles y un experimento de materiales) y transpondedor lineal U/V.',
      purpose: 'Educativo: que los colegios reciban y analicen datos reales de un satélite.' },
    ao7: { title: 'AMSAT-OSCAR 7 · AO-7', org: 'AMSAT', flag: 'Internacional', kind: 'Heliosíncrona', year: '15 nov 1974',
      sends: 'Balizas CW (145,977 y 435,100 MHz) y transpondedores lineales de radioaficionado.',
      purpose: 'El satélite de radioaficionado activo más antiguo. Calló en 1981 por la batería; en 2002 se descubrió que volvía a funcionar, pero solo al sol.' },
    rs44: { title: 'DOSAAF-85 · RS-44', org: 'DOSAAF', flag: 'Rusia', kind: 'Elíptica baja', year: '26 dic 2019',
      sends: 'Transpondedor lineal SSB/CW (sube en 145,935–145,995, baja en 435,610–435,670 MHz) y baliza CW en 435,605 MHz.',
      purpose: 'Comunicaciones de radioaficionado. Nunca se separó de su etapa Briz-KM, que sigue unida a él.' },
  };

  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // emblema pequeño (filtros y tabla); satélites sin emblema → nada
  window.SAT_EMBLEM = (id, cls = 'emb') => PX[id] ? `<img class="${cls}" src="px/emb-${PX[id].emb}.png" alt="" aria-hidden="true">` : '';
  // imagen grande de la ficha: foto pixelada si hay imagen libre; si no, el emblema a tamaño grande
  window.SAT_VISUAL = id => {
    const p = PX[id];
    if (!p) return '<div class="pxbox"><span class="pxnone">sin imagen</span></div>';
    if (p.photo) return `<figure class="pxbox"><img class="pxphoto" src="px/foto-${p.photo}.png" alt="Imagen del satélite en pixel art"><figcaption>${esc(p.credit)}</figcaption></figure>`;
    return `<figure class="pxbox"><img class="pxemb" src="px/emb-${p.emb}.png" alt="Emblema del satélite en pixel art"><figcaption>Emblema · sin foto con licencia libre</figcaption></figure>`;
  };
})();
