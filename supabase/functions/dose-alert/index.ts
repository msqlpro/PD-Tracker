// deno-lint-ignore-file
// ---- shared logic ----
// Shared protein- and exercise-aware dose-timing logic.
// All times are minutes since local midnight (Europe/London).
//   doses    : today's levodopa dose times
//   intakes  : today's meals/drinks [{ m, protein, calories, label }]
//   history  : recent past days' intervals for this dose number (minutes), real logs only
//   nowM     : current minutes
//   exercise : today's sessions [{ m, duration, intensity, type }] — a session that
//              starts AFTER now is treated as planned
// Handles doses 2, 3 and 4 (null otherwise).
//
// Rules (heuristic — the minute values are NOT from a trial):
//   gap   = average of today's logged intervals so far; for dose 2 (only one dose
//           logged today) the median dose1→dose2 gap from recent days' logs;
//           210 min if no history. Clamped 150–270 min. No saved alarm slots used.
//   base  = previous dose + gap
//   exercise: if a moderate/vigorous session is planned after the previous dose,
//           aim for the dose 45 min before it starts (so it's kicking in), but never
//           earlier than prev + 150 or more than 60 min before base
//   protein: each intake >=5 g blocks dosing until 60/90/120 min after it
//           (5-14 / 15-29 / 30 g+), +30 if >=700 kcal; rec is pushed past blocks,
//           capped at +90 min after base (wearing-off risk outweighs protein)
var DT_MAX_DELAY = 90, DT_MAX_DOSE = 4, DT_EX_LEAD = 45;
function dtWait(p, cal) {
  if (!(p >= 5)) return 0;
  var w = p >= 30 ? 120 : p >= 15 ? 90 : 60;
  if (cal >= 700) w += 30;
  return w;
}
function dtHm(s) { var a = String(s || "").split(":"); return (parseInt(a[0], 10) || 0) * 60 + (parseInt(a[1], 10) || 0); }
function dtFmt(m) { m = Math.round(m); var h = Math.floor(m / 60) % 24, mm = ((m % 60) + 60) % 60; return String(h).padStart(2, "0") + ":" + String(mm).padStart(2, "0"); }
function recommendDose(doses, intakes, history, nowM, exercise) {
  var ds = (doses || []).slice().sort(function(a, b) { return a - b; });
  var n = ds.length + 1;
  if (n < 2 || n > DT_MAX_DOSE) return null;
  var prev = ds[ds.length - 1];
  var gap, gapSrc;
  if (ds.length >= 2) {
    gap = Math.round((ds[ds.length - 1] - ds[0]) / (ds.length - 1)); gapSrc = "today's average interval";
  } else if (history && history.length) {
    var h = history.slice().sort(function(a, b) { return a - b; });
    gap = h[Math.floor(h.length / 2)]; gapSrc = "your usual 1st→2nd gap (last " + h.length + " days)";
  } else { gap = 210; gapSrc = "default 3h30 interval"; }
  gap = Math.max(150, Math.min(270, gap));
  var base = prev + gap;
  var rec = base, exNote = null;
  // Exercise: planned (future) moderate/vigorous session after the previous dose
  var planned = (exercise || []).filter(function(e) { return e.m > nowM && e.m > prev && !/light/i.test(e.intensity || ""); })
    .sort(function(a, b) { return a.m - b.m; })[0];
  if (planned) {
    var target = planned.m - DT_EX_LEAD;
    var floor = Math.max(prev + 150, base - 60);
    if (target < base) {
      rec = Math.max(target, floor);
      exNote = "brought forward for your " + (planned.type || "exercise") + " at " + dtFmt(planned.m) + " so it's working when you start";
    }
  }
  var blocks = (intakes || []).filter(function(x) { return x.m >= prev - 15 && dtWait(x.protein, x.calories) > 0; })
    .map(function(x) { return { from: x.m, to: x.m + dtWait(x.protein, x.calories), x: x }; })
    .sort(function(a, b) { return a.from - b.from; });
  var start = rec, hit = null, moved = true;
  while (moved) {
    moved = false;
    for (var i = 0; i < blocks.length; i++) {
      if (rec >= blocks[i].from && rec < blocks[i].to) { rec = blocks[i].to; hit = blocks[i]; moved = true; }
    }
  }
  var capped = false;
  if (rec - base > DT_MAX_DELAY) { rec = base + DT_MAX_DELAY; capped = true; }
  var reason;
  if (!hit) {
    var last = blocks.length ? blocks[blocks.length - 1] : null;
    reason = last ? "clear of your " + Math.round(last.x.protein) + "g protein at " + dtFmt(last.from) : "no protein logged since last dose";
  } else {
    reason = Math.round(hit.x.protein) + "g protein at " + dtFmt(hit.from) + (hit.x.calories >= 700 ? " (large meal)" : "") + " → wait till " + dtFmt(hit.to);
    if (capped) reason += "; capped at +" + DT_MAX_DELAY + " min — absorption may be weaker";
  }
  reason = "interval based on " + gapSrc + " (" + Math.floor(gap / 60) + "h" + String(gap % 60).padStart(2, "0") + "); " + reason;
  if (exNote) reason += "; " + exNote + (hit && rec > start ? " (protein pushed it back to " + dtFmt(rec) + ")" : "");
  if (planned && rec > planned.m - 20) reason += "; heads-up: this is close to your " + (planned.type || "exercise") + " at " + dtFmt(planned.m);
  return {
    doseNo: n, prev: prev, base: base, gap: gap, gapSrc: gapSrc, rec: rec, delay: rec - base, capped: capped,
    overdue: nowM > rec, reason: reason, exercise: planned ? { at: dtFmt(planned.m), type: planned.type } : null,
    eatFrom: rec + 30,
    recStr: dtFmt(rec), baseStr: dtFmt(base)
  };
}
// ON/OFF check-ins: at last dose + 150 and + 210 min (the window where wearing-off
// shows up). Skipped if an ON/OFF was logged in the 30 min before the check-in or since.
// Returns the latest check-in that is due now (due <= now < due + 60), or null.
var OO_OFFSETS = [150, 210];
function ooCheckin(doses, ooTimes, nowM) {
  var ds = (doses || []).slice().sort(function(a, b) { return a - b; });
  if (!ds.length) return null;
  var last = ds[ds.length - 1], n = ds.length, due = null;
  for (var i = 0; i < OO_OFFSETS.length; i++) {
    var c = last + OO_OFFSETS[i];
    if (c <= nowM && nowM < c + 60) due = { slot: "d" + n + "+" + OO_OFFSETS[i], due: c, dueStr: dtFmt(c), afterDose: n, minsSinceDose: nowM - last };
  }
  if (!due) return null;
  var recent = (ooTimes || []).some(function(t) { return t >= due.due - 30 && t <= nowM; });
  if (recent) return null;
  return due;
}
// Meal window after the latest dose (same rule as the app's mealWindow):
// safe to eat from last dose + 30 min. If another dose is still due, a protein
// meal (15-29 g, a 90 min block in dtWait) should be done by next base - 90.
// null if no dose today or something substantial was already eaten since the dose.
var MEAL_AFTER_DOSE = 30, MEAL_PROT_CLEAR = 90;
function mealWindow(doses, intakes, nowM, rec) {
  var ds = (doses || []).slice().sort(function(a, b) { return a - b; });
  if (!ds.length) return null;
  var last = ds[ds.length - 1], eatFrom = last + MEAL_AFTER_DOSE;
  var eaten = (intakes || []).some(function(x) { return x.m >= last && (x.protein >= 5 || x.calories >= 150); });
  if (eaten) return null;
  var nextEst = rec ? rec.base : null;
  var proteinBy = nextEst != null && nextEst - MEAL_PROT_CLEAR > eatFrom ? nextEst - MEAL_PROT_CLEAR : null;
  return {
    doseNo: ds.length, last: last, lastStr: dtFmt(last), eatFrom: eatFrom, eatFromStr: dtFmt(eatFrom), safeNow: nowM >= eatFrom,
    nextEstStr: nextEst != null ? dtFmt(nextEst) : null, proteinByStr: proteinBy != null ? dtFmt(proteinBy) : null
  };
}
// ---- end shared logic ----
import { createClient } from "npm:@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const USER_ID = "4e107f47-efb7-40ba-ba35-e40e2d070784";
const FROM = "brainboxcandy@gmail.com";
const TO = "mark@brainboxcandy.com";
const TZ = "Europe/London";
const APP_URL = "https://msqlpro.github.io/PD-Tracker/";
const ORD: Record<number, string> = { 2: "2nd", 3: "3rd", 4: "4th" };

