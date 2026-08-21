"""업로드 파일을 읽고, 회사마다 다른 컬럼명을 표준 이름에 연결한다."""
import pandas as pd
import streamlit as st

# 표준 필드 → 흔히 쓰이는 컬럼명 후보
GUESS = {
    "전표번호": ["전표번호", "전표NO", "번호", "doc_no", "voucher"],
    "회계일자": ["회계일자", "전표일자", "거래일자", "일자", "date"],
    "계정과목": ["계정과목", "계정명", "계정", "account"],
    "적요": ["적요", "비고", "내용", "memo", "description"],
    "차변금액": ["차변금액", "차변", "금액", "debit", "amount"],
    "입력자": ["입력자", "작성자", "담당자", "user", "created_by"],
    "입력일시": ["입력일시", "등록일시", "작성일시", "created_at"],
}


def read_any(file) -> pd.DataFrame:
    """CSV(한글 인코딩 자동) 또는 엑셀을 읽는다."""
    name = file.name.lower()
    if name.endswith((".xlsx", ".xls", ".xlsm")):
        return pd.read_excel(file)
    for enc in ("utf-8-sig", "cp949", "utf-8"):
        try:
            file.seek(0)
            return pd.read_csv(file, encoding=enc)
        except UnicodeDecodeError:
            continue
    raise ValueError("인코딩을 인식하지 못했습니다. UTF-8 또는 CP949로 저장해 주세요.")


def _guess(field: str, columns: list[str]) -> int:
    for cand in GUESS.get(field, []):
        for i, c in enumerate(columns):
            if str(c).replace(" ", "").lower() == cand.replace(" ", "").lower():
                return i
    return 0


def map_columns(df: pd.DataFrame, required: list[str]) -> dict | None:
    """사용자에게 컬럼 연결을 확인받는다. 이름이 달라도 쓸 수 있게."""
    cols = list(df.columns)
    st.markdown('<div class="section-label">컬럼 연결</div>', unsafe_allow_html=True)
    st.caption("자동으로 맞춰둔 값을 확인하고, 다르면 바꿔주세요.")

    mapping = {}
    grid = st.columns(min(len(required), 4))
    for i, field in enumerate(required):
        with grid[i % len(grid)]:
            mapping[field] = st.selectbox(field, cols, index=_guess(field, cols), key=f"map_{field}")

    if len(set(mapping.values())) != len(mapping):
        st.error("같은 컬럼이 두 곳에 연결됐습니다. 하나씩 다르게 지정해 주세요.")
        return None
    return mapping


def rename(df: pd.DataFrame, mapping: dict) -> pd.DataFrame:
    """매핑에 따라 필요한 컬럼만 뽑아 표준 이름으로 바꾼다."""
    out = df[list(mapping.values())].copy()
    out.columns = list(mapping.keys())
    return out


def to_number(s: pd.Series) -> pd.Series:
    """'1,234,000원', '(1,234)', ' - ' 같은 표기를 숫자로."""
    t = (s.astype(str)
         .str.replace(r"[,\s원₩]", "", regex=True)
         .str.replace(r"^\((.*)\)$", r"-\1", regex=True)
         .replace({"-": "0", "": "0", "nan": None, "None": None}))
    return pd.to_numeric(t, errors="coerce")


def standardize_numeric(df: pd.DataFrame, cols: list[str]) -> pd.DataFrame:
    out = df.copy()
    for c in cols:
        if c in out:
            out[c] = to_number(out[c])
    return out


def standardize(df: pd.DataFrame, mapping: dict) -> pd.DataFrame:
    """표준 컬럼명으로 바꾸고 자료형을 정리한다."""
    out = df[list(mapping.values())].copy()
    out.columns = list(mapping.keys())

    for c in ("회계일자", "입력일시"):
        if c in out:
            out[c] = pd.to_datetime(out[c], errors="coerce")
    if "차변금액" in out:
        out["차변금액"] = (
            out["차변금액"].astype(str)
            .str.replace(r"[,\s원]", "", regex=True)
            .str.replace(r"^\((.*)\)$", r"-\1", regex=True)
        )
        out["차변금액"] = pd.to_numeric(out["차변금액"], errors="coerce")
    return out


def health_check(df: pd.DataFrame) -> list[str]:
    """조서에 남길 데이터 품질 메모."""
    notes = []
    for c in df.columns:
        n = int(df[c].isna().sum())
        if n:
            notes.append(f"{c} 결측 {n:,}건 — 해당 행은 테스트에서 제외됩니다.")
    if "차변금액" in df and (df["차변금액"] < 0).any():
        notes.append(f"음수 금액 {int((df['차변금액'] < 0).sum()):,}건 — 반제·취소 전표일 수 있습니다.")
    if "회계일자" in df and df["회계일자"].notna().any():
        span = df["회계일자"].dropna()
        notes.append(f"회계일자 범위 {span.min():%Y-%m-%d} ~ {span.max():%Y-%m-%d}")
    return notes
