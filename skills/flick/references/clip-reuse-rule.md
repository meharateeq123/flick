# Clip Reuse Rule

If a video clip has already been used in one scene, do **not** reuse the same
clip again in another scene whenever possible. Always search for a different
relevant clip for the next scene.

Prioritize, in order:
1. Different footage (a different video entirely)
2. Different camera angle (same event, different shot)
3. Different moment (same video, different timestamp — only if 1 and 2 aren't available)
4. Different source clip

Only reuse an already-used clip (same video ID) if no other sufficiently
relevant footage is available after a real search attempt — never as a
shortcut, and never just to fill the timeline.

## How this applies to `auto-footage.mjs`

- Before accepting a candidate for a scene, check it against the video IDs
  already used by earlier scenes in the same project (`sources.json` /
  the downloaded files' source video). If the top-scoring candidate is a
  repeat, look at the next-best distinct candidate instead.
- A scene that legitimately needs the *same real moment* shown again (e.g.
  a callback shot) is not a violation — this rule targets picking the same
  source out of laziness or a narrow search, not intentional callbacks.
- When manually vetting a `forceYouTubeId` for a scene (see
  `footage-rules.md`), check it isn't already in use by another scene in the
  same project before locking it in.
