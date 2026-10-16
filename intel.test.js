const test = require('node:test'), assert = require('node:assert/strict'), C = require('../src/calc.js'), A = require('../src/advisory.js');
const H = 3600e3, T0 = Date.UTC(2020, 5, 1);
const mk = (i, o = {}) => ({ id: i, ap: 'HUEN', t: T0 + i * H, y: 2020, mo: 6, h: i % 24, wd: 90, ws: 5, gu: null, p: 1013, vis: 9.99, visCens: true, T: 25, Td: 18, rh: null, pr: null, ceil: null, ceilKnown: true, raw: 'HUEN X 09005KT 9999 FEW030', ...o });
const run = (R, cfg = {}) => A.analyse(R, { ceilMode: 'metar', hasRaw: true, airport: 'HUEN', period: '2020', source: 't.csv', ...cfg });
const card = (res, id) => res.cards.find((c) => c.id === id);
const RW = { hdgA: 170, hdgB: 350, hdg: 170, trueConfirmed: true };

test('compound precedence: TS+wind is raised to RED even when the share is tiny; floor is explained and configurable', () => {
  const R = Array.from({ length: 2000 }, (_, i) => mk(i, i < 3 ? { raw: 'HUEN 09025KT 8000 TSRA BKN020CB', ws: 25 } : {}));
  const c = card(run(R), 'compound_ts_wind'); assert.equal(c.k, 3); assert.ok(c.pct < 1); assert.equal(c.cls, 'RED'); assert.equal(c.floor.from, 'INFO'); assert.match(c.floor.rule, /precedence/i);
  assert.equal(card(run(R, { floors: { compound_ts_wind: null } }), 'compound_ts_wind').cls, 'INFO'); });
test('floor is NOT applied without an adequate sample or any qualifying report', () => {
  assert.deepEqual(A.applyFloor('GREY', 2, 10, 30, 'RED'), { cls: 'GREY', from: null }); assert.deepEqual(A.applyFloor('GREEN', 0, 500, 30, 'RED'), { cls: 'GREEN', from: null }); assert.deepEqual(A.applyFloor('RED', 90, 100, 30, 'AMBER'), { cls: 'RED', from: null });
  assert.equal(card(run(Array.from({ length: 10 }, (_, i) => mk(i, { raw: 'HUEN 09025KT 8000 TSRA', ws: 25 }))), 'compound_ts_wind').cls, 'GREY'); });
test('compound rules need aligned variables in the SAME report; trend groups and VCTS never count', () => {
  const R = Array.from({ length: 100 }, (_, i) => mk(i, i < 4 ? { raw: 'HUEN 09005KT 2000 TSRA BKN010', vis: 2, visCens: false, ceil: 1000, ws: 5 } : i < 8 ? { raw: 'HUEN 09005KT 9999 FEW030 TEMPO 1000 TSRA', vis: 9.99 } : i < 10 ? { raw: 'HUEN 09005KT 2000 VCTS', vis: 2, visCens: false } : i < 14 ? { raw: 'HUEN 09005KT 3000 -RA SCT020', vis: 3, visCens: false } : {}));
  const r = run(R); assert.equal(card(r, 'compound_ts_vis').k, 4); assert.equal(card(r, 'compound_rain_vis').k, 8); // TSRA (4) + -RA (4); VCTS excluded
  assert.equal(card(r, 'compound_vis_ceil').k, 4); assert.equal(card(r, 'compound_vis_ceil').cls, 'AMBER'); assert.equal(card(r, 'compound_vis_ceil').floor.from, 'YELLOW'); });
test('compound_vis_ceil is blocked with no ceiling source and labels a generic cloud column as a proxy', () => {
  const R = Array.from({ length: 50 }, (_, i) => mk(i)); assert.equal(card(run(R, { ceilMode: 'none' }), 'compound_vis_ceil').cls, 'GREY');
  assert.match(card(run(R, { ceilMode: 'lowest-layer' }), 'compound_vis_ceil').limitations.join(' '), /PROXY/); });
test('event peaks: lowest visibility / peak wind are tracked per episode', () => {
  const R = [0, 1, 2, 3, 4, 5, 6, 7].map((h) => mk(h, { vis: [9.99, 3, 1.5, 4, 9.99, 2, 9.99, 9.99][h], visCens: [0, 4, 6, 7].includes(h), ws: [3, 30, 40, 26, 3, 3, 3, 3][h] }));
  const v = C.events(R, (r) => r.vis != null, (r) => r.vis < 5, { peak: { fn: (r) => r.vis, mode: 'min' } }); assert.equal(v.events.length, 2); assert.equal(v.events[0].peak, 1.5); assert.equal(v.events[1].peak, 2);
  const w = C.events(R, (r) => r.ws != null, (r) => r.ws >= 25, { peak: { fn: (r) => r.ws, mode: 'max' } }); assert.equal(w.events[0].peak, 40); assert.equal(w.events[0].n, 3); });
