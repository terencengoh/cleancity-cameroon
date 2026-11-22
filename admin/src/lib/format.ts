export const fcfa = (n: number | null | undefined) =>
  n == null ? "—" : `${new Intl.NumberFormat("fr-FR").format(Number(n))} FCFA`;
export const when = (s: string | null | undefined) => (s ? new Date(s).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "—");
export const short = (id: string | null | undefined) => (id ? id.slice(0, 8) : "—");
export const osm = (lat: number, lng: number) => `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`;
