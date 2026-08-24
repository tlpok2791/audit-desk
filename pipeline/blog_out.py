"""파이프라인이 만든 원고를 content/posts/ready/ 규격 파일로 떨군다.

홈페이지 블로그 탭은 이 폴더를 읽는다 (build_posts.py → src/data/posts.js).
그래서 자동 생성된 글이 사람이 쓰던 것과 똑같은 화면에서 복사된다.

파일 형식은 content/posts/README.md 의 규약을 그대로 따른다.
구분자 이름을 바꾸면 홈페이지 복사 버튼이 깨진다.

리포트(글자수·키워드 등장 횟수·이미지 개수)는 모델이 세지 않는다.
여기서 본문을 직접 세서 채운다 — 모델의 자가 집계는 틀린 적이 있다.
"""
from __future__ import annotations

import datetime as _dt
import re
import unicodedata
from pathlib import Path

from .crew import (count_keywords, image_markers, keyword_density,
                   parse_image_specs, strip_image_markers)

READY_DIR = Path(__file__).resolve().parents[1] / "content" / "posts" / "ready"

# 본문 권장 길이 (content/posts/README.md 와 같은 값을 쓴다)
BODY_MIN = 900
BODY_MAX = 1500

# 이미지 권장 개수
IMG_MIN = 2
IMG_MAX = 6

# 키워드를 억지로 반복했는지 보는 상한 (본문 글자수 대비)
DENSITY_MAX = 0.03


def slugify(title: str, fallback: str = "post") -> str:
    """파일명. 한글은 그대로 두되 경로에 위험한 문자만 걷어낸다."""
    s = unicodedata.normalize("NFC", str(title or "")).strip()
    s = re.sub(r"[\\/:*?\"<>|\r\n\t]", "", s)
    s = re.sub(r"\s+", "-", s)
    s = s.strip("-.")[:60]
    return s or fallback


def parse_titles(raw: str) -> list[str]:
    out = []
    for line in (raw or "").splitlines():
        m = re.match(r"^\s*\d+[.)]\s*(.+)$", line)
        if m and m.group(1).strip():
            # '1. (질문형) 제목' 처럼 유형 표시가 붙어 오면 떼어낸다
            t = re.sub(r"^\((?:질문형|정보형|대상\s*특화형)\)\s*", "", m.group(1).strip())
            out.append(t)
    return out


def parse_tags(raw: str) -> list[str]:
    items = re.split(r"[,\n]", raw or "")
    return [t.strip().lstrip("#").strip() for t in items if t.strip().lstrip("#").strip()]


def _yaml_list(items: list[str]) -> str:
    safe = [str(i).replace('"', "'") for i in items if str(i).strip()]
    return "[" + ", ".join(safe) + "]"


def pick_keywords(sections: dict[str, str], tags: list[str]) -> list[str]:
    """
    핵심 키워드는 태그와 다르다.
    ① 모델이 뽑은 '핵심키워드' 구획 → ② 없으면 태그 앞 3개(예전 동작)로 물러선다.
    """
    kws = parse_tags(sections.get("핵심키워드", ""))
    return kws[:5] if kws else tags[:3]


def contact_block(kakao: str = "", phone: str = "") -> str:
    """
    상담 연락처. 모델이 전화번호를 지어내면 안 되므로 여기서 붙인다.
    설정이 없으면 사람이 채우도록 자리만 남긴다.
    """
    lines = []
    if kakao:
        lines.append(f"카카오톡 오픈채팅 {kakao}")
    if phone:
        lines.append(f"전화 {phone}")
    if not lines:
        lines.append("(연락처 미설정 — 오픈채팅 주소와 전화번호를 직접 넣으세요)")
    return "\n".join(lines)


