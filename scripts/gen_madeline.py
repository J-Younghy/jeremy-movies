#!/usr/bin/env python3
# Celeste 风格 Madeline 跑步像素帧 v2 —— 侧视、长发后飘、大跨步
from PIL import Image
import os

C = {
    'H': (0xa8,0x32,0x3c),  # 头发深红（主体）
    'h': (0xc9,0x44,0x44),  # 头发红
    'L': (0xe5,0x60,0x55),  # 头发亮红（高光/发梢）
    'S': (0xff,0xd9,0xae),  # 皮肤
    'E': (0x30,0x24,0x2c),  # 眼睛
    'J': (0x3d,0x51,0xa0),  # 外套
    'j': (0x4c,0x62,0xb8),  # 外套亮
    'W': (0x33,0x33,0x3e),  # 裤
    'B': (0x5c,0x3d,0x2b),  # 鞋
}

W = 24  # 画布宽

def pad(rows, h=26):
    out = []
    for r in rows:
        out.append(r.ljust(W, '.'))
    while len(out) < h:
        out.append('.' * W)
    return out

# 头 + 躯干（各帧共用，发梢随帧微调）
HEAD = [
"........................",
"......hhhhhh............",
".....hHHHHHHh...........",
"....hHHHHHHHHh..........",
"...hHHHHHHHHHHh.........",
"...hHHHSSSSSHh..........",
"...hHHSSSSESSh..........",
"...hHHHSSSSSh...........",
"....hSSSSSSS............",
".....sssss..............",
]
BODY = [
"......JJJJJJ............",
".....JJjjjjJJ...........",
".....JJJJJJJJ...........",
".....sJJJJJJs...........",
"......JJJJJ.............",
]

def legs_stride(front_dx):  # front_dx: 前腿偏移
    pass

# 帧1：右腿前跨、左腿后蹬、左臂前右臂后
F1 = pad(HEAD + BODY + [
"......JJJ...............",
"......WW..WWW...........",
"......WW...WWW..........",
".....WWW....WW..........",
".....WW.....WW..........",
"....WWW......w..........",
"....ww..................",
"...BBB......BBB.........",
"...bbb......bbb.........",
])

# 帧2：双腿收拢过身下（腾空态，身体微升由 bob 控制）
F2 = pad(HEAD + BODY + [
"......JJJ...............",
"......WWWWW.............",
"......WWWWW.............",
"......wWWWw.............",
"......WWWW..............",
"......wwww..............",
"......BBBB..............",
"......bbbb..............",
])

# 帧3：左腿前跨、右腿后蹬（与帧1镜像步态）
F3 = pad(HEAD + BODY + [
"......JJJ...............",
".....WWW..WW............",
"....WWW...WW............",
"....WW....WWW...........",
"....WW.....WW...........",
"....w......WWW..........",
"............ww..........",
"...BBB......BBB.........",
"...bbb......bbb.........",
])

# 帧4：收腿（同帧2 但手臂换向）
F4 = pad(HEAD + BODY + [
"......JJJ...............",
"......WWWWW.............",
"......WWWWW.............",
"......wWWWw.............",
"......WWWW..............",
"......wwww..............",
"......BBBB..............",
"......bbbb..............",
])

# 手臂叠加：前后摆的袖子 + 皮肤手（画在躯干两侧）
def add_arms(frame_rows, front_arm_dx, back_arm_dx):
    g = [list(r) for r in frame_rows]
    def put(x, y, ch):
        if 0 <= x < W and 0 <= y < len(g):
            g[y][x] = ch
    # 前臂（画面右侧，向 running 方向）
    y0 = 11
    for i in range(3):
        put(11 + i + front_arm_dx, y0 + i, 'J')
    put(14 + front_arm_dx, y0 + 3, 'S')   # 前手
    # 后臂（画面左侧）
    for i in range(2):
        put(5 - back_arm_dx - i, y0 + i, 'J')
    put(4 - back_arm_dx, y0 + 2, 'S')     # 后手
    return [''.join(r) for r in g]

# 发梢后飘叠加（帧1/3 上扬、帧2/4 下垂）
def add_hair_tail(rows, lift):
    g = [list(r) for r in rows]
    def put(x, y, ch):
        if 0 <= x < W and 0 <= y < len(g):
            if g[y][x] == '.':
                g[y][x] = ch
    if lift:  # 上扬
        put(3, 3, 'h'); put(2, 2, 'L'); put(3, 2, 'h')
    else:     # 下垂
        put(3, 5, 'h'); put(2, 6, 'L'); put(2, 5, 'h')
    return [''.join(r) for r in g]

F1 = add_arms(add_hair_tail(F1, True),  1, 0)
F2 = add_arms(add_hair_tail(F2, False), 0, 1)
F3 = add_arms(add_hair_tail(F3, True), -1, 0)
F4 = add_arms(add_hair_tail(F4, False), 0, 1)

frames = [F1, F2, F3, F4]

def render(frame):
    img = Image.new('RGBA', (W, 26), (0,0,0,0))
    px = img.load()
    for y, row in enumerate(frame):
        for x, ch in enumerate(row):
            if ch in C:
                px[x,y] = (*C[ch], 255)
    return img

# 输出到 assets/bg 同级新目录 assets/madeline（路径直接写绝对）
outdir = "/Users/Zhuanz/Library/Mobile Documents/com~apple~CloudDocs/website/movies/assets/madeline"
os.makedirs(outdir, exist_ok=True)
for i, f in enumerate(frames):
    render(f).save(os.path.join(outdir, f'run-{i}.png'))

sheet = Image.new('RGBA', (W*4, 26), (0,0,0,0))
for i, f in enumerate(frames):
    sheet.paste(render(f), (i*W, 0))
sheet.resize((W*4*8, 26*8), Image.NEAREST).save(os.path.join(outdir, '_preview-sheet.png'))
print('ok', outdir)
