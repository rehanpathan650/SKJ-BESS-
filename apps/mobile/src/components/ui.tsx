import Feather from "@expo/vector-icons/Feather";
import { ApiError, chargeSegments, palette as tokens, radius, toneOf, type ThemeColors, type Tone } from "@skj/shared";
import { useEffect, type ComponentProps, type ReactNode } from "react";
import {
  ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, useColorScheme, useWindowDimensions, View,
  type TextInputProps, type TextStyle, type ViewStyle,
} from "react-native";
import Animated, {
  FadeIn, FadeInDown, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming,
} from "react-native-reanimated";

/** Same colours as the website (from @skj/shared design tokens). */
export const palette = tokens;

export function useTheme(): ThemeColors {
  return palette[useColorScheme() === "dark" ? "dark" : "light"];
}

/** IBM Plex Sans (loaded in the root layout); falls back to the system font if loading failed. */
export const font = {
  regular: { fontFamily: "IBMPlexSans_400Regular" } as TextStyle,
  medium: { fontFamily: "IBMPlexSans_500Medium" } as TextStyle,
  semibold: { fontFamily: "IBMPlexSans_600SemiBold" } as TextStyle,
  bold: { fontFamily: "IBMPlexSans_700Bold" } as TextStyle,
};

export type IconName = ComponentProps<typeof Feather>["name"];
export function Icon({ name, size = 18, color }: { name: IconName; size?: number; color?: string }) {
  const t = useTheme();
  return <Feather name={name} size={size} color={color ?? t.muted} />;
}

/** Tablet layout when the screen is at least 768dp wide. */
export function useIsTablet() {
  return useWindowDimensions().width >= 768;
}

export function errorText(e: unknown): string {
  if (e instanceof ApiError) return e.errors?.length ? e.errors.map((x) => `${x.field}: ${x.message}`).join("\n") : e.message;
  if (e instanceof Error) return e.message;
  return "Something went wrong";
}

