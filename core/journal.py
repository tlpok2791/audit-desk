"""
분개장 정규화 엔진.

회계프로그램마다 서식이 다른 분개장을 하나의 표준 형태로 편다.
- 병합셀 흔적(빈 전표번호·일자) → 위 값으로 채움
- 소계·합계·페이지 머리글 행 → 제거
- 금액 문자열("1,234,000", "(1,234)", "-") → 숫자
- 차대가 한 컬럼에 부호로 들어온 경우 → 차변·대변 두 컬럼으로 분리
"""
import re

import numpy as np
import pandas as pd

# 표준 컬럼 — 산출물은 항상 이 순서
STD = ["전표일자", "전표번호", "계정코드", "계정과목", "거래처", "적요", "차변", "대변", "작성자"]

# 표준 필드 → 흔히 쓰이는 컬럼명 후보 (공백·대소문자 무시하고 비교)
GUESS = {
    "전표일자": ["전표일자", "회계일자", "거래일자", "일자", "날짜", "전표일", "date", "docdate"],
    "전표번호": ["전표번호", "전표no", "전표번호no", "docno", "voucherno", "번호", "전표"],
    "계정코드": ["계정코드", "계정cd", "계정과목코드", "코드", "acctcd", "accountcode"],
    "계정과목": ["계정과목", "계정명", "계정", "account", "acctname", "과목"],
    "거래처": ["거래처", "거래처명", "거래처코드명", "상호", "vendor", "partner"],
    "적요": ["적요", "비고", "내용", "메모", "memo", "description", "remark"],
    "차변": ["차변", "차변금액", "차변액", "debit", "dr"],
    "대변": ["대변", "대변금액", "대변액", "credit", "cr"],
    "작성자": ["작성자", "입력자", "담당자", "등록자", "user", "createdby"],
    # 아래 둘은 표준 컬럼이 아니라 '분리형' 서식을 다룰 때만 쓴다
    "금액": ["금액", "거래금액", "amount", "amt", "발생액"],
    "차대구분": ["차대", "차대구분", "구분", "drcr", "차변대변"],
}

# 이런 문구가 들어간 행은 데이터가 아니라 소계·머리글이다
NOISE = ["전표계", "소계", "합계", "총계", "누계", "이월", "페이지", "page",
         "계정별원장", "분개장", "총계정원장", "출력일", "회사명", "사업자"]


def _norm(s) -> str:
    return re.sub(r"[\s()\[\]._-]", "", str(s)).lower()


def guess_mapping(columns) -> dict:
    """컬럼명을 보고 표준 필드에 자동 연결한다. 못 찾으면 키가 빠진다."""
    norm = {_norm(c): c for c in columns}
    out = {}
    for field, cands in GUESS.items():
        for cand in cands:
            key = _norm(cand)
            if key in norm:
                out[field] = norm[key]
                break
    return out


def find_header_row(raw: pd.DataFrame, scan: int = 15) -> int:
    """
    회사 정보가 위에 몇 줄 붙은 파일에서 진짜 머리글 행을 찾는다.
    표준 필드에 가장 많이 맞아떨어지는 행을 고른다.
    """
    best, best_hit = -1, 0
    for i in range(min(scan, len(raw))):
        vals = [v for v in raw.iloc[i].tolist() if pd.notna(v) and str(v).strip()]
        if len(vals) < 3:
            continue
        hit = len(guess_mapping(vals))
        if hit > best_hit:
            best, best_hit = i, hit
    return best if best_hit >= 3 else -1


def to_number(s: pd.Series) -> pd.Series:
    """'1,234,000' · '(1,234)' · '-' · '' → 숫자."""
    t = (s.astype(str)
         .str.strip()
         .str.replace(r"[,\s원₩]", "", regex=True)
         .str.replace(r"^\((.*)\)$", r"-\1", regex=True))
    t = t.replace({"-": "0", "": "0", "nan": "0", "None": "0", "NaN": "0"})
    return pd.to_numeric(t, errors="coerce").fillna(0.0)


def drop_noise(df: pd.DataFrame, mapping: dict) -> tuple[pd.DataFrame, int]:
    """소계·합계·반복 머리글 행을 걷어낸다."""
    text_cols = [mapping[f] for f in ("계정과목", "적요", "전표번호", "거래처")
                 if f in mapping and mapping[f] in df.columns]
    if not text_cols:
        return df, 0

    joined = df[text_cols].apply(
        lambda col: col.map(lambda v: "" if pd.isna(v) else str(v))).agg(" ".join, axis=1)
    key = joined.map(_norm)
    mask = pd.Series(False, index=df.index)
    for w in NOISE:
        mask |= key.str.contains(_norm(w), na=False)

    # 머리글이 다시 등장한 행 (셀 값이 컬럼명과 같음)
    hdr_names = {_norm(v) for v in mapping.values()}
    for c in text_cols:
        mask |= df[c].map(lambda v: _norm(v) in hdr_names if pd.notna(v) else False)

    return df[~mask].copy(), int(mask.sum())


