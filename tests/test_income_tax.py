"""core/income_tax.py 회귀 테스트 — 세율구간 경계값, 공제 중복배제, 전체 계산 흐름."""
import pytest

from core import income_tax as IT

CFG = IT.load_config()


def test_load_config_has_brackets():
    assert CFG["세율구간"][0]["세율"] == 0.06
    assert CFG["세율구간"][-1]["과세표준_이하"] is None


@pytest.mark.parametrize("과세표준,expected", [
    (0, 0),
    (14_000_000, 14_000_000 * 0.06),           # 최저구간 상한 — 경계값은 낮은 세율
    (14_000_001, 14_000_001 * 0.15 - 1_260_000),  # 경계 바로 위 — 다음 구간 세율
    (50_000_000, 50_000_000 * 0.15 - 1_260_000),
    (1_000_000_001, 1_000_000_001 * 0.45 - 65_940_000),  # 최고구간
])
def test_progressive_tax_brackets(과세표준, expected):
    assert IT.progressive_tax(과세표준, CFG) == pytest.approx(expected)


def test_business_income_floors_at_zero():
    assert IT.business_income(1_000_000, 5_000_000) == 0.0
    assert IT.business_income(5_000_000, 1_000_000) == 4_000_000.0


def test_personal_deduction_한부모가_부녀자보다_우선():
    base = IT.personal_deduction_total(1, config=CFG)
    with_both_flags = IT.personal_deduction_total(
        1, 부녀자_해당=True, 한부모_해당=True, config=CFG
    )
    # 둘 다 True로 넘겨도 한부모공제만 더해지고 부녀자공제는 중복 적용되지 않는다
    assert with_both_flags - base == CFG["인적공제"]["한부모_추가"]


def test_personal_deduction_인원별_합산():
    total = IT.personal_deduction_total(3, 경로우대_인원=1, 장애인_인원=1, config=CFG)
    c = CFG["인적공제"]
    expected = 3 * c["기본공제_1인당"] + c["경로우대_70세이상_추가_1인당"] + c["장애인_추가_1인당"]
    assert total == expected


@pytest.mark.parametrize("자녀수", [0, 1, 2, 3, 4])
def test_child_tax_credit(자녀수):
    c = CFG["자녀세액공제"]
    if 자녀수 <= 2:
        expected = 자녀수 * c["1_2인_1인당"]
    else:
        expected = 2 * c["1_2인_1인당"] + (자녀수 - 2) * c["3인째부터_1인당"]
    assert IT.child_tax_credit(자녀수, CFG) == expected


def test_calc_end_to_end_납부():
    result = IT.calc({
        "수입금액": 80_000_000, "필요경비": 30_000_000, "국민연금등_공제": 2_000_000,
        "기본공제_인원": 2, "기납부세액": 1_000_000,
    }, CFG)
    assert result["사업소득금액"] == 50_000_000
    assert result["종합소득공제"] == 2 * CFG["인적공제"]["기본공제_1인당"] + 2_000_000
    assert result["과세표준"] == result["종합소득금액"] - result["종합소득공제"]
    assert result["산출세액"] == pytest.approx(IT.progressive_tax(result["과세표준"], CFG))
    assert result["결정세액"] == pytest.approx(max(0.0, result["산출세액"] - result["세액공제_합계"]))
    assert result["차감납부세액"] == pytest.approx(result["결정세액"] - 1_000_000)
    assert result["환급여부"] == (result["차감납부세액"] < 0)


def test_calc_환급되는_경우():
    result = IT.calc({
        "수입금액": 20_000_000, "필요경비": 15_000_000, "국민연금등_공제": 0,
        "기본공제_인원": 1, "기납부세액": 5_000_000,
    }, CFG)
    assert result["환급여부"] is True
    assert result["차감납부세액"] < 0
