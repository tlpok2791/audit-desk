"""
config/income-tax-2025.json → src/data/tax-rates.js 생성기.

세율·공제 상수의 단일 소스는 JSON 하나다. 파이썬(core/income_tax.py)은 JSON을
그대로 읽고, 브라우저는 fetch를 못 쓰는 경우(file:// 로 열기)가 있어 같은 값을
JS 파일로 구워 둔다. 세법이 바뀌면 JSON만 고치고 이 스크립트를 다시 돌린다.

  python3 build_tax.py      → src/data/tax-rates.js 갱신
"""
import json
from pathlib import Path

SRC = Path(__file__).parent
CONFIG = SRC / "config" / "income-tax-2025.json"
OUT = SRC / "src" / "data" / "tax-rates.js"

TEMPLATE = """/*
 * 세율·공제 상수 — build_tax.py 가 config/income-tax-2025.json 에서 생성합니다.
 * 직접 고치지 마세요. 세법이 바뀌면 JSON을 고치고 `python3 build_tax.py` 를 돌리세요.
 */
(function (root, factory) {{
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TAX_RATES = api;
}})(typeof self !== "undefined" ? self : this, function () {{
  "use strict";
  return {payload};
}});
"""


def main():
    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    # 설명·주의 키는 계산에 쓰이지 않으므로 브라우저 번들에서 뺀다
    payload = {k: v for k, v in cfg.items() if not k.startswith("_")}
    js = TEMPLATE.format(payload=json.dumps(payload, ensure_ascii=False, indent=2))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(js, encoding="utf-8")
    print(f"{OUT.relative_to(SRC)} 생성 완료 — 귀속연도 {cfg.get('귀속연도')} · "
          f"세율구간 {len(cfg['세율구간'])}개")


if __name__ == "__main__":
    main()
