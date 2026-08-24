"""환경변수 로딩과 검증.

키는 .env(로컬) 또는 GitHub Actions Secrets(CI)에서만 온다.
코드에 절대 넣지 않는다. .env 는 .gitignore 로 막혀 있다.
"""
from __future__ import annotations

import os
import sys
from dataclasses import dataclass, field

from dotenv import load_dotenv

load_dotenv()  # 로컬에서는 .env, CI에서는 이미 env 에 주입되어 있어 무시된다


def _clean(name: str) -> str:
    """따옴표·공백이 섞여 들어온 키를 정리한다 (복붙 사고가 잦다)."""
    return (os.getenv(name) or "").strip().strip('"').strip("'")


@dataclass(frozen=True)
class Settings:
    openai_api_key: str
    gemini_api_key: str
    anthropic_api_key: str
    notion_token: str
    notion_database_id: str

    # 모델은 전부 환경변수로 바꿀 수 있다
    gemini_model: str = field(default_factory=lambda: os.getenv("GEMINI_MODEL", "gemini-1.5-flash"))
    openai_model: str = field(default_factory=lambda: os.getenv("OPENAI_MODEL", "gpt-4o-mini"))
    anthropic_model: str = field(default_factory=lambda: os.getenv("ANTHROPIC_MODEL", "claude-sonnet-5"))

    # Notion 상태 값 (DB 의 select 옵션과 반드시 같아야 한다)
    status_property: str = field(default_factory=lambda: os.getenv("NOTION_STATUS_PROPERTY", "상태"))
    status_pending: str = field(default_factory=lambda: os.getenv("NOTION_STATUS_PENDING", "대기"))
    status_running: str = field(default_factory=lambda: os.getenv("NOTION_STATUS_RUNNING", "처리중"))
    status_done: str = field(default_factory=lambda: os.getenv("NOTION_STATUS_DONE", "완료"))
    status_error: str = field(default_factory=lambda: os.getenv("NOTION_STATUS_ERROR", "오류"))

    # 생성된 원고의 분류 (홈페이지 블로그 탭이 이 값으로 묶는다)
    blog_category: str = field(default_factory=lambda: os.getenv("BLOG_CATEGORY", "medical"))

    max_pages: int = field(default_factory=lambda: int(os.getenv("MAX_PAGES_PER_RUN", "5")))
    dry_run: bool = field(default_factory=lambda: os.getenv("DRY_RUN", "").lower() in ("1", "true", "yes"))


REQUIRED = [
    ("OPENAI_API_KEY", "openai_api_key"),
    ("GEMINI_API_KEY", "gemini_api_key"),
    ("ANTHROPIC_API_KEY", "anthropic_api_key"),
    ("NOTION_TOKEN", "notion_token"),
    ("NOTION_DATABASE_ID", "notion_database_id"),
]


def load_settings(require_keys: bool = True) -> Settings:
    values = {attr: _clean(env) for env, attr in REQUIRED}
    missing = [env for env, attr in REQUIRED if not values[attr]]

    if missing and require_keys:
        print("환경변수가 비어 있습니다: " + ", ".join(missing), file=sys.stderr)
        print("  로컬: .env.example 을 .env 로 복사해 채우세요.", file=sys.stderr)
        print("  CI  : 저장소 Settings → Secrets and variables → Actions 에 등록하세요.", file=sys.stderr)
        raise SystemExit(2)

    settings = Settings(**values)

    # LangChain 각 provider 가 읽는 표준 env 이름을 맞춰준다
    os.environ.setdefault("OPENAI_API_KEY", settings.openai_api_key)
    os.environ.setdefault("ANTHROPIC_API_KEY", settings.anthropic_api_key)
    os.environ.setdefault("GOOGLE_API_KEY", settings.gemini_api_key)
    return settings


def mask(secret: str) -> str:
    """로그에 키를 통째로 남기지 않는다."""
    if not secret:
        return "(없음)"
    return secret[:4] + "…" + secret[-2:] if len(secret) > 8 else "…"
