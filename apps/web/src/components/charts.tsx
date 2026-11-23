/**
 * Lightweight SVG charts (no chart library). Geometry comes from @skj/shared so the Android charts match.
 * Rules followed: one y-axis, thin marks with rounded data ends, 2px gaps between bars, recessive grid,
 * hover tooltip on every mark, a legend whenever there are 2+ series, and a data table for screen readers.
 */
import { layoutColumns, layoutLine, niceTicks } from "@skj/shared";
import { motion } from "framer-motion";
import { useCallback, useRef, useState, type ReactNode } from "react";

export interface Series { name: string; values: number[] }
const color = (i: number) => `var(--series-${i + 1})`;

function useWidth(initial = 640) {
  const ro = useRef<ResizeObserver | null>(null);
  const [w, setW] = useState(initial);
  // Stable callback ref: one observer per mounted chart, disconnected on unmount.
  const ref = useCallback((el: HTMLDivElement | null) => {
    ro.current?.disconnect();
    ro.current = null;
    if (!el) return;
    ro.current = new ResizeObserver(([e]) => setW(Math.max(260, Math.round(e.contentRect.width))));
    ro.current.observe(el);
  }, []);
  return { ref, w };
}

function Legend({ series }: { series: Series[] }) {
  if (series.length < 2) return null;
  return (
    <div className="legend" aria-hidden="true">
      {series.map((s, i) => <span key={s.name}><i style={{ background: color(i) }} />{s.name}</span>)}
    </div>
  );
}

