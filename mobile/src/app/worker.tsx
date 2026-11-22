// Worker home: queue position, invitation (confirm/decline before the deadline), QR code for check-in, payments.
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Linking, RefreshControl, ScrollView, Text, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Card, H1, Muted, Row, styles } from "../components/ui";
import { useAuth } from "../lib/auth";
import { dateTime, fcfa, mapsUrl, time } from "../lib/format";
import { useI18n } from "../lib/i18n";
import { supabase } from "../lib/supabase";
import { colors } from "../lib/theme";
import type { Assignment, Payout } from "../lib/types";

interface Queue { city_id: string; pos: number | null; total: number; week: string }

export default function Worker() {
  const { t, lang, setLang } = useI18n();
  const { profile, signOut } = useAuth();
  const [queue, setQueue] = useState<Queue | null>(null);
  const [cityName, setCityName] = useState("");
  const [current, setCurrent] = useState<Assignment | null>(null);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [settings, setSettings] = useState<{ pay_per_person_xaf: number; shift_hours: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!profile) return;
    setErr(null);
    const [q, a, p, s, c] = await Promise.all([
      supabase.rpc("my_queue_position").maybeSingle(),
      supabase.from("assignments").select("*, shifts(*, zones(*))").eq("person_id", profile.id).in("status", ["invited", "confirmed", "checked_in"])
        .order("invited_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("payout_requests").select("*").eq("person_id", profile.id).order("created_at", { ascending: false }).limit(30),
      supabase.from("settings").select("pay_per_person_xaf,shift_hours").single(),
      supabase.from("cities").select("name").eq("id", profile.city_id).single(),
    ]);
    if (q.error || a.error) setErr(t("error", { msg: (q.error ?? a.error)!.message }));
    setQueue((q.data as Queue) ?? null);
    setCurrent((a.data as Assignment) ?? null);
    setPayouts((p.data as Payout[]) ?? []);
    setSettings(s.data ?? null);
    setCityName((c.data as { name: string } | null)?.name ?? "");
  }, [profile, t]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const respond = async (accept: boolean) => {
    if (!current) return;
    setBusy(true);
    const { error } = await supabase.rpc("respond_invite", { p_assignment: current.id, p_accept: accept });
    setBusy(false);
    if (error) setErr(t("error", { msg: error.message }));
    load();
  };

  const sh = current?.shifts;
  const z = sh?.zones;
  return (
    <SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.pad} refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}>
        <Row style={{ justifyContent: "space-between" }}>
          <H1>{t("appName")}</H1>
          <Button title={t("language")} variant="secondary" onPress={() => setLang(lang === "fr" ? "en" : "fr")} />
        </Row>
        <Muted>{profile?.full_name} · {profile?.quarter}, {cityName}</Muted>

        {current && sh && z && current.status === "invited" ? (
          <Card style={{ borderColor: colors.green, borderWidth: 2 }}>
            <H1>{t("invitation")}</H1>
            <Text style={{ fontWeight: "700" }}>{z.name} · {dateTime(sh.starts_at, lang)}–{time(sh.ends_at)}</Text>
            <Text>{t("meet")}: {z.meet}</Text>
            {settings ? <Text>{t("pay", { pay: fcfa(settings.pay_per_person_xaf), h: settings.shift_hours })}</Text> : null}
            <Text style={{ fontWeight: "700", color: colors.red }}>{t("confirmBy", { t: dateTime(current.confirm_by, lang) })}</Text>
            <Button title={t("confirm")} onPress={() => respond(true)} loading={busy} />
            <Button title={t("decline")} variant="danger" onPress={() => respond(false)} disabled={busy} />
          </Card>
        ) : null}

        {current && sh && z && (current.status === "confirmed" || current.status === "checked_in") ? (
          <Card style={{ borderColor: colors.green, borderWidth: 2, alignItems: "center" }}>
            <H1>{t("confirmed")}</H1>
            <Text style={{ fontWeight: "700" }}>{z.name} · {dateTime(sh.starts_at, lang)}–{time(sh.ends_at)}</Text>
            <Text>{t("meet")}: {z.meet}</Text>
            <Button title={t("openMap")} variant="secondary" onPress={() => Linking.openURL(mapsUrl(z.lat, z.lng, z.meet))} />
            <View style={{ padding: 12, backgroundColor: "#fff" }}>
              <QRCode value={JSON.stringify({ s: sh.id, c: current.code })} size={200} />
            </View>
            <Text style={{ fontSize: 36, fontWeight: "800", letterSpacing: 8, fontVariant: ["tabular-nums"] }}>{current.code}</Text>
            <Muted>{t("showQr")}</Muted>
            <Muted>{t("bring")}</Muted>
            <Text>{t(`st_${current.status}`)}</Text>
          </Card>
        ) : null}

        {!current ? (
          <Card>
            {queue?.pos ? (
              <>
                <Text>{t("queueTitle", { city: cityName })}</Text>
                <Row><Text style={{ fontSize: 40, fontWeight: "800", color: colors.green }}>#{queue.pos}</Text><Text>{t("queueOf", { n: queue.total })}</Text></Row>
              </>
            ) : <Text>{t("notInQueue")}</Text>}
            <Muted>{t("queueHelp")}</Muted>
          </Card>
        ) : null}

        <Card>
          <H1>{t("receipts")}</H1>
          {payouts.length ? payouts.map((p) => (
            <View key={p.id} style={{ borderTopWidth: 1, borderColor: colors.line, paddingTop: 6 }}>
              <Row style={{ justifyContent: "space-between" }}><Text style={{ fontWeight: "700" }}>{fcfa(p.amount_xaf)}</Text><Text>{t(`ps_${p.status}` as never)}</Text></Row>
              <Muted>{p.week} · +{p.phone} ({p.operator === "mtn" ? "MTN MoMo" : "Orange Money"}){p.paid_at ? ` · ${dateTime(p.paid_at, lang)}` : ""}</Muted>
              {p.status === "paid" ? <Muted>{p.provider_ref ?? p.reference} · {t("fee", { fee: fcfa(p.fee_xaf) })}</Muted> : null}
            </View>
          )) : <Muted>{t("noReceipts")}</Muted>}
        </Card>
        {err ? <Text style={{ color: colors.red }}>{err}</Text> : null}
        <Button title={t("privacy")} variant="secondary" onPress={() => router.push("/legal/privacy")} />
        <Button title={t("signOut")} variant="secondary" onPress={async () => { await signOut(); router.replace("/sign-in"); }} />
      </ScrollView>
    </SafeAreaView>
  );
}
