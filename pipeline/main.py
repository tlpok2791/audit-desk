#!/usr/bin/env python3
"""
병의원 세무·마케팅 무인 자동화 파이프라인.

  Notion(대기) → Claude 서류 판독 → Claude JSON 정제 → Claude 원고 작성 → Notion(완료)

실행
  python -m pipeline.main              # 전체 실행
  python -m pipeline.main --dry-run    # Notion 만 읽고 LLM·쓰기는 하지 않음
  python -m pipeline.main --limit 1    # 한 건만
  python -m pipeline.main --check      # 환경변수·DB 연결만 확인
"""
from __future__ import annotations

import argparse
import sys
import traceback
from pathlib import Path
from datetime import datetime, timezone

from .config import load_settings, mask
from . import blog_out
from .crew import (build_crew, build_vision_llm, check_naver_ready, extract_json,
                   read_documents, split_sections)
from .notion_io import NotionRepo, pretty


def log(msg: str) -> None:
    print(f"[{datetime.now(timezone.utc):%H:%M:%S}] {msg}", flush=True)


def schema_hint(repo: NotionRepo, exclude: set[str]) -> str:
    """에이전트에게 넘길 스키마 요약 — 속성명을 코드에 박지 않기 위해."""
    lines = []
    for name, prop in repo.schema().items():
        t = prop.get("type")
        if name in exclude or t in ("files", "people", "created_by", "last_edited_by",
                                    "created_time", "last_edited_time", "formula",
                                    "rollup", "relation"):
            continue
        opts = ""
        cfg = prop.get(t) or {}
        if isinstance(cfg, dict) and cfg.get("options"):
            opts = " [" + ", ".join(o["name"] for o in cfg["options"][:12]) + "]"
        lines.append(f"- {name} ({t}){opts}")
    return "\n".join(lines) or "(속성 없음)"


def process_page(repo: NotionRepo, s, page: dict, dry: bool) -> str:
    page_id = page["id"]
    title = next((repo.plain(p) for p in page.get("properties", {}).values()
                  if p.get("type") == "title"), "") or page_id[:8]
    files = repo.file_urls(page)
    row = repo.row_context(page)

    log(f"  행: {title} · 첨부 {len(files)}건")
    if dry:
        log(f"    (dry-run) 속성 {len(row)}개, 첨부 {[n for n, _ in files]}")
        return "dry"

    # 중복 실행 방지 — 먼저 '처리중'으로 바꾼다
    repo.set_status(page_id, s.status_running)

    try:
        # 서류를 Claude 에게 그대로 보여주고 읽힌다 (PDF·이미지 직접 지원)
        doc_text = read_documents(build_vision_llm(s), files, s.anthropic_model)
        log(f"    서류 판독 {len(doc_text):,}자")

        crew = build_crew(s, row, doc_text,
                          schema_hint(repo, exclude={s.status_property}))
        result = crew.kickoff()

        # 각 단계 산출물 회수
        outputs = getattr(result, "tasks_output", None) or []
        raw = [getattr(o, "raw", str(o)) for o in outputs]
        structured = extract_json(raw[1]) if len(raw) > 1 else None
        written = split_sections(raw[2] if len(raw) > 2 else str(result))

        # ── Notion 기록 ────────────────────────────────
        values: dict[str, str] = {}
        if structured:
            for k, v in structured.items():
                if v is None or k == s.status_property:
                    continue
                values[k] = v if isinstance(v, str) else str(v)
        if repo.prop_type("구조화JSON") == "rich_text":
            values["구조화JSON"] = pretty(structured or {})
        if repo.prop_type("제목후보") == "rich_text":
            values["제목후보"] = written["제목후보"]

        # ── 네이버 발행용 원고 파일 ─────────────────────
        # 홈페이지 블로그 탭이 읽는 content/posts/ready/ 규격으로 떨군다.
        # 스마트에디터는 마크다운을 인식하지 못하므로 남아 있으면 표시해 둔다.
        md_left = check_naver_ready(written["본문"])
        note = "; ".join(md_left) if md_left else ""
        blog_path = None
        if written["본문"]:
            blog_path = blog_out.save(
                written, category=s.blog_category,
                kakao=s.contact_kakao, phone=s.contact_phone,
                source_note=(f"마크다운 잔재 — {note}" if note else
                             f"파이프라인 자동 생성 · Notion {page_id[:8]}"))
            try:                       # 저장소 안이면 상대경로로, 아니면 파일명만
                shown = blog_path.relative_to(Path(__file__).resolve().parents[1])
            except ValueError:
                shown = blog_path.name
            log(f"    원고 저장 {shown}"
                + (f" · 마크다운 잔재 {note}" if note else ""))
        elif not md_left:
            log("    원고가 생성되지 않아 파일을 만들지 않았습니다.")

        skipped = repo.write_results(page_id, values)
        repo.append_body(page_id, [
            ("진단 리포트", written["진단리포트"]),
            ("블로그 원고", written["본문"]),
            ("서류 판독 원문", doc_text[:8000]),
        ])
        repo.set_status(page_id, s.status_done,
                        note=f"자동 처리 완료 {datetime.now(timezone.utc):%Y-%m-%d %H:%M}Z"
                             + (f" · 원고 {blog_path.name}" if blog_path else "")
                             + (f" · 마크다운 잔재 {note}" if note else "")
                             + (f" · DB에 없어 건너뛴 속성: {', '.join(skipped)}" if skipped else ""))
        log(f"    완료 · 속성 {len(values) - len(skipped)}개 기록"
            + (f" · 건너뜀 {len(skipped)}개" if skipped else ""))
        return "ok"

    except Exception as e:
        log(f"    실패: {type(e).__name__}: {e}")
        traceback.print_exc()
        try:
            repo.set_status(page_id, s.status_error, note=f"{type(e).__name__}: {e}"[:1900])
        except Exception:
            log("    상태를 '오류'로 바꾸지도 못했습니다.")
        return "error"


