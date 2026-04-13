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

### 2026-04-13
- **Fix:** Nutrition totals row now wraps (`flex-wrap`) so the Sugar value no longer overflows off screen on narrow mobile displays

### 2026-03-xx
- Apple Watch data pipeline (steps, sleep, heart rate via iOS Shortcuts → Supabase)
- Medication effectiveness tracking
- Sugar intake monitoring with daily warning banners
- Timezone/BST bug fix for logged timestamps
- Multiple UI improvements across modal forms
