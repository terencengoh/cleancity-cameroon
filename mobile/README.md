# Ville Propre / CleanCity: mobile app (Expo SDK 58, Expo Router)

One app for workers and supervisors, in French and English.

- **Workers:** SMS sign-in; sign-up (region → city → quarter, Saturday availability, optional ID, consent); queue position; invitation with confirmation deadline (confirm/decline); QR code + 6-digit code for check-in; meeting point in maps; payment history (MTN MoMo / Orange Money).
- **Supervisors:** assigned shifts; safety briefing; **scan the worker's QR** (expo-camera) or type the code, with **phone GPS within the check-in radius** of the meeting point; sign-off per worker (full / partial pro rata / absent, notes, pay preview); before/after photos (private storage); complete the shift.

```bash
cp .env.example .env      # public Supabase URL + anon key only
npm install               # also decodes assets/*.png.b64
npx expo start            # Expo Go for UI; push needs a dev build
eas build -p android --profile preview   # APK for testing (needs an Expo account)
```

The app holds no secrets and never asks for a mobile money PIN. Every action is a Supabase RPC that checks the caller's role (see `../supabase`).