def existing_titles(directories: list[Path]) -> list[tuple[str, list[str]]]:
    """이미 만들어 둔 글의 (제목, 키워드) 목록. 주제 중복을 보기 위해서만 쓴다."""
    out: list[tuple[str, list[str]]] = []
    for d in directories:
        if not d.exists():
            continue
        for path in sorted(d.glob("*.md")):
            try:
                head = path.read_text(encoding="utf-8")[:1200]
            except OSError:
                continue
            title = ""
            kws: list[str] = []
            m = re.search(r"^title:\s*(.+)$", head, re.M)
            if m:
                title = m.group(1).strip().strip("\"'")
            m = re.search(r"^keywords:\s*\[(.*?)\]\s*$", head, re.M)
            if m:
                kws = [k.strip().strip("\"'") for k in m.group(1).split(",") if k.strip()]
            if title:
                out.append((title, kws))
    return out


def _bigrams(s: str) -> set[str]:
    s = re.sub(r"\s+", "", s)
    return {s[i:i + 2] for i in range(len(s) - 1)}


def similarity(a: str, b: str) -> float:
    """제목끼리의 대략적인 닮은 정도 (0~1)."""
    x, y = _bigrams(a), _bigrams(b)
    if not x or not y:
        return 0.0
    return 2 * len(x & y) / (len(x) + len(y))


def find_duplicates(title: str, keywords: list[str],
                    known: list[tuple[str, list[str]]]) -> list[str]:
    """주제가 겹치는 기존 글을 찾는다. 판단하지 않고 사람에게 알리기만 한다."""
    hits = []
    for other_title, other_kws in known:
        sim = similarity(title, other_title)
        shared = [k for k in keywords if k and k in other_kws]
        if sim >= 0.5:
            hits.append(f"'{other_title}' (제목 유사도 {sim:.0%})")
        elif len(shared) >= 2:
            hits.append(f"'{other_title}' (키워드 겹침: {', '.join(shared)})")
    return hits


def build_report(body: str, keywords: list[str], image_count: int) -> str:
    """리포트를 코드로 만든다. 모델의 자가 집계를 쓰지 않는다."""
    plain = strip_image_markers(body)
    hits = count_keywords(body, keywords)
    lines = [f"총 글자수: {len(plain):,}자 (이미지 자리 제외)"]
    lines.append("핵심 키워드: " + (", ".join(keywords) if keywords else "(없음)"))
    lines.append("키워드별 실제 등장 횟수:")
    if hits:
        for k, n in hits.items():
            lines.append(f"- {k}: {n}회" + ("  ← 본문에 없음" if n == 0 else ""))
    else:
        lines.append("- (핵심 키워드가 지정되지 않았습니다)")
    lines.append(f"이미지 개수: {image_count}개")
    return "\n".join(lines)


def build_flags(sections: dict[str, str], body: str, keywords: list[str],
                image_count: int, spec_count: int,
                duplicates: list[str], source_note: str = "") -> list[str]:
    """모델이 남긴 검토 항목에, 코드가 계산해야만 알 수 있는 것을 덧붙인다."""
    flags = [ln.strip() for ln in (sections.get("검토필요") or "").splitlines() if ln.strip()]

    hits = count_keywords(body, keywords)
    missing = [k for k, n in hits.items() if n == 0]
    if missing:
        flags.append(f"- [키워드] 본문에 한 번도 나오지 않는 핵심 키워드: {', '.join(missing)}")
    if keywords and keyword_density(body, hits, keywords) > DENSITY_MAX:
        flags.append("- [키워드] 키워드 반복이 많습니다. 억지로 넣은 문장이 없는지 확인하세요.")

    length = len(strip_image_markers(body))
    if body and length < BODY_MIN:
        flags.append(f"- [분량] 본문 {length:,}자 — 권장 {BODY_MIN:,}자보다 짧습니다.")
    elif length > BODY_MAX * 1.3:
        flags.append(f"- [분량] 본문 {length:,}자 — 권장 {BODY_MAX:,}자를 크게 넘습니다.")

    if image_count and spec_count and image_count != spec_count:
        flags.append(f"- [이미지] 본문의 삽입 위치 {image_count}개와 "
                     f"제작 목록 {spec_count}개가 맞지 않습니다.")
    if body and image_count < IMG_MIN:
        flags.append(f"- [이미지] 삽입 위치가 {image_count}개뿐입니다. "
                     f"정보 단위가 더 있는지 확인하세요.")
    elif image_count > IMG_MAX:
        flags.append(f"- [이미지] 삽입 위치가 {image_count}개입니다. "
                     f"장식용 이미지가 섞이지 않았는지 확인하세요.")

    for d in duplicates:
        flags.append(f"- [중복] 기존 글과 주제가 겹칠 수 있습니다 — {d}")

    if source_note:
        flags.append(f"- [출처] {source_note}")
    return flags


