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
| LG-100 | 계정별원장 편집 | 계정별로 시트가 나뉜 원장 | 통합 원장 + [누계] 대조 검증 |
| JN-100 | 분개장 편집 | 어떤 서식의 분개장이든 | 표준 형태 + 전표별 차대 검증 |
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
core/report.py      엑셀 조서 생성 공통 유틸
core/env.py         브라우저인지 로컬인지 판별
core/theme.py       색 · 서체
modules/            기능별 화면
build_web.py        tool.html 생성기
index.html          소개 홈페이지
tool.html           브라우저 실행 버전 (build_web.py 결과물)
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

## 주의

과세정보·개인정보가 포함된 파일을 다룬다.
실제 감사 데이터는 이 저장소에 절대 올리지 않는다. `.gitignore` 로 막아둘 것.
FS-200 의 코멘트 초안은 규칙 기반 자동 생성이므로 근거 확인 후 수정하여 사용한다.
