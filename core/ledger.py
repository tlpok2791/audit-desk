"""
계정별원장 통합 엔진.

계정별원장은 계정마다 시트가 하나씩 나뉘어 있고, 계정과목은 행이 아니라
시트 이름과 머리글에만 있다. 이걸 계정과목 열을 가진 하나의 표로 합친다.

소계행 판별에 주의: 적요에도 대괄호가 정상적으로 쓰인다
([잡코리아]유료서비스 등). 따라서 대괄호 안의 내용이 정확히
전기이월 · 월계 · 누계 · 전월이월 인 경우만 소계로 본다.
"""
import re

import numpy as np
import pandas as pd

# 통합 결과의 표준 열 — 편집본 서식을 따른다
STD = ["계정과목", "날짜", "적요", "거래처코드", "거래처명", "사업자등록번호",
       "차변금액", "대변금액", "차-대", "잔액"]

# 대괄호 안이 정확히 이것들일 때만 소계행
SUBTOTAL_TAGS = {"전기이월", "월계", "누계", "전월이월", "당기이월", "차기이월", "합계", "총계"}

# 시트명: "0_보통예금(10300)" → (10300, 보통예금)
SHEET_RE = re.compile(r"^\d+_(.+?)\((\d+)\)\s*$")
# 머리글: "계정과목 : 10300 - 보통예금"
HEADER_RE = re.compile(r"계\s*정\s*과\s*목\s*:\s*(\d+)\s*-\s*(.+)$")


def parse_sheet_name(name: str) -> tuple[str, str] | None:
    """시트명에서 계정코드와 계정명을 뽑는다."""
    m = SHEET_RE.match(str(name))
    if m:
        return m.group(2), m.group(1).strip()
    return None


def parse_header_account(cells) -> tuple[str, str] | None:
    """머리글 영역의 '계정과목 : 10300 - 보통예금' 표기에서 뽑는다."""
    for v in cells:
        if v is None:
            continue
        m = HEADER_RE.search(str(v))
        if m:
            return m.group(1), m.group(2).strip()
    return None


def is_subtotal(memo) -> bool:
    """적요가 소계 표기인지. 대괄호 안이 정확히 소계어일 때만 True."""
    s = str(memo).strip()
    if not s.startswith("[") or "]" not in s:
        return False
    inner = re.sub(r"\s+", "", s[1:s.index("]")])
    return inner in SUBTOTAL_TAGS


def to_number(s: pd.Series) -> pd.Series:
    t = (s.astype(str).str.strip()
         .str.replace(r"[,\s원₩]", "", regex=True)
         .str.replace(r"^\((.*)\)$", r"-\1", regex=True))
    t = t.replace({"-": "0", "": "0", "nan": "0", "None": "0", "NaN": "0"})
    return pd.to_numeric(t, errors="coerce").fillna(0.0)


def read_xls_sheets(path_or_buf) -> list[dict]:
    """
    .xls / .xlsx 계정별원장을 시트별로 읽어 원시 데이터를 돌려준다.
    각 항목: {name, code, account, header_row, df}
    """
    import xlrd

    if hasattr(path_or_buf, "read"):
        data = path_or_buf.read()
        wb = xlrd.open_workbook(file_contents=data)
    else:
        wb = xlrd.open_workbook(path_or_buf)

    out = []
    for i in range(wb.nsheets):
        sh = wb.sheet_by_index(i)
        if sh.nrows < 2:
            continue

        # 머리글 행 찾기 — '날짜'와 '차변'이 같은 행에 있는 곳
        hdr = -1
        for r in range(min(15, sh.nrows)):
            row = [re.sub(r"\s+", "", str(sh.cell_value(r, c)))
                   for c in range(sh.ncols)]
            if any(v == "날짜" for v in row) and any("차변" in v for v in row):
                hdr = r
                break
        if hdr < 0:
            continue

        # 계정과목 — 머리글 위 영역에서 먼저, 없으면 시트명에서
        head_cells = [sh.cell_value(r, c) for r in range(hdr) for c in range(sh.ncols)]
        acc = parse_header_account(head_cells) or parse_sheet_name(sh.name)
        if acc is None:
            acc = ("", str(sh.name))

        cols = [re.sub(r"\s+", "", str(sh.cell_value(hdr, c))) for c in range(sh.ncols)]
        body = [[sh.cell_value(r, c) for c in range(sh.ncols)]
                for r in range(hdr + 1, sh.nrows)]
        df = pd.DataFrame(body, columns=cols)

        out.append({"name": sh.name, "code": acc[0], "account": acc[1],
                    "header_row": hdr, "df": df})
    return out


