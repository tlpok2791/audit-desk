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
    anthropic_api_key: str
    notion_token: str
    notion_database_id: str

    # 판독·구조화·작성 모두 이 한 모델로 돈다. 환경변수로 바꿀 수 있다.
    # 더 좋은 품질이 필요하면 ANTHROPIC_MODEL=claude-opus-5 로 올린다(요금도 오른다).
    anthropic_model: str = field(default_factory=lambda: os.getenv("ANTHROPIC_MODEL", "claude-sonnet-5"))

    # Notion 상태 값 (DB 의 select 옵션과 반드시 같아야 한다)
    status_property: str = field(default_factory=lambda: os.getenv("NOTION_STATUS_PROPERTY", "상태"))
    status_pending: str = field(default_factory=lambda: os.getenv("NOTION_STATUS_PENDING", "대기"))
    status_running: str = field(default_factory=lambda: os.getenv("NOTION_STATUS_RUNNING", "처리중"))
    status_done: str = field(default_factory=lambda: os.getenv("NOTION_STATUS_DONE", "완료"))
    status_error: str = field(default_factory=lambda: os.getenv("NOTION_STATUS_ERROR", "오류"))

    # 생성된 원고의 분류 (홈페이지 블로그 탭이 이 값으로 묶는다)
    blog_category: str = field(default_factory=lambda: os.getenv("BLOG_CATEGORY", "medical"))

    # 원고 말미 상담 유도에 붙일 연락처. 모델이 번호를 지어내지 않도록 여기서 넣는다.
    # 비워 두면 원고에 자리만 남고 사람이 채운다.
    contact_kakao: str = field(default_factory=lambda: os.getenv("CONTACT_KAKAO", "").strip())
    contact_phone: str = field(default_factory=lambda: os.getenv("CONTACT_PHONE", "").strip())

    max_pages: int = field(default_factory=lambda: int(os.getenv("MAX_PAGES_PER_RUN", "5")))
    dry_run: bool = field(default_factory=lambda: os.getenv("DRY_RUN", "").lower() in ("1", "true", "yes"))


REQUIRED = [
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

    # SDK 가 읽는 표준 env 이름을 맞춰준다
    os.environ.setdefault("ANTHROPIC_API_KEY", settings.anthropic_api_key)
    return settings


def mask(secret: str) -> str:
    """로그에 키를 통째로 남기지 않는다."""
    if not secret:
        return "(없음)"
    return secret[:4] + "…" + secret[-2:] if len(secret) > 8 else "…"
