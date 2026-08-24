"""파이프라인 검증 — API 키 없이 도는 부분만 확인한다.

  python -m pipeline.selfcheck
"""
from __future__ import annotations

import sys

from .crew import extract_json, split_sections
from .notion_io import NotionRepo

passed = failed = 0


def check(name: str, cond: bool, detail: str = "") -> None:
    global passed, failed
    if cond:
        print(f"  ✓ {name}")
        passed += 1
    else:
        print(f"  ✗ {name}" + (f"\n    {detail}" if detail else ""))
        failed += 1


print("JSON 추출 — 모델이 뭘 붙여 보내든 건져낸다")

check("순수 JSON", extract_json('{"매출":1000}') == {"매출": 1000})
check("코드펜스", extract_json('```json\n{"매출":1000}\n```') == {"매출": 1000})
check("앞뒤 설명", extract_json('결과입니다:\n{"매출":1000}\n확인하세요.') == {"매출": 1000})
check("중첩 객체",
      extract_json('{"a":{"b":{"c":1}},"d":2}') == {"a": {"b": {"c": 1}}, "d": 2})
check("문자열 안 중괄호",
      extract_json('설명 {"메모":"금액은 {미상} 입니다","값":3}')
      == {"메모": "금액은 {미상} 입니다", "값": 3})
check("이스케이프된 따옴표",
      extract_json(r'{"메모":"그는 \"확인\" 이라 적었다"}')
      == {"메모": '그는 "확인" 이라 적었다'})
check("배열은 거부 (dict 만 받는다)", extract_json('[1,2,3]') is None)
check("JSON 아님", extract_json("죄송합니다, 만들 수 없습니다") is None)
check("빈 입력", extract_json("") is None)

print("\nAgent 3 출력 구획 나누기")

sample = """=== 진단리포트 ===
매출이 전기 대비 늘었습니다. 확인이 필요합니다.

=== 제목후보 ===
1. 병의원 매출 신고 전 확인할 것
2. 개원의가 놓치기 쉬운 항목
3. 비급여 수입 정리하기

=== 블로그원고 ===
본문 첫 문단.

본문 둘째 문단.
"""
sec = split_sections(sample)
check("세 구획 분리", all(sec[k] for k in ("진단리포트", "제목후보", "블로그원고")))
check("리포트 내용", sec["진단리포트"].startswith("매출이 전기 대비"))
check("제목 3개", sec["제목후보"].count("\n") == 2, sec["제목후보"])
check("원고 문단 유지", "\n\n" in sec["블로그원고"])
check("구분자 없으면 통째로 리포트에",
      split_sections("구분자 없는 응답")["진단리포트"] == "구분자 없는 응답")
check("빈 입력", split_sections("")["진단리포트"] == "")

print("\nNotion 2,000자 제한 — 긴 원고를 그대로 넣으면 400 이 난다")

long_text = "가" * 5500
chunks = NotionRepo.chunks(long_text)
check("2,000자 단위로 쪼갬", all(len(c) <= 2000 for c in chunks), f"{[len(c) for c in chunks]}")
check("내용 손실 없음", "".join(chunks) == long_text)
check("조각 수", len(chunks) == 3, str(len(chunks)))
check("빈 문자열도 한 조각", NotionRepo.chunks("") == [""])

print("\nNotion 속성 읽기")

check("title", NotionRepo.plain(
    {"type": "title", "title": [{"plain_text": "마플"}, {"plain_text": " 의원"}]}) == "마플 의원")
check("rich_text", NotionRepo.plain(
    {"type": "rich_text", "rich_text": [{"plain_text": " 메모 "}]}) == "메모")
check("select", NotionRepo.plain({"type": "select", "select": {"name": "대기"}}) == "대기")
check("빈 select 는 빈 문자열", NotionRepo.plain({"type": "select", "select": None}) == "")
check("status", NotionRepo.plain({"type": "status", "status": {"name": "완료"}}) == "완료")
check("number 0 을 삼키지 않음", NotionRepo.plain({"type": "number", "number": 0}) == "0")
check("multi_select", NotionRepo.plain(
    {"type": "multi_select", "multi_select": [{"name": "A"}, {"name": "B"}]}) == "A, B")
check("date", NotionRepo.plain(
    {"type": "date", "date": {"start": "2026-01-01", "end": "2026-12-31"}})
    == "2026-01-01 ~ 2026-12-31")
check("None 안전", NotionRepo.plain(None) == "")

print("\n첨부 파일 찾기")

page = {"properties": {
    "서류": {"type": "files", "files": [
        {"name": "신고서.pdf", "file": {"url": "https://x/a.pdf?sig=1"}},
        {"name": "외부.png", "external": {"url": "https://y/b.png"}},
    ]},
    "참고링크": {"type": "url", "url": "https://z/c.pdf"},
    "홈페이지": {"type": "url", "url": "https://example.com"},   # 문서 아님 → 제외
    "담당자": {"type": "people", "people": [{"id": "u1"}]},        # 개인정보 → 제외
}}
urls = NotionRepo.file_urls(page)
names = [n for n, _ in urls]
check("files 속성 두 건", "신고서.pdf" in names and "외부.png" in names, str(names))
check("문서 확장자 URL 포함", "참고링크" in names, str(names))
check("일반 URL 제외", "홈페이지" not in names, str(names))
check("첨부 없는 행은 빈 목록", NotionRepo.file_urls({"properties": {}}) == [])

print("\n행 컨텍스트 — 개인정보 속성은 프롬프트에 넣지 않는다")
ctx = NotionRepo.row_context.__wrapped__(None, page) if hasattr(
    NotionRepo.row_context, "__wrapped__") else None
# row_context 는 인스턴스 메서드지만 self 를 쓰지 않으므로 직접 호출한다
ctx = NotionRepo.row_context(NotionRepo.__new__(NotionRepo), page)
check("people 속성 제외", "담당자" not in ctx, str(ctx))
check("files 속성 제외", "서류" not in ctx, str(ctx))
check("url 은 포함", ctx.get("홈페이지") == "https://example.com", str(ctx))

print(f"\n{passed}개 통과" + (f" · {failed}개 실패" if failed else ""))
sys.exit(1 if failed else 0)
