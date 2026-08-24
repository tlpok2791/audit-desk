"""오프라인 통합 테스트 — 가짜 Notion 서버로 main.py 전체 경로를 태운다.

LLM 호출만 스텁으로 바꾸고 Notion 조회·기록·상태변경은 실제 코드로 돈다.
API 키가 없어도 돌아간다.

  python -m pipeline.selfcheck_integration
"""
from __future__ import annotations

import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT = 8798
CALLS: list[tuple] = []

SCHEMA = {"properties": {
    "제목": {"type": "title", "title": {}},
    "상태": {"type": "select", "select": {"options": [
        {"name": "대기"}, {"name": "처리중"}, {"name": "완료"}, {"name": "오류"}]}},
    "매출액": {"type": "number", "number": {}},
    "구조화JSON": {"type": "rich_text", "rich_text": {}},
    "제목후보": {"type": "rich_text", "rich_text": {}},
    "처리메모": {"type": "rich_text", "rich_text": {}},
    "담당자": {"type": "people", "people": {}},
    "서류": {"type": "files", "files": {}},
}}
PAGE = {"id": "page-1", "properties": {
    "제목": {"type": "title", "title": [{"plain_text": "마플의원 2025 종소세"}]},
    "상태": {"type": "select", "select": {"name": "대기"}},
    "매출액": {"type": "number", "number": None},
    "담당자": {"type": "people", "people": [{"id": "u1", "name": "홍길동"}]},
    "서류": {"type": "files", "files": []},
}}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, obj, code=200):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        CALLS.append(("GET", self.path))
        if "/databases/" in self.path:
            self._send({"id": "db-1", "data_sources": [{"id": "ds-1", "name": "기본"}]})
        elif "/data_sources/" in self.path:
            self._send(SCHEMA)
        else:
            self._send({})

    def _body(self):
        n = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(n) or "{}")

    def do_POST(self):
        body = self._body()
        CALLS.append(("POST", self.path, body))
        if self.path.endswith("/query"):
            self._send({"results": [PAGE], "has_more": False, "next_cursor": None})
        else:
            self._send({"results": []})

    def do_PATCH(self):
        CALLS.append(("PATCH", self.path, self._body()))
        self._send({"id": "page-1"})


