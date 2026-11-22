export type Role = "worker" | "supervisor" | "admin";
export interface Profile {
  id: string; full_name: string; phone: string; operator: "mtn" | "orange" | null; role: Role;
  region_id: string; city_id: string; quarter: string; saturdays: boolean; locale: "fr" | "en"; served_count: number;
}
export interface Region { id: string; name_en: string; name_fr: string }
export interface City { id: string; region_id: string; name: string; quarters: string[] }
export interface Zone { id: string; name: string; meet: string; lat: number; lng: number }
export interface Shift { id: string; week: string; starts_at: string; ends_at: string; crew_size: number; status: string; supervisor_id: string | null; safety_briefing_at: string | null; zone_id: string; zones?: Zone | null }
export interface Assignment {
  id: string; shift_id: string; person_id: string; status: "invited" | "confirmed" | "declined" | "expired" | "checked_in" | "signed_off";
  confirm_by: string; code: string; checkin_at: string | null; checkin_dist_m: number | null; outcome: "full" | "partial" | "absent" | null;
  hours: number | null; pay_xaf: number | null; notes: string | null; shifts?: Shift | null; profiles?: { full_name: string; phone: string } | null;
}
export interface Payout { id: string; amount_xaf: number; fee_xaf: number; status: string; operator: string; phone: string; reference: string; provider_ref: string | null; paid_at: string | null; week: string }
