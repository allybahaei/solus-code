/**
 * The theme is a class on <html>: .light, .dark, or neither to follow the OS.
 * globals.css does the rest, so the class is the only state to keep in sync.
 */
export type Theme = "system" | "light" | "dark";

const THEME_KEY = "solus.theme";

/** Runs before first paint, so a saved theme never flashes the other one. */
export const THEME_SCRIPT = `try{var t=localStorage.getItem("${THEME_KEY}");if(t==="light"||t==="dark")document.documentElement.classList.add(t)}catch(e){}`;

/** The Mac app's top bars double as its title bar, so the page needs to know. */
export const DESKTOP_SCRIPT = `if(/ Electron\\//.test(navigator.userAgent))document.documentElement.classList.add("desktop")`;

const listeners = new Set<() => void>();

export function subscribeTheme(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function currentTheme(): Theme {
  const { classList } = document.documentElement;
  if (classList.contains("light")) return "light";
  if (classList.contains("dark")) return "dark";
  return "system";
}

export function setTheme(theme: Theme) {
  const { classList } = document.documentElement;
  classList.remove("light", "dark");
  if (theme !== "system") classList.add(theme);
  try {
    if (theme === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, theme);
  } catch {}
  listeners.forEach((l) => l());
}
