import React, { useEffect, useState, useMemo } from 'react';
import { motion, useMotionValue, useSpring, useReducedMotion } from 'framer-motion';
import { useThemeStore } from '../../stores/useThemeStore.js';

export type ShardsDensity = 'full' | 'medium' | 'subtle';

interface ShardsBackgroundProps {
  density?: ShardsDensity;
  showCenterWave?: boolean;
}

interface ShardConfig {
  id: string;
  src: string;
  left: string;
  top: string;
  width: string;
  depth: 1 | 2 | 3 | 4;
  introDelay: number;
  introDuration: number;
  initialOffset: { x: number; y: number; rotate: number; scale: number };
  idle: {
    duration: number;
    deltaY: number;
    deltaX: number;
    rotateDelta: number;
  };
  baseRotate?: number;
  glow?: string;
}

const SHARDS_DATA: ShardConfig[] = [
  // Depth 1: Far background soft blurred ice crystals (pure blue, zero noise)
  {
    id: 'shard_depth_left',
    src: '/shards/shard_depth_left.png',
    left: '0%',
    top: '31.25%',
    width: '13.67%',
    depth: 1,
    introDelay: 0.16,
    introDuration: 1.4,
    initialOffset: { x: -85, y: 35, rotate: -10, scale: 0.65 },
    idle: { duration: 13.5, deltaY: -5, deltaX: 3, rotateDelta: 0.8 },
    baseRotate: 0,
    glow: 'drop-shadow(0 0 20px rgba(59, 130, 246, 0.2))',
  },
  {
    id: 'shard_depth_right',
    src: '/shards/shard_depth_right.png',
    left: '85%',
    top: '67.7%',
    width: '15%',
    depth: 1,
    introDelay: 0.2,
    introDuration: 1.4,
    initialOffset: { x: 85, y: 45, rotate: 10, scale: 0.65 },
    idle: { duration: 14.2, deltaY: 6, deltaX: -4, rotateDelta: -0.8 },
    baseRotate: 0,
    glow: 'drop-shadow(0 0 20px rgba(59, 130, 246, 0.2))',
  },

  // Depth 3: Four Primary Faceted 3D Crystal Shards
  {
    id: 'shard_tl',
    src: '/shards/shard_tl.png',
    left: '15.92%',
    top: '12.67%',
    width: '18.36%',
    depth: 3,
    introDelay: 0.06,
    introDuration: 1.35,
    initialOffset: { x: -95, y: -80, rotate: -15, scale: 0.65 },
    idle: { duration: 9.2, deltaY: -8, deltaX: 5, rotateDelta: 1.5 },
    baseRotate: 0,
    glow: 'drop-shadow(0 12px 28px rgba(59, 130, 246, 0.22)) drop-shadow(0 0 15px rgba(255,255,255,0.8))',
  },
  {
    id: 'shard_bl',
    src: '/shards/shard_bl.png',
    left: '16.21%',
    top: '53.65%',
    width: '18.26%',
    depth: 3,
    introDelay: 0.1,
    introDuration: 1.4,
    initialOffset: { x: -90, y: 95, rotate: 14, scale: 0.65 },
    idle: { duration: 11.0, deltaY: 9, deltaX: -6, rotateDelta: -1.4 },
    baseRotate: 0,
    glow: 'drop-shadow(0 12px 28px rgba(59, 130, 246, 0.22)) drop-shadow(0 0 15px rgba(255,255,255,0.8))',
  },
  {
    id: 'shard_tr',
    src: '/shards/shard_tr.png',
    left: '74.32%',
    top: '17.53%',
    width: '16.50%',
    depth: 3,
    introDelay: 0.08,
    introDuration: 1.35,
    initialOffset: { x: 95, y: -85, rotate: 16, scale: 0.65 },
    idle: { duration: 8.8, deltaY: -7, deltaX: -6, rotateDelta: -1.5 },
    baseRotate: 0,
    glow: 'drop-shadow(0 12px 28px rgba(59, 130, 246, 0.22)) drop-shadow(0 0 15px rgba(255,255,255,0.8))',
  },
  {
    id: 'shard_br',
    src: '/shards/shard_br.png',
    left: '65.62%',
    top: '62.50%',
    width: '16.41%',
    depth: 3,
    introDelay: 0.12,
    introDuration: 1.4,
    initialOffset: { x: 90, y: 95, rotate: -15, scale: 0.65 },
    idle: { duration: 12.4, deltaY: 8, deltaX: 6, rotateDelta: 1.4 },
    baseRotate: 0,
    glow: 'drop-shadow(0 12px 28px rgba(59, 130, 246, 0.22)) drop-shadow(0 0 15px rgba(255,255,255,0.8))',
  },

  // Depth 2 & 4: Satellite Shards
  {
    id: 'shard_mini_top',
    src: '/shards/shard_mini_top.png',
    left: '37.21%',
    top: '16.49%',
    width: '1.66%',
    depth: 2,
    introDelay: 0.04,
    introDuration: 1.0,
    initialOffset: { x: 0, y: -65, rotate: 20, scale: 0.5 },
    idle: { duration: 6.8, deltaY: -4, deltaX: 2, rotateDelta: 1.8 },
    glow: 'drop-shadow(0 3px 8px rgba(59, 130, 246, 0.24)) drop-shadow(0 0 6px rgba(255,255,255,0.7))',
  },
  {
    id: 'shard_mini_fl',
    src: '/shards/shard_mini_fl.png',
    left: '13.28%',
    top: '33.85%',
    width: '1.27%',
    depth: 2,
    introDelay: 0.05,
    introDuration: 0.95,
    initialOffset: { x: -60, y: -30, rotate: -18, scale: 0.5 },
    idle: { duration: 7.4, deltaY: 3, deltaX: -3, rotateDelta: -1.5 },
    glow: 'drop-shadow(0 3px 8px rgba(59, 130, 246, 0.24)) drop-shadow(0 0 6px rgba(255,255,255,0.7))',
  },
  {
    id: 'shard_mini_ml',
    src: '/shards/shard_mini_ml.png',
    left: '22.17%',
    top: '36.63%',
    width: '2.64%',
    depth: 2,
    introDelay: 0.07,
    introDuration: 1.0,
    initialOffset: { x: -55, y: 45, rotate: -16, scale: 0.5 },
    idle: { duration: 7.8, deltaY: 4, deltaX: -3, rotateDelta: -1.5 },
    glow: 'drop-shadow(0 3px 8px rgba(59, 130, 246, 0.24)) drop-shadow(0 0 6px rgba(255,255,255,0.7))',
  },
  {
    id: 'shard_mini_cl',
    src: '/shards/shard_mini_cl.png',
    left: '30.47%',
    top: '53.30%',
    width: '1.66%',
    depth: 2,
    introDelay: 0.06,
    introDuration: 1.0,
    initialOffset: { x: -45, y: 50, rotate: 18, scale: 0.5 },
    idle: { duration: 8.2, deltaY: -3, deltaX: 3, rotateDelta: 1.8 },
    glow: 'drop-shadow(0 3px 8px rgba(59, 130, 246, 0.24)) drop-shadow(0 0 6px rgba(255,255,255,0.7))',
  },
  {
    id: 'shard_mini_bl2',
    src: '/shards/shard_mini_bl2.png',
    left: '18.36%',
    top: '72.92%',
    width: '1.56%',
    depth: 2,
    introDelay: 0.08,
    introDuration: 1.05,
    initialOffset: { x: -55, y: 60, rotate: -16, scale: 0.5 },
    idle: { duration: 7.2, deltaY: 4, deltaX: -3, rotateDelta: -1.6 },
    glow: 'drop-shadow(0 3px 8px rgba(59, 130, 246, 0.24)) drop-shadow(0 0 6px rgba(255,255,255,0.7))',
  },
  {
    id: 'shard_mini_bc',
    src: '/shards/shard_mini_bc.png',
    left: '41.41%',
    top: '85.94%',
    width: '3.42%',
    depth: 4,
    introDelay: 0.09,
    introDuration: 1.1,
    initialOffset: { x: 0, y: 75, rotate: 18, scale: 0.5 },
    idle: { duration: 9.5, deltaY: 5, deltaX: 4, rotateDelta: 2.0 },
    glow: 'drop-shadow(0 4px 10px rgba(59, 130, 246, 0.26)) drop-shadow(0 0 8px rgba(255,255,255,0.75))',
  },
  {
    id: 'shard_mini_tr',
    src: '/shards/shard_mini_tr.png',
    left: '71.88%',
    top: '32.64%',
    width: '2.34%',
    depth: 2,
    introDelay: 0.05,
    introDuration: 1.0,
    initialOffset: { x: 55, y: -50, rotate: -18, scale: 0.5 },
    idle: { duration: 7.9, deltaY: -4, deltaX: -2, rotateDelta: -1.8 },
    glow: 'drop-shadow(0 3px 8px rgba(59, 130, 246, 0.24)) drop-shadow(0 0 6px rgba(255,255,255,0.7))',
  },
  {
    id: 'shard_mini_mr',
    src: '/shards/shard_mini_mr.png',
    left: '92.29%',
    top: '52.60%',
    width: '2.15%',
    depth: 2,
    introDelay: 0.07,
    introDuration: 1.05,
    initialOffset: { x: 65, y: 40, rotate: 18, scale: 0.5 },
    idle: { duration: 8.4, deltaY: 3, deltaX: 3, rotateDelta: 1.6 },
    glow: 'drop-shadow(0 3px 8px rgba(59, 130, 246, 0.24)) drop-shadow(0 0 6px rgba(255,255,255,0.7))',
  },
  {
    id: 'shard_mini_mc',
    src: '/shards/shard_mini_mc.png',
    left: '76.86%',
    top: '59.38%',
    width: '1.27%',
    depth: 2,
    introDelay: 0.06,
    introDuration: 1.0,
    initialOffset: { x: 50, y: 45, rotate: -16, scale: 0.5 },
    idle: { duration: 8.0, deltaY: 3, deltaX: -2, rotateDelta: -1.4 },
    glow: 'drop-shadow(0 3px 8px rgba(59, 130, 246, 0.24)) drop-shadow(0 0 6px rgba(255,255,255,0.7))',
  },
  {
    id: 'shard_mini_br1',
    src: '/shards/shard_mini_br1.png',
    left: '61.72%',
    top: '77.08%',
    width: '2.25%',
    depth: 4,
    introDelay: 0.08,
    introDuration: 1.0,
    initialOffset: { x: -45, y: 60, rotate: -16, scale: 0.5 },
    idle: { duration: 6.9, deltaY: -3, deltaX: -3, rotateDelta: -1.7 },
    glow: 'drop-shadow(0 3px 8px rgba(59, 130, 246, 0.24)) drop-shadow(0 0 6px rgba(255,255,255,0.7))',
  },
  {
    id: 'shard_mini_br2',
    src: '/shards/shard_mini_br2.png',
    left: '81.74%',
    top: '74.83%',
    width: '3.12%',
    depth: 2,
    introDelay: 0.1,
    introDuration: 1.1,
    initialOffset: { x: 60, y: 65, rotate: 18, scale: 0.5 },
    idle: { duration: 9.0, deltaY: 5, deltaX: 3, rotateDelta: 1.4 },
    glow: 'drop-shadow(0 3px 8px rgba(59, 130, 246, 0.24)) drop-shadow(0 0 6px rgba(255,255,255,0.7))',
  },
  {
    id: 'shard_mini_br3',
    src: '/shards/shard_mini_br3.png',
    left: '85.06%',
    top: '85.24%',
    width: '1.95%',
    depth: 2,
    introDelay: 0.12,
    introDuration: 1.1,
    initialOffset: { x: 65, y: 75, rotate: -16, scale: 0.5 },
    idle: { duration: 8.5, deltaY: 4, deltaX: -2, rotateDelta: -1.4 },
    glow: 'drop-shadow(0 3px 8px rgba(59, 130, 246, 0.24)) drop-shadow(0 0 6px rgba(255,255,255,0.7))',
  },
];

