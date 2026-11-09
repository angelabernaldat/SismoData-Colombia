'use strict';

/* ====== Configuración (edítala aquí) ====== */
const CONFIG = {
  csv: 'data/Base_Sismos_Colombia_Limpia.csv',
  modelos: 'data/modelos.json',
  usgs: 'https://earthquake.usgs.gov/fdsnws/event/1/query',
  // Caja geográfica de la consulta en vivo (similar a la cobertura del CSV)
  bbox: { minlatitude: -5.5, maxlatitude: 13.5, minlongitude: -82.5, maxlongitude: -66 },
  centro: [4.6, -74.1],
  zoom: 5,
  fechaConsulta: null // Opcional: '2026-11-05' = día en que descargaste el CSV
};

/* ====== Utilidades ====== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const nf = new Intl.NumberFormat('es-CO');
const d1 = n => (n == null ? '—' : n.toLocaleString('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const urlSegura = u => (/^https:\/\//.test(u || '') ? u : '');
const fechaLocal = t => new Date(t).toLocaleString('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const diaLocal = t => new Date(t - 5 * 3600e3).toISOString().slice(0, 10); // Colombia = UTC-5
const nombreMes = k => new Date(k + '-15T12:00:00Z').toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });
const mediana = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const num = v => { const s = String(v ?? '').trim(); if (!s) return null; const n = Number(s); return Number.isFinite(n) ? n : null; };

const CL = [
  { k: 'c1', max: 4, label: 'Menor a 4', col: '#14B8A6' },
  { k: 'c2', max: 5, label: '4 a 4,9', col: '#2F6BFF' },
  { k: 'c3', max: 6, label: '5 a 5,9', col: '#F28C28' },
  { k: 'c4', max: 99, label: '6 o más', col: '#D6342C' }
];
const clase = m => CL.find(c => m < c.max);
const PAISES = { Colombia: 'Colombia', Panama: 'Panamá', Ecuador: 'Ecuador', Peru: 'Perú', Venezuela: 'Venezuela' };
const OTRAS = 'Otras zonas';

const S = { data: [], pais: 'todos', live: null, charts: {}, map: null, capa: null, listo: false };
const base = () => (S.pais === 'todos' ? S.data : S.data.filter(e => e.pais === S.pais));

/* El país se deriva del texto de ubicación del USGS (no es una columna del CSV) */
function paisDe(lugar) {
  const m = lugar.match(/,\s*([^,]+)$/);
  if (m) return PAISES[m[1].trim()] || OTRAS;
  if (/border|sea\b|ocean/i.test(lugar)) return OTRAS;
  for (const k in PAISES) if (lugar.includes(k)) return PAISES[k];
  return OTRAS;
}

/* ====== Carga de datos ====== */
async function cargar() {
  try {
    if (typeof Papa === 'undefined') throw new Error('No se cargó la biblioteca PapaParse (revisa tu conexión a internet).');
    const r = await fetch(CONFIG.csv, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`No se encontró ${CONFIG.csv} (HTTP ${r.status}).`);
    iniciar(await r.text());
  } catch (err) { falla(err); }
}

function falla(err) {
  $('#estado-carga').hidden = false;
  $('#estado-msg').textContent = `${err.message} Si abriste index.html con doble clic, el navegador bloquea la lectura del CSV: usa un servidor local (ver README) o selecciona el archivo aquí.`;
  $('#resumen').innerHTML = '<p class="cargando">No hay datos cargados.</p>';
}

function normalizar(r) {
  const t = Date.parse(String(r.fecha_utc || '').replace(' UTC', 'Z').replace(' ', 'T'));
  const mag = num(r.magnitud);
  if (!Number.isFinite(t) || mag == null) return null;
  const lugar = r.ubicacion_reportada || 'Ubicación sin dato';
  return {
    id: r.identificador_evento, t, lat: num(r.latitud), lon: num(r.longitud), prof: num(r.profundidad_km), mag,
    tipo: r.tipo_magnitud, lugar, url: r.url_origen, nst: num(r.estaciones_reportadas_nst), pais: paisDe(lugar)
  };
}

