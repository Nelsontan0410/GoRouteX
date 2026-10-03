const $ = (id) => document.getElementById(id);
let dataset, map, markers = [], filtered = [], selectedId;
const limitText = (sign) => sign.threshold === null ? 'Not specified in source' : `${sign.comparison || ''} ${sign.threshold} ${sign.unit || ''}`;
function element(tag, text) { const node = document.createElement(tag); node.textContent = text; return node; }
function inspect(sign) {
  selectedId = sign.id;
  const detail = $('detail');
  detail.replaceChildren(element('h2', sign.signName));
  for (const [label, value] of [
    ['LTA sign ID', sign.id], ['Sign code', sign.signCode], ['Limit / condition', limitText(sign)],
    ['Sign role', sign.role], ['Vehicle conflict', 'Not evaluated — data inspection only'],
    ['Coordinates', `${sign.latitude}, ${sign.longitude}`], ['Source bearing', `${sign.bearing ?? 'Unknown'}° (${sign.bearingConvention})`],
    ['Source record timestamp', sign.lastUpdated || 'Unknown'],
    ['Road / parent sign', 'Not established']
  ]) detail.append(element('p', `${label}: ${value}`));
  if (map) { map.panTo({ lat: sign.latitude, lng: sign.longitude }); map.setZoom(18); }
}
function renderMap() {
  markers.forEach((marker) => marker.setMap(null)); markers = [];
  if (!map) return;
  const bounds = new google.maps.LatLngBounds();
  for (const sign of filtered.slice(0, 500)) {
    const position = { lat: sign.latitude, lng: sign.longitude };
    const marker = new google.maps.Marker({ map, position, title: `${sign.signCode} · ${sign.signName} · ID ${sign.id}` });
    marker.addListener('click', () => inspect(sign)); markers.push(marker); bounds.extend(position);
  }
  if (markers.length) { map.fitBounds(bounds); if (markers.length === 1) map.setZoom(18); }
}
function render() {
  const code = $('code').value, query = $('search').value.trim();
  filtered = dataset.signs.filter((s) => (!code || s.signCode === code) && (!query || s.id.includes(query)));
  $('count').textContent = `${filtered.length.toLocaleString()} matching signs · ${dataset.count4002} verified code 4002 locations in this snapshot`;
  $('rows').replaceChildren();
  for (const sign of filtered.slice(0, 200)) {
    const row = document.createElement('tr');
    for (const value of [sign.id, sign.signName, limitText(sign), `${sign.latitude.toFixed(6)}, ${sign.longitude.toFixed(6)}`]) row.append(element('td', value));
    const cell = document.createElement('td'), button = element('button', 'Inspect');
    button.addEventListener('click', () => inspect(sign)); cell.append(button); row.append(cell); $('rows').append(row);
  }
  if (!filtered.some((s) => s.id === selectedId)) $('detail').replaceChildren(element('h2', 'Inspect a sign'), element('p', 'Select a row or marker to review source values.'));
  renderMap();
}
async function loadMap() {
  $('load-map').disabled = true;
  try {
    // Reuse the existing browser configuration without maintaining a second API key.
    const response = await fetch('app.html');
    if (!response.ok) throw new Error('Cannot read the existing Maps configuration.');
    const html = await response.text();
    const source = html.match(/https:\/\/maps\.googleapis\.com\/maps\/api\/js\?[^'"\s<]+/);
    if (!source) throw new Error('Existing Google Maps configuration was not found.');
    const url = new URL(source[0]); url.searchParams.set('callback', 'initLtaDebugMap'); url.searchParams.delete('libraries');
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Google Maps did not respond. Check the network and key restrictions.')), 20000);
      window.initLtaDebugMap = () => { clearTimeout(timeout); resolve(); };
      window.gm_authFailure = () => {
        clearTimeout(timeout);
        $('status').textContent = 'Google Maps rejected this origin. Open on an already authorised app domain or configure a development referrer in Google Cloud. The sign table is still available.';
        $('load-map').textContent = 'Map unavailable';
        reject(new Error($('status').textContent));
      };
      const script = document.createElement('script'); script.src = url.href; script.async = true;
      script.onerror = () => { clearTimeout(timeout); reject(new Error('Google Maps could not load.')); };
      document.head.append(script);
    });
    map = new google.maps.Map($('map'), { center: { lat: 1.35, lng: 103.82 }, zoom: 11, streetViewControl: false, mapTypeControl: false });
    $('load-map').textContent = 'Map loaded'; renderMap();
  } catch (error) { $('status').textContent = error.message; $('load-map').textContent = 'Reload page to retry map'; }
}
$('code').addEventListener('change', render); $('search').addEventListener('input', () => dataset && render());
$('load-map').addEventListener('click', loadMap);
try {
  const response = await fetch('data/lta-restrictions.json', { cache: 'no-cache' });
  if (!response.ok) throw new Error('Restriction data unavailable. Run the LTA update command first.');
  dataset = await response.json();
  if (dataset.schemaVersion !== 1 || !Array.isArray(dataset.signs)) throw new Error('Unsupported restriction data format.');
  $('code').replaceChildren(new Option('All retained sign types', ''));
  const codes = [...new Set(dataset.signs.map((s) => s.signCode))].sort();
  for (const code of codes) {
    const signs = dataset.signs.filter((s) => s.signCode === code);
    $('code').append(new Option(`${code} · ${signs[0].signName} (${signs.length})`, code));
  }
  $('code').value = '4002'; $('code').disabled = false; $('load-map').disabled = false;
  $('status').textContent = `${dataset.signs.length.toLocaleString()} retained signs from ${dataset.sourceFeatureCount.toLocaleString()} official records. Detection is not enabled.`;
  $('metadata').textContent = `LTA publication date: ${dataset.sourcePublishedDate || 'Unknown'} · Source period: ${dataset.sourceDataPeriod || 'Unknown'} · Compact file generated: ${new Date(dataset.generatedAt).toLocaleString()} · Source SHA-256: ${dataset.sourceSha256}`;
  render();
} catch (error) { $('status').textContent = error.message; }
