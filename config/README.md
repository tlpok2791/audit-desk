# 광고마케팅 KB 동기화

노션 광고 규칙 데이터베이스 → `config/ad-rules.json` → 홈페이지 광고마케팅 탭.

## 돌리기

```bash
export NOTION_TOKEN=secret_xxxxx          # 노션 통합(integration) 토큰
export NOTION_AD_RULES_DB=<database_id>   # 데이터베이스 ID
node scripts/sync-ad-rules.js
```

의존성이 없다. Node 18+ 면 `npm install` 없이 그대로 돈다.

| 옵션 | 뜻 |
|---|---|
| `--db <id>` | 환경변수 대신 DB ID 지정 |
| `--out <경로>` | 기본 `config/ad-rules.json` |
| `--dry` | 파일을 쓰지 않고 요약만 출력 (매핑 확인용) |

준비: 노션에서 통합을 만들고(https://www.notion.so/my-integrations), 대상 데이터베이스
우측 상단 `···` → `연결` 에서 그 통합을 추가해야 조회된다. 안 하면 404가 난다.

## 속성명을 하드코딩하지 않는다

스키마를 실행 시점에 읽어 그대로 옮긴다. 노션에서 속성을 추가하거나 이름을 바꾸면
**다시 동기화하는 것만으로** 홈페이지 필터에 반영된다. 코드는 건드리지 않는다.

## 타입별 변환

| 노션 타입 | 저장 형태 |
|---|---|
| `title`, `rich_text` | 문자열 |
| `select`, `status` | 값 문자열 (비었으면 `null`) |
| `multi_select` | 문자열 배열 |
| `number`, `checkbox`, `date` | 그대로 (`date`는 `{start,end,time_zone}` 객체) |
| `relation`, `rollup`, `formula` | 표시값만 문자열 |
| `people`, `files`, `created_by`, `last_edited_by` | **담지 않음** (키 자체가 빠진다) |
| 그 밖의 타입 | `null` + 경고 로그 |

`relation`은 관계된 페이지 제목을 얻으려면 페이지마다 추가 조회가 필요하므로
**페이지 ID만** 문자열로 남긴다.

`email`·`url`·`phone_number` 처럼 위 표에 없는 타입은 규칙대로 `null` + 경고로 처리된다.
이 값들이 필요하면 `scripts/sync-ad-rules.js`의 `convertValue`에 한 줄 추가하면 된다.

페이지 본문(블록)은 가져오지 않는다. **행 속성만** 가져온다.

100건이 넘어도 `has_more`/`next_cursor`로 전부 가져오고, 429·5xx는 재시도한다.

## 출력 형태

```json
{
  "database": { "id": "...", "title": "광고마케팅 규칙 KB" },
  "schema": [{ "name": "채널", "type": "select", "options": ["메타", "블로그"] }],
  "rows": [{ "id": "...", "props": { "채널": "메타" }, "last_edited_time": "..." }],
  "synced_at": "2026-08-23T13:00:00.000Z"
}
```

실제 데이터를 받기 전에 매핑이 맞는지 보려면 `config/ad-rules.sample.json`을 본다.
타입별 변환 결과가 전부 한 번씩 들어 있다.

## 홈페이지가 읽는 방식

광고마케팅 탭이 `config/ad-rules.json`을 직접 fetch한다.
없으면 `config/ad-rules.sample.json`으로 대체하고 "아직 동기화 전" 이라고 표시한다.

- `select`·`status`·`checkbox` → 드롭다운
- `multi_select` → 체크박스 (고른 값 중 **하나라도** 맞으면 통과)
- 속성 간에는 **AND**

필터로 걸러낸 규칙이 캠페인 기획 · 성과 분석 · 소재 점검 카드의 프롬프트
`{rules}` 자리에 삽입된다.

## 주의 — 공개 범위

`config/ad-rules.json`은 커밋되어 정적 사이트로 **함께 배포된다.**
즉 노션 KB 내용이 사이트 주소를 아는 사람에게 공개된다.
대외비 내용은 이 데이터베이스에 두지 않는다.

`NOTION_TOKEN`은 환경변수로만 쓰고 저장소에 커밋하지 않는다.
(`.gitignore`에 `.env`가 이미 들어 있다.)

## 검증

```bash
node scripts/sync-ad-rules.test.js
```

노션 API를 흉내 내어 타입 변환·페이지네이션·구버전/신버전 스키마 응답·오류 처리를 확인한다.
