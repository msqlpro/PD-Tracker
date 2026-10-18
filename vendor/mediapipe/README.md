# MediaPipe (self-hosted)

Copy of `@mediapipe/tasks-vision` 0.10.14 (Apache-2.0, Google) used by the camera
motor tests, so the app doesn't load code from outside hosts.

- `vision_bundle.mjs` and `wasm/` come from the npm package tarball; its sha512
  matched npm's published integrity value when copied (18 Oct 2026). File hashes
  are in `SHA256SUMS`.
- `models/` (hand, pose, face) are copied from Google's official model storage by
  `.github/workflows/vendor-models.yml`; hashes in `models/SHA256SUMS`.

To update: replace these files deliberately and update `MP_VER` in index.html.
