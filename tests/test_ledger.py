"""
core/ledger.py 회귀 테스트.

같은 거래를 두 회사(회계프로그램)가 내보내는 서로 다른 계정별원장 관행으로
흉내 내어(시트명 규칙, 컬럼명, 소계 표기 간격이 모두 다름) combine()·verify()가
서식과 무관하게 같은 통합 결과를 내는지 확인한다.
"""
import pandas as pd
import pytest

from core import ledger as L

# 세 계정에 걸친 거래 — 전기이월 포함, 전부 두 계정 간 대차가 맞물리도록 구성
#   보통예금(10300) 대변 265,000 = 지급수수료(82100) 차변 215,000 + 잡비(99900) 차변 50,000
TXNS = {
    "보통예금": {
        "opening_dr": 1_000_000,
        "rows": [
            ("2025-03-20", "3월 수수료 이체", "지급수수료거래처", 0, 120_000),
            ("2025-05-14", "[잡코리아]유료서비스", "잡코리아", 0, 50_000),
            ("2025-08-11", "8월 수수료 이체", "지급수수료거래처", 0, 95_000),
        ],
    },
    "지급수수료": {
        "opening_dr": 0,
        "rows": [
            ("2025-03-20", "3월 수수료", "은행", 120_000, 0),
            ("2025-08-11", "8월 수수료", "은행", 95_000, 0),
        ],
    },
    "잡비": {
        "opening_dr": 0,
        "rows": [
            ("2025-05-14", "[잡코리아]유료서비스", "잡코리아", 50_000, 0),
        ],
    },
}
EXPECTED_TOTAL = 265_000.0


def _cumulative(name: str) -> tuple[float, float]:
    """원장에 찍힐 [누계] 금액 — 전기이월 + 그 계정 내 거래 합계."""
    t = TXNS[name]
    dr = t["opening_dr"] + sum(r[3] for r in t["rows"])
    cr = sum(r[4] for r in t["rows"])
    return float(dr), float(cr)


def _sheets_company_a() -> list[dict]:
    """
    A사 — 시트명에 코드가 박힌 관행 ('0_보통예금(10300)'), 표준 컬럼명,
    소계 표기가 빈틈없이 붙어 있음([전기이월][누계]).
    """
    codes = {"보통예금": "10300", "지급수수료": "82100", "잡비": "99900"}
    sheets = []
    for i, (name, code) in enumerate(codes.items()):
        sheet_name = f"{i}_{name}({code})"
        parsed = L.parse_sheet_name(sheet_name)
        assert parsed == (code, name)

        rows = []
        opening = TXNS[name]["opening_dr"]
        if opening:
            rows.append(["", "[전기이월]", "", "", "", opening, 0, opening])
        for d, memo, vend, dr, cr in TXNS[name]["rows"]:
            rows.append([d, memo, "", vend, "", dr, cr, ""])
        cum_dr, cum_cr = _cumulative(name)
        rows.append(["", "[누계]", "", "", "", cum_dr, cum_cr, ""])

        df = pd.DataFrame(rows, columns=["날짜", "적요", "거래처코드", "거래처명",
                                          "사업자등록번호", "차변", "대변", "잔액"])
        sheets.append({"name": sheet_name, "code": code, "account": name,
                       "header_row": 0, "df": df})
    return sheets


def _sheets_company_b() -> list[dict]:
    """
    B사 — 시트명은 무관한 이름, 계정은 머리글 표기('계정과목 : 1100 - 보통예금')로만
    확인 가능, 컬럼명이 짧은 표기, 소계 표기 간격이 들쭉날쭉함([ 전기 이월 ][ 누  계 ]).
    같은 거래 금액을 다른 회사의 계정코드 체계로 표현한다.
    """
    codes = {"보통예금": "1100", "지급수수료": "5310", "잡비": "5390"}
    header_texts = {
        name: f"계정과목 : {code} - {name}" for name, code in codes.items()
    }
    sheets = []
    for i, name in enumerate(codes):
        code = codes[name]
        head_cells = ["㈜다른회사", "2025 회계연도", header_texts[name]]
        parsed = L.parse_header_account(head_cells)
        assert parsed == (code, name)

        rows = []
        opening = TXNS[name]["opening_dr"]
        if opening:
            rows.append(["", "[ 전기  이월 ]", "", "", "", opening, 0, opening])
        for d, memo, vend, dr, cr in TXNS[name]["rows"]:
            d2 = d.replace("-", ".")  # 날짜 표기도 다르게 (2025.03.20)
            rows.append([d2, memo, "", vend, "", dr, cr, ""])
        cum_dr, cum_cr = _cumulative(name)
        rows.append(["", "[ 누  계 ]", "", "", "", cum_dr, cum_cr, ""])

        # 짧은 컬럼명 관행: 일자·적요란·코드·거래처·사업자번호·차변금액·대변금액
        df = pd.DataFrame(rows, columns=["일자", "적요란", "코드", "거래처",
                                          "사업자번호", "차변금액", "대변금액", "잔액"])
        sheets.append({"name": f"Sheet{i+1}", "code": code, "account": name,
                       "header_row": 3, "df": df})
    return sheets


def test_subtotal_tag_detection_is_whitespace_robust():
    assert L.is_subtotal("[누계]")
    assert L.is_subtotal("[ 누  계 ]")
    assert L.is_subtotal("[전기이월]")
    assert L.is_subtotal("[ 전기  이월 ]")
    assert not L.is_subtotal("[잡코리아]유료서비스")  # 적요에 쓰인 정상 대괄호


@pytest.mark.parametrize("builder", [_sheets_company_a, _sheets_company_b])
def test_company_ledger_combines_and_ties_out(builder):
    sheets = builder()
    df, summary = L.combine(sheets)
    res = L.verify(df, summary)

    # 소계행이 정확히 걸러졌는지 — 원장에 찍힌 [누계]와의 대조가 이 검증의 핵심
    assert res["bad_tie"].empty, res["bad_tie"]
    assert res["ok"]
    assert res["dr"] == pytest.approx(EXPECTED_TOTAL)
    assert res["cr"] == pytest.approx(EXPECTED_TOTAL)

    # 적요의 정상적인 대괄호([잡코리아])는 소계로 오인되지 않아야 한다
    assert (df["적요"].str.contains("잡코리아", regex=False)).sum() == 2


def test_cross_company_formats_converge():
    """시트명 규칙·컬럼명·소계 표기 간격이 달라도 통합 결과는 같아야 한다."""
    df_a, sm_a = L.combine(_sheets_company_a())
    df_b, sm_b = L.combine(_sheets_company_b())
    res_a = L.verify(df_a, sm_a)
    res_b = L.verify(df_b, sm_b)

    assert res_a["ok"] == res_b["ok"] is True
    assert res_a["dr"] == pytest.approx(res_b["dr"])
    assert res_a["cr"] == pytest.approx(res_b["cr"])
    assert len(df_a) == len(df_b)


def test_missing_cumulative_row_breaks_tie_check():
    """[누계] 행이 실제로 틀리면(또는 소계 판별이 깨지면) 대조 검증이 잡아내야 한다."""
    sheets = _sheets_company_a()
    # 보통예금 시트의 [누계] 차변을 임의로 어긋나게 만든다
    bo_df = sheets[0]["df"]
    idx = bo_df.index[bo_df["적요"] == "[누계]"][0]
    bo_df.loc[idx, "차변"] = bo_df.loc[idx, "차변"] + 999

    df, summary = L.combine(sheets)
    res = L.verify(df, summary)
    assert not res["ok"]
    assert not res["bad_tie"].empty
