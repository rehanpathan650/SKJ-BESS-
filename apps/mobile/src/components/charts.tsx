/**
 * Charts for Android (react-native-svg). Geometry comes from @skj/shared, so they match the website:
 * one y-axis, rounded column ends, 2px gaps, recessive grid, legend for 2+ series, tap a column/point to read it.
 */
import { chartSeries, layoutColumns, layoutLine, niceTicks } from "@skj/shared";
import { useState } from "react";
import { Pressable, Text, useColorScheme, View, type LayoutChangeEvent } from "react-native";
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from "react-native-svg";
import { font, useTheme } from "./ui";

export interface Series { name: string; values: number[] }

function useSeriesColors() {
  return chartSeries[useColorScheme() === "dark" ? "dark" : "light"];
}

function Legend({ series }: { series: Series[] }) {
  const t = useTheme();
  const colors = useSeriesColors();
  if (series.length < 2) return null;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 14, marginBottom: 8 }} importantForAccessibility="no-hide-descendants">
      {series.map((s, i) => (
        <View key={s.name} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: colors[i] }} />
          <Text style={[font.regular, { color: t.muted, fontSize: 12.5 }]}>{s.name}</Text>
        </View>
      ))}
    </View>
  );
}

function Readout({ title, rows }: { title: string; rows: [string, string, number][] }) {
  const t = useTheme();
  const colors = useSeriesColors();
  return (
    <View accessibilityLiveRegion="polite" style={{ flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 6, minHeight: 20 }}>
      <Text style={[font.semibold, { color: t.text, fontSize: 13 }]}>{title}</Text>
      {rows.map(([n, v, i]) => (
        <Text key={n} style={[font.regular, { color: t.muted, fontSize: 13 }]}>
          <Text style={{ color: colors[i] }}>■ </Text>{n}: <Text style={[font.semibold, { color: t.text }]}>{v}</Text>
        </Text>
      ))}
    </View>
  );
}

function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  if (h <= 0) return "";
  const rr = Math.min(r, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

export function ColumnChart({ labels, series, format, height = 200, caption }: {
  labels: string[]; series: Series[]; format: (n: number) => string; height?: number; caption: string;
}) {
  const t = useTheme();
  const colors = useSeriesColors();
  const [w, setW] = useState(320);
  const [sel, setSel] = useState<number | null>(null);
  const left = 48, bottom = 20, top = 6;
  const pw = Math.max(100, w - left - 4), ph = height - bottom - top;
  const { bars, ticks, y, band } = layoutColumns(labels.map((label, i) => ({ label, values: series.map((s) => s.values[i] ?? 0) })), pw, ph);
  const every = Math.ceil(labels.length / Math.max(1, Math.floor(pw / 40)));
  const summary = `${caption}. ` + labels.map((l, i) => `${l}: ${series.map((s) => `${s.name} ${format(s.values[i] ?? 0)}`).join(", ")}`).join("; ");
  return (
    <View onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}>
      <Legend series={series} />
      <View accessible accessibilityLabel={summary}>
        <Svg width={w} height={height}>
          <G x={left} y={top}>
            {ticks.map((tk) => (
              <G key={tk}>
                <Line x1={0} x2={pw} y1={y(tk)} y2={y(tk)} stroke={tk === 0 ? t.muted : t.border} strokeWidth={1} />
                <SvgText x={-6} y={y(tk) + 4} fontSize={10.5} fill={t.muted} textAnchor="end">{format(tk)}</SvgText>
              </G>
            ))}
            {sel !== null && <Rect x={sel * band} y={0} width={band} height={ph} rx={4} fill={t.surface2} />}
            {bars.map((g, i) => g.map((b) => (
              <Path key={`${i}-${b.series}`} d={roundedTop(b.x, b.y, b.w, b.h, Math.min(4, b.w / 2))} fill={colors[b.series]} />
            )))}
            {labels.map((l, i) => i % every === 0 && (
              <SvgText key={l + i} x={i * band + band / 2} y={ph + 14} fontSize={10.5} fill={t.muted} textAnchor="middle">{l}</SvgText>
            ))}
          </G>
        </Svg>
        {/* Touch targets over each column group (bigger than the marks) */}
        <View style={{ position: "absolute", left, top, width: pw, height: ph, flexDirection: "row" }}>
          {labels.map((l, i) => (
            <Pressable key={l + i} style={{ width: band, height: ph }} onPress={() => setSel(sel === i ? null : i)}
              accessibilityElementsHidden importantForAccessibility="no" />
          ))}
        </View>
      </View>
      {sel !== null ? <Readout title={labels[sel]} rows={series.map((s, i) => [s.name, format(s.values[sel] ?? 0), i])} />
        : <Text style={[font.regular, { color: t.muted, fontSize: 12, marginTop: 6 }]}>Tap a column to see its values.</Text>}
    </View>
  );
}

