---
description: 발행 완료한 글을 published/로 옮기고 발행 URL·일시를 기록한다
argument-hint: <ready 파일 경로> <발행된 네이버 URL>
allowed-tools: Read, Write, Edit, Bash
---

네이버에 발행을 마친 글을 정리한다.

## 대상

`$ARGUMENTS` — 첫 번째가 `ready/` 파일 경로, 두 번째가 발행된 URL.

둘 중 하나라도 없으면 멈추고 무엇이 빠졌는지 알린다.
예: `/naver-done content/posts/ready/가족인건비.md https://blog.naver.com/xxx/223...`

URL이 `blog.naver.com` 또는 `m.blog.naver.com` 형태가 아니면 한 번 확인을 구한다.

## 순서

**1. 파일 읽기**

지정된 `ready/` 파일만 Read한다. 폴더를 스캔하지 않는다.
파일이 없으면 경로를 알려주고 멈춘다.

**2. 프론트매터 갱신**

- `status: published`
- `published_url: "<인자로 받은 URL>"`
- `published_at: "<현재 시각>"` — `date -u +%Y-%m-%dT%H:%M:%SZ` 로 얻는다

본문·제목 후보·태그·리포트 섹션은 **손대지 않는다.** 발행된 원본 그대로 남긴다.

**3. published/로 이동**

```bash
git mv content/posts/ready/<파일명> content/posts/published/<파일명>
```

git이 추적하지 않는 파일이면 `mv`를 쓴다.
`published/`에 같은 이름이 이미 있으면 덮어쓰지 말고 알린 뒤 멈춘다.

**4. 목록 반영**

```bash
python3 build_posts.py
```

## 보고

2줄 이내:

- 옮긴 경로
- 기록한 URL과 발행일시
