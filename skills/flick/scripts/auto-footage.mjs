#!/usr/bin/env node
import {mkdir, readFile, readdir, stat, writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {dirname, extname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {findPython, pythonInstallGuidance} from './python.mjs';

const args = process.argv.slice(2);
const valueAfter = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
const project = resolve(valueAfter('--project') || 'flick-output');
const maxClipSeconds = Number(valueAfter('--max-seconds') || 10);
const motionOverride = new Set(
  (valueAfter('--motion-scenes') || '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => n > 0)
);
// --only 6,10 re-processes just those scene numbers (e.g. to redo a scene the user flagged
// as wrong) and leaves every other already-downloaded scene file untouched.
const onlyScenes = new Set(
  (valueAfter('--only') || '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => n > 0)
);
const here = resolve(fileURLToPath(new URL('.', import.meta.url)));

// --- visual priority: video is the default for every line. Video always wins over image, ---
// --- image always wins over motion graphic. Nothing is picked just to fill a percentage. ---

const SENTENCE_STARTERS = new Set([
  'The', 'This', 'That', 'These', 'Those', 'So', 'It', 'A', 'An', 'Then', 'And', 'But', 'If', 'When', 'While',
  'In', 'On', 'At', 'For', 'To', 'With', 'As', 'By', 'After', 'Before', 'During', 'Since', 'Under', 'Over', 'From',
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December',
]);

// Heuristic proper-noun detector: 2-4 consecutive Title-Case words (e.g. "Dale Earnhardt",
// "Michael Jordan", "Albert Einstein"). A named subject means the visual must show that exact
// person, not generic footage.
function detectPerson(text) {
  const matches = [...text.matchAll(/\b([A-Z][a-zA-Z.'-]*(?:\s+[A-Z][a-zA-Z.'-]*){1,3})\b/g)];
  const candidates = matches
    .map((m) => m[1])
    .filter((phrase) => {
      const firstWord = phrase.split(/\s+/)[0];
      return !SENTENCE_STARTERS.has(firstWord);
    });
  if (!candidates.length) return null;
  return candidates.sort((a, b) => b.length - a.length)[0];
}

// Data-driven lines (exact stats, percentages, dates/timelines, comparisons) are the only
// case where a motion graphic (chart/number animation) can beat real footage.
function isDataDriven(text) {
  return (
    /\d+%/.test(text) ||
    /\bpercent\b/i.test(text) ||
    /\b(19|20)\d{2}\b/.test(text) ||
    /\b\d[\d,]{2,}\b/.test(text) ||
    /\b(million|billion|thousand)\b/i.test(text) ||
    /\bfrom\s+[\d,.]+\s+to\s+[\d,.]+/i.test(text) ||
    /\b(increased|decreased|grew|rose|fell|doubled|tripled|compared to|versus|vs\.?)\b/i.test(text)
  );
}

// --- env / API keys -------------------------------------------------------

async function loadEnv() {
  const candidates = [resolve(project, '.env'), resolve(here, '..', '..', '..', '.env')];
  for (const path of candidates) {
    try {
      const text = await readFile(path, 'utf8');
      for (const line of text.split(/\r?\n/)) {
        const match = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
        if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
      }
    } catch {
      // no .env at this location, skip
    }
  }
}

// --- text helpers -----------------------------------------------------------

const STOPWORDS = new Set(
  'a an the is are was were be been being this that these those it its it\'s and or but so if then than to of in on at for with as by from up down out over under again once here there all any both each few more most other some such no nor not only own same too very s t just don now i we you he she they them his her their your my our'.split(
    ' '
  )
);

// A short/ambiguous scene query (e.g. "goal", "closer racing") searched on its own can match
// completely unrelated content (a soccer goal instead of a NASCAR rule change). Anchoring it
// with the transcript's dominant topic keeps the search on-subject.
function topicHintFrom(fullText) {
  const counts = {};
  for (const m of fullText.matchAll(/\b[A-Z]{2,}\b|\b[A-Z][a-z]+\b/g)) {
    const word = m[0];
    if (SENTENCE_STARTERS.has(word) || word.length < 3) continue;
    counts[word] = (counts[word] || 0) + 1;
  }
  const [top] = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return top?.[0];
}

const queryFor = (text, topic) => {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word && !STOPWORDS.has(word))
    .slice(0, 6);
  if (topic && words.length < 3 && !words.includes(topic.toLowerCase())) words.unshift(topic.toLowerCase());
  return words.join(' ');
};

const slug = (text) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 40) || 'scene';

// transcript.json from Flick's Whisper pipeline uses startMs/endMs; hand-authored transcripts
// may use start/end in seconds. Support both.
const secondsOf = (segment) => ({
  start: segment.startMs != null ? segment.startMs / 1000 : segment.start ?? 0,
  end: segment.endMs != null ? segment.endMs / 1000 : segment.end ?? 0,
});

// --- ffmpeg -----------------------------------------------------------------

async function resolveFfmpeg() {
  try {
    const projectRequire = createRequire(resolve(project, 'remotion', 'package.json'));
    return projectRequire('ffmpeg-static');
  } catch {
    return 'ffmpeg';
  }
}

function trimToFile(ffmpegBin, sourceUrlOrPath, outPath, clipSeconds) {
  const debug = !!process.env.FLICK_DEBUG;
  const attempt = (extraArgs) =>
    spawnSync(
      ffmpegBin,
      ['-y', '-i', sourceUrlOrPath, '-t', String(clipSeconds), ...extraArgs, outPath],
      {stdio: debug ? ['ignore', 'pipe', 'pipe'] : 'ignore'}
    );
  let result = attempt(['-c', 'copy']);
  if (result.error || result.status !== 0) {
    if (debug) console.log(`    [debug] ffmpeg copy failed: ${result.error?.message || result.stderr?.toString().slice(-400)}`);
    result = attempt(['-c:v', 'libx264', '-c:a', 'aac']);
    if (debug && (result.error || result.status !== 0))
      console.log(`    [debug] ffmpeg reencode failed: ${result.error?.message || result.stderr?.toString().slice(-400)}`);
  }
  return !result.error && result.status === 0;
}

// --- source: YouTube (yt-dlp) ------------------------------------------------

function runYtDlpDownload(python, target, outPath, clipSeconds, ffmpegLocation, extraArgs = [], introSkip = 0) {
  const base = outPath.replace(/\.mp4$/, '');
  const searchArgs = [
    ...python.prefix,
    '-m',
    'yt_dlp',
    target,
    '--match-filter',
    'duration < 900',
    '-f',
    'bv*[height<=1080]+ba/b[height<=1080]/bv*+ba/b',
    '--merge-output-format',
    'mp4',
    '--download-sections',
    `*${introSkip}-${introSkip + clipSeconds}`,
    '--force-keyframes-at-cuts',
    '--force-overwrites',
    ...extraArgs,
    ...(ffmpegLocation ? ['--ffmpeg-location', ffmpegLocation] : []),
    '-o',
    `${base}.%(ext)s`,
  ];
  const result = spawnSync(python.command, searchArgs, {stdio: 'ignore'});
  return !result.error && result.status === 0;
}

// --- relevancy ranking -------------------------------------------------------
// A blind "take the first search result" pick is exactly what the strict-relevancy rule
// forbids. Instead: pull several candidate titles, score each against the narration
// (+ the named subject, if any), and only download the best-scoring one. If nothing scores
// above zero, the source is treated as a miss rather than silently keeping a bad guess.

function searchYouTubeCandidates(python, target, count, extraArgs = []) {
  const args = [
    ...python.prefix,
    '-m',
    'yt_dlp',
    target,
    '--flat-playlist',
    '--match-filter',
    'duration < 900',
    '--print',
    '%(id)s\t%(title)s\t%(duration)s',
    ...extraArgs,
  ];
  const result = spawnSync(python.command, args, {encoding: 'utf8'});
  if (result.error || result.status !== 0 || !result.stdout) return [];
  return result.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [id, title, duration] = line.split('\t');
      return {id, title: title || '', duration: Number(duration) || 0};
    })
    .filter((c) => c.id && c.title && c.title !== 'NA')
    .slice(0, count);
}

