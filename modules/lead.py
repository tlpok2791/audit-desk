"""WP-300 조서 작성 — 시산표에서 표지·리드시트·상세조서를 한 번에 만든다."""
import io
from datetime import date

import numpy as np
import pandas as pd
import streamlit as st
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

from core import accounts, loader
from core.theme import rule

FIELDS = ["계정과목", "당기금액", "전기금액"]
FONT = "Arial"
HDR = PatternFill("solid", fgColor="16202E")
SUB = PatternFill("solid", fgColor="E8E6DF")
_t = Side(style="thin", color="C9C6BA")
_m = Side(style="medium", color="16202E")
BOX = Border(left=_t, right=_t, top=_t, bottom=_t)

# 리드시트 참조번호 체계 — 감사조서 관행
REF = {
    "유동자산": "A", "비유동자산": "B", "유동부채": "C", "비유동부채": "D", "자본": "E",
    "매출": "F", "매출원가": "G", "판매비와관리비": "H",
    "영업외수익": "I", "영업외비용": "J", "법인세": "K", "미분류": "Z",
}


def render():
    up = st.file_uploader("시산표 — 계정과목 / 당기금액 / 전기금액",
                          type=["csv", "xlsx", "xls", "xlsm"])
    if up is None:
        st.info("시산표를 올리면 계정그룹별 리드시트가 만들어집니다. "
                "samples/trial_balance.csv로 시험해 보셔도 됩니다.")
        return

    try:
        raw = loader.read_any(up)
    except Exception as e:
        st.error(f"파일을 읽지 못했습니다 — {e}")
        return

    mapping = loader.map_columns(raw, FIELDS)
    if mapping is None:
        return

    df = loader.standardize_numeric(loader.rename(raw, mapping), ["당기금액", "전기금액"])
    df = df.dropna(subset=["계정과목"]).fillna({"당기금액": 0, "전기금액": 0})
    df = accounts.classify(df)
    df["증감액"] = df["당기금액"] - df["전기금액"]
    df["증감률"] = np.where(df["전기금액"] != 0, df["증감액"] / df["전기금액"].abs(), np.nan)

    rule()

    # ── 표지 정보 ────────────────────────────────────────────
    st.markdown('<div class="section-label">표지 정보</div>', unsafe_allow_html=True)
    c1, c2, c3 = st.columns(3)
    with c1:
        company = st.text_input("회사명", "주식회사 ○○")
        prepared = st.text_input("작성자", "")
    with c2:
        period = st.text_input("대상기간", f"{date.today().year - 1}.01.01 ~ {date.today().year - 1}.12.31")
        reviewed = st.text_input("검토자", "")
    with c3:
        engagement = st.selectbox("업무 구분", ["외부감사", "검토", "합의된절차", "기타"])
        wp_date = st.date_input("작성일", value=date.today())

    st.markdown('<div class="section-label">구성</div>', unsafe_allow_html=True)
    c4, c5, c6 = st.columns(3)
    with c4:
        tick = st.checkbox("검토표시(tick mark) 열 넣기", value=True)
    with c5:
        include_pl = st.checkbox("손익 리드시트 포함", value=True)
    with c6:
        mat = st.number_input("수행중요성 (원)", value=100_000_000, step=10_000_000, format="%d",
                              help="이 금액 이상인 계정에 검토대상 표시를 넣습니다")

    groups = [g for g in accounts.ORDER if g in set(df["세부구분"].astype(str))]
    if not include_pl:
        groups = [g for g in groups if g in ("유동자산", "비유동자산", "유동부채", "비유동부채", "자본")]
    picked = st.multiselect("만들 리드시트", groups, default=groups)
    if not picked:
        st.warning("리드시트를 하나 이상 선택해 주세요.")
        return

    rule()

    # ── 미리보기 ────────────────────────────────────────────
    st.markdown('<div class="section-label">미리보기</div>', unsafe_allow_html=True)
    idx = st.selectbox("리드시트 선택", picked)
    sub = df[df["세부구분"].astype(str) == idx].sort_values("당기금액", key=abs, ascending=False)
    view = sub[["계정과목", "전기금액", "당기금액", "증감액", "증감률"]].copy()
    view.insert(0, "조서참조", [f"{REF.get(idx,'Z')}-{i:02d}" for i in range(1, len(view) + 1)])
    view["검토대상"] = np.where(sub["당기금액"].abs() >= mat, "○", "")
    st.dataframe(
        view.style.format({"전기금액": "{:,.0f}", "당기금액": "{:,.0f}",
                           "증감액": "{:,.0f}", "증감률": "{:+.1%}"}),
        use_container_width=True, hide_index=True)

    n_target = int((df[df["세부구분"].astype(str).isin(picked)]["당기금액"].abs() >= mat).sum())
    st.caption(f"리드시트 {len(picked)}개 · 계정 {len(df[df['세부구분'].astype(str).isin(picked)])}개 · "
               f"수행중요성 초과 {n_target}개")

    # ── 내려받기 ────────────────────────────────────────────
    rule()
    meta = dict(company=company, period=period, engagement=engagement,
                prepared=prepared, reviewed=reviewed, wp_date=wp_date, mat=mat)
    xlsx = _export(df, picked, meta, tick)
    st.download_button("조서 내려받기 (xlsx)", xlsx,
                       file_name=f"조서_{company}_{date.today():%y%m%d}.xlsx",
                       mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


# ─────────────────────────────────────────────────────────────
def _export(df, groups, meta, tick):
    wb = Workbook()

    # ── 표지 ────────────────────────────────────────────────
    ws = wb.active
    ws.title = "표지"
    ws["B2"] = meta["company"]
    ws["B2"].font = Font(FONT, size=20, bold=True)
    ws["B3"] = f"{meta['engagement']} 조서"
    ws["B3"].font = Font(FONT, size=12, color="6B7280")
    ws["B5"] = meta["period"]
    ws["B5"].font = Font(FONT, size=11)

    info = [("작성자", meta["prepared"]), ("작성일", f"{meta['wp_date']:%Y-%m-%d}"),
            ("검토자", meta["reviewed"]), ("검토일", ""),
            ("수행중요성", f"{meta['mat']:,.0f}원")]
    r = 8
    for label, value in info:
        ws.cell(r, 2, label).font = Font(FONT, size=10, bold=True)
        ws.cell(r, 3, value).font = Font(FONT, size=10)
        ws.cell(r, 3).border = Border(bottom=_t)
        r += 1

    r += 1
    ws.cell(r, 2, "조서 목차").font = Font(FONT, size=11, bold=True)
    r += 1
    for c, h in enumerate(["참조", "리드시트", "당기금액"], 2):
        cell = ws.cell(r, c, h)
        cell.font = Font(FONT, bold=True, color="FFFFFF")
        cell.fill = HDR
        cell.border = BOX
    for g in groups:
        r += 1
        sub = df[df["세부구분"].astype(str) == g]
        ws.cell(r, 2, REF.get(g, "Z")).font = Font(FONT, size=10)
        ws.cell(r, 3, g).font = Font(FONT, size=10)
        ws.cell(r, 4, float(sub["당기금액"].sum())).number_format = "#,##0"
        for c in range(2, 5):
            ws.cell(r, c).border = BOX

    for col, w in zip("ABCD", [3, 16, 30, 20]):
        ws.column_dimensions[col].width = w

    # ── 리드시트 ────────────────────────────────────────────
    for g in groups:
        _lead_sheet(wb, df, g, meta, tick)

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _lead_sheet(wb, df, group, meta, tick):
    ref = REF.get(group, "Z")
    ws = wb.create_sheet(f"{ref} {group}"[:31])
    sub = df[df["세부구분"].astype(str) == group].sort_values("당기금액", key=abs, ascending=False)

    ws["A1"] = f"{meta['company']}   |   {group} 리드시트"
    ws["A1"].font = Font(FONT, size=13, bold=True)
    ws["A2"] = f"{meta['period']}   ·   참조 {ref}   ·   작성 {meta['prepared'] or '―'} " \
               f"{meta['wp_date']:%Y-%m-%d}   ·   검토 {meta['reviewed'] or '―'}"
    ws["A2"].font = Font(FONT, size=9, color="6B7280")

    cols = ["조서참조", "계정과목", "전기금액", "당기금액", "증감액", "증감률"]
    if tick:
        cols += ["검토표시", "비고"]
    else:
        cols += ["비고"]

    for c, h in enumerate(cols, 1):
        cell = ws.cell(4, c, h)
        cell.font = Font(FONT, bold=True, color="FFFFFF")
        cell.fill = HDR
        cell.alignment = Alignment("center", "center")
        cell.border = BOX

    r = 5
    for i, (_, row) in enumerate(sub.iterrows(), 1):
        ws.cell(r, 1, f"{ref}-{i:02d}").font = Font(FONT, size=10)
        ws.cell(r, 2, str(row["계정과목"])).font = Font(FONT, size=10)
        ws.cell(r, 3, float(row["전기금액"]))
        ws.cell(r, 4, float(row["당기금액"]))
        ws.cell(r, 5, f"=D{r}-C{r}")
        ws.cell(r, 6, f'=IF(C{r}=0,"",E{r}/ABS(C{r}))')
        if abs(row["당기금액"]) >= meta["mat"]:
            ws.cell(r, 2).font = Font(FONT, size=10, bold=True)
        for c in range(1, len(cols) + 1):
            ws.cell(r, c).border = BOX
        for c in (3, 4, 5):
            ws.cell(r, c).number_format = "#,##0;(#,##0);-"
            ws.cell(r, c).font = Font(FONT, size=10)
        ws.cell(r, 6).number_format = "0.0%;(0.0%);-"
        ws.cell(r, 6).font = Font(FONT, size=10)
        r += 1

    ws.cell(r, 2, "합계").font = Font(FONT, bold=True)
    for c in (3, 4, 5):
        L = get_column_letter(c)
        ws.cell(r, c, f"=SUM({L}5:{L}{r-1})")
        ws.cell(r, c).font = Font(FONT, bold=True)
        ws.cell(r, c).number_format = "#,##0;(#,##0);-"
        ws.cell(r, c).border = Border(top=_m, bottom=_m, left=_t, right=_t)
    ws.cell(r, 1).border = Border(top=_m, bottom=_m, left=_t, right=_t)
    for c in range(6, len(cols) + 1):
        ws.cell(r, c).border = Border(top=_m, bottom=_m, left=_t, right=_t)
    ws.cell(r, 2).border = Border(top=_m, bottom=_m, left=_t, right=_t)

    r += 2
    ws.cell(r, 1, "검토표시 범례").font = Font(FONT, size=9, bold=True)
    for legend in ["✓  총계정원장과 대조 완료",
                   "①  전기 감사조서와 대조 완료",
                   "②  외부조회서 회신 대조",
                   "③  증빙 표본검사 완료",
                   "**  수행중요성 초과 — 개별 검토 대상 (계정과목 굵게 표시)"]:
        r += 1
        ws.cell(r, 1, legend).font = Font(FONT, size=9, color="6B7280")

    widths = [12, 26, 18, 18, 18, 11] + ([10, 30] if tick else [30])
    for c, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(c)].width = w
    ws.freeze_panes = "A5"
