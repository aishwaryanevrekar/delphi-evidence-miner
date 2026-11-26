#!/usr/bin/env python3
"""Render docs/demo-transcript.txt into an animated terminal video (mp4 + gif).

Requires: Pillow, ffmpeg.  Run: python3 tools/make_demo.py
The transcript is captured from the real `node bin/agent.mjs demo` command, so
every line shown in the video is genuine CLI output. No API key is involved.
"""
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
TRANSCRIPT = ROOT / "docs" / "demo-transcript.txt"
OUT_DIR = ROOT / "docs"
W, H = 1280, 720
FPS = 24
X0, Y0 = 44, 78
LINE_H = 25
VISIBLE_LINES = 23
WRAP = 116

BG = (13, 17, 23)
BAR = (22, 27, 34)
WHITE = (201, 209, 217)
GREEN = (63, 185, 80)
CYAN = (88, 166, 255)
YELLOW = (210, 153, 74)
DIM = (110, 118, 129)


def font(size):
    for path in ("/System/Library/Fonts/Menlo.ttc", "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"):
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def wrap_lines(text, width=WRAP):
    out = []
    for raw in text.splitlines():
        while len(raw) > width:
            cut = raw.rfind(" ", 0, width)
            if cut < width // 2:
                cut = width
            out.append(raw[:cut].rstrip())
            raw = raw[cut:].lstrip()
        out.append(raw)
    return out


def color_of(line):
    s = line.lstrip()
    if s.startswith("$"):
        return GREEN
    if s.startswith("[praa]"):
        return CYAN
    if s.startswith("DEMO COMPLETE"):
        return GREEN
    if s.startswith("-" * 10):
        return DIM
    if s.startswith("SCORE |"):
        return YELLOW
    return WHITE


def draw_frame(lines, revealed_count, current_partial, t):
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    # title bar
    d.rectangle([0, 0, W, 52], fill=BAR)
    for i, c in enumerate(((255, 95, 86), (255, 189, 46), (39, 201, 63))):
        x = 24 + i * 24
        d.ellipse([x, 18, x + 14, 32], fill=c)
    f_small = font(15)
    d.text((112, 17), "praa  —  delphi evidence mining  —  offline demo", font=f_small, fill=DIM)
    badge = "OFFLINE  •  NO SUBMISSIONS"
    bw = d.textbbox((0, 0), badge, font=f_small)[2]
    d.rounded_rectangle([W - bw - 44, 12, W - 20, 40], radius=8, outline=GREEN, width=1)
    d.text((W - bw - 32, 17), badge, font=f_small, fill=GREEN)

    f = font(17)
    start = max(0, revealed_count - VISIBLE_LINES)
    visible = lines[start:revealed_count]

    for idx, line in enumerate(visible):
        y = Y0 + idx * LINE_H
        text = line
        col = color_of(line)
        # dim the detail lines a little
        if line.startswith("    ") or line.startswith("  - "):
            col = DIM
        d.text((X0, y), text, font=f, fill=col)

    if current_partial:
        idx = revealed_count - start
        if 0 <= idx < VISIBLE_LINES:
            y = Y0 + idx * LINE_H
            col = color_of(current_partial)
            d.text((X0, y), current_partial, font=f, fill=col)
            cw = d.textbbox((0, 0), current_partial, font=f)[2]
            if int(t * 2) % 2 == 0:
                d.rectangle([X0 + cw + 2, y + 2, X0 + cw + 10, y + 20], fill=GREEN)

    # footer
    d.text((X0, H - 34), "source: docs/demo-transcript.txt   |   github.com/aishwaryanevrekar/delphi-evidence-miner", font=font(13), fill=DIM)
    return img


def main():
    if not TRANSCRIPT.exists():
        raise SystemExit("Run `node bin/agent.mjs demo > docs/demo-transcript.txt` first")
    lines = wrap_lines(TRANSCRIPT.read_text(encoding="utf-8"))

    # Build a timeline: each line types out, then a short pause.
    steps = []
    t = 1.0
    for line in lines:
        dur = min(0.65, 0.012 * len(line) + 0.15)
        steps.append((t, t + dur))
        t += dur + 0.10
    total = t + 1.5

    if shutil.which("ffmpeg") is None:
        raise SystemExit("ffmpeg not found")

    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        frame_no = 0
        for n in range(int(total * FPS)):
            t = n / FPS
            revealed = 0
            partial = ""
            for i, (s, e) in enumerate(steps):
                if t >= e:
                    revealed = i + 1
                elif t >= s:
                    frac = (t - s) / max(e - s, 1e-6)
                    partial = lines[i][: max(1, int(len(lines[i]) * frac))]
                    break
                else:
                    break
            frame = draw_frame(lines, revealed, partial, t)
            frame.save(tmp / f"f{frame_no:05d}.png")
            frame_no += 1

        mp4 = OUT_DIR / "demo.mp4"
        subprocess.run([
            "ffmpeg", "-y", "-loglevel", "error",
            "-framerate", str(FPS), "-i", str(tmp / "f%05d.png"),
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "22",
            "-movflags", "+faststart", str(mp4),
        ], check=True)

        gif = OUT_DIR / "demo.gif"
        subprocess.run([
            "ffmpeg", "-y", "-loglevel", "error",
            "-framerate", str(FPS), "-i", str(tmp / "f%05d.png"),
            "-filter_complex",
            "[0:v]scale=720:-1:flags=lanczos,fps=8,split[a][b];[a]palettegen=max_colors=64[p];[b][p]paletteuse=dither=bayer",
            "-loop", "0", str(gif),
        ], check=True)

    print(f"wrote {mp4} ({mp4.stat().st_size // 1024} KB)")
    print(f"wrote {gif} ({gif.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
