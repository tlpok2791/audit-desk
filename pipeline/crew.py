"""CrewAI 오케스트레이션 — 세 모델의 강점을 이어붙인다.

  Agent 1  Gemini    대용량 PDF·이미지 서류를 읽어 핵심 수치를 뽑는다 (멀티모달)
  Agent 2  GPT       뽑아낸 덩어리를 Notion 스키마에 맞는 JSON 으로 정제한다
  Agent 3  Claude    정제된 수치로 병의원 블로그 원고와 진단 리포트를 쓴다

OCR 은 에이전트 프롬프트만으로는 못 한다(바이너리를 못 실어보낸다).
그래서 Agent 1 은 문서를 실제로 읽는 도구를 들고 있고, 그 결과를 가지고 판단한다.
"""
from __future__ import annotations

import base64
import json
import re
from typing import Any

from crewai import Agent, Crew, Process, Task

from .config import Settings
from .notion_io import download

# 세무 자료를 다루므로 창의성은 낮게 둔다 (수치를 지어내면 안 된다)
TEMP_EXTRACT = 0.0
TEMP_STRUCTURE = 0.0
TEMP_WRITE = 0.4

GEMINI_INLINE_LIMIT = 18 * 1024 * 1024   # inline base64 로 보낼 수 있는 대략적 상한


# ── LLM 준비 ─────────────────────────────────────────────
# CrewAI 1.x 의 Agent 는 LangChain LLM 객체를 받지 않는다 (pydantic 검증에서 막힌다).
# crewai.LLM 에 "provider/model" 형식으로 넘겨야 한다.
def build_crew_llms(s: Settings):
    from crewai import LLM

    gemini = LLM(model=f"gemini/{s.gemini_model}",
                 api_key=s.gemini_api_key, temperature=TEMP_EXTRACT)
    gpt = LLM(model=f"openai/{s.openai_model}",
              api_key=s.openai_api_key, temperature=TEMP_STRUCTURE)
    claude = LLM(model=f"anthropic/{s.anthropic_model}",
                 api_key=s.anthropic_api_key, temperature=TEMP_WRITE, max_tokens=8000)
    return gemini, gpt, claude


def build_vision_llm(s: Settings):
    """
    서류 판독 전용. 여기서는 LangChain 을 쓴다 —
    PDF·이미지를 inline 으로 실어 보내는 멀티모달 호출이 필요하고,
    그건 CrewAI 의 텍스트 태스크로는 할 수 없다.
    """
    from langchain_google_genai import ChatGoogleGenerativeAI

    return ChatGoogleGenerativeAI(
        model=s.gemini_model, google_api_key=s.gemini_api_key, temperature=TEMP_EXTRACT,
    )


# ── Agent 1 이 쓰는 실제 OCR ────────────────────────────
OCR_PROMPT = """이 세무 서류에서 아래를 있는 그대로 뽑아라.

1. 서류 종류 (사업장현황신고서 / 부가세신고서 / 종합소득세신고서 / 원천징수이행상황신고서 /
   재무제표 / 시산표 / 급여대장 / 카드매출자료 / 그 밖)
2. 귀속연도와 과세기간
3. 사업자 정보 (상호, 사업자등록번호, 업종)
4. 표에 있는 금액 항목 전부 — 항목명과 금액을 쌍으로. 단위(원/천원)를 반드시 함께 적어라.
5. 합계·소계로 표시된 금액

규칙
- 보이는 숫자만 적는다. 계산해서 채우거나 추정하지 않는다.
- 흐릿하거나 잘려서 못 읽은 항목은 값을 비우고 "판독불가"라고 적는다.
- 표를 요약하지 말고 항목을 빠짐없이 나열한다.
"""


