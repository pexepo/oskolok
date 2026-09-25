/** Match edition names as words: Believer must not request a live recording. */
export function hasVersion(text: string, version: string): boolean {
  const words = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return (` ${words(text)} `).includes(` ${words(version)} `);
}
