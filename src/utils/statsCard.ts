/** «Итоги» story card (1080×1920 PNG): drawn locally without remote images, so the canvas never gets tainted. */
export interface StatsCardData {
  periodLabel: string; minutes: number; plays: number; artists: number; streak: number;
  topArtists: string[]; topTrack?: {title: string; artist: string}; listenerLine?: string; name?: string;
}

const W = 1080, H = 1920;
function fit(ctx: CanvasRenderingContext2D, text: string, max: number) {
  if (ctx.measureText(text).width <= max) return text;
  let s = text; while (s.length > 1 && ctx.measureText(`${s}…`).width > max) s = s.slice(0, -1);
  return `${s}…`;
}
const num = (n: number) => n.toLocaleString('ru-RU');
const plural = (n: number, one: string, few: string, many: string) => { const a = Math.abs(n) % 100, b = a % 10; return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many; };

export async function renderStatsCard(d: StatsCardData): Promise<Blob> {
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#0b1830'); bg.addColorStop(.55, '#132c55'); bg.addColorStop(1, '#2b5fa8');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  // Glass shards in the corners — the Осколок motif.
  const shard = (pts: number[][], alpha: number) => { ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); ctx.fillStyle = `rgba(156,190,255,${alpha})`; ctx.fill(); ctx.strokeStyle = `rgba(220,235,255,${alpha * 1.6})`; ctx.lineWidth = 2; ctx.stroke(); };
  shard([[760, 0], [1080, 0], [1080, 420], [900, 260]], .16); shard([[900, 260], [1080, 420], [1080, 620]], .09);
  shard([[0, 1500], [260, 1640], [120, 1920], [0, 1920]], .14); shard([[260, 1640], [520, 1920], [120, 1920]], .07);

  const font = (w: number, s: number) => `${w} ${s}px -apple-system, "SF Pro Display", "Segoe UI", Inter, Roboto, sans-serif`;
  ctx.fillStyle = '#9cbeff'; ctx.font = font(600, 34); ctx.fillText('ОСКОЛОК · ИТОГИ', 90, 170);
  ctx.fillStyle = 'rgba(224,233,252,.7)'; ctx.font = font(400, 38); ctx.fillText(fit(ctx, d.name ? `${d.name} · ${d.periodLabel}` : d.periodLabel, 900), 90, 230);

  ctx.fillStyle = '#ffffff'; ctx.font = font(200, 230); ctx.fillText(num(d.minutes), 80, 500);
  ctx.fillStyle = '#9cbeff'; ctx.font = font(500, 46); ctx.fillText(plural(d.minutes, 'минута музыки', 'минуты музыки', 'минут музыки'), 92, 575);

  const tiles: Array<[string, string]> = [[num(d.plays), plural(d.plays, 'прослушивание', 'прослушивания', 'прослушиваний')], [num(d.artists), plural(d.artists, 'артист', 'артиста', 'артистов')], [num(d.streak), plural(d.streak, 'день подряд', 'дня подряд', 'дней подряд')]];
  tiles.forEach(([value, label], i) => {
    const x = 90 + i * 310, y = 660;
    ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.beginPath(); ctx.roundRect(x, y, 280, 190, 32); ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.font = font(600, 72); ctx.fillText(fit(ctx, value, 240), x + 30, y + 100);
    ctx.fillStyle = 'rgba(224,233,252,.7)'; ctx.font = font(400, 32); ctx.fillText(label, x + 30, y + 155);
  });

  ctx.fillStyle = '#9cbeff'; ctx.font = font(600, 34); ctx.fillText('ТОП АРТИСТОВ', 90, 960);
  d.topArtists.slice(0, 5).forEach((name, i) => {
    const y = 1040 + i * 92;
    ctx.fillStyle = i ? 'rgba(224,233,252,.55)' : '#9cbeff'; ctx.font = font(300, 56); ctx.fillText(String(i + 1), 90, y);
    ctx.fillStyle = '#ffffff'; ctx.font = font(i ? 500 : 700, i ? 54 : 62); ctx.fillText(fit(ctx, name, 820), 170, y);
  });
  if (d.topTrack) {
    ctx.fillStyle = '#9cbeff'; ctx.font = font(600, 34); ctx.fillText('ТРЕК ПЕРИОДА', 90, 1560);
    ctx.fillStyle = '#ffffff'; ctx.font = font(600, 54); ctx.fillText(fit(ctx, d.topTrack.title, 900), 90, 1635);
    ctx.fillStyle = 'rgba(224,233,252,.7)'; ctx.font = font(400, 40); ctx.fillText(fit(ctx, d.topTrack.artist, 900), 90, 1690);
  }
  if (d.listenerLine) { ctx.fillStyle = 'rgba(224,233,252,.75)'; ctx.font = font(400, 34); ctx.fillText(fit(ctx, d.listenerLine, 900), 90, 1790); }
  ctx.fillStyle = 'rgba(224,233,252,.55)'; ctx.font = font(500, 30); ctx.fillText('oskolok.lol', 90, 1860);
  return new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('canvas')), 'image/png'));
}
