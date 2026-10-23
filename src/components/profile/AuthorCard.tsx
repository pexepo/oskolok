import { useTranslation } from '../../stores/useLanguageStore.js';
import { openAuthorCard } from '../../stores/useAuthorCardStore.js';
import type { LyricsAuthor } from '../../types/index.js';

export function AuthorAvatar({src, name, className}: {src?: string; name: string; className: string}) {
  return src
    ? <img className={className} src={src} alt="" loading="lazy" />
    : <span className={className} aria-hidden="true">{name.trim().slice(0, 1).toUpperCase() || '?'}</span>;
}

/**
 * Lyrics author chip. It never navigates: the card opens as an overlay portalled to <body>,
 * so the fullscreen player (and playback) stay exactly where they were.
 */
export function AuthorCard({author,label}: {author: LyricsAuthor;label?:string}) {
  const t=useTranslation(),name=author.displayName||author.credit;
  return <div className="lyrics-author">
    <button type="button" className="lyrics-author-trigger" aria-haspopup="dialog" onClick={()=>openAuthorCard({...author,label})}>
      <AuthorAvatar src={author.avatarUrl} name={name} className="lyrics-author-avatar" />
      <span>{label ?? t('Текст', 'Lyrics')}</span><strong>{author.username ? `@${author.username}` : name}</strong>
    </button>
  </div>;
}
