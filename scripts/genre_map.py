"""英文类型词 → 中文映射表（bounded 常量，照 SPEC §1.3 C）。

规则（反幻觉）：
- 已含中文（CJK）的词直接保留；
- 英文词经映射表精确命中转中文；
- 未命中保留原样，绝不硬翻。
"""

# 精确映射表（大小写敏感为主，另建小写索引做大小写无关兜底）
GENRE_MAP = {
    "Action": "动作",
    "Adventure": "冒险",
    "Science Fiction": "科幻",
    "Horror": "恐怖",
    "Thriller": "惊悚",
    "Comedy": "喜剧",
    "Crime": "犯罪",
    "Drama": "剧情",
    "History": "历史",
    "Mystery": "悬疑",
    "Fantasy": "奇幻",
    "War": "战争",
    "Romance": "爱情",
    "Animation": "动画",
    "Family": "家庭",
    "Western": "西部",
    "Documentary": "纪录",
    "Music": "音乐",
    "TV Movie": "电视电影",
    "Science-Fiction": "科幻",
}

# 大小写无关兜底（lower key → 中文）
_GENRE_MAP_CI = {k.lower(): v for k, v in GENRE_MAP.items()}


def _is_cjk(ch):
    return "\u4e00" <= ch <= "\u9fff"


def translate_genre(word):
    """单个类型词 → 中文（或原样）。空返回 None。"""
    w = (word or "").strip()
    if not w:
        return None
    # 已含中文 → 原样保留
    if any(_is_cjk(ch) for ch in w):
        return w
    if w in GENRE_MAP:
        return GENRE_MAP[w]
    ci = _GENRE_MAP_CI.get(w.lower())
    if ci:
        return ci
    # 未命中 → 保留原样
    return w


def translate_genres(raw):
    """`Genres::` 原串 → 去重保序的中文类型列表。"""
    if not raw:
        return []
    raw = str(raw).replace("，", ",")
    out = []
    for part in raw.split(","):
        t = translate_genre(part)
        if t and t not in out:
            out.append(t)
    return out
