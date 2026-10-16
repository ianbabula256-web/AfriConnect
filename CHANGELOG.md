# Changelog

## Phase 1 - trust and correctness
- Removed stale `test/ops.test.js` (tested a deleted live-weather module and failed); `npm test` now runs every test file.
- Fixed build: cloud images were never copied to `dist/`; service worker now precaches them (cache `wx-v6`).
- Removed dead `opsAfter` hook; product title is now FORBSPACE Historical Weather Intelligence.
- Added: exact/conflicting duplicate handling, rejected-row list, censored-visibility flag, pressure-type tracking (QNH / station / sea-level / unstated), METAR present-weather and cloud parsing that ignores TEMPO/BECMG/NOSIG/RMK trend groups.
- Runway-relative analysis now requires the user to confirm headings are TRUE.

## Phase 3 - advisory engine
- New `src/advisory.js` (FWI-ADV 1.0.0) and rewritten Historical Advisories tab.

## Phase 5 (partial) - replay
- New `src/scene.js` and Historical Replay tab (2D canvas, procedural clouds). Removed the hand-drawn cartoon storm/aircraft scene and dead CSS.

## Round 2
- Removed the remaining live-style UI: Online/Offline status chip and its browser connectivity listeners, the dead "Load URL" import box and handler, and the "Raw METAR text" wording (now "Archived METAR/SPECI text (historical record)"). Added a strict regression test over all shipped files for live/TAF/SIGMET/polling/URL-import/connectivity code and unqualified "live/current/forecast" wording.
- Advisory engine: four compound rules, combination-precedence floors, per-episode peaks, `flags()` for a single report, runway bands, aircraft-specific rules with hard gating, A–E variable grades, airport profile generator.
- New tabs: Airport Profile (profile, risk calendar, hourly risk clock), Runway & Aircraft, Event Explorer.
- Fixed: reciprocal-runway check arithmetic (would have rejected every valid runway); floating-point noise that counted a pure crosswind as head/tailwind and made at-the-limit comparisons unstable (also in the Wind tab); calm winds without a direction were not counted as calm in runway bands.
