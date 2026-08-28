---
name: flick
description: Turn a supplied video, public video URL, or transcript into original short-form scene animations with Remotion. Use when a user says "/flick", "$flick", "animate this", or asks to turn a video, transcript, or script into motion animation. Extract a timestamped transcript first when the source is video.
---

# /flick

Turn a transcript into original scene animations.

## Invocation dispatch — do this first

Recognize `/flick` in Claude Code and `$flick` in Codex. Flick runs transcription, planning, Remotion building, preview, revision, and reusable-animation saving in one workflow.

Read [references/RULEBOOK.md](references/RULEBOOK.md) once at the start of any run — it indexes every standing visual/footage/motion-graphic rule that governs how scenes are chosen and built throughout this skill.

## What this skill does

1. Gets a video, public video link, or pasted transcript.
2. Creates the timestamped transcript when the source is video.
3. Asks for aspect ratio, brand assets, and the user's creative opinion.
4. Writes an approval plan with one proposed animation per transcript scene.
5. Builds the approved scenes in Remotion with action-matched sound effects.
6. Opens Remotion Studio for review, revises the affected scene, and saves selected animations for reuse.

## Output directory

Create `flick-output/` in the user's current project. If that directory already exists, create `flick-output-YYYY-MM-DD-HHmmss/`. Use one output directory consistently for every file in that run.

The completed run contains:

```text
flick-output/
  transcript.json
  flick-plan.md
  remotion-brief.md
  scene-spec.json
  brand-assets/
  remotion/
  scenes/[approved-scene-name]/[approved-scene-name].mp4
  scenes/[approved-scene-name]/poster.jpg
```

## Reusable animation library

Flick installs `<flick-skill>/saved-animations/` automatically. Before planning, read `<flick-skill>/saved-animations/README.md`. It is Flick's shared library of editable scene templates. Use an entry only when its visual pattern clearly fits the requested scene. If nothing is a strong fit, create a new scene.

Do not open every component. After identifying a strong catalog match, inspect only that component folder and adapt it with the current transcript and approved assets. Do not reuse private or project-specific imagery from a template.

## Workspace setup

Run:

```text
node <flick-skill>/scripts/bootstrap.mjs --project <output-directory>
```

Bootstrap creates the workspace and installs Remotion, bundled FFmpeg, Whisper, yt-dlp, and Flick's bundled sound effects. It requires Node.js 20+, Python 3.9+, and network access. If Node or Python is missing, show the install guidance printed by bootstrap and ask before running a system installer.

## Step 1: Create the transcript

Read [references/step-1-transcript.md](references/step-1-transcript.md).

Ask exactly:

> Send a video/link to transcribe, or paste a transcript.

If the user provides a local video or public video URL, use Flick's bundled timestamped-transcript pipeline:

```text
node <flick-skill>/scripts/transcribe.mjs --source <file-or-url> --project <output-directory>
```

For a public URL, the extractor downloads its audio with yt-dlp. For either a URL or local video, it uses bundled FFmpeg and Whisper to write `<output-directory>/transcript.json` with timestamps. If the user pastes text, store it in the same `transcript.json` format. The transcript is always the script Flick animates.

Then ask exactly, in this order:

1. What aspect ratio should this be: 9:16, 16:9, 1:1, or custom?
2. Put any logo, fonts, screenshots, product images, or brand guide into `<output-directory>/brand-assets/`. What should I use?
3. What do you think? Your opinion will make your animation much better.

Gate: `transcript.json` exists and the user has answered those three questions.

### Optional: auto-fetch matching footage

If the user wants Flick to find its own B-roll instead of supplying assets, run:

```text
node <flick-skill>/scripts/auto-footage.mjs --project <output-directory>
```

This reads `transcript.json`, builds a short search query per scene, and downloads only a short matching clip per scene — as long as the scene needs, but never more than 10 seconds and never the full video — into `<output-directory>/brand-assets/auto-footage/`. Pass `--max-seconds <n>` to change the 10s cap.

Read [references/visual-relevancy-rules.md](references/visual-relevancy-rules.md), [references/character-visual-rules.md](references/character-visual-rules.md), [references/footage-rules.md](references/footage-rules.md), and [references/original-motion-graphics-rule.md](references/original-motion-graphics-rule.md) before running this step. `footage-rules.md` governs what to strip from a clip before use: no separate logo/intro opener, no baked-in source text/logos/watermarks/lower-thirds — clean footage only, with source attribution added afterward as a small separate credit card rather than kept from the original graphic. `original-motion-graphics-rule.md` governs the small share of scenes `auto-footage.mjs` reserves rather than downloads: those must be authored from scratch in the Step 3 Remotion build — never sourced as an existing animated clip from YouTube or anywhere else. Together they are the binding standard for what counts as an acceptable visual: every scene must pass script + visual + temporal relevance and connect to the scene before and after it — never generic filler picked just because it shares one keyword or a broad category (a race car, a person, a stadium, NASCAR branding) — and any named person must be shown as that exact person (their footage, or their authentic image if no suitable footage exists), never generic or unidentified. Reject a low-relevance clip and search again with a more specific query rather than accepting it. When presenting a beat sheet to the user, follow the reference layout described at the end of character-visual-rules.md.

