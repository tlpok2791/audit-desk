# audit-desk

회계사 블로그. 에이전트로 글을 쓰고 카테고리별로 네이버에 올린다.

**https://tlpok2791.github.io/audit-desk/**

폰에서 열어 홈 화면에 추가하면 앱처럼 쓸 수 있다 (오프라인에서도 열린다).

---

## 어떻게 도나

```
서류(work/docs/)  ─ /from-docs ─→  초안  ─ /naver-ready ─→  원고  → 직접 발행 → /naver-done
                   doc-reader-agent      blog-agent ∥ ad-agent
```

서류 없이 주제만으로 쓸 때는 `/from-docs` 를 건너뛰고, 홈페이지 블로그 탭의
**블로그 초안 작성** 카드에서 프롬프트를 복사해 쓴다.

**자동 발행은 하지 않는다.** 붙여넣기 직전까지만 자동화한다.

## 슬래시 커맨드

| 커맨드 | 하는 일 |
|---|---|
| `/from-docs <서류폴더>` | 세무 서류를 판독해 초안을 만든다. 고객 정보는 지우고 넘긴다 |
| `/naver-ready <초안>` | 네이버 발행용으로 변환한다. 준법 점검이 **동시에** 돈다 |
| `/naver-done <원고>` | 발행을 마친 글을 `published/` 로 옮기고 URL·일시를 기록한다 |

## 에이전트

| 이름 | 하는 일 |
|---|---|
| `blog-agent` | 시리즈 기획 · 글 초안 · 네이버 발행용 변환 |
| `ad-agent` | 전문직 광고 규정 준법 점검 · 키워드 효과 분석 |
| `doc-reader-agent` | 세무 서류 판독 — 보이는 숫자만 옮긴다 |

## 카테고리

`content/categories.json` 이 원본이다. 네이버 블로그 메뉴와 1:1로 맞춰 뒀다.

```
공지사항
회계감사        8개 항목
상속세·증여세   3개 항목
부가·종소·양도  3개 항목
공정가치평가    4개 항목
```

원고 프론트매터의 `category` 에 `items[].id` 를 적는다.
`id` 는 바꾸지 않는다 — 바꾸면 이미 쓴 원고의 분류가 미아가 된다.

---

## 폴더

```
.claude/agents/     에이전트 3개
.claude/commands/   슬래시 커맨드 3개
content/
  categories.json   카테고리 원본
  posts/drafts/     초안
  posts/ready/      발행 대기 원고
  posts/published/  발행 완료
src/
  app.js            화면
  data/             cards · home · refs (손으로 고침)
                    posts · categories (build_posts.py 가 굽는다)
scripts/            아이콘 생성
work/               고객 자료. 커밋되지 않는다
```

## 고친 뒤

```bash
python3 build_posts.py    # 글·카테고리를 고쳤으면 반드시
```

파일을 추가하거나 지웠으면 `sw.js` 의 `ASSETS` 를 고치고 `VERSION` 을 올린다.
올리지 않으면 설치된 폰이 옛 캐시를 계속 쓴다.

## 지키는 것

- **고객 자료는 커밋하지 않는다.** `work/` 는 `.gitignore` 로 막혀 있다
- **이 저장소는 공개다.** 실명·소속·연락처를 코드나 문서에 적지 않는다
- **자동 발행하지 않는다.** 사람이 확인하고 올린다

자세한 규칙은 `CLAUDE.md` 에 있다.