export function Screen({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const t = useTheme();
  return <View style={[{ flex: 1, backgroundColor: t.bg }, style]}>{children}</View>;
}

/** Card with a gentle entrance (disabled automatically when Android "Remove animations" is on). */
export function Card({ title, children, right, index = 0 }: { title?: string; children: ReactNode; right?: ReactNode; index?: number }) {
  const t = useTheme();
  return (
    <Animated.View entering={FadeInDown.duration(220).delay(Math.min(index, 6) * 40)}
      style={[s.card, { backgroundColor: t.surface, borderColor: t.border }]}>
      {(title || right) && (
        <View style={[s.rowBetween, { marginBottom: 10 }]}>
          {title ? <Text accessibilityRole="header" style={[s.h2, font.semibold, { color: t.text, marginBottom: 0 }]}>{title}</Text> : <View />}
          {right}
        </View>
      )}
      {children}
    </Animated.View>
  );
}

export function H1({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <Text accessibilityRole="header" style={[s.h1, font.semibold, { color: t.text }]}>{children}</Text>;
}

export function P({ children, muted, small, style }: { children: ReactNode; muted?: boolean; small?: boolean; style?: object }) {
  const t = useTheme();
  return <Text style={[font.regular, { color: muted ? t.muted : t.text, fontSize: small ? 13 : 15, lineHeight: small ? 18 : 21 }, style]}>{children}</Text>;
}

/** Button with press feedback (slight scale) and a 44dp minimum touch target. */
export function Button({ title, onPress, variant = "default", disabled, loading, small, icon }: {
  title: string; onPress: () => void; variant?: "primary" | "default" | "danger"; disabled?: boolean; loading?: boolean;
  small?: boolean; icon?: IconName;
}) {
  const t = useTheme();
  const reduce = useReducedMotion();
  const scale = useSharedValue(1);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const bg = variant === "primary" ? t.brand : t.surface;
  const fg = variant === "primary" ? (t === palette.dark ? "#06150f" : "#fff") : variant === "danger" ? t.danger : t.text;
  return (
    <Animated.View style={anim}>
      <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled: disabled || loading, busy: loading }}
        onPress={onPress} disabled={disabled || loading} hitSlop={small ? 6 : 0}
        onPressIn={() => { if (!reduce) scale.value = withTiming(0.97, { duration: 80 }); }}
        onPressOut={() => { scale.value = withTiming(1, { duration: 120 }); }}
        style={({ pressed }) => [s.btn, small && s.btnSmall, { backgroundColor: bg,
          borderColor: variant === "primary" ? t.brand : variant === "danger" ? t.danger : t.border,
          opacity: disabled ? 0.5 : pressed ? 0.9 : 1 }]}>
        {loading ? <ActivityIndicator color={fg} /> : (
          <View style={[s.row, { gap: 6, flexWrap: "nowrap" }]}>
            {icon && <Feather name={icon} size={small ? 14 : 16} color={fg} />}
            <Text style={[font.semibold, { color: fg, fontSize: small ? 13 : 15 }]}>{title}</Text>
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

export function Input({ label, help, ...props }: TextInputProps & { label: string; help?: string }) {
  const t = useTheme();
  return (
    <View style={{ marginBottom: 12, flexGrow: 1, flexBasis: 150 }}>
      <Text style={[font.medium, { color: t.text, marginBottom: 5, fontSize: 13.5 }]}>{label}</Text>
      <TextInput placeholderTextColor={t.muted} accessibilityLabel={label} {...props}
        style={[s.input, font.regular, { color: t.text, borderColor: t.border, backgroundColor: t.surface },
          props.multiline && { minHeight: 84, textAlignVertical: "top" }]} />
      {help && <Text style={[font.regular, { color: t.muted, fontSize: 12.5, marginTop: 3 }]}>{help}</Text>}
    </View>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  const t = useTheme();
  if (!error) return null;
  return (
    <Animated.Text entering={FadeIn.duration(160)} accessibilityRole="alert" accessibilityLiveRegion="polite"
      style={[s.box, font.regular, { color: t.danger, backgroundColor: t.dangerSoft }]}>{errorText(error)}</Animated.Text>
  );
}

export function Notice({ children, tone = "warn" }: { children: ReactNode; tone?: "warn" | "ok" | "info" }) {
  const t = useTheme();
  const map = { warn: [t.warn, t.warnSoft], ok: [t.ok, t.okSoft], info: [t.info, t.infoSoft] } as const;
  return <Text style={[s.box, font.regular, { color: map[tone][0], backgroundColor: map[tone][1] }]}>{children}</Text>;
}

export function Badge({ label, tone }: { label: string; tone?: Tone }) {
  const t = useTheme();
  const colors: Record<Tone, [string, string]> = {
    ok: [t.ok, t.okSoft], warn: [t.warn, t.warnSoft], danger: [t.danger, t.dangerSoft], brand: [t.brandStrong, t.brandSoft],
    info: [t.info, t.infoSoft], neutral: [t.muted, t.surface2],
  };
  const [fg, bg] = colors[tone ?? "neutral"];
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: bg, paddingHorizontal: 9, paddingVertical: 3,
      borderRadius: radius.pill, alignSelf: "flex-start" }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: fg, opacity: 0.8 }} />
      <Text style={[font.medium, { color: fg, fontSize: 12 }]}>{label.replace(/_/g, " ")}</Text>
    </View>
  );
}

/** Kept for existing screens; same mapping as the website. */
export function statusTone(status: string): Tone {
  return toneOf(status);
}

export function Kpi({ label, value, hint, accent, onPress }: { label: string; value: ReactNode; hint?: string; accent?: "brand" | "charge"; onPress?: () => void }) {
  const t = useTheme();
  const tablet = useIsTablet();
  const body = (
    <>
      <Text style={[font.regular, { color: t.muted, fontSize: 12.5 }]}>{label}</Text>
      <Text style={[font.semibold, { color: t.text, fontSize: 22, marginTop: 2, fontVariant: ["tabular-nums"] }]}>{value}</Text>
      {hint && <Text style={[font.regular, { color: t.muted, fontSize: 12 }]}>{hint}</Text>}
    </>
  );
  const style = [s.kpi, { backgroundColor: t.surface, borderColor: t.border, flexBasis: tablet ? "23%" : "46%" },
    accent && { borderTopWidth: 3, borderTopColor: accent === "brand" ? t.brand : t.charge }] as ViewStyle[];
  return onPress ? (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [...style, pressed && { borderColor: t.brand }]}>{body}</Pressable>
  ) : <View style={style}>{body}</View>;
}

