// CleanCity Cameroon — demo app (no framework). State lives in localStorage.
(() => {
  "use strict";
  const L = window.CCLogic, D = window.CC_DATA, I = window.CC_I18N;
  const KEY = "cleancity.demo.v1";
  const $ = (s) => document.querySelector(s);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const uid = (p) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

  // ---------- state ----------
  function fresh() {
    return { v: 1, lang: (navigator.language || "fr").startsWith("en") ? "en" : "fr", tab: "join", settings: { ...L.DEFAULT_SETTINGS },
      zones: D.zones.map((z) => ({ ...z, active: true })), people: [], shifts: [], assignments: [], audit: [], me: null, shiftSel: null };
  }
  let S;
  try { S = JSON.parse(localStorage.getItem(KEY)) || fresh(); } catch { S = fresh(); }
  S = { ...fresh(), ...S, settings: { ...L.DEFAULT_SETTINGS, ...(S.settings || {}) } };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { alert("Storage full: " + e.message); } };
  const t = (k, vars) => { let s = (I[S.lang] && I[S.lang][k]) ?? I.en[k] ?? k; for (const [a, b] of Object.entries(vars || {})) s = s.split(`{${a}}`).join(b); return s; };
  const fcfa = (n) => `${new Intl.NumberFormat(S.lang === "fr" ? "fr-FR" : "en-US").format(Math.round(n || 0))} FCFA`;
  const dt = (iso) => new Date(iso).toLocaleString(S.lang === "fr" ? "fr-FR" : "en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const city = (id) => D.cities.find((c) => c.id === id);
  const region = (id) => D.regions.find((r) => r.id === id);
  const zone = (id) => S.zones.find((z) => z.id === id);
  const person = (id) => S.people.find((p) => p.id === id);
  const log = (msg) => { S.audit.unshift({ at: new Date().toISOString(), msg }); S.audit = S.audit.slice(0, 200); };
  const nowIso = () => new Date().toISOString();
  const weekAssignments = (week) => S.assignments.filter((a) => a.week === week);
  const currentWeek = () => { const weeks = [...new Set(S.shifts.map((s) => s.week))].sort(); return weeks.filter((w) => w >= L.nextSaturday(new Date())).at(0) ?? weeks.at(-1) ?? null; };

  // ---------- actions ----------
  function signUp(form) {
    const f = Object.fromEntries(new FormData(form));
    const phone = L.normalizePhone(f.phone);
    if (!f.name?.trim() || !f.region || !f.city || !f.quarter) return msg("#signup-msg", t("required"), true);
    if (!phone || !L.detectOperator(phone)) return msg("#signup-msg", t("badPhone"), true);
    if (!f.consent) return msg("#signup-msg", t("required"), true);
    if (S.people.some((p) => p.phone === phone)) return msg("#signup-msg", t("dupPhone"), true);
    const p = { id: uid("p"), name: f.name.trim().slice(0, 80), phone, operator: L.detectOperator(phone), region_id: f.region, city_id: f.city,
      quarter: f.quarter, saturdays: !!f.saturdays, id_number: (f.id_number || "").trim().slice(0, 30), consent: true, created_at: nowIso(), last_served_at: null, served: 0 };
    S.people.push(p); S.me = p.id; log(`Sign-up: ${p.name} (${city(p.city_id).name})`); save(); render();
  }
  function scheduleNext() {
    const week = L.nextSaturday(new Date());
    if (S.shifts.some((s) => s.week === week)) { log(t("alreadyScheduled", { d: week })); save(); return render(); }
    const last = {};
    for (const s of S.shifts) if (!last[s.zone_id] || last[s.zone_id] < s.week) last[s.zone_id] = s.week;
    const zs = L.nextZones(S.zones, Math.max(1, Number(S.settings.zones_per_week) || 1), last);
    const crew = L.crewSize(S.settings);
    const [h, m] = String(S.settings.shift_start || "07:00").split(":").map(Number);
    for (const z of zs) {
      const [y, mo, d] = week.split("-").map(Number);
      const start = new Date(y, mo - 1, d, h || 7, m || 0);
      const end = new Date(start.getTime() + S.settings.shift_hours * 3600e3);
      S.shifts.push({ id: uid("sh"), week, zone_id: z.id, city_id: z.city_id, starts_at: start.toISOString(), ends_at: end.toISOString(), crew_size: crew, status: "scheduled", photos_before: [], photos_after: [] });
    }
    log(t("scheduled", { n: zs.length, d: week })); save(); render();
  }
  /** Fills every shift of the week without ever committing more than the weekly budget. */
  function runSelection(week) {
    let invited = 0, stopped = false;
    for (const sh of S.shifts.filter((s) => s.week === week && s.status !== "completed")) {
      const rows = L.fillShift(sh, S.people, S.assignments, S.settings, nowIso());
      for (const r of rows) {
        const b = L.budgetSummary(S.settings, weekAssignments(week));
        const unit = S.settings.pay_per_person_xaf + (S.settings.fees_in_budget ? L.feeFor(S.settings.pay_per_person_xaf, S.settings) : 0);
        if (b.remaining < unit) { stopped = true; break; }
        if (S.assignments.some((a) => a.id === r.id)) r.id = uid("as");
        S.assignments.push(r); invited++;
      }
      sh.status = "selection_open";
    }
    log(t("invitedN", { n: invited }) + (stopped ? " " + t("overBudget") : "")); save(); render();
  }
  function simulateDeadline(week) {
    const later = new Date(Date.now() + 1000 * 3600 * 24 * 30).toISOString();
    const ex = L.expireInvites(S.assignments.filter((a) => a.week === week), later);
    log(t("expiredN", { n: ex.length })); runSelection(week);
  }
  function respond(aid, yes) {
    const a = S.assignments.find((x) => x.id === aid); if (!a || a.status !== "invited") return;
    a.status = yes ? "confirmed" : "declined"; a.responded_at = nowIso();
    log(`${person(a.person_id)?.name}: ${a.status}`);
    if (!yes) runSelection(a.week); else { save(); render(); }
  }
  function checkIn(shiftId, code, pos, method) {
    const sh = S.shifts.find((s) => s.id === shiftId), z = zone(sh.zone_id);
    const a = S.assignments.find((x) => x.shift_id === shiftId && x.code === code.trim() && x.status === "confirmed");
    if (!a) return msg("#ci-msg", t("wrongCode"), true);
    const d = Math.round(L.distanceM(pos, z));
    if (d > S.settings.checkin_radius_m) return msg("#ci-msg", t("tooFar", { d, max: S.settings.checkin_radius_m }), true);
    Object.assign(a, { status: "checked_in", checkin_at: nowIso(), checkin_lat: pos.lat, checkin_lng: pos.lng, checkin_dist_m: d, checkin_method: method });
    sh.status = "in_progress"; log(`Check-in ${person(a.person_id)?.name} (${d} m, ${method})`); save(); render();
  }
  function signOff(aid, outcome, hours, notes) {
    const a = S.assignments.find((x) => x.id === aid); if (!a) return;
    if (!["checked_in", "confirmed"].includes(a.status)) return;
    if (a.status === "confirmed" && outcome !== "absent") return alert(t("checkIn") + "?");
    const pay = L.payFor(outcome, hours, S.settings);
    Object.assign(a, { status: "signed_off", checkout_at: a.status === "checked_in" ? nowIso() : null, outcome, hours: outcome === "full" ? S.settings.shift_hours : Number(hours) || 0,
      notes: (notes || "").slice(0, 500), pay_xaf: pay, payout_status: pay > 0 ? "awaiting" : "none", signed_off_at: nowIso() });
    // Fair rotation: serving (or not showing up after confirming) sends the person to the back of the queue.
    const p = person(a.person_id); if (p) { p.last_served_at = nowIso(); if (outcome !== "absent") p.served = (p.served || 0) + 1; }
    log(`Sign-off ${p?.name}: ${outcome} → ${fcfa(pay)}`); save(); render();
  }
  function approvePayout(aid) {
    const a = S.assignments.find((x) => x.id === aid); if (!a || a.payout_status !== "awaiting") return;
    const p = person(a.person_id);
    // Simulated transfer: a real deployment calls the payout provider (CamPay withdraw / Notch Pay transfer) server-side.
    Object.assign(a, { payout_status: "paid", paid_at: nowIso(), payout_ref: `SIM-${a.id.slice(-8).toUpperCase()}`, payout_fee: L.feeFor(a.pay_xaf, S.settings), payout_operator: p?.operator });
    log(`Payout ${fcfa(a.pay_xaf)} → ${p?.name} (${p?.operator}, simulated)`); save(); render();
  }
  function completeShift(id) {
    const sh = S.shifts.find((s) => s.id === id);
    const crew = S.assignments.filter((a) => a.shift_id === id && ["confirmed", "checked_in", "signed_off"].includes(a.status));
    if (crew.some((a) => a.status !== "signed_off")) return alert(t("allSignedOff"));
    if (!sh.photos_before.length || !sh.photos_after.length) return alert(t("needPhotos"));
    sh.status = "completed"; log(`Shift completed: ${zone(sh.zone_id)?.name} ${sh.week}`); save(); render();
  }
  function addPhoto(shiftId, kind, file) {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const sc = Math.min(1, 480 / Math.max(img.width, img.height)), c = document.createElement("canvas");
      c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      const sh = S.shifts.find((s) => s.id === shiftId); sh[kind].push({ at: nowIso(), data: c.toDataURL("image/jpeg", 0.6) });
      save(); render();
    };
    img.src = url;
  }
  function addSamples() {
    const first = ["Aïcha", "Brice", "Clarisse", "Daniel", "Estelle", "Fabrice", "Grace", "Hervé", "Irène", "Jean", "Kevin", "Linda", "Marcel", "Nadège", "Olivier", "Pauline", "Quentin", "Rose", "Serge", "Thérèse", "Ulrich", "Vanessa", "William", "Yvonne", "Zacharie"];
    const pool = S.zones.filter((z) => z.active !== false);
    first.forEach((n, i) => {
      const z = pool[i % Math.min(pool.length, 3)], c = city(z.city_id);
      let phone; do { phone = `2376${[7, 9, 5, 8][i % 4]}${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`; } while (!L.detectOperator(phone) || S.people.some((p) => p.phone === phone));
      S.people.push({ id: uid("p"), name: `[Sample] ${n} ${String.fromCharCode(65 + (i % 26))}.`, phone, operator: L.detectOperator(phone), region_id: c.region, city_id: c.id, quarter: z.quarters[i % z.quarters.length],
        saturdays: true, consent: true, created_at: new Date(Date.now() - (first.length - i) * 60000).toISOString(), last_served_at: null, served: 0, sample: true });
    });
    log("25 sample sign-ups added (test data)"); save(); render();
  }
  function msg(sel, text, bad) { const el = $(sel); if (el) { el.textContent = text; el.className = bad ? "msg bad" : "msg ok"; } }
  window.__cc = { S, L }; // for debugging in the console

  // ---------- views ----------
  const opt = (v, label, sel) => `<option value="${esc(v)}"${sel ? " selected" : ""}>${esc(label)}</option>`;
  const badge = (s, label) => `<span class="badge b-${esc(s)}">${esc(label ?? s)}</span>`;
  const shiftLabel = (sh) => { const z = zone(sh.zone_id); return `${z?.name ?? "?"} · ${city(sh.city_id)?.name} · ${sh.week}`; };
  const timeRange = (sh) => t("shiftTime", { d: sh.week, from: new Date(sh.starts_at).toTimeString().slice(0, 5), to: new Date(sh.ends_at).toTimeString().slice(0, 5) });

  function viewJoin() {
    const me = person(S.me);
    const switcher = S.people.length ? `<div class="row small"><label>${t("switchPerson")} <select data-change="me">${opt("", t("signUp"), !me)}${S.people.map((p) => opt(p.id, `${p.name} — ${city(p.city_id)?.name}`, p.id === S.me)).join("")}</select></label></div>` : "";
    if (!me) {
      return `${switcher}<section class="card"><h2>${t("signUp")}</h2>
      <form id="signup" class="grid" autocomplete="on">
        <label>${t("fullName")} *<input name="name" required maxlength="80" autocomplete="name"></label>
        <label>${t("phone")} *<input name="phone" required inputmode="tel" placeholder="+237 6XX XX XX XX" autocomplete="tel" data-input="phone"><small id="op-hint" class="muted"></small></label>
        <label>${t("region")} *<select name="region" required data-change="region">${opt("", t("choose"))}${D.regions.map((r) => opt(r.id, r[S.lang])).join("")}</select></label>
        <label>${t("city")} *<select name="city" required data-change="city" id="sel-city">${opt("", t("choose"))}</select></label>
        <label>${t("quarter")} *<select name="quarter" required id="sel-quarter">${opt("", t("choose"))}</select></label>
        <label>${t("idNumber")}<input name="id_number" maxlength="30"></label>
        <label class="check"><input type="checkbox" name="saturdays" checked> ${t("saturdays")}</label>
        <label class="check"><input type="checkbox" name="consent" required> ${t("consent")} <a href="#" data-action="privacy">${t("privacy")}</a></label>
        <button class="btn primary" type="submit">${t("signUp")}</button><p id="signup-msg" class="msg"></p>
      </form></section>`;
    }
    const taken = new Set(S.assignments.filter((a) => a.person_id !== me.id && ["invited", "confirmed", "checked_in"].includes(a.status)).map((a) => a.person_id));
    const q = L.queueFor(S.people, me.city_id, { exclude: taken });
    const pos = L.queuePosition(S.people, me, taken);
    const mine = S.assignments.filter((a) => a.person_id === me.id).sort((a, b) => (a.invited_at < b.invited_at ? 1 : -1));
    const live = mine.find((a) => ["invited", "confirmed", "checked_in"].includes(a.status));
    const sh = live && S.shifts.find((s) => s.id === live.shift_id), z = sh && zone(sh.zone_id);
    const paid = mine.filter((a) => a.payout_status === "paid");
    return `${switcher}<section class="card"><h2>${t("youAre")}</h2>
      <p><b>${esc(me.name)}</b> · ${esc(me.quarter)}, ${esc(city(me.city_id)?.name)} (${esc(region(me.region_id)?.[S.lang])})<br>
      <span class="muted">${esc("+" + me.phone)} · ${me.operator === "mtn" ? t("operatorMtn") : t("operatorOrange")}</span></p>
      ${live ? "" : pos ? `<div class="queue"><span>${t("queuePos", { city: esc(city(me.city_id)?.name) })}</span><b>#${pos}</b><span>${t("ofN", { n: q.length })}</span></div>` : `<p class="muted">${t("notInQueue")}</p>`}
      <p class="muted small">${t("howQueue")}</p></section>
      ${live && live.status === "invited" ? `<section class="card hi"><h2>${t("invitation")}</h2><p>${esc(z?.name)} — ${timeRange(sh)}<br>${t("meetAt")}: ${esc(z?.meet)}</p>
        <p><b>${t("confirmBy", { t: dt(live.confirm_by) })}</b></p><div class="row"><button class="btn primary" data-action="confirm" data-id="${live.id}">${t("confirm")}</button>
        <button class="btn" data-action="decline" data-id="${live.id}">${t("decline")}</button></div></section>` : ""}
      ${live && ["confirmed", "checked_in"].includes(live.status) ? `<section class="card hi"><h2>${t("confirmed")}</h2><p>${esc(z?.name)} — ${timeRange(sh)}<br>${t("meetAt")}: ${esc(z?.meet)}
        · <a href="https://www.openstreetmap.org/?mlat=${z.lat}&mlon=${z.lng}#map=17/${z.lat}/${z.lng}" target="_blank" rel="noopener">OpenStreetMap</a></p>
        <p>${t("yourCode")}:</p><div class="code">${esc(live.code)}</div><p class="muted small">${t("showCode")}</p>${badge(live.status, t("status_" + live.status))}</section>` : ""}
      <section class="card"><h2>${t("receipts")}</h2>${paid.length ? paid.map((a) => receipt(a, me)).join("") : `<p class="muted">${t("noReceipts")}</p>`}
      ${mine.filter((a) => a.status === "signed_off" && a.payout_status === "awaiting").map((a) => `<p>${fcfa(a.pay_xaf)} — ${badge("awaiting", t("payout_awaiting"))}</p>`).join("")}</section>
      <p><button class="btn danger small" data-action="leave">${t("leave")}</button></p>`;
  }
  function receipt(a, p) {
    const sh = S.shifts.find((s) => s.id === a.shift_id);
    return `<div class="receipt"><b>${t("receipt")} ${esc(a.payout_ref)}</b><br>${esc(zone(sh?.zone_id)?.name)} · ${esc(sh?.week)} · ${esc(t(a.outcome))} (${a.hours} h)<br>
      ${t("amount")}: <b>${fcfa(a.pay_xaf)}</b> · ${t("paidTo")}: +${esc(p.phone)} (${a.payout_operator === "mtn" ? "MTN MoMo" : "Orange Money"})<br>
      <span class="muted small">${t("fee")}: ${fcfa(a.payout_fee)} · ${dt(a.paid_at)} · ${S.lang === "fr" ? "simulé" : "simulated"}</span></div>`;
  }

  function viewSupervisor() {
    const shifts = [...S.shifts].sort((a, b) => (a.week < b.week ? 1 : -1));
    if (!shifts.length) return `<section class="card"><p class="muted">${t("noShifts")}</p></section>`;
    const sh = shifts.find((s) => s.id === S.shiftSel) || shifts.find((s) => s.status !== "completed") || shifts[0];
    const z = zone(sh.zone_id);
    const crew = S.assignments.filter((a) => a.shift_id === sh.id && a.status !== "declined" && a.status !== "expired");
    const photos = (k) => `<div class="photos">${sh[k].map((ph) => `<img src="${ph.data}" alt="">`).join("")}${sh.status !== "completed" ? `<label class="btn small">${t("addPhoto")}<input type="file" accept="image/*" capture="environment" hidden data-photo="${k}" data-id="${sh.id}"></label>` : ""}</div>`;
    return `<section class="card"><div class="row"><label>${t("pickShift")} <select data-change="shift">${shifts.map((s) => opt(s.id, shiftLabel(s), s.id === sh.id)).join("")}</select></label> ${badge(sh.status)}</div>
      <h2>${t("supervisorTitle")} — ${esc(z?.name)}</h2><p>${timeRange(sh)} · ${t("meetAt")}: ${esc(z?.meet)} (${z.lat}, ${z.lng}) · ${t("radius")}: ${S.settings.checkin_radius_m} m</p></section>
      ${sh.status !== "completed" ? `<section class="card"><h3>${t("checkIn")}</h3><div class="row">
        <input id="ci-code" inputmode="numeric" maxlength="6" placeholder="${t("codeLabel")}">
        <button class="btn primary" data-action="ci-gps" data-id="${sh.id}">${t("checkIn")} · ${t("gpsCheck")}</button>
        <button class="btn" data-action="ci-sim" data-id="${sh.id}">${t("simulateOnSite")}</button></div><p id="ci-msg" class="msg"></p></section>` : ""}
      <section class="card"><h3>${t("crew")} (${crew.length}/${sh.crew_size})</h3><table><thead><tr><th>#</th><th>${t("fullName")}</th><th>${t("phone")}</th><th></th><th>${t("signOff")}</th></tr></thead><tbody>
      ${crew.map((a, i) => { const p = person(a.person_id); return `<tr><td>${i + 1}</td><td>${esc(p?.name)}<br><span class="muted small">${esc(p?.quarter)}</span></td><td>+${esc(p?.phone)}</td>
        <td>${badge(a.status, t("status_" + a.status))}${a.checkin_at ? `<br><span class="muted small">${dt(a.checkin_at)} · ${a.checkin_dist_m} m</span>` : ""}</td>
        <td>${["checked_in", "confirmed"].includes(a.status) ? `<div class="row small"><select data-outcome="${a.id}">${a.status === "checked_in" ? opt("full", t("full")) + opt("partial", t("partial")) : ""}${opt("absent", t("absent"))}</select>
          <input class="tiny" type="number" min="0" max="${S.settings.shift_hours}" step="0.5" placeholder="${t("hours")}" data-hours="${a.id}"><input placeholder="${t("notes")}" data-notes="${a.id}">
          <button class="btn primary small" data-action="signoff" data-id="${a.id}">${t("signOff")}</button></div>` : a.status === "signed_off" ? `${esc(t(a.outcome))} · ${fcfa(a.pay_xaf)} ${a.notes ? `<br><span class="muted small">${esc(a.notes)}</span>` : ""}` : ""}</td></tr>`; }).join("")}
      </tbody></table></section>
      <section class="card"><h3>${t("photosBefore")}</h3>${photos("photos_before")}<h3>${t("photosAfter")}</h3>${photos("photos_after")}
      ${sh.status !== "completed" ? `<p><button class="btn primary" data-action="complete" data-id="${sh.id}">${t("completeShift")}</button></p>` : ""}</section>`;
  }

  function budgetBox(week) {
    const b = L.budgetSummary(S.settings, weekAssignments(week)), pct = Math.min(100, Math.round((b.used / Math.max(1, b.budget)) * 100));
    return `<div class="budget"><div class="bar"><span style="width:${pct}%"></span></div>
      <div class="row small"><span>${t("budget")}: <b>${fcfa(b.budget)}</b></span><span>${t("committed")}: <b>${fcfa(b.committed)}</b></span><span>${t("paidOut")}: <b>${fcfa(b.paid)}</b></span>
      <span>${t("fees")}: ${fcfa(b.fees)}${S.settings.fees_in_budget ? "" : " (+)"}</span><span>${t("remaining")}: <b>${fcfa(b.remaining)}</b></span></div></div>`;
  }
  function viewAdmin() {
    const s = S.settings, crew = L.crewSize(s), week = currentWeek();
    const num = (k, label, step = 1) => `<label>${label}<input type="number" name="${k}" value="${esc(s[k])}" step="${step}" min="0"></label>`;
    const awaiting = S.assignments.filter((a) => a.payout_status === "awaiting");
    const byRegion = D.regions.map((r) => ({ r, cities: D.cities.filter((c) => c.region === r.id).map((c) => ({ c, n: S.people.filter((p) => p.city_id === c.id).length })) }));
    return `<section class="card"><h2>${t("settings")}</h2><form id="settings" class="grid">
      ${num("weekly_budget_xaf", t("weeklyBudget"), 500)}${num("pay_per_person_xaf", t("payPerson"), 500)}${num("zones_per_week", t("zonesPerWeek"))}
      ${num("confirm_hours", t("confirmHours"))}<label>${t("shiftStart")}<input type="time" name="shift_start" value="${esc(s.shift_start)}"></label>${num("shift_hours", t("shiftHours"), 0.5)}
      ${num("checkin_radius_m", t("radius"), 50)}${num("payout_fee_pct", t("feePct"), 0.1)}<label class="check"><input type="checkbox" name="fees_in_budget"${s.fees_in_budget ? " checked" : ""}> ${t("feesInBudget")}</label>
      <button class="btn primary" type="submit">${t("save")}</button></form>
      <p class="derived"><b>${t("crewDerived", { n: crew })}</b> · ${t("budgetLine", { n: crew * Math.max(1, s.zones_per_week), pay: fcfa(s.pay_per_person_xaf), total: fcfa(crew * Math.max(1, s.zones_per_week) * s.pay_per_person_xaf) })}
      · ${t("fees")} ≈ ${fcfa(crew * Math.max(1, s.zones_per_week) * L.feeFor(s.pay_per_person_xaf, s))}</p></section>
      <section class="card"><h2>${t("weeks")}</h2><div class="row"><button class="btn primary" data-action="schedule">${t("scheduleNext")}</button>
      ${week ? `<button class="btn" data-action="select" data-week="${week}">${t("runSelection")}</button><button class="btn" data-action="deadline" data-week="${week}">${t("simulateDeadline")}</button>` : ""}</div>
      ${[...new Set(S.shifts.map((x) => x.week))].sort().reverse().map((w) => `<h3>${esc(w)}</h3>${budgetBox(w)}<table><tbody>${S.shifts.filter((x) => x.week === w).map((x) => {
        const as = S.assignments.filter((a) => a.shift_id === x.id), c = (st) => as.filter((a) => a.status === st).length;
        return `<tr><td>${esc(shiftLabel(x))}</td><td>${badge(x.status)}</td><td class="small">${t("status_invited")} ${c("invited")} · ${t("status_confirmed")} ${c("confirmed")} · ${t("status_checked_in")} ${c("checked_in")} · ${t("status_signed_off")} ${c("signed_off")} · ${t("status_declined")}/${t("status_expired")} ${c("declined") + c("expired")} / ${x.crew_size}</td></tr>`; }).join("")}</tbody></table>`).join("")}</section>
      <section class="card"><h2>${t("payouts")}</h2>${awaiting.length ? `<p><button class="btn primary" data-action="approve-all">${t("approveAll")} (${awaiting.length})</button></p><table><tbody>${awaiting.map((a) => { const p = person(a.person_id); return `<tr><td>${esc(p?.name)}</td><td>+${esc(p?.phone)} (${esc(p?.operator)})</td><td>${esc(t(a.outcome))}</td><td><b>${fcfa(a.pay_xaf)}</b></td><td><button class="btn small primary" data-action="approve" data-id="${a.id}">${t("approve")}</button></td></tr>`; }).join("")}</tbody></table>` : `<p class="muted">${t("noPayouts")}</p>`}</section>
      <section class="card"><h2>${t("zones")}</h2><table><thead><tr><th>${t("rotation")}</th><th>${t("zoneName")}</th><th>${t("city")}</th><th>${t("meetPoint")}</th><th>${t("active")}</th></tr></thead><tbody>
      ${[...S.zones].sort((a, b) => a.rotation - b.rotation).map((z) => `<tr><td><input class="tiny" type="number" value="${z.rotation}" data-rot="${z.id}"></td><td>${esc(z.name)}</td><td>${esc(city(z.city_id)?.name)}</td><td>${esc(z.meet)} <span class="muted small">${z.lat}, ${z.lng}</span></td><td><input type="checkbox" data-zactive="${z.id}"${z.active !== false ? " checked" : ""}></td></tr>`).join("")}
      </tbody></table><form id="zone" class="grid"><label>${t("city")}<select name="city">${D.cities.map((c) => opt(c.id, c.name)).join("")}</select></label><label>${t("zoneName")}<input name="name" required></label>
      <label>${t("meetPoint")}<input name="meet" required></label><label>${t("lat")}<input name="lat" required inputmode="decimal"></label><label>${t("lng")}<input name="lng" required inputmode="decimal"></label><button class="btn" type="submit">${t("addZone")}</button></form></section>
      <section class="card"><h2>${t("people")} (${S.people.length} ${t("total")})</h2><div class="regions">${byRegion.map(({ r, cities }) => `<div><b>${esc(r[S.lang])}</b>${cities.map(({ c, n }) => `<div class="small">${esc(c.name)}: ${n}</div>`).join("")}</div>`).join("")}</div>
      <p class="row"><button class="btn" data-action="samples">${t("sample")}</button><button class="btn danger" data-action="reset">${t("reset")}</button></p></section>
      <section class="card"><h2>${t("audit")}</h2><ul class="audit">${S.audit.slice(0, 40).map((x) => `<li><span class="muted">${dt(x.at)}</span> ${esc(x.msg)}</li>`).join("")}</ul></section>`;
  }
  function viewHow() {
    const s = S.settings;
    return `<section class="card"><h2>${t("howTitle")}</h2><ol><li>${t("how1")}</li><li>${t("how2")}</li><li>${t("how3")}</li><li>${t("how4")}</li><li>${t("how5", { pay: fcfa(s.pay_per_person_xaf), h: s.shift_hours })}</li>
      <li>${t("how6", { budget: fcfa(s.weekly_budget_xaf), crew: L.crewSize(s) * Math.max(1, s.zones_per_week) })}</li></ol><p class="note">${t("legalNote")}</p>
      <h3>${t("privacy")}</h3><p class="muted">${t("privacyText")}</p></section>`;
  }

  function render() {
    document.documentElement.lang = S.lang;
    $("#title").textContent = t("appName"); $("#tagline").textContent = t("tagline"); $("#banner").textContent = t("demoBanner"); $("#lang").textContent = t("lang");
    document.title = `${t("appName")} — demo`;
    for (const b of document.querySelectorAll("[data-tab]")) { b.textContent = t({ join: "tabJoin", supervisor: "tabSupervisor", admin: "tabAdmin", how: "tabHow" }[b.dataset.tab]); b.classList.toggle("active", b.dataset.tab === S.tab); }
    $("#view").innerHTML = { join: viewJoin, supervisor: viewSupervisor, admin: viewAdmin, how: viewHow }[S.tab]();
  }

  // ---------- events ----------
  document.addEventListener("click", (e) => {
    const tab = e.target.closest("[data-tab]"); if (tab) { S.tab = tab.dataset.tab; save(); return render(); }
    if (e.target.id === "lang") { S.lang = S.lang === "fr" ? "en" : "fr"; save(); return render(); }
    const b = e.target.closest("[data-action]"); if (!b) return;
    const id = b.dataset.id, act = b.dataset.action;
    if (act === "privacy") { e.preventDefault(); return alert(t("privacyText")); }
    if (act === "confirm" || act === "decline") return respond(id, act === "confirm");
    if (act === "schedule") return scheduleNext();
    if (act === "select") return runSelection(b.dataset.week);
    if (act === "deadline") return simulateDeadline(b.dataset.week);
    if (act === "approve") return approvePayout(id);
    if (act === "approve-all") { for (const a of S.assignments.filter((x) => x.payout_status === "awaiting")) approvePayout(a.id); return; }
    if (act === "samples") return addSamples();
    if (act === "complete") return completeShift(id);
    if (act === "signoff") return signOff(id, $(`[data-outcome="${id}"]`).value, $(`[data-hours="${id}"]`).value, $(`[data-notes="${id}"]`).value);
    if (act === "leave") { if (confirm(t("leaveConfirm"))) { S.people = S.people.filter((p) => p.id !== S.me); S.assignments = S.assignments.filter((a) => a.person_id !== S.me || a.status === "signed_off"); S.me = null; save(); render(); } return; }
    if (act === "reset") { if (confirm(t("resetConfirm"))) { const lang = S.lang; S = fresh(); S.lang = lang; window.__cc.S = S; save(); render(); } return; }
    if (act === "ci-sim") { const z = zone(S.shifts.find((s) => s.id === id).zone_id); return checkIn(id, $("#ci-code").value, { lat: z.lat + 0.0003, lng: z.lng }, "code+simulated-gps"); }
    if (act === "ci-gps") {
      if (!navigator.geolocation) return msg("#ci-msg", t("gpsDenied"), true);
      navigator.geolocation.getCurrentPosition((p) => checkIn(id, $("#ci-code").value, { lat: p.coords.latitude, lng: p.coords.longitude }, "code+gps"),
        () => msg("#ci-msg", t("gpsDenied"), true), { enableHighAccuracy: true, timeout: 15000 });
    }
  });
  document.addEventListener("change", (e) => {
    const el = e.target, c = el.dataset.change;
    if (c === "me") { S.me = el.value || null; save(); return render(); }
    if (c === "shift") { S.shiftSel = el.value; save(); return render(); }
    if (c === "region") { $("#sel-city").innerHTML = opt("", t("choose")) + D.cities.filter((x) => x.region === el.value).map((x) => opt(x.id, x.name)).join(""); $("#sel-quarter").innerHTML = opt("", t("choose")); }
    if (c === "city") { $("#sel-quarter").innerHTML = opt("", t("choose")) + (city(el.value)?.quarters || []).map((q) => opt(q, q)).join(""); }
    if (el.dataset.photo && el.files[0]) addPhoto(el.dataset.id, el.dataset.photo, el.files[0]);
    if (el.dataset.zactive) { zone(el.dataset.zactive).active = el.checked; save(); }
    if (el.dataset.rot) { zone(el.dataset.rot).rotation = Number(el.value) || 0; save(); render(); }
  });
  document.addEventListener("input", (e) => {
    if (e.target.dataset.input === "phone") { const op = L.detectOperator(e.target.value); $("#op-hint").textContent = op === "mtn" ? t("operatorMtn") : op === "orange" ? t("operatorOrange") : ""; }
  });
  document.addEventListener("submit", (e) => {
    e.preventDefault();
    if (e.target.id === "signup") return signUp(e.target);
    if (e.target.id === "settings") {
      const f = new FormData(e.target), n = (k) => Math.max(0, Number(f.get(k)) || 0);
      Object.assign(S.settings, { weekly_budget_xaf: n("weekly_budget_xaf"), pay_per_person_xaf: Math.max(1, n("pay_per_person_xaf")), zones_per_week: Math.max(1, Math.floor(n("zones_per_week"))),
        confirm_hours: Math.max(1, n("confirm_hours")), shift_start: f.get("shift_start") || "07:00", shift_hours: Math.max(0.5, n("shift_hours")), checkin_radius_m: Math.max(50, n("checkin_radius_m")),
        payout_fee_pct: n("payout_fee_pct"), fees_in_budget: f.get("fees_in_budget") === "on" });
      log(`Settings: budget ${S.settings.weekly_budget_xaf}, pay ${S.settings.pay_per_person_xaf}, zones ${S.settings.zones_per_week} → crew ${L.crewSize(S.settings)}`); save(); return render();
    }
    if (e.target.id === "zone") {
      const f = Object.fromEntries(new FormData(e.target)), lat = Number(f.lat), lng = Number(f.lng);
      if (!(lat > 1.6 && lat < 13.1 && lng > 8.4 && lng < 16.2)) return alert("Cameroon coordinates only");
      S.zones.push({ id: uid("z"), city_id: f.city, name: f.name.slice(0, 60), meet: f.meet.slice(0, 80), quarters: [f.meet.slice(0, 40)], lat, lng, rotation: S.zones.length + 1, active: true });
      log(`Zone added: ${f.name}`); save(); render();
    }
  });
  render();
})();
