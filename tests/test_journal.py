"""
core/journal.py 회귀 테스트.

같은 거래 내역을 서로 다른 회사(회계프로그램) 서식으로 흉내 낸 세 벌의 원본을
만들어, 정규화(normalize)와 검증(verify) 결과가 서식과 무관하게 같은 숫자로
수렴하는지 확인한다. 이것이 "다른 회사 분개장을 줘도 결과가 같은가"의 실제 검증.
"""
import pandas as pd
import pytest

from core import journal as J

# 세 서식이 공통으로 표현하는 거래: 전표 3건, 라인 7개
# (전표번호, 전표일자, 계정과목, 거래처, 적요, 차변, 대변, 작성자)
LINES = [
    ("V001", "2025-01-05", "현금및현금성자산", "A상사", "1월 매출", 100000, 0, "김대리"),
    ("V001", "2025-01-05", "매출", "A상사", "1월 매출", 0, 100000, "김대리"),
    ("V002", "2025-03-10", "소모품비", "B문구", "소모품 구입", 50000, 0, "이차장"),
    ("V002", "2025-03-10", "미지급금", "B문구", "소모품 구입", 0, 50000, "이차장"),
    ("V003", "2025-06-20", "여비교통비", "", "출장경비", 30000, 0, "박과장"),
    ("V003", "2025-06-20", "복리후생비", "", "출장경비", 20000, 0, "박과장"),
    ("V003", "2025-06-20", "현금및현금성자산", "", "출장경비", 0, 50000, "박과장"),
]
EXPECTED_TOTAL = 200000.0
EXPECTED_VOUCHERS = 3
FY_END = pd.Timestamp("2025-12-31")


def _format_a() -> pd.DataFrame:
    """서식 A — 표준에 가까운 한글 컬럼명, 차변·대변 두 컬럼, 노이즈 없음."""
    rows = [{
        "전표일자": d, "전표번호": v, "계정과목": acc, "거래처": vd, "적요": memo,
        "차변": f"{dr:,}" if dr else "-",
        "대변": f"{cr:,}" if cr else "-",
        "작성자": u,
    } for v, d, acc, vd, memo, dr, cr, u in LINES]
    return pd.DataFrame(rows)


def _format_b() -> pd.DataFrame:
    """
    서식 B — 영문 컬럼명, 금액 한 컬럼 + 차대구분, 병합셀 흔적(빈 전표번호·일자),
    소계·반복 머리글 노이즈 포함.
    """
    cols = ["docno", "date", "account", "vendor", "memo", "amount", "drcr", "user"]
    rows = []
    for v, d, acc, vd, memo, dr, cr, u in LINES:
        amt, side = (dr, "차변") if dr else (cr, "대변")
        rows.append([v, d, acc, vd, memo, f"{amt:,}원", side, u])
    df = pd.DataFrame(rows, columns=cols)

    # 병합셀 흔적: 같은 전표의 두 번째 줄부터 전표번호·일자를 비운다
    for i in range(1, len(df)):
        if df.loc[i, "docno"] == df.loc[i - 1, "docno"]:
            df.loc[i, ["docno", "date"]] = ""

    # 노이즈: 반복 머리글 행 + 소계 행
    header_repeat = pd.DataFrame([cols], columns=cols)
    subtotal = pd.DataFrame([["", "", "합계", "", "", "200,000원", "", ""]], columns=cols)
    return pd.concat([df.iloc[:3], header_repeat, df.iloc[3:], subtotal],
                      ignore_index=True)


def _format_c_with_banner() -> pd.DataFrame:
    """
    서식 C — 부호로만 차대를 구분하는 금액 한 컬럼, 거래처·작성자 컬럼 자체가 없음,
    회사명·기간이 위에 붙어 실제 머리글이 3번째 행에 있음(find_header_row 대상).
    """
    header = ["일자", "전표NO", "계정", "적요", "금액"]
    body = []
    for v, d, acc, vd, memo, dr, cr, u in LINES:
        amt = dr if dr else -cr
        body.append([d, v, acc, memo, amt])

    banner = [
        ["마플 주식회사", None, None, None, None],
        ["2025년 분개장", None, None, None, None],
    ]
    raw = pd.DataFrame(banner + [header] + body)
    return raw


def _run(df: pd.DataFrame, fill_down: bool = True) -> tuple[pd.DataFrame, dict]:
    mapping = J.guess_mapping(df.columns)
    out = J.normalize(df, mapping, fill_down=fill_down)
    res = J.verify(out, FY_END)
    return out, res


def test_format_a_balances():
    out, res = _run(_format_a())
    assert len(out) == len(LINES)
    assert out["전표번호"].nunique() == EXPECTED_VOUCHERS
    assert res["ok"]
    assert abs(res["dr"] - EXPECTED_TOTAL) < 1e-6
    assert abs(res["cr"] - EXPECTED_TOTAL) < 1e-6
    assert res["unbalanced"].empty


def test_format_b_fill_down_and_noise_removed():
    raw = _format_b()
    assert len(raw) == len(LINES) + 2  # 노이즈 2행 포함된 원본

    out, res = _run(raw)
    assert len(out) == len(LINES)  # 노이즈가 걷어내졌다
    assert out["전표번호"].nunique() == EXPECTED_VOUCHERS  # fill_down이 채웠다
    assert res["ok"]
    assert abs(res["dr"] - EXPECTED_TOTAL) < 1e-6
    assert abs(res["cr"] - EXPECTED_TOTAL) < 1e-6


def test_format_c_header_offset_and_signed_amount():
    raw = _format_c_with_banner()
    hdr = J.find_header_row(raw)
    assert hdr == 2  # 배너 2줄 다음이 머리글

    sliced = raw.iloc[hdr + 1:].copy()
    sliced.columns = raw.iloc[hdr].tolist()
    sliced = sliced.reset_index(drop=True)

    out, res = _run(sliced)
    assert len(out) == len(LINES)
    assert out["전표번호"].nunique() == EXPECTED_VOUCHERS
    assert res["ok"]
    assert abs(res["dr"] - EXPECTED_TOTAL) < 1e-6
    assert abs(res["cr"] - EXPECTED_TOTAL) < 1e-6


@pytest.mark.parametrize("builder", [
    _format_a,
    _format_b,
])
def test_cross_company_formats_converge(builder):
    """서식이 달라도(A vs B) 같은 거래에 대해 같은 검증 결과가 나와야 한다."""
    _, res = _run(builder())
    assert res["ok"] is True
    assert res["dr"] == pytest.approx(EXPECTED_TOTAL)
    assert res["cr"] == pytest.approx(EXPECTED_TOTAL)
    assert res["voucher_count"] == EXPECTED_VOUCHERS


def test_unbalanced_voucher_is_flagged():
    """차대가 실제로 다르면 검증이 이를 놓치지 않아야 한다(음성 오탐 방지)."""
    df = _format_a()
    # V002의 대변 라인(인덱스 3)만 50,000 → 40,000으로 깨뜨린다
    assert df.loc[3, "전표번호"] == "V002" and df.loc[3, "대변"] == "50,000"
    df.loc[3, "대변"] = "40,000"
    out, res = _run(df)
    assert not res["ok"]
    assert len(res["unbalanced"]) == 1
    assert res["unbalanced"].iloc[0]["전표번호"] == "V002"
