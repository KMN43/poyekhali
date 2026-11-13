<p align="center"><img src="docs/logo.png" width="140" alt="Logo de Poyekhali"></p>

# Poyekhali

*«¡Поехали!» (¡Vámonos!), lo que dijo Gagarin al despegar el 12 de abril de 1961.*

Próximas pasadas sobre **Zaragoza** de los satélites que se pueden **escuchar con un RTL-SDR** y antenas sencillas (bandas de 2 m y 70 cm): Meteor-M (imágenes LRPT), la ISS y satélites de radioaficionado.

Una sola pantalla:
- **Arriba**: mapa del mundo de puntos con la trayectoria de la pasada elegida. La línea es muy fina donde el satélite no se ve y gruesa dentro del horizonte de visión. También muestra la huella de visibilidad y la estación.
- **Abajo**: tabla de las pasadas de los próximos **7 o 14 días**: hora, elevación máxima, duración, ruta y luz (☀ día, amanecer, atardecer, ☾ noche).
- **Tres páginas** que se deslizan (o con las pestañas 01 · 02 · 03): **Mapa**; **Ficha** del satélite, con su imagen en pixel art (foto libre a 1 bit o emblema propio) y quién lo gestiona, su órbita (calculada del TLE actual), el lanzamiento, qué envía y para qué sirve (`app/src/sats.js`); y **Cielo**, con el recorrido de la pasada en un diagrama polar y su perfil de elevación.
- Cabecera técnica (estación, satélites y antigüedad de los TLE), horas al segundo y cuenta atrás T− en Space Grotesk. Monocromo: tinta sobre papel.
- **Filtro** de un satélite (o todos).
- Tipografía **Fira Code** (SIL OFL 1.1), incluida en la app.

## Instalar en Android
Escanea el QR o abre el enlace en el móvil:

<p><img src="docs/qr-apk.png" width="220" alt="QR de descarga de la APK"></p>

**https://github.com/KMN43/poyekhali/releases/latest/download/Poyekhali.apk**

La primera vez Android pide *Permitir de esta fuente*. Las actualizaciones se buscan al abrir la app y con **«buscar actualizaciones»** al final de la tabla. Si hay una versión nueva, se descarga e instala desde la propia app con un toque.

## Cómo funciona
| Pieza | Qué hace |
|---|---|
| `worker/` | **Cloudflare Worker** (`https://poyekhali.biblioscan-galaxia.workers.dev/api/catalog`). Junta los TLE actuales (SatNOGS DB, con CelesTrak de reserva) y los transmisores activos en 136–150 y 430–440 MHz. Descarta los satélites sin transmisor vivo o con TLE de más de 30 días. Caché en el borde de 1 h |
| `app/` | App **Capacitor**. Calcula las pasadas en el móvil con SGP4 (`satellite.js`) y guarda el último catálogo para funcionar sin conexión |
| `app/make-land.mjs` | Genera la malla de puntos del mapa (Natural Earth 110m, cada 2°) |
| `app/make-icons.py` | Logo → iconos de Android, pantalla de arranque y `docs/logo.*` |

## Desarrollo
```bash
# Worker
cd worker && npm install && npx wrangler deploy

# App
cd app && npm install
npm run build:web          # www/ para probar en el navegador
npm run release -- minor --notes "Qué cambia"   # versión nueva: APK firmada + Release en GitHub
```
Requisitos: Node.js, Java 21, SDK de Android y `gh` con sesión iniciada. La clave de firma (`app/pasadas-release.jks` + `app/keystore.properties`) **no está en el repositorio**.

El proyecto debe estar en una ruta **sin tildes**: Gradle no compila en rutas con caracteres no ASCII en Windows.
