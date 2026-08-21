"""아직 만들지 않은 모듈의 자리표시자."""
import streamlit as st


def make(name: str):
    def render():
        st.info(
            f"**{name}**은 아직 비어 있습니다.\n\n"
            f"`modules/` 아래에 파일을 만들고 `render()`를 정의한 다음, "
            f"`core/registry.py`에서 이 항목의 `render`를 그 함수로 바꾸고 "
            f"`status`를 `\"ready\"`로 고치면 됩니다."
        )
    return render