export const ShardsBackground: React.FC<ShardsBackgroundProps> = ({
  density = 'full',
  showCenterWave = true,
}) => {
  const prefersReducedMotion = useReducedMotion();
  const [isTouch, setIsTouch] = useState(() => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse), (max-width: 700px)').matches);

  // Mouse Parallax coordinates (normalized from -1 to 1)
  const rawMouseX = useMotionValue(0);
  const rawMouseY = useMotionValue(0);

  // Springs for buttery smooth mouse parallax response
  const springConfig = { damping: 26, stiffness: 65, mass: 0.7 };
  const smoothMouseX = useSpring(rawMouseX, springConfig);
  const smoothMouseY = useSpring(rawMouseY, springConfig);

  useEffect(() => {
    const media = window.matchMedia('(pointer: coarse), (max-width: 700px)');
    const update = () => setIsTouch(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isTouch || prefersReducedMotion) return;
    const { innerWidth, innerHeight } = window;
    const normX = (e.clientX / innerWidth - 0.5) * 2;
    const normY = (e.clientY / innerHeight - 0.5) * 2;
    rawMouseX.set(normX);
    rawMouseY.set(normY);
  };

  const handleMouseLeave = () => {
    rawMouseX.set(0);
    rawMouseY.set(0);
  };

  // Filter shards based on density
  const activeShards = useMemo(() => {
    if (density === 'subtle') {
      // Keep the two large glass shards. The old depth PNGs were visibly
      // pixelated at the viewport edges and are intentionally excluded.
      return SHARDS_DATA.filter((s) => ['shard_tl', 'shard_br'].includes(s.id));
    }
    if (density === 'medium') {
      // Keep 4 main shards + 3 satellites
      return SHARDS_DATA.filter((s) =>
        ['shard_tl', 'shard_bl', 'shard_tr', 'shard_br', 'shard_mini_top', 'shard_mini_cl', 'shard_mini_mr'].includes(s.id)
      );
    }
    return SHARDS_DATA.filter((s) => s.id !== 'shard_depth_left' && s.id !== 'shard_depth_right');
  }, [density]);

  const { isDark } = useThemeStore();
  const densityOpacity = density === 'full' ? 1 : density === 'medium' ? 0.65 : 0.4;

  // iOS WebKit may rasterize animated SVG filters and large blur layers as
  // opaque rectangles. Keep the crystalline identity with static CSS facets.
  if (isTouch) return <div className={`mobile-shards-backdrop mobile-shards-backdrop--${density} absolute inset-0 pointer-events-none`} aria-hidden="true">
    <i className="mobile-shard mobile-shard--left" />
    <i className="mobile-shard mobile-shard--right" />
    {density !== 'subtle' && <>
      <i className="mobile-shard mobile-shard--lower" />
      <i className="mobile-shard mobile-shard--spark" />
    </>}
  </div>;

  return (
    <div
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className="absolute inset-0 pointer-events-none overflow-hidden select-none z-0"
      style={{
        background: isDark
          ? 'radial-gradient(ellipse at 50% 50%, #0c1c38 0%, #080f1e 40%, #050912 80%, #03060c 100%)'
          : 'radial-gradient(ellipse at 50% 46%, #f5f8fc 0%, #edf3f9 45%, #e6eff7 100%)',
        transition: 'background 0.4s ease',
      }}
    >
      {/* Ambient Blue Halo Blurs behind Shards */}
      <div
        className={`absolute top-[12%] left-[12%] w-[320px] h-[320px] rounded-full pointer-events-none transition-all duration-500 ${
          isDark ? 'bg-blue-600/30 blur-[100px]' : 'bg-blue-400/10 blur-[80px]'
        }`}
      />
      <div
        className={`absolute bottom-[10%] left-[12%] w-[340px] h-[340px] rounded-full pointer-events-none transition-all duration-500 ${
          isDark ? 'bg-blue-600/30 blur-[100px]' : 'bg-blue-400/10 blur-[80px]'
        }`}
      />
      <div
        className={`absolute top-[12%] right-[12%] w-[320px] h-[320px] rounded-full pointer-events-none transition-all duration-500 ${
          isDark ? 'bg-blue-600/30 blur-[100px]' : 'bg-blue-400/10 blur-[80px]'
        }`}
      />
      <div
        className={`absolute bottom-[10%] right-[12%] w-[340px] h-[340px] rounded-full pointer-events-none transition-all duration-500 ${
          isDark ? 'bg-blue-600/30 blur-[100px]' : 'bg-blue-400/10 blur-[80px]'
        }`}
      />

      {/* Center ambient glow in dark mode */}
      {isDark && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[550px] h-[360px] rounded-full bg-blue-600/20 blur-[110px] pointer-events-none" />
      )}

      {/* SVG Orbital Curves & Center Line */}
      <svg
        className="original-orbits absolute inset-0 w-full h-full pointer-events-none"
        viewBox="0 0 1024 576"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          {/* Subtle gradient for left orbital curve */}
          <linearGradient id="orbitLeftGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={isDark ? '#38bdf8' : '#2563eb'} stopOpacity="0.0" />
            <stop offset="35%" stopColor={isDark ? '#38bdf8' : '#3b82f6'} stopOpacity={isDark ? '0.85' : '0.32'} />
            <stop offset="70%" stopColor={isDark ? '#2563eb' : '#60a5fa'} stopOpacity={isDark ? '0.75' : '0.25'} />
            <stop offset="100%" stopColor={isDark ? '#1d4ed8' : '#93c5fd'} stopOpacity="0.0" />
          </linearGradient>

          {/* Subtle gradient for right orbital curve */}
          <linearGradient id="orbitRightGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={isDark ? '#1d4ed8' : '#93c5fd'} stopOpacity="0.0" />
            <stop offset="30%" stopColor={isDark ? '#2563eb' : '#3b82f6'} stopOpacity={isDark ? '0.75' : '0.28'} />
            <stop offset="70%" stopColor={isDark ? '#38bdf8' : '#2563eb'} stopOpacity={isDark ? '0.85' : '0.32'} />
            <stop offset="100%" stopColor={isDark ? '#38bdf8' : '#1d4ed8'} stopOpacity="0.0" />
          </linearGradient>

          {/* Center Equalizer Wave Gradient */}
          <linearGradient id="waveLineGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={isDark ? '#38bdf8' : '#2563eb'} stopOpacity="0.0" />
            <stop offset="25%" stopColor={isDark ? '#38bdf8' : '#2563eb'} stopOpacity={isDark ? '0.75' : '0.45'} />
            <stop offset="50%" stopColor={isDark ? '#60a5fa' : '#1d4ed8'} stopOpacity={isDark ? '1.0' : '0.75'} />
            <stop offset="75%" stopColor={isDark ? '#38bdf8' : '#2563eb'} stopOpacity={isDark ? '0.75' : '0.45'} />
            <stop offset="100%" stopColor={isDark ? '#38bdf8' : '#2563eb'} stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {/* Left Orbital Curve */}
        {density !== 'subtle' && (
          <motion.path
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ duration: 1.3, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
            d="M 452 440 C 350 495, 230 495, 175 425 C 110 340, 115 220, 195 210 C 235 205, 275 220, 305 245"
            fill="none"
            stroke="url(#orbitLeftGrad)"
            strokeWidth={isDark ? '1.5' : '1.2'}
            strokeLinecap="round"
            style={{
              filter: isDark ? 'drop-shadow(0 0 6px rgba(56, 189, 248, 0.8))' : undefined,
            }}
          />
        )}

        {/* Right Orbital Curve */}
        {density !== 'subtle' && (
          <motion.path
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ duration: 1.3, delay: 0.25, ease: [0.16, 1, 0.3, 1] }}
            d="M 555 125 C 685 110, 770 145, 795 210 C 830 300, 875 365, 830 395 C 780 430, 715 360, 695 330"
            fill="none"
            stroke="url(#orbitRightGrad)"
            strokeWidth={isDark ? '1.5' : '1.2'}
            strokeLinecap="round"
            style={{
              filter: isDark ? 'drop-shadow(0 0 6px rgba(56, 189, 248, 0.8))' : undefined,
            }}
          />
        )}

        {/* Center Waveform Equalizer Line (below the main text) */}
        {showCenterWave && (
          <motion.path
            initial={{ scaleX: 0, opacity: 0 }}
            animate={{ scaleX: 1, opacity: 1 }}
            transition={{ duration: 1.2, delay: 0.4, ease: 'easeOut' }}
            style={{
              transformOrigin: '512px 328px',
              filter: isDark ? 'drop-shadow(0 0 8px rgba(56, 189, 248, 0.85))' : undefined,
            }}
            d="M 380 327 L 485 327 C 490 327, 492 332, 496 333 C 502 334, 508 303, 513 303 C 518 303, 524 350, 531 350 C 536 350, 540 318, 544 318 C 548 318, 552 333, 556 333 C 559 333, 562 327, 568 327 L 644 327"
            fill="none"
            stroke="url(#waveLineGrad)"
            strokeWidth={isDark ? '1.6' : '1.3'}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </svg>

      {/* Shards Container scaled relative to aspect */}
      <div className="absolute inset-0 w-full h-full pointer-events-none" style={{ opacity: densityOpacity }}>
        {activeShards.map((shard) => {
          const depthMultiplier =
            shard.depth === 1 ? 5 : shard.depth === 2 ? 9 : shard.depth === 3 ? 16 : 22;

          return (
            <ShardElement
              key={shard.id}
              config={shard}
              depthMultiplier={depthMultiplier}
              smoothMouseX={smoothMouseX}
              smoothMouseY={smoothMouseY}
              prefersReducedMotion={Boolean(prefersReducedMotion)}
              isDark={isDark}
            />
          );
        })}
      </div>
    </div>
  );
};