# 계정별원장 열 이름 → 표준 이름
COL_MAP = {
    "날짜": "날짜", "일자": "날짜", "거래일자": "날짜",
    "적요란": "적요", "적요": "적요", "비고": "적요",
    "코드": "거래처코드", "거래처코드": "거래처코드",
    "거래처명": "거래처명", "거래처": "거래처명",
    "사업자등록번호": "사업자등록번호", "사업자번호": "사업자등록번호",
    "차변": "차변금액", "차변금액": "차변금액",
    "대변": "대변금액", "대변금액": "대변금액",
    "잔액": "잔액",
}


def combine(sheets: list[dict], drop_subtotal: bool = True,
            drop_empty: bool = True) -> tuple[pd.DataFrame, pd.DataFrame]:
    """
    시트들을 하나로 합친다.
    돌려주는 값: (통합 데이터, 시트별 요약)
    """
    frames, summary = [], []

    for s in sheets:
        df = s["df"].rename(columns=COL_MAP)
        for c in STD:
            if c not in df.columns:
                df[c] = "" if c not in ("차변금액", "대변금액", "차-대", "잔액") else 0.0

        memo = df["적요"].astype(str)
        sub_mask = memo.map(is_subtotal)

        for c in ("차변금액", "대변금액", "잔액"):
            df[c] = to_number(df[c])

        # 전기이월 — 차변·대변 각각 그대로 잡는다 (음수로 찍히는 계정이 있다)
        open_mask = memo.map(lambda x: is_subtotal(x)
                             and "전기이월" in re.sub(r"\s+", "", x))
        open_dr = float(df.loc[open_mask, "차변금액"].sum())
        open_cr = float(df.loc[open_mask, "대변금액"].sum())

        data = df[~sub_mask].copy() if drop_subtotal else df.copy()
        if drop_empty:
            data = data[(data["차변금액"] != 0) | (data["대변금액"] != 0)]

        data["계정과목"] = f"[{s['code']}]{s['account']}" if s["code"] else s["account"]
        data["계정코드"] = s["code"]
        data["계정명"] = s["account"]
        data["원본시트"] = s["name"]

        # 원장에 찍힌 [누계] 행 (검증 대조용)
        cum = df[memo.map(lambda x: is_subtotal(x) and "누계" in re.sub(r"\s+", "", x))]
        cum_dr = float(cum["차변금액"].iloc[-1]) if len(cum) else np.nan
        cum_cr = float(cum["대변금액"].iloc[-1]) if len(cum) else np.nan

        summary.append({
            "계정코드": s["code"], "계정명": s["account"], "원본시트": s["name"],
            "행수": len(data),
            "차변합계": float(data["차변금액"].sum()),
            "대변합계": float(data["대변금액"].sum()),
            "원장누계_차변": cum_dr, "원장누계_대변": cum_cr,
            "전기이월_차변": open_dr, "전기이월_대변": open_cr,
        })
        frames.append(data)

    if not frames:
        return pd.DataFrame(columns=STD), pd.DataFrame()

    all_df = pd.concat(frames, ignore_index=True)
    all_df["날짜"] = all_df["날짜"].astype(str).str.strip()
    all_df["차-대"] = all_df["차변금액"] - all_df["대변금액"]
    for c in ("적요", "거래처코드", "거래처명", "사업자등록번호"):
        all_df[c] = all_df[c].astype(str).replace(
            {"nan": "", "None": "", "NaT": ""}).str.strip()

    order = STD + ["계정코드", "계정명", "원본시트"]
    all_df = all_df[[c for c in order if c in all_df.columns]]

    sm = pd.DataFrame(summary)
    # 원장의 [누계]는 전기이월을 포함한 값이므로 더해서 대조한다
    sm["누계차이_차변"] = sm["차변합계"] + sm["전기이월_차변"] - sm["원장누계_차변"]
    sm["누계차이_대변"] = sm["대변합계"] + sm["전기이월_대변"] - sm["원장누계_대변"]
    return all_df, sm


