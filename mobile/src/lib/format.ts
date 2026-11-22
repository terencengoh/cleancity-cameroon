export const fcfa = (n: number | null | undefined) => (n == null ? "—" : `${new Intl.NumberFormat("fr-FR").format(n)} FCFA`);
export const dateTime = (s: string | null | undefined, lang: "fr" | "en") =>
  s ? new Date(s).toLocaleString(lang === "fr" ? "fr-FR" : "en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
export const time = (s: string) => new Date(s).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
export const mapsUrl = (lat: number, lng: number, label: string) => `geo:${lat},${lng}?q=${lat},${lng}(${encodeURIComponent(label)})`;
export const osmUrl = (lat: number, lng: number) => `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;
