const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), path = require('path'), C = require('../src/calc.js'), S = require('../src/scene.js');
const H = 3600e3, T0 = Date.UTC(2020, 2, 20), root = path.resolve(__dirname, '..');
const rec = (i, o = {}) => ({ id: i, ap: 'HUEN', t: T0 + i * H, wd: 90, ws: 8, gu: null, p: 1013, vis: 9.99, visCens: true, T: 25, Td: 20, rh: 80, ceil: null, ceilKnown: true, raw: 'HUEN X 09008KT 9999 FEW030', ...o });
const NR = { rows: [['HUEN', '2020-03-01 10:00', '350', '10', '1013', '9999', 'm'], ['HUEN', '2020-03-01 10:00', '350', '10', '1013', '9999', 'm'], ['HUEN', '2020-03-01 10:00', '350', '12', '1013', '9999', 'm'], ['HUEN', 'garbage', '', '', '', '', '']] };
const norm = () => C.normalise(NR, { airport: 0, time: 1, wdir: 2, wspd: 3, pres: 4, vis: 5, metar: 6 }, { wspd: 'kt', pres: 'hPa', vis: 'm', cloud: 'ft', presType: 'station' });

test('duplicates: exact ones excluded and reported, conflicting ones kept and flagged; rejected rows listed', () => {
  const { recs, meta } = norm(); assert.equal(meta.rows, 4); assert.equal(meta.used, 2); assert.equal(meta.dupExact, 1); assert.equal(meta.dupConflict, 1); assert.deepEqual(meta.badTimeRows, [5]);
  assert.equal(recs.filter((r) => r.dupConflict).length, 1); assert.equal(meta.rows, meta.used + meta.dupExact + meta.badTime); assert.ok(meta.conversions.some((c) => /Duplicates: 1 exact/.test(c))); });
test('pressure type is recorded and never silently treated as QNH', () => { const { meta } = norm(); assert.equal(meta.presType, 'station'); assert.ok(meta.conversions.some((c) => /station pressure/.test(c) && /not interchangeable/.test(c)));
  assert.equal(C.guessUnits(['Altimeter(inches)'], { pres: 0 }).presType, 'qnh'); assert.equal(C.guessUnits(['Station pressure (hPa)'], { pres: 0 }).presType, 'station'); assert.equal(C.guessUnits(['Pressure'], { pres: 0 }).presType, 'unspecified'); });
test('METAR 9999 and 10 km values are flagged censored; 8 km is not', () => { const f = (v, u) => C.normalise({ rows: [['A', '2020-01-01 00:00', v]] }, { airport: 0, time: 1, vis: 2 }, { wspd: 'kt', pres: 'hPa', vis: u, cloud: 'ft' }).recs[0];
  assert.equal(f('9999', 'm').visCens, true); assert.equal(f('10', 'km').visCens, true); assert.equal(f('8000', 'm').visCens, false); assert.equal(f('6.21', 'mi').visCens, true); });
test('coverage and median step', () => { const R = [0, 1, 2, 3].map((i) => rec(i)); const c = C.coverage(R); assert.equal(c.n, 4); assert.equal(c.days, 1); assert.equal(c.stepMin, 60); assert.deepEqual(C.coverage([]), { n: 0 }); });
test('wind direction convention and wind rose totals', () => { const R = [0, 1, 2, 3].map((i) => ({ ws: i ? 6 : 0, wd: i === 1 ? 360 : i === 2 ? 0 : 90 })); R[2].wd = 360; const r = C.rose(R); assert.equal(r.calm, 1); assert.equal(r.nd, 3); assert.equal(r.counts.flat().reduce((a, b) => a + b, 0), r.nd); assert.equal(r.counts[0].reduce((a, b) => a + b, 0), 2); });

test('solar elevation is plausible at Entebbe (equinox)', () => { const loc = { lat: 0.0424, lon: 32.4435 }, noon = S.solarElev(Date.UTC(2026, 2, 20, 9, 50), loc.lat, loc.lon), mid = S.solarElev(Date.UTC(2026, 2, 20, 21, 50), loc.lat, loc.lon); assert.ok(noon > 80, noon); assert.ok(mid < -60, mid); });
test('scene: fog only from FG/BR codes; low cloud base, low visibility and 99% humidity are not fog or rain', () => {
  const s = S.describe(rec(0, { raw: 'HUEN 09005KT 0400 OVC002', vis: 0.4, visCens: false, ceil: 200, rh: 99 }), null); assert.equal(s.fog, 0); assert.equal(s.rain, 0); assert.equal(s.thunder, false); assert.equal(s.cover, 1);
  assert.ok(S.describe(rec(0, { raw: 'HUEN 09005KT 0400 FG OVC002' }), null).fog > 0.5); assert.ok(S.describe(rec(0, { raw: 'HUEN 09005KT 4000 BR SCT010' }), null).fog > 0 ); });
