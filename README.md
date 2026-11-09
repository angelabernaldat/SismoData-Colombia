# SismoData Colombia

Plataforma web de consulta de actividad sísmica de Colombia (proyecto universitario, Data Lab). Usa datos reales del catálogo del USGS contenidos en `Base_Sismos_Colombia_Limpia.csv` (1.520 registros, 3 ene 2020 a 27 oct 2026). Los datos son **históricos y no se actualizan automáticamente**.

## Estructura

```
sismodata/
├── index.html
├── styles.css
├── app.js
├── README.md
└── data/
    ├── Base_Sismos_Colombia_Limpia.csv   <- el CSV va aquí
    └── modelos.json                      <- opcional (resultados de ML)
```

## Cómo ejecutarla

El navegador bloquea la lectura del CSV si abres `index.html` con doble clic (`file://`). Usa un servidor local desde la carpeta del proyecto:

```bash
python -m http.server 8000     # luego abre http://localhost:8000
```

Alternativas: extensión **Live Server** de VS Code, o `npx serve`. Si no puedes levantar un servidor, la página muestra un aviso y un botón para **seleccionar el CSV manualmente**.

Necesitas internet para cargar Leaflet, Chart.js, PapaParse, las fuentes y los mapas de OpenStreetMap.

## Columnas del CSV que usa la página

`identificador_evento`, `fecha_utc`, `fecha_local_colombia`, `latitud`, `longitud`, `profundidad_km`, `magnitud`, `tipo_magnitud`, `ubicacion_reportada`, `url_origen`, `estaciones_reportadas_nst`. Las columnas `gap_azimutal_grados`, `distancia_minima_estacion_dmin` y `rms_residual_segundos` (calidad de localización) quedan disponibles para análisis futuros. Los valores vacíos (por ejemplo, 424 en `estaciones_reportadas_nst`) se tratan como «sin dato» y nunca como cero.

**Dato derivado:** el *país* se deduce del texto de `ubicacion_reportada`. Los eventos en mar o frontera quedan en «Otras zonas». Es una aproximación, no una columna oficial.

## Cómo actualizar los datos

1. Vuelve a consultar la API del USGS con tu notebook de limpieza (o directamente):
   `https://earthquake.usgs.gov/fdsnws/event/1/query?format=csv&starttime=2020-01-01&minlatitude=-5&maxlatitude=13.2&minlongitude=-82&maxlongitude=-66.2`
2. Deja el resultado con **los mismos nombres de columna** que el CSV actual. Equivalencias del USGS: `id`→`identificador_evento`, `time`→`fecha_utc` (formato `AAAA-MM-DD HH:MM:SS UTC`), `latitude`→`latitud`, `longitude`→`longitud`, `depth`→`profundidad_km`, `mag`→`magnitud`, `magType`→`tipo_magnitud`, `place`→`ubicacion_reportada`, `nst`→`estaciones_reportadas_nst`; `url_origen` es `https://earthquake.usgs.gov/earthquakes/eventpage/<id>`.
3. Reemplaza el archivo en `data/` conservando el nombre (o cambia `CONFIG.csv` en `app.js`).
4. Opcional: escribe la fecha de descarga en `CONFIG.fechaConsulta` (`app.js`) para mostrarla en el pie de página.

La página calcula sola los rangos de fecha, profundidad y magnitud a partir del CSV.

## Fuente actualizada (USGS)

Ya hay una primera conexión real: en **Sismos recientes**, el botón *Consultar USGS ahora* pide a la API los eventos de los últimos 30 días con magnitud 4 o más dentro de la caja `CONFIG.bbox`. Solo alimenta esa lista, y se rotula como «datos en vivo». Si falla la conexión, se mantienen los datos históricos y se avisa.

Para ir más lejos:
- **Todo el sitio con datos vivos:** repite la consulta al cargar y combina los resultados con el CSV por `id` (evita duplicados).
- **Feed oficial:** el USGS publica feeds GeoJSON por periodo (por ejemplo `earthquake.usgs.gov/earthquakes/feed/v1.0/summary/`).
- **SGC:** revisa en [sgc.gov.co](https://www.sgc.gov.co) si ofrece una API o servicio de datos abiertos y sus condiciones de uso antes de integrarlo. No se supuso ningún endpoint del SGC en este código.

## Resultados de modelos (aprendizaje automático)

Cuando existan, guarda un archivo `data/modelos.json`; la sección *Análisis y riesgo* lo mostrará sola, con advertencia de resultado experimental:

```json
{
  "modelo": "Regresión logística por zona",
  "fecha": "2026-11-20",
  "descripcion": "Probabilidad de al menos un evento M>=5 en 30 días.",
  "resultados": [
    { "zona": "Colombia", "periodo": "30 días", "umbral_magnitud": 5.0,
      "probabilidad": 0.18, "intervalo": [0.11, 0.26] }
  ]
}
```

## Publicar en internet

**GitHub Pages (gratis):**
1. Crea un repositorio y sube la carpeta (incluida `data/`).
2. En *Settings → Pages*, elige la rama `main` y la carpeta `/ (root)`.
3. En unos minutos quedará en `https://<usuario>.github.io/<repositorio>/`.

Alternativas: Netlify o Cloudflare Pages (arrastrar la carpeta). Todas sirven archivos estáticos, así que el CSV se lee sin problemas.

## Bibliotecas

| Biblioteca | Para qué sirve |
|---|---|
| Leaflet | Mapa interactivo y marcadores |
| OpenStreetMap | Cartografía base (teselas) |
| Chart.js | Gráficos de barras y líneas |
| PapaParse | Leer el CSV en el navegador |

## Qué necesitaría backend o infraestructura adicional

- Datos **realmente en tiempo real** y sin depender del navegador (tarea programada que descargue, limpie y guarde el CSV o una base de datos).
- Alertas o notificaciones (correo, push, WhatsApp) y cuentas de usuario.
- Entrenar y reentrenar modelos de ML (Python en un servidor o en un flujo programado) y servir sus resultados.
- Si el SGC u otra fuente bloquea peticiones desde el navegador (CORS) o exige clave, se necesita un intermediario.
- Almacenar históricos muy grandes (una base de datos en vez de un CSV).
- Analítica de visitas o formularios de contacto.

## Pendientes sugeridos

- Escribir en `index.html` el equipo real (nombres, roles).
- Agrupar réplicas para el análisis de patrones.
- Añadir zonas sismogénicas o fallas como capas del mapa.
- Revisar la cobertura de magnitudes bajas del catálogo antes de comparar periodos.

> Esta plataforma es informativa y no emite alertas oficiales. Ante un sismo, sigue las indicaciones del SGC, la UNGRD y las autoridades locales.
