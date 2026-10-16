const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const template=fs.readFileSync(path.join(root,'src/app.template.html'),'utf8');
const build=fs.readFileSync(path.join(root,'build.js'),'utf8');

test('historical-only source has no live weather integrations',()=>{
  for(const file of ['src/app.template.html','build.js','public/sw.js','README.md']){
    const s=fs.readFileSync(path.join(root,file),'utf8');
    assert.doesNotMatch(s,/aviationweather\.gov\/api|worker-ops|weather-flow-aviation|setInterval\([^\n]*refresh|METAR \/ TAF tab|TAF retrieval/i,`${file} contains a live-weather dependency`);
  }
});

test('live-weather files are removed',()=>{
  for(const file of ['worker-ops-proxy.js','src/ops.js','test/ops.test.js','src/opsui.js','public/weather-flow-aviation.html','dist/weather-flow-aviation.html']){
    assert.equal(fs.existsSync(path.join(root,file)),false,file+' should not exist');
  }
});

test('historical navigation remains',()=>{
  for(const label of ['Import Historical Data','Overview','Wind & Runway','Pressure + Clouds','Temperature & Moisture','Visibility','Historical Advisories','Data & Sources']) assert.match(template,new RegExp(label.replace(/[+]/g,'\\+')));
});

// ---- strict historical-only guard over every shipped source file ----
const fsx = require('fs'), pathx = require('path'), rootx = pathx.resolve(__dirname, '..');
test('no live/current-weather, TAF, SIGMET, polling, URL import or connectivity-status code or UI remains', () => {
  for (const f of ['src/calc.js', 'src/advisory.js', 'src/scene.js', 'src/app.template.html', 'public/sw.js', 'public/manifest.webmanifest']) {
    const s = fsx.readFileSync(pathx.join(rootx, f), 'utf8');
    assert.doesNotMatch(s, /\bTAFs?\b|SIGMET|AIRMET|nowcast|loadUrl|Load URL|navigator\.onLine|addEventListener\('(on|off)line'|setInterval\s*\(|EventSource|WebSocket|XMLHttpRequest|sendBeacon/, f);
    if (f !== 'public/sw.js') assert.doesNotMatch(s, /\bfetch\s*\(/, f);
  }
  const ui = fsx.readFileSync(pathx.join(rootx, 'src/app.template.html'), 'utf8');
  // the words "live" / "current weather" / "forecast" may appear ONLY inside explicit disclaimers
  for (const m of ui.replace(/aria-live/g, 'aria-x').matchAll(/[^.<>`]{0,70}\b(live|real-time|current (weather|conditions)|forecast(s)?)\b[^.<>`]{0,50}/gi)) assert.match(m[0], /\b(not|never|no|nor|without|isn't|past|historical|instead)\b/i, 'unqualified: ' + m[0]);
});
test('METAR is only an archived-text import field, never described as current', () => { const ui = fsx.readFileSync(pathx.join(rootx, 'src/app.template.html'), 'utf8'); assert.match(ui, /Archived METAR\/SPECI text \(historical record\)/); assert.doesNotMatch(ui, /Raw METAR text \(for ceiling\)/); });