/** Battery state-of-charge meter: the platform's signature element (same as the website). */
export function ChargeMeter({ pct, cells = 10, showPct = true, large }: { pct: number; cells?: number; showPct?: boolean; large?: boolean }) {
  const t = useTheme();
  const lit = chargeSegments(pct, cells);
  const value = Math.round(Math.max(0, Math.min(100, pct || 0)));
  const w = large ? 10 : 6, h = large ? 20 : 12;
  const on = value >= 100 ? t.ok : t.brand;
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel={`${value}% complete`}
      accessibilityValue={{ min: 0, max: 100, now: value }} style={{ flexDirection: "row", alignItems: "center" }}>
      <View style={{ flexDirection: "row", gap: 2, padding: 2, borderWidth: 1.5, borderColor: t.border, borderRadius: 4 }}>
        {Array.from({ length: cells }, (_, i) => (
          <View key={i} style={{ width: w, height: h, borderRadius: 1.5, backgroundColor: i < lit ? on : t.surface2 }} />
        ))}
      </View>
      <View style={{ width: 3, height: h * 0.6, backgroundColor: t.border, borderTopRightRadius: 2, borderBottomRightRadius: 2 }} />
      {showPct && <Text style={[font.regular, { color: t.muted, fontSize: 12.5, marginLeft: 6, minWidth: 34, fontVariant: ["tabular-nums"] }]}>{value}%</Text>}
    </View>
  );
}

export function Row({ label, value }: { label: string; value: ReactNode }) {
  const t = useTheme();
  return (
    <View style={[s.rowBetween, { paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: t.border }]}>
      <Text style={[font.regular, { color: t.muted, flexShrink: 1 }]}>{label}</Text>
      {typeof value === "string" || typeof value === "number" ? (
        <Text style={[font.medium, { color: t.text, textAlign: "right", flexShrink: 1, marginLeft: 12, fontVariant: ["tabular-nums"] }]}>{value}</Text>
      ) : <View style={{ marginLeft: 12, flexShrink: 1 }}>{value}</View>}
    </View>
  );
}

export function ListItem({ title, subtitle, right, onPress, icon }: { title: string; subtitle?: string; right?: ReactNode; onPress?: () => void; icon?: IconName }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole={onPress ? "button" : undefined} accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      style={({ pressed }) => [s.item, { backgroundColor: pressed ? t.brandSoft : t.surface, borderColor: t.border }]}>
      {icon && <Feather name={icon} size={18} color={t.brand} />}
      <View style={{ flex: 1 }}>
        <Text style={[font.semibold, { color: t.text, fontSize: 15 }]}>{title}</Text>
        {subtitle ? <Text style={[font.regular, { color: t.muted, fontSize: 13, marginTop: 2 }]}>{subtitle}</Text> : null}
      </View>
      {right ?? (onPress ? <Feather name="chevron-right" size={18} color={t.muted} /> : null)}
    </Pressable>
  );
}

/** Shimmering placeholder block. */
export function Skeleton({ h = 16, w = "100%", style }: { h?: number; w?: number | `${number}%`; style?: ViewStyle }) {
  const t = useTheme();
  const reduce = useReducedMotion();
  const o = useSharedValue(0.5);
  useEffect(() => {
    if (!reduce) o.value = withRepeat(withTiming(1, { duration: 700 }), -1, true);
  }, [o, reduce]);
  const anim = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={[{ height: h, width: w, borderRadius: 8, backgroundColor: t.surface2 }, anim, style]} />;
}