test('advisory cards expose the full event list with peaks for the explorer', () => {
  const R = Array.from({ length: 200 }, (_, i) => mk(i, { ws: (i % 50) < 3 ? 30 : 3 })); const e = card(run(R), 'wind_strong').events; assert.equal(e.ok, true); assert.equal(e.all.length, 4); assert.equal(e.peak.label, 'Peak mean wind'); assert.ok(e.all.every((x) => x.peak === 30)); assert.equal(e.ap, 'HUEN'); });
test('flags(): lists exactly the configured conditions a single report meets; blocked rules never fire', () => {
  const r = mk(0, { ws: 30, gu: 40, vis: 2, visCens: false, raw: 'HUEN 09030G40KT 2000 TSRA BKN010', ceil: 1000 }), ids = A.flags(r, { ceilMode: 'metar' }).map((x) => x.id);
  for (const id of ['vis_low', 'ceil_low', 'wind_strong', 'gust_strong', 'thunder', 'compound_vis_wind', 'compound_vis_ceil', 'compound_ts_wind', 'compound_ts_vis', 'compound_rain_vis']) assert.ok(ids.includes(id), id);
  assert.ok(!ids.includes('xwind') && !ids.includes('fog')); assert.deepEqual(A.flags(mk(1), { ceilMode: 'metar' }), []); });

test('runway bands: partitions reconcile to the non-calm count; both ends; gated on TRUE heading and reciprocal ends', () => {
  const R = [...Array.from({ length: 10 }, (_, i) => mk(i, { ws: 0, wd: null })), ...Array.from({ length: 10 }, (_, i) => mk(10 + i, { ws: 12, wd: 350 })), ...Array.from({ length: 10 }, (_, i) => mk(20 + i, { ws: 12, wd: 260 })), mk(31, { ws: 9, wd: null })];
  const b = A.runwayBands(R, RW); assert.equal(b.n, 20); assert.equal(b.calm, 10); assert.equal(b.crosswind.reduce((s, x) => s + x.k, 0), b.n); for (const e of b.ends) assert.equal(e.tailwind.reduce((s, x) => s + x.k, 0), b.n);
  assert.equal(b.ends[0].tailwind[3].k, 10); // wind from 350 is a 12 kt tailwind on heading 170
  assert.equal(b.ends[0].headwind, 0); assert.equal(b.ends[1].headwind, 10); assert.equal(b.crosswind[2].k, 10); // wind from 260 on 170/350: 12 kt crosswind, band 10-15
  assert.match(A.runwayBands(R, { ...RW, trueConfirmed: false }).blocked[0], /TRUE heading/); assert.match(A.runwayBands(R, { ...RW, hdgB: 340 }).blocked.join(' '), /not reciprocal/); assert.ok(A.runwayBands(R, { hdgA: NaN, hdgB: 350, trueConfirmed: true }).blocked.length); });
test('aircraft exposure: no limit is ever assumed; every missing input blocks with a reason', () => {
  const R = Array.from({ length: 50 }, (_, i) => mk(i)); const full = { name: 'Type X', source: 'Operator manual 4.2', rev: '12', eff: '2025-03-01', verified: true, xw: 15, tail: 5 };
  assert.ok(A.aircraftReasons({}, RW).length >= 6); assert.match(A.aircraftReasons({ ...full, verified: false }, RW).join(' '), /not marked as verified/); assert.match(A.aircraftReasons({ ...full, source: ' ' }, RW).join(' '), /source document/); assert.match(A.aircraftReasons({ ...full, rev: '' }, RW).join(' '), /revision/);
  assert.match(A.aircraftReasons({ ...full, xw: 0, tail: 0 }, RW).join(' '), /at least one limit/); assert.match(A.aircraftReasons(full, { ...RW, trueConfirmed: false }).join(' '), /TRUE heading/); assert.deepEqual(A.aircraftReasons(full, RW), []);
  const blocked = A.analyseAircraft(R, { aircraft: { name: 'Type X' }, runway: RW }); assert.equal(blocked.cards.length, 0); assert.ok(blocked.blocked.length); });
test('aircraft exposure: exact numerators, gust-inclusive crosswind, per-end tailwind, source and version carried onto the card', () => {
  const full = { name: 'Type X', source: 'Operator manual 4.2', rev: '12', eff: '2025-03-01', verified: true, xw: 15, tail: 5 };
  const R = [...Array.from({ length: 20 }, (_, i) => mk(i, { wd: 350, ws: 20 })), ...Array.from({ length: 20 }, (_, i) => mk(20 + i, { wd: 260, ws: 10, gu: 25 })), ...Array.from({ length: 20 }, (_, i) => mk(40 + i, { wd: 260, ws: 10 }))];
  const res = A.analyseAircraft(R, { aircraft: full, runway: RW, ceilMode: 'metar', hasRaw: true, airport: 'HUEN', period: '2020', source: 't.csv' }), g = (id) => res.cards.find((c) => c.id === id);
  assert.deepEqual(res.blocked, []); assert.equal(g('ac_xw_mean').k, 0); assert.equal(g('ac_xw_gust').k, 20); assert.equal(g('ac_xw_gust').n, 60); assert.equal(g('ac_tail_A').k, 20); assert.equal(g('ac_tail_B').k, 0);
  assert.match(g('ac_xw_gust').provenance, /Operator manual 4\.2, revision 12, effective 2025-03-01/); assert.match(g('ac_xw_gust').provenance, /not independently verified/); assert.match(g('ac_tail_A').limitations.join(' '), /not a statement that any operation/); assert.equal(g('ac_tail_A').family, 'Aircraft-specific exposure'); });