function iniciar(texto) {
  try {
    const res = Papa.parse(texto, { header: true, skipEmptyLines: true, transformHeader: h => h.replace(/^\uFEFF/, '').trim() });
    const req = ['fecha_utc', 'latitud', 'longitud', 'profundidad_km', 'magnitud', 'ubicacion_reportada'];
    const falt = req.filter(c => !(res.meta.fields || []).includes(c));
    if (falt.length) throw new Error('Faltan columnas en el CSV: ' + falt.join(', ') + '.');
    S.data = res.data.map(normalizar).filter(Boolean).sort((a, b) => b.t - a.t);
    if (!S.data.length) throw new Error('El CSV no contiene registros válidos.');
    $('#estado-carga').hidden = true;
    construir();
  } catch (e) { falla(e); }
}

function construir() {
  poblarPaises();
  configurarMapa();
  renderInicio();
  renderRecientes();
  renderMapa();
  renderStats();
  renderAnalisis();
  cargarModelos();
}

function refrescar() { renderRecientes(); renderMapa(); renderStats(); renderAnalisis(); }

function poblarPaises() {
  const c = {};
  S.data.forEach(e => { c[e.pais] = (c[e.pais] || 0) + 1; });
  const ops = [['todos', `Toda la región (${nf.format(S.data.length)})`],
    ...Object.entries(c).sort((a, b) => b[1] - a[1]).map(([p, n]) => [p, `${p} (${nf.format(n)})`])];
  $$('.sel-pais').forEach(s => {
    s.innerHTML = ops.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('');
    s.addEventListener('change', () => { S.pais = s.value; $$('.sel-pais').forEach(x => { x.value = S.pais; }); refrescar(); });
  });
}

/* ====== Inicio ====== */
function renderInicio() {
  const d = S.data, ult = d[0], pri = d[d.length - 1];
  const max = d.reduce((a, b) => (b.mag > a.mag ? b : a));
  const fuertes = d.filter(e => e.mag >= 5).length;
  const prof = mediana(d.map(e => e.prof).filter(v => v != null));
  const f = t => new Date(t).toLocaleDateString('es-CO', { timeZone: 'America/Bogota', day: 'numeric', month: 'short', year: 'numeric' });
  $('#hero-rango').textContent = `Explora ${nf.format(d.length)} sismos registrados por el USGS en Colombia y países vecinos entre ${f(pri.t)} y ${f(ult.t)}: dónde ocurrieron, qué tan fuertes fueron y a qué profundidad.`;
  $('#resumen').innerHTML = [
    [nf.format(d.length), 'sismos en el archivo histórico'],
    [d1(max.mag), `magnitud máxima (${esc(max.lugar)}, ${new Date(max.t).getFullYear()})`],
    [nf.format(fuertes), 'eventos de magnitud 5 o más'],
    [prof == null ? '—' : d1(prof) + ' km', 'profundidad mediana'],
    [f(ult.t), 'último evento del archivo']
  ].map(([b, s]) => `<div><b>${b}</b><span>${s}</span></div>`).join('');
  $('#pie-datos').textContent = `Datos históricos, sin actualización automática. Último evento registrado: ${fechaLocal(ult.t)} (hora de Colombia).` + (CONFIG.fechaConsulta ? ` Consulta realizada el ${CONFIG.fechaConsulta}.` : '');
  sismograma();
}