/** Loading placeholder shaped like a list (no layout jump when data arrives). */
export function Loading({ rows = 4 }: { rows?: number }) {
  return (
    <View accessibilityLabel="Loading" accessibilityRole="progressbar" style={{ padding: 16, gap: 10 }}>
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} h={56} style={{ borderRadius: 12 }} />)}
    </View>
  );
}

export function Empty({ children, icon = "inbox" }: { children: ReactNode; icon?: IconName }) {
  const t = useTheme();
  return (
    <View style={{ alignItems: "center", padding: 24, gap: 8 }}>
      <Feather name={icon} size={26} color={t.border} />
      <Text style={[font.regular, { color: t.muted, textAlign: "center" }]}>{children}</Text>
    </View>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { key: T; label: string }[]; onChange: (v: T) => void }) {
  const t = useTheme();
  return (
    <View accessibilityRole="tablist" style={[s.segment, { borderColor: t.border, backgroundColor: t.surface }]}>
      {options.map((o) => (
        <Pressable key={o.key} onPress={() => onChange(o.key)} accessibilityRole="tab" accessibilityState={{ selected: value === o.key }}
          style={[s.segmentItem, value === o.key && { backgroundColor: t.brandSoft }]}>
          <Text numberOfLines={1} style={[font.semibold, { color: value === o.key ? t.brandStrong : t.muted, fontSize: 13 }]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** Pick one option from a short list (role, department, engineer, filter). */
export function Choice<T extends string>({ label, value, options, onChange, allowNone }: {
  label?: string; value: T | ""; options: { key: T; label: string }[]; onChange: (v: T | "") => void; allowNone?: string;
}) {
  const t = useTheme();
  return (
    <View style={{ marginBottom: 12 }}>
      {label && <Text style={[font.medium, { color: t.text, marginBottom: 6, fontSize: 13.5 }]}>{label}</Text>}
      <View style={s.row}>
        {allowNone && <Button small title={allowNone} variant={value === "" ? "primary" : "default"} onPress={() => onChange("")} />}
        {options.map((o) => (
          <Button key={o.key} small title={o.label} variant={value === o.key ? "primary" : "default"} onPress={() => onChange(o.key)} />
        ))}
      </View>
    </View>
  );
}

/** Native confirmation dialog before irreversible actions. */
export function confirm(title: string, message: string, onYes: () => void, yesLabel = "Yes") {
  Alert.alert(title, message, [{ text: "Cancel", style: "cancel" }, { text: yesLabel, style: "destructive", onPress: onYes }]);
}

export const s = StyleSheet.create({
  h1: { fontSize: 24, marginBottom: 2, letterSpacing: -0.2 },
  h2: { fontSize: 16.5, marginBottom: 8 },
  card: { borderWidth: 1, borderRadius: radius.lg, padding: 16, marginBottom: 12 },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  row: { flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" },
  btn: { borderWidth: 1, borderRadius: 10, paddingVertical: 11, paddingHorizontal: 16, alignItems: "center", justifyContent: "center", minHeight: 46 },
  btnSmall: { paddingVertical: 6, paddingHorizontal: 11, minHeight: 36 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, minHeight: 46 },
  box: { padding: 11, borderRadius: 10, marginBottom: 10, overflow: "hidden" },
  kpi: { borderWidth: 1, borderRadius: radius.lg, padding: 13, flexGrow: 1 },
  kpis: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 12 },
  item: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: radius.lg, padding: 14, marginBottom: 8, gap: 10, minHeight: 56 },
  content: { padding: 16, paddingBottom: 48 },
  segment: { flexDirection: "row", borderWidth: 1, borderRadius: 10, overflow: "hidden", marginBottom: 12 },
  segmentItem: { flex: 1, paddingVertical: 10, paddingHorizontal: 4, alignItems: "center", minHeight: 42, justifyContent: "center" },
});
