/* Historical advisory engine. Pure functions, no DOM. Every card is traceable to variables, formula, thresholds and denominators.
   Classes are application-level analytical labels over HISTORICAL data. They are not regulatory minima, forecasts or clearances. */
const Advisory = ((Calc) => {
  const VERSION = 'FWI-ADV 1.0.0';
  const CLASSES = {
    RED: { label: 'Historical high concern', rank: 5, glyph: '▲' }, AMBER: { label: 'Historical caution', rank: 4, glyph: '◆' },
    YELLOW: { label: 'Historical watch', rank: 3, glyph: '●' }, INFO: { label: 'Historical pattern', rank: 2, glyph: 'i' },
    GREEN: { label: 'No significant exposure identified under the configured analysis', rank: 1, glyph: '✓' }, GREY: { label: 'Insufficient data', rank: 0, glyph: '?' } };
  const DEFAULTS = { bands: { red: 15, amber: 5, yellow: 1 }, th: { vis: 5, ceil: 1500, wind: 25, gust: 30, xw: 15, tail: 5, tHigh: 35, windCompound: 15, minN: 30 },
    floors: { compound_ts_wind: 'RED', compound_ts_vis: 'RED', compound_vis_ceil: 'AMBER', compound_rain_vis: 'AMBER' },
    provenance: 'Illustrative analysis setting chosen as an application default. Not a regulatory minimum, operator limit or aircraft limit; edit under Configurable thresholds.' };
  const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // Class from exposure share. k = qualifying obs, n = valid obs. GREEN only when n is adequate AND k = 0.
  const classify = (k, n, minN, bands = DEFAULTS.bands) => {
    if (!(n >= minN) || n === 0) return 'GREY'; if (k === 0) return 'GREEN';
    const p = 100 * k / n; return p >= bands.red ? 'RED' : p >= bands.amber ? 'AMBER' : p >= bands.yellow ? 'YELLOW' : 'INFO'; };
  // Combination precedence: a compound rule can carry a minimum class, applied only when the sample is adequate and at least one aligned report qualifies.
  const applyFloor = (cls, k, n, minN, floor) => (floor && k > 0 && n >= minN && CLASSES[floor] && CLASSES[floor].rank > CLASSES[cls].rank ? { cls: floor, from: cls } : { cls, from: null });
  const confidence = (n, total, minN) => { if (!(n >= minN)) return 'None'; const comp = total ? n / total : 0; return n >= 1000 && comp >= 0.8 ? 'High' : n >= minN * 10 && comp >= 0.5 ? 'Moderate' : 'Low'; };

  const hasTok = (r, rx, skipVC) => Calc.wxTokens(r.raw).some((t) => rx.test(t) && !(skipVC && t.startsWith('VC')));
  const RWY_BLOCK = 'Runway heading is not confirmed as a TRUE heading. Reported wind direction is relative to true north while runway numbers are magnetic, so runway-relative exposure is not calculated. Enter true headings and confirm on the Wind & Runway tab.';
  const rwyBlocked = (c) => (c.runway && c.runway.trueConfirmed && Number.isFinite(c.runway.hdg) ? null : RWY_BLOCK);
  const rnd6 = (x) => Math.round(x * 1e6) / 1e6; // removes floating-point noise (cos 90° is not 0) so limit comparisons are stable
  const comp = (r, hdg) => { const a = (r.wd - hdg) * Math.PI / 180; return { hw: rnd6(r.ws * Math.cos(a)), xw: rnd6(Math.abs(r.ws * Math.sin(a))) }; };
  const nonCalm = (r) => r.ws != null && r.wd != null && r.ws > 0;

  const RULES = [
    { id: 'vis_low', family: 'Reduced visibility', basis: 'observed', vars: ['vis'], title: (c) => `Visibility below ${c.th.vis} km`, formula: (c) => `vis_km < ${c.th.vis}`,
      blocked: (c) => (c.th.vis > 9.99 ? 'Thresholds of 10 km or more cannot be tested: coded maximum visibility (METAR 9999) is censored at "10 km or more".' : null),
      valid: (r) => r.vis != null, test: (r, c) => r.vis < c.th.vis, peak: { fn: (r) => r.vis, mode: 'min', label: 'Lowest visibility', unit: 'km' },
      lim: () => ['Visibility of 10 km or more (METAR 9999) is censored: treated only as "at least 10 km", never as an exact value.', 'Prevailing visibility only; no RVR or runway-specific visibility.'] },
    { id: 'ceil_low', family: 'Low ceiling', title: (c) => `Ceiling below ${c.th.ceil} ft`, formula: (c) => `lowest BKN/OVC/VV layer < ${c.th.ceil} ft AGL`, vars: ['ceiling'],
      basis: (c) => (c.ceilMode === 'metar' ? 'derived' : 'proxy'), blocked: (c) => (c.ceilMode === 'none' ? 'No METAR text or cloud-height column was mapped.' : null),
      valid: (r) => r.ceilKnown, test: (r, c) => r.ceil != null && r.ceil < c.th.ceil, peak: { fn: (r) => r.ceil, mode: 'min', label: 'Lowest ceiling', unit: 'ft' },
      lim: (c) => (c.ceilMode === 'metar' ? ['Ceiling is derived from METAR text: lowest BKN, OVC or VV layer. FEW/SCT are not ceilings. Original text is kept for audit.', 'Observations with no BKN/OVC/VV layer count as "no ceiling" in the denominator.']
        : ['PROXY: the mapped cloud-height column is the lowest layer of ANY cover (may include FEW/SCT), so it is not a verified ceiling and over-states low-ceiling exposure.']) },
    { id: 'fog', family: 'Reduced visibility', basis: 'observed', vars: ['METAR present weather'], title: () => 'Fog reported at the station (FG)', formula: () => 'present-weather group contains FG (VCFG excluded)',
      valid: (r) => !!r.raw, test: (r) => hasTok(r, /FG/, true), blocked: (c) => (c.hasRaw ? null : 'Needs raw METAR text; no such column is mapped.'),
      lim: () => ['Based on METAR present-weather codes only. Low visibility or a low cloud base alone is NOT treated as fog.', 'Trend groups (TEMPO/BECMG) are forecasts and are ignored.'] },
    { id: 'thunder', family: 'Thunderstorms', basis: 'observed', vars: ['METAR present weather'], title: () => 'Thunderstorm reported at the station (TS)', formula: () => 'present-weather group contains TS (VCTS excluded)',
      valid: (r) => !!r.raw, test: (r) => hasTok(r, /TS/, true), blocked: (c) => (c.hasRaw ? null : 'Needs raw METAR text; no such column is mapped.'),
      lim: () => ['Counts only explicitly coded TS. High humidity or low cloud never creates a thunderstorm record.', 'Thunderstorms in the vicinity (VCTS) are not counted. No lightning-strike or hail evidence.'] },
    { id: 'wind_strong', family: 'Strong surface winds', basis: 'observed', vars: ['wind speed'], title: (c) => `Mean wind of ${c.th.wind} kt or more`, formula: (c) => `wind_kt >= ${c.th.wind}`,
      valid: (r) => r.ws != null, test: (r, c) => r.ws >= c.th.wind, peak: { fn: (r) => r.ws, mode: 'max', label: 'Peak mean wind', unit: 'kt' }, lim: () => ['Calm (0 kt) observations are included in the denominator.', 'Surface wind alone does not establish turbulence or wind shear.'] },
    { id: 'gust_strong', family: 'Strong surface winds', basis: 'observed', vars: ['wind speed', 'gust'], title: (c) => `Gusts of ${c.th.gust} kt or more`, formula: (c) => `gust_kt >= ${c.th.gust}`,
      valid: (r) => r.ws != null, test: (r, c) => r.gu != null && r.gu >= c.th.gust, peak: { fn: (r) => r.gu, mode: 'max', label: 'Peak gust', unit: 'kt' },
      lim: () => ['Gusts are normally reported only when gusting, so a blank gust is counted as "no gust reported"; this may also include missing data.'] },
    { id: 'xwind', family: 'Crosswind exposure', basis: 'derived', vars: ['wind direction', 'wind speed', 'runway true heading'], title: (c) => `Crosswind component of ${c.th.xw} kt or more`, formula: (c) => `|speed * sin(wind_dir - runway_true_heading)| >= ${c.th.xw}`,
      blocked: rwyBlocked, valid: nonCalm, test: (r, c) => comp(r, c.runway.hdg).xw >= c.th.xw,
      lim: () => ['Calm observations and observations without direction are excluded from the denominator.', 'Uses the runway heading you entered, assumed TRUE; magnetic variation is not applied.', 'Surface wind only; gust-based crosswind is not evaluated.'] },
    { id: 'tailwind', family: 'Crosswind exposure', basis: 'derived', vars: ['wind direction', 'wind speed', 'runway true heading'], title: (c) => `Tailwind component of ${c.th.tail} kt or more`, formula: (c) => `-speed * cos(wind_dir - runway_true_heading) >= ${c.th.tail}`,
      blocked: rwyBlocked, valid: nonCalm, test: (r, c) => -comp(r, c.runway.hdg).hw >= c.th.tail,
      lim: () => ['Evaluated for ONE runway end only (the one selected); the opposite end has the reciprocal exposure.', 'Calm observations and observations without direction are excluded.'] },
    { id: 'temp_high', family: 'Temperature extremes', basis: 'observed', vars: ['temperature'], title: (c) => `Temperature of ${c.th.tHigh} °C or more`, formula: (c) => `temp_c >= ${c.th.tHigh}`,
      valid: (r) => r.T != null, test: (r, c) => r.T >= c.th.tHigh, peak: { fn: (r) => r.T, mode: 'max', label: 'Peak temperature', unit: '°C' }, lim: () => ['Air temperature as reported; no density-altitude or aircraft-performance inference.'] },
    { id: 'compound_vis_wind', family: 'Compound conditions', basis: 'observed', vars: ['vis', 'wind speed'], title: (c) => `Visibility below ${c.th.vis} km with wind of ${c.th.windCompound} kt or more`,
      formula: (c) => `vis_km < ${c.th.vis} AND wind_kt >= ${c.th.windCompound} (same observation)`, blocked: (c) => (c.th.vis > 9.99 ? 'Visibility threshold of 10 km or more cannot be tested (censored).' : null),
      valid: (r) => r.vis != null && r.ws != null, test: (r, c) => r.vis < c.th.vis && r.ws >= c.th.windCompound,
      lim: () => ['Only observations with BOTH variables present are counted, so the denominator is smaller than for either single rule.', 'Co-occurrence in one report does not establish a physical link.'] },
    { id: 'compound_vis_ceil', family: 'Compound conditions', basis: 'derived', vars: ['vis', 'ceiling'], title: (c) => `Visibility below ${c.th.vis} km with ceiling below ${c.th.ceil} ft`, formula: (c) => `vis_km < ${c.th.vis} AND ceiling_ft < ${c.th.ceil} (same report)`,
      blocked: (c) => (c.th.vis > 9.99 ? 'Visibility threshold of 10 km or more cannot be tested (censored).' : c.ceilMode === 'none' ? 'No METAR text or cloud-height column was mapped.' : null),
      valid: (r) => r.vis != null && r.ceilKnown, test: (r, c) => r.vis < c.th.vis && r.ceil != null && r.ceil < c.th.ceil,
      lim: (c) => ['Both variables must be present in the same report.', c.ceilMode === 'metar' ? 'Ceiling derived from METAR text (lowest BKN/OVC/VV).' : 'PROXY: ceiling is the generic lowest-layer cloud height, not a verified ceiling.'] },
    { id: 'compound_ts_wind', family: 'Compound conditions', basis: 'observed', vars: ['METAR present weather', 'wind speed', 'gust'], title: (c) => `Thunderstorm reported with wind of ${c.th.windCompound} kt or more, or gust of ${c.th.gust} kt or more`, formula: (c) => `TS coded AND (wind_kt >= ${c.th.windCompound} OR gust_kt >= ${c.th.gust}) (same report)`,
      blocked: (c) => (c.hasRaw ? null : 'Needs archived METAR/SPECI text; no such column is mapped.'), valid: (r) => !!r.raw && r.ws != null, test: (r, c) => hasTok(r, /TS/, true) && (r.ws >= c.th.windCompound || (r.gu != null && r.gu >= c.th.gust)),
      lim: () => ['Counts a coded thunderstorm together with the wind in the same report; not lightning distance, hail or storm structure.'] },
    { id: 'compound_ts_vis', family: 'Compound conditions', basis: 'observed', vars: ['METAR present weather', 'vis'], title: (c) => `Thunderstorm reported with visibility below ${c.th.vis} km`, formula: (c) => `TS coded AND vis_km < ${c.th.vis} (same report)`,
      blocked: (c) => (!c.hasRaw ? 'Needs archived METAR/SPECI text; no such column is mapped.' : c.th.vis > 9.99 ? 'Visibility threshold of 10 km or more cannot be tested (censored).' : null), valid: (r) => !!r.raw && r.vis != null, test: (r, c) => hasTok(r, /TS/, true) && r.vis < c.th.vis,
      lim: () => ['Both variables must be present in the same report.'] },
    { id: 'compound_rain_vis', family: 'Compound conditions', basis: 'observed', vars: ['METAR present weather', 'vis'], title: (c) => `Rain or drizzle reported with visibility below ${c.th.vis} km`, formula: (c) => `RA/DZ coded AND vis_km < ${c.th.vis} (same report)`,
      blocked: (c) => (!c.hasRaw ? 'Needs archived METAR/SPECI text; no such column is mapped.' : c.th.vis > 9.99 ? 'Visibility threshold of 10 km or more cannot be tested (censored).' : null), valid: (r) => !!r.raw && r.vis != null, test: (r, c) => hasTok(r, /RA|DZ/, true) && r.vis < c.th.vis,
      lim: () => ['Precipitation type from coded present weather only; rain amount and rate are not used.'] },
  ];
  const SHORT = { vis_low: (c) => `Visibility < ${c.th.vis} km`, ceil_low: (c) => `Ceiling < ${c.th.ceil} ft`, fog: () => 'Fog (FG)', thunder: () => 'Thunderstorm (TS)', wind_strong: (c) => `Wind ≥ ${c.th.wind} kt`, gust_strong: (c) => `Gust ≥ ${c.th.gust} kt`, xwind: (c) => `Crosswind ≥ ${c.th.xw} kt`, tailwind: (c) => `Tailwind ≥ ${c.th.tail} kt`, temp_high: (c) => `Temp ≥ ${c.th.tHigh} °C`,
    compound_vis_wind: () => 'Low vis + wind', compound_vis_ceil: () => 'Low vis + low ceiling', compound_ts_wind: () => 'TS + strong wind/gust', compound_ts_vis: () => 'TS + low vis', compound_rain_vis: () => 'Rain + low vis' };
  const NOT_IMPLEMENTED = ['Turbulence and wind shear (no direct evidence in surface observations)', 'Icing-conducive conditions (no direct evidence; no defensible proxy configured)', 'Density altitude (needs validated airport elevation, temperature and QNH)', 'Precipitation amount or rate (column semantics are not confirmed)', 'Wind shifts and pressure change (sequential analysis not built)', 'Lightning distance, hail (no direct evidence)', 'RVR (no RVR field)'];

  const strip = (rows, key, n, minN) => rows.map((v, i) => ({ label: key(i), k: v.k, n: v.n, pct: v.n >= minN ? 100 * v.k / v.n : null }));
  const groupBy = (valid, hits, f, size) => { const a = Array.from({ length: size }, () => ({ k: 0, n: 0 })); const hs = new Set(hits); for (const r of valid) { const g = a[f(r)]; g.n++; if (hs.has(r)) g.k++; } return a; };

  const statement = (cd, ctx) => {
    const where = `${ctx.airport || 'the selected airports'}, ${ctx.period || 'the selected period'}`;
    if (cd.cls === 'GREY') return cd.blocked ? `Not assessed: ${cd.blocked}` : `Insufficient historical data to establish a reliable pattern for "${cd.title}" (${cd.n.toLocaleString()} valid observations; minimum ${ctx.minN}).`;
    if (cd.cls === 'GREEN') return `No instance of "${cd.title}" was identified in ${cd.n.toLocaleString()} valid observations for ${where} under the configured analysis. This does not imply zero risk.`;
    const pk = cd.months.peak.length ? ` Most frequent in ${cd.months.peak.map((m) => m.label).join(', ')}.` : '';
    return `Historical records show "${cd.title}" in ${cd.pct.toFixed(cd.pct < 10 ? 2 : 1)}% of valid observations (${cd.k.toLocaleString()} of ${cd.n.toLocaleString()}) for ${where}.${pk}`; };

  const makeCtx = (R, cfg) => { const th = { ...DEFAULTS.th, ...(cfg.th || {}) }; return { ...cfg, th, bands: { ...DEFAULTS.bands, ...(cfg.bands || {}) }, floors: { ...DEFAULTS.floors, ...(cfg.floors || {}) }, runway: cfg.runway || null, ceilMode: cfg.ceilMode || 'none', hasRaw: cfg.hasRaw ?? R.some((r) => r.raw) }; };
  // R = filtered records (analysed as a set; airports are not mixed for events). cfg: {th,bands,floors,runway,ceilMode,hasRaw,airport,period,source}
  const analyse = (R, cfg = {}, rules = RULES) => {
    const c = makeCtx(R, cfg), th = c.th, bands = c.bands, single = new Set(R.map((r) => r.ap)).size <= 1, total = R.length, minN = th.minN;
    const cards = rules.map((rule) => {
      const title = rule.title(c), blocked = rule.blocked ? rule.blocked(c) : null, basis = typeof rule.basis === 'function' ? rule.basis(c) : rule.basis;
      const valid = blocked ? [] : R.filter(rule.valid), hits = blocked ? [] : valid.filter((r) => rule.test(r, c)), n = valid.length, k = hits.length;
      const base = blocked ? 'GREY' : classify(k, n, minN, bands), fl = blocked ? { cls: 'GREY', from: null } : applyFloor(base, k, n, minN, c.floors[rule.id]), cls = fl.cls, pct = n ? 100 * k / n : null, ok = cls !== 'GREY';
      const mo = strip(groupBy(valid, hits, (r) => r.mo - 1, 12), (i) => MN[i], n, minN), hr = strip(groupBy(valid, hits, (r) => r.h, 24), (i) => String(i).padStart(2, '0') + ':00 UTC', n, minN);
      const peak = mo.filter((m) => m.pct != null && m.k > 0).sort((a, b) => b.pct - a.pct).slice(0, 3);
      let ev = { ok: false, reason: 'Not assessed.' };
      if (ok && k > 0) { if (!single) ev = { ok: false, reason: 'Select a single airport to group observations into events.' };
        else { const e = Calc.events(R, rule.valid, (r) => rule.test(r, c), rule.peak ? { peak: rule.peak } : {}); ev = e.ok ? { ok: true, ap: R[0] && R[0].ap, count: e.events.length, stepMin: e.step / 6e4, medianDurH: Calc.pctile(e.events.map((x) => x.durMs / 36e5), 50), maxDurH: Math.max(...e.events.map((x) => x.durMs / 36e5)), peak: rule.peak ? { label: rule.peak.label, unit: rule.peak.unit, mode: rule.peak.mode } : null, all: e.events.slice(0, 2000), list: e.events.slice().sort((a, b) => b.durMs - a.durMs || b.n - a.n).slice(0, 10) }
          : { ok: false, reason: e.step == null ? 'Not enough timestamps to assess spacing.' : `Typical spacing between reports is ${(e.step / 6e4).toFixed(0)} min, too coarse to group into events.` }; } }
      const card = { id: rule.id, family: rule.family, title, short: rule.short ? rule.short(c) : SHORT[rule.id] ? SHORT[rule.id](c) : title, cls, clsLabel: CLASSES[cls].label, glyph: CLASSES[cls].glyph, k, n, pct, ci: ok ? Calc.wilson(k, n) : null, total, completeness: total ? 100 * n / total : null,
        confidence: ok ? confidence(n, total, minN) : 'None', basis, vars: rule.vars, formula: rule.formula(c), thresholds: { ...th, bands }, provenance: rule.prov ? rule.prov(c) : DEFAULTS.provenance,
        floor: fl.from ? { from: fl.from, to: cls, rule: 'Combination precedence: ' + (CLASSES[cls].rank >= 5 ? 'a coded thunderstorm combined with wind or reduced visibility is treated as high concern whenever it occurs in an adequate sample' : 'this combination is treated as at least a caution whenever it occurs in an adequate sample') + '. Floors are configurable.' } : null,
        months: { all: mo, peak }, hours: { all: hr, peak: hr.filter((h) => h.pct != null && h.k > 0).sort((a, b) => b.pct - a.pct).slice(0, 3) }, events: ev, blocked,
        limitations: [...(rule.lim ? rule.lim(c) : []), 'Share of REPORTED observations, not of hours: reports are unevenly spaced.', 'The 95% interval treats reports as independent; weather persists, so the true uncertainty is wider.'], version: VERSION, dataset: cfg.source || null };
      card.statement = statement(card, { airport: cfg.airport, period: cfg.period, minN }); return card; });
    cards.sort((a, b) => CLASSES[b.cls].rank - CLASSES[a.cls].rank || (b.pct || 0) - (a.pct || 0));
    return { version: VERSION, cards, notImplemented: NOT_IMPLEMENTED, single, total };
  };
  // Which configured conditions does ONE report meet? (links the replay to the advisory rules)
  const flags = (r, cfg = {}, rules = RULES) => { const c = makeCtx([r], cfg); return rules.filter((x) => !(x.blocked && x.blocked(c)) && x.valid(r) && x.test(r, c)).map((x) => ({ id: x.id, family: x.family, title: x.title(c), basis: typeof x.basis === 'function' ? x.basis(c) : x.basis })); };

  // ---- runway geometry, runway-specific wind climatology and aircraft-specific exposure (needs verified inputs) ----
  const runwayReasons = (rw) => { const out = []; if (!rw || !(rw.trueConfirmed)) out.push(RWY_BLOCK); const a = rw && rw.hdgA, b = rw && rw.hdgB;
    if (![a, b].every((x) => Number.isFinite(x) && x >= 0 && x <= 360)) out.push('Both runway end headings (0 to 360°) are required.');
    else { const d = Math.abs(((a - b + 360) % 360) - 180); if (d > 2) out.push(`Runway end headings ${a}° and ${b}° are not reciprocal (they differ from 180° apart by ${d.toFixed(0)}°). Correct them before runway-relative analysis.`); }
    return out; };
  const runwayBands = (R, rw) => { const why = runwayReasons(rw); if (why.length) return { blocked: why };
    const W = R.filter((r) => r.ws != null && r.wd != null), calm = R.filter((r) => r.ws === 0).length, V = W.filter((r) => r.ws > 0), n = V.length;
    const bands = (f, defs) => defs.map(([lo, hi, label]) => ({ label, k: V.filter((r) => { const v = f(r); return v >= lo && v < hi; }).length }));
    const XW = [[0, 5, '0–5 kt'], [5, 10, '5–10 kt'], [10, 15, '10–15 kt'], [15, 20, '15–20 kt'], [20, Infinity, '20 kt or more']], TW = [[0, 0.5, 'No tailwind component'], [0.5, 5, 'Under 5 kt'], [5, 10, '5–10 kt'], [10, Infinity, '10 kt or more']];
    return { n, calm, withDirection: W.length, hdgA: rw.hdgA, hdgB: rw.hdgB, crosswind: bands((r) => comp(r, rw.hdgA).xw, XW), ends: [['A', rw.hdgA], ['B', rw.hdgB]].map(([e, h]) => ({ end: e, hdg: h, headwind: V.filter((r) => comp(r, h).hw > 0).length, tailwind: bands((r) => Math.max(0, -comp(r, h).hw), TW) })) }; };
  const aircraftReasons = (p, rw) => { const out = runwayReasons(rw), q = p || {};
    for (const [k, l] of [['name', 'aircraft type or variant'], ['source', 'source document (AFM, FCOM or operator manual)'], ['rev', 'document revision'], ['eff', 'effective date']]) if (!String(q[k] ?? '').trim()) out.push(`Aircraft profile is missing the ${l}.`);
    if (!q.verified) out.push('The limits are not marked as verified against the authoritative source. No limit is ever assumed.');
    if (!(q.xw > 0) && !(q.tail > 0)) out.push('Enter at least one limit (crosswind or tailwind, in knots).'); return out; };
  const aircraftRules = (p, rw) => { const src = `User-supplied for ${p.name}: ${p.source}, revision ${p.rev}, effective ${p.eff}. ${p.verified ? 'The user marked these limits as verified.' : ''} FORBSPACE has not independently verified them.`, rules = [], gustSp = (r) => Math.max(r.ws, r.gu || 0);
    const common = ['Compared with the limit you supplied; this is historical exposure, not a statement that any operation was or would be suitable.', 'Calm and direction-less reports are excluded; wind direction is treated as TRUE and runway headings as TRUE.'];
    if (p.xw > 0) { rules.push({ id: 'ac_xw_mean', short: () => `AC crosswind ≥ ${p.xw} kt`, family: 'Aircraft-specific exposure', basis: 'derived', vars: ['wind direction', 'wind speed', 'runway true heading', 'supplied crosswind limit'], title: () => `Crosswind at or above ${p.xw} kt (${p.name}, mean wind)`, formula: () => `|wind_kt * sin(wind_dir - ${rw.hdgA})| >= ${p.xw}`, valid: nonCalm, test: (r) => comp(r, rw.hdgA).xw >= p.xw, prov: () => src, lim: () => [...common, 'Mean wind only.'] });
      rules.push({ id: 'ac_xw_gust', short: () => `AC crosswind+gust ≥ ${p.xw} kt`, family: 'Aircraft-specific exposure', basis: 'derived', vars: ['wind direction', 'wind speed', 'gust', 'runway true heading', 'supplied crosswind limit'], title: () => `Crosswind including gusts at or above ${p.xw} kt (${p.name})`, formula: () => `|max(wind_kt, gust_kt) * sin(wind_dir - ${rw.hdgA})| >= ${p.xw}`, valid: nonCalm, test: (r) => comp({ wd: r.wd, ws: gustSp(r) }, rw.hdgA).xw >= p.xw, prov: () => src, lim: () => [...common, 'Uses the gust where one is reported, otherwise the mean wind.'] }); }
    if (p.tail > 0) for (const [e, h] of [['A', rw.hdgA], ['B', rw.hdgB]]) rules.push({ id: 'ac_tail_' + e, short: () => `AC tailwind ≥ ${p.tail} kt, end ${e}`, family: 'Aircraft-specific exposure', basis: 'derived', vars: ['wind direction', 'wind speed', 'runway true heading', 'supplied tailwind limit'], title: () => `Tailwind at or above ${p.tail} kt, runway end ${e} (${h}°, ${p.name})`, formula: () => `-wind_kt * cos(wind_dir - ${h}) >= ${p.tail}`, valid: nonCalm, test: (r) => -comp(r, h).hw >= p.tail, prov: () => src, lim: () => [...common, `Evaluated for the end with heading ${h}° only.`] });
    return rules; };
  const analyseAircraft = (R, cfg) => { const why = aircraftReasons(cfg.aircraft, cfg.runway); if (why.length) return { blocked: why, cards: [] };
    const res = analyse(R, cfg, aircraftRules(cfg.aircraft, cfg.runway)); return { blocked: [], ...res }; };

  // ---- per-variable quality grades and the airport weather profile (all numbers computed from the filtered records) ----
  const grade = (pct, n, minN) => (!(n >= minN) ? 'E' : pct >= 95 ? 'A' : pct >= 85 ? 'B' : pct >= 70 ? 'C' : pct >= 50 ? 'D' : 'E');
  const SECT = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const profile = (R, cfg = {}, res = null) => { const c = makeCtx(R, cfg), th = c.th, tot = R.length, A = res || analyse(R, cfg);
    const vars = [['ws', 'Wind speed'], ['wd', 'Wind direction'], ['vis', 'Visibility'], ['p', 'Pressure'], ['T', 'Temperature'], ['Td', 'Dew point'], ['ceilKnown', 'Cloud / ceiling'], ['raw', 'Archived METAR/SPECI text']];
    const grades = vars.map(([k, l]) => { const n = R.filter((r) => (k === 'ceilKnown' ? r.ceilKnown : k === 'raw' ? !!r.raw : r[k] != null)).length, pct = tot ? 100 * n / tot : 0; return { key: k, label: l, n, pct, grade: grade(pct, n, th.minN) }; });
    const core = grades.filter((g) => ['ws', 'vis', 'p', 'T'].includes(g.key)), worst = core.map((g) => g.grade).sort().at(-1) || 'E', cov = Calc.coverage(R), ro = Calc.rose(R), ws = R.filter((r) => r.ws != null), wsv = ws.map((r) => r.ws), vv = R.filter((r) => r.vis != null);
    const tot16 = ro.counts.map((row) => row.reduce((a, b) => a + b, 0)), mi = tot16.indexOf(Math.max(...tot16)), gustRep = ws.filter((r) => r.gu != null), tv = R.filter((r) => r.T != null).map((r) => r.T), cl = R.filter((r) => r.ceilKnown);
    const out = { n: tot, coverage: cov, grades, airportGrade: worst, airportGradeRule: 'Worst grade among wind speed, visibility, pressure and temperature. Grades reflect availability within the reports received, not coverage against an expected schedule.',
      wind: ws.length >= th.minN ? { n: ws.length, calmPct: 100 * ro.calm / ro.n, prevailing: ro.nd >= th.minN ? { dir: SECT[mi], deg: mi * 22.5, pct: 100 * tot16[mi] / ro.nd, n: ro.nd } : null, p50: Calc.pctile(wsv, 50), p90: Calc.pctile(wsv, 90), p99: Calc.pctile(wsv, 99), gustAllPct: 100 * gustRep.length / ws.length, gustReports: gustRep.length, gustHighPct: gustRep.length ? 100 * gustRep.filter((r) => r.gu >= th.gust).length / gustRep.length : null } : null,
      vis: vv.length >= th.minN ? { n: vv.length, belowPct: 100 * vv.filter((r) => r.vis < th.vis).length / vv.length, censPct: 100 * vv.filter((r) => r.visCens).length / vv.length } : null,
      ceiling: cl.length >= th.minN && c.ceilMode !== 'none' ? { n: cl.length, mode: c.ceilMode, layerPct: 100 * cl.filter((r) => r.ceil != null).length / cl.length, belowPct: 100 * cl.filter((r) => r.ceil != null && r.ceil < th.ceil).length / cl.length } : null,
      temp: tv.length >= th.minN ? { n: tv.length, p5: Calc.pctile(tv, 5), p50: Calc.pctile(tv, 50), p95: Calc.pctile(tv, 95) } : null,
      hazards: A.cards.filter((x) => ['RED', 'AMBER', 'YELLOW', 'INFO'].includes(x.cls)).slice(0, 4).map((x) => ({ id: x.id, cls: x.cls, title: x.title, statement: x.statement })),
      limits: [...A.cards.filter((x) => x.cls === 'GREY').map((x) => `${x.title}: ${x.blocked || 'insufficient sample'}`), ...A.notImplemented] };
    return out; };

  const exportEvidence = (res, cfg) => JSON.stringify({ analysisVersion: res.version, scope: 'HISTORICAL observations only; not current weather, not a forecast, not an operational clearance', airport: cfg.airport, period: cfg.period, source: cfg.source, thresholds: { ...DEFAULTS.th, ...(cfg.th || {}) }, bands: { ...DEFAULTS.bands, ...(cfg.bands || {}) }, runway: cfg.runway || null, ceilingMode: cfg.ceilMode, advisories: res.cards.map(({ months, hours, ...x }) => ({ ...x, events: x.events && x.events.all ? { ...x.events, all: undefined } : x.events, months: months.all, hours: hours.all })), notImplemented: res.notImplemented }, null, 2);
  const api = { VERSION, CLASSES, DEFAULTS, classify, applyFloor, confidence, analyse, flags, runwayBands, runwayReasons, aircraftReasons, analyseAircraft, grade, profile, exportEvidence, RULES, NOT_IMPLEMENTED };
  return api;
})(typeof Calc !== 'undefined' ? Calc : require('./calc.js'));
if (typeof module !== 'undefined') module.exports = Advisory;