// Simulator/video-game footage would be misleading if used to represent a real event —
// never truthful, so it's rejected outright rather than merely down-ranked.
const SIM_DISQUALIFIERS = ['iracing', 'sim racing', 'simracing', 'video game', 'rfactor', 'assetto corsa', 'gran turismo', 'forza', 'nascar heat', 'nascar 21', 'simulator'];

function scoreCandidateTitle(title, queryWords, personName) {
  const lower = title.toLowerCase();
  if (SIM_DISQUALIFIERS.some((term) => lower.includes(term))) return -Infinity;
  let score = 0;
  for (const word of queryWords) {
    if (word.length > 2 && lower.includes(word)) score += 1;
  }
  if (personName) {
    const surname = personName.split(/\s+/).pop().toLowerCase();
    if (lower.includes(personName.toLowerCase())) score += 6;
    else if (surname.length > 2 && lower.includes(surname)) score += 4;
    else score -= 3; // named-subject scene but this candidate doesn't mention them at all
  }
  return score;
}

function pickBestCandidate(candidates, query, personName) {
  const queryWords = query.toLowerCase().split(/\s+/).filter(Boolean);
  let best = null;
  let bestScore = -Infinity;
  for (const candidate of candidates) {
    const score = scoreCandidateTitle(candidate.title, queryWords, personName);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  // Require at least one real keyword match (or, for a named subject, don't accept a
  // candidate that scored negative for omitting that person entirely).
  if (!best || bestScore <= 0) return null;
  return best;
}

// Prefer real footage from NASCAR's own official channel, but this is one candidate source
// among several (see visual-relevancy-rules.md) — never the only place searched.
function fromYouTubeChannel(python, handle, query, outPath, clipSeconds, ffmpegLocation, personName, introSkip = 0) {
  const target = `https://www.youtube.com/${handle}/search?query=${encodeURIComponent(query)}`;
  const candidates = searchYouTubeCandidates(python, target, 5, ['--playlist-end', '5']);
  const best = pickBestCandidate(candidates, query, personName);
  dlog('youtube-nascar candidates', candidates.map((c) => c.title.slice(0, 60)), '-> picked', best?.title?.slice(0, 60) ?? 'none');
  if (!best) return false;
  const ok = runYtDlpDownload(python, `https://www.youtube.com/watch?v=${best.id}`, outPath, clipSeconds, ffmpegLocation, ['--no-playlist'], introSkip);
  return ok ? best.title : false;
}

function fromYouTube(python, query, outPath, clipSeconds, ffmpegLocation, personName, introSkip = 0) {
  const candidates = searchYouTubeCandidates(python, `ytsearch5:${query}`, 5);
  const best = pickBestCandidate(candidates, query, personName);
  dlog('youtube candidates', candidates.map((c) => c.title.slice(0, 60)), '-> picked', best?.title?.slice(0, 60) ?? 'none');
  if (!best) return false;
  const ok = runYtDlpDownload(python, `https://www.youtube.com/watch?v=${best.id}`, outPath, clipSeconds, ffmpegLocation, ['--no-playlist'], introSkip);
  return ok ? best.title : false;
}

// --- source: Pexels -----------------------------------------------------------

const dlog = (...args) => {
  if (process.env.FLICK_DEBUG) console.log('    [debug]', ...args);
};

async function fromPexels(query, outPath, clipSeconds, ffmpegBin) {
  const key = process.env.PEXELS_API_KEY;
  if (!key) return false;
  const res = await fetch(`https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=1&orientation=portrait`, {
    headers: {Authorization: key},
  });
  dlog('pexels video status', res.status);
  if (!res.ok) return false;
  const data = await res.json();
  const video = data.videos?.[0];
  const file = video?.video_files?.find((f) => f.file_type === 'video/mp4') || video?.video_files?.[0];
  dlog('pexels video match', !!file?.link, data.videos?.length ?? 0, 'results');
  if (!file?.link) return false;
  return trimToFile(ffmpegBin, file.link, outPath, clipSeconds);
}

// --- source: Pixabay ------------------------------------------------------------

async function fromPixabay(query, outPath, clipSeconds, ffmpegBin) {
  const key = process.env.PIXABAY_API_KEY;
  if (!key) return false;
  const res = await fetch(`https://pixabay.com/api/videos/?key=${key}&q=${encodeURIComponent(query)}&per_page=3`);
  dlog('pixabay video status', res.status);
  if (!res.ok) return false;
  const data = await res.json();
  const hit = data.hits?.[0];
  const url = hit?.videos?.medium?.url || hit?.videos?.small?.url;
  dlog('pixabay video match', !!url, data.totalHits ?? 0, 'results');
  if (!url) return false;
  return trimToFile(ffmpegBin, url, outPath, clipSeconds);
}

// --- source: Wikimedia Commons -----------------------------------------------

async function fromWikimedia(query, outPath, clipSeconds, ffmpegBin) {
  const searchRes = await fetch(
    `https://commons.wikimedia.org/w/api.php?action=query&list=search&srnamespace=6&srsearch=${encodeURIComponent(
      `${query} filetype:video`
    )}&format=json&srlimit=1`
  );
  if (!searchRes.ok) return false;
  const searchData = await searchRes.json();
  const title = searchData.query?.search?.[0]?.title;
  if (!title) return false;

  const infoRes = await fetch(
    `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(
      title
    )}&prop=imageinfo&iiprop=url&format=json`
  );
  if (!infoRes.ok) return false;
  const infoData = await infoRes.json();
  const pages = infoData.query?.pages || {};
  const url = Object.values(pages)[0]?.imageinfo?.[0]?.url;
  if (!url) return false;
  return trimToFile(ffmpegBin, url, outPath, clipSeconds);
}

// --- image sources -------------------------------------------------------------

async function downloadFile(url, outPath) {
  const res = await fetch(url);
  if (!res.ok) return false;
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!buffer.length) return false;
  await writeFile(outPath, buffer);
  return true;
}

