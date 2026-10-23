import { NavLink } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { MusicTransfer } from './ImportPage.js';
import { useTranslation } from '../stores/useLanguageStore.js';

/** «Перенести плейлист» from the playlists screen: link or file → preview → a new Осколок playlist. */
export function PlaylistImportPage() {
  const t = useTranslation();
  return <div className="page-crystal playlist-import-page">
    <NavLink to="/playlists" className="text-button playlist-import-back"><ArrowLeft size={16} />{t('Плейлисты', 'Playlists')}</NavLink>
    <header className="playlist-import-head"><span className="eyebrow">{t('Новый плейлист', 'New playlist')}</span><h1>{t('Перенести с другой платформы', 'Transfer from another platform')}</h1>
      <p>{t('Вставьте ссылку или выберите файл: сначала покажем, что получится, — плейлист появится только после подтверждения.', 'Paste a link or pick a file: you see the result first — the playlist is created only after you confirm.')}</p></header>
    <MusicTransfer />
  </div>;
}
