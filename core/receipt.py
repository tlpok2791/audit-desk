"""
영수증·세금계산서·원천징수영수증 PDF에서 금액을 뽑아내는 최선추정 파서.

PDF 서식이 발행처마다 전부 달라 정확한 파싱은 불가능하다. 이 파서는
"합계금액" 류 키워드 주변의 숫자를 후보로 뽑아 사용자에게 보여줄 뿐,
자동으로 확정하지 않는다 — config/standard-coa.json 매핑과 같은 원칙.

pdfplumber는 PC 설치(로컬 실행) 전용이다. 브라우저(Pyodide)에는 올리지
않으므로, 여기서 지연 임포트(lazy import)해서 브라우저 화면 로드 자체는
막지 않게 한다.
"""
import re

AMOUNT_KEYWORDS = ["합계금액", "합 계", "총금액", "총 금액", "결제금액", "공급대가", "청구금액", "합계"]
WITHHOLD_KEYWORDS = ["원천징수세액", "소득세", "결정세액"]

_NUM = re.compile(r"[-+]?[\d,]+(?:\.\d+)?")


def available() -> bool:
    try:
        import pdfplumber  # noqa: F401
    except BaseException:
        # pdfplumber가 끌고 오는 cryptography 등 네이티브 의존성이 특정 환경에서
        # ImportError가 아니라 pyo3_runtime.PanicException처럼 BaseException만
        # 잡히는 예외를 던지는 경우가 있어 넓게 잡는다 — 어차피 "PDF 업로드
        # UI를 보여줄지" 판단용 probe라, 실패하면 그냥 못 쓰는 걸로 친다.
        return False
    return True


def extract_text(file) -> str:
    """업로드된 파일 객체에서 페이지별 텍스트를 이어붙인다."""
    import pdfplumber

    file.seek(0)
    with pdfplumber.open(file) as pdf:
        return "\n".join(page.extract_text() or "" for page in pdf.pages)


def _numbers_near(line: str) -> list[float]:
    out = []
    for m in _NUM.finditer(line):
        raw = m.group().replace(",", "")
        try:
            v = float(raw)
        except ValueError:
            continue
        if v != 0:
            out.append(v)
    return out


def guess_candidates(text: str, keywords: list[str]) -> list[dict]:
    """키워드가 있는 줄에서 숫자를 뽑는다. 줄마다 후보(가장 큰 값)를 하나씩 남긴다."""
    candidates = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if any(kw in line for kw in keywords):
            nums = _numbers_near(line)
            if nums:
                candidates.append({"근거줄": line[:80], "금액": max(nums)})
    return candidates


def guess_amount(text: str) -> dict | None:
    """영수증류에서 합계금액 후보 하나를 고른다. 여러 후보 중 최댓값."""
    candidates = guess_candidates(text, AMOUNT_KEYWORDS)
    if not candidates:
        return None
    return max(candidates, key=lambda c: c["금액"])


def guess_withholding_tax(text: str) -> dict | None:
    """원천징수영수증에서 원천징수세액(소득세) 후보를 고른다.

    키워드 우선순위(원천징수세액 > 소득세 > 결정세액)대로 먼저 걸리는
    줄의 첫 후보를 쓴다 — 여러 세액이 뒤섞인 표에서 합계·최댓값을 잘못
    고르는 것보다 화면에서 사용자가 바로 확인·수정하게 하는 편이 낫다.
    """
    for kw in WITHHOLD_KEYWORDS:
        candidates = guess_candidates(text, [kw])
        if candidates:
            return candidates[0]
    return None
