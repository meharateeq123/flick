#!/usr/bin/env node
import {readFile, readdir, writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';

const args = process.argv.slice(2);
const valueAfter = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
const project = resolve(valueAfter('--project') || 'flick-output');
const voiceover = valueAfter('--voiceover');
const aspect = valueAfter('--aspect') || '9:16';
const [W, H] = aspect === '16:9' ? [1920, 1080] : aspect === '1:1' ? [1080, 1080] : [1080, 1920];
const out = resolve(project, valueAfter('--out') || 'preview.mp4');

const secondsOf = (segment) => ({
  start: segment.startMs != null ? segment.startMs / 1000 : segment.start ?? 0,
  end: segment.endMs != null ? segment.endMs / 1000 : segment.end ?? 0,
});

async function resolveFfmpeg() {
  try {
    const projectRequire = createRequire(resolve(project, 'remotion', 'package.json'));
    return projectRequire('ffmpeg-static');
  } catch {
    return 'ffmpeg';
  }
}

async function main() {
  const transcript = JSON.parse(await readFile(resolve(project, 'transcript.json'), 'utf8'));
  const segments = transcript.segments || [];
  if (!segments.length) throw new Error('No segments in transcript.json');

  const footageDir = resolve(project, 'brand-assets', 'auto-footage');
  const files = await readdir(footageDir).catch(() => []);

  const SOURCE_LABELS = {
    'youtube-nascar': 'YouTube',
    youtube: 'YouTube',
    'youtube-forced': 'YouTube',
    pexels: 'Pexels',
    pixabay: 'Pixabay',
    wikimedia: 'Wikimedia Commons',
  };
  let sources = {};
  try {
    sources = JSON.parse(await readFile(resolve(footageDir, 'sources.json'), 'utf8'));
  } catch {
    sources = {};
  }

  // Each clip holds until the next scene's start (not just its own end), so silent gaps
  // between transcript segments don't desync the video from the voiceover.
  const clips = segments.map((segment, index) => {
    const scene = index + 1;
    const prefix = `${String(scene).padStart(2, '0')}-`;
    const file = files.find((f) => f.startsWith(prefix) && /\.(mp4|jpg|jpeg|png|webp)$/i.test(f));
    const {start, end} = secondsOf(segment);
    const nextStart = index + 1 < segments.length ? secondsOf(segments[index + 1]).start : end;
    const duration = Math.max(nextStart - start, end - start, 0.5);
    const isImage = file ? /\.(jpg|jpeg|png|webp)$/i.test(file) : false;
    const meta = sources[scene];
    const credit = meta ? meta.title || SOURCE_LABELS[meta.source] || null : null;
    return file ? {path: resolve(footageDir, file), duration, isImage, scene, credit, heading: segment.heading || null} : null;
  });

  const missing = clips.filter((c) => !c).length;
  if (missing)
    console.warn(
      `Warning: ${missing} scene(s) have no downloaded clip/image (reserved for a Remotion motion graphic or failed) and will be skipped in this rough-cut. Run auto-footage.mjs first, or build those scenes in Flick's Step 3.`
    );

  const usable = clips.filter(Boolean);
  if (!usable.length) throw new Error('No clips available to assemble. Run auto-footage.mjs first.');

  const ffmpegBin = await resolveFfmpeg();

  // Each xfade overlap consumes `dur` seconds out of the total timeline (the two clips share
  // that window instead of playing back to back), so N transitions shorten the assembled video
  // by the sum of their durations relative to the sum of per-scene hold times. Precompute that
  // shave here and pad it onto the last scene's hold time so the final output still lines up
  // with the full voiceover instead of the narration getting truncated by `-shortest`.
  let totalShave = 0;
  if (usable.length > 1) {
    for (let i = 1; i < usable.length; i++) {
      totalShave += Math.min(0.4, Math.max(0.05, Math.min(usable[i - 1].duration, usable[i].duration) * 0.4));
    }
    usable[usable.length - 1].duration += totalShave;
  }

  const inputArgs = [];
  const filterParts = [];
  usable.forEach((clip, i) => {
    if (clip.isImage) inputArgs.push('-loop', '1', '-t', String(clip.duration), '-i', clip.path);
    else inputArgs.push('-stream_loop', '-1', '-t', String(clip.duration), '-i', clip.path);
    filterParts.push(
      `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=30[v${i}]`
    );
  });

  // Chain every boundary through a short crossfade instead of a hard concat cut — this is
  // what keeps image scenes (and the video scenes next to them) feeling smooth rather than
  // jump-cut. Duration is clamped to a fraction of the shorter neighboring clip so a very
  // short beat never gets an xfade longer than the clip itself. Track each clip's start time
  // in the *output* timeline as we go, so a source-credit card can be timed to its own scene.
  const outStart = [0];
  const preCardLabel = usable.length === 1 ? 'v0' : 'outv0';
  if (usable.length === 1) {
    filterParts.push(`[v0]null[${preCardLabel}]`);
  } else {
    let prevLabel = 'v0';
    let cum = usable[0].duration;
    for (let i = 1; i < usable.length; i++) {
      const dur = Math.min(0.4, Math.max(0.05, Math.min(usable[i - 1].duration, usable[i].duration) * 0.4));
      const offset = Math.max(0, cum - dur);
      outStart.push(offset);
      const outLabel = i === usable.length - 1 ? preCardLabel : `x${i}`;
      filterParts.push(`[${prevLabel}][v${i}]xfade=transition=fade:duration=${dur.toFixed(3)}:offset=${offset.toFixed(3)}[${outLabel}]`);
      cum = cum + usable[i].duration - dur;
      prevLabel = outLabel;
    }
  }
  const totalDuration = outStart[outStart.length - 1] + usable[usable.length - 1].duration;

  // Small clean source-credit card, bottom-left, timed to each scene that has one — never the
  // source's own baked-in branding (see footage-rules.md).
  // Wrapped in '...' quotes, with `:` backslash-escaped inside them (confirmed by isolated
  // testing via spawnSync — this combination round-trips correctly). A literal apostrophe is the
  // one thing this can't carry: `\'` inside a quoted string is silently swallowed by drawtext
  // (renders "Larsons", not "Larson's") rather than raising an error, so it fails quietly instead
  // of loudly. Swapping it for the Unicode typographic quote (’) sidesteps the problem entirely —
  // it's a different codepoint the parser has no opinion about, and it reads identically.
  const escapeDrawtext = (text) =>
    text.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, '’').replace(/%/g, '\\%');
  // Windows ffmpeg builds usually lack a working fontconfig setup, so drawtext needs an explicit
  // font file or it fails outright.
  const fontfile =
    process.platform === 'win32' ? `C\\:/Windows/Fonts/arial.ttf` : '/System/Library/Fonts/Helvetica.ttc';
  let creditChain = preCardLabel;
  let anyCredits = false;
  usable.forEach((clip, i) => {
    if (!clip.credit) return;
    anyCredits = true;
    const label = `c${i}`;
    const start = outStart[i];
    const end = i + 1 < outStart.length ? outStart[i + 1] : totalDuration;
    const text = escapeDrawtext(`Source: ${clip.credit}`);
    const fontsize = Math.round(H * 0.022);
    const pad = Math.round(H * 0.03);
    filterParts.push(
      `[${creditChain}]drawtext=fontfile='${fontfile}':text='${text}':fontsize=${fontsize}:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=${Math.round(fontsize * 0.5)}:x=${pad}:y=h-th-${pad}:enable='between(t,${start.toFixed(3)},${end.toFixed(3)})'[${label}]`
    );
    creditChain = label;
  });
  // Scene headings — top-safe-area, well clear of the bottom-left credit card so the two never
  // collide. Deliberately sparse: most scenes carry none (see the on-screen text rule in
  // visual-relevancy-rules.md) — only genuinely important lines get a heading, each with a short
  // fade in/out rather than a hard cut.
  let headingChain = anyCredits ? creditChain : preCardLabel;
  usable.forEach((clip, i) => {
    if (!clip.heading) return;
    const label = `h${i}`;
    const start = outStart[i];
    const end = i + 1 < outStart.length ? outStart[i + 1] : totalDuration;
    const fadeIn = Math.min(0.35, (end - start) / 4);
    const text = escapeDrawtext(clip.heading);
    const fontsize = Math.round(H * 0.052);
    const pad = Math.round(H * 0.07);
    const alphaExpr = `if(lt(t,${(start + fadeIn).toFixed(3)}),(t-${start.toFixed(3)})/${fadeIn.toFixed(3)},if(gt(t,${(end - fadeIn).toFixed(3)}),(${end.toFixed(3)}-t)/${fadeIn.toFixed(3)},1))`;
    filterParts.push(
      `[${headingChain}]drawtext=fontfile='${fontfile}':text='${text}':fontsize=${fontsize}:fontcolor=white:borderw=${Math.round(fontsize * 0.09)}:bordercolor=black@0.7:x=${pad}:y=${pad}:alpha='${alphaExpr}':enable='between(t,${start.toFixed(3)},${end.toFixed(3)})'[${label}]`
    );
    headingChain = label;
  });

  filterParts.push(`[${headingChain}]null[outv]`);

  if (voiceover) inputArgs.push('-i', resolve(voiceover));

  // Render to a temp path and rename into place rather than writing `out` directly. If
  // something else (e.g. preview-server.mjs) has `out` open, a direct ffmpeg -y overwrite can
  // fail or get silently skipped on Windows while ffmpeg still exits 0 — the temp+rename makes
  // that failure loud (rename throws) instead of leaving a stale preview.mp4 behind.
  const tmpOut = out.replace(/\.mp4$/, `.tmp-${Date.now()}.mp4`);

  // The filter_complex graph for a 15-scene project is several thousand characters (crossfades +
  // credit cards + headings). Passing that as a single inline CLI argument can exceed Windows'
  // command-line length limit and get silently truncated mid-argument (ffmpeg then reports a
  // nonsense "No such filter" error). -filter_complex_script reads it from a file instead, which
  // has no such limit.
  const filterScriptPath = resolve(tmpdir(), `flick-filter-${Date.now()}.txt`);
  await writeFile(filterScriptPath, filterParts.join(';'), 'utf8');

  const ffArgs = [...inputArgs, '-filter_complex_script', filterScriptPath, '-map', '[outv]'];
  if (voiceover) ffArgs.push('-map', `${usable.length}:a`, '-shortest', '-c:a', 'aac');
  ffArgs.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', tmpOut);

  console.log(`Assembling ${usable.length} scene(s) into ${out} ...`);
  const result = spawnSync(ffmpegBin, ffArgs, {stdio: 'inherit'});
  if (result.error || result.status !== 0) throw new Error('ffmpeg failed to assemble the video.');

  const {rename, unlink} = await import('node:fs/promises');
  try {
    await unlink(out).catch(() => {});
    await rename(tmpOut, out);
  } catch (err) {
    throw new Error(
      `Rendered ok, but couldn't replace ${out} (likely still open in another process, e.g. preview-server.mjs — stop it first). Rendered file is at ${tmpOut}. Original error: ${err.message}`
    );
  }

  console.log(`\nDone: ${out}`);
  if (!voiceover) console.log('No voiceover supplied — this is a silent rough-cut. Re-run with --voiceover <audio-file> once it is ready.');
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
