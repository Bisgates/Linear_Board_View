// UI theme selection. A theme is nothing more than a `data-theme` attribute on
// `document.documentElement`; the token overrides live in `src/index.css`
// (`:root[data-theme="figma"]`). The default (warm-soft) theme uses NO attribute
// so bare `:root` wins and stays pixel-identical to the historical look.
//
// The chosen theme is persisted to `<data>/ui_prefs.json` via the
// `read_ui_prefs` / `write_ui_prefs` Tauri commands (see `tauriInvoke.ts`) so it
// survives the bundle-replacement wipe that would eat WebKit localStorage.

export type ThemeName = "default" | "figma";

export const THEMES: readonly ThemeName[] = ["default", "figma"];

export const THEME_LABEL: Record<ThemeName, string> = {
  default: "Default",
  figma: "Figma",
};

/** Normalize an arbitrary persisted string into a known ThemeName. */
export function normalizeTheme(value: unknown): ThemeName {
  return value === "figma" ? "figma" : "default";
}

/** Reflect the active theme onto <html>. Default clears the attribute so the
 *  bare `:root` token set applies untouched. */
export function applyTheme(theme: ThemeName): void {
  const el = document.documentElement;
  if (theme === "figma") el.setAttribute("data-theme", "figma");
  else el.removeAttribute("data-theme");
}

/** Next theme in the cycle (default ↔ figma). */
export function nextTheme(theme: ThemeName): ThemeName {
  const idx = THEMES.indexOf(theme);
  return THEMES[(idx + 1) % THEMES.length] ?? "default";
}
