/**
 * SKJ design system: the single source of truth for colours, type, spacing and charts.
 * The web app turns these into CSS variables (apps/web/src/theme.ts); the Android app reads them directly.
 *
 * Identity: commercial battery storage. Deep green "ink" chrome, cool grey-green paper, SKJ green as the
 * brand, and amber reserved for charge / attention. The signature element is the battery state-of-charge
 * meter (see chargeSegments) used for progress and pipeline.
 */

export const palette = {
  light: {
    ink: "#0d2a23",          // sidebar / headers
    inkText: "#e8f1ed",
    inkMuted: "#93b0a6",
    bg: "#eef2ef",           // page "paper"
    surface: "#ffffff",
    surface2: "#f4f7f5",
    border: "#d9e1dc",
    text: "#14201b",
    muted: "#56655e",
    brand: "#0f5c4a",
    brandStrong: "#0a4637",
    brandSoft: "#e2efe9",
    charge: "#f0b33c",       // battery charge / attention accent
    chargeSoft: "#fdf1d8",
    ok: "#1d6b3a", okSoft: "#e3f4e8",
    warn: "#7a4f00", warnSoft: "#fff1cf",
    danger: "#b3261e", dangerSoft: "#fbe9e7",
    info: "#1f4e8c", infoSoft: "#e5eef9",
  },
  dark: {
    ink: "#08130f",
    inkText: "#e5ece8",
    inkMuted: "#8aa298",
    bg: "#0d1311",
    surface: "#151d19",
    surface2: "#1b2520",
    border: "#2a3631",
    text: "#e5ece8",
    muted: "#9aa9a2",
    brand: "#3fb594",
    brandStrong: "#6fd6b5",
    brandSoft: "#15302a",
    charge: "#f2c057",
    chargeSoft: "#33280f",
    ok: "#7fd39b", okSoft: "#173023",
    warn: "#f2c66d", warnSoft: "#352a12",
    danger: "#ff8a80", dangerSoft: "#3a1d1b",
    info: "#8db8f2", infoSoft: "#17263a",
  },
} as const;

export type ThemeName = keyof typeof palette;
export type ThemeColors = { [K in keyof typeof palette.light]: string };

/**
 * Chart series colours, validated with the data-viz palette checker (lightness band, chroma,
 * colour-blind separation, contrast) separately for light and dark surfaces. Assign in this order, never cycle.
 */
export const chartSeries = {
  light: ["#0e8a5f", "#2a78d6", "#b87500"],
  dark: ["#1f9a72", "#3987e5", "#c98500"],
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 6, md: 10, lg: 14, pill: 999 } as const;

/** Type scale (px), modular ~1.2. */
export const type = {
  family: "IBM Plex Sans",
  caption: 12, small: 13, body: 14.5, lead: 16, h3: 17, h2: 20, h1: 26, display: 34,
  weight: { regular: "400", medium: "500", semibold: "600", bold: "700" },
} as const;

export const motion = {
  fast: 0.14, base: 0.22, slow: 0.4,
  ease: [0.2, 0.8, 0.2, 1] as [number, number, number, number],
} as const;

/** Battery meter: how many of `count` cells are lit for a 0–100 value (never 0 lit for a non-zero value). */
export function chargeSegments(pct: number, count = 10): number {
  const p = Math.max(0, Math.min(100, pct || 0));
  if (p === 0) return 0;
  return Math.max(1, Math.round((p / 100) * count));
}

/** Status → tone, shared so a badge reads the same on web and Android. */
export type Tone = "ok" | "warn" | "danger" | "info" | "brand" | "neutral";
export const STATUS_TONE: Record<string, Tone> = {
  approved: "ok", accepted: "ok", reviewed: "ok", active: "ok", won: "ok", commissioned: "ok", clean: "ok", success: "ok",
  pending_approval: "warn", needs_review: "warn", pending: "warn", pending_verification: "warn", negotiation: "warn",
  draft: "info", queued: "info", scanning: "info", extracting: "info", lead: "info", site_survey: "info",
  technical_validation: "info", proposal: "brand", sent: "brand", installation: "brand",
  rejected: "danger", declined: "danger", failed: "danger", disabled: "danger", lost: "danger", infected: "danger",
  denied: "danger", failure: "warn", locked: "danger",
};
export const toneOf = (status: string): Tone => STATUS_TONE[status] ?? "neutral";

// ---------- chart geometry (shared by the web SVG charts and the Android react-native-svg charts) ----------

/** "Nice" axis maximum and ticks, e.g. 0, 2.5M, 5M, 7.5M, 10M. */
export function niceTicks(max: number, count = 4): number[] {
  if (!isFinite(max) || max <= 0) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.0001; v += step) ticks.push(+v.toFixed(10));
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

export interface BarDatum { label: string; values: number[] }

/** Lay out grouped columns inside a plot box. Returns rects per datum per series. */
export function layoutColumns(data: BarDatum[], width: number, height: number, opts: { gap?: number; inner?: number } = {}) {
  const series = Math.max(1, ...data.map((d) => d.values.length));
  const ticks = niceTicks(Math.max(0, ...data.flatMap((d) => d.values)));
  const top = ticks[ticks.length - 1] || 1;
  const band = width / Math.max(1, data.length);
  const gap = opts.gap ?? Math.min(18, band * 0.3);
  const inner = opts.inner ?? 2; // 2px surface gap between adjacent bars
  const barW = Math.max(2, (band - gap - inner * (series - 1)) / series);
  const bars = data.map((d, i) => d.values.map((v, s) => {
    const h = (Math.max(0, v) / top) * height;
    return { x: i * band + gap / 2 + s * (barW + inner), y: height - h, w: barW, h, value: v, series: s, label: d.label };
  }));
  return { bars, ticks, top, band, y: (v: number) => height - (v / top) * height };
}

/** Points for a line/area series over evenly spaced x positions; supports negative values (payback curves). */
export function layoutLine(values: number[], width: number, height: number) {
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  const y = (v: number) => height - ((v - min) / span) * height;
  const points = values.map((v, i) => ({ x: i * step, y: y(v), value: v, index: i }));
  return { points, y, zeroY: y(0), min, max, path: points.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join("") };
}
