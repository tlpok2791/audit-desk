"""
content/posts/ 를 훑어 홈페이지 블로그 탭이 읽을 src/data/posts.js 를 만든다.

정적 호스팅에서는 브라우저가 파일시스템을 읽을 수 없으므로, 목록과 본문을
JS 파일 하나로 구워 둔다. 글을 추가·변환·발행한 뒤 이 스크립트를 돌린다.

  python3 build_posts.py
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).parent
POSTS = ROOT / "content" / "posts"
OUT = ROOT / "src" / "data" / "posts.js"
CATS_IN = ROOT / "content" / "categories.json"
CATS_OUT = ROOT / "src" / "data" / "categories.js"

# ready/ 파일의 섹션 구분자 — content/posts/README.md 의 규약과 같아야 한다
SECTIONS = ["제목 후보", "본문", "이미지 제작 목록", "태그", "리포트", "검토 필요"]

# 예전 원고에도 있던 네 구획만 필수로 본다. '이미지 제작 목록' 이 없다고
# 형식 위반으로 표시하면 이미 만들어 둔 글이 전부 빨갛게 된다.
REQUIRED = ["제목 후보", "본문", "태그", "리포트"]

# 새 규격은 [이미지 1 삽입 위치], 예전 원고는 [이미지: 설명]. 둘 다 받는다.
IMAGE_MARKER = re.compile(
    r"^[ \t]*\[이미지\s*(\d+)?\s*(?:삽입\s*위치)?\s*[:：]?\s*([^\]]*)\][ \t]*$", re.M)


# ── 카테고리 ────────────────────────────────────────────
# content/categories.json 이 원본이다. 여기서 읽어 검증에 쓰고, 화면용으로 굽는다.

def load_categories() -> dict:
    if not CATS_IN.exists():
        return {"groups": [], "retired": {}}
    return json.loads(CATS_IN.read_text(encoding="utf-8"))


def category_index(cats: dict) -> dict:
    """id → {label, group, groupLabel}. 하위가 없는 묶음은 묶음 자체가 항목이 된다."""
    idx = {}
    for g in cats.get("groups", []):
        if not g.get("items"):
            idx[g["id"]] = {"label": g["label"], "group": g["id"],
                            "groupLabel": g["label"]}
            continue
        for it in g["items"]:
            idx[it["id"]] = {"label": it["label"], "group": g["id"],
                             "groupLabel": g["label"]}
    return idx


def split_frontmatter(text: str) -> tuple[dict, str]:
    """맨 위 --- ... --- 블록을 떼어내 (프론트매터, 나머지)로 돌려준다."""
    m = re.match(r"^﻿?---\s*\n(.*?)\n---\s*\n?(.*)$", text, re.S)
    if not m:
        return {}, text
    return parse_yaml_ish(m.group(1)), m.group(2)


def parse_yaml_ish(block: str) -> dict:
    """key: value 와 [a, b] 목록만 다루는 최소 파서 (PyYAML 의존 없음)."""
    out = {}
    for line in block.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or ":" not in line:
            continue
        key, _, val = line.partition(":")
        key, val = key.strip(), val.strip()
        if val.startswith("[") and val.endswith("]"):
            inner = val[1:-1].strip()
            out[key] = [strip_quotes(v) for v in inner.split(",") if v.strip()] if inner else []
        else:
            out[key] = strip_quotes(val)
    return out


def strip_quotes(s: str) -> str:
    s = s.strip()
    if len(s) >= 2 and s[0] == s[-1] and s[0] in "\"'":
        return s[1:-1]
    return s


def split_sections(body: str) -> dict:
    """=== 이름 === 구분자로 잘라 {이름: 내용} 으로."""
    pattern = r"^===\s*(" + "|".join(map(re.escape, SECTIONS)) + r")\s*===\s*$"
    parts, current, buf = {}, None, []
    for line in body.splitlines():
        m = re.match(pattern, line.strip())
        if m:
            if current:
                parts[current] = "\n".join(buf).strip()
            current, buf = m.group(1), []
        elif current:
            buf.append(line)
    if current:
        parts[current] = "\n".join(buf).strip()
    return parts


def parse_titles(raw: str) -> list[str]:
    """'1. 제목' 형태에서 제목만 뽑는다."""
    titles = []
    for line in raw.splitlines():
        m = re.match(r"^\s*\d+[.)]\s*(.+)$", line)
        if m:
            titles.append(m.group(1).strip())
    return titles


def parse_tags(raw: str) -> list[str]:
    """쉼표 또는 줄바꿈으로 나뉜 태그. 앞의 # 은 떼어낸다."""
    items = re.split(r"[,\n]", raw)
    return [t.strip().lstrip("#").strip() for t in items if t.strip().lstrip("#").strip()]


