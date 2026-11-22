# CleanCity Cameroon · Ville Propre Cameroun

Paid Saturday clean-ups in Cameroon's cities. People sign up and are grouped by **region → city → quarter**. Every week a
crew is selected **fairly** (first come, first served; anyone who has just served goes to the back of the queue) to clean one
zone of a city every **Saturday for 4 hours**. A supervisor checks them in (code/QR + GPS) and signs them off, and each worker
is paid by **MTN Mobile Money / Orange Money**.

**Defaults (all admin-configurable):** weekly budget **50,000 FCFA** · pay **5,000 FCFA** per person for a full 4-hour shift ·
**1 zone per week**, rotating across cities and zones → crew = budget ÷ pay = **10 people per week**. Selection never goes over the budget.

> ⚠️ **Demo prototype.** The web demo stores everything in your browser (localStorage). Payouts are **simulated** and no money moves.
> There is no real data, no testimonials and no statistics. The legal and operating plan is in [PLAN.md](PLAN.md). Get it reviewed before launch.

**Live demo:** https://terencengoh.github.io/cleancity-cameroon/ (EN/FR toggle)

## Demo walkthrough
1. **Join / My status:** name, +237 phone (MTN/Orange detected for payout), region (all 10) → city → quarter, Saturday availability, optional ID number, consent. You then see your **place in your city's queue**.
2. **Admin:** tap *Add 25 sample sign-ups (test data)*, then *Schedule next Saturday* and *Run selection / refill*. The budget bar shows budget / committed / paid / fees / remaining.
3. **Join / My status:** use "view as" to pick an invited person and **confirm** or **decline** before the deadline. A decline or a missed deadline (*Demo: deadline passed*) invites the next person in line.
4. **Supervisor:** enter each worker's 6-digit code and check them in with GPS (or *Demo: simulate being at the meeting point*). Sign each worker off as full / partial (pro rata) / absent, add before/after photos, then complete the shift.
5. **Admin → Payouts:** approve to get a simulated MoMo/OM transfer and a receipt in the worker's view.

## Repository layout
| Path | What |
|---|---|
| `index.html`, `app.js`, `logic.js`, `data.js`, `i18n.js`, `styles.css` | Static demo (GitHub Pages) |
| `tests/` | `node --test` tests for the rules (queue, budget, crew, pay, phone) |
| `PLAN.md` | Sourced legal / operating / funding plan |
| `supabase/`, `mobile/`, `admin/` | Production codebase (Supabase backend, Expo app, admin web) |

## Run locally
```bash
python3 -m http.server 8000   # then open http://localhost:8000
node --test tests/*.test.mjs
```

## Security
No secrets in this repo. Payment-provider keys live only in server-side Supabase secrets. The app never asks for a mobile-money PIN.