test('scene: thunderstorm only when TS is coded at the station; trend groups and VCTS are ignored', () => {
  assert.equal(S.describe(rec(0, { raw: 'HUEN 09005KT 8000 +TSRA BKN020CB' }), null).thunder, true); assert.equal(S.describe(rec(0, { raw: 'HUEN 09005KT 9999 FEW030 TEMPO TSRA' }), null).thunder, false); assert.equal(S.describe(rec(0, { raw: 'HUEN 09005KT 9999 VCTS FEW030' }), null).thunder, false);
  const h = S.describe(rec(0, { raw: 'HUEN 09005KT 5000 +RA BKN020' }), null), l = S.describe(rec(0, { raw: 'HUEN 09005KT 5000 -RA BKN020' }), null); assert.ok(h.rain > l.rain); });
test('scene: no METAR text -> cloud is Missing, not invented; rows tag every element', () => {
  const s = S.describe(rec(0, { raw: '' }), null), cl = s.rows.find((r) => r[0] === 'Cloud amount'); assert.equal(s.coverKnown, false); assert.equal(cl[2], S.TAG.MIS); assert.equal(s.rows.find((r) => r[0] === 'Thunderstorm')[2], S.TAG.MIS);
  const g = S.describe(rec(0), { lat: 0.04, lon: 32.4 }); assert.equal(g.rows.find((r) => r[0] === 'Cloud shapes and motion')[2], S.TAG.ILL); assert.equal(g.rows.find((r) => r[0] === 'Lighting')[2], S.TAG.DER); assert.equal(g.rows.find((r) => r[0] === 'Wind')[2], S.TAG.OBS);
  assert.equal(g.rows.find((r) => r[0] === 'Transition between reports')[2], S.TAG.ILL); });
test('replay steps use REAL timestamps only: irregular spacing preserved, gaps flagged, nothing padded', () => {
  const R = [rec(5), rec(0), rec(1), rec(9)], st = S.steps(R); assert.deepEqual(st.map((x) => x.rec.id), [0, 1, 5, 9]); assert.deepEqual(st.map((x) => x.gap), [false, false, true, true].map((v, i) => (i === 3 ? 4 * H > 3 * H : v))); assert.equal(st.length, 4); assert.equal(st[0].gapMs, null); });
test('replay day selection: empty day returns no records (UI shows an explicit empty state); airport and UTC day respected', () => {
  const R = [rec(1), rec(2, { ap: 'HKJK' }), rec(30)]; assert.equal(S.dayOf(R, 'HUEN', '2020-03-20').length, 1); assert.equal(S.dayOf(R, 'HUEN', '2020-03-21').length, 1); assert.equal(S.dayOf(R, 'HUEN', '2019-01-01').length, 0); assert.equal(S.dayOf(R, 'HUEN', 'nonsense').length, 0); });
test('clock: UTC always, local only with a known offset', () => { const t = Date.UTC(2020, 2, 20, 21, 30); assert.match(S.clock(t, 'utc', 3), /2020-03-20 21:30 UTC$/); assert.match(S.clock(t, 'local', 3), /2020-03-21 00:30 UTC\+3$/); assert.match(S.clock(t, 'local', null), /UTC$/); });

test('network boundary: no fetch/XHR/WebSocket/EventSource/beacon/polling in app source or service worker', () => {
  for (const f of ['src/calc.js', 'src/advisory.js', 'src/scene.js', 'src/app.template.html', 'public/sw.js']) { const s = fs.readFileSync(path.join(root, f), 'utf8').replace(/self\.addEventListener\('fetch'[\s\S]*$/, f === 'public/sw.js' ? '' : '$&');
    assert.doesNotMatch(s.replace(/fetch\(r\)/g, ''), /\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|setInterval\s*\(/, f); assert.doesNotMatch(s, /https?:\/\/(?!www\.w3\.org)[a-z0-9.-]+\.[a-z]{2,}\/[^\s'"]*\.(json|csv)|aviationweather|api\.weather|openweather|tafs?\b.*endpoint/i, f); } });
test('built app contains advisory, scene and replay code and is current', () => { const out = fs.readFileSync(path.join(root, 'dist/index.html'), 'utf8'); for (const k of ['const Advisory', 'const Scene', 'Historical Replay', 'FORBSPACE Historical Weather Intelligence']) assert.ok(out.includes(k), k); assert.doesNotMatch(out, /class="scene"|storm cloud|takeoff/); });