test('quality grades A-E per variable and a worst-of-core airport grade', () => {
  assert.equal(A.grade(100, 500, 30), 'A'); assert.equal(A.grade(95, 500, 30), 'A'); assert.equal(A.grade(94.9, 500, 30), 'B'); assert.equal(A.grade(70, 500, 30), 'C'); assert.equal(A.grade(50, 500, 30), 'D'); assert.equal(A.grade(49.9, 500, 30), 'E'); assert.equal(A.grade(100, 10, 30), 'E');
  const R = Array.from({ length: 100 }, (_, i) => mk(i, i < 40 ? { vis: null } : {})), p = A.profile(R, { ceilMode: 'metar' }, run(R)); assert.equal(p.grades.find((g) => g.key === 'ws').grade, 'A'); assert.equal(p.grades.find((g) => g.key === 'vis').grade, 'D'); assert.equal(p.airportGrade, 'D'); });
test('airport profile numbers: prevailing sector, calm share, percentiles, gust denominators in BOTH forms, historical-only wording', () => {
  const R = Array.from({ length: 200 }, (_, i) => mk(i, { wd: i % 4 ? 90 : 180, ws: i % 10 === 0 ? 0 : 10, gu: i % 5 === 1 ? 35 : null })), p = A.profile(R, { ceilMode: 'metar' });
  assert.equal(p.wind.prevailing.dir, 'E'); assert.equal(p.wind.calmPct, 10); assert.equal(p.wind.p50, 10); assert.equal(p.wind.gustReports, 40); assert.equal(p.wind.gustAllPct, 20); assert.equal(p.wind.gustHighPct, 100); assert.equal(p.vis.censPct, 100); assert.equal(p.temp.p50, 25);
  for (const h of p.hazards) assert.doesNotMatch(h.statement, /\b(currently|right now|forecast|will happen|is safe|is unsafe)\b/i); assert.ok(p.limits.some((x) => /Turbulence/.test(x))); });
test('profile withholds sections with too little data instead of showing zeros', () => { const p = A.profile(Array.from({ length: 5 }, (_, i) => mk(i)), { ceilMode: 'metar' }); assert.equal(p.wind, null); assert.equal(p.vis, null); assert.equal(p.temp, null); assert.equal(p.airportGrade, 'E'); });
test('evidence export keeps precedence floors and omits bulky event lists', () => {
  const R = Array.from({ length: 300 }, (_, i) => mk(i, i < 3 ? { raw: 'HUEN 09025KT 8000 TSRA', ws: 25 } : {})), res = run(R), j = JSON.parse(A.exportEvidence(res, { airport: 'HUEN', period: '2020', source: 'x', ceilMode: 'metar' })), c = j.advisories.find((x) => x.id === 'compound_ts_wind');
  assert.equal(c.floor.to, 'RED'); assert.equal(c.events.all, undefined); });

test('reciprocal heading check accepts true reciprocals (any pair) and rejects others', () => {
  const ok = (a, b) => A.runwayReasons({ hdgA: a, hdgB: b, trueConfirmed: true }).length === 0;
  assert.ok(ok(170, 350)); assert.ok(ok(350, 170)); assert.ok(ok(360, 180)); assert.ok(ok(90, 270)); assert.ok(ok(10, 190)); assert.ok(ok(170, 351.5)); assert.ok(!ok(170, 340)); assert.ok(!ok(170, 170)); assert.ok(!ok(0, 90)); assert.ok(!ok(170, 353)); });

test('limit comparisons are stable at the boundary (20 kt at 30 degrees off the runway is a 10 kt crosswind, not 9.999999)', () => {
  const R = Array.from({ length: 40 }, (_, i) => mk(i, { wd: 200, ws: 20 })), r = run(R, { th: { xw: 10, tail: 17.5 }, runway: { hdg: 170, hdgA: 170, hdgB: 350, trueConfirmed: true } });
  assert.equal(card(r, 'xwind').k, 40); assert.equal(card(r, 'tailwind').k, 0); });

test('Wind tab components: a pure crosswind is neither head- nor tailwind, and boundary comparisons are stable', () => {
  const R = Array.from({ length: 10 }, () => ({ ws: 12, wd: 260 })), k = C.components(R, 170, { tail: 5, xw: 12 }); assert.equal(k.head, 0); assert.equal(k.tail, 0); assert.equal(k.xwX, 10);
  const q = C.components(Array.from({ length: 4 }, () => ({ ws: 20, wd: 200 })), 170, { tail: 5, xw: 10 }); assert.equal(q.xwX, 4); });
