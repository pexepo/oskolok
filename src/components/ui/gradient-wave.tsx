import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { DEFAULT_FLUTED_GLASS_PALETTE, paletteFromArtwork, type Rgb } from '../../utils/releasePalette.js';

const VERTEX = `attribute vec2 a_position;
void main() { gl_Position = vec4(a_position, 0.0, 1.0); }`;

// Adapted from the supplied GradientWave: soft, layered waves in the release palette.
// A single fullscreen triangle avoids the large animated mesh on mobile WebViews.
const FRAGMENT = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 u_resolution;
uniform float u_time;
uniform vec3 u_colors[4];
float wave(float x, float t, float phase) {
  return sin(x * 5.2 + t * .42 + phase) * .075
       + sin(x * 10.4 - t * .27 + phase * 1.7) * .027
       + sin(x * 2.5 + t * .17 + phase * .4) * .08;
}
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float x = (uv.x - .5) * u_resolution.x / max(u_resolution.y, 1.0);
  float y = uv.y + wave(x, u_time, .2);
  float a = smoothstep(.15, .68, y + wave(x, u_time, 1.9));
  float b = smoothstep(.25, .84, y + wave(x, u_time, 3.8));
  float c = smoothstep(.34, .98, y + wave(x, u_time, 5.6));
  vec3 color = mix(u_colors[0], u_colors[1], a);
  color = mix(color, u_colors[2], b * .78);
  color = mix(color, u_colors[3], c * .72);
  color = pow(color, vec3(.75));
  float sheen = exp(-pow((y - .49 - wave(x, u_time, 3.0)) * 9.0, 2.0));
  color += sheen * .085;
  gl_FragColor = vec4(color, 1.0);
}`;

function color(rgb: Rgb) {
  return `rgb(${rgb.map(channel => Math.round(channel * 255)).join(' ')})`;
}

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('WebGL shader unavailable');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    throw new Error('WebGL shader compilation failed');
  }
  return shader;
}

export function GradientWave({ artworkUrl, isPlaying, isDark = false }: { artworkUrl?: string; isPlaying: boolean; isDark?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isPlayingRef = useRef(isPlaying);
  const restartRef = useRef<() => void>(() => {});
  isPlayingRef.current = isPlaying;
  const [palette, setPalette] = useState<Rgb[]>([...DEFAULT_FLUTED_GLASS_PALETTE]);
  const fallback = useMemo(() => `linear-gradient(155deg, ${palette.map((entry, index) => `${color(entry)} ${index * 33}%`).join(', ')})`, [palette]);
  const scrim = useMemo(() => {
    const mean = palette.reduce((sum, rgb) => sum + rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722, 0) / palette.length;
    const shade = Math.min(.76, Math.max(.19, .18 + mean * .68 + (isDark ? .04 : 0)));
    return {
      '--wave-scrim-edge': `rgba(3, 8, 18, ${shade.toFixed(3)})`,
      '--wave-scrim-middle': `rgba(3, 8, 18, ${(shade * .82).toFixed(3)})`,
      '--wave-scrim-bottom': `rgba(3, 8, 18, ${(shade * .25).toFixed(3)})`,
    } as CSSProperties;
  }, [palette, isDark]);

  useEffect(() => {
    let alive = true;
    if (!artworkUrl) setPalette([...DEFAULT_FLUTED_GLASS_PALETTE]);
    void paletteFromArtwork(artworkUrl).then(colors => { if (alive) setPalette(colors); });
    return () => { alive = false; };
  }, [artworkUrl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false });
    if (!gl) return;
    let vertex: WebGLShader | undefined;
    let fragment: WebGLShader | undefined;
    let program: WebGLProgram | null = null;
    let buffer: WebGLBuffer | null = null;
    let frame = 0;
    let elapsed = 0;
    let last = 0;
    let disposed = false;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    try {
      vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
      fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
      program = gl.createProgram();
      if (!program) throw new Error('WebGL program unavailable');
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('WebGL program linking failed');
      gl.useProgram(program);
      buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const position = gl.getAttribLocation(program, 'a_position');
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      gl.uniform3fv(gl.getUniformLocation(program, 'u_colors[0]'), new Float32Array(palette.flat()));
      const resolution = gl.getUniformLocation(program, 'u_resolution');
      const time = gl.getUniformLocation(program, 'u_time');
      const resize = () => {
        const scale = Math.min(window.devicePixelRatio || 1, 1.5);
        const width = Math.max(1, Math.round(canvas.clientWidth * scale));
        const height = Math.max(1, Math.round(canvas.clientHeight * scale));
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
          gl.viewport(0, 0, width, height);
        }
      };
      const draw = () => {
        resize();
        gl.uniform2f(resolution, canvas.width, canvas.height);
        gl.uniform1f(time, elapsed);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      };
      const tick = (now: number) => {
        if (disposed || document.hidden || reduced.matches || !isPlayingRef.current) return;
        if (now - last >= 33) {
          elapsed += last ? Math.min((now - last) / 1000, .1) : 0;
          last = now;
          draw();
        }
        frame = requestAnimationFrame(tick);
      };
      const start = () => {
        cancelAnimationFrame(frame);
        last = 0;
        draw();
        if (!document.hidden && !reduced.matches && isPlayingRef.current) frame = requestAnimationFrame(tick);
      };
      restartRef.current = start;
      const observer = new ResizeObserver(draw);
      observer.observe(canvas);
      document.addEventListener('visibilitychange', start);
      reduced.addEventListener('change', start);
      start();
      return () => {
        disposed = true;
        cancelAnimationFrame(frame);
        observer.disconnect();
        document.removeEventListener('visibilitychange', start);
        reduced.removeEventListener('change', start);
        restartRef.current = () => {};
        if (buffer) gl.deleteBuffer(buffer);
        if (program) gl.deleteProgram(program);
        if (vertex) gl.deleteShader(vertex);
        if (fragment) gl.deleteShader(fragment);
      };
    } catch {
      if (buffer) gl.deleteBuffer(buffer);
      if (program) gl.deleteProgram(program);
      if (vertex) gl.deleteShader(vertex);
      if (fragment) gl.deleteShader(fragment);
      return undefined;
    }
  }, [palette]);

  useEffect(() => { restartRef.current(); }, [isPlaying]);

  return <div className="release-gradient-wave" style={{ backgroundImage: fallback, ...scrim }} aria-hidden="true">
    <canvas ref={canvasRef} />
    <div className="release-gradient-scrim" />
  </div>;
}
