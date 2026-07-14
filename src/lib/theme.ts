// UI theme selection. A theme is nothing more than a `data-theme` attribute on
// `document.documentElement`; the token overrides live in `src/index.css`.
// Bare `:root` is the Figma-based default palette. `figjam` inherits that
// palette and only changes note-card presentation.
//
// The chosen theme is persisted to `<data>/ui_prefs.json` via the
// `read_ui_prefs` / `write_ui_prefs` Tauri commands (see `tauriInvoke.ts`) so it
// survives the bundle-replacement wipe that would eat WebKit localStorage.

export type ThemeName = "default" | "figjam";

export const THEMES: readonly ThemeName[] = ["default", "figjam"];

export const THEME_LABEL: Record<ThemeName, string> = {
  default: "Default",
  figjam: "FigJam",
};

/** Normalize persisted values without overriding an explicit valid choice.
 * The retired `figma` name is today's Default; missing/invalid preferences
 * use FigJam, which is the default for new installations. */
export function normalizeTheme(value: unknown): ThemeName {
  if (value === "default" || value === "figma") return "default";
  return "figjam";
}

/** Reflect the active theme onto <html>. Default clears the attribute so the
 *  bare Figma-based `:root` token set applies untouched. */
export function applyTheme(theme: ThemeName): void {
  const el = document.documentElement;
  if (theme === "figjam") el.setAttribute("data-theme", "figjam");
  else el.removeAttribute("data-theme");
}

/** Next theme in the cycle (Default ↔ FigJam). */
export function nextTheme(theme: ThemeName): ThemeName {
  const idx = THEMES.indexOf(theme);
  return THEMES[(idx + 1) % THEMES.length] ?? "default";
}
