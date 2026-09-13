# 감사 데스크

엑셀을 올리면 조서가 나오는 개인 업무용 도구.

## 두 가지 방식으로 쓴다

**브라우저** — `tool.html` 을 웹에 올리면 설치 없이 열린다.
파이썬이 방문자의 브라우저 안에서 돌기 때문에 업로드한 파일이 서버로 가지 않는다.
첫 로딩 약 50MB. 큰 파일은 느리다.

**PC 설치** — 아래 명령으로 로컬에서 실행한다. 10만 행대 원장은 이쪽이 훨씬 빠르다.

```bash
pip install -r requirements.txt
streamlit run app.py
```

## 모듈

| 참조 | 이름 | 입력 | 산출 |
|---|---|---|---|
| JL-100 | 분개장·계정별원장 편집 | 분개장(어떤 서식이든) 또는 계정별로 시트가 나뉜 원장 | 표준 형태/통합 원장 + 차대·[누계] 대조 검증 |
| WP-300 | 조서 작성 | 2개년 시산표 | 표지 + 계정그룹별 리드시트 |
| FS-200 | 재무제표 분석 | 2개년 시산표 | 증감·비율분석 + 코멘트 초안 |
| JE-100 | 전표 이상징후 분석 | 총계정원장 | 5개 테스트 + 벤포드 검정 |

`samples/` 에 시험용 데이터가 있다.

## 구조

```
app.py              화면 뼈대
core/registry.py    모듈 등록부  ← 새 기능은 여기 한 줄 추가
core/loader.py      파일 읽기 · 컬럼 연결 · 숫자 정리
core/ledger.py      계정별원장 통합 엔진
core/journal.py     분개장 정규화 엔진
core/accounts.py    계정과목 자동 분류 사전
core/report.py      엑셀 조서 생성 공통 유틸 · 서식 상수
core/env.py         브라우저인지 로컬인지 판별
core/theme.py       색 · 서체
modules/edit.py     JL-100 분개장·계정별원장 편집 (화면 하나, 자료 종류만 선택)
modules/            기능별 화면
build_web.py        tool.html 생성기
index.html          홈페이지 — 감사도구 · 기장/세무조정 · 블로그 작성 · 광고마케팅 4개 탭
src/data/cards.js   탭 2~4의 "기능 카드" 정의 (아래 '홈페이지 카드 추가' 참고)
src/data/posts.js   블로그 발행 목록 (build_posts.py 결과물 · 직접 고치지 말 것)
src/app.js          탭 전환 · 카드 렌더링 · 프롬프트 미리보기·복사 · 발행목록 스크립트
content/posts/      네이버 블로그 발행 파이프라인 (아래 '네이버 블로그 발행' 참고)
build_posts.py      content/posts/ → src/data/posts.js 생성기
config/             광고 규칙 KB (아래 '광고마케팅 KB 동기화' 참고)
scripts/            노션 동기화 · 정산표 엔진 테스트
src/audit/          감사도구 세부탭 (아래 '감사도구 세부탭' 참고)
vendor/             SheetJS(읽기·Apache-2.0) · ExcelJS(쓰기·MIT, 내보낼 때만 지연 로드)
work/               감사 작업 데이터 — .gitignore 로 막혀 있음
tool.html           브라우저 실행 버전 (build_web.py 결과물)
tests/              core/journal.py · core/ledger.py 검증 (아래 '테스트' 참고)
```

## 테스트

`core/journal.py`(분개장 정규화)와 `core/ledger.py`(계정별원장 통합)는 서식이 다른
여러 회사 자료를 넣어도 같은 결과가 나오는지 회귀 테스트로 확인합니다.
컬럼명·금액 표기·소계 표기 방식이 서로 다른 가상의 회사 자료를 여러 개 만들어
정규화·통합·검증(`verify`) 결과가 서로 일치하는지 대조합니다.

```bash
pip install -r requirements.txt pytest
pytest
```

## 코드를 고친 뒤

```bash
python3 build_web.py      # web/tool.html 재생성
cp web/tool.html .        # 최상단에 반영
```

파이썬을 고쳤으면 `tool.html` 도 다시 만들어야 웹에 반영된다.

## 모듈 추가

1. `modules/새기능.py` 에 `render()` 함수를 만든다
2. `core/registry.py` 의 `MODULES` 에 `Module(...)` 한 줄 추가
3. 메뉴와 홈 화면에 자동으로 나타난다

## 홈페이지 카드 추가

`index.html`의 기장/세무조정·블로그 작성·광고마케팅 탭은 "기능 카드"로 채워지며,
카드는 전부 `src/data/cards.js`의 `CARDS` 배열에서 나온다. 새 카드를 넣으려면
`index.html`·`src/app.js`는 건드릴 필요 없이 이 배열에 객체 하나만 추가하면 된다.

```js
{
  id: "고유id",
  tab: "tax",                 // "tax" | "blog" | "ads"
  icon: "🧮",
  title: "기능명",
  desc: "한 줄 설명",
  subagent: "호출할-서브에이전트-이름",
  fields: [
    { key: "company", label: "회사명", placeholder: "예시값" },
  ],
  template: "{company}로 시작하는 프롬프트 문장…",
}
```

