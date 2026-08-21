"""
감사 데스크 (Audit Desk) — 내부용 분석 도구
실행: streamlit run app.py
"""
import streamlit as st
from core.env import in_browser
from core.theme import inject_css, rule, stamp
from core.registry import MODULES

st.set_page_config(page_title="감사 데스크", page_icon="▨", layout="wide")
inject_css()

# ── 사이드바 ────────────────────────────────────────────────
with st.sidebar:
    st.markdown('<div class="brand">감사<br><span>데스크</span></div>', unsafe_allow_html=True)
    st.markdown(
        f'<div class="brand-sub">내부 전용 · '
        f'{"브라우저 실행" if in_browser() else "로컬 실행"}</div>',
        unsafe_allow_html=True)
    rule()

    choice = st.radio(
        "작업 선택",
        ["홈"] + [m.label for m in MODULES],
        label_visibility="collapsed",
    )

    rule()
    where = ("이 브라우저 안에서만" if in_browser() else "이 PC 메모리에서만")
    st.markdown(
        f'<div class="note">업로드한 파일은 {where} 처리되며 '
        '어디에도 전송·저장되지 않습니다.</div>',
        unsafe_allow_html=True,
    )

# ── 홈 ─────────────────────────────────────────────────────
if choice == "홈":
    st.markdown('<div class="eyebrow">WORKPAPER TOOLKIT</div>', unsafe_allow_html=True)
    st.markdown('<h1 class="display">감사 데스크</h1>', unsafe_allow_html=True)
    st.markdown(
        '<p class="lede">엑셀을 올리면 조서가 나옵니다. '
        '반복 작업만 골라 담은 개인 도구함입니다.</p>',
        unsafe_allow_html=True,
    )
    rule()

    ready = [m for m in MODULES if m.status == "ready"]
    draft = [m for m in MODULES if m.status != "ready"]

    st.markdown('<div class="section-label">사용 가능</div>', unsafe_allow_html=True)
    cols = st.columns(max(len(ready), 1))
    for col, m in zip(cols, ready):
        with col:
            st.markdown(
                f'<div class="card">'
                f'<div class="card-ref">{m.ref}</div>'
                f'<div class="card-title">{m.label}</div>'
                f'<div class="card-desc">{m.desc}</div>'
                f'{stamp("가동")}'
                f"</div>",
                unsafe_allow_html=True,
            )

    if draft:
        st.markdown('<div class="section-label">예정</div>', unsafe_allow_html=True)
        cols = st.columns(min(len(draft), 3) or 1)
        for i, m in enumerate(draft):
            with cols[i % len(cols)]:
                st.markdown(
                    f'<div class="card card-dim">'
                    f'<div class="card-ref">{m.ref}</div>'
                    f'<div class="card-title">{m.label}</div>'
                    f'<div class="card-desc">{m.desc}</div>'
                    f"</div>",
                    unsafe_allow_html=True,
                )

    rule()
    st.markdown(
        '<div class="note">모듈을 추가하려면 <code>modules/</code>에 파일을 만들고 '
        '<code>core/registry.py</code>에 한 줄 등록하면 사이드바에 바로 나타납니다.</div>',
        unsafe_allow_html=True,
    )

# ── 모듈 실행 ───────────────────────────────────────────────
else:
    mod = next(m for m in MODULES if m.label == choice)
    st.markdown(f'<div class="eyebrow">{mod.ref}</div>', unsafe_allow_html=True)
    st.markdown(f'<h1 class="display">{mod.label}</h1>', unsafe_allow_html=True)
    st.markdown(f'<p class="lede">{mod.desc}</p>', unsafe_allow_html=True)
    rule()
    mod.render()