def read_documents(llm, files: list[tuple[str, str]]) -> str:
    """
    첨부 서류를 Gemini 멀티모달로 읽어 텍스트로 돌려준다.
    PDF·이미지를 inline base64 로 실어 보낸다.
    """
    from langchain_core.messages import HumanMessage

    if not files:
        return "(첨부 서류 없음)"

    parts: list[dict[str, Any]] = [{"type": "text", "text": OCR_PROMPT}]
    read, skipped = [], []

    for name, url in files:
        try:
            blob, mime = download(url)
        except Exception as e:                      # 한 장 실패로 전체를 죽이지 않는다
            skipped.append(f"{name}: 내려받기 실패 ({e})")
            continue
        if len(blob) > GEMINI_INLINE_LIMIT:
            skipped.append(f"{name}: {len(blob)//1024//1024}MB — 인라인 한도 초과")
            continue
        if not (mime.startswith("image/") or mime == "application/pdf"):
            skipped.append(f"{name}: 지원하지 않는 형식({mime})")
            continue
        parts.append({
            "type": "media",
            "mime_type": mime,
            "data": base64.b64encode(blob).decode(),
        })
        read.append(name)

    if not read:
        return "(읽은 서류 없음) " + "; ".join(skipped)

    resp = llm.invoke([HumanMessage(content=parts)])
    text = resp.content if isinstance(resp.content, str) else str(resp.content)
    header = f"[읽은 서류] {', '.join(read)}\n"
    if skipped:
        header += f"[건너뜀] {'; '.join(skipped)}\n"
    return header + "\n" + text


# ── JSON 추출 ────────────────────────────────────────────
def extract_json(text: str) -> dict | None:
    """모델이 코드펜스나 설명을 붙여 보내도 JSON 만 건져낸다."""
    if not text:
        return None
    t = str(text).strip()
    t = re.sub(r"^```(?:json)?\s*", "", t)
    t = re.sub(r"\s*```$", "", t)
    try:
        obj = json.loads(t)
        return obj if isinstance(obj, dict) else None
    except json.JSONDecodeError:
        pass
    start = t.find("{")
    while start != -1:                              # 중괄호 균형을 보며 첫 객체를 찾는다
        depth, in_str, esc = 0, False, False
        for i in range(start, len(t)):
            ch = t[i]
            if in_str:
                if esc:
                    esc = False
                elif ch == "\\":
                    esc = True
                elif ch == '"':
                    in_str = False
                continue
            if ch == '"':
                in_str = True
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    try:
                        obj = json.loads(t[start:i + 1])
                        if isinstance(obj, dict):
                            return obj
                    except json.JSONDecodeError:
                        break
        start = t.find("{", start + 1)
    return None


