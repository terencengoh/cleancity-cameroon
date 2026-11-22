// Supervisor console: the shifts assigned to me (admins see all upcoming shifts).
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, Text } from "react-native";
import { Button, Card, H1, Muted, Row, Screen } from "../../components/ui";
import { useAuth } from "../../lib/auth";
import { dateTime, time } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import { supabase } from "../../lib/supabase";
import { colors } from "../../lib/theme";
import type { Shift } from "../../lib/types";

export default function SupervisorHome() {
  const { t, lang, setLang } = useI18n();
  const { profile, signOut } = useAuth();
  const [shifts, setShifts] = useState<Shift[]>([]);

  const load = useCallback(async () => {
    if (!profile) return;
    let q = supabase.from("shifts").select("*, zones(*)").neq("status", "cancelled").gte("ends_at", new Date(Date.now() - 7 * 86400e3).toISOString()).order("starts_at");
    if (profile.role !== "admin") q = q.eq("supervisor_id", profile.id);
    const { data } = await q;
    setShifts((data as Shift[]) ?? []);
  }, [profile]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <Screen>
      <Row style={{ justifyContent: "space-between" }}>
        <H1>{t("myShifts")}</H1>
        <Button title={t("language")} variant="secondary" onPress={() => setLang(lang === "fr" ? "en" : "fr")} />
      </Row>
      <Muted>{t("supervisor")} · {profile?.full_name}</Muted>
      {shifts.length ? shifts.map((s) => (
        <Pressable key={s.id} onPress={() => router.push(`/supervisor/${s.id}`)}>
          <Card>
            <Text style={{ fontWeight: "800", fontSize: 16 }}>{s.zones?.name}</Text>
            <Text>{dateTime(s.starts_at, lang)}–{time(s.ends_at)}</Text>
            <Muted>{s.zones?.meet} · {s.status}</Muted>
          </Card>
        </Pressable>
      )) : <Muted>{t("noShifts")}</Muted>}
      <Button title={t("refresh")} variant="secondary" onPress={load} />
      <Text style={{ color: colors.muted, marginTop: 12 }}>{t("workerView")}</Text>
      <Button title={t("workerView")} variant="secondary" onPress={() => router.push("/worker")} />
      <Button title={t("signOut")} variant="secondary" onPress={async () => { await signOut(); router.replace("/sign-in"); }} />
    </Screen>
  );
}
