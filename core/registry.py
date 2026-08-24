"""
모듈 등록부.

새 기능을 붙이는 법:
  1. modules/ 아래에 파일을 만들고 render() 함수를 정의한다
  2. 아래 MODULES 목록에 Module(...) 한 줄을 추가한다
  3. 끝. 사이드바와 홈 카드에 자동으로 나타난다
"""
from dataclasses import dataclass
from typing import Callable

from modules import edit, fs, jet, lead, stub


@dataclass
class Module:
    ref: str                 # 조서 참조번호
    label: str               # 메뉴에 표시될 이름
    desc: str                # 한 줄 설명
    render: Callable         # 화면을 그리는 함수
    status: str = "draft"    # "ready" | "draft"


MODULES = [
    Module(
        ref="JL-100",
        label="분개장·계정별원장 편집",
        desc="분개장은 서식과 무관하게 표준 형태로 펴 차대 합계를 검증하고, "
             "계정별원장은 계정마다 나뉜 시트를 하나의 통합 원장으로 합쳐 "
             "원장에 찍힌 [누계]와 대조합니다. 한 화면에서 자료 종류만 골라 씁니다.",
        render=edit.render,
        status="ready",
    ),
    Module(
        ref="WP-300",
        label="조서 작성",
        desc="시산표를 올리면 표지와 계정그룹별 리드시트를 참조번호·검토표시란까지 "
             "갖춘 엑셀로 만들어 줍니다.",
        render=lead.render,
        status="ready",
    ),
    Module(
        ref="FS-200",
        label="재무제표 분석",
        desc="2개년 시산표로 증감분석과 비율분석을 돌리고, 유의적 변동에 대한 "
             "코멘트 초안까지 뽑습니다.",
        render=fs.render,
        status="ready",
    ),
    Module(
        ref="JE-100",
        label="전표 이상징후 분석",
        desc="총계정원장에서 기말 심야전표, 승인한도 직하, 중복 계상, "
             "벤포드 편차를 적출합니다.",
        render=jet.render,
        status="ready",
    ),
    # ── 아래는 자리만 잡아둔 것. 만들 때 status를 "ready"로 바꾸면 됩니다 ──
    Module(
        ref="RC-400",
        label="계정 대사",
        desc="총계정원장과 보조부·은행거래내역을 대사해 미일치 항목만 추립니다.",
        render=stub.make("계정 대사"),
    ),
    Module(
        ref="SM-500",
        label="표본 추출",
        desc="금액가중(MUS) 또는 무작위 표본을 뽑고 추출 근거를 함께 기록합니다.",
        render=stub.make("표본 추출"),
    ),
]
