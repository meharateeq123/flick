# Flick Auto-Footage Rulebook

Master index of every standing rule the auto-footage engine (and the Step 3 Remotion build) must follow. Read the linked files in full before running `auto-footage.mjs` or building scenes — this file is the table of contents, not a replacement for them.

| Rule file | Covers |
|---|---|
| [visual-relevancy-rules.md](visual-relevancy-rules.md) | Script is the single source of truth. Every scene must pass script + visual + temporal relevance and connect to the scene before/after it. Scene 1 must be a strong video hook. Rank candidates, don't take the first result. Named person → that exact person. Image only when video can't work. Motion graphic only as a last resort for genuinely data-driven lines. No generic filler picked for one shared keyword. Also contains the **on-screen text rule**: no baked-in source captions/lower-thirds carried into the final cut, and only genuinely important headings get on-screen text — most scenes get none. |
| [character-visual-rules.md](character-visual-rules.md) | Strict named-person handling: detect every person/character mentioned, video of the exact person first, authentic image of that exact person second, never a generic/unidentified substitute. Image presentation quality bar (clean crop, face visible, no text over the face). Also documents the reference beat-sheet layout (header row + per-scene "WHY THIS CLIP?" + type badge) to follow when presenting a beat sheet. |
| [footage-rules.md](footage-rules.md) | What to keep/remove from a clip before use: no separate logo/intro opener — start directly on the action; strip baked-in text, logos, watermarks, lower thirds, episode titles; if a clean shot isn't available, prefer a tighter crop or a different clip over keeping the graphic; add source attribution afterward as a small separate credit card, never keep the source's own branding. |
| [original-motion-graphics-rule.md](original-motion-graphics-rule.md) | Any motion graphic must be authored from scratch in the Remotion build — never downloaded, copied, or reused from YouTube or a third-party template. Design requirements (clean typography, safe area, smooth animation, natural transitions) and the priority order (footage → authentic image → original graphic, only when genuinely necessary). |
| [clip-reuse-rule.md](clip-reuse-rule.md) | Don't reuse the same source video across scenes when avoidable — search for different footage/angle/moment first. Only repeat a clip if no other sufficiently relevant footage exists. |
| [smart-framing-rule.md](smart-framing-rule.md) | Relevance isn't enough — every clip must also be framed so the important subject (face, car, action) is fully visible at the project's aspect ratio, checked at the start/middle/end of the clip. Never a blind center-crop that cuts off the subject; never stretched/distorted footage. |

## Engine behavior this maps to (`scripts/auto-footage.mjs`)

- Per scene: video tried first (NASCAR-style official channel + broad global search, ranked by title relevance against the narration — never a blind first-result pick), then a named person's image, then a data-driven line's motion-graphic reservation, then a general fallback image.
- `--motion-scenes <n,n>` forces specific scene numbers straight to a reserved motion graphic.
- `--only <n,n>` (see below) re-runs just the listed scene numbers without touching the rest of an already-downloaded set — use this to redo one or two scenes the user flags as wrong, instead of re-fetching everything.
- `visualHint` on a transcript segment biases the search query toward a specific shot type (e.g. "in-car cockpit camera") the narration text alone wouldn't suggest.
- `introSkipSeconds` on a transcript segment skips that many seconds into the source YouTube video before grabbing the clip — use it when a source (podcast/show intro, channel bumper) opens with a logo animation before the real footage begins, per `footage-rules.md`'s no-separate-logo-opener rule. Inspect the downloaded clip first (contact-sheet the frames) to find the right offset, then re-run that one scene with `--only <n>`.
- Clip length is scene-duration-driven, capped at 10s by default (`--max-seconds`).

## Non-negotiables, restated short

1. Relevance beats variety, percentage targets, or filling the timeline — always.
2. Named person on screen = that exact person, video first, authentic image second, never generic.
3. No source logos/captions/lower-thirds in the final footage; no captioning every line — only real headings, sparingly.
4. Any motion graphic is built by us from scratch, never downloaded or reused.
5. Scene N should connect to Scene N-1 and N+1 — same event/driver/location/vehicle where possible, not a random grab-bag.
6. Don't reuse the same source clip across scenes when a different relevant one is findable.
7. Relevant isn't enough — the clip must also be framed so the subject isn't cut off, at any aspect ratio.
