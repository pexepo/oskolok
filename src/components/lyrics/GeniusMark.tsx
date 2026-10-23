/** Monochrome Genius glyph: takes the surrounding text colour so it never fights the cover palette. */
export function GeniusMark({size=14}:{size?:number}){
  return <svg className="genius-glyph" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><rect x="1" y="1" width="22" height="22" rx="6" fill="none" stroke="currentColor" strokeWidth="1.6" opacity=".7"/><path d="M15.6 6.2c-.9 1.6-2.3 2.5-4.2 2.5-1 0-1.9-.3-2.6-.8.2 1.9 1.5 3.3 3.2 3.3.9 0 1.6-.3 2.2-.9.1 2.9-1.6 5.6-4.6 6.5 4.5.4 7.6-2.8 7.6-6.7 0-1.6-.6-2.9-1.6-3.9Z" fill="currentColor"/></svg>;
}

/** Closing corner of an annotated fragment (⌟): the fragment opens with the Genius mark and ends here. */
export function CornerMark({size=12}:{size?:number}){
  return <svg className="genius-corner" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19h14V5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}
