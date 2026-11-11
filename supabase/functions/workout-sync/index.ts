// deno-lint-ignore-file
// workout-sync — receives Apple Watch workouts from an iOS Shortcut and files
// them into the Exercise tab.
//
//   POST /functions/v1/workout-sync      header  x-sync-key: <key>
//
// Body (JSON). Every list may be a JSON array OR a newline-separated string,
// because that is what Shortcuts produces when a list is dropped into Text.
//   types, starts, ends      one entry per workout (starts/ends ISO 8601)
//   kcal, km                 optional, one entry per workout
//   hr_values, hr_times      optional heart-rate samples (bpm + ISO 8601 time);
//                            the server keeps the ones inside each workout window
//   workouts: [{type,start,end,kcal,km,avg_hr,max_hr,min_hr}]   alternative shape
//
// Behaviour
//   - Each workout is stored once in apple_health_workouts (id = ah_<start epoch>).
//   - First sight: if a manually logged session of the same category exists that
//     day and is not already linked, it is linked and its empty HR fields are
//     filled (manual values are never overwritten). Otherwise a new exercise row
//     is created with the same id and the note "Apple Watch".
//   - Re-sends are safe: nothing is duplicated, a session deleted in the app
//     stays deleted, and HR that arrives late is filled in.
//
// The key is checked against a SHA-256 hash so the real key never sits in the repo.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const KEY_SHA256 = "7c1712a9ca23fbc90a9d99b797359611ed5620ba9c9f0590f18b56919359a7b4";
const USER_ID = "4e107f47-efb7-40ba-ba35-e40e2d070784";
const MIN_MINUTES = 5;      // ignore accidental starts
const MIN_HR_SAMPLES = 5;   // need a few readings before trusting an average
const TZ = "Europe/London";

// ---- pure helpers (unit tested) ----
export function toList(v: unknown): string[] {
  if (v === null || v === undefined) return [];
  if (Array.isArray(v)) return v.map((x) => String(x === null || x === undefined ? "" : x).trim());
  const s = String(v);
  if (!s.trim()) return [];
  return s.split(/\r?\n/).map((x) => x.trim());
}
export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return isFinite(v) ? v : null;
  const m = String(v).replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}
