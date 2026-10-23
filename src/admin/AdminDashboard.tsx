import React from 'react';
import { Activity, ArrowDownRight, ArrowUpRight, Clock3, FileText, Heart, MessageSquareWarning, Play, UserPlus, Users } from 'lucide-react';
import { useTranslation } from '../stores/useLanguageStore.js';
import LumaSpin from '../components/ui/luma-spin.js';

type Kpi = { value: number; delta: number | null };
type Point = { t: string; active: number; plays: number; newUsers: number };
type Period = '24h' | '7d' | '30d' | '90d';
export type Dashboard = {
  period: Period; generatedAt: string;
  kpis: Record<'activeUsers' | 'newUsers' | 'plays' | 'listeningHours' | 'likes' | 'lyrics' | 'totalUsers' | 'openReports', Kpi>;
  series: Point[];
  topTracks: Array<{ id: string; title: string; artist: string; artworkUrl?: string; plays: number; listeners: number }>;
  topArtists: Array<{ name: string; plays: number; listeners: number }>;
  topAuthors: Array<{ id: string; name: string; username: string | null; avatarUrl: string; lyrics: number }>;
  sources: Array<{ source: string; plays: number }>;
  retention: Array<{ week: string; size: number; cells: Array<number | null> }>;
  nowListening: Array<{ userId: string; name: string; username: string | null; avatarUrl: string; title: string; artist: string; artworkUrl?: string }>;
};
type Request = (path: string, options?: RequestInit) => Promise<any>;

const nf = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const SOURCE_LABEL: Record<string, string> = { spotify: 'Spotify', deezer: 'Deezer', soundcloud: 'SoundCloud', youtube: 'YouTube', personal: 'Свои файлы', yandex: 'Яндекс', tidal: 'TIDAL', other: 'Другое' };