`template` 안의 `{key}`는 해당 필드 입력값으로 실시간 치환되고, 비어 있으면
`placeholder` 값이 대신 채워져 미리보기가 항상 완성된 문장으로 보인다.

## 네이버 블로그 발행

자동 발행은 하지 않는다. **붙여넣기 직전까지만** 자동화한다.

```
content/posts/drafts/     GPT 초안 (직접 넣음)
                ready/    네이버 발행용으로 변환 완료
                published/ 발행 후 URL까지 기록
```

```bash
/naver-ready content/posts/drafts/글.md          # 초안 하나를 변환 → ready/
/naver-done  content/posts/ready/글.md <URL>     # 발행 후 published/로 이동
python3 build_posts.py                           # 홈페이지 블로그 탭에 반영
```

변환은 `blog-agent` 서브에이전트가 한다. 마크다운을 전부 걷어내고
(스마트에디터가 인식하지 못한다) 제목 후보 3개·태그 10개·글자수 리포트를 만들며,
단정적 표현·절세 보장 문구·의료광고 소지를 `검토 필요`로 플래그한다.

자세한 형식은 `content/posts/README.md` 참고.

## 감사도구 세부탭

작업 단위는 engagement — **회사 × 결산일**. 저장 위치는 `work/<회사코드>/<결산일>/`.
이 폴더는 `.gitignore`로 막혀 있어 실제 감사 데이터가 커밋되지 않는다.

| 탭 | 상태 | 하는 일 |
|---|---|---|
| 1 정산표 작성 | 완성 | 회사 원본 엑셀 → 표준 COA 매핑 → 수정·재분류분개 → 살아있는 정산표 xlsx |
| 2~5 | 잠금 | 골격만. 업로드 없이 탭1의 정산표를 그대로 받아 쓴다 |

**산출 xlsx는 값이 아니라 수식이다.** 정산표 시트의 전기·당기·수정분개·수정후·증감액·
증감비율은 전부 PBC 시트를 참조하는 SUMIFS 수식이라, 엑셀에서 PBC나 수정분개를 고치면
정산표가 따라 갱신된다. 시트 구성은 `PBC_시산표 / PBC_전기FS / 수정분개 / 정산표 / 검증`.

**표준 COA 매핑이 필수 단계다.** 회사마다 계정과목명이 다르므로
`config/standard-coa.json`(직접 수정 가능)에 붙인다. 유사도로 후보를 제안하되
자동 확정하지 않고, 미매핑이 남으면 생성이 막힌다. 확정한 매핑은
`config/coa-map/<회사코드>.json`에 두면 다음 기수엔 신규 계정만 확인하면 된다.

중요성금액 이상 변동한 계정은 `audit-fs-analyzer` 서브에이전트로 증감사유 초안을 받아
넣을 수 있다. 초안이 들어간 셀은 배경색으로 구분되어 검토 전임을 알 수 있다.

정산표는 전역 상태(단일 소스)로 보관한다. 모든 탭 상단에 현재 engagement와
사용 중인 정산표(회사명·결산일·계정 수·갱신 시각)가 표시되고, "정산표 불러오기"로
`worksheet.json`을 다시 올릴 수 있다.

**engagement별로 이어서 작업할 수 있다.** 올린 파일의 파싱 결과·COA 매핑·수정분개·
증감사유 초안이 engagement 단위로 브라우저에 보관되어, 새로고침하거나 다른 회사를
다녀와도 파일을 다시 올리지 않고 이어서 xlsx를 만들 수 있다. 실제 감사 금액이 브라우저에
남으므로 탭1 1단계의 "이 브라우저에 작업 내용 보관"으로 끌 수 있고, 끄면 즉시 지워진다.

엑셀은 SheetJS(`vendor/xlsx.full.min.js`)로 **브라우저 안에서만** 처리한다.
서버가 없으므로 업로드 파일이 외부로 전송되지 않는다. 브라우저는 디스크에 쓸 수 없어
산출물은 내려받은 뒤 사람이 `work/` 아래에 넣는다. 자세한 내용은 `work/README.md` 참고.

```bash
node scripts/worksheet.test.js        # 정산표 계산 엔진
node scripts/coa.test.js              # 표준 COA 매핑·유사도
node scripts/verify-live-xlsx.js <xlsx>   # 산출물이 값이 아니라 수식인지 직접 계산해 확인
```

## 광고마케팅 KB 동기화

노션 광고 규칙 데이터베이스를 내려받아 홈페이지 광고 탭의 프롬프트에 규칙으로 넣는다.

```bash
NOTION_TOKEN=secret_xxx NOTION_AD_RULES_DB=<id> node scripts/sync-ad-rules.js
```

속성명을 코드에 박지 않는다. 스키마를 실행 시점에 읽으므로 노션에 속성을 추가하면
다시 동기화하는 것만으로 홈페이지 필터가 늘어난다. 자세한 내용은 `config/README.md` 참고.

## 주의

과세정보·개인정보가 포함된 파일을 다룬다.
실제 감사 데이터는 이 저장소에 절대 올리지 않는다. `.gitignore` 로 막아둘 것.
FS-200 의 코멘트 초안은 규칙 기반 자동 생성이므로 근거 확인 후 수정하여 사용한다.
