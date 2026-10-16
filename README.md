# FORBSPACE Historical Weather Intelligence

Historical-only aviation weather analytics application. The application does **not** retrieve, monitor, refresh, or forecast current/future weather.

## Historical-only boundary
- Weather information is sourced from datasets explicitly imported by the user.
- Current METAR/SPECI, TAF, SIGMET/AIRMET, live alerts, live weather maps, polling, and live operational weather advice have been removed.
- Missing historical records are never replaced with current conditions.
- The 3D/atmospheric presentation layer, where used, is illustrative and must not be interpreted as a photographic reconstruction of the historical sky.

## Run
```bash
node build.js
npx serve dist
# or
python3 -m http.server -d dist 3000
```

## Tests
```bash
npm test          # node --test test/*.test.js
```
`calc.test.js` has one integration test that is skipped unless your original `Uganda.txt` is at `/mnt/user-data/uploads/` (or set `DATA=`). It asserts exact row counts; if your file contains exact duplicate rows, the new duplicate handling will exclude them and those counts will need updating.

## Import
Use the **Import Historical Data** tab and load CSV, XLSX, or JSON historical observations. Confirm field mappings and units before analysis.

Recommended historical fields include timestamp, airport/station, wind direction, wind speed, gust, pressure/QNH, visibility, temperature, dew point, relative humidity, cloud height/ceiling semantics, precipitation, and raw historical METAR text where available.

## Analytical boundary
Historical exposure labels are analytical classifications only. They are not regulatory minima, operational clearances, forecasts, or declarations that an airport or flight is safe/unsafe.

## Feature status
| Area | Status |
|---|---|
| Historical-only (no live/forecast code, no network calls in app code) | Done, tested |
| Advisory engine: versioned rules, RED/AMBER/YELLOW/INFO/GREEN/GREY, evidence cards, "Why this advisory?", month and hour breakdown, episode grouping, evidence JSON export | Done, tested |
| Visibility, ceiling (METAR-derived vs proxy), wind, gust, crosswind/tailwind (gated on confirmed TRUE heading), temperature, fog and thunderstorm (METAR codes only), compound visibility+wind | Done, tested |
| Data quality: exact/conflicting duplicates, rejected rows, censored 9999 visibility, pressure type recorded | Done, tested |
| Historical Replay (2D procedural sky driven by recorded reports, real timestamps, gap flags, UTC/local, evidence tags) | Done in the browser; scene logic tested |
| Full-screen interactive **3D** replay with camera control (WebGL/Three.js) | **Not done** |
| AI-generated cloud/sky assets | **Not done** (no image-generation access); dashboard background still uses the supplied cloud PNGs, which are low-detail noise masks |
| Live/current-weather UI (online status chip, URL import box, METAR wording) | Removed; METAR survives only as an *archived text import field* |
| Official FORBSPACE logo | Not supplied; the app's own SVG mark is unchanged |
| Airport weather profile (personality), A–E quality grades per variable, weather risk calendar (month), hourly risk clock (UTC/local) | Done, tested |
| Compound conditions (visibility+wind, visibility+ceiling, thunderstorm+wind, thunderstorm+visibility, rain+visibility) with configurable combination-precedence floors | Done, tested |
| Event Explorer (episodes with duration, peak, source row, and one-tap replay) | Done |
| Runway-specific wind climatology (bands for both ends; gated on TRUE, reciprocal headings) and aircraft-specific exposure (only from limits you supply with source, revision, effective date and your verification) | Done, tested |
| Replay shows which configured conditions each recorded report meets, and opens directly on an episode | Done |
| Historical analogue search, sequence analysis, anomalies vs baseline, wind shifts, pressure change, density altitude, Settings tab | **Not implemented** |
| Turbulence, wind shear, icing, RVR, precipitation amount | Not assessed (shown as such) |

## Known limitations
- Local time and sun position are only available for airports in the app's directory (currently HUEN). Others show UTC and neutral daylight.
- Cloud shapes are procedural and illustrative. Only cloud amount (from METAR text), coded present weather, wind and sun position drive the scene.
- Event durations are first-to-last qualifying report (a lower bound); episodes are not grouped when typical spacing exceeds 3 h.
- Intervals assume independent observations; weather persistence makes true uncertainty wider.
- Thresholds and class bands are illustrative defaults, not regulatory or operator limits.
