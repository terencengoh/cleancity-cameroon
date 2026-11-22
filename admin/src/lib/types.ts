export interface Settings {
  weekly_budget_xaf: number; pay_per_person_xaf: number; zones_per_week: number; shift_start: string; shift_hours: number;
  confirm_hours: number; checkin_radius_m: number; payout_fee_pct: number; fees_in_budget: boolean; partial_round_xaf: number; updated_at: string;
}
export interface Budget { budget: number; committed: number; paid: number; fees: number; used: number; remaining: number; crew_size: number }
export interface Zone { id: string; city_id: string; name: string; meet: string; lat: number; lng: number; rotation: number; active: boolean; last_scheduled: string | null; quarters: string[] }
export interface Shift { id: string; week: string; zone_id: string; city_id: string; starts_at: string; ends_at: string; crew_size: number; supervisor_id: string | null; status: string; zones?: { name: string } | null }
export interface Assignment { id: string; shift_id: string; person_id: string; status: string; outcome: string | null; pay_xaf: number | null }
export interface Profile { id: string; full_name: string; phone: string; operator: string | null; role: string; region_id: string; city_id: string; quarter: string; served_count: number; last_served_at: string | null; suspended: boolean; created_at: string }
export interface Payout { id: string; person_id: string; week: string; amount_xaf: number; phone: string; operator: string; reference: string; status: string; fee_xaf: number; failure_reason: string | null; created_at: string; paid_at: string | null; profiles?: { full_name: string } | null }

/** Same rule as the database crew_size(): floor(budget / zones / (pay [+ fee])). */
export function crewSize(s: Pick<Settings, "weekly_budget_xaf" | "pay_per_person_xaf" | "zones_per_week" | "payout_fee_pct" | "fees_in_budget">): number {
  const unit = s.pay_per_person_xaf + (s.fees_in_budget ? Math.ceil((s.pay_per_person_xaf * s.payout_fee_pct) / 100) : 0);
  if (unit <= 0) return 0;
  return Math.max(0, Math.floor(s.weekly_budget_xaf / Math.max(1, s.zones_per_week) / unit));
}

export function nextSaturday(from = new Date()): string {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