interface ShardElementProps {
  config: ShardConfig;
  depthMultiplier: number;
  smoothMouseX: any;
  smoothMouseY: any;
  prefersReducedMotion: boolean;
  isDark: boolean;
}

const ShardElement: React.FC<ShardElementProps> = ({
  config,
  depthMultiplier,
  smoothMouseX,
  smoothMouseY,
  prefersReducedMotion,
  isDark,
}) => {
  const [parallaxOffset, setParallaxOffset] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (prefersReducedMotion) return;
    const unsubX = smoothMouseX.on('change', (v: number) => {
      setParallaxOffset((prev) => ({ ...prev, x: v * depthMultiplier }));
    });
    const unsubY = smoothMouseY.on('change', (v: number) => {
      setParallaxOffset((prev) => ({ ...prev, y: v * depthMultiplier }));
    });
    return () => {
      unsubX();
      unsubY();
    };
  }, [smoothMouseX, smoothMouseY, depthMultiplier, prefersReducedMotion]);

  const introVariants = {
    initial: {
      opacity: 0,
      scale: config.initialOffset.scale,
      x: config.initialOffset.x,
      y: config.initialOffset.y,
      rotate: config.initialOffset.rotate,
      filter: 'blur(8px)',
    },
    animate: {
      opacity: 1,
      scale: 1,
      x: 0,
      y: 0,
      rotate: config.baseRotate || 0,
      filter: 'blur(0px)',
      transition: {
        duration: config.introDuration,
        delay: config.introDelay,
        ease: [0.16, 1, 0.28, 1],
      },
    },
  };

  const idleAnimate = prefersReducedMotion
    ? {}
    : {
        y: [0, config.idle.deltaY, 0],
        x: [0, config.idle.deltaX, 0],
        rotate: [
          config.baseRotate || 0,
          (config.baseRotate || 0) + config.idle.rotateDelta,
          config.baseRotate || 0,
        ],
      };

  const idleTransition = {
    duration: config.idle.duration,
    repeat: Infinity,
    ease: 'easeInOut',
  };

  const shardGlow = isDark
    ? config.depth === 3
      ? 'drop-shadow(0 0 24px rgba(37, 99, 235, 0.95)) drop-shadow(0 0 50px rgba(59, 130, 246, 0.6)) drop-shadow(0 0 6px rgba(224, 242, 254, 0.9))'
      : config.depth === 1
      ? 'drop-shadow(0 0 35px rgba(37, 99, 235, 0.65))'
      : 'drop-shadow(0 0 16px rgba(59, 130, 246, 0.95)) drop-shadow(0 0 4px rgba(255, 255, 255, 0.9))'
    : config.glow;

  return (
    <motion.div
      className={`absolute pointer-events-none original-shard-layer ${config.depth === 3 ? 'original-shard-layer--primary' : ''}`}
      style={{
        left: config.left,
        top: config.top,
        width: config.width,
        zIndex: config.depth === 3 ? 10 : config.depth === 4 ? 20 : 5,
        transform: `translate(${parallaxOffset.x}px, ${parallaxOffset.y}px)`,
        transition: 'transform 0.1s ease-out',
      }}
    >
      <motion.div
        variants={introVariants}
        initial="initial"
        animate="animate"
      >
        <motion.div
          animate={idleAnimate}
          transition={idleTransition}
        >
          <div className="original-reactive-shard relative">
            <img src={config.src} alt="" className={`original-shard-core ${config.depth === 3 ? 'original-shard-core--glass' : ''} w-full h-auto object-contain select-none pointer-events-none`} style={{ filter: shardGlow }} draggable={false}/>
          </div>
        </motion.div>
      </motion.div>
    </motion.div>
  );
};