function sismograma() {
  const ev = [...S.data].sort((a, b) => a.t - b.t), t0 = ev[0].t, span = (ev[ev.length - 1].t - t0) || 1;
  const W = 1200, H = 190, mid = H / 2;
  const lineas = ev.map((e, i) => {
    const x = ((e.t - t0) / span * W).toFixed(1), h = Math.max(2, (e.mag - 2) / 6 * (mid - 6)), y = (mid + (i % 2 ? h : -h)).toFixed(1);
    return `<line x1="${x}" x2="${x}" y1="${mid}" y2="${y}" stroke="${clase(e.mag).col}"/>`;
  }).join('');
  $('#sismograma').innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><line x1="0" x2="${W}" y1="${mid}" y2="${mid}" stroke="#ffffff33"/>${lineas}</svg>`;
}

/* ====== Sismos recientes ====== */
function renderRecientes() {
  const fuente = S.live || S.data;
  const n = +$('#n-recientes').value;
  const lista = (S.pais === 'todos' ? fuente : fuente.filter(e => e.pais === S.pais)).slice().sort((a, b) => b.t - a.t).slice(0, n);
  const ban = $('#banner-fuente'), btn = $('#btn-live');
  const ult = S.data[0], pri = S.data[S.data.length - 1];
  if (S.live) {
    ban.className = 'banner live';
    ban.innerHTML = `<p><b>Datos en vivo del USGS</b>, consultados a las ${new Date(S.liveHora).toLocaleTimeString('es-CO')}. Ventana: últimos 30 días, magnitud 4 o más. No sustituye los avisos oficiales del SGC.</p>`;
    btn.textContent = 'Volver a datos históricos';
  } else {
    ban.className = 'banner';
    ban.innerHTML = `<p><b>Estás viendo datos históricos</b> del archivo CSV (${diaLocal(pri.t)} a ${diaLocal(ult.t)}). No se actualizan automáticamente; el último evento registrado es del ${fechaLocal(ult.t)}.</p>`;
    btn.textContent = 'Consultar USGS ahora';
  }
  $('#lista-recientes').innerHTML = lista.length ? lista.map(e => {
    const c = clase(e.mag), u = urlSegura(e.url);
    return `<li class="evento ${c.k}"><div class="mag" title="Magnitud">${d1(e.mag)}</div>
      <div><h3>${esc(e.lugar)}</h3><p><span>${fechaLocal(e.t)}</span><span>Profundidad: ${e.prof == null ? 'sin dato' : d1(e.prof) + ' km'}</span></p></div>
      ${u ? `<a href="${esc(u)}" target="_blank" rel="noopener">Ver registro en USGS</a>` : ''}</li>`;
  }).join('') : '<li class="vacio">No hay eventos para este filtro. Prueba con otra ubicación.</li>';
}

async function consultarUSGS() {
  const btn = $('#btn-live'), st = $('#live-estado');
  if (S.live) { S.live = null; st.textContent = ''; renderRecientes(); return; }
  btn.disabled = true; st.textContent = 'Consultando al USGS…';
  try {
    const fin = new Date(), ini = new Date(fin - 30 * 864e5);
    const q = new URLSearchParams({ format: 'geojson', starttime: ini.toISOString(), endtime: fin.toISOString(), minmagnitude: 4, orderby: 'time', limit: 200, ...CONFIG.bbox });
    const r = await fetch(`${CONFIG.usgs}?${q}`);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    S.live = j.features.map(f => ({
      id: f.id, t: f.properties.time, mag: f.properties.mag, lugar: f.properties.place || 'Ubicación sin dato', url: f.properties.url,
      lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], prof: f.geometry.coordinates[2], pais: paisDe(f.properties.place || '')
    })).filter(e => e.mag != null);
    S.liveHora = Date.now();
    st.textContent = `${S.live.length} eventos recibidos.`;
  } catch (e) {
    st.textContent = 'No se pudo conectar con el USGS. Se mantienen los datos históricos.';
  } finally { btn.disabled = false; renderRecientes(); }
}

/* ====== Mapa ====== */
function configurarMapa() {
  const d = S.data, mags = d.map(e => e.mag), profs = d.map(e => e.prof).filter(v => v != null);
  const fMag = $('#f-mag'), fProf = $('#f-prof');
  fMag.min = Math.floor(Math.min(...mags)); fMag.max = Math.ceil(Math.max(...mags)); fMag.value = fMag.min;
  fProf.max = Math.ceil(Math.max(...profs) / 5) * 5; fProf.value = fProf.max;
  $('#f-desde').min = $('#f-hasta').min = diaLocal(d[d.length - 1].t);
  $('#f-desde').max = $('#f-hasta').max = diaLocal(d[0].t);
  $$('#f-mag,#f-prof,#f-desde,#f-hasta').forEach(el => el.addEventListener('input', renderMapa));
  $('#btn-reset').addEventListener('click', () => {
    fMag.value = fMag.min; fProf.value = fProf.max; $('#f-desde').value = ''; $('#f-hasta').value = '';
    S.pais = 'todos'; $$('.sel-pais').forEach(x => { x.value = 'todos'; }); refrescar();
    if (S.map) S.map.setView(CONFIG.centro, CONFIG.zoom);
  });
  $('#btn-ajustar').addEventListener('click', ajustarVista);
  if (typeof L === 'undefined') { $('#mapa').innerHTML = '<p class="aviso">No se pudo cargar Leaflet. Revisa tu conexión a internet.</p>'; return; }
  S.map = L.map('mapa', { preferCanvas: true, minZoom: 3 }).setView(CONFIG.centro, CONFIG.zoom);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(S.map);
  S.capa = L.layerGroup().addTo(S.map);
  const ley = L.control({ position: 'bottomright' });
  ley.onAdd = () => { const d = L.DomUtil.create('div', 'leyenda'); d.innerHTML = '<b>Magnitud</b><br>' + CL.map(c => `<i style="background:${c.col}"></i>${c.label}`).join('<br>'); return d; };
  ley.addTo(S.map);
}

function filtrados() {
  const mmin = +$('#f-mag').value, pmax = +$('#f-prof').value, pTope = +$('#f-prof').max;
  const des = $('#f-desde').value, has = $('#f-hasta').value;
  return base().filter(e => {
    if (e.lat == null || e.lon == null || e.mag < mmin) return false;
    if (e.prof != null ? e.prof > pmax : pmax < pTope) return false; // sin dato de profundidad: solo cuando no se filtra por profundidad
    const dia = diaLocal(e.t);
    return !(des && dia < des) && !(has && dia > has);
  });
}

function popup(e) {
  const u = urlSegura(e.url);
  return `<div class="popup"><h4>${esc(e.lugar)}</h4>
    <p><b>Magnitud:</b> ${d1(e.mag)}${e.tipo ? ' (' + esc(e.tipo) + ')' : ''}</p>
    <p><b>Profundidad:</b> ${e.prof == null ? 'sin dato' : d1(e.prof) + ' km'}</p>
    <p><b>Fecha (hora Colombia):</b> ${fechaLocal(e.t)}</p>
    <p><b>Coordenadas:</b> ${e.lat.toFixed(3)}, ${e.lon.toFixed(3)}</p>
    ${e.nst != null ? `<p><b>Estaciones:</b> ${e.nst}</p>` : ''}
    ${u ? `<p><a href="${esc(u)}" target="_blank" rel="noopener">Ver registro original</a></p>` : ''}</div>`;
}

function renderMapa() {
  const f = filtrados();
  $('#f-mag-v').textContent = d1(+$('#f-mag').value);
  $('#f-prof-v').textContent = $('#f-prof').value + ' km';
  $('#conteo-mapa').textContent = `Mostrando ${nf.format(f.length)} de ${nf.format(S.data.length)} eventos`;
  if (!S.map) return;
  S.capa.clearLayers();
  [...f].sort((a, b) => a.mag - b.mag).forEach(e => {
    const c = clase(e.mag);
    L.circleMarker([e.lat, e.lon], { radius: Math.max(4, (e.mag - 2) * 2.2), color: '#0A1F3C', weight: 0.8, fillColor: c.col, fillOpacity: 0.65 })
      .bindPopup(popup(e)).addTo(S.capa);
  });
}

function ajustarVista() {
  const f = filtrados();
  if (S.map && f.length) S.map.fitBounds(L.latLngBounds(f.map(e => [e.lat, e.lon])).pad(0.1));
}

/* ====== Estadísticas ====== */
function grafico(id, cfg) {
  if (S.charts[id]) S.charts[id].destroy();
  S.charts[id] = new Chart(document.getElementById(id), cfg);
}
const contar = (vals, ini, paso, n) => { const c = Array(n).fill(0); vals.forEach(v => { c[Math.min(n - 1, Math.max(0, Math.floor((v - ini) / paso)))]++; }); return c; };
const coma = n => n.toFixed(1).replace('.', ',');

function renderStats() {
  const a = base();
  const mags = a.map(e => e.mag), profs = a.map(e => e.prof).filter(v => v != null);
  $('#stats-tiles').innerHTML = [
    [nf.format(a.length), 'sismos registrados'],
    [nf.format(a.filter(e => e.mag >= 5).length), 'de magnitud 5 o más'],
    [mags.length ? d1(mediana(mags)) : '—', 'magnitud mediana'],
    [profs.length ? d1(mediana(profs)) + ' km' : '—', 'profundidad mediana']
  ].map(([b, s]) => `<div><b>${b}</b><span>${s}</span></div>`).join('');
  heat(a);
  if (typeof Chart === 'undefined') { $('#stats-error').hidden = false; return; }
  Chart.defaults.font.family = "'IBM Plex Sans',system-ui,sans-serif";
  Chart.defaults.color = '#546580';
  const opc = { responsive: true, maintainAspectRatio: false };

  // Magnitudes (barras de 0,5)
  let m = contar(mags, 2, 0.5, 12), i0 = m.findIndex(v => v > 0), i1 = m.length - 1 - [...m].reverse().findIndex(v => v > 0);
  if (i0 < 0) { i0 = 0; i1 = m.length - 1; }
  const idx = Array.from({ length: i1 - i0 + 1 }, (_, k) => i0 + k);
  grafico('c-mag', { type: 'bar', data: { labels: idx.map(k => `${coma(2 + k / 2)}–${coma(2 + k / 2 + 0.4)}`), datasets: [{ label: 'Sismos', data: idx.map(k => m[k]), backgroundColor: idx.map(k => clase(2 + k / 2 + 0.25).col) }] },
    options: { ...opc, plugins: { legend: { display: false } }, scales: { x: { title: { display: true, text: 'Magnitud' } }, y: { title: { display: true, text: 'Cantidad de sismos' } } } } });

  // Profundidad (barras de 25 km)
  const nb = Math.max(1, Math.ceil((Math.max(...profs, 1) + 1) / 25)), p = contar(profs, 0, 25, nb);
  grafico('c-prof', { type: 'bar', data: { labels: p.map((_, k) => `${k * 25}–${k * 25 + 24}`), datasets: [{ label: 'Sismos', data: p, backgroundColor: '#2F6BFF' }] },
    options: { ...opc, plugins: { legend: { display: false } }, scales: { x: { title: { display: true, text: 'Profundidad (km)' } }, y: { title: { display: true, text: 'Cantidad de sismos' } } } } });

  // Por año
  const anios = [...new Set(S.data.map(e => +diaLocal(e.t).slice(0, 4)))].sort();
  const ult = S.data[0], parcial = diaLocal(ult.t).slice(0, 4), mesUlt = +diaLocal(ult.t).slice(5, 7);
  const porA = y => a.filter(e => diaLocal(e.t).startsWith(y));
  grafico('c-anio', { type: 'bar', data: { labels: anios.map(y => (String(y) === parcial && mesUlt < 12 ? `${y} (parcial)` : String(y))), datasets: [
    { type: 'bar', label: 'Todos los sismos', data: anios.map(y => porA(String(y)).length), backgroundColor: '#2F6BFF', yAxisID: 'y' },
    { type: 'line', label: 'Magnitud 5 o más', data: anios.map(y => porA(String(y)).filter(e => e.mag >= 5).length), borderColor: '#F28C28', backgroundColor: '#F28C28', yAxisID: 'y1' }] },
    options: { ...opc, scales: { y: { title: { display: true, text: 'Todos' }, beginAtZero: true }, y1: { position: 'right', title: { display: true, text: 'Magnitud 5 o más' }, beginAtZero: true, grid: { drawOnChartArea: false } } } } });
  $('#nota-anio').textContent = `El último año incluye datos hasta ${nombreMes(diaLocal(ult.t).slice(0, 7))}.`;

  // Por mes (todos los meses del periodo; contar eventos, un mes sin eventos es 0 eventos)
  const meses = rangoMeses(), cm = {};
  a.forEach(e => { const k = diaLocal(e.t).slice(0, 7); cm[k] = (cm[k] || 0) + 1; });
  grafico('c-mes', { type: 'line', data: { labels: meses, datasets: [{ label: 'Sismos', data: meses.map(k => cm[k] || 0), borderColor: '#14B8A6', backgroundColor: '#14B8A622', fill: true, pointRadius: 0, tension: 0.2 }] },
    options: { ...opc, plugins: { legend: { display: false } }, scales: { x: { ticks: { maxTicksLimit: 9 } }, y: { beginAtZero: true, title: { display: true, text: 'Sismos por mes' } } } } });

  // País (siempre todo el archivo)
  const cp = {}; S.data.forEach(e => { cp[e.pais] = (cp[e.pais] || 0) + 1; });
  const ent = Object.entries(cp).sort((x, y) => y[1] - x[1]);
  grafico('c-pais', { type: 'bar', data: { labels: ent.map(x => x[0]), datasets: [{ label: 'Sismos', data: ent.map(x => x[1]), backgroundColor: ent.map(x => (x[0] === 'Colombia' ? '#14B8A6' : '#2F6BFF')) }] },
    options: { ...opc, indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { title: { display: true, text: 'Cantidad de sismos' } } } } });
}

function rangoMeses() {
  const ks = [], ini = diaLocal(S.data[S.data.length - 1].t).slice(0, 7), fin = diaLocal(S.data[0].t).slice(0, 7);
  let [y, m] = ini.split('-').map(Number);
  while (`${y}-${String(m).padStart(2, '0')}` <= fin) { ks.push(`${y}-${String(m).padStart(2, '0')}`); if (++m > 12) { m = 1; y++; } }
  return ks;
}

function heat(a) {
  const cm = {}; a.forEach(e => { const k = diaLocal(e.t).slice(0, 7); cm[k] = (cm[k] || 0) + 1; });
  const mx = Math.max(1, ...Object.values(cm)), meses = rangoMeses(), fin = meses[meses.length - 1];
  const anios = [...new Set(meses.map(k => k.slice(0, 4)))];
  const cab = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  $('#heat').innerHTML = `<table class="heat"><thead><tr><th>Año</th>${cab.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>` +
    anios.map(y => `<tr><th>${y}</th>${cab.map((_, i) => {
      const k = `${y}-${String(i + 1).padStart(2, '0')}`;
      if (!meses.includes(k)) return '<td class="na">·</td>';
      const n = cm[k] || 0, al = (0.07 + 0.85 * Math.sqrt(n / mx)).toFixed(2);
      return `<td style="background:rgba(47,107,255,${al});color:${al > 0.5 ? '#fff' : '#14233B'}" title="${nombreMes(k)}: ${n} sismos">${n}</td>`;
    }).join('')}</tr>`).join('') + '</tbody></table><p class="nota">Más oscuro = más eventos en ese mes. El punto indica meses fuera del periodo del archivo.</p>';
}

/* ====== Análisis ====== */
function resumenGrupo(arr) {
  const p = arr.map(e => e.prof).filter(v => v != null);
  return { n: arr.length, med: mediana(arr.map(e => e.mag)), max: arr.length ? Math.max(...arr.map(e => e.mag)) : null, prof: mediana(p), f: arr.filter(e => e.mag >= 5).length };
}
function tabla(cab, filas) {
  return `<table><thead><tr>${cab.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>${filas.map(f => `<tr>${f.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
function renderAnalisis() {
  const zonas = {}; S.data.forEach(e => (zonas[e.pais] = zonas[e.pais] || []).push(e));
  $('#tabla-zonas').innerHTML = tabla(['Zona', 'Eventos', 'Magnitud mediana', 'Magnitud máx.', 'Prof. mediana (km)', 'M 5 o más'],
    Object.entries(zonas).sort((a, b) => b[1].length - a[1].length).map(([z, arr]) => { const r = resumenGrupo(arr); return [esc(z), nf.format(r.n), d1(r.med), d1(r.max), d1(r.prof), r.f]; }));

  const a = base(), anios = {};
  a.forEach(e => (anios[diaLocal(e.t).slice(0, 4)] = anios[diaLocal(e.t).slice(0, 4)] || []).push(e));
  $('#tabla-anios').innerHTML = tabla(['Año', 'Eventos', 'Magnitud mediana', 'Magnitud máx.', 'Prof. mediana (km)', 'M 5 o más'],
    Object.keys(anios).sort().map(y => { const r = resumenGrupo(anios[y]); return [y, nf.format(r.n), d1(r.med), d1(r.max), d1(r.prof), r.f]; }));

  // Hallazgo: mes con más registros
  const cm = {}; a.forEach(e => { const k = diaLocal(e.t).slice(0, 7); (cm[k] = cm[k] || []).push(e); });
  const top = Object.entries(cm).sort((x, y) => y[1].length - x[1].length)[0];
  if (top) {
    const cp = {}; top[1].forEach(e => { cp[e.pais] = (cp[e.pais] || 0) + 1; });
    const [pp, pn] = Object.entries(cp).sort((x, y) => y[1] - x[1])[0];
    $('#hallazgo').textContent = `En este ámbito, el mes con más registros fue ${nombreMes(top[0])}, con ${nf.format(top[1].length)} eventos (${nf.format(pn)} con ubicación en ${pp}). Un mes con muchos eventos puede reflejar una secuencia de réplicas y no necesariamente un aumento sostenido de la actividad.`;
  } else $('#hallazgo').textContent = 'No hay eventos en este ámbito.';

  // Frecuencia observada
  const u = +$('#umbral').value, meses = rangoMeses(), conEv = new Set(a.filter(e => e.mag >= u).map(e => diaLocal(e.t).slice(0, 7)));
  const total = a.filter(e => e.mag >= u).length;
  $('#frecuencia').innerHTML = `En <b>${conEv.size} de ${meses.length}</b> meses del archivo (${(conEv.size / meses.length * 100).toLocaleString('es-CO', { maximumFractionDigits: 0 })} %) hubo al menos un evento de magnitud ${u.toString().replace('.', ',')} o más en este ámbito, con ${nf.format(total)} eventos en total. <span class="nota">Es una frecuencia observada en el pasado, no una probabilidad de ocurrencia futura.</span>`;
}
$('#umbral').addEventListener('change', () => { if (S.data.length) renderAnalisis(); });

async function cargarModelos() {
  try {
    const r = await fetch(CONFIG.modelos, { cache: 'no-cache' });
    if (!r.ok) return;
    const m = await r.json();
    if (!Array.isArray(m.resultados)) return;
    $('#modelos').innerHTML = `<h3>Modelos de aprendizaje automático</h3>
      <p class="aviso"><b>Resultado experimental.</b> No es una alerta oficial ni una predicción exacta de cuándo, dónde o con qué magnitud ocurrirá un sismo.</p>
      <p><b>${esc(m.modelo || 'Modelo')}</b>${m.fecha ? ` (${esc(m.fecha)})` : ''}. ${esc(m.descripcion || '')}</p>
      <div class="scroll-x">${tabla(['Zona', 'Periodo', 'Magnitud mínima', 'Probabilidad estimada', 'Intervalo'],
        m.resultados.map(x => [esc(x.zona), esc(x.periodo), esc(x.umbral_magnitud), `${(x.probabilidad * 100).toFixed(1)} %`, Array.isArray(x.intervalo) ? `${(x.intervalo[0] * 100).toFixed(1)}–${(x.intervalo[1] * 100).toFixed(1)} %` : '—']))}</div>`;
  } catch (e) { /* sin modelos: se mantiene el mensaje por defecto */ }
}

/* ====== Navegación, kit y arranque ====== */
function interfaz() {
  const b = $('#burger'), menu = $('#menu');
  b.addEventListener('click', () => { const ab = menu.classList.toggle('abierto'); b.setAttribute('aria-expanded', ab); });
  $$('#menu a').forEach(a => a.addEventListener('click', () => { menu.classList.remove('abierto'); b.setAttribute('aria-expanded', 'false'); }));
  const links = new Map($$('#menu a').map(a => [a.getAttribute('href').slice(1), a]));
  const io = new IntersectionObserver(es => es.forEach(en => {
    if (en.isIntersecting) { links.forEach(l => l.classList.remove('activo')); links.get(en.target.id)?.classList.add('activo'); }
  }), { rootMargin: '-40% 0px -55% 0px' });
  links.forEach((_, id) => { const s = document.getElementById(id); if (s) io.observe(s); });

  $('#btn-live').addEventListener('click', consultarUSGS);
  $('#n-recientes').addEventListener('change', () => { if (S.data.length) renderRecientes(); });
  $('#csv-manual').addEventListener('change', ev => {
    const f = ev.target.files[0]; if (!f) return;
    const rd = new FileReader(); rd.onload = () => iniciar(rd.result); rd.onerror = () => falla(new Error('No se pudo leer el archivo.')); rd.readAsText(f);
  });

  const cajas = $$('[data-kit]');
  let guardado = []; try { guardado = JSON.parse(localStorage.getItem('sismodata-kit') || '[]'); } catch (e) { /* sin almacenamiento */ }
  const pintar = () => { $('#kit-prog').textContent = `Tienes ${cajas.filter(c => c.checked).length} de ${cajas.length} elementos.`; };
  cajas.forEach((c, i) => {
    c.checked = guardado.includes(i);
    c.addEventListener('change', () => { try { localStorage.setItem('sismodata-kit', JSON.stringify(cajas.map((x, k) => (x.checked ? k : -1)).filter(k => k >= 0))); } catch (e) { /* ignorar */ } pintar(); });
  });
  pintar();
}

interfaz();
cargar();
