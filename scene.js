/* Historical replay scene logic. Pure functions, no DOM, no network.
   Decides WHAT the illustrative sky shows from a recorded observation and tags every element with its evidence level.
   Cloud shapes, motion and exact appearance are always illustrative; nothing here is a photograph of the historical sky. */
const Scene = ((Calc) => {
  const TAG = { OBS: 'Observed', DER: 'Derived', INF: 'Inferred', MIS: 'Missing', ILL: 'Illustrative' };
  const rad = (d) => d * Math.PI / 180;
  // Solar elevation (deg) from NOAA-style low-precision formulae. Astronomical calculation, accurate to a fraction of a degree.
  const solarElev = (t, lat, lon) => {
    const d = t / 864e5 + 2440587.5 - 2451545, g = rad(357.529 + 0.98560028 * d), q = 280.459 + 0.98564736 * d, L = rad(q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)), e = rad(23.439 - 0.00000036 * d);
    const dec = Math.asin(Math.sin(e) * Math.sin(L)), ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)), gmst = (((18.697374558 + 24.06570982441908 * d) % 24) + 24) % 24;
    const H = rad(((gmst * 15 + lon) % 360 + 360) % 360) - ra, la = rad(lat);
    return Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(H)) * 180 / Math.PI; };
  const fmt = (v, u) => (v == null ? '—' : `${Math.round(v * 10) / 10} ${u}`);

  // describe(rec, loc) -> scene parameters (all 0..1 unless noted) + provenance rows. loc = {lat,lon} or null.
  const describe = (r, loc) => {
    const rows = [], hasRaw = !!(r.raw && String(r.raw).trim()), wx = hasRaw ? Calc.wxTokens(r.raw) : [], cc = hasRaw ? Calc.cloudCover(r.raw) : null;
    const S = { cover: 0, coverKnown: false, fog: 0, haze: 0, dust: 0, rain: 0, rainKind: null, thunder: false, snow: false, windKt: r.ws, windFrom: r.wd, daylight: 1, elev: null, lightingKnown: false, wx, tags: [] };
    // Time of day / lighting
    if (loc) { S.elev = solarElev(r.t, loc.lat, loc.lon); S.lightingKnown = true; S.daylight = Math.max(0, Math.min(1, (S.elev + 6) / 12));
      rows.push(['Lighting', `Sun ${fmt(S.elev, '° elevation')}`, TAG.DER, 'Astronomical position at the recorded time; not an observation of sky brightness']); }
    else rows.push(['Lighting', 'Neutral daylight', TAG.ILL, 'Airport coordinates are not in this app, so sun position is not calculated']);
    // Cloud
    if (cc) { S.cover = cc.oktas / 8; S.coverKnown = true; rows.push(['Cloud amount', `${cc.oktas === 0 ? 'Clear' : cc.oktas + ' oktas (highest layer)'}`, TAG.DER, `From ${cc.basis} in the recorded METAR text`]); }
    else rows.push(['Cloud amount', 'Not available', TAG.MIS, hasRaw ? 'METAR text has no readable cloud group; no cloud is drawn as a measured value' : 'No METAR text in the dataset; cloud amount cannot be determined']);
    // Present weather: ONLY from coded tokens
    const at = (rx) => wx.filter((t) => rx.test(t) && !t.startsWith('VC'));
    const fg = at(/FG/), br = at(/BR/), hz = at(/HZ/), du = at(/DU|SA|SS|DS|VA|FU/), ts = at(/TS/), ra = at(/RA|DZ|SH/), sn = at(/SN|SG|PL|GS|GR|IC/);
    S.fog = fg.length ? 0.6 : br.length ? 0.3 : 0; S.haze = hz.length ? 0.4 : 0; S.dust = du.length ? 0.45 : 0; S.thunder = ts.length > 0; S.snow = sn.length > 0;
    if (ra.length || ts.some((t) => /RA|DZ/.test(t))) { const t0 = [...ra, ...ts.filter((x) => /RA|DZ/.test(x))][0] || ''; S.rainKind = /DZ/.test(t0) ? 'drizzle' : 'rain'; S.rain = t0.startsWith('+') ? 1 : t0.startsWith('-') ? 0.25 : 0.55; if (S.rainKind === 'drizzle') S.rain = Math.min(S.rain, 0.3); }
    const wxRow = (label, cond, on, off) => rows.push([label, cond ? on : hasRaw ? off : 'Not available', cond ? TAG.OBS : hasRaw ? TAG.OBS : TAG.MIS, cond ? 'Coded in the recorded METAR present-weather group' : hasRaw ? 'No such present-weather code in the METAR text (absence of a code is not proof the phenomenon did not occur)' : 'No METAR text in the dataset']);
    wxRow('Fog / mist', fg.length || br.length, fg.length ? 'Fog (FG)' : 'Mist (BR)', 'None reported');
    wxRow('Precipitation', S.rain > 0 || S.snow, S.snow ? 'Frozen precipitation coded' : `${S.rainKind === 'drizzle' ? 'Drizzle' : 'Rain/showers'} coded (${wx.filter((t) => /RA|DZ|SH/.test(t)).join(' ')})`, 'None reported');
    wxRow('Thunderstorm', S.thunder, `Coded at station (${ts.join(' ')})`, 'None reported');
    if (hz.length || du.length) rows.push(['Haze / dust', [...hz, ...du].join(' '), TAG.OBS, 'Coded present weather']);
    // Measured scalars (shown, never invented)
    rows.push(['Wind', r.ws == null ? 'Not available' : `${r.wd == null ? 'direction missing' : 'from ' + Math.round(r.wd) + '°'} at ${Math.round(r.ws)} kt${r.gu != null ? ' gusting ' + Math.round(r.gu) : ''}`, r.ws == null ? TAG.MIS : TAG.OBS, 'Direction is where the wind blows FROM, relative to true north']);
    rows.push(['Visibility', r.vis == null ? 'Not available' : r.visCens ? '10 km or more (censored)' : fmt(r.vis, 'km'), r.vis == null ? TAG.MIS : TAG.OBS, r.visCens ? 'Coded maximum: not an exact value' : 'Prevailing visibility']);
    rows.push(['Ceiling', !r.ceilKnown ? 'Not available' : r.ceil == null ? 'No BKN/OVC/VV layer' : `${r.ceil} ft AGL`, r.ceilKnown ? TAG.DER : TAG.MIS, 'Lowest BKN/OVC/VV layer; low cloud base is NOT treated as fog']);
    rows.push(['Temperature / dew point', r.T == null ? 'Not available' : `${fmt(r.T, '°C')} / ${fmt(r.Td, '°C')}`, r.T == null ? TAG.MIS : TAG.OBS, 'Humidity is never used to draw rain or storm']);
    rows.push(['Cloud shapes and motion', 'Procedural', TAG.ILL, 'The data cannot determine cloud geometry; drift speed scales with reported wind, direction follows the reported wind-from bearing']);
    rows.push(['Transition between reports', 'Visual blend only', TAG.ILL, 'Scene fades between recorded reports. No values are interpolated or shown between them']);
    S.rows = rows; S.label = hasRaw ? 'Scene driven by recorded METAR text and measurements' : 'Limited scene: no METAR text in this dataset, so only measured wind and lighting are used'; return S; };

  // steps(recsOfOneDayOneAirport, gapMs) -> ordered real observations with the gap since the previous one. No hourly padding is ever added.
  const steps = (R, gapMs = 3 * 3600e3) => { const A = R.slice().sort((a, b) => a.t - b.t || a.id - b.id); return A.map((r, i) => ({ rec: r, gapMs: i ? r.t - A[i - 1].t : null, gap: i ? r.t - A[i - 1].t > gapMs : false })); };
  const dayRange = (day) => { const t0 = Date.parse(day + 'T00:00:00Z'); return Number.isFinite(t0) ? [t0, t0 + 864e5] : null; };
  const dayOf = (R, ap, day) => { const rg = dayRange(day); if (!rg) return []; return R.filter((r) => (!ap || r.ap === ap) && r.t >= rg[0] && r.t < rg[1]); };
  // Time zone display: UTC always available; local only when the offset for the airport is known.
  const clock = (t, mode, tzHours) => { const off = mode === 'local' && tzHours != null ? tzHours : 0, d = new Date(t + off * 36e5), z = (n) => String(n).padStart(2, '0'); return `${d.getUTCFullYear()}-${z(d.getUTCMonth() + 1)}-${z(d.getUTCDate())} ${z(d.getUTCHours())}:${z(d.getUTCMinutes())} ${off ? 'UTC' + (off > 0 ? '+' : '') + off : 'UTC'}`; };
  const api = { TAG, solarElev, describe, steps, dayOf, dayRange, clock };
  return api;
})(typeof Calc !== 'undefined' ? Calc : require('./calc.js'));
if (typeof module !== 'undefined') module.exports = Scene;