# ── Crew 구성 ────────────────────────────────────────────
def build_crew(s: Settings, row: dict[str, str], doc_text: str,
               schema_hint: str) -> Crew:
    gemini, gpt, claude = build_crew_llms(s)

    analyst = Agent(
        role="세무 서류 판독관",
        goal="서류에서 뽑힌 원문을 검토해 세무상 의미 있는 수치만 정리한다",
        backstory=(
            "병의원 세무 서류를 오래 다뤄 온 실무자다. 서류 종류만 봐도 어떤 표의 "
            "어떤 줄이 중요한지 안다. 읽히지 않은 값을 추측으로 채우는 일은 하지 않는다."
        ),
        llm=gemini, verbose=True, allow_delegation=False,
    )
    structurer = Agent(
        role="데이터 정제 담당",
        goal="정리된 내용을 Notion DB 스키마에 그대로 넣을 수 있는 JSON 으로 만든다",
        backstory=(
            "지저분한 텍스트를 스키마에 맞는 구조로 바꾸는 일을 한다. "
            "스키마에 없는 키를 만들어내지 않고, 값이 없으면 null 로 둔다."
        ),
        llm=gpt, verbose=True, allow_delegation=False,
    )
    writer = Agent(
        role="병의원 세무 콘텐츠 작성자",
        goal="정제된 수치를 근거로 원장이 읽을 진단 리포트와 블로그 원고를 쓴다",
        backstory=(
            "병의원 원장을 상대로 오래 글을 써 왔다. 단정적인 결론 대신 "
            "확인이 필요한 지점을 짚어 주는 글이 신뢰를 얻는다는 것을 안다."
        ),
        llm=claude, verbose=True, allow_delegation=False,
    )

    row_text = "\n".join(f"- {k}: {v}" for k, v in row.items()) or "(Notion 행 정보 없음)"

    t1 = Task(
        description=(
            "아래는 이 건의 Notion 행 정보와, 첨부 서류에서 읽어낸 원문이다.\n\n"
            f"[Notion 행]\n{row_text}\n\n"
            f"[서류 판독 원문]\n{doc_text}\n\n"
            "할 일: 세무상 의미 있는 수치를 항목명·금액·단위·귀속기간과 함께 정리하라. "
            "서류 종류와 사업자 정보를 맨 위에 적어라. "
            "판독불가로 표시된 항목은 그대로 판독불가로 남겨라. 숫자를 지어내지 마라."
        ),
        expected_output="서류 종류·사업자정보·귀속기간과 항목별 금액 목록",
        agent=analyst,
    )
    t2 = Task(
        description=(
            "앞 단계 결과를 아래 스키마에 맞는 JSON 하나로 만들어라.\n\n"
            f"[Notion DB 속성]\n{schema_hint}\n\n"
            "규칙\n"
            "- 위 목록에 있는 속성명만 키로 쓴다. 없는 키를 만들지 않는다.\n"
            "- 금액은 숫자만 넣는다(쉼표·'원' 제거). 값이 없으면 null.\n"
            "- 판독불가였던 항목은 null 로 두고, 무엇이 판독불가였는지 "
            "  '판독메모' 키에 문자열로 적는다.\n"
            "- JSON 만 출력한다. 설명·코드펜스를 붙이지 마라."
        ),
        expected_output='{"속성명": 값, ...} 형태의 JSON 하나',
        agent=structurer, context=[t1],
    )
    t3 = Task(
        description=(
            "앞 단계의 JSON 수치를 근거로 진단 리포트와 네이버 블로그 원고를 쓴다.\n"
            "이 블로그는 병의원 세무 전문 회계사의 고객 유입 채널이다. "
            "원장이 실제로 궁금해하는 문제를 정확하게, 짧고 읽기 쉽게 다룬다.\n\n"

            "■ 가장 중요한 제약 — 네이버 스마트에디터는 마크다운을 인식하지 못한다\n"
            "원고에 아래가 하나라도 남으면 화면에 기호가 그대로 찍혀 못 쓴다.\n"
            "  #, ##, ### 등 헤딩 기호 / **굵게** *기울임* / 줄 앞의 -, *, 1. 리스트 기호\n"
            "  > 인용 / 백틱 코드 / [텍스트](링크) / | 표\n"
            "대신 이렇게 쓴다.\n"
            "  소제목 → 별도 줄에 평문으로만. 앞뒤 빈 줄. 기호를 붙이지 않는다.\n"
            "  강조 → 본문에서는 하지 않는다. 강조하고 싶은 문장은 아래 '검토필요'가 아니라 "
            "본문 안에서 문장 순서와 위치로 드러낸다.\n"
            "  나열 → 기호 없이 줄바꿈, 또는 '첫째, 둘째' / '①, ②' 같은 평문 기호.\n"
            "  링크 → 주소를 평문 그대로.\n"
            "아래 === 구분자 === 와 [이미지 n 삽입 위치] 는 도구가 읽는 표식이라 예외다.\n\n"

            "■ 제목 후보 3개 — 성격을 서로 다르게\n"
            "1번 질문형: 원장이 실제로 검색창에 칠 법한 질문.\n"
            "2번 정보형: 검색 의도가 명확한 정보성 제목.\n"
            "3번 대상 특화형: 병의원 원장을 명확히 대상으로 지목하는 제목.\n"
            "28자 내외, 핵심 키워드를 앞쪽에 둔다. "
            "'무조건', '100%', '절대', '무조건 절세' 같은 과장·클릭베이트 표현은 쓰지 않는다.\n\n"

            "■ 글 길이 — 본문 900~1,500자를 기본 범위로 한다\n"
            "(이미지 목록·태그·리포트는 글자수에 넣지 않는다.)\n"
            "주제가 복잡할 때만 자연스럽게 늘린다. 같은 내용을 다시 풀어 쓰지 마라.\n"
            "한 문단은 3~4줄. 문단 사이에 빈 줄. 모바일에서 벽처럼 보이면 안 된다.\n\n"

            "■ 소제목 — 필요할 때만, 짧게\n"
            "예: '가족 직원 급여, 먼저 확인할 것' / '급여 수준도 함께 봐야 합니다'\n"
            "소제목을 너무 많이 만들지 않는다.\n\n"

            "■ 본문 구성\n"
            "  도입부(3~4줄) → 정보 단위별 문단 → 필요하면 핵심 체크포인트 → 마무리 → 상담 유도 문구\n"
            "상담 유도 문구는 한두 문장으로 담백하게 쓴다. "
            "전화번호·오픈채팅 주소는 절대 지어내지 마라. 연락처는 도구가 붙인다.\n"
            "본문 맨 끝(상담 유도 문구 앞)에 넣는다: "
            "'이 글은 일반적인 정보 제공을 목적으로 작성되었으며, 특정 사안에 대한 세무 자문이 아닙니다. "
            "실제 적용은 개별 사실관계와 신고 시점의 세법에 따라 달라질 수 있으므로, "
            "구체적인 사안은 별도 검토가 필요합니다.'\n\n"

            "■ 이미지 삽입 위치 — 문단 수가 아니라 '정보 전달 단위'로 정한다\n"
            "하나의 정보 단위를 설명하고 끝난 지점에 [이미지 1 삽입 위치] 를 별도 줄로 넣는다.\n"
            "번호는 1부터 순서대로. 3~5개를 권장하되 글에 따라 2~6개 사이에서 조정한다.\n"
            "몇 줄마다 기계적으로 넣지 마라. 설명할 정보 단위가 없는 곳에는 넣지 않는다.\n"
            "예: 실제 근무 여부를 설명한 뒤 → 근무 상황 이미지 / "
            "급여 수준을 설명한 뒤 → 급여 비교 이미지 / 증빙을 설명한 뒤 → 증빙 체크리스트\n\n"

            "■ 이미지 제작 목록 — 본문의 각 [이미지 n 삽입 위치] 에 하나씩 대응\n"
            "이미지는 장식이 아니라 본문을 시각적으로 이해시키는 수단이다. "
            "본문 문장을 그대로 옮겨 적은 이미지, 의미 없는 병원 사진 반복은 만들지 않는다.\n"
            "유형은 이 중에서 고른다: 상황 설명형 / 비교형 / 프로세스형 / 체크리스트형 / 개념 설명형\n"
            "각 이미지를 아래 항목으로 적는다. '왜 이 이미지가 필요한지'를 목적에 쓴다.\n"
            "  이미지 n\n"
            "  - 위치: 본문 어디 다음인지 (예: 도입부 다음, 급여 수준 설명 다음)\n"
            "  - 목적: 이 이미지가 독자에게 무엇을 이해시키는지\n"
            "  - 유형: 상황 설명형 / 비교형 / 프로세스형 / 체크리스트형 / 개념 설명형 중 하나\n"
            "  - 구성: 화면에 무엇이 어떻게 배치되는지 (프로세스형이면 단계를 화살표로 나열)\n"
            "  - 화면 문구: 이미지 안에 넣을 한국어 문구 (짧게. 글자를 많이 넣지 않는다)\n"
            "  - 스타일: 한국 병의원 맥락, 한국어 중심, 깔끔한 세무 콘텐츠용\n"
            "  - 비율: 네이버 블로그 가로형\n"
            "이미지 안 문구는 한국어로 쓴다. 영어를 쓰지 마라.\n"
            "다른 곳의 인포그래픽을 베끼지 말고 이 글의 논리에 맞는 구성을 새로 설계한다.\n\n"

            "■ 핵심키워드 3~5개\n"
            "원장이 검색창에 실제로 칠 검색어로 고른다. "
            "앞 단계 자료와 제목·본문의 검색 의도에서 뽑는다. "
            "태그와 같은 것을 적지 마라 — 태그는 넓게, 핵심키워드는 좁고 정확하게.\n"
            "여기 적은 키워드가 본문에 실제로 몇 번 나오는지는 도구가 센다. "
            "횟수를 맞추려고 문장을 억지로 늘리거나 키워드를 끼워 넣지 마라.\n\n"

            "■ 태그 10개 — 핵심 키워드 + 연관 검색어 + 대상 독자(개원의, 병원장)를 섞어 쉼표로.\n\n"

            "■ 세무 콘텐츠 규칙 (어기면 못 쓴다)\n"
            "- 앞 단계 JSON 에 있는 숫자만 쓴다. 없는 수치·연도·비율을 만들지 마라.\n"
            "- 단정적 표현 금지. '~할 수 있습니다', '~하는 것이 일반적입니다' 로 쓴다.\n"
            "  사안별 차이가 있는 대목에는 '사안에 따라 달라질 수 있으니 개별 검토가 "
            "필요합니다'를 덧붙인다.\n"
            "- 세율·공제액·한도·인정 여부·필요경비 여부·소득구분·신고기준·적용시기 는 "
            "특히 함부로 단정하지 않는다. 근거가 부족하면 본문에서 단정하지 말고 "
            "검토필요에 [근거] 로 남긴다.\n"
            "- 절세 결과를 보장하는 표현('무조건 절세', '100% 인정', '세금을 줄여 드립니다')은 "
            "쓰지 않는다.\n"
            "- 특정 병의원 홍보, 치료 효과 단정, 환자 유인 표현은 쓰지 않는다 "
            "(의료광고 심의 대상이 될 수 있다).\n"
            "- 근거 조문을 확실히 모르면 아예 쓰지 마라. 지어내지 마라.\n\n"

            "■ 검토 필요 — 사람이 확인해야 할 것만 남긴다. 없는 항목은 쓰지 않는다.\n"
            "  [근거] 법령·예규·판례 확인이 필요한 대목\n"
            "  [수치] 세율·금액·한도 등 확인이 필요한 숫자, 판독불가였던 숫자\n"
            "  [최신성] 개정세법·최신 기준 확인이 필요한 대목\n"
            "  [의료광고] 표현상 주의가 필요한 문구\n"
            "억지로 항목을 늘리지 마라. 확인할 것이 없으면 그 구획을 비운다.\n"
            "([키워드]·[중복] 항목은 도구가 계산해 붙이므로 네가 쓰지 않는다.)\n\n"

            "출력 형식 — 아래 일곱 구분자를 그대로 지켜라. 순서도 바꾸지 마라.\n"
            "=== 진단리포트 ===\n(원장에게 보내는 요약. 눈에 띄는 수치와 확인할 항목)\n\n"
            "=== 제목후보 ===\n1. (질문형)\n2. (정보형)\n3. (대상 특화형)\n\n"
            "=== 본문 ===\n(마크다운 없는 평문. [이미지 n 삽입 위치] 를 정보 단위 끝에)\n\n"
            "=== 이미지제작목록 ===\n이미지 1\n- 위치: \n- 목적: \n- 유형: \n- 구성: \n"
            "- 화면 문구: \n- 스타일: \n- 비율: \n\n이미지 2\n...\n\n"
            "=== 핵심키워드 ===\n키워드1, 키워드2, 키워드3\n\n"
            "=== 태그 ===\n태그1, 태그2, ... (10개)\n\n"
            "=== 검토필요 ===\n- [근거] ...\n\n"
            "저장 전 스스로 확인하라. 본문에 #, **, 줄 앞 '- ' 가 남아 있지 않은가? "
            "본문이 900자보다 짧거나 1,500자를 크게 넘지 않는가? "
            "[이미지 n 삽입 위치] 개수와 이미지 제작 목록 개수가 같은가? "
            "말미 안내 문구가 있는가?"
        ),
        expected_output=(
            "=== 진단리포트 === / === 제목후보 === / === 본문 === / === 이미지제작목록 === / "
            "=== 핵심키워드 === / === 태그 === / === 검토필요 === 일곱 구획"
        ),
        agent=writer, context=[t2],
    )

    return Crew(agents=[analyst, structurer, writer], tasks=[t1, t2, t3],
                process=Process.sequential, verbose=True)


