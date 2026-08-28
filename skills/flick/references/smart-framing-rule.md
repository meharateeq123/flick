# Smart Video Framing Rule

Every selected clip must fit properly inside the project frame without
cutting off the important subject.

For 16:9 (1920×1080):

- Never blindly use center-crop or `object-fit: cover` and assume it's fine.
- Detect the main subject — faces, cars, players, the important action.
- Keep the complete important subject visible.
- Podcasts / interviews: never cut off a person's face or body.
- Sports / NASCAR: keep the relevant car/player/action fully visible.
- If the subject moves through the frame, the crop needs to track it rather
  than stay locked to center.
- Never stretch or distort footage to fill the frame.
- If a clip cannot be framed properly at this aspect ratio, go back and
  search for a better/wider clip instead of forcing the crop.

Before rendering, check the beginning, middle, and end of every clip (a
quick contact-sheet frame grab, same as used elsewhere in this workflow). If
any important subject is cut off at any of those points, fix the framing and
check again.

**A clip is not approved just because it's relevant.** Relevance
(`visual-relevancy-rules.md`) and framing are two separate gates — both must
pass before a clip ships.

## How this applies to `assemble-video.mjs`

The current crossfade pipeline scales with
`force_original_aspect_ratio=increase` and then does a blind centered
`crop=W:H`. That's a reasonable default for footage that's already close to
the target aspect and centers its subject, but it will cut off a subject
that's off-center or that the source video framed wider/taller than our
canvas. When a clip's subject would be cropped out at center:

- Prefer picking a differently-framed source clip over forcing the crop.
- If the source clip is otherwise the best/only option, use ffmpeg `crop`
  with an explicit `x`/`y` offset (not the implicit center) so the subject
  stays in frame, verified by a before/after contact-sheet check.
