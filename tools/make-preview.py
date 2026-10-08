#!/usr/bin/env python3
"""生成 README 用的效果图：git 角标在 composer 工具行右端 + 悬停浮层。

纯合成图，不含任何真实项目内容。按 2x Retina 渲染，尺寸与配色对齐官方
InputBar：工具行 trailing gap = 12 CSS px，模型选择器字号 16 CSS px，
角标图形 14 CSS px（次要图标色）。

SFNS.ttf 是可变字体，PIL 默认会落在极细的实例上，因此显式锁定字重。

用法：python3 tools/make-preview.py     # 输出 docs/badge.png
"""
import os

from PIL import Image, ImageDraw, ImageFont

SCALE = 2
W, H = 286, 158
BG = (255, 255, 255)
INK = (15, 17, 21)
MUTED = (129, 133, 140)
FAINT = (196, 199, 204)
GREEN = (26, 158, 104)
RED = (226, 74, 79)
CARD = (255, 255, 255)
HAIRLINE = (233, 234, 236)

SANS = "/System/Library/Fonts/SFNS.ttf"
MONO = "/System/Library/Fonts/SFNSMono.ttf"


def px(value):
    return int(round(value * SCALE))


def font(path, size, weight="Regular"):
    f = ImageFont.truetype(path, px(size))
    for attempt in (lambda: f.set_variation_by_name(weight),
                    lambda: f.set_variation_by_axes([400 if weight == "Regular" else 600])):
        try:
            attempt()
            return f
        except Exception:
            continue
    return f


def branch_glyph(draw, x, y, size, color, stroke):
    """16-grid 描边分支图标：两条竖干 + 一个分叉支线（与 client.js 同款）。"""
    u = size / 16.0
    lw = max(1, px(stroke))

    def dot(cx, cy):
        r = 2.1 * u
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], outline=color, width=lw)

    left_x, right_x = x + 4.2 * u, x + 11.8 * u
    dot(left_x, y + 3.6 * u)
    dot(left_x, y + 12.4 * u)
    dot(right_x, y + 6.6 * u)
    draw.line([left_x, y + 5.4 * u, left_x, y + 10.6 * u], fill=color, width=lw)
    draw.line([left_x, y + 8.0 * u, left_x + 2.8 * u, y + 8.0 * u], fill=color, width=lw)
    draw.line(
        [left_x + 2.8 * u, y + 8.0 * u, right_x - 1.5 * u, y + 7.5 * u],
        fill=color,
        width=lw,
    )


image = Image.new("RGB", (px(W), px(H)), BG)

# ---------------------------------------------------------------- 悬停浮层
card_x, card_y, card_w, card_h = px(16), px(8), px(198), px(100)
shadow = Image.new("RGBA", image.size, (0, 0, 0, 0))
ImageDraw.Draw(shadow).rounded_rectangle(
    [card_x + px(1), card_y + px(2.5), card_x + card_w, card_y + card_h + px(2.5)],
    radius=px(9),
    fill=(0, 0, 0, 24),
)
image = Image.alpha_composite(image.convert("RGBA"), shadow).convert("RGB")
draw = ImageDraw.Draw(image)
draw.rounded_rectangle(
    [card_x, card_y, card_x + card_w, card_y + card_h],
    radius=px(9),
    fill=CARD,
    outline=HAIRLINE,
    width=1,
)

pad = px(13)
branch_glyph(draw, card_x + pad, card_y + px(11), px(13), INK, 1.3)
draw.text(
    (card_x + pad + px(13) + px(8), card_y + px(8)),
    "main",
    font=font(SANS, 14),
    fill=INK,
)
draw.text(
    (card_x + pad, card_y + px(36)),
    "12 files changed",
    font=font(SANS, 13),
    fill=MUTED,
)
draw.text((card_x + pad, card_y + px(62)), "+914", font=font(MONO, 13), fill=GREEN)
draw.text((card_x + pad + px(48), card_y + px(62)), "-0", font=font(MONO, 13), fill=RED)

# ------------------------------------------------------- 工具行（右端部分）
row_y = px(122)
model_x = px(16) + px(14) + px(12)  # 图标 + trailing gap 12
label = "deepseek-v4.1-flash"
draw.text((model_x, row_y), label, font=font(SANS, 16), fill=INK)
label_w = draw.textlength(label, font=font(SANS, 16))
draw.text(
    (model_x + label_w + px(7), row_y),
    "Max",
    font=font(SANS, 16),
    fill=FAINT,
)
branch_glyph(draw, px(16), row_y + px(1.5), px(14), MUTED, 1.25)

out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "docs")
os.makedirs(out_dir, exist_ok=True)
out = os.path.normpath(os.path.join(out_dir, "badge.png"))
image.save(out)
print("written:", out, image.size)
