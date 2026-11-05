#!/usr/bin/env python3
"""
Generate CLEARLY LABELED SYNTHETIC pick-and-place demo clips for RealityTest.

These are computer-generated renderings (not real robot footage). Every frame
carries a visible "SYNTHETIC DEMO" label and the MP4 metadata says so too.
They are original works created for this repository and released under the
repository's MIT license.

Usage:  python3 scripts/make-synthetic-clips.py [out_dir]
Requires: Pillow, ffmpeg on PATH.
"""
import math
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageFilter

W, H, FPS, SECONDS = 960, 540, 30, 8
N = FPS * SECONDS

TABLE_Y = 330  # y of the table "horizon" (back edge)
CUBE = 70  # cube front-face size in px
TRAY = dict(left=600, right=860, top=360, bottom=470)  # tray footprint (front view)


def font(size):
    for p in ("/System/Library/Fonts/Supplemental/Arial Bold.ttf",
              "/System/Library/Fonts/Supplemental/Arial.ttf",
              "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"):
        try:
            return ImageFont.truetype(p, size)
        except OSError:
            continue
    return ImageFont.load_default()


F_LABEL = font(22)
F_SMALL = font(16)


def ease(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def lerp(a, b, t):
    return a + (b - a) * t


def background():
    img = Image.new("RGB", (W, H))
    d = ImageDraw.Draw(img)
    # wall gradient
    for y in range(TABLE_Y):
        c = int(lerp(58, 92, y / TABLE_Y))
        d.line([(0, y), (W, y)], fill=(c, c + 4, c + 10))
    # table gradient (wood-ish)
    for y in range(TABLE_Y, H):
        t = (y - TABLE_Y) / (H - TABLE_Y)
        d.line([(0, y), (W, y)], fill=(int(lerp(150, 120, t)), int(lerp(118, 92, t)), int(lerp(84, 62, t))))
    d.line([(0, TABLE_Y), (W, TABLE_Y)], fill=(90, 70, 50), width=3)
    # robot base on the left back
    d.rounded_rectangle([40, 250, 140, TABLE_Y + 10], radius=10, fill=(70, 74, 82), outline=(40, 42, 48), width=2)
    return img


def draw_tray(d):
    l, r, t, b = TRAY["left"], TRAY["right"], TRAY["top"], TRAY["bottom"]
    depth = 26
    # back rim (top face) as trapezoid
    d.polygon([(l, t), (r, t), (r - 18, t - depth), (l + 18, t - depth)], fill=(40, 90, 200))
    d.polygon([(l + 14, t - 4), (r - 14, t - 4), (r - 26, t - depth + 6), (l + 26, t - depth + 6)], fill=(25, 60, 150))
    # front wall
    d.rectangle([l, t, r, b], fill=(45, 105, 225), outline=(20, 50, 130), width=3)
    d.rectangle([l + 8, t + 8, r - 8, t + 18], fill=(70, 130, 240))


def draw_tray_front(d):
    """Re-draw the tray front wall so a cube 'inside' the tray is partially hidden."""
    l, r, t, b = TRAY["left"], TRAY["right"], TRAY["top"], TRAY["bottom"]
    d.rectangle([l, t + 48, r, b], fill=(45, 105, 225), outline=(20, 50, 130), width=3)


def draw_cube(d, cx, bottom_y):
    s = CUBE
    x0, x1 = cx - s / 2, cx + s / 2
    y1 = bottom_y
    y0 = bottom_y - s
    k = 16  # perspective offset
    d.polygon([(x0, y0), (x1, y0), (x1 + k, y0 - k), (x0 + k, y0 - k)], fill=(235, 70, 60))  # top
    d.polygon([(x1, y0), (x1 + k, y0 - k), (x1 + k, y1 - k), (x1, y1)], fill=(150, 25, 25))  # side
    d.rectangle([x0, y0, x1, y1], fill=(205, 35, 35), outline=(120, 15, 15), width=2)  # front


def draw_shadow(img, cx, ground_y, height_above):
    sh = Image.new("L", (W, H), 0)
    sd = ImageDraw.Draw(sh)
    spread = 42 + height_above * 0.15
    alpha = int(max(40, 120 - height_above * 0.5))
    sd.ellipse([cx - spread, ground_y - 10, cx + spread + 16, ground_y + 8], fill=alpha)
    sh = sh.filter(ImageFilter.GaussianBlur(8))
    dark = Image.new("RGB", (W, H), (30, 22, 16))
    img.paste(dark, (0, 0), sh)


def draw_gripper(d, cx, tip_y, closed):
    # vertical arm from top
    d.rectangle([cx - 12, 0, cx + 12, tip_y - 34], fill=(185, 190, 198), outline=(90, 95, 105), width=2)
    d.rounded_rectangle([cx - 50, tip_y - 40, cx + 50, tip_y - 24], radius=4, fill=(120, 126, 136), outline=(60, 64, 72), width=2)
    gap = CUBE / 2 + 4 if closed else CUBE / 2 + 26
    for sgn in (-1, 1):
        fx = cx + sgn * gap
        d.rectangle([min(fx, fx + sgn * 12), tip_y - 26, max(fx, fx + sgn * 12), tip_y + 30], fill=(70, 74, 82), outline=(30, 32, 36), width=2)


def draw_occluder(d, i):
    """A grey panel slides in front of the tray during the last ~2 seconds."""
    t = i / FPS
    u = ease((t - 5.4) / 0.8)
    if u <= 0:
        return
    x0 = lerp(W + 10, 560, u)
    d.rounded_rectangle([x0, 150, x0 + 360, H - 10], radius=8, fill=(105, 108, 114), outline=(60, 62, 66), width=3)
    d.text((x0 + 24, 170), "OCCLUDER", font=F_SMALL, fill=(200, 200, 200))


def label(d, scenario):
    d.rounded_rectangle([14, 12, 330, 48], radius=6, fill=(0, 0, 0))
    d.text((26, 18), "SYNTHETIC DEMO CLIP", font=F_LABEL, fill=(255, 210, 60))
    txt = f"RealityTest · computer-generated · {scenario}"
    tw = d.textlength(txt, font=F_SMALL)
    d.text((W - tw - 20, 20), txt, font=F_SMALL, fill=(230, 230, 230))


def plan(scenario):
    """Return a function f(i) -> state for frame i."""
    start_x = 230
    ground = 430  # cube bottom on table
    tray_floor = 428  # cube bottom inside tray
    tray_cx = (TRAY["left"] + TRAY["right"]) / 2
    if scenario in ("pass", "occluded"):
        drop_x, drop_y = tray_cx, tray_floor
    else:
        drop_x, drop_y = 470, ground  # released short of the tray, lands on the table
    lift_y = 250

    def state(i):
        t = i / FPS
        # phases (seconds)
        if t < 1.0:  # gripper descends to cube
            gx, gy = start_x, lerp(170, ground - CUBE / 2, ease(t / 1.0))
            return dict(gx=gx, gy=gy, closed=False, cx=start_x, cb=ground, held=False)
        if t < 1.4:  # grasp
            return dict(gx=start_x, gy=ground - CUBE / 2, closed=True, cx=start_x, cb=ground, held=True)
        if t < 2.4:  # lift
            u = ease((t - 1.4) / 1.0)
            cb = lerp(ground, lift_y, u)
            return dict(gx=start_x, gy=cb - CUBE / 2, closed=True, cx=start_x, cb=cb, held=True)
        if t < 4.6:  # carry
            u = ease((t - 2.4) / 2.2)
            cx = lerp(start_x, drop_x, u)
            return dict(gx=cx, gy=lift_y - CUBE / 2, closed=True, cx=cx, cb=lift_y, held=True)
        if t < 5.6:  # lower
            u = ease((t - 4.6) / 1.0)
            cb = lerp(lift_y, drop_y - (0 if scenario == "pass" else 0), u)
            if scenario == "fail":
                # gripper slips: releases mid-way and cube drops to the table
                if u > 0.35:
                    fall = min(1.0, (u - 0.35) / 0.4)
                    cb_free = lerp(lerp(lift_y, drop_y, 0.35), ground, fall * fall)
                    gy = lerp(lift_y, drop_y, 0.35) - CUBE / 2
                    return dict(gx=drop_x, gy=gy, closed=False, cx=drop_x, cb=cb_free, held=False)
            return dict(gx=drop_x, gy=cb - CUBE / 2, closed=True, cx=drop_x, cb=cb, held=True)
        # release and retract
        u = ease((t - 5.6) / 1.4)
        gx = lerp(drop_x, start_x - 40, u)
        gy = lerp((drop_y if scenario != "fail" else lerp(lift_y, drop_y, 0.35)) - CUBE / 2, 140, u)
        return dict(gx=gx, gy=gy, closed=False, cx=drop_x, cb=drop_y, held=False)

    return state


def render(scenario, out_path):
    bg = background()
    st = plan(scenario)
    cmd = [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "slow", "-crf", "20", "-movflags", "+faststart",
        "-metadata", f"title=RealityTest synthetic demo ({scenario})",
        "-metadata", "comment=SYNTHETIC computer-generated clip. Not real robot footage. MIT licensed.",
        str(out_path),
    ]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    for i in range(N):
        s = st(i)
        img = bg.copy()
        d = ImageDraw.Draw(img)
        draw_tray(d)
        in_tray = TRAY["left"] < s["cx"] < TRAY["right"] and s["cb"] >= TRAY["top"]
        draw_shadow(img, s["cx"], 440 if in_tray else 432, max(0, 430 - s["cb"]))
        d = ImageDraw.Draw(img)
        draw_cube(d, s["cx"], s["cb"])
        if in_tray:
            draw_tray_front(d)
        draw_gripper(d, s["gx"], s["gy"], s["closed"])
        if scenario == "occluded":
            draw_occluder(d, i)
        label(d, scenario.upper())
        p.stdin.write(img.tobytes())
    p.stdin.close()
    if p.wait() != 0:
        raise SystemExit(f"ffmpeg failed for {scenario}")
    print("wrote", out_path)


if __name__ == "__main__":
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "public/samples")
    out.mkdir(parents=True, exist_ok=True)
    render("pass", out / "synthetic-pass.mp4")
    render("fail", out / "synthetic-fail.mp4")
    render("occluded", out / "synthetic-occluded.mp4")
