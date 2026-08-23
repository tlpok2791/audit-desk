"""samples/ 에 있는 실제 시험용 파일로 core/journal.py를 회귀 검증한다."""
from pathlib import Path

import pandas as pd

from core import journal as J

SAMPLE_DIR = Path(__file__).resolve().parents[1] / "samples"


def test_sample_journal_altformat_balances():
    raw = pd.read_csv(SAMPLE_DIR / "journal_altformat_utf8.csv", encoding="utf-8-sig")
    mapping = J.guess_mapping(raw.columns)
    assert {"전표번호", "전표일자", "계정과목", "적요", "금액", "차대구분"} <= set(mapping)

    out = J.normalize(raw, mapping)
    res = J.verify(out)

    assert res["ok"], res["checks"]
    assert res["dr"] == res["cr"]
    assert res["diff"] == 0
