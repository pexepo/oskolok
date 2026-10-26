import React from "react";

/*
 * Liquid glass, adapted from the supplied GlassEffect/GlassFilter reference.
 * Layers (back → front): a backdrop blur pushed through the #glass-distortion
 * SVG filter (refraction), a tint, inset specular rims, then the content.
 * Mount <GlassFilter /> once per document.
 */

interface GlassEffectProps {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  href?: string;
  target?: string;
}

interface DockIcon {
  src: string;
  alt: string;
  onClick?: () => void;
}

const inherit: React.CSSProperties = { borderRadius: "inherit" };

/** The three glass layers on their own, for surfaces that bring their own container (e.g. the header nav). */
export const GlassLayers: React.FC<{ className?: string; filterId?: string }> = ({ className = "", filterId = "glass-distortion" }) => (
  <span className={`liquid-glass-layers ${className}`} aria-hidden="true">
    <span className="liquid-glass-distort" style={{ ...inherit, filter: `url(#${filterId})` }} />
    <span className="liquid-glass-tint" style={inherit} />
    <span className="liquid-glass-spec" style={inherit} />
  </span>
);

export const GlassEffect: React.FC<GlassEffectProps> = ({ children, className = "", style = {}, href, target = "_blank" }) => {
  const content = (
    <div
      className={`relative flex font-semibold overflow-hidden text-black cursor-pointer transition duration-700 ${className}`}
      style={{ boxShadow: "0 6px 6px rgba(0, 0, 0, 0.2), 0 0 20px rgba(0, 0, 0, 0.1)", transitionTimingFunction: "cubic-bezier(0.175, 0.885, 0.32, 2.2)", ...style }}
    >
      <div className="absolute inset-0 z-0 overflow-hidden" style={{ ...inherit, backdropFilter: "blur(3px)", WebkitBackdropFilter: "blur(3px)", filter: "url(#glass-distortion)", isolation: "isolate" }} />
      <div className="absolute inset-0 z-10" style={{ ...inherit, background: "rgba(255, 255, 255, 0.25)" }} />
      <div className="absolute inset-0 z-20 overflow-hidden" style={{ ...inherit, boxShadow: "inset 2px 2px 1px 0 rgba(255, 255, 255, 0.5), inset -1px -1px 1px 1px rgba(255, 255, 255, 0.5)" }} />
      <div className="relative z-30">{children}</div>
    </div>
  );
  return href ? <a href={href} target={target} rel="noopener noreferrer" className="block">{content}</a> : content;
};

export const GlassDock: React.FC<{ icons: DockIcon[]; href?: string }> = ({ icons, href }) => (
  <GlassEffect href={href} className="rounded-3xl p-3 hover:p-4 hover:rounded-[2rem]">
    <div className="flex items-center justify-center gap-2 rounded-3xl p-3 py-0 px-0.5 overflow-hidden">
      {icons.map((icon, index) => (
        <img key={index} src={icon.src} alt={icon.alt} className="w-16 h-16 transition duration-700 hover:scale-110 cursor-pointer"
          style={{ transformOrigin: "center center", transitionTimingFunction: "cubic-bezier(0.175, 0.885, 0.32, 2.2)" }} onClick={icon.onClick} />
      ))}
    </div>
  </GlassEffect>
);

export const GlassButton: React.FC<{ children: React.ReactNode; href?: string }> = ({ children, href }) => (
  <GlassEffect href={href} className="rounded-3xl px-10 py-6 hover:px-11 hover:py-7 hover:rounded-[2rem] overflow-hidden">
    <div className="transition duration-700 hover:scale-95" style={{ transitionTimingFunction: "cubic-bezier(0.175, 0.885, 0.32, 2.2)" }}>{children}</div>
  </GlassEffect>
);

/**
 * SVG refraction filter. Kept in the layout as a zero-size node rather than
 * display:none, which makes Firefox drop the referenced filter.
 * `scale` is the displacement strength in px; small surfaces want less.
 */
export const GlassFilter: React.FC<{ id?: string; scale?: number }> = ({ id = "glass-distortion", scale = 200 }) => (
  <svg aria-hidden="true" focusable="false" width="0" height="0" style={{ position: "absolute", width: 0, height: 0, overflow: "hidden", pointerEvents: "none" }}>
    <filter id={id} x="0%" y="0%" width="100%" height="100%" filterUnits="objectBoundingBox" colorInterpolationFilters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.001 0.005" numOctaves="1" seed="17" result="turbulence" />
      <feComponentTransfer in="turbulence" result="mapped">
        <feFuncR type="gamma" amplitude="1" exponent="10" offset="0.5" />
        <feFuncG type="gamma" amplitude="0" exponent="1" offset="0" />
        <feFuncB type="gamma" amplitude="0" exponent="1" offset="0.5" />
      </feComponentTransfer>
      <feGaussianBlur in="turbulence" stdDeviation="3" result="softMap" />
      <feSpecularLighting in="softMap" surfaceScale="5" specularConstant="1" specularExponent="100" lightingColor="white" result="specLight">
        <fePointLight x="-200" y="-200" z="300" />
      </feSpecularLighting>
      <feComposite in="specLight" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="litImage" />
      <feDisplacementMap in="SourceGraphic" in2="softMap" scale={scale} xChannelSelector="R" yChannelSelector="G" />
    </filter>
  </svg>
);

/** Edge-refraction map: neutral (0.5) in the middle, ramping toward the rim so the backdrop
 * bends inward at the edges like a thick glass lens. Red drives x, green drives y. */
const ramp = (axis: "x" | "y", edge: number) => {
  const channel = axis === "x" ? (v: number) => `rgb(${v},0,0)` : (v: number) => `rgb(0,${v},0)`;
  const [x2, y2] = axis === "x" ? [1, 0] : [0, 1];
  const e = Math.round(edge * 100);
  return "data:image/svg+xml;utf8," + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" preserveAspectRatio="none"><defs><linearGradient id="g" x1="0" y1="0" x2="${x2}" y2="${y2}">` +
    `<stop offset="0" stop-color="${channel(255)}"/><stop offset="${e}%" stop-color="${channel(128)}"/><stop offset="${100 - e}%" stop-color="${channel(128)}"/><stop offset="1" stop-color="${channel(0)}"/>` +
    `</linearGradient></defs><rect width="100" height="100" fill="url(#g)"/></svg>`);
};

/** SVG filter for `backdrop-filter: url(#id)` (Chromium/Electron): refracts what is behind the
 * element at its rim; the CSS keeps a plain blur fallback. */
export const LiquidLensFilter: React.FC<{ id: string; scale?: number; edge?: number }> = ({ id, scale = 36, edge = 0.22 }) => (
  <svg aria-hidden="true" focusable="false" width="0" height="0" style={{ position: "absolute", width: 0, height: 0, overflow: "hidden", pointerEvents: "none" }}>
    <filter id={id} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
      <feImage href={ramp("x", edge)} x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="rx" />
      <feImage href={ramp("y", Math.min(0.45, edge * 2.2))} x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="ry" />
      <feComposite in="rx" in2="ry" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="map" />
      <feDisplacementMap in="SourceGraphic" in2="map" scale={scale} xChannelSelector="R" yChannelSelector="G" />
    </filter>
  </svg>
);
