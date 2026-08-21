"""조서(workpaper) 문법을 옮긴 시각 언어 — 괘선, 참조번호, 적출 표식."""
import streamlit as st

INK = "#16202E"      # 조서 본문
PAPER = "#FBFAF6"    # 조서 용지
RULE = "#C9C6BA"     # 괘선
MARK = "#B3261E"     # 감사인의 적색 표기
SLATE = "#6B7280"    # 보조 텍스트
TICK = "#1F6F5C"     # 확인 완료

CSS = f"""
<style>
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@300;400;600&family=IBM+Plex+Mono:wght@400;600&display=swap');

html, body, [class*="css"] {{ font-family:'IBM Plex Sans KR',sans-serif; }}
.stApp {{ background:{PAPER}; color:{INK}; }}

/* 사이드바 */
section[data-testid="stSidebar"] {{ background:{INK}; }}
section[data-testid="stSidebar"] * {{ color:#E8E6DF; }}
.brand {{ font-family:'IBM Plex Mono',monospace; font-size:26px; font-weight:600;
         line-height:1.05; letter-spacing:-.02em; }}
.brand span {{ color:{RULE}; font-weight:400; }}
.brand-sub {{ font-size:11px; color:#8A8F98; letter-spacing:.08em; margin-top:6px; }}

/* 표제 */
.eyebrow {{ font-family:'IBM Plex Mono',monospace; font-size:11px; letter-spacing:.18em;
           color:{MARK}; margin-bottom:2px; }}
h1.display {{ font-family:'IBM Plex Mono',monospace; font-size:34px; font-weight:600;
              letter-spacing:-.03em; margin:0 0 6px; color:{INK}; }}
.lede {{ font-size:14px; color:{SLATE}; max-width:56ch; margin:0; }}
.section-label {{ font-family:'IBM Plex Mono',monospace; font-size:11px; letter-spacing:.14em;
                  color:{SLATE}; margin:22px 0 10px; }}

/* 괘선 — 조서 상하단 이중선 */
.rule {{ border:0; border-top:1px solid {INK}; border-bottom:1px solid {RULE};
        height:3px; margin:18px 0; }}

/* 모듈 카드 */
.card {{ background:#fff; border:1px solid {RULE}; border-left:3px solid {INK};
        padding:16px 18px; height:100%; }}
.card-dim {{ border-left-color:{RULE}; opacity:.55; }}
.card-ref {{ font-family:'IBM Plex Mono',monospace; font-size:11px; color:{MARK};
            letter-spacing:.1em; }}
.card-title {{ font-size:16px; font-weight:600; margin:4px 0 6px; }}
.card-desc {{ font-size:13px; color:{SLATE}; line-height:1.5; }}
.stamp {{ display:inline-block; margin-top:12px; font-family:'IBM Plex Mono',monospace;
         font-size:10px; letter-spacing:.14em; color:{TICK};
         border:1px solid {TICK}; padding:2px 7px; }}

/* 지표 */
[data-testid="stMetricValue"] {{ font-family:'IBM Plex Mono',monospace; font-size:24px; }}
[data-testid="stMetricLabel"] {{ font-size:12px; color:{SLATE}; }}

/* 표 — 숫자는 등폭으로 */
[data-testid="stDataFrame"] {{ font-family:'IBM Plex Mono',monospace; font-size:12px; }}

.note {{ font-size:12px; color:{SLATE}; line-height:1.6; }}
.note code {{ background:#EFEDE6; padding:1px 5px; font-size:11px; }}

.stButton>button, .stDownloadButton>button {{
    background:{INK}; color:{PAPER}; border:0; border-radius:0;
    font-family:'IBM Plex Mono',monospace; font-size:13px; letter-spacing:.04em; }}
.stButton>button:hover, .stDownloadButton>button:hover {{ background:{MARK}; color:#fff; }}
</style>
"""


def inject_css():
    st.markdown(CSS, unsafe_allow_html=True)


def rule():
    st.markdown('<div class="rule"></div>', unsafe_allow_html=True)


def stamp(text: str) -> str:
    return f'<span class="stamp">{text}</span>'
