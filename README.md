# PD Tracker

A personal health tracking Progressive Web App (PWA) for managing Parkinson's Disease symptoms, medication, nutrition, exercise, sleep, and wellbeing.

**Live app:** https://msqlpro.github.io/PD-Tracker/

---

## Features

- **Medication logging** — dose timing, effectiveness tracking
- **Meal logging** — AI-powered nutrition breakdown (protein, carbs, fibre, calories, sugar) with food photo analysis
- **Drink tracking** — hydration logging with daily targets
- **Exercise logging** — type, duration, intensity
- **Sleep tracking** — bed/wake times, quality
- **Symptom tracking** — ON/OFF states, tremor, dyskinesia, mood
- **Fasting tracker** — 14-hour intermittent fasting compliance
- **Weight & bowel logging**
- **Sugar warning banners** — alerts when daily sugar exceeds threshold
- **Apple Watch integration** — steps, sleep, heart rate via iOS Shortcuts → Supabase
- **AI weekly/monthly reports** — powered by Claude API
- **Copy from previous meals** — quick re-logging
- **Dark mode support**

## Tech Stack

- React (via CDN, no build step)
- Tailwind CSS
- Supabase (database + auth)
- Anthropic Claude API (nutrition analysis, AI reports)
- GitHub Pages (hosting)

## Data

All data is stored in Supabase. Apple Watch health data is piped in via iOS Shortcuts automations. The app is single-user and keyed to a fixed user ID.

---

## Changelog

### 2026-10-18 (v97)
- **Motor Tests hub**: one 🧪 home button replaces Tap Test, Cam Tap and Arm Turns, and lists every test. New camera tests on a shared engine (`MotorCamMod` + `MOTOR_SPECS`): hand open/close (60s, per hand), tremor at rest / arms out (30s, both hands, size as % of hand size and frequency 3 to 12 Hz), sit to stand ×5 (pose tracking, auto-stops after the fifth sit), walk and arm swing (30s, cadence, per-arm swing, asymmetry), blink and expression (face blendshapes, 60s talking). New `tap_tests` columns `condition`, `total_s`, `extra` (jsonb).

### 2026-10-18 (v96)
- **Arm Turns**: new 🔄 home button. 60s rapid forearm rotation (palm up / palm down, MDS-UPDRS 3.6 style) with arms pointing at the front camera. Tracks the knuckle line angle per hand; saves turns, degrees per turn, turn-size decrement first vs last 10, rhythm CV, hesitations and tracking %. Both arms together or one at a time (offers the other arm after saving). Same hands-free start and soft start/stop voice as Cam Tap. Stored in `tap_tests` with `method = 'rotation'` (amp_* in degrees).

### 2026-10-18 (v95)
- **Cam Tap tweaks**: voice now only at start (prompt and countdown) and stop; no listening or spoken results after the test. Softer voice: picks the phone's Enhanced/Premium English voice if installed, slower and quieter. After saving one hand it asks whether to test the other hand now.

### 2026-10-18 (v94)
- **Cam Tap button and hands-free start**: own 📷 Cam Tap home button. Once the camera is open, holding the hand in view for 2s starts a spoken 3, 2, 1 countdown; spoken ten-second warning and result. Voice commands where the phone supports speech recognition: "start", "save", "other hand" (saves then reopens the camera for the other hand), "discard", "cancel". The mic only listens after the app finishes speaking.

### 2026-10-18
- **Camera tap test (v93)**: Tap Test now offers a 60s camera mode. The front camera tracks thumb and index fingertips on the phone (MediaPipe Hand Landmarker; no video stored). Saves taps, rhythm CV, average opening (fraction of hand size), amplitude decrement first vs last 10 taps, hesitations and % of frames tracked to `tap_tests` (new columns `method`, `amp_mean`, `amp_first`, `amp_last`, `amp_decrement_pct`, `hesitations`, `track_pct`). Camera and screen results are compared only with their own kind.

### 2026-10-03
- **Safe-to-eat alert (v82)** — Today screen shows a banner after each levodopa dose: amber "Hold food until HH:MM" countdown for the first 30 min, then green "Safe to eat since HH:MM" with a protein cut-off (next estimated dose − 90 min) so a protein meal doesn't blunt the following dose. Browser notification fires at the safe time while the app is open. Hidden once a meal/snack is logged after the dose.
- **Email** — `dose-alert` edge function now returns a `meal` window; the hourly scheduled task emails "Safe to eat" once per dose (deduped in new `meal_alerts` table).
- **Fix** — levodopa logs within 15 min of each other now count as one dose event for timing (a duplicate log was making the planner think an extra dose had been taken).
- Edge function source now versioned in `supabase/functions/dose-alert/`.

### 2026-06-15
- **Protein timing (levodopa)** — new Settings card to set daytime protein targets (breakfast / lunch / daytime total) and the evening cut-off, for protein-redistribution to protect levodopa absorption
- **Over-target alerts** — Today screen shows a live daytime-vs-evening protein readout that turns red and lists the breach the moment a logged meal pushes you over a daytime target (no push needed — surfaces in-app at log time)
- **AI error reasons surfaced** — meal/photo/drink analysis now reports the real API status and message (e.g. 401 invalid key, 400 credit balance too low) instead of a generic "Analysis failed"
- **Model bump** — meal/photo/drink analysis and AI reports moved from `claude-sonnet-4-5` to `claude-sonnet-4-6` across all call sites

### 2026-04-13
- **Fix:** Nutrition totals row now wraps (`flex-wrap`) so the Sugar value no longer overflows off screen on narrow mobile displays

### 2026-03-xx
- Apple Watch data pipeline (steps, sleep, heart rate via iOS Shortcuts → Supabase)
- Medication effectiveness tracking
- Sugar intake monitoring with daily warning banners
- Timezone/BST bug fix for logged timestamps
- Multiple UI improvements across modal forms
