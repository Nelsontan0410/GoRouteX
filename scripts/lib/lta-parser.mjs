export const DATASET_ID = 'd_bbf0132c7290d6838f82003972d933d5';
export const SOURCE_URL = `https://data.gov.sg/datasets/${DATASET_ID}/view`;
export const SPECIFICATION_URL = 'https://www.lta.gov.sg/content/dam/ltagov/industry_innovations/industry_matters/development_construction_resources/Street_Work_Proposals/Standards_and_Specifications/GIS_Data_Hub/gis_data_hub_data_collection_specification_v3.3.pdf';

// Classification is based on descriptions in the official source, not an invented road list.
// Codes and their exact source descriptions are exported together for review on every update.
export function classifySign(code, description) {
  const name = description.replace(/\[\d+\]/g, '').replace(/\s+/g, ' ').trim();
  const supplementary = /^4\d{3}$/.test(code);
  let category = null;
  if (/unladen weight/i.test(name)) category = 'UNLADEN_WEIGHT';
  else if (/height limit/i.test(name)) category = 'HEIGHT';
  else if (/width limit/i.test(name)) category = 'WIDTH';
  else if (/weight limit|max laden weight/i.test(name)) category = 'LADEN_WEIGHT';
  else if (/restriction.*axles|no movement.*axles/i.test(name)) category = 'AXLES';
  else if (/restriction on lorry/i.test(name)) category = 'LORRY';
  else if (/no entry except|authorised vehicles only/i.test(name) && !/pedestrian/i.test(name)) category = 'ACCESS';
  else if (supplementary && /except|authoris|loading|unloading|heavy vehicle|lorry|axle/i.test(name)) category = 'SUPPLEMENTARY';
  if (!category) return null;

  const role = supplementary ? 'SUPPLEMENTARY' : /^2\d{3}$/.test(code) ? 'ADVANCE_WARNING' : /^3\d{3}$/.test(code) ? 'INFORMATION' : 'RESTRICTION';
  let threshold = null;
  let unit = null;
  let comparison = null;
  if (category === 'UNLADEN_WEIGHT') {
    const match = name.match(/(\d+(?:\.\d+)?)\s*kg/i);
    if (match) { threshold = Number(match[1]); unit = 'kg'; }
    comparison = /not exceeding/i.test(name) ? 'NOT_EXCEEDING' : /exceeding/i.test(name) ? 'EXCEEDING' : null;
  } else if (category === 'HEIGHT' || category === 'WIDTH') {
    const match = name.match(/\b(\d+(?:\.\d+)?)\s*m\b/i);
    if (match) { threshold = Number(match[1]); unit = 'm'; comparison = 'MAXIMUM'; }
  } else if (category === 'LADEN_WEIGHT') {
    const match = name.match(/\b(\d+(?:\.\d+)?)\s*tonnes?\b/i);
    if (match) { threshold = Number(match[1]) * 1000; unit = 'kg'; comparison = 'MAXIMUM'; }
  } else if (category === 'AXLES') {
    const match = name.match(/(\d+)\s*or more axles/i);
    if (match) { threshold = Number(match[1]); unit = 'axles'; comparison = 'AT_LEAST'; }
  }
  return { signName: name, restrictionCategory: category, role, threshold, unit, comparison };
}

function numberOrNull(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeLtaGeoJSON(raw) {
  if (raw?.type !== 'FeatureCollection' || !Array.isArray(raw.features) || !raw.features.length) {
    throw new Error('Expected a nonempty LTA GeoJSON FeatureCollection.');
  }
  const signs = [], codes = new Map(), seen = new Set();
  const issues = { missingCodeOrDescription: 0, invalidRelevantRecords: [], missingBearing: 0 };
  for (const feature of raw.features) {
    const properties = feature?.properties || {};
    const code = String(properties.TYP_NAM ?? '').trim();
    const description = String(properties.TYP_CD ?? '').trim();
    if (!code || !description) { issues.missingCodeOrDescription++; continue; }
    const key = `${code}|${description}`;
    const classification = classifySign(code, description);
    const entry = codes.get(key) || { signCode: code, sourceDescription: description, count: 0, retained: !!classification };
    entry.count++;
    codes.set(key, entry);
    if (!classification) continue;
    const coords = feature?.geometry?.coordinates || [];
    const longitude = numberOrNull(coords[0]), latitude = numberOrNull(coords[1]);
    const id = String(properties.UNIQUE_ID ?? '').trim();
    // Broad Singapore bounds catch swapped/projected coordinates without clipping offshore signs.
    if (feature?.geometry?.type !== 'Point' || longitude === null || latitude === null ||
        longitude < 103 || longitude > 105 || latitude < 1 || latitude > 2 || !id) {
      issues.invalidRelevantRecords.push({ id, code }); continue;
    }
    if (seen.has(id)) throw new Error(`Duplicate relevant LTA UNIQUE_ID: ${id}`);
    seen.add(id);
    const rawBearing = numberOrNull(properties.BEARG_NUM);
    const bearing = rawBearing !== null && rawBearing >= 0 && rawBearing <= 360 ? rawBearing % 360 : null;
    if (bearing === null) issues.missingBearing++;
    signs.push({ id, signCode: code, ...classification, latitude, longitude, bearing,
      // LTA GIS specification v3.3 §16.37 note 4: traffic flow, except 1014 and 4006.
      bearingConvention: ['1014', '4006'].includes(code) ? 'EXCEPTION_REQUIRES_REVIEW' : 'TRAVEL_DIRECTION', parentSignId: null, roadSegmentId: null,
      source: 'LTA', lastUpdated: String(properties.FMEL_UPD_D ?? '') || null });
  }
  if (issues.invalidRelevantRecords.length) throw new Error(`Invalid relevant LTA records: ${JSON.stringify(issues.invalidRelevantRecords.slice(0, 10))}`);
  if (!signs.length) throw new Error('No relevant signs extracted; previous dataset must be retained.');
  const catalogue = [...codes.values()].sort((a, b) => a.signCode.localeCompare(b.signCode) || a.sourceDescription.localeCompare(b.sourceDescription));
  return { signs, catalogue, issues, sourceFeatureCount: raw.features.length };
}
