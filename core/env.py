"""실행 환경 판별 — 브라우저(Pyodide)인지 로컬 PC인지."""
import sys


def in_browser() -> bool:
    """stlite/Pyodide 위에서 도는 중인지."""
    return sys.platform == "emscripten"


# 브라우저에서 이 크기를 넘으면 경고한다 (바이트)
BROWSER_WARN_BYTES = 5 * 1024 * 1024
BROWSER_HARD_BYTES = 25 * 1024 * 1024


def size_guard(uploaded) -> str | None:
    """
    업로드 파일이 브라우저에서 감당 가능한 크기인지.
    돌려주는 값: None(문제없음) | "warn" | "hard"
    """
    if not in_browser() or uploaded is None:
        return None
    size = getattr(uploaded, "size", None)
    if size is None:
        return None
    if size >= BROWSER_HARD_BYTES:
        return "hard"
    if size >= BROWSER_WARN_BYTES:
        return "warn"
    return None