def verify(df: pd.DataFrame, summary: pd.DataFrame,
           period_end: pd.Timestamp | None = None) -> dict:
    """통합 원장 검증."""
    dr, cr = float(df["차변금액"].sum()), float(df["대변금액"].sum())
    diff = dr - cr

    checks = [{
        "항목": "총 차변 = 총 대변",
        "결과": "일치" if abs(diff) < 1 else "불일치",
        "내용": f"차변 {dr:,.0f} / 대변 {cr:,.0f}"
                + ("" if abs(diff) < 1 else f" / 차이 {diff:,.0f}"),
    }]

    # 원장에 찍힌 [누계]와 대조 — 소계행 판별이 맞았는지 확인하는 최고의 검증
    tie = summary.dropna(subset=["원장누계_차변"])
    bad_tie = tie[(tie["누계차이_차변"].abs() >= 1) | (tie["누계차이_대변"].abs() >= 1)]
    checks.append({
        "항목": "원장 [누계]와 대조",
        "결과": "일치" if bad_tie.empty else "불일치",
        "내용": f"대조 가능 {len(tie):,}개 계정 중 불일치 {len(bad_tie):,}개",
    })

    both = df[(df["차변금액"] != 0) & (df["대변금액"] != 0)]
    checks.append({
        "항목": "차·대 동시 기재",
        "결과": "없음" if both.empty else "확인필요",
        "내용": f"{len(both):,}건",
    })

    neg = df[(df["차변금액"] < 0) | (df["대변금액"] < 0)]
    checks.append({
        "항목": "음수 금액",
        "결과": "없음" if neg.empty else "확인필요",
        "내용": f"{len(neg):,}건" + ("" if neg.empty else " — 반제·취소 전표일 수 있음"),
    })

    d = pd.to_datetime(df["날짜"], errors="coerce", format="mixed")
    bad_date = df[d.isna()]
    checks.append({
        "항목": "날짜 인식",
        "결과": "정상" if bad_date.empty else "확인필요",
        "내용": f"인식 실패 {len(bad_date):,}건",
    })

    if period_end is not None:
        start = period_end.replace(month=1, day=1)
        out_range = df[d.notna() & ((d < start) | (d > period_end))]
        checks.append({
            "항목": "회계기간 범위",
            "결과": "정상" if out_range.empty else "확인필요",
            "내용": f"{start:%Y-%m-%d} ~ {period_end:%Y-%m-%d} 밖 {len(out_range):,}건",
        })
    else:
        out_range = df.iloc[0:0]

    no_vendor = df[(df["거래처명"] == "") & (df["거래처코드"] == "")]
    checks.append({
        "항목": "거래처 누락",
        "결과": "없음" if no_vendor.empty else "참고",
        "내용": f"{len(no_vendor):,}건 — 대체전표는 거래처가 없을 수 있음",
    })

    ok = all(c["결과"] in ("일치", "없음", "정상", "참고") for c in checks)
    return {"checks": pd.DataFrame(checks), "ok": ok, "dr": dr, "cr": cr, "diff": diff,
            "bad_tie": bad_tie, "both": both, "neg": neg, "bad_date": bad_date,
            "out_range": out_range, "no_vendor": no_vendor}


def suggest_filename(company: str, period_end: pd.Timestamp, version: int = 1) -> str:
    name = re.sub(r"^\(?주\)?\s*|주식회사\s*|㈜|\(주\)", "", str(company)).strip()
    name = re.sub(r"[\\/:*?\"<>|]", "", name) or "회사"
    return f"FY{period_end:%y}_{name}_계정별원장 편집v{version}.xlsx"
