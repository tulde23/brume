# InkStat

InkStat reads handwritten paper scoresheets with a phone camera and turns them into box scores, season stats and exports. It is built for **dedicated scorekeepers in youth and high school sports**, who keep the official book for both teams. Basketball works today; track and field is next.

Reading happens **on the phone**. Photos never leave it. An optional account syncs games and templates across devices through the InkStat API.

## What it does today

### Scan a game
- **Guided flow**: the home team's page, then the away team's (either can be skipped), then *Read*.
- **On-device reading**:
  - **Gemini Nano** (ML Kit GenAI) on supported Pixels, with **llama.rn** (Qwen3-VL GGUF) as the fallback on other phones.
  - **ML Kit text recognition** finds printed labels so a known layout can be lined up with the photo.
- **Reading animation**: the page is shown with the current region highlighted and a scan line, with a reduce-motion fallback.

### Templates (teach InkStat a scoresheet)
- **Region bank**: every part a youth/HS basketball scoresheet can have. Each part has a meaning, a shape (box or band), a reliability status, variants (how fouls are written, for example) and the labels that usually mark it.
- **Step-by-step builder**: photo, pick parts, mark each box (with pinch-zoom), review, then a test read with checks. "Remove this part" is offered for anything that reads poorly.
- **Auto-placement** from printed headings.
- **Built-in layouts** (NFHS Champion and NFHS Score-Right), matched to a photo by label fingerprint and aligned per photo (RANSAC plus an affine fit).
- **Templates are sport-agnostic**: each sport plugs in its own catalog, reading recipes and checks through a `SportModule`.

### After the scan
- **Game summary**: scoreboard, "N things to check before this game counts", score by quarter, and leaders.
- **Check against the page**: one issue at a time, with the crop InkStat read it from, a stepper, and a live check ("With 2, player points add up to 50 ✓").
- **Box score**: team tabs, flagged cells, team details, and tap-a-row editing in a bottom sheet beside the page crop.
- **Exports**: CSV and JSON exports, and season totals.
- **InkStat's own dialogs and toasts** everywhere: no stock OS alerts, and deletes can be undone.

### Account and sync
- **Sign in with Google**: Apple is ready on the server and in the app for iOS.
- **The sync button** opens a small window ("Syncing" with a progress bar, then "Done") that syncs the account's games and templates. There is nothing to configure.

### Look and feel
- **Scorebook Paper theme**: light and dark, IBM Plex Sans and Mono.
- **Viewfinder logo**: an animated splash takes over seamlessly from the native one.

## Repository layout

```
src/                  Expo Router app (screens in src/app, UI in src/ui)
  auth/               Google/Apple sign-in and the session (ported from Orbit)
  sync/               Sync client: pushes, then pulls; last writer wins
  db/                 SQLite storage for games, templates and settings
packages/
  ocr-engine/         @inkstat/ocr-engine: regions, tiling, alignment, the generic template core
  basketball/         @inkstat/basketball: region bank, read recipes, assembly, checks, stats, built-in library
  track/              @inkstat/track: track and field catalog, mark parsing, reading and checks (in progress)
modules/
  gemini-nano/        Local Expo module: ML Kit GenAI (Gemini Nano) prompts and image joins
  page-text/          Local Expo module: ML Kit text recognition, with EXIF rotation applied
server/               The InkStat API (Node, Hono, SQLite), deployed on Railway
scripts/              Test-bench helpers and the anchor generator for built-in templates
```

The OCR engine is kept free of sport-specific code so other sports can reuse it.

## Running the app

Requirements: Node 22+, Android SDK, and a phone with USB debugging (development builds; Expo Go cannot load the native modules).

```sh
npm install
npx expo run:android          # builds and installs the debug app
npx expo start --dev-client   # Metro; JS changes then reload live
```

Checks:

```sh
npm run typecheck
npm run lint
npm test                      # app and packages (Jest)
npm run test:server           # API tests (node:test)
```

Native modules or config plugins changed? Run `npx expo prebuild --platform android` and rebuild. `android/` and `ios/` are generated and not committed.

**Test bench** (development only): hold the logo on Home, or drive it over adb with `inkstat://bench?run=template|marked|whole-page`. It reports results to the Metro log as `[bench-result]` lines. Bench photos live **outside** this repo (see Privacy).

## The API

`server/` is a single Node service (Hono, SQLite on a volume) at **https://api.inkstat.app**. The app works fully offline without it. It provides:

- **Accounts**: Apple/Google sign-in (Orbit's model: no passwords, identities keyed on provider and subject, rotating refresh tokens that never sign out on a race).
- **Personal sync**: an account's games and templates.
- **Groups** (league, school or team): share games, a team list, standings and rosters by invite code.
- **Shared registry**, built up by scorekeepers as they go:
  - **Teams**, with aliases and merges once two scorekeepers agree.
  - **Which template each team's book uses.**
  - **Final scores**, confirmed when two reports agree.

Endpoints, configuration and Railway deployment are in [server/README.md](server/README.md).

## Privacy rules

These are not optional; the repo is public.

- **Photos stay on the phone.** The server strips page and crop file paths on upload.
- **Player names never leave a group.** The shared registry holds team names, layouts and scores only. Shared templates keep only printed scoresheet words as anchors (`server/src/sanitize.ts`), never a photo.
- **No scoresheet images or OCR with real players' names in this repo.** Test samples live in a private folder outside it. Built-in template anchors are printed labels only, filtered by `scripts/make-anchors.ts` and reviewed by eye.

## Status

| Area | State |
| --- | --- |
| Basketball reading (names, points, team, date, location, quarters) | Working on Pixel 10 Pro with Gemini Nano |
| Mark counting (fouls, timeouts, team fouls) | Weak; flagged for checking |
| Templates, region bank, built-in NFHS layouts | Working |
| Post-scan summary, check and box score | Working |
| Google sign-in and personal sync | Working on Android |
| Apple sign-in | Server ready; needs an iOS build |
| Groups, registry, standings (API) | Live on the API; app screens not built yet |
| Track and field | Package and tests; no app screens yet |
| Per-photo template choice, scorekeeper home screen | Designed, not built |

## License

MIT (see LICENSE).
