// Expo push notifications: Android channels, permission, Expo push token -> public.push_tokens,
// and opening the screen named in a notification's data.url when it is tapped.
// Push tokens need a development/production build with an EAS projectId (EAS_PROJECT_ID) and, for
// Android, FCM credentials uploaded to EAS. In Expo Go or on simulators registration is skipped.
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { AndroidImportance } from "expo-notifications";
import { router } from "expo-router";
import { useEffect } from "react";
import { Platform } from "react-native";
import { supabase } from "./supabase";

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

export async function registerForPush(): Promise<string | null> {
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", { name: "Ville Propre", importance: AndroidImportance.DEFAULT });
    await Notifications.setNotificationChannelAsync("urgent", {
      name: "Invitations & reminders", importance: AndroidImportance.HIGH, vibrationPattern: [0, 300, 200, 300], sound: "default",
    });
  }
  if (!Device.isDevice) return null;
  const current = await Notifications.getPermissionsAsync();
  let granted = current.granted;
  if (!granted && current.canAskAgain) granted = (await Notifications.requestPermissionsAsync()).granted;
  if (!granted) return null;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return null;
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  const { error } = await supabase.rpc("register_push_token", { p_token: token, p_platform: Platform.OS });
  if (error) throw new Error(error.message);
  return token;
}

/** Registers once per signed-in user and routes notification taps. */
export function usePushNotifications(userId: string | null) {
  useEffect(() => {
    if (!userId) return;
    registerForPush().catch((e) => console.warn("push registration failed", e));
  }, [userId]);

  useEffect(() => {
    const open = (data: Record<string, unknown> | undefined) => {
      const url = typeof data?.url === "string" ? data.url : null;
      if (url && url.startsWith("/")) router.push(url as never);
    };
    const last = Notifications.getLastNotificationResponse();
    if (last) open(last.notification.request.content.data);
    const sub = Notifications.addNotificationResponseReceivedListener((r) => open(r.notification.request.content.data));
    return () => sub.remove();
  }, []);
}
