import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider, useAuth } from "../lib/auth";
import { I18nProvider } from "../lib/i18n";
import { usePushNotifications } from "../lib/push";

function PushRegistration() {
  const { profile } = useAuth();
  usePushNotifications(profile?.id ?? null);
  return null;
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <I18nProvider>
        <AuthProvider>
          <PushRegistration />
          <StatusBar style="dark" />
          <Stack screenOptions={{ headerShown: false }} />
        </AuthProvider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}