SECTIONS = ["진단리포트", "제목후보", "본문", "이미지제작목록", "핵심키워드",
            "태그", "리포트", "검토필요"]

# 예전 구획명·띄어쓴 구획명으로 나오는 경우를 흡수한다.
# '리포트' 는 이제 도구가 계산해 채우지만, 모델이 보내오면 버리지 않고 받아 둔다.
ALIASES = {"블로그원고": "본문", "검토 필요": "검토필요", "제목 후보": "제목후보",
           "이미지 제작 목록": "이미지제작목록", "핵심 키워드": "핵심키워드"}


def split_sections(text: str) -> dict[str, str]:
    """Agent 3 결과를 구분자로 나눈다."""
    out = {k: "" for k in SECTIONS}
    if not text:
        return out
    names = "|".join(re.escape(n) for n in list(ALIASES) + SECTIONS)
    parts = re.split(rf"^===\s*({names})\s*===\s*$", str(text), flags=re.M)
    for i in range(1, len(parts) - 1, 2):
        key = ALIASES.get(parts[i], parts[i])
        if key in out:
            out[key] = parts[i + 1].strip()
    if not any(out.values()):
        out["진단리포트"] = str(text).strip()      # 구분자를 안 지켰으면 통째로 남긴다
    return out


# ── 네이버 규격 자체 점검 ────────────────────────────────
MD_PATTERNS = [
    (r"^\s{0,3}#{1,6}\s", "헤딩 기호(#)"),
    (r"\*\*[^*\n]+\*\*", "굵게(**)"),
    (r"^\s*[-*]\s+", "리스트 기호(- 또는 *)"),
    (r"^\s*\d+\.\s", "번호 리스트(1.)"),
    (r"^\s*>\s", "인용(>)"),
    (r"\[[^\]\n]+\]\([^)\n]+\)", "링크 문법"),
    (r"`[^`\n]+`", "코드(백틱)"),
    (r"^\s*\|.*\|", "표(|)"),
]


