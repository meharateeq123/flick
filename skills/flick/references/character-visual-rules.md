# Character / Person Visual Rule — Strict

Whenever the narration mentions a specific person, character, player, driver, athlete, celebrity, historical figure, politician, scientist, or any other identifiable individual, the system MUST recognize that person as a visual entity.

## Character detection

Analyze every sentence and identify: person names, player names, driver names, athlete names, historical figures, public figures, named characters, any explicitly identified individual.

## Person visual priority

When a specific person is mentioned:
1. FIRST search for relevant VIDEO FOOTAGE of that exact person.
2. If suitable/relevant video footage is available, use the video.
3. If suitable video footage is unavailable, automatically fetch an authentic image of that EXACT person from an appropriate source.
4. NEVER use a generic person as a replacement for a named person.

Example — Narration: "Chase Elliott dominated the final laps."
- Preferred: relevant Chase Elliott race footage.
- If footage unavailable: authentic Chase Elliott image.
- Never: random NASCAR driver image, generic racing driver, unidentified person.

## Image source search

When an image is required, automatically search for the exact person across available image/search sources, using query variants such as: "[FULL PERSON NAME]", "[FULL PERSON NAME] portrait", "[FULL PERSON NAME] [sport/event]", "[FULL PERSON NAME] recent", "[FULL PERSON NAME] official". Prefer a clear, high-quality, recognizable image. The system must verify the image actually represents the mentioned person before using it — do NOT simply use the first image returned by search.

## How to display the person

A fetched character/person image must never simply be placed randomly on the screen. Present it as a professionally designed visual: clean composition, high-quality crop, face clearly visible, subject properly centered or intentionally positioned, appropriate scale, cinematic presentation, subtle entrance animation, smooth transition, clean typography if the person's name is displayed, no unnecessary decorative elements. The person's face must remain clearly visible.

## Image duration

Do not automatically create a separate long scene for every person — match the image duration to the narration. Brief mention → show the image only for the relevant portion. Person is the main subject of the sentence → keep the image visible for the appropriate duration. Same person mentioned repeatedly → prefer relevant video footage and avoid unnecessarily repeating the exact same image.

## Contextual relevance

The image must match the narration's context whenever possible — e.g. Chase Elliott in a NASCAR racing context is better than a generic unrelated studio portrait; an authentic historical photograph of Einstein fits "Einstein developed the theory of relativity" better than a generic science stock image.

## Frame format

The character image MUST use the project's already-selected video format (9:16 / 1080×1920 for short-form, 16:9 / 1920×1080 for long-form) — do not change the project aspect ratio because an image is being used. Intelligently crop/reframe to fit the existing canvas. Never stretch unnaturally; never create black bars unless explicitly required.

## Visual continuity

The character image must fit naturally between the surrounding scenes, like part of the same documentary rather than a random slideshow interruption. Example progression: NASCAR race footage → a driver is mentioned → that driver's authentic image/footage → return to related race footage.

## Text + image layout

If the person's name is displayed: keep typography clean, do not place text over the person's face, maintain safe margins, do not overlap text with other text or cover important parts of the image, automatically reposition elements if a collision is detected.

## Quality check

Before accepting the image, verify: correct person, relevant to narration, high visual quality, face clearly recognizable, correct context, correct project aspect ratio, proper crop, no stretching, no unwanted overlap, no text covering the face, no clipping, professional presentation. If ANY check fails: reject the image, search for another, revalidate.

## Most important rule

If the narration talks about a SPECIFIC PERSON, the viewer should be able to SEE THAT SPECIFIC PERSON. Do not replace a named person with generic footage.

**VIDEO FIRST when relevant. AUTHENTIC PERSON IMAGE when suitable video is unavailable. MOTION GRAPHICS only when genuinely necessary.** The visual must always match the exact narration.

---

## Reference beat-sheet layout (user-supplied example)

The user shared a mockup beat sheet ("NASCAR – The 2026 Season So Far", 16:9) as the target presentation style for future beat sheets. Its format:

- **Header row:** Video format (aspect ratio + resolution) · Project name · Approach summary (e.g. "Footage First – Images for Characters – Graphics Only When Necessary").
- **Per-scene row**, left to right:
  1. Scene number/name + timestamp range + one-line narration description.
  2. A visual thumbnail/mock of the actual shot.
  3. 3 short bullets on why the visual works (e.g. "Continues same race", "Lead change", "Smooth continuity from Scene 1").
  4. A **"WHY THIS CLIP?" / "WHY IMAGE HERE?" / "WHY GRAPHIC HERE?"** explanation line spelling out the relevance reasoning.
  5. A right-aligned type badge with a checkmark: **VIDEO CLIP** (with its source, e.g. "YouTube: NASCAR on FOX / NBC Sports"), **IMAGE** (with "Auto-fetched from reliable sources"), or **MOTION GRAPHIC** (with a short design note, e.g. "Clean, on-brand design").
- **Footer band:** a single reinforcing line, e.g. "EVERY SCENE IS RELEVANT TO THE SCRIPT · VIDEO USED FOR ACTION & EVENTS · IMAGES USED FOR CHARACTERS · GRAPHICS USED ONLY WHEN NECESSARY".

When producing a beat sheet for the user going forward, prefer this structure (or as close an approximation as the output medium allows) over the plain markdown table/list format used previously — it makes the relevance reasoning and source type explicit per scene, which is exactly what the strict-relevancy rule requires reviewers to be able to check at a glance.
