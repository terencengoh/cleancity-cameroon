import AsyncStorage from "@react-native-async-storage/async-storage";
import { getLocales } from "expo-localization";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type Lang = "fr" | "en";

const en = {
  appName: "CleanCity Cameroon",
  tagline: "Paid Saturday clean-ups, city by city.",
  signInTitle: "Sign in with your phone",
  phone: "Mobile number",
  sendCode: "Send code",
  code: "6-digit SMS code",
  verify: "Verify",
  codeSent: "We sent a code by SMS to {phone}.",
  badPhone: "Enter a Cameroon mobile number: +237 6XX XXX XXX",
  notConfigured: "Supabase is not configured. Copy mobile/.env.example to mobile/.env and fill it in.",
  joinTitle: "Join the Saturday crews",
  fullName: "Full name",
  region: "Region",
  city: "City",
  quarter: "Quarter / neighbourhood",
  saturdays: "I am usually available on Saturday mornings",
  idNumber: "ID card number (optional, checked at your first shift)",
  consent: "I agree to the processing of my data to organise the clean-ups and pay me (Law No. 2024/017).",
  privacy: "Privacy notice",
  join: "Sign up",
  operatorMtn: "MTN Mobile Money: your pay will be sent here",
  operatorOrange: "Orange Money: your pay will be sent here",
  operatorUnknown: "Use an MTN or Orange number so we can pay you",
  queueTitle: "Your place in the {city} queue",
  queueOf: "of {n}",
  queueHelp: "First come, first served. After you serve (or miss a Saturday you confirmed), you go to the back so everyone gets a turn.",
  notInQueue: "You are not in the queue (already selected this week, or not available on Saturdays).",
  invitation: "You are selected!",
  confirmBy: "Confirm before {t}",
  confirm: "I'll be there",
  decline: "I can't make it",
  confirmed: "You're on the crew",
  meet: "Meeting point",
  openMap: "Open in maps",
  showQr: "Show this QR code (or the 6-digit code) to your supervisor at check-in.",
  bring: "Wear closed shoes. Gloves, a mask and a vest are provided. Bring water.",
  pay: "Pay: {pay} for the full {h} hours, sent to your mobile money after sign-off.",
  receipts: "My payments",
  noReceipts: "No payments yet.",
  ps_awaiting_approval: "Awaiting approval",
  ps_approved: "Approved",
  ps_processing: "Sending…",
  ps_paid: "Paid",
  ps_failed: "Delayed: an admin will retry",
  fee: "Operator fee (paid by CleanCity): {fee}",
  supervisor: "Supervisor",
  myShifts: "My shifts",
  noShifts: "No shifts assigned to you yet.",
  crew: "Crew",
  safety: "Safety briefing done",
  safetyDone: "Safety briefing recorded",
  scan: "Scan QR to check in",
  typeCode: "Or type the worker's 6-digit code",
  checkIn: "Check in",
  gettingGps: "Getting your GPS position…",
  gpsDenied: "Location permission is needed to check workers in at the meeting point.",
  checkedIn: "{name} checked in ({d} m from the meeting point).",
  signOff: "Sign off",
  full: "Present: full shift",
  partial: "Partial",
  absent: "Absent",
  hours: "Hours worked",
  notes: "Notes (optional)",
  photosBefore: "Before photos",
  photosAfter: "After photos",
  addPhoto: "Take photo",
  complete: "Complete shift",
  completed: "Shift completed. Payouts go to an admin for approval.",
  cameraDenied: "Camera permission is needed to scan QR codes.",
  close: "Close",
  st_invited: "invited",
  st_confirmed: "confirmed",
  st_checked_in: "checked in",
  st_signed_off: "signed off",
  st_declined: "declined",
  st_expired: "expired",
  workerView: "My worker profile",
  signOut: "Sign out",
  language: "Français",
  error: "Something went wrong: {msg}",
  refresh: "Refresh",
  privacyText:
    "DRAFT, to be reviewed by a Cameroonian lawyer. We collect your name, phone number, region/city/quarter, Saturday availability and, if you give it, your ID number, to select crews fairly, contact you and pay you by mobile money. At check-in, the supervisor's phone records its GPS position (not yours). Before/after photos show the zone, not people. Your data is not sold. You can ask for access, correction or deletion at any time (Law No. 2024/017 on personal data protection). Payment records are kept as long as the law requires.",
};

type Dict = typeof en;
export type TKey = keyof Dict;