function DataTable({ labels, series, format, caption }: { labels: string[]; series: Series[]; format: (n: number) => string; caption: string }) {
  return (
    <details className="data-table">
      <summary>Show data as a table</summary>
      <div className="table-wrap">
        <table>
          <caption className="sr-only">{caption}</caption>
          <thead><tr><th />{series.map((s) => <th key={s.name} className="num">{s.name}</th>)}</tr></thead>
          <tbody>
            {labels.map((l, i) => (
              <tr key={l}><td>{l}</td>{series.map((s) => <td key={s.name} className="num">{format(s.values[i] ?? 0)}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function Tip({ x, y, title, rows }: { x: number; y: number; title: string; rows: [string, string, number][] }) {
  return (
    <div className="tooltip" style={{ left: x, top: y }}>
      <div className="t-title">{title}</div>
      {rows.map(([name, value, i]) => <div key={name}><i style={{ background: color(i) }} />{name}: <strong>{value}</strong></div>)}
    </div>
  );
}

/** Grouped columns, e.g. pipeline created vs won per month. */
export function ColumnChart({ labels, series, format, height = 220, caption }: {
  labels: string[]; series: Series[]; format: (n: number) => string; height?: number; caption: string;
}) {
  const { ref, w } = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const left = 56, bottom = 24, top = 8;
  const pw = w - left - 4, ph = height - bottom - top;
  const data = labels.map((label, i) => ({ label, values: series.map((s) => s.values[i] ?? 0) }));
  const { bars, ticks, y, band } = layoutColumns(data, pw, ph);
  const every = Math.ceil(labels.length / Math.max(1, Math.floor(pw / 56)));
  return (
    <div className="chart-box" ref={ref}>
      <Legend series={series} />
      <svg className="chart" viewBox={`0 0 ${w} ${height}`} role="img" aria-label={caption} onMouseLeave={() => setHover(null)}>
        <g transform={`translate(${left},${top})`}>
          {ticks.map((t) => (
            <g key={t}>
              <line className={t === 0 ? "zero-line" : "grid-line"} x1={0} x2={pw} y1={y(t)} y2={y(t)} />
              <text className="axis" x={-8} y={y(t)} dy="0.32em" textAnchor="end">{format(t)}</text>
            </g>
          ))}
          {hover !== null && <rect className="hover-band" x={hover * band} y={0} width={band} height={ph} rx={4} />}
          {bars.map((group, i) => group.map((b) => (
            <motion.path key={`${i}-${b.series}`} fill={color(b.series)}
              d={roundedTop(b.x, b.y, b.w, b.h, Math.min(4, b.w / 2))}
              initial={{ opacity: 0, scaleY: 0 }} animate={{ opacity: 1, scaleY: 1 }} style={{ originY: 1, transformBox: "fill-box" }}
              transition={{ delay: i * 0.025, duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }} />
          )))}
          {labels.map((l, i) => i % every === 0 && (
            <text key={l} className="axis" x={i * band + band / 2} y={ph + 16} textAnchor="middle">{l}</text>
          ))}
          {labels.map((l, i) => (
            <rect key={l} className="hit" x={i * band} y={0} width={band} height={ph} onMouseEnter={() => setHover(i)} />
          ))}
        </g>
      </svg>
      {hover !== null && (
        <Tip x={left + hover * band + band / 2} y={top + Math.min(...bars[hover].map((b) => b.y))} title={labels[hover]}
          rows={series.map((s, i) => [s.name, format(s.values[hover] ?? 0), i])} />
      )}
      <DataTable labels={labels} series={series} format={format} caption={caption} />
    </div>
  );
}

/** One line over years; area below/above zero shows the payback crossing (cumulative cash). */
export function LineChart({ labels, series, format, height = 220, caption, zeroLabel }: {
  labels: string[]; series: Series; format: (n: number) => string; height?: number; caption: string; zeroLabel?: ReactNode;
}) {
  const { ref, w } = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const left = 60, bottom = 24, top = 10;
  const pw = w - left - 8, ph = height - bottom - top;
  const { points, path, y, zeroY, min, max } = layoutLine(series.values, pw, ph);
  const absTicks = niceTicks(Math.max(Math.abs(min), Math.abs(max)), 3);
  const ticks = [...absTicks.filter((t) => -t >= min && t > 0).map((t) => -t).reverse(), ...absTicks.filter((t) => t <= max || t === 0)];
  const step = points.length > 1 ? points[1].x - points[0].x : pw;
  const every = Math.ceil(labels.length / Math.max(1, Math.floor(pw / 44)));
  const area = `${path}L${points[points.length - 1]?.x ?? 0},${zeroY}L0,${zeroY}Z`;
  return (
    <div className="chart-box" ref={ref}>
      <svg className="chart" viewBox={`0 0 ${w} ${height}`} role="img" aria-label={caption} onMouseLeave={() => setHover(null)}>
        <g transform={`translate(${left},${top})`}>
          {ticks.map((t) => (
            <g key={t}>
              <line className={t === 0 ? "zero-line" : "grid-line"} x1={0} x2={pw} y1={y(t)} y2={y(t)} />
              <text className="axis" x={-8} y={y(t)} dy="0.32em" textAnchor="end">{format(t)}</text>
            </g>
          ))}
          <path d={area} fill={color(0)} opacity={0.12} />
          <motion.path d={path} fill="none" stroke={color(0)} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
            initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.7, ease: [0.2, 0.8, 0.2, 1] }} />
          {hover !== null && points[hover] && (
            <>
              <line className="grid-line" x1={points[hover].x} x2={points[hover].x} y1={0} y2={ph} />
              <circle cx={points[hover].x} cy={points[hover].y} r={5} fill={color(0)} stroke="var(--surface)" strokeWidth={2} />
            </>
          )}
          {labels.map((l, i) => i % every === 0 && (
            <text key={l} className="axis" x={points[i]?.x ?? 0} y={ph + 16} textAnchor="middle">{l}</text>
          ))}
          {points.map((p) => (
            <rect key={p.index} className="hit" x={p.x - step / 2} y={0} width={step} height={ph} onMouseEnter={() => setHover(p.index)} />
          ))}
        </g>
      </svg>
      {zeroLabel && <div className="small muted">{zeroLabel}</div>}
      {hover !== null && points[hover] && (
        <Tip x={left + points[hover].x} y={top + points[hover].y} title={labels[hover]} rows={[[series.name, format(series.values[hover]), 0]]} />
      )}
      <DataTable labels={labels} series={[series]} format={format} caption={caption} />
    </div>
  );
}

/** Column with rounded data end, anchored square at the baseline. */
function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  if (h <= 0) return "";
  const rr = Math.min(r, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}
