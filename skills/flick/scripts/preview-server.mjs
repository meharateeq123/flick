#!/usr/bin/env node
import {createServer} from 'node:http';
import {readFile, readdir, stat} from 'node:fs/promises';
import {extname, resolve} from 'node:path';

const args = process.argv.slice(2);
const valueAfter = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
const project = resolve(valueAfter('--project') || 'flick-output');
const port = Number(valueAfter('--port') || 5500);
const footageDir = resolve(project, 'brand-assets', 'auto-footage');

const MIME = {'.mp4': 'video/mp4', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp'};

async function loadSegments() {
  try {
    const transcript = JSON.parse(await readFile(resolve(project, 'transcript.json'), 'utf8'));
    return transcript.segments || [];
  } catch {
    return [];
  }
}

async function buildIndexHtml() {
  const segments = await loadSegments();
  const files = await readdir(footageDir).catch(() => []);
  const finalPath = resolve(project, 'preview.mp4');
  const finalExists = await stat(finalPath).then(() => true).catch(() => false);
  const finalBlock = finalExists
    ? `<h1>Final assembled video</h1>
       <video src="/final.mp4" controls preload="auto" style="width:100%;max-width:900px;border-radius:8px;background:#000"></video>`
    : '';
  const rows = segments
    .map((segment, i) => {
      const scene = i + 1;
      const prefix = `${String(scene).padStart(2, '0')}-`;
      const file = files.find((f) => f.startsWith(prefix));
      const isImage = file ? /\.(jpg|jpeg|png|webp)$/i.test(file) : false;
      const media = !file
        ? `<div class="pending">waiting / reserved for motion graphic…</div>`
        : isImage
        ? `<img src="/media/${encodeURIComponent(file)}" loading="lazy">`
        : `<video src="/media/${encodeURIComponent(file)}" controls muted loop autoplay playsinline preload="auto"></video>`;
      return `
        <div class="scene">
          <div class="meta">Scene ${scene} <span class="time">${(segment.startMs / 1000).toFixed(1)}s–${(segment.endMs / 1000).toFixed(1)}s</span></div>
          <div class="text">${(segment.text || '').replace(/</g, '&lt;')}</div>
          ${media}
          <div class="file">${file || ''}</div>
        </div>`;
    })
    .join('\n');

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Flick preview</title>
<style>
  body{font-family:system-ui,sans-serif;background:#111;color:#eee;margin:0;padding:20px}
  h1{font-size:18px;color:#9cf}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px}
  .scene{background:#1c1c1c;border-radius:8px;padding:10px;border:1px solid #333}
  .meta{font-size:12px;color:#9cf;margin-bottom:4px}
  .time{color:#888;margin-left:6px}
  .text{font-size:13px;margin-bottom:8px;color:#ddd}
  video,img{width:100%;border-radius:4px;background:#000;max-height:280px;object-fit:cover}
  .pending{color:#666;font-style:italic;padding:40px 0;text-align:center;border:1px dashed #444;border-radius:4px}
  .file{font-size:10px;color:#666;margin-top:4px;word-break:break-all}
  button{background:#264;color:#eee;border:1px solid #386;border-radius:6px;padding:8px 16px;font-size:14px;cursor:pointer;margin-bottom:16px}
  button:hover{background:#375}
</style>
</head><body>
${finalBlock}
<h1>Flick auto-footage preview (per-scene clips)</h1>
<button onclick="location.reload()">Refresh</button>
<div class="grid">${rows}</div>
</body></html>`;
}

createServer(async (req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
    res.end(await buildIndexHtml());
    return;
  }
  if (req.url === '/final.mp4') {
    const filePath = resolve(project, 'preview.mp4');
    try {
      const info = await stat(filePath);
      const buf = await readFile(filePath);
      res.writeHead(200, {'Content-Type': 'video/mp4', 'Content-Length': info.size});
      res.end(buf);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
    return;
  }
  if (req.url.startsWith('/media/')) {
    const name = decodeURIComponent(req.url.slice('/media/'.length));
    const filePath = resolve(footageDir, name);
    if (!filePath.startsWith(footageDir)) {
      res.writeHead(403);
      res.end('forbidden');
      return;
    }
    try {
      const info = await stat(filePath);
      const buf = await readFile(filePath);
      res.writeHead(200, {'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream', 'Content-Length': info.size});
      res.end(buf);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
    return;
  }
  res.writeHead(404);
  res.end('not found');
}).listen(port, () => {
  console.log(`Flick preview server: http://localhost:${port}`);
});
