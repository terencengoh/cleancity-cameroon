import { router } from "expo-router";
import { Text } from "react-native";
import { Button, H1, Screen } from "../../components/ui";
import { useI18n } from "../../lib/i18n";

export default function Privacy() {
  const { t } = useI18n();
  return (
    <Screen>
      <H1>{t("privacy")}</H1>
      <Text style={{ fontSize: 15, lineHeight: 22 }}>{t("privacyText")}</Text>
      <Button title={t("close")} variant="secondary" onPress={() => router.back()} />
    </Screen>
  );
}
