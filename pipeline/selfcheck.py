"""파이프라인 검증 — API 키 없이 도는 부분만 확인한다.

  python -m pipeline.selfcheck
"""
from __future__ import annotations

import sys

from . import blog_out
from .crew import (SECTIONS, check_naver_ready, count_keywords, extract_json,
                   image_markers, keyword_density, parse_image_specs, split_sections,
                   strip_image_markers)
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
1. 병의원 가족 인건비, 어디까지 인정되나
2. 개원의가 놓치기 쉬운 항목
3. 비급여 수입 정리하기

=== 본문 ===
도입 문단입니다.

[이미지 1 삽입 위치]

가족 인건비 설명 문단입니다.

[이미지 2 삽입 위치]

마무리 문단입니다.

=== 이미지제작목록 ===
이미지 1
- 위치: 도입부 다음
- 목적: 가족 직원이 실제 근무하는 상황을 보여준다
- 유형: 상황 설명형
- 화면 문구: 실제 근무 여부가 중요합니다

이미지 2
- 위치: 증빙 설명 다음
- 목적: 증빙 자료를 한눈에 보여준다
- 유형: 체크리스트형

=== 핵심키워드 ===
가족 인건비, 비급여

=== 태그 ===
병의원세무, 개원의, 비급여

=== 검토필요 ===
- [근거] 필요경비 인정 요건 조문 확인
"""
sec = split_sections(sample)
check("여덟 구획 정의", len(SECTIONS) == 8, str(SECTIONS))
check("리포트 내용", sec["진단리포트"].startswith("매출이 전기 대비"))
check("제목 3개", sec["제목후보"].count("\n") == 2, sec["제목후보"])
check("본문 문단 유지", "\n\n" in sec["본문"])
check("이미지 제작 목록 구획", sec["이미지제작목록"].startswith("이미지 1"))
check("핵심키워드 구획", sec["핵심키워드"] == "가족 인건비, 비급여", sec["핵심키워드"])
check("태그 구획", sec["태그"] == "병의원세무, 개원의, 비급여", sec["태그"])
check("검토필요 구획", sec["검토필요"].startswith("- [근거]"), sec["검토필요"])
check("리포트는 모델이 안 채워도 됨", sec["리포트"] == "", repr(sec["리포트"]))
check("띄어쓴 구분자도 인식",
      split_sections("=== 이미지 제작 목록 ===\n이미지 1")["이미지제작목록"] == "이미지 1")
check("옛 이름(블로그원고)은 본문으로",
      split_sections("=== 블로그원고 ===\n옛 형식")["본문"] == "옛 형식")
check("구분자 없으면 통째로 리포트에",
      split_sections("구분자 없는 응답")["진단리포트"] == "구분자 없는 응답")
check("빈 입력", split_sections("")["진단리포트"] == "")

print("\n이미지 자리 · 키워드 집계 — 모델이 아니라 코드가 센다")

check("새 규격 자리표시자", [n for n, _ in image_markers(sec["본문"])] == ["1", "2"],
      str(image_markers(sec["본문"])))
check("예전 규격도 인식",
      image_markers("[이미지: 병원 데스크]") == [("", "병원 데스크")],
      str(image_markers("[이미지: 병원 데스크]")))
check("본문 아닌 대괄호는 무시", image_markers("문장 안 [이미지 1 삽입 위치] 는 제외") == [],
      str(image_markers("문장 안 [이미지 1 삽입 위치] 는 제외")))
check("글자수에서 자리표시자 제외",
      "[이미지" not in strip_image_markers(sec["본문"]))

specs = parse_image_specs(sec["이미지제작목록"])
check("이미지 2개 파싱", len(specs) == 2, str(len(specs)))
check("항목 파싱", specs[0]["fields"]["목적"].startswith("가족 직원이"), str(specs[0]))
check("항목 순서 유지", specs[0]["order"][:2] == ["위치", "목적"], str(specs[0]["order"]))
check("자리표시자 수와 목록 수 일치", len(specs) == len(image_markers(sec["본문"])))

hits = count_keywords("가족 인건비는 가족 인건비다. 비급여는 없다.", ["가족 인건비", "필요경비"])
check("등장 횟수 정확", hits == {"가족 인건비": 2, "필요경비": 0}, str(hits))
check("자리표시자 안의 글자는 안 셈",
      count_keywords("[이미지 1 삽입 위치]\n본문", ["삽입"]) == {"삽입": 0})
check("밀도 계산", 0 < keyword_density("가족 인건비 " * 5, {"가족 인건비": 5},
                                    ["가족 인건비"]) <= 1)

print("\n서류 판독 — Claude 에게 보낼 블록 모양 (API 호출 없음)")

from . import crew as _crew                      # download 를 갈아끼우기 위해

class _FakeResp:
    def __init__(self):
        self.content = [type("B", (), {"type": "text", "text": "매출 120,000,000원"})()]

class _FakeClient:
    """실제로 부르지 않고 무엇을 보내려 했는지만 기록한다."""
    def __init__(self):
        self.calls = []
        self.messages = self
    def create(self, **kw):
        self.calls.append(kw)
        return _FakeResp()

_FILES = {
    "https://x/a.pdf":  (b"%PDF-1.4 fake", "application/pdf"),
    "https://x/b.png":  (b"\x89PNG fake", "image/png"),
    "https://x/c.hwp":  (b"hwp", "application/x-hwp"),
    "https://x/big.pdf": (b"0" * (21 * 1024 * 1024), "application/pdf"),
    "https://x/dead.pdf": None,
}

_real_download = _crew.download
def _fake_download(url, timeout=60.0):
    got = _FILES.get(url)
    if got is None:
        raise RuntimeError("404")
    return got
_crew.download = _fake_download

try:
    check("첨부 없으면 호출하지 않음",
          _crew.read_documents(_FakeClient(), []) == "(첨부 서류 없음)")

    cli = _FakeClient()
    out = _crew.read_documents(cli, [("신고서.pdf", "https://x/a.pdf"),
                                     ("영수증.png", "https://x/b.png")], "claude-sonnet-5")
    blocks = cli.calls[0]["messages"][0]["content"]
    kinds = [b["type"] for b in blocks]
    check("PDF 는 document, 이미지는 image", kinds[:2] == ["document", "image"], str(kinds))
    check("지시문은 문서 뒤에 온다", kinds[-1] == "text", str(kinds))
    check("base64 로 실린다", blocks[0]["source"]["type"] == "base64")
    check("media_type 그대로", blocks[0]["source"]["media_type"] == "application/pdf")
    check("모델을 넘긴다", cli.calls[0]["model"] == "claude-sonnet-5", str(cli.calls[0].get("model")))
    check("temperature 를 보내지 않는다 (현행 모델은 400)",
          "temperature" not in cli.calls[0], str(list(cli.calls[0])))
    check("읽은 서류를 머리말에", out.startswith("[읽은 서류] 신고서.pdf, 영수증.png"), out[:60])
    check("응답 본문 포함", "120,000,000" in out)

    cli = _FakeClient()
    out = _crew.read_documents(cli, [("한글.hwp", "https://x/c.hwp")])
    check("지원 않는 형식은 호출 없이 건너뜀", not cli.calls and "지원하지 않는 형식" in out, out)

    cli = _FakeClient()
    out = _crew.read_documents(cli, [("큰파일.pdf", "https://x/big.pdf")])
    check("너무 큰 파일은 건너뜀", "크기를 넘음" in out, out)

    cli = _FakeClient()
    out = _crew.read_documents(cli, [("죽은링크.pdf", "https://x/dead.pdf"),
                                     ("신고서.pdf", "https://x/a.pdf")])
    check("한 장 실패해도 나머지는 읽는다",
          cli.calls and "내려받기 실패" in out and "신고서.pdf" in out, out[:80])
finally:
    _crew.download = _real_download

print("\n네이버 규격 점검 — 스마트에디터는 마크다운을 읽지 못한다")

check("깨끗한 본문은 통과", check_naver_ready("첫 문단입니다.\n\n둘째 문단입니다.") == [])
check("이미지 자리표시자는 문제 아님",
      check_naver_ready("[이미지: 진료비 영수증]\n\n본문입니다.") == [])
check("헤딩 적발", any("헤딩" in p for p in check_naver_ready("# 제목\n본문")))
check("굵게 적발", any("굵게" in p for p in check_naver_ready("이건 **중요** 합니다")))
check("리스트 적발", any("리스트" in p for p in check_naver_ready("- 첫째\n- 둘째")))
check("표 적발", any("표" in p for p in check_naver_ready("| a | b |\n| c | d |")))
check("링크 문법 적발",
      any("링크" in p for p in check_naver_ready("[국세청](https://nts.go.kr) 참고")))
check("빈 본문", check_naver_ready("") == [])

print("\n원고 파일 만들기 — content/posts/ready/ 규격")

md_name, md_text = blog_out.build_markdown(
    sec, category="medical", source_note="Notion abc12345",
    kakao="병의원세무상담", phone="010-0000-0000")
check("파일명은 첫 제목에서", md_name == "병의원-가족-인건비,-어디까지-인정되나.md", md_name)
check("프론트매터 title", "title: 병의원 가족 인건비, 어디까지 인정되나" in md_text)
check("자동 생성 표식", 'generated_by: "pipeline"' in md_text)
check("status ready", "status: ready" in md_text)
check("keywords 는 핵심키워드 구획에서",
      "keywords: [가족 인건비, 비급여]" in md_text,
      [l for l in md_text.splitlines() if l.startswith("keywords")])
check("tags 는 태그 구획 전체",
      "tags: [병의원세무, 개원의, 비급여]" in md_text,
      [l for l in md_text.splitlines() if l.startswith("tags")])
check("keywords 와 tags 가 다름",
      "keywords: [병의원세무" not in md_text)
check("홈페이지가 읽는 구분자 유지",
      all(m in md_text for m in ("=== 제목 후보 ===", "=== 본문 ===",
                                 "=== 이미지 제작 목록 ===", "=== 태그 ===",
                                 "=== 리포트 ===")))
check("본문 그대로", "도입 문단입니다." in md_text and "마무리 문단입니다." in md_text)
check("이미지 자리 유지", md_text.count("삽입 위치]") == 2)
check("이미지 제작 목록 실림", "- 유형: 체크리스트형" in md_text)
check("연락처는 도구가 붙임",
      "카카오톡 오픈채팅 병의원세무상담" in md_text and "전화 010-0000-0000" in md_text)
check("출처 메모는 검토 필요에", "- [출처] Notion abc12345" in md_text)

report = md_text.split("=== 리포트 ===")[1].split("===")[0]
check("리포트에 핵심 키워드", "핵심 키워드: 가족 인건비, 비급여" in report, report)
check("리포트에 이미지 개수", "이미지 개수: 2개" in report, report)
check("리포트 글자수는 코드가 계산", "총 글자수:" in report and "자 (이미지 자리 제외)" in report)

flags = md_text.split("=== 검토 필요 ===")[1]
check("모델 검토 항목 유지", "- [근거] 필요경비 인정 요건 조문 확인" in flags)
check("본문에 없는 키워드는 [키워드] 로", "[키워드]" in flags and "비급여" in flags, flags)
check("짧은 본문은 [분량] 으로", "[분량]" in flags, flags)

# 연락처를 설정하지 않으면 자리만 남긴다 (모델이 번호를 지어내지 않게)
_, no_contact = blog_out.build_markdown(sec)
check("연락처 미설정 자리표시", "(연락처 미설정" in no_contact)

# 이미지 수와 목록 수가 어긋나면 알린다
bad = dict(sec)
bad["이미지제작목록"] = "이미지 1\n- 위치: 도입부 다음"
_, bad_text = blog_out.build_markdown(bad)
check("자리 2개 · 목록 1개 → [이미지] 표시", "[이미지]" in bad_text, bad_text[-400:])

# 기존 글과 주제가 겹치면 알린다
dup = blog_out.find_duplicates(
    "병의원 가족 인건비, 어디까지 인정되나", ["가족 인건비"],
    [("병의원 가족 인건비, 어디까지 인정될까", ["가족 인건비", "필요경비"])])
check("중복 주제 탐지", len(dup) == 1 and "제목 유사도" in dup[0], str(dup))
check("다른 주제는 조용", blog_out.find_duplicates(
    "양도소득세 1세대 1주택", ["양도세"],
    [("병의원 가족 인건비", ["가족 인건비"])]) == [])

check("핵심키워드 없으면 예전처럼 태그 앞 3개",
      blog_out.pick_keywords({}, ["가", "나", "다", "라"]) == ["가", "나", "다"])

empty_name, empty_text = blog_out.build_markdown({})
check("빈 입력도 파일이 됨", empty_name == "제목-미정.md", empty_name)
check("빈 입력 리포트", "총 글자수: 0자" in empty_text, empty_text)
check("슬러그에서 경로 문자 제거",
      blog_out.slugify("가족 인건비/급여: 정리?") == "가족-인건비급여-정리",
      blog_out.slugify("가족 인건비/급여: 정리?"))
check("태그 파싱 — # 제거", blog_out.parse_tags("#가, 나,\n#다") == ["가", "나", "다"])
check("제목 후보 파싱", blog_out.parse_titles("1. 첫째\n2) 둘째\n설명줄") == ["첫째", "둘째"])
check("제목의 유형 표시는 떼어냄",
      blog_out.parse_titles("1. (질문형) 가족 급여 인정될까") == ["가족 급여 인정될까"])

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
