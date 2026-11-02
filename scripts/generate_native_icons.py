#!/usr/bin/env python3
"""Regenerate iOS and Android launcher icons from public/flashfood-logo.png."""
from pathlib import Path
import json
from PIL import Image, ImageDraw, ImageOps

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'public/flashfood-logo.png'
IOS = ROOT / 'ios/App/App/Assets.xcassets/AppIcon.appiconset'
ANDROID = ROOT / 'android/app/src/main/res'
RESAMPLE = Image.Resampling.LANCZOS

def full_icon(image, side):
    return ImageOps.fit(image.convert('RGB'), (side, side), RESAMPLE, centering=(.5, .5))

def round_icon(image, side):
    icon = full_icon(image, side).convert('RGBA')
    alpha = Image.new('L', (side, side), 0)
    ImageDraw.Draw(alpha).ellipse((0, 0, side - 1, side - 1), fill=255)
    icon.putalpha(alpha)
    return icon

def adaptive_foreground(image, side):
    w, h = image.size
    emblem = image.crop((int(w * .17), int(h * .17), int(w * .83), int(h * .64))).convert('RGBA')
    data = list(emblem.getdata())
    emblem.putdata([(r, g, b, 0 if max(r, g, b) < 24 else min(255, max(r, g, b) * 5)) for r, g, b, _ in data])
    area = int(side * .62)
    emblem.thumbnail((area, area), RESAMPLE)
    out = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    out.alpha_composite(emblem, ((side - emblem.width)//2, (side - emblem.height)//2))
    return out

def main():
    source = Image.open(SOURCE)
    IOS.mkdir(parents=True, exist_ok=True)
    full_icon(source, 1024).save(IOS / 'AppIcon-512@2x.png', optimize=True)
    (IOS / 'Contents.json').write_text(json.dumps({
        'images': [{'filename': 'AppIcon-512@2x.png', 'idiom': 'universal', 'platform': 'ios', 'size': '1024x1024'}],
        'info': {'author': 'xcode', 'version': 1}
    }, indent=2) + '\n', encoding='utf-8')
    for qualifier, size in [('mdpi',48),('hdpi',72),('xhdpi',96),('xxhdpi',144),('xxxhdpi',192)]:
        directory = ANDROID / ('mipmap-' + qualifier)
        directory.mkdir(parents=True, exist_ok=True)
        full_icon(source, size).save(directory / 'ic_launcher.png', optimize=True)
        round_icon(source, size).save(directory / 'ic_launcher_round.png', optimize=True)
        adaptive_foreground(source, int(size * 2.25)).save(directory / 'ic_launcher_foreground.png', optimize=True)
    color = ANDROID / 'values/ic_launcher_background.xml'
    color.parent.mkdir(parents=True, exist_ok=True)
    color.write_text('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#050505</color>\n</resources>\n', encoding='utf-8')
    print('Generated iOS and Android launch icons from', SOURCE)

if __name__ == '__main__':
    main()
