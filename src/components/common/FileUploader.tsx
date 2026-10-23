import React from 'react';
import {UploadCloud, CheckCircle2, RefreshCw, FileAudio, FileText} from 'lucide-react';
import {contentApi, type UploadedFile} from '../../api/userContentClient.js';
import {parseLyricsFile} from '../../utils/lyricsParser.js';
import {UPLOAD_RULES, validateUpload, type UploadKind} from '../../utils/uploadValidation.js';
import {useTranslation, useLanguageStore} from '../../stores/useLanguageStore.js';
import type {LyricLine} from '../../types/index.js';
export {UPLOAD_RULES, validateUpload} from '../../utils/uploadValidation.js';
interface Props {
  kind: UploadKind; trackId?: string; disabled?: boolean; preparedOnly?: boolean;
  onUploaded?: (file: UploadedFile) => void;
  onLyrics?: (lines: LyricLine[]) => Promise<void>;
  onBusyChange?: (busy: boolean) => void;
}
export function FileUploader({kind, trackId, disabled = false, preparedOnly = false, onUploaded, onLyrics, onBusyChange}: Props) {
  const t = useTranslation(), language = useLanguageStore(s => s.language);
  const [file, setFile] = React.useState<File>(), [state, setState] = React.useState<'idle'|'uploading'|'done'|'error'>('idle');
  const [error, setError] = React.useState(''), [drag, setDrag] = React.useState(false);
  const input = React.useRef<HTMLInputElement>(null), busy = React.useRef(false), generation = React.useRef(0);
  React.useEffect(() => {
    ++generation.current; setFile(undefined); setState('idle'); setError('');
    return () => { ++generation.current; };
  }, [trackId, kind]);
  const upload = async (selected?: File) => {
    if (!selected || busy.current || disabled) return;
    const current = generation.current;
    setFile(selected); setError('');
    try {
      validateUpload(selected, kind, language);
      if (kind !== 'attachment' && !trackId) throw new Error(t('Сначала выберите трек', 'Choose a track first'));
      busy.current = true; onBusyChange?.(true); setState('uploading');
      if (kind === 'lyrics') {
        const lines = parseLyricsFile(await selected.text(), selected.name);
        if (!lines.length) throw new Error(t('В файле нет строк текста', 'No lyrics found in the file'));
        if (current !== generation.current) return;
        if (onLyrics) await onLyrics(lines);
        else await contentApi.save(trackId!, {lines});
      } else {
        const result = await contentApi.upload(selected, kind, trackId);
        if (current !== generation.current) return;
        onUploaded?.(result);
      }
      if (current === generation.current) setState('done');
    } catch (e) {
      if (current === generation.current) { setError(e instanceof Error ? e.message : t('Не удалось сохранить файл', 'Could not save file')); setState('error'); }
    } finally { busy.current = false; onBusyChange?.(false); }
  };
  const locked = disabled || state === 'uploading';
  return <div className={`file-uploader ${drag ? 'is-dragging' : ''}`} onDragOver={e => {e.preventDefault(); if (!locked) setDrag(true);}} onDragLeave={() => setDrag(false)} onDrop={e => {e.preventDefault(); setDrag(false); void upload(e.dataTransfer.files[0]);}} aria-busy={state === 'uploading'}>
    <input ref={input} type="file" hidden disabled={locked} accept={UPLOAD_RULES[kind].extensions.map(x => '.' + x).join(',')} onChange={e => {void upload(e.target.files?.[0]); e.target.value = '';}} />
    {state === 'done' ? <CheckCircle2 size={30}/> : kind === 'audio' ? <FileAudio size={30}/> : <FileText size={30}/>}
    <strong role="status">{state === 'uploading' ? t('Проверяем и сохраняем…', 'Checking and saving…') : state === 'done' ? preparedOnly ? t('Файл подготовлен для отправки', 'File ready to submit') : t('Файл сохранён', 'File saved') : file?.name || t('Перетащите файл сюда', 'Drop a file here')}</strong>
    {file && state === 'done' && <span className="upload-filename">{file.name}</span>}
    <small>{UPLOAD_RULES[kind].extensions.join(' · ').toUpperCase()} · {t('до', 'up to')} {UPLOAD_RULES[kind].max / 1024 / 1024} {t('МБ', 'MB')}</small>
    {state === 'uploading' && <progress aria-label={t('Сохранение файла', 'Saving file')}/>}
    {error && <p role="alert" className="form-error">{error}</p>}
    <div className="upload-actions">
      {state === 'error' && file && <button type="button" className="secondary-button" disabled={locked} onClick={() => void upload(file)}><RefreshCw size={16}/>{t('Повторить', 'Retry')}</button>}
      <button type="button" className="secondary-button" disabled={locked} onClick={() => input.current?.click()}><UploadCloud size={16}/>{t('Выбрать файл', 'Choose file')}</button>
    </div>
  </div>;
}
