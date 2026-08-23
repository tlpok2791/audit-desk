# 네이버 블로그 발행 파이프라인

자동 발행은 하지 않는다. **붙여넣기 직전까지만** 자동화한다.
스마트에디터 창에 사람이 직접 붙여넣고 발행 버튼을 누른다.

## 흐름

```
drafts/         ready/                    published/
GPT 초안    →   /naver-ready 로 변환   →   홈페이지에서 복사 → 네이버 발행
(직접 넣음)     네이버 붙여넣기용          → /naver-done 으로 이동
```

| 폴더 | 무엇이 들어가나 | 누가 넣나 |
|---|---|---|
| `drafts/` | GPT가 쓴 초안 (마크다운이어도 됨) | 사람이 직접 |
| `ready/` | 네이버 발행용으로 변환 완료 | `/naver-ready` |
| `published/` | 발행 후 URL까지 기록된 글 | `/naver-done` |

## 프론트매터

모든 파일 맨 위에 온다.

```yaml
---
title: 병의원 가족 인건비, 어디까지 인정되나
category: medical          # medical | transfer
keywords: [병의원 가족 인건비, 가족 급여]
kb_refs: [content/kb/병의원-가족인건비.md]
status: draft              # draft | ready | published
published_url: ""
published_at: ""
---
```

- `category` — `medical`(병의원) 또는 `transfer`(양도). 홈페이지 블로그 탭이 이 값으로 묶는다.
- `keywords` — 리포트에서 등장 횟수를 세는 대상.
- `kb_refs` — 사실관계 보강에 쓸 KB 파일 경로. `/naver-ready`는 **여기 적힌 파일만** 읽는다.
- `published_url` / `published_at` — `/naver-done`이 채운다.

## ready/ 파일 형식

`/naver-ready`가 만드는 파일은 아래 섹션 구분자를 그대로 쓴다.
홈페이지의 복사 버튼과 `build_posts.py`가 이 구분자를 기준으로 잘라 읽으므로 **이름을 바꾸지 않는다**.

```
---
(프론트매터)
---

=== 제목 후보 ===
1. 첫 번째 제목
2. 두 번째 제목
3. 세 번째 제목

=== 본문 ===
(마크다운 없는 평문. 소제목은 그냥 한 줄.)

=== 태그 ===
태그1, 태그2, ... (10개)

=== 리포트 ===
총 글자수: 1,234자
키워드 등장 횟수:
- 병의원 가족 인건비: 5회

=== 검토 필요 ===
- [의료광고] ...
- [단정표현] ...
```

`=== 검토 필요 ===`는 지적할 것이 없으면 통째로 빠질 수 있다.

## 홈페이지에 반영하기

`ready/`·`drafts/`는 정적 호스팅에서 직접 읽을 수 없으므로, 목록을 JS 파일로 굽는다.

```bash
python3 build_posts.py      # → src/data/posts.js 재생성
```

글을 추가·변환·발행한 뒤 이 명령을 돌려야 홈페이지 블로그 탭에 반영된다.

## 명령

| 명령 | 하는 일 |
|---|---|
| `/naver-ready <초안경로>` | 초안 하나를 네이버용으로 변환해 `ready/`에 저장 |
| `/naver-done <ready경로> <발행URL>` | `published/`로 옮기고 URL·발행일시 기록 |