async function imageFromPexels(query, outPath) {
  const key = process.env.PEXELS_API_KEY;
  if (!key) return false;
  const res = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=1&orientation=portrait`, {
    headers: {Authorization: key},
  });
  if (!res.ok) return false;
  const data = await res.json();
  const url = data.photos?.[0]?.src?.large;
  if (!url) return false;
  return downloadFile(url, outPath);
}

async function imageFromPixabay(query, outPath) {
  const key = process.env.PIXABAY_API_KEY;
  if (!key) return false;
  const res = await fetch(`https://pixabay.com/api/?key=${key}&q=${encodeURIComponent(query)}&image_type=photo&per_page=3`);
  if (!res.ok) return false;
  const data = await res.json();
  const url = data.hits?.[0]?.largeImageURL;
  if (!url) return false;
  return downloadFile(url, outPath);
}

async function imageFromWikimedia(query, outPath) {
  const searchRes = await fetch(
    `https://commons.wikimedia.org/w/api.php?action=query&list=search&srnamespace=6&srsearch=${encodeURIComponent(
      query
    )}&format=json&srlimit=3`
  );
  if (!searchRes.ok) return false;
  const searchData = await searchRes.json();
  for (const hit of searchData.query?.search || []) {
    if (!/\.(jpe?g|png|webp)$/i.test(hit.title)) continue;
    const infoRes = await fetch(
      `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(
        hit.title
      )}&prop=imageinfo&iiprop=url&format=json`
    );
    if (!infoRes.ok) continue;
    const infoData = await infoRes.json();
    const pages = infoData.query?.pages || {};
    const url = Object.values(pages)[0]?.imageinfo?.[0]?.url;
    if (url) return downloadFile(url, outPath);
  }
  return false;
}

