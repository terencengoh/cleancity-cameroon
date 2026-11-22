// One Saturday shift: safety briefing, QR/code + GPS check-in, sign-off per worker, before/after photos, completion.
import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, Image, Modal, Text, View } from "react-native";
import { Button, Card, Chip, Field, H1, Muted, Row, Screen } from "../../components/ui";
import { dateTime, fcfa, time } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import { supabase } from "../../lib/supabase";
import { colors } from "../../lib/theme";
import type { Assignment, Shift } from "../../lib/types";

type Outcome = "full" | "partial" | "absent";
interface Photo { id: string; kind: "before" | "after"; storage_path: string; url?: string }

async function currentPosition(): Promise<{ lat: number; lng: number }> {
  const perm = await Location.requestForegroundPermissionsAsync();
  if (!perm.granted) throw new Error("gps");
  const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  return { lat: p.coords.latitude, lng: p.coords.longitude };
}

export default function ShiftScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, lang } = useI18n();
  const [shift, setShift] = useState<Shift | null>(null);
  const [crew, setCrew] = useState<Assignment[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [pay, setPay] = useState<{ pay_per_person_xaf: number; shift_hours: number; partial_round_xaf: number } | null>(null);
  const [code, setCode] = useState("");
  const [scanning, setScanning] = useState(false);
  const [cam, requestCam] = useCameraPermissions();
  const [signing, setSigning] = useState<Assignment | null>(null);
  const [outcome, setOutcome] = useState<Outcome>("full");
  const [hours, setHours] = useState("");
  const [notes, setNotes] = useState("");
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [s, a, p, st] = await Promise.all([
      supabase.from("shifts").select("*, zones(*)").eq("id", id).single(),
      supabase.from("assignments").select("*, profiles(full_name, phone)").eq("shift_id", id).not("status", "in", "(declined,expired)").order("invited_at"),
      supabase.from("shift_photos").select("id,kind,storage_path").eq("shift_id", id).order("created_at"),
      supabase.from("settings").select("pay_per_person_xaf,shift_hours,partial_round_xaf").single(),
    ]);
    setShift((s.data as Shift) ?? null);
    setCrew((a.data as Assignment[]) ?? []);
    setPay(st.data ?? null);
    const ph = (p.data as Photo[]) ?? [];
    const signed = ph.length ? await supabase.storage.from("shift-photos").createSignedUrls(ph.map((x) => x.storage_path), 3600) : { data: [] };
    setPhotos(ph.map((x, i) => ({ ...x, url: signed.data?.[i]?.signedUrl ?? undefined })));
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const fail = (e: unknown) => setMsg({ text: e instanceof Error && e.message === "gps" ? t("gpsDenied") : t("error", { msg: e instanceof Error ? e.message : String(e) }), bad: true });

  const checkIn = async (c: string, method: "qr" | "code") => {
    setBusy(true); setMsg({ text: t("gettingGps") });
    try {
      const pos = await currentPosition();
      const { data, error } = await supabase.rpc("check_in", { p_shift: id, p_code: c.trim(), p_lat: pos.lat, p_lng: pos.lng, p_method: method });
      if (error) throw new Error(error.message);
      const a = data as Assignment;
      const who = crew.find((x) => x.id === a.id)?.profiles?.full_name ?? "";
      setMsg({ text: t("checkedIn", { name: who, d: a.checkin_dist_m ?? 0 }) });
      setCode("");
      await load();
    } catch (e) { fail(e); } finally { setBusy(false); }
  };

  const onScan = ({ data }: { data: string }) => {
    setScanning(false);
    try {
      const v = JSON.parse(data) as { s?: string; c?: string };
      if (v.s !== id || !v.c) throw new Error("This QR code is for another shift.");
      checkIn(v.c, "qr");
    } catch (e) { fail(e); }
  };

  const preview = (): number => {
    if (!pay) return 0;
    if (outcome === "full") return pay.pay_per_person_xaf;
    if (outcome === "absent") return 0;
    const h = Math.max(0, Math.min(pay.shift_hours, Number(hours) || 0));
    return Math.floor((pay.pay_per_person_xaf * h) / pay.shift_hours / pay.partial_round_xaf) * pay.partial_round_xaf;
  };

  const doSignOff = async () => {
    if (!signing) return;
    setBusy(true);
    const { error } = await supabase.rpc("sign_off", { p_assignment: signing.id, p_outcome: outcome, p_hours: outcome === "partial" ? Number(hours) || 0 : null, p_notes: notes || null });
    setBusy(false);
    if (error) return Alert.alert(t("error", { msg: error.message }));
    setSigning(null); setNotes(""); setHours(""); setOutcome("full");
    load();
  };

  const addPhoto = async (kind: "before" | "after") => {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) throw new Error(t("cameraDenied"));
      const shot = await ImagePicker.launchCameraAsync({ quality: 0.5, allowsEditing: false, exif: false });
      if (shot.canceled || !shot.assets[0]) return;
      setBusy(true);
      const pos = await currentPosition().catch(() => null);
      const path = `shifts/${id}/${kind}-${Date.now()}.jpg`;
      const body = await (await fetch(shot.assets[0].uri)).arrayBuffer();
      const up = await supabase.storage.from("shift-photos").upload(path, body, { contentType: "image/jpeg", upsert: false });
      if (up.error) throw new Error(up.error.message);
      const { error } = await supabase.rpc("add_shift_photo", { p_shift: id, p_kind: kind, p_path: path, p_lat: pos?.lat ?? null, p_lng: pos?.lng ?? null });
      if (error) throw new Error(error.message);
      await load();
    } catch (e) { fail(e); } finally { setBusy(false); }
  };

  const run = async (fn: string, args: Record<string, unknown>, ok?: string) => {
    setBusy(true);
    const { error } = await supabase.rpc(fn, args);
    setBusy(false);
    if (error) return setMsg({ text: t("error", { msg: error.message }), bad: true });
    if (ok) setMsg({ text: ok });
    load();
  };

  if (!shift) return <Screen><Muted>…</Muted></Screen>;
  const z = shift.zones;
  const open = shift.status !== "completed";
  return (
    <Screen>
      <H1>{z?.name}</H1>
      <Text>{dateTime(shift.starts_at, lang)}–{time(shift.ends_at)} · {z?.meet}</Text>
      {open ? (
        <Card>
          {shift.safety_briefing_at ? <Text style={{ color: colors.green }}>✓ {t("safetyDone")}</Text>
            : <Button title={t("safety")} variant="secondary" onPress={() => run("record_safety_briefing", { p_shift: id }, t("safetyDone"))} />}
          <Button title={t("scan")} onPress={async () => { if (!cam?.granted && !(await requestCam()).granted) return fail(new Error(t("cameraDenied"))); setScanning(true); }} disabled={busy} />
          <Field label={t("typeCode")} keyboardType="number-pad" maxLength={6} value={code} onChangeText={setCode} />
          <Button title={t("checkIn")} variant="secondary" onPress={() => checkIn(code, "code")} disabled={busy || code.length !== 6} />
          {msg ? <Text style={{ color: msg.bad ? colors.red : colors.green }}>{msg.text}</Text> : null}
        </Card>
      ) : <Text style={{ color: colors.green }}>{t("completed")}</Text>}

      <H1>{t("crew")} ({crew.length}/{shift.crew_size})</H1>
      {crew.map((a) => (
        <Card key={a.id}>
          <Row style={{ justifyContent: "space-between" }}>
            <Text style={{ fontWeight: "700", flex: 1 }}>{a.profiles?.full_name}</Text>
            <Text>{t(`st_${a.status}`)}</Text>
          </Row>
          <Muted>+{a.profiles?.phone}{a.checkin_at ? ` · ${time(a.checkin_at)} · ${a.checkin_dist_m} m` : ""}</Muted>
          {a.status === "signed_off" ? <Text>{t(a.outcome ?? "absent")} · {fcfa(a.pay_xaf)}{a.notes ? ` · ${a.notes}` : ""}</Text> : null}
          {open && (a.status === "checked_in" || a.status === "confirmed") ? (
            <Button title={t("signOff")} variant="secondary" onPress={() => { setSigning(a); setOutcome(a.status === "checked_in" ? "full" : "absent"); }} />
          ) : null}
        </Card>
      ))}

      <H1>{t("photosBefore")}</H1>
      <Row style={{ flexWrap: "wrap" }}>{photos.filter((p) => p.kind === "before").map((p) => p.url ? <Image key={p.id} source={{ uri: p.url }} style={{ width: 100, height: 75, borderRadius: 8 }} /> : null)}</Row>
      {open ? <Button title={`${t("addPhoto")} · ${t("photosBefore")}`} variant="secondary" onPress={() => addPhoto("before")} disabled={busy} /> : null}
      <H1>{t("photosAfter")}</H1>
      <Row style={{ flexWrap: "wrap" }}>{photos.filter((p) => p.kind === "after").map((p) => p.url ? <Image key={p.id} source={{ uri: p.url }} style={{ width: 100, height: 75, borderRadius: 8 }} /> : null)}</Row>
      {open ? <Button title={`${t("addPhoto")} · ${t("photosAfter")}`} variant="secondary" onPress={() => addPhoto("after")} disabled={busy} /> : null}
      {open ? <Button title={t("complete")} onPress={() => run("complete_shift", { p_shift: id }, t("completed"))} disabled={busy} /> : null}

      <Modal visible={scanning} animationType="slide" onRequestClose={() => setScanning(false)}>
        <View style={{ flex: 1, backgroundColor: "#000" }}>
          <CameraView style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={scanning ? onScan : undefined} />
          <Button title={t("close")} variant="secondary" onPress={() => setScanning(false)} />
        </View>
      </Modal>

      <Modal visible={!!signing} transparent animationType="fade" onRequestClose={() => setSigning(null)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,.4)", justifyContent: "center", padding: 16 }}>
          <Card>
            <H1>{t("signOff")}: {signing?.profiles?.full_name}</H1>
            <Row style={{ flexWrap: "wrap" }}>
              {(signing?.status === "checked_in" ? (["full", "partial", "absent"] as Outcome[]) : (["absent"] as Outcome[])).map((o) =>
                <Chip key={o} label={t(o)} selected={outcome === o} onPress={() => setOutcome(o)} />)}
            </Row>
            {outcome === "partial" ? <Field label={t("hours")} keyboardType="decimal-pad" value={hours} onChangeText={setHours} /> : null}
            <Field label={t("notes")} value={notes} onChangeText={setNotes} maxLength={500} />
            <Text style={{ fontWeight: "800", fontSize: 18 }}>{fcfa(preview())}</Text>
            <Button title={t("signOff")} onPress={doSignOff} loading={busy} />
            <Button title={t("close")} variant="secondary" onPress={() => setSigning(null)} />
          </Card>
        </View>
      </Modal>
    </Screen>
  );
}