def build_markdown(sections: dict[str, str], *, category: str = "medical",
                   source_note: str = "", kakao: str = "", phone: str = "",
                   known_posts: list[tuple[str, list[str]]] | None = None
                   ) -> tuple[str, str]:
    """
    (파일명, 파일내용) 을 돌려준다.
    sections 는 crew.split_sections() 결과.
    """
    titles = parse_titles(sections.get("제목후보", ""))
    tags = parse_tags(sections.get("태그", ""))
    keywords = pick_keywords(sections, tags)
    body = (sections.get("본문") or "").strip()
    title = titles[0] if titles else "제목 미정"

    # 상담 연락처는 모델이 아니라 여기서 붙인다 (번호를 지어내지 않게)
    if body:
        body = body.rstrip() + "\n\n" + contact_block(kakao, phone)

    images = image_markers(body)
    specs = parse_image_specs(sections.get("이미지제작목록", ""))
    duplicates = find_duplicates(title, keywords, known_posts or [])

    front = [
        "---",
        f"title: {title}",
        f"category: {category}",
        f"keywords: {_yaml_list(keywords)}",
        f"tags: {_yaml_list(tags)}",
        "kb_refs: []",
        "status: ready",
        'published_url: ""',
        'published_at: ""',
        'generated_by: "pipeline"',
        f'generated_at: "{_dt.datetime.now(_dt.timezone.utc):%Y-%m-%dT%H:%M:%SZ}"',
        "---",
        "",
    ]

    parts = ["\n".join(front)]
    parts.append("=== 제목 후보 ===")
    if titles:
        parts.extend(f"{i}. {t}" for i, t in enumerate(titles, 1))
    else:
        parts.append("1. (제목 후보가 생성되지 않았습니다)")
    parts.append("")

    parts.append("=== 본문 ===")
    parts.append(body or "(본문이 생성되지 않았습니다)")
    parts.append("")

    parts.append("=== 이미지 제작 목록 ===")
    spec_text = (sections.get("이미지제작목록") or "").strip()
    parts.append(spec_text or "(이미지 제작 목록이 생성되지 않았습니다)")
    parts.append("")

    parts.append("=== 태그 ===")
    parts.append(", ".join(tags) if tags else "(태그가 생성되지 않았습니다)")
    parts.append("")

    parts.append("=== 리포트 ===")
    parts.append(build_report(body, keywords, len(images)))
    parts.append("")

    flags = build_flags(sections, body, keywords, len(images), len(specs),
                        duplicates, source_note)
    if flags:
        parts.append("=== 검토 필요 ===")
        parts.extend(flags)
        parts.append("")

    return f"{slugify(title)}.md", "\n".join(parts).rstrip() + "\n"


def save(sections: dict[str, str], *, category: str = "medical",
         source_note: str = "", ready_dir: Path | None = None,
         kakao: str = "", phone: str = "") -> Path:
    """ready/ 에 저장하고 경로를 돌려준다. 같은 이름이 있으면 뒤에 번호를 붙인다."""
    directory = ready_dir or READY_DIR
    directory.mkdir(parents=True, exist_ok=True)

    # 주제 중복은 이미 만들어 둔 글과 비교해서 본다
    known = existing_titles([directory, directory.parent / "published"])

    name, content = build_markdown(sections, category=category, source_note=source_note,
                                   kakao=kakao, phone=phone, known_posts=known)

    stem = Path(name).stem
    path = directory / name
    n = 2
    while path.exists():
        path = directory / f"{stem}-{n}.md"
        n += 1

    path.write_text(content, encoding="utf-8")
    return path