function london(d: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, mins: parseInt(p.hour) * 60 + parseInt(p.minute) };
}
function isLevodopa(l: any) {
  const id = l.med_id || "";
  if (id.indexOf("supplement_stack_") === 0 || id.indexOf("magnesium_night_") === 0) return false;
  return /sinemet|levodopa|co-?careldopa|madopar|stalevo|sastravi|mucuna/i.test(l.med_name || "");
}

async function sendMail(subject: string, text: string) {
  const pass = Deno.env.get("GMAIL_APP_PASSWORD");
  if (!pass) throw new Error("GMAIL_APP_PASSWORD secret not set");
  const client = new SMTPClient({ connection: { hostname: "smtp.gmail.com", port: 465, tls: true, auth: { username: FROM, password: pass.replace(/\s+/g, "") } } });
  try { await client.send({ from: `PD Tracker <${FROM}>`, to: TO, subject, content: text }); }
  finally { await client.close(); }
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const dry = url.searchParams.get("dry") === "1";
  const test = url.searchParams.get("test") === "1";
  try {
    if (test) {
      await sendMail("PD Tracker: test email", "Dose alerts are set up. You'll get an email at the recommended time for your 2nd, 3rd and 4th Sinemet doses.\n\n" + APP_URL);
      return Response.json({ ok: true, sent: "test" });
    }
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const now = new Date();
    const L = london(now);
    const since = new Date(now.getTime() - 36 * 3600e3).toISOString();
    const until = new Date(now.getTime() + 24 * 3600e3).toISOString();
    const [logsR, mealsR, drinksR, exR, ooR] = await Promise.all([
      sb.from("med_logs").select("med_id,med_name,taken_at,source").eq("user_id", USER_ID).gte("taken_at", new Date(now.getTime() - 15 * 864e5).toISOString()),
      sb.from("meals").select("description,protein,calories,logged_at").eq("user_id", USER_ID).gte("logged_at", since),
      sb.from("drinks").select("name,protein,calories,logged_at,note").eq("user_id", USER_ID).gte("logged_at", since),
      sb.from("exercise").select("type,duration,intensity,logged_at").eq("user_id", USER_ID).gte("logged_at", since).lte("logged_at", until),
      sb.from("on_off_state").select("state,logged_at").eq("user_id", USER_ID).gte("logged_at", since),
    ]);
    const todayOnly = (iso: string) => iso && london(new Date(iso)).day === L.day;
    // Doses logged within 15 min of each other are one dose event (double-tap / 2 tablets logged twice).
    const doses = (logsR.data || []).filter((l: any) => todayOnly(l.taken_at) && isLevodopa(l)).map((l: any) => london(new Date(l.taken_at)).mins)
      .sort((a: number, b: number) => a - b).filter((m: number, i: number, a: number[]) => i === 0 || m - a[i - 1] >= 15);
    const intakes = [...(mealsR.data || []), ...(drinksR.data || []).filter((d: any) => !/^Auto-logged with/.test(d.note || ""))]
      .filter((x: any) => todayOnly(x.logged_at))
      .map((x: any) => ({ m: london(new Date(x.logged_at)).mins, protein: Number(x.protein) || 0, calories: Number(x.calories) || 0, label: x.description || x.name }));
    const exercise = (exR.data || []).filter((e: any) => todayOnly(e.logged_at))
      .map((e: any) => ({ m: london(new Date(e.logged_at)).mins, duration: e.duration, intensity: e.intensity, type: e.type }));
    // Past days' dose1→dose2 gaps from real (non-estimated) logs
    const byDay: Record<string, number[]> = {};
    (logsR.data || []).filter((l: any) => isLevodopa(l) && l.source !== "estimated").forEach((l: any) => {
      const d = london(new Date(l.taken_at)); if (d.day === L.day) return;
      (byDay[d.day] = byDay[d.day] || []).push(d.mins);
    });
    const history = Object.values(byDay).map((a) => a.sort((x, y) => x - y)).filter((a) => a.length >= 2).map((a) => a[1] - a[0]).filter((g) => g >= 90 && g <= 360);
    const rec = recommendDose(doses, intakes, history, L.mins, exercise);
    const ooTimes = (ooR.data || []).filter((o: any) => todayOnly(o.logged_at)).map((o: any) => london(new Date(o.logged_at)).mins);
    const oo = L.mins >= 360 && L.mins < 1260 ? ooCheckin(doses, ooTimes, L.mins) : null;
    const meal = mealWindow(doses, intakes, L.mins, rec);
    const out: any = { now: dtFmt(L.mins), day: L.day, doses: doses.map(dtFmt), rec, oo, meal };
    if (!rec) return Response.json({ ...out, action: "none" });
    if (L.mins < rec.rec) return Response.json({ ...out, action: "wait" });
    if (L.mins > rec.rec + 60) return Response.json({ ...out, action: "stale" });
    const { data: already } = await sb.from("dose_alerts").select("dose_no").eq("user_id", USER_ID).eq("day", L.day).eq("dose_no", rec.doseNo).maybeSingle();
    if (already) return Response.json({ ...out, action: "already-sent" });
    if (dry) return Response.json({ ...out, action: "would-send" });
    const ord = ORD[rec.doseNo];
    const subject = `💊 Sinemet ${ord} dose — take now (${rec.recStr})`;
    const body = [
      `Best time for your ${ord} Sinemet dose today: ${rec.recStr}.`,
      ``,
      `Why: ${rec.reason}.`,
      rec.delay > 0 ? `Your normal interval would have put it at ${rec.baseStr}; it's been moved ${rec.delay} min later.` : rec.delay < 0 ? `Your normal interval would have put it at ${rec.baseStr}; it's been brought ${-rec.delay} min earlier.` : `Taking it on your normal interval (${rec.baseStr}).`,
      `Previous dose: ${dtFmt(rec.prev)}.`,
      ``,
      `Tip: hold off protein until about ${dtFmt(Math.max(rec.eatFrom, L.mins + 30))} (30 min after the dose).`,
      ``,
      `Log it: ${APP_URL}`,
      ``,
      `This is a timing heuristic based on what you've logged, not medical advice — your neurologist's schedule takes priority.`,
    ].join("\n");
    await sendMail(subject, body);
    await sb.from("dose_alerts").insert({ user_id: USER_ID, day: L.day, dose_no: rec.doseNo, rec_time: rec.recStr, reason: rec.reason });
    return Response.json({ ...out, action: "sent" });
  } catch (e) {
    return Response.json({ ok: false, error: String((e as Error).message || e) }, { status: 500 });
  }
});
