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
            "앞 단계의 JSON 수치를 근거로 두 가지를 쓴다.\n\n"
            "1) 진단 리포트 — 원장에게 보내는 요약. 눈에 띄는 수치와 그 이유, "
            "확인이 필요한 항목을 짚는다.\n"
            "2) 블로그 원고 — 이 건에서 끌어낼 수 있는 병의원 세무 주제로 쓴다. "
            "제목 후보 3개(28자 내외)와 본문.\n\n"
            "지켜야 할 것\n"
            "- 앞 단계 JSON 에 있는 숫자만 쓴다. 없는 수치를 만들지 마라.\n"
            "- 단정적 표현을 쓰지 않는다. '~할 수 있습니다', "
            "  '사안에 따라 달라질 수 있으니 개별 검토가 필요합니다' 형태로 쓴다.\n"
            "- 절세 결과를 보장하는 표현은 쓰지 않는다.\n"
            "- 특정 병의원을 홍보하거나 치료 효과를 단정하는 문구는 쓰지 않는다.\n"
            "- 블로그 원고 끝에 '일반적인 정보 제공 목적이며 개별 사안은 별도 검토가 "
            "  필요하다'는 안내를 넣는다.\n\n"
            "출력 형식(구분자를 그대로 지켜라)\n"
            "=== 진단리포트 ===\n(내용)\n\n=== 제목후보 ===\n1.\n2.\n3.\n\n"
            "=== 블로그원고 ===\n(내용)"
        ),
        expected_output="=== 진단리포트 === / === 제목후보 === / === 블로그원고 === 세 구획",
        agent=writer, context=[t2],
    )

    return Crew(agents=[analyst, structurer, writer], tasks=[t1, t2, t3],
                process=Process.sequential, verbose=True)


def split_sections(text: str) -> dict[str, str]:
    """Agent 3 결과를 구분자로 나눈다."""
    out = {"진단리포트": "", "제목후보": "", "블로그원고": ""}
    if not text:
        return out
    parts = re.split(r"^===\s*(진단리포트|제목후보|블로그원고)\s*===\s*$",
                     str(text), flags=re.M)
    for i in range(1, len(parts) - 1, 2):
        out[parts[i]] = parts[i + 1].strip()
    if not any(out.values()):
        out["진단리포트"] = str(text).strip()      # 구분자를 안 지켰으면 통째로 남긴다
    return out
