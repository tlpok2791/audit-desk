"""Notion 입출력.

- 트리거 대기 중인 행 조회
- 첨부 서류(파일/URL) 내려받기
- 결과 JSON·원고를 속성과 페이지 본문에 기록하고 상태 변경

Notion 은 rich_text 한 블록당 2,000자 제한이 있다. 긴 원고를 그대로 넣으면
400 이 떨어지므로 반드시 잘라서 넣는다.
"""
from __future__ import annotations

import json
import mimetypes
from typing import Any, Iterable

import httpx
from notion_client import Client

RICH_TEXT_LIMIT = 2000
BLOCK_BATCH = 100          # children append 한 번에 최대 100 블록


class NotionRepo:
    def __init__(self, token: str, database_id: str, status_property: str):
        self.client = Client(auth=token)
        self.database_id = database_id
        self.status_property = status_property
        self._schema: dict[str, dict] | None = None
        self._data_source_id: str | None = None

    # ── 스키마 ────────────────────────────────────────────
    # Notion API 는 2025-09-03 부터 데이터베이스 아래에 "데이터 소스"가 생겼고
    # notion-client 3.x 에는 databases.query 가 아예 없다.
    # 두 세대를 모두 다룬다 — 새 방식이 있으면 그쪽, 없으면 옛 방식.
    def _resolve(self) -> None:
        if self._schema is not None:
            return
        db = self.client.databases.retrieve(database_id=self.database_id)

        sources = db.get("data_sources") or []
        if sources:
            if len(sources) > 1:
                print(f"  데이터 소스가 {len(sources)}개입니다. "
                      f"첫 번째({sources[0].get('name') or sources[0]['id']})만 씁니다.")
            self._data_source_id = sources[0]["id"]
            ds = self.client.data_sources.retrieve(data_source_id=self._data_source_id)
            self._schema = ds.get("properties", {})
            return

        if db.get("properties"):                      # 구버전 데이터베이스
            self._schema = db["properties"]
            return

        # 넘겨준 ID 가 데이터 소스 ID 였던 경우
        if hasattr(self.client, "data_sources"):
            ds = self.client.data_sources.retrieve(data_source_id=self.database_id)
            self._data_source_id = self.database_id
            self._schema = ds.get("properties", {})
            return

        raise RuntimeError("데이터베이스에서 속성 스키마를 찾지 못했습니다.")

    def schema(self) -> dict[str, dict]:
        """속성명을 코드에 박지 않기 위해 런타임에 읽는다."""
        self._resolve()
        return self._schema or {}

    def _query(self, **payload) -> dict:
        """데이터 소스 방식과 구버전 databases.query 를 모두 지원."""
        self._resolve()
        if self._data_source_id and hasattr(self.client, "data_sources"):
            payload.pop("database_id", None)
            return self.client.data_sources.query(
                data_source_id=self._data_source_id, **payload)
        if hasattr(self.client.databases, "query"):
            payload.setdefault("database_id", self.database_id)
            return self.client.databases.query(**payload)
        raise RuntimeError(
            "이 notion-client 버전에는 databases.query 가 없고 데이터 소스도 찾지 못했습니다.")

    def has(self, name: str) -> bool:
        return name in self.schema()

    def prop_type(self, name: str) -> str | None:
        p = self.schema().get(name)
        return p.get("type") if p else None

    # ── 조회 ──────────────────────────────────────────────
    def fetch_pending(self, pending_value: str, limit: int) -> list[dict]:
        """상태가 '대기'인 행을 가져온다. 100건 초과도 페이지네이션으로 처리."""
        results: list[dict] = []
        cursor = None
        flt = {"property": self.status_property, "select": {"equals": pending_value}}
        if self.prop_type(self.status_property) == "status":
            flt = {"property": self.status_property, "status": {"equals": pending_value}}

        while len(results) < limit:
            payload: dict[str, Any] = {
                "filter": flt,
                "page_size": min(100, limit - len(results)),
            }
            if cursor:
                payload["start_cursor"] = cursor
            res = self._query(**payload)
            results.extend(res.get("results", []))
            if not res.get("has_more"):
                break
            cursor = res.get("next_cursor")
        return results[:limit]

    # ── 값 읽기 ───────────────────────────────────────────
    @staticmethod
    def plain(prop: dict | None) -> str:
        """속성 하나를 사람이 읽는 문자열로."""
        if not prop:
            return ""
        t = prop.get("type")
        if t in ("title", "rich_text"):
            return "".join(x.get("plain_text", "") for x in prop.get(t, [])).strip()
        if t == "select":
            return (prop.get("select") or {}).get("name", "")
        if t == "status":
            return (prop.get("status") or {}).get("name", "")
        if t == "multi_select":
            return ", ".join(o.get("name", "") for o in prop.get("multi_select", []))
        if t == "number":
            v = prop.get("number")
            return "" if v is None else str(v)
        if t == "checkbox":
            return "예" if prop.get("checkbox") else "아니오"
        if t == "date":
            d = prop.get("date") or {}
            return " ~ ".join(x for x in (d.get("start"), d.get("end")) if x)
        if t == "url":
            return prop.get("url") or ""
        if t == "email":
            return prop.get("email") or ""
        if t == "phone_number":
            return prop.get("phone_number") or ""
        if t == "formula":
            f = prop.get("formula") or {}
            return str(f.get(f.get("type"), "") or "")
        return ""

    def row_context(self, page: dict) -> dict[str, str]:
        """행 전체를 {속성명: 문자열} 로. 에이전트 프롬프트에 그대로 넣는다."""
        out = {}
        for name, prop in (page.get("properties") or {}).items():
            if prop.get("type") in ("files", "people", "created_by", "last_edited_by"):
                continue
            v = self.plain(prop)
            if v:
                out[name] = v
        return out

    @staticmethod
    def file_urls(page: dict) -> list[tuple[str, str]]:
        """files 속성에서 (파일명, 내려받기 URL) 목록. URL 속성도 함께 훑는다."""
        out: list[tuple[str, str]] = []
        for name, prop in (page.get("properties") or {}).items():
            if prop.get("type") == "files":
                for f in prop.get("files", []):
                    url = (f.get("file") or {}).get("url") or (f.get("external") or {}).get("url")
                    if url:
                        out.append((f.get("name") or name, url))
            elif prop.get("type") == "url" and prop.get("url"):
                u = prop["url"]
                if any(u.lower().split("?")[0].endswith(ext)
                       for ext in (".pdf", ".png", ".jpg", ".jpeg", ".webp")):
                    out.append((name, u))
        return out

    # ── 쓰기 ──────────────────────────────────────────────
    @staticmethod
    def chunks(text: str, size: int = RICH_TEXT_LIMIT) -> list[str]:
        text = text or ""
        return [text[i:i + size] for i in range(0, len(text), size)] or [""]

    def rich_text(self, text: str) -> list[dict]:
        """2,000자 제한을 지켜 rich_text 배열로. (속성 하나에 여러 조각 허용)"""
        return [{"type": "text", "text": {"content": c}} for c in self.chunks(text)]

    def set_status(self, page_id: str, value: str, note: str = "") -> None:
        props: dict[str, Any] = {}
        t = self.prop_type(self.status_property)
        if t == "status":
            props[self.status_property] = {"status": {"name": value}}
        else:
            props[self.status_property] = {"select": {"name": value}}
        if note and self.prop_type("처리메모") == "rich_text":
            props["처리메모"] = {"rich_text": self.rich_text(note[:1900])}
        self.client.pages.update(page_id=page_id, properties=props)

    def write_results(self, page_id: str, values: dict[str, str]) -> list[str]:
        """
        {속성명: 문자열} 을 타입에 맞춰 기록한다.
        DB 에 없는 속성은 건너뛰고 이름을 돌려준다 (조용히 삼키지 않는다).
        """
        props: dict[str, Any] = {}
        skipped: list[str] = []
        for name, value in values.items():
            t = self.prop_type(name)
            if t is None:
                skipped.append(name)
                continue
            if t == "rich_text":
                props[name] = {"rich_text": self.rich_text(str(value))}
            elif t == "title":
                props[name] = {"title": self.rich_text(str(value)[:RICH_TEXT_LIMIT])}
            elif t == "number":
                try:
                    props[name] = {"number": float(str(value).replace(",", ""))}
                except ValueError:
                    skipped.append(name)
            elif t == "select":
                props[name] = {"select": {"name": str(value)[:100]}}
            elif t == "status":
                props[name] = {"status": {"name": str(value)[:100]}}
            elif t == "multi_select":
                items = [s.strip() for s in str(value).split(",") if s.strip()]
                props[name] = {"multi_select": [{"name": s[:100]} for s in items]}
            elif t == "date":
                props[name] = {"date": {"start": str(value)}}
            elif t == "checkbox":
                props[name] = {"checkbox": str(value).lower() in ("true", "1", "예", "yes")}
            elif t == "url":
                props[name] = {"url": str(value)}
            else:
                skipped.append(name)
        if props:
            self.client.pages.update(page_id=page_id, properties=props)
        return skipped

    def append_body(self, page_id: str, sections: Iterable[tuple[str, str]]) -> None:
        """긴 원고는 속성이 아니라 페이지 본문에 넣는다. 100블록씩 나눠 append."""
        blocks: list[dict] = []
        for heading, body in sections:
            if not body:
                continue
            blocks.append({
                "object": "block", "type": "heading_2",
                "heading_2": {"rich_text": [{"type": "text", "text": {"content": heading[:200]}}]},
            })
            for para in [p for p in str(body).split("\n\n") if p.strip()]:
                for piece in self.chunks(para.strip()):
                    blocks.append({
                        "object": "block", "type": "paragraph",
                        "paragraph": {"rich_text": [{"type": "text", "text": {"content": piece}}]},
                    })
        for i in range(0, len(blocks), BLOCK_BATCH):
            self.client.blocks.children.append(
                block_id=page_id, children=blocks[i:i + BLOCK_BATCH]
            )


def download(url: str, timeout: float = 60.0) -> tuple[bytes, str]:
    """Notion 첨부(서명 URL 포함)를 받아 (바이트, MIME) 로."""
    with httpx.Client(timeout=timeout, follow_redirects=True) as c:
        r = c.get(url)
        r.raise_for_status()
        mime = r.headers.get("content-type", "").split(";")[0].strip()
    if not mime or mime == "application/octet-stream":
        mime = mimetypes.guess_type(url.split("?")[0])[0] or "application/pdf"
    return r.content, mime


def pretty(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False, indent=2)
