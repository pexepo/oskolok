export const UPLOAD_RULES = {
  audio: { extensions: ['mp3', 'm4a', 'aac', 'ogg', 'opus', 'wav', 'flac'], max: 50 * 1024 * 1024 },
  lyrics: { extensions: ['ttml', 'lrc', 'json'], max: 1024 * 1024 },
  attachment: { extensions: ['png', 'jpg', 'jpeg', 'webp', 'txt', 'log', 'json', 'lrc', 'ttml'], max: 8 * 1024 * 1024 },
};
export type UploadKind = keyof typeof UPLOAD_RULES;
export function validateUpload(file: {name: string; size: number}, kind: UploadKind, language: 'ru' | 'en' = 'ru') {
  const rule = UPLOAD_RULES[kind];
  if (!rule.extensions.includes(file.name.split('.').pop()?.toLowerCase() || '')) throw new Error(`${language === 'en' ? 'Supported formats' : 'Поддерживаются'}: ${rule.extensions.join(', ')}`);
  if (!Number.isFinite(file.size) || file.size <= 0) throw new Error(language === 'en' ? 'File is empty' : 'Файл пуст');
  if (file.size > rule.max) throw new Error(`${language === 'en' ? 'Maximum size' : 'Максимальный размер'}: ${rule.max / 1024 / 1024} ${language === 'en' ? 'MB' : 'МБ'}`);
}
