#!/usr/bin/env python3
"""Obsidian → 网站 同步脚本（阶段 B，零联网纯本地机械转换）。

子命令：
  sync      扫描笔记 → 解析 frontmatter+正文分节 → 按映射表生成 movies.json
            复用/下载海报剧照 → 打印报告 → 可选 git commit/push
  writeback 读 writeback_data.json → 行级替换写回笔记（--dry-run 只预览，写前备份）

数据流向（铁律）：
  Obsidian 笔记（唯一真源） → movies.json + posters/ + stills/，绝不反向。
  sync 子命令不做任何联网「补全」（IMDB/豆瓣/票房/runtime 全部由内容策展师
  写进笔记 + writeback_data.json）。图片下载仅从笔记 cover/banner 已有的
  TMDB CDN URL 机械拉取，且仅在本地文件缺失时触发（复用优先）。
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.request
from datetime import date
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    import yaml
except ImportError:  # pragma: no cover - PyYAML 缺失时降级为极简解析器
    yaml = None

import genre_map

MOVIE_TYPE = "movie"
POSTER_TMPL = "posters/{id}.jpg"
BACKDROP_TMPL = "stills/{id}.webp"

# 匹配整个 `### N️⃣ -> Name` 分节标题行（含行尾换行），避免残留 "️⃣ -> Name" 泄漏进分节正文
SECTION_RE = re.compile(r"^###\s*(\d)[^\n]*\n?", re.MULTILINE)
KV_RE = re.compile(r"^([^:\s]+)::\s*(.*)$")
STAR_RE = re.compile(r"^Star([1-5])$")
YEAR_TAG_RE = re.compile(r"^Y(\d{4})$")


# --------------------------------------------------------------------------- #
# 基础工具
# --------------------------------------------------------------------------- #

def _strip_quotes(s):
    s = (s or "").strip()
    if len(s) >= 2 and s[0] == s[-1] and s[0] in ('"', "'"):
        return s[1:-1]
    return s


def to_int(s):
    s = (s or "").strip()
    if not s:
        return None
    try:
        return int(float(s))
    except (ValueError, TypeError):
        return None


def to_float(s):
    s = (s or "").strip()
    if not s:
        return None
    try:
        return float(s)
    except (ValueError, TypeError):
        return None


# --------------------------------------------------------------------------- #
# config / 文件 IO
# --------------------------------------------------------------------------- #

def load_config(args_config):
    scripts_dir = os.path.dirname(os.path.abspath(__file__))
    cfg_path = args_config or os.path.join(scripts_dir, "config.json")
    cfg = {}
    if os.path.exists(cfg_path):
        try:
            cfg = json.load(open(cfg_path, encoding="utf-8")) or {}
        except (json.JSONDecodeError, OSError):
            cfg = {}
    defaults = {
        "vault_movie_dir": "/Users/Zhuanz/Documents/Obsidian Vault/电影",
        "site_dir": "/Users/Zhuanz/Library/Mobile Documents/com~apple~CloudDocs/website/movies",
        "template_name": "Movie Template.md",
    }
    for k, v in defaults.items():
        cfg.setdefault(k, v)
    return cfg


def load_movies(site_dir):
    p = Path(site_dir) / "movies.json"
    if not p.exists():
        return []
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except (json.JSONDecodeError, OSError):
        return []


def write_movies(site_dir, movies):
    p = Path(site_dir) / "movies.json"
    with open(p, "w", encoding="utf-8") as f:
        json.dump(movies, f, ensure_ascii=False, indent=2)
        f.write("\n")


def load_order_override(site_dir):
    p = Path(site_dir) / "scripts" / "order_override.json"
    if p.exists():
        try:
            d = json.loads(p.read_text(encoding="utf-8"))
            return {str(k): int(v) for k, v in d.items()}
        except (json.JSONDecodeError, OSError, ValueError):
            return {}
    return {}


# --------------------------------------------------------------------------- #
# 笔记扫描 / 解析
# --------------------------------------------------------------------------- #

def scan_notes(vault_dir, template_name):
    p = Path(vault_dir)
    notes = []
    for f in sorted(p.glob("*.md")):
        if f.name == template_name:
            continue
        notes.append(f)
    return notes


def _sanitize_frontmatter(fm_text):
    """丢弃 TMDB 模板残留（`{ { media_type } }` / `"{ media_type }":` 等），
    这些残留会让 yaml.safe_load 抛「unhashable key」。media_type 仅作为模板
    变量出现，不含任何真实信息，确定性剔除即可。"""
    out = []
    for line in fm_text.splitlines():
        if "media_type" in line.lower():
            continue
        out.append(line)
    return "\n".join(out)


def _parse_frontmatter_minimal(fm_text):
    """极简 frontmatter 解析器兜底（仅覆盖本项目 YAML 子集：
    created/tags/status/cover/banner）。"""
    data = {}
    tags = []
    in_tags = False
    for line in fm_text.splitlines():
        s = line.strip()
        if not s:
            continue
        if s.startswith("tags:"):
            in_tags = True
            rest = s[len("tags:"):].strip()
            if rest:
                tags.extend(_parse_inline_tags(rest))
            continue
        if in_tags and s.startswith("-"):
            tags.append(_strip_quotes(s[1:].strip()))
            continue
        if in_tags and not s.startswith("-"):
            in_tags = False
        m = re.match(r"^([A-Za-z_-]+)\s*:\s*(.*)$", s)
        if m:
            data[m.group(1)] = _strip_quotes(m.group(2))
    if tags:
        data["tags"] = tags
    return data


def _parse_inline_tags(rest):
    rest = rest.strip()
    if rest.startswith("[") and rest.endswith("]"):
        inner = rest[1:-1]
        return [_strip_quotes(x) for x in inner.split(",") if x.strip()]
    return [_strip_quotes(rest)]


def parse_frontmatter(fm_text):
    sanitized = _sanitize_frontmatter(fm_text)
    if yaml is not None:
        try:
            data = yaml.safe_load(sanitized)
            if isinstance(data, dict):
                return data
            return {}
        except Exception:
            return _parse_frontmatter_minimal(fm_text)
    return _parse_frontmatter_minimal(fm_text)


def split_sections(body):
    matches = list(SECTION_RE.finditer(body))
    sections = {}
    for i, m in enumerate(matches):
        num = m.group(1)
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(body)
        sections[num] = body[start:end]
    return sections


def extract_kv(section_text):
    kv = {}
    for line in section_text.splitlines():
        s = line.lstrip("#").strip()
        m = KV_RE.match(s)
        if m:
            kv[m.group(1)] = m.group(2).strip()
    return kv


def parse_note(path):
    text = path.read_text(encoding="utf-8")
    fm = {}
    body = text
    if text.startswith("---"):
        parts = text.split("---", 2)
        if len(parts) >= 3:
            fm = parse_frontmatter(parts[1])
            body = parts[2]
    sections = split_sections(body)
    kv = {num: extract_kv(txt) for num, txt in sections.items()}
    return {"fm": fm, "sections": sections, "kv": kv, "path": path, "raw": text}


# --------------------------------------------------------------------------- #
# 字段提取（映射规则细节）
# --------------------------------------------------------------------------- #

def normalize_tags(raw):
    if raw is None:
        return []
    if isinstance(raw, str):
        return [raw]
    if isinstance(raw, list):
        return raw
    return [raw]


def extract_stars(tags):
    stars = []
    for t in normalize_tags(tags):
        s = str(t).strip()
        m = STAR_RE.fullmatch(s)
        if m:
            stars.append(int(m.group(1)))
    return stars


def _split_top_level(s, sep=","):
    """按分隔符切分，但忽略括号内的分隔符（角色里可能含逗号或嵌套括号）。"""
    parts = []
    depth = 0
    cur = []
    for ch in s:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth < 0:
                depth = 0
        if ch == sep and depth == 0:
            parts.append("".join(cur))
            cur = []
        else:
            cur.append(ch)
    parts.append("".join(cur))
    return parts


def extract_cast(raw):
    if not raw:
        return []
    raw = str(raw).replace("，", ",")
    actors = []
    for item in _split_top_level(raw):
        name = item.split("(", 1)[0].strip()
        if name:
            actors.append(name)
    return actors


def extract_directors(raw):
    if not raw:
        return []
    return [p.strip() for p in re.split(r"[,、/]", str(raw)) if p.strip()]


def extract_overview(section2_text, my_genjie):
    """overview 简短版优先：我的梗概:: 存在则用之，否则用 Summary 长简介。"""
    if my_genjie:
        return my_genjie
    parts = []
    for line in section2_text.splitlines():
        s = line.strip()
        if not s:
            continue
        if re.match(r"^\[Homepage\]\(", s):
            continue
        parts.append(s)
    return " ".join(parts).strip()


def find_my_genjie(note):
    kv = note["kv"]
    if "2" in kv and kv["2"].get("我的梗概", "").strip():
        return kv["2"]["我的梗概"].strip()
    for num in kv:
        v = kv[num].get("我的梗概", "").strip()
        if v:
            return v
    return None


def extract_comment(section3_text):
    """个人评价：去掉 Score/Watched-date 行后剩余文本；`...` 或空 → None。"""
    parts = []
    for line in section3_text.splitlines():
        s = line.strip()
        if not s:
            continue
        if s.startswith("#### Score::") or s.startswith("#### Watched-date::"):
            continue
        if re.match(r"^(Score|Watched-date)::", s):
            continue
        parts.append(s)
    text = " ".join(parts).strip()
    if not text or text == "...":
        return None
    return text


# --------------------------------------------------------------------------- #
# 映射：note → movie dict
# --------------------------------------------------------------------------- #

def map_to_movie(note, path):
    warnings = []
    fm = note["fm"]
    kv = note["kv"]
    fname = path.stem

    kv1 = kv.get("1", {})
    kv2 = kv.get("2", {})
    kv3 = kv.get("3", {})
    kv4 = kv.get("4", {})
    kv5 = kv.get("5", {})
    kv6 = kv.get("6", {})

    # id：从 ### 5️⃣ 的 ID:: 取，str(int)；无 ID 跳过
    id_raw = (kv5.get("ID") or "").strip()
    m_id = re.search(r"\d+", id_raw)
    if not m_id:
        return None, [f"{fname}: 无 TMDB ID，跳过"]
    mid = str(int(m_id.group(0)))

    # title：以文件名为准；文件名 == Original-title 时回退 Title::
    original_title = (kv4.get("Original-title") or "").strip()
    title_field = (kv1.get("Title") or "").strip()
    if fname == original_title:
        title = title_field or fname
    else:
        title = fname

    # year：从 Release-date 前 4 位；缺失才兜底 tags Y\d{4} / created
    release_date = (kv1.get("Release-date") or "").strip()
    year = None
    ym = re.match(r"(\d{4})-", release_date)
    if ym:
        year = int(ym.group(1))
    else:
        for t in normalize_tags(fm.get("tags")):
            m = YEAR_TAG_RE.fullmatch(str(t).strip())
            if m:
                year = int(m.group(1))
                break
        if year is None:
            cm = re.search(r"(\d{4})", str(fm.get("created", "")))
            if cm:
                year = int(cm.group(1))

    # genres（英文→中文，去重保序）
    genres = genre_map.translate_genres(kv4.get("Genres", ""))

    directors = extract_directors(kv4.get("Director", ""))
    cast = extract_cast(kv4.get("Main-actors", ""))

    overview = extract_overview(note["sections"].get("2", ""), find_my_genjie(note))

    # status：WATCHED→watched，TO WATCH→towatch，其他告警并视为 towatch
    raw_status = (fm.get("status") or "").strip()
    status_u = raw_status.upper()
    if status_u == "WATCHED":
        status = "watched"
    elif status_u in ("TO WATCH", "TO-WATCH", "TOWATCH", "TOWATCHING"):
        status = "towatch"
    else:
        warnings.append(f"{fname}: 未知 status={raw_status!r}，按 towatch 处理")
        status = "towatch"

    # ratings.tmdb
    rating_raw = (kv1.get("Rating") or "").strip()
    tmdb_score = None
    if rating_raw:
        try:
            tmdb_score = round(float(rating_raw), 1)
        except ValueError:
            warnings.append(f"{fname}: Rating 无法解析 {rating_raw!r}")
    vote_count = to_int(kv1.get("Vote-count", ""))

    # ### 6️⃣（回写补全）：IMDB / Douban / Box-office / Runtime
    imdb_score = to_float(kv6.get("IMDB", ""))
    douban_score = to_float(kv6.get("Douban", ""))
    box_office = (kv6.get("Box-office") or "").strip()
    box_office_note = (kv6.get("Box-office-note") or "").strip()
    runtime = to_int(kv6.get("Runtime", ""))

    # personal
    stars = extract_stars(fm.get("tags"))
    personal_rating = max(stars) if stars else None
    if len(stars) > 1:
        warnings.append(f"{fname}: 多个 Star 标签 {stars}，取最大 {personal_rating}")
    if status == "towatch" and personal_rating is not None:
        warnings.append(
            f"{fname}: status=TO WATCH 但 tags 含 Star{personal_rating}，"
            f"按笔记 status=towatch 处理（不自动改 status）"
        )

    comment = extract_comment(note["sections"].get("3", ""))
    if comment and len(comment) > 60:
        warnings.append(f"{fname}: 个人评价超 60 字，已截断")
        comment = comment[:60]
    watched_date = (kv3.get("Watched-date") or "").strip() or None

    # 组装（固定键序，与现有 movies.json 一致，保证 diff 干净）
    movie = {
        "id": mid,
        "type": MOVIE_TYPE,
        "title": title,
        "originalTitle": original_title,
        "year": year,
        "genres": genres,
        "directors": directors,
        "overview": overview,
        "cast": cast,
    }
    if runtime is not None:
        movie["runtime"] = runtime
    movie["releaseDate"] = release_date or None
    movie["status"] = status
    movie["poster"] = POSTER_TMPL.format(id=mid)
    movie["backdrop"] = BACKDROP_TMPL.format(id=mid)

    ratings = {}
    tmdb = {}
    if tmdb_score is not None:
        tmdb["score"] = tmdb_score
    if vote_count is not None:
        tmdb["votes"] = vote_count
    ratings["tmdb"] = tmdb
    if imdb_score is not None:
        ratings["imdb"] = {"score": imdb_score}
    if douban_score is not None:
        ratings["douban"] = {"score": douban_score}
    movie["ratings"] = ratings

    if box_office:
        bo = {"amount": box_office}
        if box_office_note:
            bo["note"] = box_office_note
        movie["boxOffice"] = bo

    personal = {"rating": personal_rating, "comment": comment}
    if watched_date:
        personal["watchedDate"] = watched_date
    movie["personal"] = personal

    return movie, warnings


# --------------------------------------------------------------------------- #
# 图片（下载 / 复用）
# --------------------------------------------------------------------------- #

def _download(url, dest):
    try:
        req = urllib.request.Request(
            url, headers={"User-Agent": "jeremy-movies-sync/1.0"}
        )
        with urllib.request.urlopen(req, timeout=30) as r, open(dest, "wb") as f:
            shutil.copyfileobj(r, f)
        return dest.exists() and dest.stat().st_size > 0
    except Exception:
        return False


def _to_webp(src, dest):
    try:
        subprocess.run(
            ["cwebp", "-q", "82", str(src), "-o", str(dest)],
            check=True,
            capture_output=True,
        )
        return dest.exists() and dest.stat().st_size > 0
    except Exception:
        return False


def ensure_images(movie, note, cfg, force, report):
    site = Path(cfg["site_dir"])
    posters_dir = site / "posters"
    stills_dir = site / "stills"
    posters_dir.mkdir(parents=True, exist_ok=True)
    stills_dir.mkdir(parents=True, exist_ok=True)
    mid = movie["id"]
    fm = note["fm"]

    poster_file = posters_dir / f"{mid}.jpg"
    if force or not poster_file.exists():
        cover = (fm.get("cover") or "").strip()
        if cover.startswith("http") and not _download(cover, poster_file):
            report["warnings"].append(f"{mid}: 海报下载失败 {cover}")

    backdrop_file = stills_dir / f"{mid}.webp"
    if force or not backdrop_file.exists():
        banner = (fm.get("banner") or "").strip()
        if banner.startswith("http"):
            tmp = stills_dir / f"{mid}.tmp.jpg"
            if _download(banner, tmp):
                if not _to_webp(tmp, backdrop_file):
                    report["warnings"].append(f"{mid}: 剧照 webp 转换失败")
                tmp.unlink(missing_ok=True)
            else:
                report["warnings"].append(f"{mid}: 剧照下载失败 {banner}")


# --------------------------------------------------------------------------- #
# git
# --------------------------------------------------------------------------- #

def git_commit(site_dir, push, report):
    def run(cmd):
        return subprocess.run(cmd, cwd=site_dir, capture_output=True, text=True)

    run(["git", "add", "movies.json", "posters", "stills"])
    msg = (
        f"sync: +{len(report['added'])} ~{len(report['modified'])} "
        f"-{len(report['to_delete'])}"
    )
    r = run(["git", "commit", "-m", msg])
    if r.returncode != 0:
        print("git commit 跳过（可能无变更）:", (r.stderr or "").strip())
    if push:
        r2 = run(["git", "push"])
        print("git push:", (r2.stdout or "").strip(), (r2.stderr or "").strip())


# --------------------------------------------------------------------------- #
# sync 子命令
# --------------------------------------------------------------------------- #

def sync(cfg, args):
    vault_dir = cfg["vault_movie_dir"]
    site_dir = cfg["site_dir"]
    template = cfg["template_name"]

    notes = scan_notes(vault_dir, template)
    old = load_movies(site_dir)
    old_by_id = {m.get("id"): m for m in old if isinstance(m, dict) and m.get("id")}
    old_orders = [
        m.get("order") for m in old if isinstance(m.get("order"), int)
    ]
    next_order = (max(old_orders) + 1) if old_orders else 1
    order_override = load_order_override(site_dir)

    movies = []
    report = {
        "added": [],
        "modified": [],
        "skipped": [],
        "to_delete": [],
        "warnings": [],
    }
    today = date.today().isoformat()

    for path in notes:
        if path.stat().st_size == 0:
            report["skipped"].append((path.name, "空文件"))
            continue

        note = parse_note(path)
        movie, warns = map_to_movie(note, path)
        report["warnings"].extend(warns)
        if movie is None:
            report["skipped"].append((path.name, "无 TMDB ID"))
            continue

        mid = movie["id"]

        # order：手动覆盖 > 旧值继承 > 追加
        if mid in order_override:
            movie["order"] = order_override[mid]
        elif mid in old_by_id and isinstance(old_by_id[mid].get("order"), int):
            movie["order"] = old_by_id[mid]["order"]
        else:
            movie["order"] = next_order
            next_order += 1

        # updatedAt：仅当内容真实变化才更新
        prev = old_by_id.get(mid)
        if prev is None:
            report["added"].append(mid)
            movie["updatedAt"] = today
        else:
            prev_content = {
                k: v for k, v in prev.items() if k not in ("order", "updatedAt")
            }
            new_content = {
                k: v for k, v in movie.items() if k not in ("order", "updatedAt")
            }
            if prev_content == new_content:
                movie["updatedAt"] = prev.get("updatedAt") or today
            else:
                report["modified"].append(mid)
                movie["updatedAt"] = today

        if not args.dry_run:
            ensure_images(movie, note, cfg, args.refresh_images, report)

        movies.append(movie)

    # 删除检测：默认「删除即同步删」（prune）；--no-prune 仅告警保留
    seen = {m["id"] for m in movies}
    to_delete = [i for i in old_by_id if i not in seen]
    report["to_delete"] = to_delete
    if args.no_prune:
        for i in to_delete:
            movies.append(old_by_id[i])

    movies.sort(key=lambda m: (m.get("order") if isinstance(m.get("order"), int) else 0))

    print_report(report, len(movies), args.dry_run)

    if not args.dry_run:
        write_movies(site_dir, movies)
        print(f"已写入 {site_dir}/movies.json（{len(movies)} 部）")
        if args.commit:
            git_commit(site_dir, args.push, report)


def print_report(report, total, dry_run):
    print("=" * 60)
    print("同步报告" + ("（--dry-run 预览，未写文件）" if dry_run else ""))
    print("=" * 60)
    print(f"产出总数：{total} 部")
    print(f"新增：{len(report['added'])} {report['added']}")
    print(f"修改：{len(report['modified'])} {report['modified']}")
    print(f"跳过：{len(report['skipped'])}")
    for name, reason in report["skipped"]:
        print(f"  - {name}: {reason}")
    print(f"已删除（笔记中不存在）：{len(report['to_delete'])} {report['to_delete']}")
    for w in report["warnings"]:
        print(f"  [警告] {w}")


# --------------------------------------------------------------------------- #
# writeback 子命令
# --------------------------------------------------------------------------- #

def writeback(cfg, args):
    scripts_dir = os.path.dirname(os.path.abspath(__file__))
    data_path = args.data or os.path.join(scripts_dir, "writeback_data.json")
    if not os.path.exists(data_path):
        print(f"错误：writeback_data.json 不存在：{data_path}")
        sys.exit(1)

    try:
        data = json.load(open(data_path, encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as e:
        print(f"错误：writeback_data.json 解析失败：{e}")
        sys.exit(1)
    if not isinstance(data, dict):
        print("错误：writeback_data.json 顶层应为 {id: {...}} 对象")
        sys.exit(1)

    vault_dir = cfg["vault_movie_dir"]
    template = cfg["template_name"]
    notes = scan_notes(vault_dir, template)

    # 建立 id → (path, note)
    id_to_note = {}
    for path in notes:
        if path.stat().st_size == 0:
            continue
        note = parse_note(path)
        mid = None
        id_raw = (note["kv"].get("5", {}).get("ID") or "").strip()
        m = re.search(r"\d+", id_raw)
        if m:
            mid = str(int(m.group(0)))
        if mid:
            id_to_note[mid] = (path, note)

    backup_dir = None
    if not args.dry_run and not args.no_backup:
        from datetime import datetime
        ts = datetime.now().strftime("%Y%m%d-%H%M%S")
        backup_dir = Path(vault_dir) / "_sync_backup" / ts
        backup_dir.mkdir(parents=True, exist_ok=True)

    total_changes = 0
    for mid, fields in data.items():
        if mid not in id_to_note:
            print(f"  [跳过] id={mid}：笔记中未找到")
            continue
        path, note = id_to_note[mid]
        new_text, changes = apply_writeback(note["raw"], fields)
        if not changes:
            continue
        total_changes += len(changes)
        print(f"  id={mid}（{path.name}）将修改 {len(changes)} 处：")
        for c in changes:
            print(f"    - {c}")
        if not args.dry_run:
            if backup_dir:
                shutil.copy2(path, backup_dir / path.name)
            path.write_text(new_text, encoding="utf-8")

    print("-" * 60)
    print(f"共 {len(data)} 条回写数据，实际改动 {total_changes} 处"
          + ("（--dry-run，未写笔记）" if args.dry_run else ""))
    if backup_dir:
        print(f"备份目录：{backup_dir}")


def _find_line_index(lines, pattern):
    for i, ln in enumerate(lines):
        if re.search(pattern, ln):
            return i
    return None


def apply_writeback(raw_text, fields):
    """对单条笔记做行级精确替换，返回 (new_text, changes)。

    写入判定统一为「当前为空/占位才写」，已有真实值绝不覆盖。
    """
    lines = raw_text.splitlines()
    changes = []

    # 1) 个人星级：#### Score:: 0（或空）→ #### Score:: n
    star = fields.get("star")
    if star is not None:
        idx = _find_line_index(lines, r"^####\s*Score::")
        if idx is not None:
            cur = lines[idx].split("::", 1)[1].strip() if "::" in lines[idx] else ""
            if cur in ("", "0"):
                lines[idx] = f"#### Score:: {int(star)}"
                changes.append(f"Score:: {cur or '空'} → {int(star)}")

    # 2) 观影日期：#### Watched-date:: → 填值；行不存在则在 Score 行后补一行
    wd = fields.get("watched_date")
    if wd:
        idx = _find_line_index(lines, r"^####\s*Watched-date::")
        if idx is not None:
            cur = lines[idx].split("::", 1)[1].strip() if "::" in lines[idx] else ""
            if not cur:
                lines[idx] = f"#### Watched-date:: {wd}"
                changes.append(f"Watched-date 补填 {wd}")
        else:
            score_idx = _find_line_index(lines, r"^####\s*Score::")
            if score_idx is not None:
                lines.insert(score_idx + 1, f"#### Watched-date:: {wd}")
            else:
                lines.append(f"#### Watched-date:: {wd}")
            changes.append(f"Watched-date 新增 {wd}")

    # 3) 个人评价：... 占位 → 评价文本（仅占位时写）
    comment = fields.get("comment")
    if comment:
        idx = _find_line_index(lines, r"^\.\.\.$")
        if idx is not None:
            lines[idx] = comment
            changes.append("个人评价占位 ... → 实际评价")

    # 4) 中文导演 / 演员：整行替换
    if fields.get("directors_zh"):
        idx = _find_line_index(lines, r"^Director::")
        if idx is not None:
            old = lines[idx]
            lines[idx] = f"Director:: {fields['directors_zh']}"
            if old != lines[idx]:
                changes.append("Director:: 中文化")
    # 卡司：新字段 `cast`（完整名单+角色）优先；旧字段 `cast_zh`（短名单）仅兜底。
    # Jeremy 决策：写回保留完整卡司（10 人带角色），不缩减为短名单。
    cast = fields.get("cast") or fields.get("cast_zh")
    if cast:
        idx = _find_line_index(lines, r"^Main-actors::")
        if idx is not None:
            old = lines[idx]
            lines[idx] = f"Main-actors:: {cast}"
            if old != lines[idx]:
                changes.append("Main-actors:: 中文化（完整名单）")

    # 5) 我的梗概：写进 ### 2️⃣（简短版 overview，团队决策）
    #    数据字段名以内容策展师产出的 writeback_data.json 为准：overview_short
    my_overview = fields.get("overview_short") or fields.get("my_overview")
    if my_overview:
        idx = _find_line_index(lines, r"^我的梗概::")
        if idx is not None:
            if lines[idx].split("::", 1)[1].strip() != my_overview:
                lines[idx] = f"我的梗概:: {my_overview}"
                changes.append("我的梗概:: 更新")
        else:
            # 插到 [Homepage] 行之后
            hp = _find_line_index(lines, r"^\[Homepage\]\(")
            if hp is not None:
                lines.insert(hp + 1, f"我的梗概:: {my_overview}")
            else:
                lines.append(f"我的梗概:: {my_overview}")
            changes.append("我的梗概:: 新增")

    # 6) ### 6️⃣ -> Ratings & Box Office（自动补全区）
    rbo_keys = [
        ("IMDB", "imdb"),
        ("Douban", "douban"),
        ("Box-office", "box_office"),
        ("Box-office-note", "box_office_note"),
        ("Runtime", "runtime"),
    ]
    rbo_values = {key: fields.get(f) for key, f in rbo_keys}
    rbo_present = any(v not in (None, "") for v in rbo_values.values())
    if rbo_present:
        sec6_idx = _find_line_index(lines, r"^###\s*6")
        if sec6_idx is not None:
            for key, _f in rbo_keys:
                val = fields.get(_f)
                if val in (None, ""):
                    continue
                k_idx = _find_line_index(lines, rf"^{re.escape(key)}::")
                if k_idx is not None and sec6_idx < k_idx:
                    new_line = f"{key}:: {val}"
                    if lines[k_idx] != new_line:
                        lines[k_idx] = new_line
                        changes.append(f"{key}:: 补填")
        else:
            # 在 ### 5️⃣ 分节后追加整段
            sec5_idx = _find_line_index(lines, r"^###\s*5")
            block = ["", "### 6️⃣ -> Ratings & Box Office", ""]
            for key, _f in rbo_keys:
                val = fields.get(_f)
                if val in (None, ""):
                    block.append(f"{key}:: ")
                else:
                    block.append(f"{key}:: {val}")
            if sec5_idx is not None:
                # 定位 ### 5️⃣ 分节的结束（下一个 ### 或文件末尾）
                insert_at = len(lines)
                for j in range(sec5_idx + 1, len(lines)):
                    if re.match(r"^###\s*\d", lines[j]):
                        insert_at = j
                        break
                lines[insert_at:insert_at] = block
            else:
                lines.extend(block)
            changes.append("### 6️⃣ 分节新增")

    return "\n".join(lines), changes


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #

def main():
    parser = argparse.ArgumentParser(description="Obsidian → 网站同步脚本")
    sub = parser.add_subparsers(dest="command", required=True)

    p_sync = sub.add_parser("sync", help="扫描笔记生成 movies.json")
    p_sync.add_argument("--dry-run", action="store_true", help="只预览不写文件")
    p_sync.add_argument("--commit", action="store_true", help="生成后 git commit")
    p_sync.add_argument("--push", action="store_true", help="git push")
    p_sync.add_argument("--no-prune", action="store_true",
                        help="笔记删除的片只告警不删除（默认删除）")
    p_sync.add_argument("--refresh-images", action="store_true",
                        help="强制重新下载图片")
    p_sync.add_argument("--config", help="config.json 路径")

    p_wb = sub.add_parser("writeback", help="读 writeback_data.json 写回笔记")
    p_wb.add_argument("--data", help="writeback_data.json 路径")
    p_wb.add_argument("--dry-run", action="store_true", help="只预览不写笔记")
    p_wb.add_argument("--no-backup", action="store_true", help="写回前不备份")
    p_wb.add_argument("--config", help="config.json 路径")

    args = parser.parse_args()
    cfg = load_config(getattr(args, "config", None))

    if args.command == "sync":
        sync(cfg, args)
    elif args.command == "writeback":
        writeback(cfg, args)


if __name__ == "__main__":
    main()
