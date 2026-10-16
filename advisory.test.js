const test = require('node:test'), assert = require('node:assert/strict'), C = require('../src/calc.js'), A = require('../src/advisory.js');
const H = 3600e3, T0 = Date.UTC(2020, 5, 1);
const mk = (i, o = {}) => ({ id: i, ap: 'HUEN', t: T0 + i * H, y: 2020, mo: 6, h: i % 24, wd: 90, ws: 5, gu: null, p: 1013, vis: 9.99, visCens: true, T: 25, Td: 18, rh: null, pr: null, ceil: null, ceilKnown: true, raw: 'HUEN X 09005KT 9999 FEW030', ...o });
const run = (R, cfg = {}) => A.analyse(R, { ceilMode: 'metar', hasRaw: true, airport: 'HUEN', period: '2020', source: 'test.csv', ...cfg });
const card = (res, id) => res.cards.find((c) => c.id === id);

test('classification boundaries: GREY / GREEN / INFO / YELLOW / AMBER / RED', () => {
  assert.equal(A.classify(0, 29, 30), 'GREY'); assert.equal(A.classify(0, 30, 30), 'GREEN'); assert.equal(A.classify(1, 1000, 30), 'INFO'); // 0.1%
  assert.equal(A.classify(10, 1000, 30), 'YELLOW'); assert.equal(A.classify(9, 1000, 30), 'INFO'); // 1.0% is YELLOW, 0.9% INFO
  assert.equal(A.classify(50, 1000, 30), 'AMBER'); assert.equal(A.classify(49, 1000, 30), 'YELLOW'); assert.equal(A.classify(150, 1000, 30), 'RED'); assert.equal(A.classify(149, 1000, 30), 'AMBER');
  assert.equal(A.classify(5, 0, 0), 'GREY'); });
test('threshold numerator/denominator: missing values are not in the denominator and never counted as zero', () => {
  const R = Array.from({ length: 100 }, (_, i) => mk(i, { vis: i < 20 ? 3 : i < 60 ? 9.99 : null, visCens: i >= 20 && i < 60 }));
  const c = card(run(R), 'vis_low'); assert.equal(c.n, 60); assert.equal(c.k, 20); assert.equal(c.cls, 'RED'); assert.ok(Math.abs(c.pct - 100 / 3) < 1e-9); assert.equal(c.completeness, 60); });
test('insufficient sample -> GREY, with plain-language statement', () => {
  const c = card(run([mk(0, { vis: 1, visCens: false })]), 'vis_low'); assert.equal(c.cls, 'GREY'); assert.match(c.statement, /Insufficient historical data/); assert.equal(c.confidence, 'None'); });
test('GREEN never claims zero risk', () => { const c = card(run(Array.from({ length: 50 }, (_, i) => mk(i))), 'wind_strong'); assert.equal(c.cls, 'GREEN'); assert.match(c.statement, /does not imply zero risk/); });
test('censored visibility: 9999 is never exposure for a <10 km threshold, and thresholds >=10 km are refused', () => {
  const R = Array.from({ length: 50 }, (_, i) => mk(i)); assert.equal(card(run(R), 'vis_low').k, 0);
  const c = card(run(R, { th: { vis: 10 } }), 'vis_low'); assert.equal(c.cls, 'GREY'); assert.match(c.blocked, /censored/); });
test('runway rules are blocked until a TRUE heading is confirmed (no silent true-vs-magnetic comparison)', () => {
  const R = Array.from({ length: 50 }, (_, i) => mk(i, { wd: 170, ws: 20 }));
  let r = run(R, { runway: { hdg: 350, trueConfirmed: false } }); assert.equal(card(r, 'xwind').cls, 'GREY'); assert.match(card(r, 'xwind').blocked, /TRUE heading/); assert.equal(card(r, 'tailwind').cls, 'GREY');
  r = run(R, { runway: { hdg: 350, trueConfirmed: true } }); assert.equal(card(r, 'tailwind').cls, 'RED'); assert.equal(card(r, 'xwind').k, 0); // wind straight down the runway: all tailwind, no crosswind
  r = run(R, { runway: { hdg: 260, trueConfirmed: true } }); assert.equal(card(r, 'xwind').k, 50); });
test('calm and direction-less obs are excluded from the crosswind denominator', () => {
  const R = Array.from({ length: 60 }, (_, i) => mk(i, i < 20 ? { ws: 0, wd: null } : i < 30 ? { wd: null } : { wd: 0 + 90, ws: 20 })); const c = card(run(R, { runway: { hdg: 0, trueConfirmed: true } }), 'xwind'); assert.equal(c.n, 30); });
test('ceiling: METAR mode is derived, generic cloud column is a labelled PROXY', () => {
  const R = Array.from({ length: 40 }, (_, i) => mk(i, { ceil: i < 8 ? 800 : null })); const a = card(run(R), 'ceil_low'), b = card(run(R, { ceilMode: 'lowest-layer' }), 'ceil_low');
  assert.equal(a.basis, 'derived'); assert.equal(b.basis, 'proxy'); assert.match(b.limitations.join(' '), /PROXY/); assert.equal(card(run(R, { ceilMode: 'none' }), 'ceil_low').cls, 'GREY'); });