def serve() -> None:
    srv = HTTPServer(("127.0.0.1", PORT), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()


passed = failed = 0


def check(name: str, cond: bool, detail: str = "") -> None:
    global passed, failed
    if cond:
        print(f"  ✓ {name}")
        passed += 1
    else:
        print(f"  ✗ {name}" + (f"\n    {detail}" if detail else ""))
        failed += 1


def statuses() -> list[str]:
    out = []
    for c in CALLS:
        if c[0] != "PATCH":
            continue
        st = (c[2].get("properties") or {}).get("상태") or {}
        name = (st.get("select") or {}).get("name")
        if name:
            out.append(name)
    return out


def written_props() -> dict:
    for c in CALLS:
        if c[0] == "PATCH" and "매출액" in (c[2].get("properties") or {}):
            return c[2]["properties"]
    return {}


def run(stub_crew, argv=("main",), ready_dir=None) -> int:
    """테스트는 절대 저장소에 파일을 남기지 않는다 — 원고는 늘 임시 폴더로."""
    import shutil
    import tempfile
    from pathlib import Path

    import pipeline.blog_out as B
    import pipeline.crew as C
    import pipeline.main as M
    import pipeline.notion_io as nio

    CALLS.clear()
    own_tmp = ready_dir is None
    tmp = Path(tempfile.mkdtemp()) if own_tmp else ready_dir
    real_ready = B.READY_DIR
    B.READY_DIR = tmp
    orig = nio.Client
    nio.Client = lambda auth: orig(auth=auth, base_url=f"http://127.0.0.1:{PORT}")
    M.build_vision_llm = lambda s: None
    C.build_vision_llm = lambda s: None
    M.read_documents = lambda llm, files: "[읽은 서류] 신고서.pdf\n\n매출 120,000,000원"
    M.build_crew = stub_crew

    sys.argv = list(argv)
    try:
        return M.main()
    finally:
        nio.Client = orig
        B.READY_DIR = real_ready
        if own_tmp:
            shutil.rmtree(tmp, ignore_errors=True)


class FakeResult:
    def __init__(self, raws):
        self.tasks_output = [type("O", (), {"raw": r})() for r in raws]


LONG_BODY = "본문 문단입니다. " * 700          # 2,000자를 훌쩍 넘긴다

NAVER_OUTPUT = """=== 진단리포트 ===
매출이 늘었습니다.

=== 제목후보 ===
1. 병의원 매출 신고 전 확인할 세 가지
2. 개원의가 놓치기 쉬운 수입금액
3. 비급여 수입 어디까지 신고하나

=== 본문 ===
개원 첫해 원장님들이 가장 많이 묻는 것입니다.
수입금액을 어디까지 잡아야 하는지가 핵심입니다.

[이미지 1 삽입 위치]

수입금액에 무엇이 들어가나

건강보험 급여와 비급여가 모두 들어갈 수 있습니다.
사안에 따라 달라질 수 있으니 개별 검토가 필요합니다.

[이미지 2 삽입 위치]

수입금액을 정리할 때 남겨 둘 자료

카드매출자료와 현금영수증 내역을 함께 맞춰 보는 것이 일반적입니다.

[이미지 3 삽입 위치]

이 글은 일반적인 정보 제공을 목적으로 작성되었습니다.

수입금액 정리가 어렵다면 편하게 문의해 주세요.

=== 이미지제작목록 ===
이미지 1
- 위치: 도입부 다음
- 목적: 수입금액에 무엇이 포함되는지 한눈에 보여준다
- 유형: 개념 설명형
- 구성: 건강보험 급여 · 비급여 · 기타수입을 하나의 원으로 묶은 구조
- 화면 문구: 수입금액은 급여와 비급여를 함께 봅니다
- 스타일: 한국 병의원, 한국어 중심, 깔끔한 세무 인포그래픽
- 비율: 네이버 블로그 가로형

이미지 2
- 위치: 수입금액 범위 설명 다음
- 목적: 급여와 비급여를 구분해 비교한다
- 유형: 비교형
- 구성: 왼쪽 건강보험 급여, 오른쪽 비급여를 나란히 둔 2단 비교
- 화면 문구: 둘 다 수입금액에 들어갈 수 있습니다
- 스타일: 한국어 중심 인포그래픽
- 비율: 네이버 블로그 가로형

이미지 3
- 위치: 증빙 설명 다음
- 목적: 정리해 둘 자료를 순서대로 보여준다
- 유형: 프로세스형
- 구성: 카드매출자료 → 현금영수증 → 진료비 수납내역 → 대사
- 화면 문구: 자료를 맞춰 보는 순서
- 스타일: 한국어 중심 인포그래픽
- 비율: 네이버 블로그 가로형

=== 핵심키워드 ===
수입금액, 비급여

=== 태그 ===
병의원세무, 수입금액, 비급여, 개원의, 병원장, 사업장현황신고, 종합소득세, 세무사, 병원세무, 신고

=== 검토필요 ===
- [근거] 비급여 범위 조문 확인 필요
"""

# 예전 규격(구획 5개·[이미지: 설명])도 계속 읽혀야 한다
LEGACY_OUTPUT = """=== 진단리포트 ===
확인 필요.

=== 제목후보 ===
1. 옛 규격 원고
2. 두 번째
3. 세 번째

=== 블로그원고 ===
옛 규격 본문입니다.

[이미지: 병원 데스크 사진]

두 번째 문단입니다.

=== 태그 ===
병의원세무, 개원의

=== 검토 필요 ===
- [의료광고] 확인 필요
"""

def main() -> int:
    import os
    for k in ("OPENAI_API_KEY", "GEMINI_API_KEY", "ANTHROPIC_API_KEY", "NOTION_TOKEN"):
        os.environ.setdefault(k, "test-key")
    os.environ.setdefault("NOTION_DATABASE_ID", "0" * 32)
    serve()

    print("성공 경로")
    ok_crew = lambda *a, **k: type("C", (), {"kickoff": lambda self: FakeResult([
        "서류: 종합소득세 / 매출 120,000,000원",
        '{"매출액": 120000000, "판독메모": "일부 판독불가"}',
        "=== 진단리포트 ===\n매출이 늘었습니다.\n\n=== 제목후보 ===\n1. 첫째\n2. 둘째\n3. 셋째\n"
        f"\n=== 블로그원고 ===\n{LONG_BODY}",
    ])})()
    rc = run(ok_crew)

    check("종료 코드 0", rc == 0, str(rc))
    check("상태가 처리중 → 완료 순서", statuses() == ["처리중", "완료"], str(statuses()))
    props = written_props()
    check("number 속성에 숫자로 기록", props.get("매출액") == {"number": 120000000.0}, str(props.get("매출액")))
    check("구조화JSON 기록됨", "구조화JSON" in props)
    check("제목후보 기록됨", "제목후보" in props)
    check("DB에 없는 키(판독메모)는 건너뜀", "판독메모" not in props, str(list(props)))

    blocks = [b for c in CALLS if "children" in c[1] and len(c) > 2
              for b in (c[2].get("children") or [])]
    check("페이지 본문에 블록 기록", len(blocks) > 0, str(len(blocks)))
    paras = [b["paragraph"]["rich_text"][0]["text"]["content"]
             for b in blocks if b["type"] == "paragraph"]
    check("모든 블록이 2,000자 이하 (Notion 한도)",
          all(len(p) <= 2000 for p in paras), str(sorted({len(p) for p in paras})))
    check("긴 원고가 여러 블록으로 쪼개짐", len(paras) >= 3, str(len(paras)))
    heads = [b["heading_2"]["rich_text"][0]["text"]["content"]
             for b in blocks if b["type"] == "heading_2"]
    check("진단리포트·블로그원고 제목 블록", "진단 리포트" in heads and "블로그 원고" in heads, str(heads))

    print("\n실패 경로 — 상태를 '오류'로 되돌리고 사유를 남긴다")

    def boom(*a, **k):
        raise RuntimeError("LLM 응답 없음")

    rc = run(boom)
    check("종료 코드 1", rc == 1, str(rc))
    check("상태가 처리중 → 오류", statuses() == ["처리중", "오류"], str(statuses()))
    err = [c for c in CALLS if c[0] == "PATCH"
           and "처리메모" in (c[2].get("properties") or {})]
    note = (err[-1][2]["properties"]["처리메모"]["rich_text"][0]["text"]["content"]
            if err else "")
    check("오류 사유가 기록됨", "LLM 응답 없음" in note, note[:80])

    print("\nJSON 못 만든 경우 — 원고만이라도 남긴다")
    half = lambda *a, **k: type("C", (), {"kickoff": lambda self: FakeResult([
        "판독 결과",
        "죄송합니다. JSON을 만들 수 없습니다.",
        "=== 진단리포트 ===\n확인이 필요합니다.\n\n=== 블로그원고 ===\n원고 본문",
    ])})()
    rc = run(half)
    check("종료 코드 0 (실패로 보지 않음)", rc == 0, str(rc))
    check("완료 처리됨", statuses() == ["처리중", "완료"], str(statuses()))
    blocks = [b for c in CALLS if "children" in c[1] and len(c) > 2
              for b in (c[2].get("children") or [])]
    check("원고는 본문에 남음", any("원고 본문" in json.dumps(b, ensure_ascii=False)
                                for b in blocks))

    print("\n자동 생성 — ready/ 원고 파일까지 만든다")
    import shutil, tempfile
    from pathlib import Path
    from pipeline import blog_out
    from pipeline.crew import check_naver_ready, split_sections

    tmp = Path(tempfile.mkdtemp())
    try:
        auto = lambda *a, **k: type("C", (), {"kickoff": lambda self: FakeResult([
            "판독", '{"매출액": 1}', NAVER_OUTPUT])})()
        rc = run(auto, ready_dir=tmp)
        check("종료 코드 0", rc == 0, str(rc))
        made = list(tmp.glob("*.md"))
        check("ready/ 에 원고 파일 생성", len(made) == 1, str([p.name for p in made]))
        if made:
            txt = made[0].read_text(encoding="utf-8")
            check("파일명이 첫 제목에서 나옴", "병의원" in made[0].name, made[0].name)
            for sec in ("=== 제목 후보 ===", "=== 본문 ===", "=== 이미지 제작 목록 ===",
                        "=== 태그 ===", "=== 리포트 ===", "=== 검토 필요 ==="):
                check(f"구분자 {sec}", sec in txt)
            check("프론트매터 category", "category: medical" in txt)
            check("자동 생성 표시", "generated_by: \"pipeline\"" in txt)
            check("keywords 는 핵심키워드에서", "keywords: [수입금액, 비급여]" in txt,
                  [l for l in txt.splitlines() if l.startswith("keywords")])
            check("tags 는 태그 10개 전체",
                  txt.count(",", txt.index("tags: ["), txt.index("]", txt.index("tags: ["))) == 9,
                  [l for l in txt.splitlines() if l.startswith("tags")])
            check("본문에 이미지 자리 3곳", txt.count("삽입 위치]") == 3)
            check("이미지 제작 목록 3개", txt.count("\n이미지 ") >= 3)
            rep = txt.split("=== 리포트 ===")[1].split("===")[0]
            check("리포트 이미지 개수 일치", "이미지 개수: 3개" in rep, rep)
            check("리포트 키워드 실제 횟수", "- 수입금액: " in rep and "- 비급여: " in rep, rep)
            check("모델이 안 센 글자수를 코드가 채움", "총 글자수:" in rep)
            sec = split_sections(NAVER_OUTPUT)
            check("본문에 마크다운 없음", not check_naver_ready(sec["본문"]),
                  str(check_naver_ready(sec["본문"])))
            check("이미지 자리는 마크다운 오탐 아님",
                  not check_naver_ready("[이미지 1 삽입 위치]\n본문"))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    print("\n예전 규격 원고도 그대로 처리된다 (기존 글이 깨지지 않는지)")
    tmp3 = Path(tempfile.mkdtemp())
    try:
        legacy = lambda *a, **k: type("C", (), {"kickoff": lambda self: FakeResult([
            "판독", '{"매출액": 1}', LEGACY_OUTPUT])})()
        rc = run(legacy, ready_dir=tmp3)
        check("종료 코드 0", rc == 0, str(rc))
        made = list(tmp3.glob("*.md"))
        check("파일 생성", len(made) == 1, str([p.name for p in made]))
        txt = made[0].read_text(encoding="utf-8") if made else ""
        check("블로그원고 별칭이 본문으로", "옛 규격 본문입니다." in txt)
        check("예전 [이미지: 설명] 도 이미지로 셈",
              "이미지 개수: 1개" in txt, txt.split("=== 리포트 ===")[1][:200] if txt else "")
        check("핵심키워드 없으면 태그 앞 3개로 물러섬",
              "keywords: [병의원세무, 개원의]" in txt,
              [l for l in txt.splitlines() if l.startswith("keywords")])
        check("이미지 제작 목록 없어도 파일은 만든다",
              "이미지 제작 목록이 생성되지 않았습니다" in txt)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    print("\n마크다운이 남으면 검토 필요로 표시한다")
    tmp2 = Path(tempfile.mkdtemp())
    try:
        dirty = NAVER_OUTPUT.replace("수입금액에 무엇이 들어가나",
                                     "## 수입금액에 무엇이 들어가나")
        bad = lambda *a, **k: type("C", (), {"kickoff": lambda self: FakeResult([
            "판독", '{"매출액": 1}', dirty])})()
        run(bad, ready_dir=tmp2)
        made = list(tmp2.glob("*.md"))
        txt = made[0].read_text(encoding="utf-8") if made else ""
        check("파일은 그래도 만든다", bool(made))
        check("마크다운 잔재를 검토 필요에 남김", "마크다운 잔재" in txt,
              txt[-200:] if txt else "")
    finally:
        shutil.rmtree(tmp2, ignore_errors=True)

    print(f"\n{passed}개 통과" + (f" · {failed}개 실패" if failed else ""))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
