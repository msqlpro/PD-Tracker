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