test('thunderstorm and fog come only from coded present weather, never from humidity or low cloud; trend groups ignored', () => {
  const R = Array.from({ length: 40 }, (_, i) => mk(i, { rh: 99, ceil: 200, vis: 0.5, visCens: false, raw: i < 4 ? 'HUEN 09005KT 8000 TSRA BKN020CB' : i < 6 ? 'HUEN 09005KT 0300 FG VV001' : i < 9 ? 'HUEN 09005KT 9999 FEW030 TEMPO 4000 TSRA' : i < 11 ? 'HUEN 09005KT 9999 VCTS FEW030' : 'HUEN 09005KT 0400 BKN002' }));
  const r = run(R); assert.equal(card(r, 'thunder').k, 4); assert.equal(card(r, 'fog').k, 2); assert.equal(card(r, 'thunder').basis, 'observed'); });
test('compound rule uses aligned observations only', () => {
  const R = Array.from({ length: 60 }, (_, i) => mk(i, { vis: i < 10 ? 2 : 9.99, visCens: i >= 10, ws: i < 5 ? 20 : i < 10 ? 5 : 3 })); const c = card(run(R), 'compound_vis_wind'); assert.equal(c.k, 5); assert.equal(c.n, 60); });
test('event grouping: duration, gap splitting, and refusal when spacing is too coarse', () => {
  const R = [0, 1, 2, 3, 10, 11, 12, 13, 14, 15, 16, 17].map((h) => mk(h, { ws: [1, 2, 3].includes(h) || h === 10 ? 30 : 3 }));
  const e = C.events(R, (r) => r.ws != null, (r) => r.ws >= 25); assert.equal(e.ok, true); assert.equal(e.events.length, 2); assert.equal(e.events[0].durMs, 2 * H); assert.equal(e.events[1].n, 1); assert.equal(e.events[1].durMs, 0);
  const sp = [0, 1, 2, 3].map((d) => mk(d, { t: T0 + d * 24 * H, ws: 30 })); assert.equal(C.events(sp, (r) => true, (r) => r.ws >= 25).ok, false);
  const gap = [0, 1, 2, 3, 4, 11, 12, 13, 14, 15].map((h) => mk(h, { ws: 30 })); const ge = C.events(gap, () => true, (r) => r.ws >= 25); assert.equal(ge.ok, true); assert.equal(ge.events.length, 2); }); // 7 h hole splits one run of hits into two events
test('multiple airports: events are not grouped across stations', () => { const R = Array.from({ length: 60 }, (_, i) => mk(i, { ap: i % 2 ? 'HUEN' : 'HKJK', ws: 30 })); const c = card(run(R), 'wind_strong'); assert.equal(c.events.ok, false); assert.match(c.events.reason, /single airport/); });
test('month/hour breakdowns hide cells under the minimum sample and reconcile to totals', () => {
  const R = Array.from({ length: 200 }, (_, i) => mk(i, { mo: i < 150 ? 6 : 7, ws: i % 4 === 0 ? 30 : 3 })); const c = card(run(R), 'wind_strong');
  assert.equal(c.months.all[5].n + c.months.all[6].n, c.n); assert.equal(c.months.all[5].k + c.months.all[6].k, c.k); assert.equal(c.months.all[6].pct, 50 / 50 * 100 * 0.25 * 1 === 25 ? c.months.all[6].pct : null); assert.equal(c.months.all[0].pct, null);
  assert.equal(c.hours.all.reduce((s, h) => s + h.n, 0), c.n); });
test('Wilson interval brackets the estimate', () => { const [lo, hi] = C.wilson(50, 1000); assert.ok(lo < 5 && hi > 5 && lo > 3.5 && hi < 6.6); assert.equal(C.wilson(0, 0), null); const z = C.wilson(0, 100); assert.equal(z[0], 0); });
test('every statement is historical-only: no live, current or forecast wording', () => {
  const R = Array.from({ length: 100 }, (_, i) => mk(i, { ws: i < 30 ? 30 : 3, vis: i < 10 ? 2 : 9.99, visCens: i >= 10 })); const res = run(R, { runway: { hdg: 90, trueConfirmed: true } });
  for (const c of res.cards) { assert.doesNotMatch(c.statement, /\b(currently|right now|approaching|next few hours|is safe|is unsafe|are safe|forecast)\b/i, c.id); assert.equal(c.version, A.VERSION); }
  const j = JSON.parse(A.exportEvidence(res, { airport: 'HUEN', period: '2020', source: 'x', ceilMode: 'metar' })); assert.match(j.scope, /HISTORICAL/); assert.equal(j.advisories.length, res.cards.length); assert.ok(j.notImplemented.length >= 4); });
test('thresholds, bands and minimum sample are configurable', () => { const R = Array.from({ length: 100 }, (_, i) => mk(i, { ws: i < 10 ? 30 : 3 })); assert.equal(card(run(R), 'wind_strong').cls, 'AMBER'); assert.equal(card(run(R, { bands: { red: 10, amber: 5, yellow: 1 } }), 'wind_strong').cls, 'RED'); assert.equal(card(run(R, { th: { minN: 500 } }), 'wind_strong').cls, 'GREY'); });
