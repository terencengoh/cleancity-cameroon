// Sign-up: people are grouped by region -> city -> quarter. The phone number comes from the verified SMS sign-in.
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, Switch, Text, View } from "react-native";
import { Button, Card, Chip, Field, H1, Muted, Row, Screen } from "../components/ui";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { detectOperator, normalizeCmPhone } from "../lib/phone";
import { supabase } from "../lib/supabase";
import { colors } from "../lib/theme";
import type { City, Region } from "../lib/types";

export default function Onboarding() {
  const { t, lang } = useI18n();
  const { session, refreshProfile } = useAuth();
  const [regions, setRegions] = useState<Region[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [name, setName] = useState("");
  const [region, setRegion] = useState<string | null>(null);
  const [city, setCity] = useState<string | null>(null);
  const [quarter, setQuarter] = useState("");
  const [saturdays, setSaturdays] = useState(true);
  const [idNumber, setIdNumber] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    supabase.from("regions").select("*").order("name_fr").then(({ data }) => setRegions((data as Region[]) ?? []));
    supabase.from("cities").select("id,region_id,name,quarters").order("name").then(({ data }) => setCities((data as City[]) ?? []));
  }, []);

  const phone = normalizeCmPhone(session?.user.phone ?? "");
  const op = phone ? detectOperator(phone) : null;
  const cityRow = cities.find((c) => c.id === city);

  const submit = async () => {
    setErr(null);
    if (name.trim().length < 2 || !region || !city || !quarter.trim()) return setErr(t("error", { msg: `${t("fullName")}, ${t("region")}, ${t("city")}, ${t("quarter")}` }));
    setBusy(true);
    const { error } = await supabase.rpc("sign_up", {
      p_full_name: name.trim(), p_region: region, p_city: city, p_quarter: quarter.trim(), p_saturdays: saturdays,
      p_id_number: idNumber.trim() || null, p_consent: consent, p_locale: lang,
    });
    setBusy(false);
    if (error) return setErr(t("error", { msg: error.message }));
    await refreshProfile();
    router.replace("/");
  };

  return (
    <Screen>
      <H1>{t("joinTitle")}</H1>
      <Muted>+{phone} · {op === "mtn" ? t("operatorMtn") : op === "orange" ? t("operatorOrange") : t("operatorUnknown")}</Muted>
      <Field label={t("fullName")} value={name} onChangeText={setName} autoComplete="name" maxLength={80} />
      <Text style={{ fontWeight: "700", color: colors.ink }}>{t("region")}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {regions.map((r) => <Chip key={r.id} label={lang === "fr" ? r.name_fr : r.name_en} selected={region === r.id} onPress={() => { setRegion(r.id); setCity(null); setQuarter(""); }} />)}
      </View>
      {region ? (
        <>
          <Text style={{ fontWeight: "700", color: colors.ink }}>{t("city")}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {cities.filter((c) => c.region_id === region).map((c) => <Chip key={c.id} label={c.name} selected={city === c.id} onPress={() => { setCity(c.id); setQuarter(""); }} />)}
          </View>
        </>
      ) : null}
      {cityRow ? (
        <>
          <Text style={{ fontWeight: "700", color: colors.ink }}>{t("quarter")}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {cityRow.quarters.map((q) => <Chip key={q} label={q} selected={quarter === q} onPress={() => setQuarter(q)} />)}
          </View>
          <Field label={t("quarter")} value={quarter} onChangeText={setQuarter} maxLength={80} />
        </>
      ) : null}
      <Row><Switch value={saturdays} onValueChange={setSaturdays} /><Text style={{ flex: 1 }}>{t("saturdays")}</Text></Row>
      <Field label={t("idNumber")} value={idNumber} onChangeText={setIdNumber} maxLength={30} />
      <Card>
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: consent }} onPress={() => setConsent(!consent)}>
          <Row style={{ alignItems: "flex-start" }}>
            <Text style={{ fontSize: 22, color: colors.green }}>{consent ? "☑" : "☐"}</Text>
            <Text style={{ flex: 1 }}>{t("consent")}</Text>
          </Row>
        </Pressable>
        <Button title={t("privacy")} variant="secondary" onPress={() => router.push("/legal/privacy")} />
      </Card>
      <Button title={t("join")} onPress={submit} loading={busy} disabled={!consent} />
      {err ? <Text style={{ color: colors.red }}>{err}</Text> : null}
    </Screen>
  );
}
