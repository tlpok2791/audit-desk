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


def run(stub_crew, argv=("main",)) -> int:
    import pipeline.crew as C
    import pipeline.main as M
    import pipeline.notion_io as nio

    CALLS.clear()
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


class FakeResult:
    def __init__(self, raws):
        self.tasks_output = [type("O", (), {"raw": r})() for r in raws]


LONG_BODY = "본문 문단입니다. " * 700          # 2,000자를 훌쩍 넘긴다


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

    print(f"\n{passed}개 통과" + (f" · {failed}개 실패" if failed else ""))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
