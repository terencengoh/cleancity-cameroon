import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, type TextInputProps, View, type ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, radius } from "../lib/theme";

export function Screen({ children, scroll = true, style }: { children: ReactNode; scroll?: boolean; style?: ViewStyle }) {
  return (
    <SafeAreaView style={[styles.screen, style]} edges={["top", "left", "right"]}>
      <View style={styles.flag}>
        <View style={{ flex: 1, backgroundColor: colors.green }} />
        <View style={{ flex: 1, backgroundColor: colors.red }} />
        <View style={{ flex: 1, backgroundColor: colors.yellow }} />
      </View>
      {scroll ? <ScrollView contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled">{children}</ScrollView> : children}
    </SafeAreaView>
  );
}

export function H1({ children }: { children: ReactNode }) {
  return <Text style={styles.h1}>{children}</Text>;
}

export function Muted({ children }: { children: ReactNode }) {
  return <Text style={styles.muted}>{children}</Text>;
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Button({ title, onPress, variant = "primary", disabled, loading }: {
  title: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  loading?: boolean;
}) {
  const bg = variant === "primary" ? colors.green : variant === "danger" ? "#fde7ea" : "#eef2ef";
  const fg = variant === "primary" ? "#fff" : variant === "danger" ? colors.red : colors.ink;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [styles.btn, { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 }]}
    >
      {loading ? <ActivityIndicator color={fg} /> : <Text style={[styles.btnText, { color: fg }]}>{title}</Text>}
    </Pressable>
  );
}

export function Field(props: TextInputProps & { label: string }) {
  const { label, style, ...rest } = props;
  return (
    <View style={{ marginVertical: 6 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput placeholderTextColor="#98a29c" style={[styles.input, style]} {...rest} />
    </View>
  );
}

export function Chip({ label, selected, onPress, accent }: { label: string; selected?: boolean; onPress: () => void; accent?: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={[styles.chip, selected && styles.chipSel, accent ? { borderBottomWidth: 4, borderBottomColor: accent } : null]}
    >
      <Text style={[styles.chipText, selected && { color: colors.green }]}>{label}</Text>
    </Pressable>
  );
}

export function Row({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[{ flexDirection: "row", alignItems: "center", gap: 8 }, style]}>{children}</View>;
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  flag: { height: 4, flexDirection: "row" },
  pad: { padding: 16, paddingBottom: 48, gap: 10 },
  h1: { fontSize: 22, fontWeight: "800", color: colors.ink, marginVertical: 4 },
  muted: { fontSize: 14, color: colors.muted },
  card: { backgroundColor: colors.card, borderRadius: radius, borderWidth: 1, borderColor: colors.line, padding: 14, gap: 6 },
  btn: { borderRadius: 12, paddingVertical: 13, paddingHorizontal: 16, alignItems: "center", marginTop: 6 },
  btnText: { fontWeight: "700", fontSize: 15 },
  label: { fontSize: 14, fontWeight: "600", color: colors.ink, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 12, fontSize: 16, backgroundColor: "#fff", color: colors.ink },
  chip: { borderWidth: 2, borderColor: colors.line, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: "#fff" },
  chipSel: { borderColor: colors.green, backgroundColor: "#f0faf4" },
  chipText: { fontWeight: "700", color: colors.ink },
});
