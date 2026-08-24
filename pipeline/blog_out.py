"""파이프라인이 만든 원고를 content/posts/ready/ 규격 파일로 떨군다.

홈페이지 블로그 탭은 이 폴더를 읽는다 (build_posts.py → src/data/posts.js).
그래서 자동 생성된 글이 사람이 쓰던 것과 똑같은 화면에서 복사된다.

파일 형식은 content/posts/README.md 의 규약을 그대로 따른다.
구분자 이름을 바꾸면 홈페이지 복사 버튼이 깨진다.
"""
from __future__ import annotations

import datetime as _dt
import re
import unicodedata
from pathlib import Path

READY_DIR = Path(__file__).resolve().parents[1] / "content" / "posts" / "ready"


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
            out.append(m.group(1).strip())
    return out


def parse_tags(raw: str) -> list[str]:
    items = re.split(r"[,\n]", raw or "")
    return [t.strip().lstrip("#").strip() for t in items if t.strip().lstrip("#").strip()]


def _yaml_list(items: list[str]) -> str:
    safe = [str(i).replace('"', "'") for i in items if str(i).strip()]
    return "[" + ", ".join(safe) + "]"


def build_markdown(sections: dict[str, str], *, category: str = "medical",
                   source_note: str = "") -> tuple[str, str]:
    """
    (파일명, 파일내용) 을 돌려준다.
    sections 는 crew.split_sections() 결과.
    """
    titles = parse_titles(sections.get("제목후보", ""))
    tags = parse_tags(sections.get("태그", ""))
    body = (sections.get("본문") or "").strip()
    title = titles[0] if titles else "제목 미정"

    keywords = tags[:3]
    front = [
        "---",
        f"title: {title}",
        f"category: {category}",
        f"keywords: {_yaml_list(keywords)}",
        "kb_refs: []",
        "status: ready",
        'published_url: ""',
        'published_at: ""',
        f'generated_by: "pipeline"',
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

    parts.append("=== 태그 ===")
    parts.append(", ".join(tags) if tags else "(태그가 생성되지 않았습니다)")
    parts.append("")

    parts.append("=== 리포트 ===")
    report = (sections.get("리포트") or "").strip()
    if not report:
        plain = re.sub(r"^\[이미지:.*?\]\s*$", "", body, flags=re.M).strip()
        report = f"총 글자수: {len(plain):,}자 (자동 집계)"
    parts.append(report)
    parts.append("")

    flags = [ln.strip() for ln in (sections.get("검토필요") or "").splitlines() if ln.strip()]
    if source_note:
        flags.append(f"- [출처] {source_note}")
    if flags:
        parts.append("=== 검토 필요 ===")
        parts.extend(flags)
        parts.append("")

    return f"{slugify(title)}.md", "\n".join(parts).rstrip() + "\n"


def save(sections: dict[str, str], *, category: str = "medical",
         source_note: str = "", ready_dir: Path | None = None) -> Path:
    """ready/ 에 저장하고 경로를 돌려준다. 같은 이름이 있으면 뒤에 번호를 붙인다."""
    directory = ready_dir or READY_DIR
    directory.mkdir(parents=True, exist_ok=True)
    name, content = build_markdown(sections, category=category, source_note=source_note)

    stem = Path(name).stem
    path = directory / name
    n = 2
    while path.exists():
        path = directory / f"{stem}-{n}.md"
        n += 1

    path.write_text(content, encoding="utf-8")
    return path
