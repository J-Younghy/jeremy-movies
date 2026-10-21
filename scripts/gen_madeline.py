#!/usr/bin/env python3
# Celeste 风 Madeline 跑步像素帧 v3 —— 短发红发、蓝外套、蓝裤（致敬原版造型，配色自主微调）
# 用 venv 运行：/Users/Zhuanz/.workbuddy/binaries/python/envs/default/bin/python3 gen_madeline.py
from PIL import Image
import os

C = {
    'H': (0xa8,0x2e,0x3a),  # 头发深红（主体）
    'h': (0xcf,0x3f,0x4b),  # 头发红
    'L': (0xec,0x6a,0x6e),  # 头发亮红（高光）
    'S': (0xff,0xd9,0xae),  # 皮肤
    'E': (0x2b,0x21,0x28),  # 眼睛
    'J': (0x3a,0x52,0xa8),  # 外套蓝（主体）
    'j': (0x4d,0x66,0xbf),  # 外套亮蓝
    'W': (0x2e,0x39,0x5c),  # 裤深蓝
    'w': (0x46,0x52,0x7a),  # 裤亮
    'B': (0x54,0x38,0x2a),  # 鞋棕
    'b': (0x6e,0x4d,0x37),  # 鞋亮棕
}

W = 24
HGT = 26

def pad(rows, h=HGT):
    out = []
    for r in rows:
        out.append(r.ljust(W, '.'))
    while len(out) < h:
        out.append('.' * W)
    return out

# 头（短发 + 面部，接近原版大眼造型）
HEAD = [
"........................",
".......hhhhhhh..........",
"......hHHHHHHHh.........",
".....hHHHHHHHHHh........",
".....hHSSSSSSSHh........",
".....hSSSSSSSSS.........",
".....hSSSESESSS.........",
".....hSSSSSSSSS.........",
"......hSSSSSh...........",
".......hhhhh............",
]

# 躯干：蓝色外套，中间亮色条纹
BODY = [
".......JJJJJJ...........",
"......JJjjjjJJ..........",
"......JJJJJJJJ..........",
"......sJJJJJJs..........",
".......JJJJJ............",
]

# 帧1：右腿前跨（右）、左腿后蹬（左）—— 接触步
F1 = pad(HEAD + BODY + [
".......JJJ..............",
"......WW....WW..........",
".....WWW....WW..........",
".....WW.....WWW.........",
"....WW......WW..........",
"....WW.......w..........",
"....w...................",
"...BBB......BBB.........",
"...bbb......bbb.........",
])

# 帧2：双腿收拢（腾空）
F2 = pad(HEAD + BODY + [
".......JJJ..............",
".......WWWWW............",
".......WWWWW............",
".......wWWWw............",
".......WWWW.............",
".......wwww.............",
".......BBBB.............",
".......bbbb.............",
])

# 帧3：左腿前跨、右腿后蹬（镜像步态）
F3 = pad(HEAD + BODY + [
".......JJJ..............",
"......WW....WW..........",
"......WW....WWW.........",
".....WWW.....WW.........",
".....WW......WW.........",
"......w......WW.........",
".............ww.........",
"....BBB......BBB........",
"....bbb......bbb........",
])

# 帧4：收腿（同帧2）
F4 = pad(HEAD + BODY + [
".......JJJ..............",
".......WWWWW............",
".......WWWWW............",
".......wWWWw............",
".......WWWW.............",
".......wwww.............",
".......BBBB.............",
".......bbbb.............",
])

# 手臂叠加：蓝袖 + 皮肤手
def add_arms(frame_rows, front_arm_dx, back_arm_dx):
    g = [list(r) for r in frame_rows]
    def put(x, y, ch):
        if 0 <= x < W and 0 <= y < len(g):
            g[y][x] = ch
    y0 = 11
    for i in range(3):
        put(11 + i + front_arm_dx, y0 + i, 'J')
    put(14 + front_arm_dx, y0 + 3, 'S')
    for i in range(2):
        put(5 - back_arm_dx - i, y0 + i, 'J')
    put(4 - back_arm_dx, y0 + 2, 'S')
    return [''.join(r) for r in g]

# 短发后飘（帧1/3 上扬、帧2/4 下垂）
def add_hair_tail(rows, lift):
    g = [list(r) for r in rows]
    def put(x, y, ch):
        if 0 <= x < W and 0 <= y < len(g):
            if g[y][x] == '.':
                g[y][x] = ch
    if lift:
        put(4, 2, 'h'); put(3, 2, 'L')
    else:
        put(4, 6, 'h'); put(3, 6, 'L')
    return [''.join(r) for r in g]

F1 = add_arms(add_hair_tail(F1, True),  1, 0)
F2 = add_arms(add_hair_tail(F2, False), 0, 1)
F3 = add_arms(add_hair_tail(F3, True), -1, 0)
F4 = add_arms(add_hair_tail(F4, False), 0, 1)

frames = [F1, F2, F3, F4]

def render(frame):
    img = Image.new('RGBA', (W, HGT), (0,0,0,0))
    px = img.load()
    for y, row in enumerate(frame):
        for x, ch in enumerate(row):
            if ch in C:
                px[x,y] = (*C[ch], 255)
    return img

outdir = "/Users/Zhuanz/Library/Mobile Documents/com~apple~CloudDocs/website/movies/assets/madeline"
os.makedirs(outdir, exist_ok=True)
for i, f in enumerate(frames):
    render(f).save(os.path.join(outdir, f'run-{i}.png'))

sheet = Image.new('RGBA', (W*4, HGT), (0,0,0,0))
for i, f in enumerate(frames):
    sheet.paste(render(f), (i*W, 0))
sheet.resize((W*4*8, HGT*8), Image.NEAREST).save(os.path.join(outdir, '_preview-sheet.png'))
print('ok', outdir)
