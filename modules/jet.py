"""JE-100 전표 이상징후 분석."""
import numpy as np
import pandas as pd
import streamlit as st

from core import loader, report
from core.theme import rule

FIELDS = ["전표번호", "회계일자", "계정과목", "적요", "차변금액", "입력자", "입력일시"]


def render():
    up = st.file_uploader("총계정원장 (CSV 또는 엑셀)", type=["csv", "xlsx", "xls", "xlsm"])
    if up is None:
        st.info("파일을 올리면 컬럼 연결 화면이 나타납니다. "
                "samples/ledger_2025.csv로 먼저 시험해 보셔도 됩니다.")
        return

    try:
        raw = loader.read_any(up)
    except Exception as e:
        st.error(f"파일을 읽지 못했습니다 — {e}")
        return

    st.caption(f"{len(raw):,}행 × {len(raw.columns)}열")
    mapping = loader.map_columns(raw, FIELDS)
    if mapping is None:
        return
    df = loader.standardize(raw, mapping).dropna(subset=["회계일자", "차변금액"])
    if df.empty:
        st.error("회계일자 또는 금액을 인식하지 못했습니다. 컬럼 연결을 확인해 주세요.")
        return

    rule()

    # ── 적출 기준 ────────────────────────────────────────────
    st.markdown('<div class="section-label">적출 기준</div>', unsafe_allow_html=True)
    c1, c2, c3, c4 = st.columns(4)
    ye_end = df["회계일자"].max().date()
    with c1:
        ye_from = st.date_input("기말 기준일", value=ye_end - pd.Timedelta(days=3))
    with c2:
        night = st.slider("심야 기준 (시)", 18, 23, 22)
    with c3:
        limit = st.number_input("승인한도 (원)", value=10_000_000, step=1_000_000, format="%d")
    with c4:
        band = st.slider("한도 직하 구간 (%)", 1, 20, 10,
                         help="한도의 몇 % 아래까지를 회피 의심 구간으로 볼지")

    picked = st.multiselect(
        "실행할 테스트",
        ["기말 심야 입력", "승인한도 직하", "업무외 시간 입력", "중복 계상", "금액 상위"],
        default=["기말 심야 입력", "승인한도 직하", "중복 계상", "금액 상위"],
    )
    if not picked:
        st.warning("테스트를 하나 이상 선택해 주세요.")
        return

    rule()

    # ── 실행 ────────────────────────────────────────────────
    results, floor = {}, limit * (1 - band / 100)
    ts = pd.Timestamp(ye_from)

    if "기말 심야 입력" in picked:
        results["기말 심야 입력"] = {
            "df": df[(df["회계일자"] >= ts) & (df["입력일시"].dt.hour >= night)],
            "basis": f"회계일자 {ye_from:%m-%d} 이후 & 입력 {night}시 이후 — 기간귀속 조작 위험",
        }
    if "승인한도 직하" in picked:
        results["승인한도 직하"] = {
            "df": df[(df["차변금액"] >= floor) & (df["차변금액"] < limit)],
            "basis": f"{floor:,.0f}~{limit:,.0f}원 구간 — 한도 회피 분할발행 가능성",
        }
    if "업무외 시간 입력" in picked:
        results["업무외 시간 입력"] = {
            "df": df[df["입력일시"].dt.weekday >= 5],
            "basis": "입력일시가 토·일 — 통상 업무시간 외 처리",
        }
    if "중복 계상" in picked:
        key = ["계정과목", "회계일자", "차변금액"]
        results["중복 계상"] = {
            "df": df[df.duplicated(key, keep=False)].sort_values(key),
            "basis": "계정·일자·금액 3요소 동일 — 이중계상 가능성",
        }
    if "금액 상위" in picked:
        results["금액 상위"] = {
            "df": df.nlargest(10, "차변금액"),
            "basis": "금액 상위 10건 — 정밀도 기준 개별 검토 대상",
        }

    pop_n, pop_amt = len(df), float(df["차변금액"].sum())

    st.markdown('<div class="section-label">적출 결과</div>', unsafe_allow_html=True)
    cols = st.columns(len(results))
    for col, (name, res) in zip(cols, results.items()):
        with col:
            n = len(res["df"])
            st.metric(name, f"{n:,}건", f"{n/pop_n*100:.1f}% of 모집단",
                      delta_color="off")
            st.caption(f"{res['df']['차변금액'].sum():,.0f}원")

    for name, res in results.items():
        with st.expander(f"{name} — {len(res['df']):,}건"):
            st.caption(res["basis"])
            if res["df"].empty:
                st.write("적출 항목 없음")
            else:
                st.dataframe(res["df"].sort_values("차변금액", ascending=False),
                             use_container_width=True, height=300)

    # ── 벤포드 ──────────────────────────────────────────────
    rule()
    st.markdown('<div class="section-label">벤포드 법칙 (첫 자리)</div>', unsafe_allow_html=True)
    ben, chi = _benford(df["차변금액"])
    b1, b2 = st.columns([2, 1])
    with b1:
        st.bar_chart(ben[["실제%", "기대%"]])
    with b2:
        st.metric("카이제곱 통계량", f"{chi:.1f}")
        st.caption("자유도 8 · 유의수준 5% 임계값 15.5")
        st.caption("임계값을 넘으면 금액 분포가 자연발생 패턴에서 벗어난 것으로 봅니다. "
                   "다만 국지적 조작은 이 검정으로 잡히지 않습니다.")
        st.dataframe(ben, use_container_width=True)

    # ── 조서 내려받기 ────────────────────────────────────────
    rule()
    notes = loader.health_check(df)
    if notes:
        st.markdown('<div class="section-label">데이터 품질 메모</div>', unsafe_allow_html=True)
        for n in notes:
            st.caption(f"· {n}")

    xlsx = report.build(results, {
        "title": "전표 이상징후 분석(JET) 조서",
        "period": f"{df['회계일자'].min():%Y-%m-%d} ~ {df['회계일자'].max():%Y-%m-%d}",
        "pop_count": pop_n,
        "pop_amount": pop_amt,
        "notes": notes,
    })
    st.download_button("조서 내려받기 (xlsx)", xlsx,
                       file_name=f"JET_{df['회계일자'].max():%Y}.xlsx",
                       mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


def _benford(amounts: pd.Series):
    d = (amounts.abs().astype(str).str.lstrip("0.").str[0]
         .where(lambda s: s.str.isdigit()).dropna().astype(int))
    d = d[d.between(1, 9)]
    obs = d.value_counts(normalize=True).reindex(range(1, 10), fill_value=0).sort_index()
    exp = pd.Series({i: np.log10(1 + 1 / i) for i in range(1, 10)})
    n = len(d)
    chi = float((((obs * n) - (exp * n)) ** 2 / (exp * n)).sum()) if n else 0.0
    out = pd.DataFrame({"실제%": (obs * 100).round(1), "기대%": (exp * 100).round(1)})
    out["편차%p"] = (out["실제%"] - out["기대%"]).round(1)
    out.index.name = "첫자리"
    return out, chi
