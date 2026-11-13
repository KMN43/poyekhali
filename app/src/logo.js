// Logo de Poyekhali: una esfera cortada en 9 husos (meridianos).
// Una sola definición: la usa la app (inline) y make-icons.py replica la misma geometría para los iconos.
(function () {
  const N = 9, GAP = 9.2, RY = 34, RX = 4.1;
  let s = '';
  for (let k = -(N - 1) / 2; k <= (N - 1) / 2; k++) {
    const ry = RY * Math.sqrt(1 - (k / 4.7) ** 2), rx = RX * Math.sqrt(1 - (k / 5.2) ** 2);
    s += `<ellipse cx="${(50 + k * GAP).toFixed(2)}" cy="50" rx="${rx.toFixed(2)}" ry="${ry.toFixed(2)}" fill="currentColor"/>`;
  }
  window.LOGO_SVG = s;
  const g = document.getElementById('logo');
  if (g) g.innerHTML = s;
})();