def parse_flags(raw: str) -> list[str]:
    """검토 필요 항목을 줄 단위로."""
    out = []
    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue
        out.append(re.sub(r"^[-*]\s*", "", line))
    return out


def count_chars(body: str) -> int:
    """이미지 자리표시자를 뺀 실제 본문 글자수 (공백 포함)."""
    return len(IMAGE_MARKER.sub("", body).strip())


def split_segments(body: str) -> list:
    """
    본문을 이미지 자리 기준으로 자른다.
    화면에서 '이 조각까지 복사 → 이미지 배치 → 다음 조각 복사' 를 하기 위한 것이다.
    """
    segments, pos, n = [], 0, 0
    for m in IMAGE_MARKER.finditer(body):
        text = body[pos:m.start()].strip()
        if text:
            segments.append({"type": "text", "text": text})
        n += 1
        segments.append({
            "type": "image",
            "no": m.group(1) or str(n),
            "desc": (m.group(2) or "").strip(),
            "marker": m.group(0).strip(),
        })
        pos = m.end()
    tail = body[pos:].strip()
    if tail:
        segments.append({"type": "text", "text": tail})
    return segments


def parse_image_specs(raw: str) -> list:
    """'=== 이미지 제작 목록 ===' 을 이미지 단위로 자른다."""
    specs, cur = [], None
    for line in (raw or "").splitlines():
        head = re.match(r"^\s*(?:\[)?이미지\s*(\d+)\s*(?:\])?\s*[:.]?\s*$", line.rstrip())
        if head:
            cur = {"no": head.group(1), "fields": []}
            specs.append(cur)
            continue
        if cur is None:
            continue
        item = re.match(r"^\s*[-*]?\s*([가-힣A-Za-z ]{1,12})\s*[:：]\s*(.+)$", line)
        if item:
            cur["fields"].append({"k": item.group(1).strip(), "v": item.group(2).strip()})
    return specs


def count_keywords(body: str, keywords: list) -> list:
    """본문에서 핵심 키워드가 실제로 몇 번 나오는지 센다 (모델 집계를 믿지 않는다)."""
    text = IMAGE_MARKER.sub("", body).strip()
    return [{"k": k, "n": text.count(k)} for k in keywords if k]


