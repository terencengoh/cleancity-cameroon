// Dynamic Expo config. No secrets: only public Supabase values (EXPO_PUBLIC_*) are bundled.
import type { ExpoConfig } from "expo/config";
// Writes assets/*.png from the committed assets/*.png.b64 before Expo reads them.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { decodeAssets } = require("./scripts/decode-assets.js");
decodeAssets();

const GREEN = "#007a3d";

const config: ExpoConfig = {
  name: "Ville Propre",
  slug: "cleancity-cameroon",
  scheme: "cleancity",
  version: "0.1.0",
  orientation: "portrait",
  userInterfaceStyle: "light",
  icon: "./assets/icon.png",
  android: {
    package: "cm.villepropre.app",
    versionCode: 1,
    adaptiveIcon: { foregroundImage: "./assets/adaptive-icon.png", backgroundColor: GREEN },
    permissions: ["ACCESS_COARSE_LOCATION", "ACCESS_FINE_LOCATION", "CAMERA", "POST_NOTIFICATIONS"],
    blockedPermissions: ["android.permission.RECORD_AUDIO", "android.permission.SYSTEM_ALERT_WINDOW", "android.permission.ACCESS_BACKGROUND_LOCATION"],
  },
  ios: {
    bundleIdentifier: "cm.villepropre.app",
    supportsTablet: false,
  },
  plugins: [
    "expo-router",
    "expo-localization",
    ["expo-splash-screen", { image: "./assets/splash-icon.png", imageWidth: 200, resizeMode: "contain", backgroundColor: "#ffffff" }],
    ["expo-notifications", { icon: "./assets/notification-icon.png", color: GREEN }],
    ["expo-camera", {
      cameraPermission: "Supervisors scan workers' QR codes to check them in and photograph the zone before and after the clean-up. / Les superviseurs scannent les QR codes et photographient la zone avant et après.",
      microphonePermission: false, recordAudioAndroid: false,
    }],
    ["expo-image-picker", {
      photosPermission: "Supervisors attach before/after photos of the cleaned zone. / Photos avant/après de la zone nettoyée.",
      cameraPermission: "Supervisors photograph the zone before and after the clean-up. / Photos avant/après de la zone.",
      microphonePermission: false,
    }],
    ["expo-location", {
      locationWhenInUsePermission: "Used only at check-in to confirm the supervisor is at the meeting point. / Utilisée uniquement au pointage pour confirmer la présence au point de rendez-vous.",
    }],
  ],
  experiments: { typedRoutes: false },
  extra: { eas: { projectId: process.env.EAS_PROJECT_ID } },
};

export default config;