export function ms(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return v > 1e11 ? v : v * 1000;
  const t = Date.parse(String(v).trim());
  return isNaN(t) ? null : t;
}
// Apple workout name -> the app's session type + category.
export function mapType(raw: string): { type: string; category: string | null } {
  const t = (raw || "").toLowerCase();
  if (/run|jog/.test(t)) return { type: "Run", category: "aerobic" };
  if (/cycl|bik|spin/.test(t)) return { type: "Spin", category: "aerobic" };
  if (/row/.test(t)) return { type: "Rowing", category: "aerobic" };
  if (/box/.test(t)) return { type: "Boxercise", category: "aerobic" };
  if (/stair|step/.test(t)) return { type: "Stair Master", category: "aerobic" };
  if (/padel|paddle/.test(t)) return { type: "Padel", category: "aerobic" };
  if (/tennis|squash|racquet|badminton|pickle/.test(t)) return { type: "Tennis", category: "aerobic" };
  if (/walk|hik/.test(t)) return { type: "Walk", category: "aerobic" };
  if (/swim/.test(t)) return { type: "Swim", category: "aerobic" };
  if (/ellip|hiit|interval|danc|cardio|cross.?train/.test(t)) return { type: raw.trim(), category: "aerobic" };
  if (/strength|weight|functional|core|resist/.test(t)) return { type: "Strength", category: "strength" };
  if (/yoga/.test(t)) return { type: "Yoga", category: "flexibility" };
  if (/flex|stretch|pilates|cool/.test(t)) return { type: "Flexibility", category: "flexibility" };
  if (/balance|tai/.test(t)) return { type: "Balance", category: "balance" };
  return { type: (raw || "").trim() || "Workout", category: null };
}
// Same inference the app uses for rows saved without a category.
export function inferCat(type: string): string {
  const t = (type || "").toLowerCase();
  if (/run|jog|spin|cycl|bike|swim|row|walk|hike|hiit|box|boxercise|parkrun|ellip|tread|stair|step|danc|squash|tennis|padel|paddle|cardio/.test(t)) return "aerobic";
  if (/strength|weight|gym|resist|lift|press|squat/.test(t)) return "strength";
  if (/balance|tai chi|taichi|stand/.test(t)) return "balance";
  if (/flex|stretch|yoga|pilates|mobility/.test(t)) return "flexibility";
  return "other";
}
export function dayKey(t: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));
}
export function hrStats(samples: { t: number; v: number }[], start: number, end: number) {
  const inWin = samples.filter((s) => s.t >= start && s.t <= end && s.v >= 30 && s.v <= 230).map((s) => s.v);
  if (inWin.length < MIN_HR_SAMPLES) return null;
  const sum = inWin.reduce((a, b) => a + b, 0);
  return { avg: Math.round(sum / inWin.length), max: Math.round(Math.max.apply(null, inWin)), min: Math.round(Math.min.apply(null, inWin)), n: inWin.length };
}
// ACSM bands: vigorous from 77% of HRmax, moderate from 64%.
export function intensityFor(avg: number | null, hrMax: number): string {
  if (!avg || !hrMax) return "moderate";
  const p = avg / hrMax * 100;
  return p >= 77 ? "vigorous" : p >= 64 ? "moderate" : "light";
}
export type Workout = { id: string; rawType: string; start: number; end: number; minutes: number; kcal: number | null; km: number | null; avg: number | null; max: number | null; min: number | null };
export function parseBody(body: any): { workouts: Workout[]; skipped: string[]; hrCount: number } {
  const skipped: string[] = [];
  const hv = toList(body.hr_values), ht = toList(body.hr_times);
  const samples: { t: number; v: number }[] = [];
  for (let i = 0; i < Math.min(hv.length, ht.length); i++) {
    const v = num(hv[i]), t = ms(ht[i]);
    if (v !== null && t !== null) samples.push({ t, v });
  }
  let rows: any[] = [];
  if (Array.isArray(body.workouts)) rows = body.workouts;
  else {
    const types = toList(body.types), starts = toList(body.starts), ends = toList(body.ends), kcal = toList(body.kcal), km = toList(body.km), durs = toList(body.durations);
    for (let i = 0; i < starts.length; i++) rows.push({ type: types[i], start: starts[i], end: ends[i], kcal: kcal[i], km: km[i], duration: durs[i] });
  }
  const seen: Record<string, boolean> = {};
  const workouts: Workout[] = [];
  rows.forEach(function (r, i) {
    const start = ms(r.start);
    if (start === null) { skipped.push("#" + (i + 1) + ": start time not readable (" + String(r.start) + ")"); return; }
    let end = ms(r.end);
    const dur = num(r.duration_minutes !== undefined ? r.duration_minutes : r.duration);
    if (end === null && dur !== null) end = start + dur * 60000;
    if (end === null || end <= start) { skipped.push("#" + (i + 1) + ": end time not readable"); return; }
    const minutes = Math.round((end - start) / 60000);
    if (minutes < MIN_MINUTES) { skipped.push("#" + (i + 1) + ": under " + MIN_MINUTES + " min"); return; }
    if (minutes > 600) { skipped.push("#" + (i + 1) + ": over 10 hours"); return; }
    const id = "ah_" + Math.floor(start / 1000);
    if (seen[id]) return;
    seen[id] = true;
    const st = hrStats(samples, start, end);
    const km = num(r.km !== undefined ? r.km : r.distance);
    workouts.push({
      id, rawType: String(r.type || "").trim(), start, end, minutes,
      kcal: num(r.kcal !== undefined ? r.kcal : r.calories),
      km: km && km > 0 ? Math.round(km * 100) / 100 : null,
      avg: num(r.avg_hr) !== null ? Math.round(num(r.avg_hr) as number) : st ? st.avg : null,
      max: num(r.max_hr) !== null ? Math.round(num(r.max_hr) as number) : st ? st.max : null,
      min: num(r.min_hr) !== null ? Math.round(num(r.min_hr) as number) : st ? st.min : null,
    });
  });
  return { workouts, skipped, hrCount: samples.length };
}
// Pick the manual session this workout most likely is: same category, same
// London day, not linked to another workout; nearest in time wins.
export function pickManual(w: Workout, category: string, manual: { id: string; type: string; category: string | null; logged_at: string }[], linked: Record<string, boolean>) {
  const day = dayKey(w.start);
  let best: any = null, bestGap = Infinity;
  manual.forEach(function (e) {
    if (linked[e.id] || String(e.id).indexOf("ah_") === 0) return;
    const t = Date.parse(e.logged_at);
    if (isNaN(t) || dayKey(t) !== day) return;
    if ((e.category || inferCat(e.type)) !== category) return;
    const gap = Math.abs(t - w.start);
    if (gap < bestGap) { best = e; bestGap = gap; }
  });
  return best;
}

