const RTL_LETTER = /[\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Samaritan}\p{Script=Mandaic}]/u;

/** Base direction by the first letter that has one, as the Unicode bidi algorithm decides it. Punctuation, digits
 * and symbols never count: a curly apostrophe, a dash or an ellipsis must not turn an English line right-to-left
 * (word-timed words are inline blocks, so a wrong direction reverses the order of the words). */
export function isRtlText(text: string): boolean {
  for (const char of text) {
    if (RTL_LETTER.test(char)) return true;
    if (/\p{L}/u.test(char)) return false;
  }
  return false;
}