// --- main --------------------------------------------------------------------

async function main() {
  await loadEnv();
  const python = findPython();
  if (!python) throw new Error(`Python 3 was not found. ${pythonInstallGuidance()}`);

  const transcriptPath = resolve(project, 'transcript.json');
  const transcript = JSON.parse(await readFile(transcriptPath, 'utf8'));
  const segments = transcript.segments || [];
  if (!segments.length) throw new Error(`No segments found in ${transcriptPath}`);
  const topicHint = topicHintFrom(transcript.text || segments.map((s) => s.text).join(' '));

  const outDir = resolve(project, 'brand-assets', 'auto-footage');
  await mkdir(outDir, {recursive: true});

  const ffmpegBin = await resolveFfmpeg();
  const ffmpegLocation = ffmpegBin === 'ffmpeg' ? undefined : dirname(ffmpegBin);

  // Source order for video: NASCAR's own official YouTube channel first, then a global
  // YouTube search, then stock APIs, then Wikimedia.
  const clipSources = [
    {name: 'youtube-nascar', run: (query, outPath, clipSeconds, person, introSkip) => fromYouTubeChannel(python, '@NASCAR', query, outPath, clipSeconds, ffmpegLocation, person, introSkip)},
    {name: 'youtube', run: (query, outPath, clipSeconds, person, introSkip) => fromYouTube(python, query, outPath, clipSeconds, ffmpegLocation, person, introSkip)},
    {name: 'pexels', run: (query, outPath, clipSeconds) => fromPexels(query, outPath, clipSeconds, ffmpegBin)},
    {name: 'pixabay', run: (query, outPath, clipSeconds) => fromPixabay(query, outPath, clipSeconds, ffmpegBin)},
    {name: 'wikimedia', run: (query, outPath, clipSeconds) => fromWikimedia(query, outPath, clipSeconds, ffmpegBin)},
  ];
  const imageSources = [
    {name: 'pexels', run: (query, outPath) => imageFromPexels(query, outPath)},
    {name: 'pixabay', run: (query, outPath) => imageFromPixabay(query, outPath)},
    {name: 'wikimedia', run: (query, outPath) => imageFromWikimedia(query, outPath)},
  ];

  // A video source returns the matched title on success (so a source-credit card can name the
  // real show/video, not just "YouTube"), or plain `true`/`false` for sources that don't have
  // a title (Pexels/Pixabay/Wikimedia/images).
  const tryDownload = async (sources, query, outPath) => {
    for (const source of sources) {
      process.stdout.write(`  trying ${source.name}... `);
      let ok = false;
      try {
        ok = await source.run(query, outPath);
      } catch (err) {
        if (process.env.FLICK_DEBUG) console.log(`    [debug] ${source.name} threw: ${err.message}`);
        ok = false;
      }
      if (ok) {
        try {
          const info = await stat(outPath);
          if (info.size > 0) {
            console.log('ok');
            return {name: source.name, title: typeof ok === 'string' ? ok : null};
          }
        } catch {
          // fall through to skip
        }
      }
      console.log('skip');
    }
    return null;
  };

  const results = [];
  for (const [index, segment] of segments.entries()) {
    const scene = index + 1;
    if (onlyScenes.size && !onlyScenes.has(scene)) continue;
    const forcedMotion = motionOverride.has(scene);
    const person = detectPerson(segment.text);
    // An optional per-scene visualHint (e.g. "in-car cockpit camera") biases the search toward
    // a specific shot type the narration alone wouldn't suggest.
    const hintedText = segment.visualHint ? `${segment.visualHint} ${segment.text}` : segment.text;
    const generalQuery = queryFor(hintedText, topicHint) || 'b-roll footage';
    const videoQuery = person || generalQuery;
    const name = `${String(scene).padStart(2, '0')}-${slug(segment.text)}`;
    const {start, end} = secondsOf(segment);
    const sceneDuration = end > start ? end - start : maxClipSeconds;
    const clipSeconds = Math.min(sceneDuration, maxClipSeconds);

    console.log(`Scene ${scene}: "${segment.text.slice(0, 60)}"${person ? ` [subject: ${person}]` : ''}`);

    if (forcedMotion) {
      console.log('  forced motion graphic (--motion-scenes) -> no download.');
      results.push({scene, query: videoQuery, file: null, source: 'motion-graphic'});
      continue;
    }

    // 1. Always attempt real video footage first — the default for almost every line.
    const videoPath = resolve(outDir, `${name}.mp4`);
    const introSkip = Number(segment.introSkipSeconds) || 0;

    // A manually-vetted exact video ID (e.g. after reviewing candidates and rejecting one for
    // baked-in branding) bypasses search entirely and downloads straight from that video.
    if (segment.forceYouTubeId) {
      console.log(`  using forced YouTube video: ${segment.forceYouTubeId} (intro skip ${introSkip}s)`);
      const ok = runYtDlpDownload(
        python,
        `https://www.youtube.com/watch?v=${segment.forceYouTubeId}`,
        videoPath,
        clipSeconds,
        ffmpegLocation,
        ['--no-playlist'],
        introSkip
      );
      if (ok) {
        results.push({scene, query: videoQuery, file: `${name}.mp4`, source: 'youtube-forced', title: segment.forceYouTubeTitle || null, mode: 'clip'});
        continue;
      }
      console.log('  forced video download failed, falling back to normal search.');
    }

    const videoSource = await tryDownload(
      clipSources.map((s) => ({name: s.name, run: (q, out) => s.run(q, out, clipSeconds, person, introSkip)})),
      videoQuery,
      videoPath
    );
    if (videoSource) {
      results.push({scene, query: videoQuery, file: `${name}.mp4`, source: videoSource.name, title: videoSource.title, mode: 'clip'});
      continue;
    }

    // 2. No usable clip. A named person needs their authentic image, not generic footage.
    if (person) {
      const imgPath = resolve(outDir, `${name}.jpg`);
      const imgSource = await tryDownload(imageSources, person, imgPath);
      if (imgSource) {
        results.push({scene, query: person, file: `${name}.jpg`, source: imgSource.name, title: imgSource.title, mode: 'image'});
        continue;
      }
    }

    // 3. Exact stats/dates/comparisons that footage can't convey become a motion graphic.
    if (isDataDriven(segment.text)) {
      console.log('  data-driven line, no clip available -> reserved for Flick motion graphic.');
      results.push({scene, query: generalQuery, file: null, source: 'motion-graphic'});
      continue;
    }

    // 4. Last resort: a relevant still image beats leaving the scene empty.
    const imgPath = resolve(outDir, `${name}.jpg`);
    const imgSource = await tryDownload(imageSources, generalQuery, imgPath);
    if (imgSource) {
      results.push({scene, query: generalQuery, file: `${name}.jpg`, source: imgSource.name, title: imgSource.title, mode: 'image'});
      continue;
    }

    console.log('  nothing found -> reserved for Flick motion graphic.');
    results.push({scene, query: generalQuery, file: null, source: 'motion-graphic'});
  }

  const counts = results.reduce((acc, r) => ({...acc, [r.source === 'motion-graphic' ? 'motion' : r.file ? 'downloaded' : 'failed']: (acc[r.source === 'motion-graphic' ? 'motion' : r.file ? 'downloaded' : 'failed'] || 0) + 1}), {});
  console.log('\nAuto-footage summary:');
  for (const row of results) {
    console.log(`  scene ${row.scene}: ${row.file ? `${row.file} (${row.source})` : row.source === 'motion-graphic' ? 'RESERVED FOR MOTION GRAPHIC' : 'FAILED'} (query: "${row.query}")`);
  }
  console.log(`\n${counts.downloaded || 0} downloaded, ${counts.motion || 0} reserved for motion graphics, ${counts.failed || 0} failed.`);
  console.log(`Saved to ${outDir}`);

  // Persist source/title per scene so assemble-video.mjs can render a small clean source-credit
  // card instead of relying on (or keeping) whatever branding the source clip carried — merge
  // with any existing file so a --only rerun doesn't wipe out other scenes' records.
  const sourcesPath = resolve(outDir, 'sources.json');
  let existing = {};
  try {
    existing = JSON.parse(await readFile(sourcesPath, 'utf8'));
  } catch {
    existing = {};
  }
  for (const row of results) {
    existing[row.scene] = {source: row.source, title: row.title || null, query: row.query};
  }
  await writeFile(sourcesPath, JSON.stringify(existing, null, 2) + '\n', 'utf8');
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