/** Smooth path through points, for line and area charts. */
function smooth(points: Array<[number, number]>) {
  if (!points.length) return '';
  let d = `M${points[0][0].toFixed(1)},${points[0][1].toFixed(1)}`;
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1], [x1, y1] = points[i], cx = (x0 + x1) / 2;
    d += ` C${cx.toFixed(1)},${y0.toFixed(1)} ${cx.toFixed(1)},${y1.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
  }
  return d;
}

function Sparkline({ values }: { values: number[] }) {
  const w = 96, h = 28, max = Math.max(1, ...values);
  const pts = values.map((v, i) => [values.length < 2 ? w : (i / (values.length - 1)) * w, h - 2 - (v / max) * (h - 4)] as [number, number]);
  const line = smooth(pts);
  return <svg className="adm-spark" viewBox={`0 0 ${w} ${h}`} aria-hidden="true" preserveAspectRatio="none">
    {pts.length > 1 && <path d={`${line} L${w},${h} L0,${h} Z`} className="adm-spark-fill" />}
    <path d={line} className="adm-spark-line" />
  </svg>;
}

function KpiTile({ icon: Icon, label, kpi, spark, unit }: { icon: typeof Users; label: string; kpi: Kpi; spark?: number[]; unit?: string }) {
  const t = useTranslation(), up = (kpi.delta ?? 0) >= 0;
  return <div className="adm-kpi">
    <span className="adm-kpi-label"><Icon size={14} />{label}</span>
    <strong>{nf.format(kpi.value)}{unit && <small>{unit}</small>}</strong>
    <span className="adm-kpi-foot">
      {kpi.delta !== null ? <em className={up ? 'is-up' : 'is-down'} title={t('По сравнению с предыдущим периодом', 'Versus the previous period')}>{up ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}{Math.abs(kpi.delta)}%</em> : <em className="is-flat">{t('сейчас', 'now')}</em>}
      {spark && <Sparkline values={spark} />}
    </span>
  </div>;
}

/** Two-series area chart with a hover crosshair and tooltip. */
function ActivityChart({ series, hourly }: { series: Point[]; hourly: boolean }) {
  const t = useTranslation(), [hover, setHover] = React.useState<number | null>(null), ref = React.useRef<SVGSVGElement>(null);
  const W = 720, H = 220, P = { l: 36, r: 12, t: 12, b: 26 }, iw = W - P.l - P.r, ih = H - P.t - P.b;
  const maxPlays = Math.max(1, ...series.map(s => s.plays)), maxActive = Math.max(1, ...series.map(s => s.active));
  const x = (i: number) => P.l + (series.length < 2 ? iw : (i / (series.length - 1)) * iw);
  const yP = (v: number) => P.t + ih - (v / maxPlays) * ih, yA = (v: number) => P.t + ih - (v / maxActive) * ih;
  const plays = series.map((s, i) => [x(i), yP(s.plays)] as [number, number]), active = series.map((s, i) => [x(i), yA(s.active)] as [number, number]);
  const label = (iso: string) => new Date(iso).toLocaleString(undefined, hourly ? { hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short' });
  const ticks = [0, .5, 1].map(k => Math.round(maxPlays * k));
  const step = Math.max(1, Math.ceil(series.length / 6));
  const onMove = (e: React.PointerEvent) => {
    const r = ref.current?.getBoundingClientRect(); if (!r || !series.length) return;
    const px = ((e.clientX - r.left) / r.width) * W;
    setHover(Math.max(0, Math.min(series.length - 1, Math.round(((px - P.l) / iw) * (series.length - 1)))));
  };
  const h = hover !== null ? series[hover] : null;
  return <div className="adm-chart">
    <div className="adm-legend"><span className="is-plays">{t('Прослушивания', 'Plays')}</span><span className="is-active">{t('Активные слушатели', 'Active listeners')}</span></div>
    <svg ref={ref} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('Динамика прослушиваний и активных пользователей', 'Plays and active users over time')} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
      <defs><linearGradient id="admPlays" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--adm-c1)" stopOpacity=".35" /><stop offset="1" stopColor="var(--adm-c1)" stopOpacity="0" /></linearGradient></defs>
      {ticks.map(v => <g key={v}><line x1={P.l} x2={W - P.r} y1={yP(v)} y2={yP(v)} className="adm-grid" /><text x={P.l - 8} y={yP(v) + 4} className="adm-axis" textAnchor="end">{nf.format(v)}</text></g>)}
      {series.map((s, i) => i % step === 0 && <text key={s.t} x={x(i)} y={H - 6} className="adm-axis" textAnchor="middle">{label(s.t)}</text>)}
      {plays.length > 1 && <path d={`${smooth(plays)} L${x(series.length - 1)},${P.t + ih} L${P.l},${P.t + ih} Z`} fill="url(#admPlays)" />}
      <path d={smooth(plays)} className="adm-line is-plays" />
      <path d={smooth(active)} className="adm-line is-active" />
      {h && hover !== null && <g><line x1={x(hover)} x2={x(hover)} y1={P.t} y2={P.t + ih} className="adm-cross" /><circle cx={x(hover)} cy={yP(h.plays)} r="4" className="adm-dot is-plays" /><circle cx={x(hover)} cy={yA(h.active)} r="4" className="adm-dot is-active" /></g>}
    </svg>
    {h && hover !== null && <div className="adm-tip" style={{ left: `${(x(hover) / W) * 100}%` }}><b>{label(h.t)}</b><span className="is-plays">{nf.format(h.plays)} {t('прослуш.', 'plays')}</span><span className="is-active">{nf.format(h.active)} {t('слушателей', 'listeners')}</span>{h.newUsers > 0 && <span>+{h.newUsers} {t('новых', 'new')}</span>}</div>}
  </div>;
}

function BarList({ rows, unit }: { rows: Array<{ label: React.ReactNode; value: number; key: string }>; unit: string }) {
  const max = Math.max(1, ...rows.map(r => r.value));
  return <ol className="adm-barlist">{rows.map(r => <li key={r.key}><span className="adm-barlist-bar" style={{ width: `${(r.value / max) * 100}%` }} /><span className="adm-barlist-label">{r.label}</span><b>{nf.format(r.value)}<small> {unit}</small></b></li>)}</ol>;
}

function Retention({ rows }: { rows: Dashboard['retention'] }) {
  const t = useTranslation();
  return <div className="adm-cohort" role="table" aria-label={t('Удержание по неделям', 'Weekly retention')}>
    <div className="adm-cohort-row is-head" role="row"><span role="columnheader">{t('Неделя', 'Week')}</span><span role="columnheader">{t('Новых', 'Users')}</span>{rows.map((_, k) => <span key={k} role="columnheader">{k === 0 ? t('нед. 0', 'wk 0') : `+${k}`}</span>)}</div>
    {rows.map(r => <div key={r.week} className="adm-cohort-row" role="row">
      <span role="cell">{new Date(r.week).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span><span role="cell">{r.size}</span>
      {rows.map((_, k) => { const v = r.cells[k]; return <span key={k} role="cell" className="adm-cohort-cell" style={v != null ? { '--v': v / 100 } as React.CSSProperties : undefined}>{v == null ? '' : `${v}%`}</span>; })}
    </div>)}
  </div>;
}

export function AdminDashboard({ request }: { request: Request }) {
  const t = useTranslation();
  const [period, setPeriod] = React.useState<Period>('7d'), [data, setData] = React.useState<Dashboard | null>(null), [error, setError] = React.useState('');
  React.useEffect(() => {
    let live = true; setError('');
    request(`/dashboard?period=${period}`).then(d => { if (live) setData(d); }).catch(e => { if (live) setError((e as Error).message); });
    return () => { live = false; };
  }, [period, request]);
  const spark = (key: keyof Point) => data?.series.map(p => Number(p[key])) || [];
  const periods: Array<[Period, string]> = [['24h', t('24 часа', '24 hours')], ['7d', t('7 дней', '7 days')], ['30d', t('30 дней', '30 days')], ['90d', t('90 дней', '90 days')]];
  return <section className="adm-dash">
    <div className="adm-dash-head">
      <div className="adm-chips" role="radiogroup" aria-label={t('Период', 'Period')}>{periods.map(([id, label]) => <button key={id} role="radio" aria-checked={period === id} className={period === id ? 'is-active' : ''} onClick={() => setPeriod(id)}>{label}</button>)}</div>
      {data && <small className="adm-hint">{t('Обновлено', 'Updated')} {new Date(data.generatedAt).toLocaleTimeString()} · {t('сравнение с предыдущим таким же периодом', 'compared with the previous period')}</small>}
    </div>
    {error && <p className="adm-error" role="alert">{error}</p>}
    {!data ? <div className="adm-dash-loading"><LumaSpin size="md" label={t('Считаем статистику', 'Crunching numbers')} /></div> : <>
      <div className="adm-kpis">
        <KpiTile icon={Activity} label={t('Активные', 'Active users')} kpi={data.kpis.activeUsers} spark={spark('active')} />
        <KpiTile icon={Play} label={t('Прослушивания', 'Plays')} kpi={data.kpis.plays} spark={spark('plays')} />
        <KpiTile icon={Clock3} label={t('Часы музыки', 'Listening hours')} kpi={data.kpis.listeningHours} unit={t(' ч', ' h')} />
        <KpiTile icon={UserPlus} label={t('Новые', 'New users')} kpi={data.kpis.newUsers} spark={spark('newUsers')} />
        <KpiTile icon={Heart} label={t('Лайки', 'Likes')} kpi={data.kpis.likes} />
        <KpiTile icon={FileText} label={t('Новые тексты', 'New lyrics')} kpi={data.kpis.lyrics} />
        <KpiTile icon={Users} label={t('Всего пользователей', 'Total users')} kpi={data.kpis.totalUsers} />
        <KpiTile icon={MessageSquareWarning} label={t('Открытые обращения', 'Open reports')} kpi={data.kpis.openReports} />
      </div>
      <div className="adm-dash-grid">
        <article className="adm-tile adm-tile--wide"><h3>{t('Активность', 'Activity')}</h3><ActivityChart series={data.series} hourly={data.period === '24h'} /></article>
        <article className="adm-tile"><h3>{t('Сейчас слушают', 'Listening now')} <small>{data.nowListening.length}</small></h3>
          {data.nowListening.length ? <ul className="adm-now">{data.nowListening.map(n => <li key={n.userId}>{n.artworkUrl ? <img src={n.artworkUrl} alt="" /> : <i />}<span><b>{n.title}</b><small>{n.artist} · {n.username ? `@${n.username}` : n.name}</small></span><em className="adm-live" aria-label={t('в эфире', 'live')} /></li>)}</ul> : <p className="adm-empty">{t('Никто не слушает прямо сейчас', 'Nobody is listening right now')}</p>}
        </article>
        <article className="adm-tile"><h3>{t('Источники звука', 'Audio sources')}</h3>{data.sources.length ? <BarList unit={t('прослуш.', 'plays')} rows={data.sources.map(s => ({ key: s.source, label: SOURCE_LABEL[s.source] || s.source, value: s.plays }))} /> : <p className="adm-empty">—</p>}</article>
        <article className="adm-tile"><h3>{t('Топ треков', 'Top tracks')}</h3>{data.topTracks.length ? <BarList unit={t('прослуш.', 'plays')} rows={data.topTracks.map(tr => ({ key: tr.id, value: tr.plays, label: <span className="adm-track">{tr.artworkUrl && <img src={tr.artworkUrl} alt="" />}<span><b>{tr.title}</b><small>{tr.artist} · {tr.listeners} {t('слуш.', 'listeners')}</small></span></span> }))} /> : <p className="adm-empty">—</p>}</article>
        <article className="adm-tile"><h3>{t('Топ артистов', 'Top artists')}</h3>{data.topArtists.length ? <BarList unit={t('прослуш.', 'plays')} rows={data.topArtists.map(a => ({ key: a.name, value: a.plays, label: <span className="adm-track"><span><b>{a.name}</b><small>{a.listeners} {t('слушателей', 'listeners')}</small></span></span> }))} /> : <p className="adm-empty">—</p>}</article>
        <article className="adm-tile"><h3>{t('Авторы текстов', 'Lyrics authors')}</h3>{data.topAuthors.length ? <BarList unit={t('текстов', 'lyrics')} rows={data.topAuthors.map(a => ({ key: a.id, value: a.lyrics, label: <span className="adm-track">{a.avatarUrl && <img src={a.avatarUrl} alt="" className="is-round" />}<span><b>{a.name}</b><small>{a.username ? `@${a.username}` : a.id}</small></span></span> }))} /> : <p className="adm-empty">—</p>}</article>
        <article className="adm-tile adm-tile--wide"><h3>{t('Удержание по неделям', 'Weekly retention')} <small>{t('доля пришедших за неделю, кто слушал в следующие недели', 'share of each week’s new users who listened in later weeks')}</small></h3><Retention rows={data.retention} /></article>
      </div>
    </>}
  </section>;
}
