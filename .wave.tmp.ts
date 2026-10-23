import fs from 'node:fs';
const src=fs.readFileSync('src/components/discovery/CenterPulseWave.tsx','utf8');
const m=src.slice(src.indexOf('const X0'),src.indexOf('const IDLE_D'));
const code=m.replace(/: Array<\[[^\]]*\]>/g,'').replace(/\(s: State\)/,'(s)').replace(/type State = [^;]*;/,'').replace(/\(points: Array<\[number, number\]>\)/,'(points)').replace(/const points: Array<\[number, number\]> = \[\];/,'const points = [];').replace(/\(x: number\)/,'(x)').replace(/\(n: number\)/,'(n)');
const fn=new Function(code+';return buildPath;')();
const rows=[{amp:0,parts:[0,0,0,0],heart:1,phase:[0,0,0,0]},{amp:.35,parts:[.6,.4,.3,.2],heart:.4,phase:[0,0,0,0]},{amp:.6,parts:[.8,.5,.3,.2],heart:0,phase:[1,2,3,4]},{amp:.9,parts:[.9,.7,.5,.4],heart:0,phase:[2.5,1,4,2]}];
const svgs=rows.map(r=>`<svg viewBox="0 -10 400 68" width="800" height="136" style="background:#0b1220;display:block;margin:6px"><path d="${fn(r)}" fill="none" stroke="#60a5fa" stroke-width="1.8"/></svg>`).join('');
fs.writeFileSync('/tmp/osk-preview/wave.html',`<html><body style="margin:0;background:#050a14">${svgs}</body></html>`);
