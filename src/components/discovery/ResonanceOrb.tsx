import React, { useEffect, useRef } from 'react';
import { useAudioLevels, type AudioLevels } from '../../audio/audioLevels.js';
import type { Rgb } from '../../utils/releasePalette.js';

/* Резонанс visual: a soft, breathing blob of light. Its three colours come from the setting the
   listener picks (or the playing cover), its edge ripples with the bass, its glow with the treble,
   and it jumps a little on every kick. The idea follows Yandex «Моя волна» (colour from the track,
   speed from its energy, three frequency bands, a still fallback for slow devices); the shader is our own. */

const VERT = `attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}`;
const FRAG = `precision mediump float;
uniform vec2 res;uniform float t,bass,mid,treb,beat,dark;uniform vec3 c0,c1,c2;
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<4;i++){v+=a*n(p);p=p*2.03+7.1;a*=.5;}return v;}
void main(){
  vec2 uv=(gl_FragCoord.xy-.5*res)/min(res.x,res.y);
  uv.y-=.07;
  float a=atan(uv.y,uv.x),r=length(uv);
  vec2 dir=vec2(cos(a),sin(a));
  float edge=.33+.05*fbm(dir*1.6+t*.18)+.06*bass*fbm(dir*3.+t*.6)+.035*beat;
  float body=smoothstep(edge+.03,edge-.06,r);
  float glow=exp(-max(r-edge,0.)*(12.-5.*treb))*(.55+.45*mid);
  float w=fbm(uv*1.5+vec2(t*.07,-t*.05)+fbm(uv*1.1-t*.04));
  vec3 col=mix(c0,c1,smoothstep(.25,.65,w));
  col=mix(col,c2,smoothstep(.45,.9,fbm(uv*1.9-t*.09)+.12*uv.y));
  col*=.94+.24*smoothstep(edge,0.,r);
  // Transparent around the blob: the halo fades into whatever the orb sits on.
  vec2 q=gl_FragCoord.xy/res;
  float vig=smoothstep(0.,.2,q.y)*smoothstep(1.,.8,q.y)*smoothstep(0.,.15,q.x)*smoothstep(1.,.85,q.x);
  float halo=glow*(1.-body)*(dark>.5?.6:.45)*vig;
  vec3 outc=mix(mix(c1,c2,.5),col,body)+(h(gl_FragCoord.xy+t)-.5)*.018;
  gl_FragColor=vec4(outc,max(body,halo));
}`;

export const IDLE_PALETTE: readonly Rgb[] = [[0.36, 0.55, 1], [0.6, 0.45, 1], [0.2, 0.82, 0.86]];

interface Props {
  /** Three colours (0…1). */
  palette: readonly Rgb[];
  /** 0…1 track energy: how fast the blob moves. */
  energy?: number;
  isDark: boolean;
  /** Animate (panel open and visible); a still frame otherwise. */
  active: boolean;
  className?: string;
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

export function ResonanceOrb({ palette, energy = 0.5, isDark, active, className }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const fallback = useRef<HTMLDivElement>(null);
  const levels = useRef({ bass: 0, mid: 0, treb: 0, beat: 0 });
  const target = useRef({ palette, energy, dark: isDark ? 1 : 0 });
  target.current = { palette, energy, dark: isDark ? 1 : 0 };

  useAudioLevels((l: AudioLevels) => { levels.current = { bass: l.bass, mid: l.mid, treb: l.treble, beat: l.beat }; }, active);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const useFallback = () => { el.style.display = 'none'; if (fallback.current) fallback.current.style.display = 'block'; };
    const gl = el.getContext('webgl', { antialias: false, premultipliedAlpha: false, powerPreference: 'low-power' });
    if (!gl) { useFallback(); return; }
    const compile = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { useFallback(); return; }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const u = (name: string) => gl.getUniformLocation(prog, name);
    const U = { res: u('res'), t: u('t'), bass: u('bass'), mid: u('mid'), treb: u('treb'), beat: u('beat'), dark: u('dark'), c0: u('c0'), c1: u('c1'), c2: u('c2') };

    const still = matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.perf === 'lite';
    // Shown colours ease toward the target so a new setting blends in instead of snapping.
    const shown = [0, 1, 2].map(i => [...(target.current.palette[i] || IDLE_PALETTE[i])]);
    const smooth = { bass: 0, mid: 0, treb: 0, beat: 0, dark: target.current.dark };
    let raf = 0, last = performance.now(), clock = Math.random() * 50, slowFrames = 0, scale = Math.min(2, window.devicePixelRatio || 1);

    const draw = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      // A slow device gets a smaller canvas instead of a stuttering one (Yandex degrades the same way).
      if (dt > 1 / 24) { if (++slowFrames > 20 && scale > 0.6) { scale *= 0.7; slowFrames = 0; } } else slowFrames = Math.max(0, slowFrames - 1);
      const w = Math.max(1, Math.round(el.clientWidth * scale)), h = Math.max(1, Math.round(el.clientHeight * scale));
      if (el.width !== w || el.height !== h) { el.width = w; el.height = h; gl.viewport(0, 0, w, h); }
      const tgt = target.current, k = 1 - Math.exp(-dt / 0.5), lv = levels.current, ka = 1 - Math.exp(-dt / 0.08);
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) shown[i][j] = lerp(shown[i][j], (tgt.palette[i] || IDLE_PALETTE[i])[j], k);
      smooth.bass = lerp(smooth.bass, lv.bass, ka); smooth.mid = lerp(smooth.mid, lv.mid, ka); smooth.treb = lerp(smooth.treb, lv.treb, ka); smooth.beat = lerp(smooth.beat, lv.beat, ka);
      smooth.dark = lerp(smooth.dark, tgt.dark, k);
      clock += dt * (0.55 + tgt.energy * 0.9 + smooth.bass * 0.8);
      gl.uniform2f(U.res, w, h); gl.uniform1f(U.t, clock);
      gl.uniform1f(U.bass, smooth.bass); gl.uniform1f(U.mid, smooth.mid); gl.uniform1f(U.treb, smooth.treb); gl.uniform1f(U.beat, smooth.beat); gl.uniform1f(U.dark, smooth.dark);
      gl.uniform3fv(U.c0, shown[0]); gl.uniform3fv(U.c1, shown[1]); gl.uniform3fv(U.c2, shown[2]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    let frames = 0;
    // Animated while open; reduced motion and economy mode get a still frame once the colours settle.
    const loop = (now: number) => { draw(now); if (active && !still) raf = requestAnimationFrame(loop); else if (++frames < 60) raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); gl.deleteProgram(prog); gl.deleteBuffer(buf); };
    // Palette, energy and theme are read from the ref on every frame; only a change of these restarts the settle frames.
  }, [active, palette.map(c => c.join()).join('|'), isDark]);

  const css = (c: Rgb) => `rgb(${c.map(v => Math.round(v * 255)).join(' ')})`;
  return <div className={`resonance-orb${className ? ` ${className}` : ''}`} aria-hidden="true">
    <canvas ref={canvas} />
    <div ref={fallback} className="resonance-orb-fallback" style={{ display: 'none', background: `radial-gradient(circle at 42% 40%, ${css(palette[2] || IDLE_PALETTE[2])}, ${css(palette[1] || IDLE_PALETTE[1])} 38%, ${css(palette[0] || IDLE_PALETTE[0])} 62%, transparent 64%)` }} />
  </div>;
}

export default ResonanceOrb;