def normalize(raw: pd.DataFrame, mapping: dict, fill_down: bool = True) -> pd.DataFrame:
    """어떤 서식이든 표준 컬럼 형태로 편다."""
    df = raw.copy()
    df, _ = drop_noise(df, mapping)

    out = pd.DataFrame(index=df.index)

    # 텍스트 계열
    for f in ("전표일자", "전표번호", "계정코드", "계정과목", "거래처", "적요", "작성자"):
        out[f] = df[mapping[f]] if f in mapping and mapping[f] in df.columns else ""

    # 병합셀 흔적 → 위 값으로 채움 (전표번호·일자만)
    if fill_down:
        for f in ("전표번호", "전표일자"):
            s = out[f].replace(r"^\s*$", np.nan, regex=True)
            out[f] = s.ffill()

    # 금액 — 두 가지 서식
    if "차변" in mapping and "대변" in mapping:
        out["차변"] = to_number(df[mapping["차변"]])
        out["대변"] = to_number(df[mapping["대변"]])
    elif "금액" in mapping:
        amt = to_number(df[mapping["금액"]])
        if "차대구분" in mapping and mapping["차대구분"] in df.columns:
            g = df[mapping["차대구분"]].astype(str).str.strip()
            is_dr = g.str.contains("차", na=False) | g.str.upper().str.startswith("D")
            out["차변"] = np.where(is_dr, amt.abs(), 0.0)
            out["대변"] = np.where(is_dr, 0.0, amt.abs())
        else:  # 부호로만 구분된 경우: 양수=차변
            out["차변"] = np.where(amt >= 0, amt, 0.0)
            out["대변"] = np.where(amt < 0, -amt, 0.0)
    else:
        out["차변"] = 0.0
        out["대변"] = 0.0

    out["전표일자"] = pd.to_datetime(out["전표일자"], errors="coerce")
    for f in ("전표번호", "계정코드", "계정과목", "거래처", "적요", "작성자"):
        out[f] = out[f].astype(str).replace({"nan": "", "None": "", "NaT": ""}).str.strip()

    # 금액이 양쪽 다 0인 행은 데이터가 아니다
    out = out[(out["차변"] != 0) | (out["대변"] != 0)]
    return out[STD].reset_index(drop=True)


# ── 검증 ────────────────────────────────────────────────────
def verify(df: pd.DataFrame, fy_end: pd.Timestamp | None = None) -> dict:
    """차대 일치 및 데이터 품질 검증."""
    dr, cr = float(df["차변"].sum()), float(df["대변"].sum())
    diff = dr - cr

    # 전표 단위 대차평형 — 총계가 맞아도 전표별로 틀릴 수 있다
    by = df.groupby("전표번호", dropna=False).agg(
        차변=("차변", "sum"), 대변=("대변", "sum"), 행수=("차변", "size"))
    by["차이"] = by["차변"] - by["대변"]
    unbal = by[by["차이"].abs() >= 1].reset_index()

    checks = []
    checks.append({
        "항목": "총 차변 = 총 대변",
        "결과": "일치" if abs(diff) < 1 else "불일치",
        "내용": f"차변 {dr:,.0f} / 대변 {cr:,.0f}" + ("" if abs(diff) < 1 else f" / 차이 {diff:,.0f}"),
    })
    checks.append({
        "항목": "전표별 대차평형",
        "결과": "일치" if unbal.empty else "불일치",
        "내용": f"전표 {len(by):,}건 중 불일치 {len(unbal):,}건",
    })

    both = df[(df["차변"] != 0) & (df["대변"] != 0)]
    checks.append({
        "항목": "차·대 동시 기재",
        "결과": "없음" if both.empty else "확인필요",
        "내용": f"{len(both):,}건" + ("" if both.empty else " — 한 행에 차변·대변이 모두 있음"),
    })

    neg = df[(df["차변"] < 0) | (df["대변"] < 0)]
    checks.append({
        "항목": "음수 금액",
        "결과": "없음" if neg.empty else "확인필요",
        "내용": f"{len(neg):,}건" + ("" if neg.empty else " — 반제·취소 전표일 수 있음"),
    })

    bad_date = df[df["전표일자"].isna()]
    checks.append({
        "항목": "전표일자 인식",
        "결과": "정상" if bad_date.empty else "확인필요",
        "내용": f"인식 실패 {len(bad_date):,}건",
    })

    if fy_end is not None:
        fy_start = fy_end.replace(month=1, day=1)
        out_range = df[df["전표일자"].notna() &
                       ((df["전표일자"] < fy_start) | (df["전표일자"] > fy_end))]
        checks.append({
            "항목": "회계기간 범위",
            "결과": "정상" if out_range.empty else "확인필요",
            "내용": f"{fy_start:%Y-%m-%d} ~ {fy_end:%Y-%m-%d} 밖 {len(out_range):,}건",
        })
    else:
        out_range = df.iloc[0:0]

    no_acct = df[df["계정과목"].astype(str).str.strip() == ""]
    checks.append({
        "항목": "계정과목 누락",
        "결과": "없음" if no_acct.empty else "확인필요",
        "내용": f"{len(no_acct):,}건",
    })

    ok = all(c["결과"] in ("일치", "없음", "정상") for c in checks)
    return {
        "checks": pd.DataFrame(checks),
        "ok": ok,
        "dr": dr, "cr": cr, "diff": diff,
        "unbalanced": unbal,
        "both": both, "neg": neg, "bad_date": bad_date,
        "out_range": out_range, "no_acct": no_acct,
        "voucher_count": int(len(by)),
    }


def suggest_filename(company: str, fy_end: pd.Timestamp, version: int = 1) -> str:
    """FY25_마플_분개장 편집v1.xlsx 형태로."""
    name = re.sub(r"^\(?주\)?\s*|주식회사\s*|\(주\)", "", str(company)).strip()
    name = re.sub(r"[\\/:*?\"<>|]", "", name) or "회사"
    return f"FY{fy_end:%y}_{name}_분개장 편집v{version}.xlsx"
