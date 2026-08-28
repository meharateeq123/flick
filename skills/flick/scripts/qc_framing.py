#!/usr/bin/env python3
"""
QC pass for the Smart Video Framing Rule (see references/smart-framing-rule.md).

For every scene's source clip, renders the frame through the SAME
scale(increase) + centered-crop pipeline assemble-video.mjs uses, at the
start/middle/end of the clip, then runs a Haar-cascade face detector on each
rendered frame. Flags a scene when:
  - a detected face's bounding box touches (or nearly touches) the frame
    edge -> the crop is very likely cutting off part of the face, or
  - the scene's own text/visualHint implies a person (interview/podcast/
    press-conference keywords) but no face was found in any of the 3
    samples -> the crop may have pushed the subject out of frame entirely.

This is a heuristic screen, not a guarantee — it flags scenes worth a human
look, it does not silently "pass" a scene as good.

Usage:
  py -3.14 qc_framing.py --project <path> [--width 1920] [--height 1080]
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

import cv2

PERSON_HINTS = [
    'interview', 'podcast', 'press conference', 'presser', 'talks',
    'speaks', 'reaction', 'guest', 'host', 'crew chief', 'radio',
]


def secs_of(seg):
    if seg.get('startMs') is not None:
        return seg['startMs'] / 1000, seg['endMs'] / 1000
    return seg.get('start', 0), seg.get('end', 0)


def implies_person(seg):
    blob = f"{seg.get('text', '')} {seg.get('visualHint', '')}".lower()
    return any(h in blob for h in PERSON_HINTS)


def render_frame(ffmpeg, clip_path, t, w, h, out_path):
    vf = f"scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},setsar=1"
    cmd = [ffmpeg, '-y', '-ss', str(max(t, 0.05)), '-i', str(clip_path),
           '-frames:v', '1', '-vf', vf, '-pix_fmt', 'yuvj420p', str(out_path), '-v', 'error']
    r = subprocess.run(cmd, capture_output=True)
    return r.returncode == 0 and out_path.exists()


def face_touches_edge(gray, faces, w, h, margin=6):
    flags = []
    for (x, y, fw, fh) in faces:
        touches = x <= margin or y <= margin or (x + fw) >= (w - margin) or (y + fh) >= (h - margin)
        flags.append(touches)
    return flags


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--project', required=True)
    ap.add_argument('--width', type=int, default=1920)
    ap.add_argument('--height', type=int, default=1080)
    ap.add_argument('--ffmpeg', default='ffmpeg')
    args = ap.parse_args()

    project = Path(args.project).resolve()
    transcript = json.loads((project / 'transcript.json').read_text(encoding='utf-8'))
    segments = transcript.get('segments', [])
    footage_dir = project / 'brand-assets' / 'auto-footage'

    cascade_path = cv2.data.haarcascades + 'haarcascade_frontalface_default.xml'
    detector = cv2.CascadeClassifier(cascade_path)

    tmp_dir = Path.cwd() / '.qc_framing_tmp'
    tmp_dir.mkdir(exist_ok=True)

    flagged = []
    print(f"QC framing check — {len(segments)} scenes, canvas {args.width}x{args.height}\n")

    for i, seg in enumerate(segments):
        scene = i + 1
        prefix = f"{scene:02d}-"
        matches = sorted(footage_dir.glob(f"{prefix}*.mp4"))
        if not matches:
            continue
        clip = matches[0]

        start, end = secs_of(seg)
        dur = max(end - start, 0.5)
        sample_times = [0.15, dur * 0.5, dur * 0.85]

        scene_faces_found = 0
        scene_edge_hits = []

        for si, t in enumerate(sample_times):
            frame_path = tmp_dir / f"s{scene:02d}_{si}.jpg"
            if not render_frame(args.ffmpeg, clip, t, args.width, args.height, frame_path):
                continue
            img = cv2.imread(str(frame_path))
            if img is None:
                continue
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            faces = detector.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(60, 60))
            if len(faces):
                scene_faces_found += 1
                edge_flags = face_touches_edge(gray, faces, args.width, args.height)
                if any(edge_flags):
                    scene_edge_hits.append(si)

        text_preview = (seg.get('text') or '')[:55]
        person_expected = implies_person(seg)

        problems = []
        if scene_edge_hits:
            problems.append(f"face touches frame edge in sample(s) {scene_edge_hits} (start=0/mid=1/end=2)")
        if person_expected and scene_faces_found == 0:
            problems.append("text/visualHint implies a person but no face detected in any sample")

        status = 'FLAG' if problems else 'ok'
        print(f"scene {scene:2d} [{status}] {clip.name}")
        print(f"           \"{text_preview}\"")
        if problems:
            for p in problems:
                print(f"           -> {p}")
            flagged.append({'scene': scene, 'file': clip.name, 'problems': problems})

    print(f"\n{len(flagged)} of {len(segments)} scene(s) flagged for a manual framing check.")
    if flagged:
        print("Flagged scenes:", ', '.join(str(f['scene']) for f in flagged))

    for f in tmp_dir.glob('*.jpg'):
        pass  # leave samples on disk for manual inspection; caller can rm .qc_framing_tmp when done

    sys.exit(1 if flagged else 0)


if __name__ == '__main__':
    main()
