/**
 * Turns the shared design tokens (@skj/shared design.ts) into CSS variables, so web and Android use the same
 * colours. Theme choice (system / light / dark) is a per-browser convenience kept in localStorage.
 */
import { chartSeries, palette, radius, type, type ThemeColors } from "@skj/shared";

const kebab = (k: string) => k.replace(/[A-Z0-9]/g, (m) => `-${m.toLowerCase()}`);

function vars(c: ThemeColors, series: readonly string[]): string {
  const lines = Object.entries(c).map(([k, v]) => `--${kebab(k)}:${v};`);
  series.forEach((v, i) => lines.push(`--series-${i + 1}:${v};`));
  return lines.join("");
}

export type ThemePref = "system" | "light" | "dark";
const KEY = "skj.theme";

export function installTheme(): void {
  const css = `
:root{${vars(palette.light, chartSeries.light)}--radius-sm:${radius.sm}px;--radius:${radius.md}px;--radius-lg:${radius.lg}px;
--font:"${type.family}",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color-scheme:light;}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${vars(palette.dark, chartSeries.dark)}color-scheme:dark;}}
:root[data-theme="dark"]{${vars(palette.dark, chartSeries.dark)}color-scheme:dark;}`;
  const el = document.createElement("style");
  el.id = "skj-theme";
  el.textContent = css;
  document.head.prepend(el);
  setTheme(getTheme());
}

export function getTheme(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

export function setTheme(t: ThemePref): void {
  if (t === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
  try {
    if (t === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, t);
  } catch {
    /* storage blocked: choice lasts for this page only */
  }
}