const fr: Dict = {
  appName: "Ville Propre Cameroun",
  tagline: "Nettoyage rémunéré du samedi, ville par ville.",
  signInTitle: "Connexion par téléphone",
  phone: "Numéro mobile",
  sendCode: "Envoyer le code",
  code: "Code SMS à 6 chiffres",
  verify: "Vérifier",
  codeSent: "Code envoyé par SMS au {phone}.",
  badPhone: "Entrez un numéro mobile camerounais : +237 6XX XXX XXX",
  notConfigured: "Supabase n’est pas configuré. Copiez mobile/.env.example vers mobile/.env et remplissez-le.",
  joinTitle: "Rejoindre les équipes du samedi",
  fullName: "Nom complet",
  region: "Région",
  city: "Ville",
  quarter: "Quartier",
  saturdays: "Je suis généralement disponible le samedi matin",
  idNumber: "Numéro de CNI (facultatif, vérifié à votre premier samedi)",
  consent: "J’accepte le traitement de mes données pour organiser les nettoyages et me payer (loi n° 2024/017).",
  privacy: "Confidentialité",
  join: "S’inscrire",
  operatorMtn: "MTN Mobile Money : votre paiement arrivera ici",
  operatorOrange: "Orange Money : votre paiement arrivera ici",
  operatorUnknown: "Utilisez un numéro MTN ou Orange pour être payé",
  queueTitle: "Votre place dans la file de {city}",
  queueOf: "sur {n}",
  queueHelp: "Premier inscrit, premier servi. Après avoir servi (ou manqué un samedi confirmé), vous passez en fin de file pour que chacun ait son tour.",
  notInQueue: "Vous n’êtes pas dans la file (déjà sélectionné cette semaine, ou pas disponible le samedi).",
  invitation: "Vous êtes sélectionné(e) !",
  confirmBy: "Confirmez avant {t}",
  confirm: "Je serai là",
  decline: "Je ne peux pas",
  confirmed: "Vous faites partie de l’équipe",
  meet: "Point de rendez-vous",
  openMap: "Ouvrir la carte",
  showQr: "Montrez ce QR code (ou le code à 6 chiffres) au superviseur au pointage.",
  bring: "Chaussures fermées obligatoires. Gants, masque et gilet fournis. Apportez de l’eau.",
  pay: "Paiement : {pay} pour les {h} heures complètes, envoyé sur votre mobile money après validation.",
  receipts: "Mes paiements",
  noReceipts: "Aucun paiement pour l’instant.",
  ps_awaiting_approval: "En attente de validation",
  ps_approved: "Validé",
  ps_processing: "Envoi en cours…",
  ps_paid: "Payé",
  ps_failed: "Retardé : un administrateur va relancer",
  fee: "Frais opérateur (payés par Ville Propre) : {fee}",
  supervisor: "Superviseur",
  myShifts: "Mes samedis",
  noShifts: "Aucun samedi ne vous est encore attribué.",
  crew: "Équipe",
  safety: "Consignes de sécurité données",
  safetyDone: "Consignes de sécurité enregistrées",
  scan: "Scanner le QR pour pointer",
  typeCode: "Ou saisir le code à 6 chiffres",
  checkIn: "Pointer",
  gettingGps: "Récupération de votre position GPS…",
  gpsDenied: "La localisation est nécessaire pour pointer au point de rendez-vous.",
  checkedIn: "{name} pointé(e) ({d} m du point de rendez-vous).",
  signOff: "Valider",
  full: "Présent : 4 h complètes",
  partial: "Partiel",
  absent: "Absent",
  hours: "Heures travaillées",
  notes: "Notes (facultatif)",
  photosBefore: "Photos avant",
  photosAfter: "Photos après",
  addPhoto: "Prendre une photo",
  complete: "Clôturer le samedi",
  completed: "Samedi clôturé. Les paiements passent à la validation d’un administrateur.",
  cameraDenied: "L’appareil photo est nécessaire pour scanner les QR codes.",
  close: "Fermer",
  st_invited: "invité",
  st_confirmed: "confirmé",
  st_checked_in: "pointé",
  st_signed_off: "validé",
  st_declined: "refusé",
  st_expired: "expiré",
  workerView: "Mon profil travailleur",
  signOut: "Se déconnecter",
  language: "English",
  error: "Une erreur est survenue : {msg}",
  refresh: "Actualiser",
  privacyText:
    "BROUILLON, à relire par un avocat camerounais. Nous collectons votre nom, numéro de téléphone, région/ville/quartier, disponibilité le samedi et, si vous le donnez, votre numéro de CNI, pour sélectionner les équipes équitablement, vous contacter et vous payer par mobile money. Au pointage, le téléphone du superviseur enregistre sa position GPS (pas la vôtre). Les photos avant/après montrent la zone, pas les personnes. Vos données ne sont pas vendues. Vous pouvez demander l’accès, la correction ou la suppression à tout moment (loi n° 2024/017 sur la protection des données personnelles). Les traces de paiement sont conservées aussi longtemps que la loi l’exige.",
};

const DICTS: Record<Lang, Dict> = { en, fr };

export function translate(lang: Lang, key: TKey, vars?: Record<string, string | number>): string {
  let s = DICTS[lang][key] ?? en[key] ?? String(key);
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

interface I18nValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: TKey, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nValue | null>(null);
const STORAGE_KEY = "cleancity.lang";

export function I18nProvider({ children }: { children: ReactNode }) {
  const deviceLang: Lang = getLocales()[0]?.languageCode === "en" ? "en" : "fr";
  const [lang, setLangState] = useState<Lang>(deviceLang);
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((v) => {
      if (v === "fr" || v === "en") setLangState(v);
    });
  }, []);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    AsyncStorage.setItem(STORAGE_KEY, l);
  }, []);
  const value = useMemo<I18nValue>(() => ({ lang, setLang, t: (k, v) => translate(lang, k, v) }), [lang, setLang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  return ctx;
}
