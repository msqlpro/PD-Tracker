# MediaPipe (self-hosted)

Copy of `@mediapipe/tasks-vision` 0.10.35 (Apache-2.0, Google) used by the camera
motor tests, so the app doesn't load code from outside hosts.

- `vision_bundle.mjs` and `wasm/` come from the npm package tarball; its sha512
  matched npm's published integrity value when copied (18 Oct 2026; upgraded from 0.10.14). File hashes
  are in `SHA256SUMS`.
- `models/` (hand, pose, face) are copied from Google's official model storage by
  `.github/workflows/vendor-models.yml`; hashes in `models/SHA256SUMS`.

To update: replace these files deliberately and update `MP_VER` in index.html.

## Why not 1.x

Versions 1.0.0 and later send usage metrics to Google (`odml.pa.googleapis.com/v1/log`)
and their README makes the app responsible for user consent; there is no documented
opt-out. 0.10.35 is the newest release without that code. Before any upgrade, check
the new `vision_bundle.mjs` for that endpoint and any other outbound calls.
