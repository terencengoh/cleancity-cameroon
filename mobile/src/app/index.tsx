import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useAuth } from "../lib/auth";

// Routes by state: signed out -> sign-in; no profile -> sign-up; supervisors/admins -> supervisor console; else worker home.
export default function Index() {
  const { session, profile, loading } = useAuth();
  if (loading) return <View style={{ flex: 1, justifyContent: "center" }}><ActivityIndicator /></View>;
  if (!session) return <Redirect href="/sign-in" />;
  if (!profile) return <Redirect href="/onboarding" />;
  if (profile.role === "supervisor" || profile.role === "admin") return <Redirect href="/supervisor" />;
  return <Redirect href="/worker" />;
}
