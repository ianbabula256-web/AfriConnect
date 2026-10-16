/* Pure calculation layer: parsing, normalisation, filters, statistics. No DOM. */
const Calc = (() => {
  const parseCSV = (text) => {
    const rows = []; let r = [], f = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
      else if (c === '"') q = true;
      else if (c === ',') { r.push(f); f = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; r.push(f); f = ''; if (r.length > 1 || r[0] !== '') rows.push(r); r = []; }
      else f += c;
    }
    if (f !== '' || r.length) { r.push(f); rows.push(r); }
    return { headers: rows.shift() || [], rows };
  };
  const FIELDS = ['airport','time','wdir','wspd','gust','pres','vis','temp','dew','rh','cloud','precip','metar'];
  const RX = { airport:/station|airport|icao|ident/i, time:/date|time|valid/i, gust:/gust/i, wdir:/wind\s*dir|wdir|drct/i,
    wspd:/wind\s*speed|wspd|sknt/i, pres:/altim|qnh|pressure|slp/i, vis:/visib/i, dew:/dew/i, rh:/humid|relh|\brh\b/i,
    temp:/temp|tmp/i, cloud:/cloud|ceil/i, precip:/precip|rain|p01/i, metar:/metar|raw/i };
  const guessMap = (headers) => {
    const map = {}, used = new Set();
    for (const k of ['gust','wdir','wspd','dew','rh','pres','vis','precip','metar','cloud','time','airport','temp']) {
      const i = headers.findIndex((h, j) => !used.has(j) && RX[k].test(h) && !(k === 'temp' && /dew/i.test(h)));
      map[k] = i; if (i >= 0) used.add(i);
    }
    return map;
  };
  const guessUnits = (headers, map) => {
    const h = (k) => (map[k] >= 0 ? headers[map[k]] : '');
    return {
      wspd: /m\/s|mps/i.test(h('wspd')) ? 'mps' : /km\/h|kmh/i.test(h('wspd')) ? 'kmh' : 'kt',
      pres: /inch|\(in\)|inhg/i.test(h('pres')) ? 'inHg' : /kpa/i.test(h('pres')) ? 'kPa' : 'hPa',
      vis: /mile|\(mi\)/i.test(h('vis')) ? 'mi' : /\bkm\b/i.test(h('vis')) ? 'km' : /meter|\(m\)/i.test(h('vis')) ? 'm' : 'km',
      cloud: /\(m\)|meter/i.test(h('cloud')) ? 'm' : 'ft',
      presType: /station|stn|qfe/i.test(h('pres')) ? 'station' : /slp|sea.?level|mslp/i.test(h('pres')) ? 'slp' : /altim|qnh/i.test(h('pres')) ? 'qnh' : 'unspecified',
    };
  };
  const K = { wspd:{kt:1,mps:1.943844,kmh:0.539957}, pres:{hPa:1,inHg:33.8639,kPa:10}, vis:{km:1,mi:1.609344,m:0.001}, cloud:{ft:1,m:3.28084} };
  const num = (v) => { if (v == null) return null; const s = String(v).trim(); if (!s || /^(null|nan|m|na|n\/a|-)$/i.test(s)) return null; const x = parseFloat(s); return Number.isFinite(x) ? x : null; };
  const parseTime = (v) => {
    const s = String(v ?? '').trim(); if (!s) return null;
    if (/^\d+(\.\d+)?$/.test(s) && +s > 20000 && +s < 80000) return Math.round((+s - 25569) * 86400000); // Excel serial date (UTC)
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:?\d{2})?$/);
    if (m && !m[7]) return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
    const t = Date.parse(s); return Number.isFinite(t) ? t : null;
  };
  const ceilFromMetar = (s) => { // lowest BKN/OVC/VV layer in ft AGL; null = none reported
    let best = null; for (const m of String(s).matchAll(/\b(BKN|OVC|VV)(\d{3})\b/g)) { const h = +m[2] * 100; if (best == null || h < best) best = h; }
    return best;
  };
  const normalise = (table, map, units) => {
    const g = (row, k) => (map[k] >= 0 ? row[map[k]] : null);
    const recs = []; const meta = { rows: table.rows.length, badTime: 0, badTimeRows: [], presType: units.presType || 'unspecified', ceilMode: map.metar >= 0 ? 'metar' : map.cloud >= 0 ? 'lowest-layer' : 'none', conversions: [] };
    if (map.metar >= 0) meta.conversions.push('Ceiling = lowest BKN/OVC/VV layer parsed from the METAR text (FEW/SCT are not ceilings). No such layer = "no ceiling".');
    else if (map.cloud >= 0) meta.conversions.push('No METAR text mapped: the mapped cloud-height column is used as-is and is the lowest layer of ANY cover (may include FEW/SCT), so it is not a true ceiling.');
    if (units.wspd !== 'kt') meta.conversions.push(`Wind speed ${units.wspd} → kt (×${K.wspd[units.wspd]}).`);
    if (units.pres !== 'hPa') meta.conversions.push(`Pressure ${units.pres} → hPa (×${K.pres[units.pres]}).`);
    if (units.vis !== 'km') meta.conversions.push(`Visibility ${units.vis} → km (×${K.vis[units.vis]}).`);
    meta.conversions.push('Timestamps without a timezone are treated as UTC (the file does not state a timezone).');
    meta.conversions.push('Wind direction 0° is treated as 360° (north). Calm = speed 0 kt; calm winds are excluded from direction and runway statistics.');
    table.rows.forEach((row, i) => {
      const t = parseTime(g(row, 'time')); if (t == null) { meta.badTime++; if (meta.badTimeRows.length < 200) meta.badTimeRows.push(i + 2); return; }
      const d = new Date(t); const metar = map.metar >= 0 ? String(row[map.metar] ?? '') : '';
      const cl = num(g(row, 'cloud')); const cloudFt = cl == null ? null : cl * K.cloud[units.cloud];
      const sc = (k, f) => { const x = num(g(row, k)); return x == null ? null : x * f; };
      let wd = num(g(row, 'wdir')); if (wd === 0) wd = 360; if (wd != null && (wd < 0 || wd > 360)) wd = null;
      recs.push({ id: i, ap: String(g(row, 'airport') ?? 'UNKNOWN').trim() || 'UNKNOWN', t, y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, h: d.getUTCHours(),
        wd, ws: sc('wspd', K.wspd[units.wspd]), gu: sc('gust', K.wspd[units.wspd]), p: sc('pres', K.pres[units.pres]), vis: sc('vis', K.vis[units.vis]),
        T: num(g(row, 'temp')), Td: num(g(row, 'dew')), rh: num(g(row, 'rh')), pr: num(g(row, 'precip')),
        ceil: map.metar >= 0 ? (metar ? ceilFromMetar(metar) : undefined) : cloudFt, ceilKnown: map.metar >= 0 ? !!metar : cloudFt != null, raw: metar });
      const last = recs[recs.length - 1]; last.visCens = last.vis != null && last.vis >= 9.99;
    });
    // Duplicate handling: identical airport+time+values are reported and excluded; same airport+time with DIFFERENT values are kept and flagged.
    const seen = new Map(), out = []; meta.dupExact = 0; meta.dupConflict = 0; meta.dupRows = [];
    for (const r of recs) {
      const key = r.ap + '|' + r.t, sig = [r.wd, r.ws, r.gu, r.p, r.vis, r.T, r.Td, r.rh, r.pr, r.raw].join('~'), prev = seen.get(key);
      if (!prev) { seen.set(key, { sig, id: r.id }); out.push(r); }
      else if (prev.sig === sig) { meta.dupExact++; if (meta.dupRows.length < 200) meta.dupRows.push({ row: r.id + 2, of: prev.id + 2, kind: 'exact' }); }
      else { meta.dupConflict++; r.dupConflict = true; if (meta.dupRows.length < 200) meta.dupRows.push({ row: r.id + 2, of: prev.id + 2, kind: 'conflict' }); out.push(r); }
    }
    meta.conversions.push(`Duplicates: ${meta.dupExact} exact duplicate row(s) excluded from analysis (listed in the audit trail); ${meta.dupConflict} row(s) share airport and time with a different value and were KEPT and flagged.`);
    meta.conversions.push('Visibility of about 10 km or more (METAR 9999 m) is censored: it means "at least 10 km", never an exact value.');
    meta.conversions.push(`Pressure column is treated as ${meta.presType === 'qnh' ? 'QNH/altimeter' : meta.presType === 'station' ? 'station pressure' : meta.presType === 'slp' ? 'sea-level pressure' : 'a pressure of unstated type'}; types are not interchangeable and no conversion between them is attempted.`);
    meta.used = out.length; return { recs: out, meta };
  };
  const filter = (recs, f) => recs.filter((r) => (!f.ap || r.ap === f.ap) && r.y >= f.y0 && r.y <= f.y1 && (!f.mo || r.mo === f.mo) && (f.hr < 0 || r.h === f.hr));
  const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
  const pctile = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const i = (s.length - 1) * p / 100, lo = Math.floor(i); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo); };
  const lgam = (x) => { const c = [76.18009172947146,-86.50532032941677,24.01409824083091,-1.231739572450155,0.1208650973866179e-2,-0.5395239384953e-5]; let y = x, t = x + 5.5; t -= (x + .5) * Math.log(t); let s = 1.000000000190015; for (const k of c) s += k / ++y; return -t + Math.log(2.5066282746310005 * s / x); };
  const betacf = (a, b, x) => { const T = 1e-30; let c = 1, d = 1 - (a + b) * x / (a + 1); if (Math.abs(d) < T) d = T; d = 1 / d; let h = d;
    for (let m = 1; m <= 200; m++) { const m2 = 2 * m; let aa = m * (b - m) * x / ((a - 1 + m2) * (a + m2)); d = 1 + aa * d; if (Math.abs(d) < T) d = T; c = 1 + aa / c; if (Math.abs(c) < T) c = T; d = 1 / d; h *= d * c;
      aa = -(a + m) * (a + b + m) * x / ((a + m2) * (a + 1 + m2)); d = 1 + aa * d; if (Math.abs(d) < T) d = T; c = 1 + aa / c; if (Math.abs(c) < T) c = T; d = 1 / d; const del = d * c; h *= del; if (Math.abs(del - 1) < 3e-12) break; } return h; };
  const ibeta = (x, a, b) => { if (x <= 0) return 0; if (x >= 1) return 1; const bt = Math.exp(lgam(a + b) - lgam(a) - lgam(b) + a * Math.log(x) + b * Math.log(1 - x)); return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b; };
  const ols = (xs, ys) => { const n = xs.length; if (n < 3) return null; const mx = mean(xs), my = mean(ys); let sxx = 0, sxy = 0, syy = 0;
    xs.forEach((x, i) => { sxx += (x - mx) ** 2; sxy += (x - mx) * (ys[i] - my); syy += (ys[i] - my) ** 2; });
    const slope = sxy / sxx, icpt = my - slope * mx, sse = syy - slope * sxy, df = n - 2; const se = Math.sqrt(sse / df / sxx);
    const p = se === 0 ? 0 : ibeta(df / (df + (slope / se) ** 2), df / 2, .5); return { slope, icpt, n, r2: syy ? 1 - sse / syy : 0, p }; };
  const sector = (d) => Math.floor((((d % 360) + 360) % 360 + 11.25) / 22.5) % 16;
  const BANDS = [0, 5, 10, 15, 20];
  const rose = (R) => { const counts = Array.from({ length: 16 }, () => [0, 0, 0, 0, 0]); const sp = Array.from({ length: 16 }, () => []); let calm = 0, n = 0, nd = 0;
    for (const r of R) { if (r.ws == null) continue; n++; if (r.ws === 0) { calm++; continue; } if (r.wd == null) continue; nd++; const s = sector(r.wd); let b = 0; BANDS.forEach((e, i) => { if (r.ws >= e && r.ws > 0) b = i; }); counts[s][b]++; sp[s].push(r.ws); }
    return { n, calm, nd, counts, sp }; };
  const components = (R, hdg, th) => { let n = 0, head = 0, tail = 0, tailX = 0, xwX = 0; const xs = [];
    for (const r of R) { if (r.ws == null || r.wd == null || r.ws === 0) continue; n++; const a = (r.wd - hdg) * Math.PI / 180; const hw = Math.round(r.ws * Math.cos(a) * 1e6) / 1e6, xw = Math.round(Math.abs(r.ws * Math.sin(a)) * 1e6) / 1e6; // rounded: cos(90°) is not exactly 0
      if (hw > 0) head++; else if (hw < 0) tail++; if (hw <= -th.tail) tailX++; if (xw >= th.xw) xwX++; xs.push(xw); }
    return { n, head, tail, tailX, xwX, xwP90: pctile(xs, 90) }; };
  const group = (R, keyFn, valFn) => { const m = new Map(); for (const r of R) { const k = keyFn(r), v = valFn(r); if (v == null) continue; (m.get(k) || m.set(k, []).get(k)).push(v); } return m; };
  const share = (R, valid, test) => { let n = 0, k = 0; for (const r of R) { if (!valid(r)) continue; n++; if (test(r)) k++; } return { n, k, pct: n ? 100 * k / n : null }; };
  const CORE = ['wd', 'ws', 'p', 'vis', 'T'];
  const missing = (R) => Object.fromEntries(['wd','ws','gu','p','vis','T','Td','rh','pr','ceilKnown'].map((k) => [k, R.length ? 100 * R.filter((r) => r[k] == null || r[k] === false).length / R.length : null]));

  // ---- METAR text helpers (observed text only; trend/forecast groups after TEMPO/BECMG/NOSIG/RMK/PROB are ignored) ----
  const obsTokens = (raw) => { const out = []; for (const t of String(raw || '').trim().split(/\s+/)) { if (/^(TEMPO|BECMG|NOSIG|RMK|FM\d{4}|TL\d{4}|AT\d{4})$/.test(t) || /^PROB\d\d$/.test(t)) break; if (t) out.push(t); } return out; };
  const WX_RX = /^(\+|-|VC)?(MI|PR|BC|DR|BL|SH|FZ)?(TS)?(DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PY|PO|SQ|FC|SS|DS)*$/, WX_HAS = /(TS|DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PY|PO|SQ|FC|SS|DS)/;
  const wxTokens = (raw) => obsTokens(raw).filter((t) => t.length >= 2 && WX_RX.test(t) && WX_HAS.test(t));
  const cloudLayers = (raw) => { const L = []; for (const t of obsTokens(raw)) { const m = t.match(/^(FEW|SCT|BKN|OVC)(\d{3})(CB|TCU)?$/); if (m) L.push({ cov: m[1], ft: +m[2] * 100, type: m[3] || null }); const v = t.match(/^VV(\d{3})$/); if (v) L.push({ cov: 'VV', ft: +v[1] * 100, type: null }); } return L; };
  const OKTA = { FEW: 1.5, SCT: 3.5, BKN: 6, OVC: 8, VV: 8 };
  const cloudCover = (raw) => { // null = cannot tell (no METAR text); oktas = highest reported amount
    if (!String(raw || '').trim()) return null; const L = cloudLayers(raw);
    if (L.length) return { oktas: Math.max(...L.map((l) => OKTA[l.cov])), basis: 'METAR cloud groups' };
    if (obsTokens(raw).some((t) => /^(CAVOK|SKC|CLR|NSC|NCD)$/.test(t))) return { oktas: 0, basis: 'METAR clear-sky group' };
    return null; };
  const medianStep = (R) => { const ts = R.map((r) => r.t).sort((a, b) => a - b), d = []; for (let i = 1; i < ts.length; i++) if (ts[i] > ts[i - 1]) d.push(ts[i] - ts[i - 1]); return d.length ? pctile(d, 50) : null; };
  // Event grouping: consecutive qualifying observations, split by any gap > gapMs. Not attempted when the typical spacing is coarser than maxStepMs.
  // Duration is first-to-last qualifying report, i.e. a LOWER BOUND on the true episode length.
  const events = (R, valid, test, o = {}) => {
    const gapMs = o.gapMs ?? 3 * 3600e3, maxStepMs = o.maxStepMs ?? 3 * 3600e3, A = R.filter(valid).sort((a, b) => a.t - b.t), step = medianStep(A);
    if (!A.length || step == null || step > maxStepMs) return { ok: false, step, events: [] };
    const ev = []; let cur = null, prev = null;
    for (const r of A) { if (prev && r.t - prev.t > gapMs && cur) { ev.push(cur); cur = null; }
      if (test(r)) { const v = o.peak ? o.peak.fn(r) : null; if (cur) { cur.end = r.t; cur.n++; } else cur = { start: r.t, end: r.t, n: 1, firstId: r.id, peak: null };
        if (v != null && (cur.peak == null || (o.peak.mode === 'min' ? v < cur.peak : v > cur.peak))) cur.peak = v; } else if (cur) { ev.push(cur); cur = null; }
      prev = r; }
    if (cur) ev.push(cur); ev.forEach((e) => { e.durMs = e.end - e.start; }); return { ok: true, step, events: ev }; };
  const coverage = (R) => { if (!R.length) return { n: 0 }; let lo = Infinity, hi = -Infinity; const days = new Set(); for (const r of R) { if (r.t < lo) lo = r.t; if (r.t > hi) hi = r.t; days.add(Math.floor(r.t / 864e5)); }
    const span = Math.floor(hi / 864e5) - Math.floor(lo / 864e5) + 1, st = medianStep(R); return { n: R.length, first: lo, last: hi, days: days.size, spanDays: span, dayCoverage: 100 * days.size / span, stepMin: st == null ? null : st / 6e4 }; };
  const wilson = (k, n, z = 1.96) => { if (!n) return null; const p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [Math.max(0, (c - m) / d) * 100, Math.min(1, (c + m) / d) * 100]; };
  const csvCell = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const toCSV = (R) => { const cols = ['id','ap','t','wd','ws','gu','p','vis','visCens','ceil','T','Td','rh','raw']; return ['source_row,airport,utc_time,wind_dir_deg,wind_kt,gust_kt,pressure_hpa,vis_km,vis_censored_ge_10km,ceiling_ft,temp_c,dewpoint_c,rh_pct,metar'].concat(R.map((r) => cols.map((c) => csvCell(c === 't' ? new Date(r.t).toISOString() : c === 'id' ? r.id + 2 : r[c])).join(','))).join('\n'); };
  const api = { parseCSV, guessMap, guessUnits, normalise, filter, mean, pctile, ols, sector, rose, components, group, share, missing, toCSV, ceilFromMetar, parseTime, obsTokens, wxTokens, cloudLayers, cloudCover, medianStep, events, coverage, wilson, FIELDS, BANDS, CORE };
  return api;
})();
if (typeof module !== 'undefined') module.exports = Calc;