def main() -> int:
    ap = argparse.ArgumentParser(description="병의원 세무·마케팅 자동화 파이프라인")
    ap.add_argument("--dry-run", action="store_true", help="Notion 읽기만, LLM·쓰기 없음")
    ap.add_argument("--check", action="store_true", help="환경변수·DB 연결만 확인")
    ap.add_argument("--limit", type=int, default=None, help="이번 실행에서 처리할 최대 건수")
    args = ap.parse_args()

    s = load_settings(require_keys=not args.check or True)
    dry = args.dry_run or s.dry_run
    limit = args.limit or s.max_pages

    log(f"파이프라인 시작 · 판독·구조화·작성 모두 Claude {s.anthropic_model}")
    log(f"  키: ANTHROPIC {mask(s.anthropic_api_key)} · NOTION {mask(s.notion_token)}")

    repo = NotionRepo(s.notion_token, s.notion_database_id, s.status_property)

    try:
        props = repo.schema()
    except Exception as e:
        log(f"Notion DB 를 열지 못했습니다 — {type(e).__name__}: {e}")
        log("  DB ID 가 맞는지, 통합(integration)이 그 DB 에 연결돼 있는지 확인하세요.")
        return 1

    log(f"  DB 속성 {len(props)}개 · 상태 속성 '{s.status_property}'"
        f" ({repo.prop_type(s.status_property) or '없음!'})")
    if not repo.has(s.status_property):
        log(f"  상태 속성 '{s.status_property}' 이 DB 에 없습니다. "
            "NOTION_STATUS_PROPERTY 로 실제 이름을 지정하세요.")
        return 1

    if args.check:
        log("점검 완료.")
        return 0

    pages = repo.fetch_pending(s.status_pending, limit)
    log(f"대기 중인 행 {len(pages)}건 (최대 {limit})")
    if not pages:
        log("처리할 것이 없습니다.")
        return 0

    tally = {"ok": 0, "error": 0, "dry": 0}
    for page in pages:
        tally[process_page(repo, s, page, dry)] += 1

    # 원고를 하나라도 만들었으면 홈페이지 목록을 다시 굽는다
    if tally["ok"]:
        try:
            import subprocess
            root = Path(__file__).resolve().parents[1]
            subprocess.run([sys.executable, "build_posts.py"], cwd=root, check=True,
                           capture_output=True, text=True, timeout=120)
            log("  src/data/posts.js 갱신")
        except Exception as e:
            log(f"  posts.js 갱신 실패(원고 파일은 남아 있습니다) — {e}")

    log(f"끝 — 성공 {tally['ok']} · 실패 {tally['error']}"
        + (f" · dry {tally['dry']}" if tally["dry"] else ""))
    return 1 if tally["error"] else 0


if __name__ == "__main__":
    sys.exit(main())
