import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import type { FocusEvent } from 'react';
import { FileText } from 'lucide-react';
import { Link } from 'react-router-dom';
import { apiClient } from '../../api/apiClient.js';
import type { LyricsAuthor } from '../../types/index.js';
import UniqueLoading from '../ui/morph-loading.js';

const OPEN_DELAY = 100;
const CLOSE_DELAY = 160;

function Avatar({src, name, className}: {src?: string; name: string; className: string}) {
  return src
    ? <img className={className} src={src} alt="" />
    : <span className={className} aria-hidden="true">{name.trim().slice(0, 1).toUpperCase() || '?'}</span>;
}

export function AuthorCard({author,label='Текст'}: {author: LyricsAuthor;label?:string}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const cardId = useId();
  const summary = useQuery({queryKey: ['user-summary', author.id], queryFn: () => apiClient.getUserSummary(author.id), enabled: open});

  const clearTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = undefined;
  };
  const openSoon = () => { clearTimer(); timerRef.current = setTimeout(() => setOpen(true), OPEN_DELAY); };
  const closeSoon = () => { clearTimer(); timerRef.current = setTimeout(() => setOpen(false), CLOSE_DELAY); };
  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!rootRef.current?.contains(event.relatedTarget as Node | null)) closeSoon();
  };

  useEffect(() => clearTimer, []);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        rootRef.current?.querySelector<HTMLButtonElement>('.lyrics-author-trigger')?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const profile = summary.data;
  const name = profile?.displayName || author.displayName || author.credit;
  const username = profile?.username ?? author.username;
  const avatar = profile?.avatarUrl || author.avatarUrl;
  const spicyUrl = /^spicy:\d{5,30}$/.test(author.id) ? `https://spicylyrics.org/uid/${author.id.slice(6)}` : undefined;

  return <div ref={rootRef} className="lyrics-author" onMouseEnter={openSoon} onMouseLeave={closeSoon} onFocusCapture={openSoon} onBlurCapture={handleBlur}>
    <button type="button" className="lyrics-author-trigger" aria-expanded={open} aria-controls={cardId} onClick={() => { clearTimer(); setOpen(value => !value); }}>
      <Avatar src={author.avatarUrl} name={author.displayName || author.credit} className="lyrics-author-avatar" />
      <span>{label}</span><strong>{author.username ? `@${author.username}` : author.displayName || author.credit}</strong>
    </button>
    {open && <div id={cardId} className="lyrics-author-popover frost-surface" role="group" aria-label={`Автор текста: ${name}`}>
      <div className="lyrics-author-card-head"><Avatar src={avatar} name={name} className="lyrics-author-card-avatar" /><div><strong>{name}</strong>{username && <span>@{username}</span>}</div></div>
      {summary.isPending ? <p className="lyrics-author-status" role="status"><UniqueLoading size="sm" className="morph-loading-compact" label="Открываем профиль"/> Открываем профиль…</p> : summary.isError ?
        <div className="lyrics-author-status" role="alert"><span>Не удалось загрузить профиль.</span><button type="button" onClick={() => void summary.refetch()}>Повторить</button></div> :
        <>{profile?.bio && <p className="lyrics-author-bio">{profile.bio}</p>}<p className="lyrics-author-count"><FileText size={14} /> {profile?.textsCount ?? 0} текстов в Осколке</p></>}
      <div className="lyrics-author-links"><Link to={`/users/${encodeURIComponent(author.id)}`} onClick={()=>setOpen(false)}>Профиль в Осколке</Link>{(spicyUrl||profile?.externalUrl)&&<a href={spicyUrl||profile?.externalUrl} target="_blank" rel="noopener noreferrer">Spicy Lyrics ↗</a>}</div>
    </div>}
  </div>;
}