async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function json(o: unknown, status = 200) { return new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } }); }

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  let body: any = {};
  try { body = await req.json(); } catch (_e) { return json({ error: "Body must be JSON" }, 400); }
  const key = req.headers.get("x-sync-key") || body.key || "";
  if (!key || (await sha256(String(key).trim())) !== KEY_SHA256) return json({ error: "Unauthorized" }, 401);

  const parsed = parseBody(body);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const out = { received: parsed.workouts.length, added: 0, linked: 0, hr_filled: 0, unchanged: 0, hr_samples: parsed.hrCount, skipped: parsed.skipped, errors: [] as string[] };
  if (!parsed.workouts.length) return json(out);

  let hrMax = 160;
  try {
    const p = await sb.from("profiles").select("settings").eq("id", USER_ID).single();
    const v = p.data && p.data.settings && p.data.settings.exCfg && parseInt(p.data.settings.exCfg.hrMax);
    if (v) hrMax = v;
  } catch (_e) { /* default */ }

  const ids = parsed.workouts.map((w) => w.id);
  const exist = await sb.from("apple_health_workouts").select("id,exercise_id,avg_heart_rate").in("id", ids);
  const known: Record<string, any> = {};
  (exist.data || []).forEach(function (r: any) { known[r.id] = r; });
  const lo = Math.min.apply(null, parsed.workouts.map((w) => w.start)) - 36 * 3600000;
  const hi = Math.max.apply(null, parsed.workouts.map((w) => w.end)) + 36 * 3600000;
  const exq = await sb.from("exercise").select("id,type,category,logged_at,avg_hr,peak_hr,min_hr").eq("user_id", USER_ID).gte("logged_at", new Date(lo).toISOString()).lte("logged_at", new Date(hi).toISOString());
  const exRows: any[] = exq.data || [];
  const lq = await sb.from("apple_health_workouts").select("exercise_id").eq("user_id", USER_ID).not("exercise_id", "is", null).gte("start_time", new Date(lo).toISOString());
  const linked: Record<string, boolean> = {};
  (lq.data || []).forEach(function (r: any) { linked[r.exercise_id] = true; });

  for (const w of parsed.workouts.sort((a, b) => a.start - b.start)) {
    try {
      const m = mapType(w.rawType);
      const cat = m.category || inferCat(m.type);
      const base = { id: w.id, user_id: USER_ID, workout_type: w.rawType || m.type, duration: w.minutes, distance_unit: "km", start_time: new Date(w.start).toISOString(), end_time: new Date(w.end).toISOString() } as any;
      // Only send values we actually have, so a thinner re-send never blanks stored ones.
      if (w.kcal !== null) base.calories = Math.round(w.kcal);
      if (w.km !== null) base.distance = w.km;
      if (w.avg !== null) { base.avg_heart_rate = w.avg; base.max_heart_rate = w.max; }
      const prev = known[w.id];
      let exId: string | null = prev ? prev.exercise_id : null;

      if (!prev) {
        const match = pickManual(w, cat, exRows, linked);
        if (match) {
          exId = match.id; linked[match.id] = true; out.linked++;
        } else {
          const ins = await sb.from("exercise").insert({ id: w.id, user_id: USER_ID, type: m.type, category: m.category, duration: w.minutes, intensity: intensityFor(w.avg, hrMax), distance: w.km, distance_unit: "km", logged_at: new Date(w.start).toISOString(), avg_hr: w.avg, peak_hr: w.max, min_hr: w.min, notes: "Apple Watch" });
          if (ins.error) throw new Error(ins.error.message);
          exId = w.id; linked[w.id] = true; out.added++;
          exRows.push({ id: w.id, type: m.type, category: m.category, logged_at: new Date(w.start).toISOString(), avg_hr: w.avg, peak_hr: w.max, min_hr: w.min });
        }
      }
      base.exercise_id = exId;
      const up = await sb.from("apple_health_workouts").upsert(base, { onConflict: "id" });
      if (up.error) throw new Error(up.error.message);

      // Fill empty HR fields on the linked session (never overwrite what is there).
      let filled = false;
      if (exId && w.avg !== null) {
        const row = exRows.find((e) => e.id === exId);
        if (row) {
          const patch: any = {};
          if (!row.avg_hr) patch.avg_hr = w.avg;
          if (!row.peak_hr) patch.peak_hr = w.max;
          if (!row.min_hr) patch.min_hr = w.min;
          if (Object.keys(patch).length && !(exId === w.id && !prev)) {
            const u = await sb.from("exercise").update(patch).eq("id", exId).eq("user_id", USER_ID);
            if (u.error) throw new Error(u.error.message);
            Object.assign(row, patch); filled = true; out.hr_filled++;
          }
        }
      }
      if (prev && !filled) out.unchanged++;
    } catch (e) {
      out.errors.push(w.id + ": " + ((e as Error).message || String(e)));
    }
  }
  return json(out, out.errors.length ? 207 : 200);
});
