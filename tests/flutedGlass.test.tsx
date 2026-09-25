import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FlutedGlassBackground, FLUTED_GLASS_FRAGMENT_SHADER } from '../src/components/shards/FlutedGlassBackground.js';
import { clusterReleasePalette, type Rgb } from '../src/utils/releasePalette.js';

describe('Fluted Glass interference background', () => {
  it('orders extracted release colours from low to high luminance', () => {
    const colours: Rgb[] = [
      ...Array.from({length:12},():Rgb=>[.9,.8,.7]),
      ...Array.from({length:12},():Rgb=>[.04,.02,.08]),
      ...Array.from({length:12},():Rgb=>[.5,.1,.3]),
      ...Array.from({length:12},():Rgb=>[.2,.3,.6]),
    ];
    const palette=clusterReleasePalette(colours);
    const luma=(color:Rgb)=>color[0]*.2126+color[1]*.7152+color[2]*.0722;
    expect(palette).toHaveLength(4);
    expect(palette.map(luma)).toEqual([...palette.map(luma)].sort((a,b)=>a-b));
  });

  it('renders a fullscreen canvas and keeps the requested packed shader API', () => {
    const html=renderToStaticMarkup(<FlutedGlassBackground artworkUrl="cover.jpg"/>);
    expect(html).toContain('fluted-glass-background');
    expect(html).toContain('<canvas');
    expect(FLUTED_GLASS_FRAGMENT_SHADER).toContain('uniform vec4 u_scene');
    expect(FLUTED_GLASS_FRAGMENT_SHADER).toContain('uniform vec4 u_cursor');
  });
});
