# 병의원 세무·마케팅 자동화 파이프라인

Notion 에 쌓인 건을 세 모델이 이어받아 처리하고 다시 Notion 에 적는다.

```
Notion(상태=대기)
   ↓
Agent 1  Gemini    첨부 PDF·이미지를 읽어 수치를 뽑는다        (멀티모달)
   ↓
Agent 2  GPT       Notion 스키마에 맞는 JSON 으로 정제한다
   ↓
Agent 3  Claude    진단 리포트와 블로그 원고를 쓴다
   ↓
Notion(속성 기록 + 본문 append + 상태=완료)
   +
content/posts/ready/<제목>.md  →  홈페이지 블로그 탭에서 복사 → 네이버 붙여넣기
```

블로그는 **자동 생성이 본류**다. Agent 3 이 네이버 스마트에디터 규격으로 바로 뱉는다
(마크다운 제거·제목 후보 3개·태그 10개·글자수 리포트·검토 필요 표시).
GitHub Actions 가 생성된 원고를 커밋하면 홈페이지 블로그 탭에 그대로 나타난다.
자동 발행은 하지 않는다 — 붙여넣기 직전까지만.

손으로 주제를 잡고 싶을 때는 `drafts/` + `/naver-ready` 경로를 그대로 쓸 수 있다.
같은 `ready/` 로 들어가므로 화면에서는 구분 없이 함께 보인다.

## 빠른 시작

```bash
pip install -r pipeline/requirements.txt
cp .env.example .env          # 키를 채운다 (.env 는 커밋되지 않는다)

python -m pipeline.main --check      # 키·DB 연결만 확인
python -m pipeline.main --dry-run    # Notion 만 읽고 LLM 호출·쓰기 없음
python -m pipeline.main --limit 1    # 한 건만 실제 처리
python -m pipeline.main              # 전체 (기본 5건)
```

## Notion DB 준비

필수는 **상태 속성 하나**뿐이다. 이름은 `NOTION_STATUS_PROPERTY` 로 바꿀 수 있다.

| 속성 | 타입 | 쓰임 |
|---|---|---|
| 상태 | select 또는 status | `대기` → `처리중` → `완료` / `오류` |
| (제목) | title | 로그에 표시 |
| 서류 | files | 판독할 PDF·이미지 첨부 |
| 처리메모 | rich_text | 완료 시각·오류 사유 (있으면 기록) |
| 구조화JSON | rich_text | Agent 2 결과 원본 (있으면 기록) |
| 제목후보 | rich_text | 블로그 제목 3안 (있으면 기록) |

그 밖의 속성은 **만들어 두기만 하면** Agent 2 가 스키마를 읽고 알아서 채운다.
속성명을 코드에 박지 않는다 — 실행할 때 DB 스키마를 읽어 프롬프트에 넣는다.
DB 에 없는 키를 모델이 만들어내면 조용히 버리지 않고 건너뛴 이름을 처리메모에 남긴다.

준비: [통합 만들기](https://www.notion.so/my-integrations) → 대상 DB 우측 상단
`···` → `연결` 에서 그 통합을 추가. 이걸 안 하면 조회 자체가 404 로 막힌다.

## 자동 실행

`.github/workflows/main.yml`

- **매일 09:00 KST** (cron 은 UTC 라 `0 0 * * *`)
- **수동 실행** — Actions 탭 → Run workflow (건수·dry-run 지정 가능)
- **Webhook** — 외부에서 즉시 트리거

```bash
curl -X POST https://api.github.com/repos/<owner>/<repo>/dispatches \
  -H "Authorization: Bearer <PAT>" \
  -H "Accept: application/vnd.github+json" \
  -d '{"event_type":"run-pipeline"}'
```

시크릿 5개를 저장소 Settings → Secrets and variables → Actions 에 등록한다.
`OPENAI_API_KEY` `GEMINI_API_KEY` `ANTHROPIC_API_KEY` `NOTION_TOKEN` `NOTION_DATABASE_ID`

`concurrency` 로 같은 시각 중복 실행을 막아 한 행이 두 번 처리되지 않게 했다.

## 안전장치

- **중복 처리 방지** — 건을 잡자마자 `처리중` 으로 바꾼다. 다음 실행은 `대기` 만 가져간다.
- **실패 격리** — 한 건이 터져도 나머지는 계속 돈다. 터진 건은 `오류` + 사유 기록.
- **비용 상한** — `MAX_PAGES_PER_RUN` (기본 5). 한 번에 다 태우지 않는다.
- **Notion 2,000자 한도** — 긴 원고를 그대로 넣으면 400 이 난다. 잘라서 넣는다.
- **개인정보** — `people` 속성은 프롬프트에 넣지 않는다.
- **수치 날조 방지** — 판독·정제 단계 temperature 0, "보이는 숫자만" 을 프롬프트에 못박음.
- **세무 콘텐츠 규칙** — 단정적 표현·절세 보장·의료광고 소지 문구를 쓰지 않도록 지시.
- **네이버 규격 자체 점검** — 생성된 본문에 마크다운(`#`, `**`, 줄 앞 `- ` 등)이 남았는지
  코드가 직접 검사한다. 남으면 파일은 만들되 `검토 필요`에 무엇이 몇 곳인지 적는다.
  스마트에디터는 마크다운을 인식하지 못해 기호가 그대로 찍힌다.

## 테스트

API 키 없이 돈다.

```bash
python -m pipeline.selfcheck      # 단위 35개 — JSON 추출·구획 분리·Notion 속성 변환
python -m pipeline.selfcheck_integration   # 통합 16개 — 가짜 Notion 서버로 전체 경로
```

통합 테스트는 성공·실패·JSON 실패 세 경로를 모두 태워
상태 전이(`처리중`→`완료`/`오류`), 2,000자 분할, DB 에 없는 속성 건너뛰기를 확인한다.

## 알아둘 것

- **모델은 전부 환경변수로 바꾼다.** 기본값은 `gemini-1.5-flash` / `gpt-4o-mini` /
  `claude-sonnet-5`. Claude 3.5 Sonnet 은 구형이라 현행 Sonnet 을 기본값으로 잡았고,
  `ANTHROPIC_MODEL` 로 언제든 바꿀 수 있다.
- **CrewAI 1.x 는 LangChain LLM 객체를 Agent 에 넣을 수 없다.** `crewai.LLM` 에
  `provider/model` 형식으로 넘긴다. LangChain 은 멀티모달 서류 판독에만 쓴다 —
  CrewAI 태스크로는 바이너리를 실어보낼 수 없기 때문이다.
- **첨부 상한** — inline 으로 보내는 방식이라 18MB 를 넘는 파일은 건너뛰고 그 사실을
  판독 원문에 남긴다. 더 큰 파일을 다루려면 Gemini File API 로 바꿔야 한다.
- 서류가 없는 건도 처리된다. 이 경우 Notion 행 속성만 근거로 원고를 쓴다.
