const fs=require('fs');
fs.mkdirSync('dist',{recursive:true});
const strip=f=>fs.readFileSync(f,'utf8').replace(/if \(typeof module[^\n]*\n?/,'');
const template=fs.readFileSync('src/app.template.html','utf8');
const calc=['src/calc.js','src/advisory.js','src/scene.js'].map(strip).join('\n');
fs.writeFileSync('dist/index.html',template.replace('/*CALC*/',()=>calc));
for(const f of ['manifest.webmanifest','sw.js','icon.svg','apple-touch-icon.png','icon-192.png','icon-512.png','icon-maskable-512.png','cloud-far.png','cloud-mid.png','cloud-near.png','cloud-storm.png']) fs.copyFileSync('public/'+f,'dist/'+f);
console.log('built historical-only dist/index.html');