def check_naver_ready(body: str) -> list[str]:
    """
    본문에 마크다운이 남았는지 확인한다.
    스마트에디터는 마크다운을 인식하지 못해 기호가 그대로 찍힌다.
    이미지 자리표시자 [이미지: ...] 는 우리 규격이므로 링크 문법에서 제외한다.
    """
    problems = []
    text = IMAGE_MARKER_RE.sub("", body or "")
    for pattern, label in MD_PATTERNS:
        hits = re.findall(pattern, text, flags=re.M)
        if hits:
            problems.append(f"{label} {len(hits)}곳")
    return problems


# ── 이미지 자리 · 키워드 집계 (도구가 계산한다) ──────────
# 새 규격은 [이미지 1 삽입 위치], 예전 원고는 [이미지: 설명] 이다. 둘 다 받는다.
IMAGE_MARKER_RE = re.compile(
    r"^[ \t]*\[이미지\s*(\d+)?\s*(?:삽입\s*위치)?\s*[:：]?\s*([^\]]*)\][ \t]*$", re.M)


def image_markers(body: str) -> list[tuple[str, str]]:
    """본문에 박힌 이미지 자리표시자를 (번호, 설명) 목록으로."""
    return [(m.group(1) or "", (m.group(2) or "").strip())
            for m in IMAGE_MARKER_RE.finditer(body or "")]


