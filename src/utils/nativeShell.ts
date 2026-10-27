/** The Android (MainActivity) and iOS (WKWebView) shells add «OskolokAndroid/x.y» / «OskolokIOS/x.y» to the User-Agent and a bridge object. */
type NativeShell = { setTheme?: (dark: boolean) => void };
const shell = (): NativeShell | undefined => (window as unknown as { OskolokNative?: NativeShell }).OskolokNative;

export const isNativeApp = () => /\bOskolok(Android|IOS)\//.test(navigator.userAgent);
/** Any installed Oskolok app (Android, iOS or the desktop Electron shell): offline music lives only there, never on the web. */
export const isAppShell = () => typeof window !== 'undefined' && (isNativeApp() || !!(window as unknown as { oskolokDesktop?: unknown; electronAPI?: unknown }).oskolokDesktop || !!(window as unknown as { electronAPI?: unknown }).electronAPI);

/** Status and navigation bar icons: light over dark surfaces (dark theme, Интерференция), dark otherwise. */
export function setNativeBars(dark: boolean): void {
  try { shell()?.setTheme?.(dark); } catch { /* Older shells have no theme bridge. */ }
}

if (typeof document !== 'undefined' && isNativeApp()) document.documentElement.classList.add('is-native-app');
