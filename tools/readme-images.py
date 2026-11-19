#!/usr/bin/env python3
"""
README に載せる画像を、撮影した画面（tools/demo.js の出力）から抜粋・連結して作る。
  python3 tools/readme-images.py [日本語版の画面のフォルダ] [英語版の画面のフォルダ]
  例: python3 tools/readme-images.py promo promo/en
      python3 tools/readme-images.py ~/Downloads/scurrop-demo-ja ~/Downloads/scurrop-demo-en   （写真入りの本番の画面）
フォルダの中は <業種>/board.png のような並び（construction・creative・daycare・education）。
出力: public/images/ja/ と public/images/en/（step-・hero-・usecase- で始まる画像は作り直す）。README は、このファイル名を参照している。Pillow が要る（pip install pillow）。
"""
import os, sys
from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SRC = {'ja': sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'promo'),
       'en': sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, 'promo', 'en')}
# 開発用のリポジトリでは public/images、公開用のリポジトリでは、いちばん上の images
OUT = os.path.join(ROOT, 'public', 'images') if os.path.isdir(os.path.join(ROOT, 'public')) else os.path.join(ROOT, 'images')
MAIN = 'creative'                        # 手順の説明に使う業種（映像制作）
CASES = ['creative', 'construction', 'daycare', 'education']
BG = (245, 245, 247)                     # 連結するときの地の色
W = 1600                                 # 横幅

def load(lang, slug, name):
    return Image.open(os.path.join(SRC[lang], slug, name + '.png')).convert('RGB')

def fit(im, width):
    return im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)

def rounded(im, radius):
    mask = Image.new('L', im.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, im.width - 1, im.height - 1), radius, fill=255)
    out = Image.new('RGB', im.size, BG); out.paste(im, (0, 0), mask); return out

def strip(images, height, gap=48, pad=56, radius=28):
    """画面を横に並べる（スマホの画面・メール）。高さをそろえ、角を丸め、うすい枠を付ける。"""
    tiles = []
    for im in images:
        t = im.resize((round(im.width * height / im.height), height), Image.LANCZOS)
        t = rounded(t, radius)
        ImageDraw.Draw(t).rounded_rectangle((0, 0, t.width - 1, t.height - 1), radius, outline=(209, 209, 214), width=2)
        tiles.append(t)
    total = sum(t.width for t in tiles) + gap * (len(tiles) - 1)
    canvas = Image.new('RGB', (max(W, total + pad * 2), height + pad * 2), BG)
    x = (canvas.width - total) // 2
    for t in tiles:
        canvas.paste(t, (x, pad)); x += t.width + gap
    return fit(canvas, W) if canvas.width != W else canvas

def bottom(im):
    """中身のある、いちばん下の位置（白い余白を除く）。"""
    from PIL import ImageChops
    box = ImageChops.difference(im, Image.new('RGB', im.size, im.getpixel((2, im.height - 3)))).getbbox()
    return box[3] if box else im.height

def save(im, lang, name):
    d = os.path.join(OUT, lang); os.makedirs(d, exist_ok=True)
    im.save(os.path.join(d, name + '.png'), optimize=True)

for lang in ('ja', 'en'):
    d = os.path.join(OUT, lang)
    if os.path.isdir(d):
        for f in os.listdir(d):
            if f.endswith('.png') and f.startswith(('step-', 'hero-', 'usecase-')): os.remove(os.path.join(d, f))   # 古い名前の画像を残さない（GIF は、tools/demo-video.py が作るので触らない）
    if not os.path.isdir(os.path.join(SRC[lang], MAIN)):
        print(lang + ': 画面のフォルダが見つかりません（' + SRC[lang] + '）。飛ばします'); continue
    L = lambda name, slug=MAIN: load(lang, slug, name)
    # いちばん上の絵（ライト／ダーク）
    save(fit(L('board'), W), lang, 'hero-light')
    save(fit(L('board-dark'), W), lang, 'hero-dark')
    # 手順
    save(strip([L('first'), L('mail-invite'), L('join')], 900), lang, 'step-start')          # 始める・招待・参加
    # テンプレート・割り当て・通知・スマホ・出力の場面は GIF（tools/demo-video.py --gifs）。ここで作るのは、動かない画面だけ
    save(fit(L('month'), W), lang, 'step-month')
    save(fit(L('tasks'), W), lang, 'step-tasks')                                             # 報告を確認
    # ユースケース（業種ごとのボード）
    for slug in CASES:
        if os.path.isdir(os.path.join(SRC[lang], slug)):
            save(fit(load(lang, slug, 'board'), 1200), lang, 'usecase-' + slug)
    n = len(os.listdir(os.path.join(OUT, lang)))
    print(lang + ': ' + str(n) + ' 枚 → public/images/' + lang + '/')
