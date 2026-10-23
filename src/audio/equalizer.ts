export const EQ_FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const LEGACY = [60, 170, 350, 1000, 3500, 10000];
export const EQ_PRESETS = {
  flat: [0,0,0,0,0,0,0,0,0,0],
  bass: [5,4,3,1,0,0,0,0,0,0],
  vocal: [-2,-2,-1,0,2,3,3,2,0,-1],
  rock: [3,2,0,-1,-2,0,2,3,3,2],
  electronic: [4,3,1,0,-1,1,0,2,3,4],
};
export function normalizeEqualizer(input: unknown): number[] {
  if (!Array.isArray(input)) return [...EQ_PRESETS.flat];
  const clamp = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? Math.max(-12, Math.min(12,v)) : 0;
  if (input.length !== LEGACY.length) return EQ_FREQUENCIES.map((_,i)=>clamp(input[i]));
  return EQ_FREQUENCIES.map(f=>{
    const hi=LEGACY.findIndex(v=>v>=f);
    if(hi===0)return clamp(input[0]);
    if(hi<0)return clamp(input[LEGACY.length-1]);
    const ratio=Math.log(f/LEGACY[hi-1])/Math.log(LEGACY[hi]/LEGACY[hi-1]);
    return Math.round(clamp(input[hi-1])*(1-ratio)+clamp(input[hi])*ratio);
  });
}
