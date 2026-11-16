/**
 * The theme lives in the `qp_theme` cookie and shows as a `light` / `dark` class (plus `color-scheme`) on <html>.
 * The server never reads the cookie for it: that would make every page render per request (ADR-058). Instead
 * `THEME_SCRIPT` runs in <head> before the first paint, and these helpers do the same job after hydration.
 */
export type Theme = "light" | "dark";

export const THEME_COOKIE = "qp_theme";

/** Inline, blocking, in <head>: sets the class and `color-scheme` from the cookie before anything is painted. */
export const THEME_SCRIPT = `(function(){try{var d=document.documentElement,t=/(?:^|; )${THEME_COOKIE}=dark(?:;|$)/.test(document.cookie)?"dark":"light";d.classList.remove("light","dark");d.classList.add(t);d.style.colorScheme=t}catch(e){}})()`;

/** Browser only: the theme the cookie asks for (light when there is none). */
export function readTheme(): Theme {
  return new RegExp(`(?:^|; )${THEME_COOKIE}=dark(?:;|$)`).test(document.cookie) ? "dark" : "light";
}

/** Browser only: put the theme on <html>. */
export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(theme);
  root.style.colorScheme = theme;
}

/** Browser only: remember the choice for a year and show it now. */
export function saveTheme(theme: Theme) {
  document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=31536000; samesite=lax`;
  applyTheme(theme);
}
