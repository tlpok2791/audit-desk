"""
종합소득세(사업소득자) 계산 엔진 — 순수 함수, 화면 코드 없음.

세율·공제 상수는 config/income-tax-2025.json 에서 읽는다. 세법이 바뀌면
그 파일만 고치면 되고, 이 파일의 계산 로직은 그대로 쓴다.

이 계산기는 참고용 추정치를 낸다. 가산세·지방소득세 신고·특별세액공제(보험료·
의료비·교육비 등)는 범위 밖이며, 실제 신고 전 세무사 확인이 필요하다.
"""
import json
from pathlib import Path

CONFIG_PATH = Path(__file__).resolve().parent.parent / "config" / "income-tax-2025.json"


def load_config(path: Path | str | None = None) -> dict:
    p = Path(path) if path else CONFIG_PATH
    return json.loads(p.read_text(encoding="utf-8"))


def business_income(수입금액: float, 필요경비: float) -> float:
    """사업소득금액 = 수입금액 - 필요경비. 음수는 0으로 (결손은 별도 이월 규정이라 범위 밖)."""
    return max(0.0, float(수입금액) - float(필요경비))


def personal_deduction_total(
    기본공제_인원: int,
    경로우대_인원: int = 0,
    장애인_인원: int = 0,
    부녀자_해당: bool = False,
    한부모_해당: bool = False,
    config: dict | None = None,
) -> float:
    """인적공제 합계. 부녀자·한부모는 중복 적용하지 않고 한부모를 우선한다."""
    c = (config or load_config())["인적공제"]
    total = 기본공제_인원 * c["기본공제_1인당"]
    total += 경로우대_인원 * c["경로우대_70세이상_추가_1인당"]
    total += 장애인_인원 * c["장애인_추가_1인당"]
    if 한부모_해당:
        total += c["한부모_추가"]
    elif 부녀자_해당:
        total += c["부녀자_추가"]
    return total


def progressive_tax(과세표준: float, config: dict | None = None) -> float:
    """누진세율표로 산출세액을 계산한다. 산출세액 = 과세표준 × 세율 - 누진공제."""
    c = config or load_config()
    base = max(0.0, float(과세표준))
    for bracket in c["세율구간"]:
        상한 = bracket["과세표준_이하"]
        if 상한 is None or base <= 상한:
            return max(0.0, base * bracket["세율"] - bracket["누진공제"])
    raise ValueError("세율구간 설정이 잘못되었습니다 (최고 구간에 이하값이 없어야 합니다).")


def child_tax_credit(자녀수: int, config: dict | None = None) -> float:
    """8세 이상 기본공제대상 자녀 세액공제. 1~2인은 1인당, 3인째부터는 더 크게."""
    c = (config or load_config())["자녀세액공제"]
    n = max(0, int(자녀수))
    first_two = min(n, 2) * c["1_2인_1인당"]
    rest = max(0, n - 2) * c["3인째부터_1인당"]
    return first_two + rest


def calc(inputs: dict, config: dict | None = None) -> dict:
    """
    inputs 필드:
      수입금액, 필요경비, 국민연금등_공제,
      기본공제_인원, 경로우대_인원(기본값 0), 장애인_인원(기본값 0),
      부녀자_해당(기본값 False), 한부모_해당(기본값 False),
      자녀세액공제_인원(기본값 0), 기납부세액(기본값 0)

    돌려주는 값은 신고서 흐름을 따르는 중간 단계를 전부 담은 dict —
    화면에 그대로 표로 펼치면 어디서 얼마가 빠졌는지 확인할 수 있다.
    """
    c = config or load_config()

    사업소득금액 = business_income(inputs["수입금액"], inputs["필요경비"])
    종합소득금액 = 사업소득금액  # 사업소득만 있다고 가정 (다른 소득 합산은 범위 밖)

    인적공제 = personal_deduction_total(
        inputs.get("기본공제_인원", 1),
        inputs.get("경로우대_인원", 0),
        inputs.get("장애인_인원", 0),
        inputs.get("부녀자_해당", False),
        inputs.get("한부모_해당", False),
        c,
    )
    국민연금등_공제 = float(inputs.get("국민연금등_공제", 0))
    종합소득공제 = 인적공제 + 국민연금등_공제

    과세표준 = max(0.0, 종합소득금액 - 종합소득공제)
    산출세액 = progressive_tax(과세표준, c)

    표준세액공제 = c["표준세액공제_사업소득자"]
    자녀공제액 = child_tax_credit(inputs.get("자녀세액공제_인원", 0), c)
    세액공제_합계 = 표준세액공제 + 자녀공제액

    결정세액 = max(0.0, 산출세액 - 세액공제_합계)
    기납부세액 = float(inputs.get("기납부세액", 0))
    차감납부세액 = 결정세액 - 기납부세액  # 음수면 환급

    return {
        "수입금액": float(inputs["수입금액"]),
        "필요경비": float(inputs["필요경비"]),
        "사업소득금액": 사업소득금액,
        "종합소득금액": 종합소득금액,
        "인적공제": 인적공제,
        "국민연금등_공제": 국민연금등_공제,
        "종합소득공제": 종합소득공제,
        "과세표준": 과세표준,
        "산출세액": 산출세액,
        "표준세액공제": 표준세액공제,
        "자녀세액공제": 자녀공제액,
        "세액공제_합계": 세액공제_합계,
        "결정세액": 결정세액,
        "기납부세액": 기납부세액,
        "차감납부세액": 차감납부세액,
        "환급여부": 차감납부세액 < 0,
        "지방소득세_추정": max(0.0, 결정세액) * c["지방소득세율"],
    }