def strip_image_markers(body: str) -> str:
    """글자수를 셀 때는 자리표시자를 뺀다."""
    return IMAGE_MARKER_RE.sub("", body or "").strip()


def parse_image_specs(raw: str) -> list[dict]:
    """
    '=== 이미지제작목록 ===' 을 이미지 단위로 자른다.
    '이미지 1' 로 시작하는 덩어리마다 '- 항목: 값' 을 모은다.
    """
    specs: list[dict] = []
    cur: dict | None = None
    for line in (raw or "").splitlines():
        line = line.rstrip()
        head = re.match(r"^\s*(?:\[)?이미지\s*(\d+)\s*(?:\])?\s*[:.]?\s*$", line)
        if head:
            cur = {"no": head.group(1), "fields": {}, "order": []}
            specs.append(cur)
            continue
        if cur is None:
            continue
        item = re.match(r"^\s*[-*]?\s*([가-힣A-Za-z ]{1,12})\s*[:：]\s*(.+)$", line)
        if item:
            key = item.group(1).strip()
            cur["fields"][key] = item.group(2).strip()
            if key not in cur["order"]:
                cur["order"].append(key)
    return specs


def count_keywords(body: str, keywords: list[str]) -> dict[str, int]:
    """본문에서 키워드가 실제로 몇 번 나오는지 센다. 모델에게 세게 하지 않는다."""
    text = strip_image_markers(body)
    return {k: text.count(k) for k in keywords if k}


def keyword_density(body: str, hits: dict[str, int], keywords: list[str]) -> float:
    """키워드가 차지하는 글자 비율. 억지 반복을 잡아내기 위한 값."""
    text = strip_image_markers(body)
    if not text:
        return 0.0
    used = sum(hits.get(k, 0) * len(k) for k in keywords if k)
    return used / len(text)