export function LineChart({ labels, series, format, height = 200, caption, note }: {
  labels: string[]; series: Series; format: (n: number) => string; height?: number; caption: string; note?: string;
}) {
  const t = useTheme();
  const colors = useSeriesColors();
  const [w, setW] = useState(320);
  const [sel, setSel] = useState<number | null>(null);
  const left = 54, bottom = 20, top = 8;
  const pw = Math.max(100, w - left - 8), ph = height - bottom - top;
  const { points, path, y, zeroY, min, max } = layoutLine(series.values, pw, ph);
  const abs = niceTicks(Math.max(Math.abs(min), Math.abs(max)), 3);
  const ticks = [...abs.filter((x) => -x >= min && x > 0).map((x) => -x).reverse(), ...abs.filter((x) => x <= max || x === 0)];
  const step = points.length > 1 ? points[1].x - points[0].x : pw;
  const every = Math.ceil(labels.length / Math.max(1, Math.floor(pw / 36)));
  const area = `${path}L${points[points.length - 1]?.x ?? 0},${zeroY}L0,${zeroY}Z`;
  return (
    <View onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}>
      <View accessible accessibilityLabel={`${caption}. ${note ?? ""} ` + labels.map((l, i) => `${l}: ${format(series.values[i])}`).join("; ")}>
        <Svg width={w} height={height}>
          <G x={left} y={top}>
            {ticks.map((tk) => (
              <G key={tk}>
                <Line x1={0} x2={pw} y1={y(tk)} y2={y(tk)} stroke={tk === 0 ? t.muted : t.border} strokeWidth={1} />
                <SvgText x={-6} y={y(tk) + 4} fontSize={10.5} fill={t.muted} textAnchor="end">{format(tk)}</SvgText>
              </G>
            ))}
            <Path d={area} fill={colors[0]} opacity={0.12} />
            <Path d={path} fill="none" stroke={colors[0]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {sel !== null && points[sel] && (
              <>
                <Line x1={points[sel].x} x2={points[sel].x} y1={0} y2={ph} stroke={t.border} />
                <Circle cx={points[sel].x} cy={points[sel].y} r={5} fill={colors[0]} stroke={t.surface} strokeWidth={2} />
              </>
            )}
            {labels.map((l, i) => i % every === 0 && (
              <SvgText key={l + i} x={points[i]?.x ?? 0} y={ph + 14} fontSize={10.5} fill={t.muted} textAnchor="middle">{l}</SvgText>
            ))}
          </G>
        </Svg>
        <View style={{ position: "absolute", left: left - step / 2, top, width: pw + step, height: ph, flexDirection: "row" }}>
          {points.map((p) => (
            <Pressable key={p.index} style={{ width: step, height: ph }} onPress={() => setSel(sel === p.index ? null : p.index)}
              accessibilityElementsHidden importantForAccessibility="no" />
          ))}
        </View>
      </View>
      {note && <Text style={[font.regular, { color: t.muted, fontSize: 12.5, marginTop: 4 }]}>{note}</Text>}
      {sel !== null && <Readout title={labels[sel]} rows={[[series.name, format(series.values[sel]), 0]]} />}
    </View>
  );
}