Visual choice is **footage-led and content-relevance-driven, not a fixed percentage quota**, decided independently per scene:

1. **Video clip — default.** Always tried first, for almost every line: events, actions, locations, processes, vehicles, sports, technology, etc. Tries **YouTube** (via `yt-dlp`) → **Pexels** → **Pixabay** → **Wikimedia Commons**, keeping the first that succeeds.
2. **Image — only when no clip is available, or a specific named person is the subject.** If the line names a specific person (an athlete, historical figure, etc.), the script searches for that exact person's name so the visual matches them — never generic footage of someone else. If no clip was found and no person is named, a general-topic image is tried as a fallback before giving up.
3. **Motion graphic — last resort, reserved (not downloaded) for Flick's Remotion build in Step 3.** Only used when no clip was found for a data-driven line: exact statistics, percentages, dates/timelines, or comparisons that footage can't convey clearly.

Nothing is picked just to hit a mix percentage — a highly relevant clip always beats a generic image, and a motion graphic is never added merely for visual variety. Pass `--motion-scenes 2,5` (1-based scene numbers) to force specific scenes straight to a motion graphic regardless of the automatic decision.

To redo just the scene(s) the user flags as wrong — without re-fetching everything — delete that scene's file from `brand-assets/auto-footage/` and re-run with `--only 6,10` (1-based scene numbers). Every other already-downloaded scene is left untouched.

Pexels/Pixabay need `PEXELS_API_KEY` / `PIXABAY_API_KEY` in a `.env` file at the flick repo root or the project directory; if absent, those two sources are skipped automatically. Warn the user that downloaded clips may be copyrighted and are for personal/reference use only — confirm before using them in anything published.

### Optional: assemble a rough-cut preview

After `auto-footage.mjs` has downloaded clips, stitch them into one video matched to the transcript's scene timing:

```text
node <flick-skill>/scripts/assemble-video.mjs --project <output-directory> --aspect 9:16
```

Add `--voiceover <audio-file>` once the user has a recorded voiceover to mux it in; without it, this produces a silent rough-cut at `<output-directory>/preview.mp4` so the user can review pacing before recording. This rough-cut path is for the user's own reference/preview — it is separate from Flick's normal Remotion animation build in Step 3.

## Step 2: Plan and get approval

Read [references/step-2-plan.md](references/step-2-plan.md).

Create the proposed scene plan from `transcript.json`, the approved format, selected brand assets, and the user's creative opinion. Follow this step's plan format. Do not create components or `scene-spec.json` before approval.

Write `<output-directory>/flick-plan.md`. It is the user-facing creative contract. For every transcript scene, include its approved scene name, transcript line(s) and timestamps, what is on screen, text on screen, selected supplied assets, sequential or simulated interaction, sound effect, audio-coupled idea, and transition.

Show the complete plan in chat and ask:

> Here are the scenes Flick will build from your transcript. Approve them, or tell me what to change.

Do not write Remotion components before approval.

Gate: `flick-plan.md` exists and the user has approved it.

## Step 3: Build the approved scenes

Read [references/step-3-compose.md](references/step-3-compose.md).

Write:

```text
<output-directory>/remotion-brief.md
<output-directory>/scene-spec.json
```

`remotion-brief.md` is the approved build handoff. Write it using [references/remotion-brief-template.md](references/remotion-brief-template.md). `scene-spec.json` is the structured technical companion: IDs, names, transcript timing, frame ranges, components, assets, visual behavior, and sound effects.

Build from the approved `flick-plan.md`, `remotion-brief.md`, `scene-spec.json`, and selected assets. Create custom components, register independent compositions, verify renders, and open Studio for review.

Use the shared catalog read at the start of the run. Select a compatible entry only when it is a strong fit, then inspect only that entry's component folder before deciding to adapt it. If no entry is a strong fit, build an original scene.

Build one named Remotion composition per approved scene under `<output-directory>/remotion/src/scenes/`. Register each independently in `Root.tsx`; do not create an all-scenes composition. Use frame-driven Remotion motion and copy only selected user brand assets into the Remotion public folder.

Do not add background music. Use bundled sound effects only when they match a visible action: typing, click, impact, reveal, counter, or transition.

Render every named scene before review.

Gate: every approved scene has a rendered preview in `scenes/[approved-scene-name]/`.

## Step 4: Preview, revise, and save

Read [references/step-4-deliver.md](references/step-4-deliver.md).

Start Remotion Studio from `<output-directory>/remotion/`. Give the user the localhost URL only after Studio starts successfully, then say:

> Watch it and tell me what you think. What should change, if anything?

On feedback, revise only the affected scene, render that scene again, and reopen Studio. After acceptance, ask:

> Which scene animations should I save as reusable assets?

Save each selected scene's editable component, plus any required local `.ts` or `.tsx` companion files, under `<flick-skill>/saved-animations/[approved-scene-name]/`. Do not save MP4s, posters, or private brand assets in the shared library.

## Creative laws

- The transcript defines scene timing unless the user explicitly asks to alter it.
- Every scene must depict a concrete visual animation—not generic text over a background.
- Use only user-supplied brand assets and source material the user has the right to use.
- Do not invent generic scene names. Use names approved in `flick-plan.md`.
- Do not claim a preview, render, or Studio session exists unless its command succeeded.