def read_post(path: Path, stage: str, cidx: dict) -> dict:
    text = path.read_text(encoding="utf-8")
    fm, body = split_frontmatter(text)
    post = {
        "file": path.name,
        "path": str(path.relative_to(ROOT)),
        "stage": stage,
        "title": fm.get("title") or path.stem,
        "category": fm.get("category") or "",
        "categoryLabel": cidx.get(fm.get("category") or "", {}).get("label", ""),
        "categoryGroup": cidx.get(fm.get("category") or "", {}).get("group", ""),
        "categoryGroupLabel": cidx.get(fm.get("category") or "", {}).get("groupLabel", ""),
        "keywords": fm.get("keywords") or [],
        "kbRefs": fm.get("kb_refs") or [],
        "status": fm.get("status") or stage,
        "publishedUrl": fm.get("published_url") or "",
        "publishedAt": fm.get("published_at") or "",
    }

    if stage == "drafts":
        # 초안은 목록에만 띄운다. 본문은 굽지 않는다.
        return post

    sec = split_sections(body)
    plain = sec.get("본문", "").strip()
    tags = parse_tags(sec.get("태그", ""))
    segments = split_segments(plain)
    post.update({
        "titleCandidates": parse_titles(sec.get("제목 후보", "")),
        "body": plain,
        "segments": segments,
        "imageSpecsRaw": sec.get("이미지 제작 목록", "").strip(),
        "imageSpecs": parse_image_specs(sec.get("이미지 제작 목록", "")),
        "imageSlots": sum(1 for s in segments if s["type"] == "image"),
        "tags": fm.get("tags") or tags,
        "report": sec.get("리포트", "").strip(),
        "flags": parse_flags(sec.get("검토 필요", "")),
        "charCount": count_chars(plain),
        "keywordHits": count_keywords(plain, post["keywords"]),
    })

    # 규약을 어긴 파일은 화면에서 티가 나도록 표시해 둔다
    missing = [s for s in REQUIRED if s not in sec]
    if missing:
        post["malformed"] = missing
    return post


def main():
    cats = load_categories()
    cidx = category_index(cats)
    posts = []
    for stage in ("ready", "published", "drafts"):
        folder = POSTS / stage
        if not folder.exists():
            continue
        for path in sorted(folder.glob("*.md")):
            try:
                posts.append(read_post(path, stage, cidx))
            except Exception as e:  # 한 파일이 깨져도 나머지는 굽는다
                print(f"  건너뜀 {path.name} — {e}")

    # 변환을 마친 초안은 drafts/에 그대로 남는다. 같은 이름이 ready·published에
    # 있으면 "아직 변환 안 됨" 목록에서 빼야 한다.
    converted = {p["file"] for p in posts if p["stage"] in ("ready", "published")}
    for p in posts:
        if p["stage"] == "drafts" and p["file"] in converted:
            p["convertedAlready"] = True

    payload = json.dumps(posts, ensure_ascii=False, indent=2)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        "/* 자동 생성 파일 — 직접 고치지 말 것.\n"
        " * content/posts/ 를 고친 뒤 `python3 build_posts.py` 로 다시 만든다. */\n"
        f"const POSTS = {payload};\n",
        encoding="utf-8",
    )

    CATS_OUT.write_text(
        "/* 자동 생성 파일 — 직접 고치지 말 것.\n"
        " * content/categories.json 을 고친 뒤 `python3 build_posts.py` 로 다시 만든다. */\n"
        f"const CATEGORIES = {json.dumps(cats.get('groups', []), ensure_ascii=False, indent=2)};\n",
        encoding="utf-8",
    )

    by = {}
    for p in posts:
        by[p["stage"]] = by.get(p["stage"], 0) + 1
    summary = " · ".join(f"{k} {v}개" for k, v in by.items()) or "글 없음"
    print(f"src/data/posts.js 생성 완료 — {summary}")
    print(f"src/data/categories.js 생성 완료 — 묶음 {len(cats.get('groups', []))}개 "
          f"· 항목 {len(cidx)}개")

    # 모르는 category 는 죽이지 않고 알려만 준다. 글을 못 굽게 만들면 안 된다.
    retired = cats.get("retired", {})
    unknown = {}
    for p in posts:
        c = p["category"]
        if c and c not in cidx:
            unknown.setdefault(c, []).append(p["file"])
    for c, files in sorted(unknown.items()):
        hint = f" → '{retired[c]}' 로 바꾸세요" if c in retired else ""
        print(f"  ! 모르는 category '{c}'{hint} — {', '.join(sorted(set(files)))}")
    if not unknown:
        print("  카테고리 이상 없음")


if __name__ == "__main__":
    main()
