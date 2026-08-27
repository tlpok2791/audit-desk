"""
audit-desk를 브라우저에서 도는 형태(stlite)로 묶는다.

파이썬이 사용자의 브라우저 안에서 실행되므로 서버가 필요 없고,
업로드한 파일이 어디로도 전송되지 않는다. Netlify 같은 정적 호스팅에 그대로 올라간다.

파이썬 코드를 HTML 안에 전부 넣으므로 결과물은 파일 하나(tool.html)다.
폴더 구조를 신경 쓸 필요 없이 그것만 올리면 된다.

  python3 build_web.py         → web/tool.html 생성
"""
import json
import shutil
from pathlib import Path

SRC = Path(__file__).parent
OUT = SRC / "web"

# 브라우저 버전에 실을 파이썬 파일 (+ 계산기가 읽는 설정 JSON)
# income_tax.py는 pdfplumber를 함수 안에서 지연 임포트하므로, pdfplumber를
# REQUIREMENTS에 넣지 않아도 모듈 임포트 자체는 안전하다 — 브라우저에서는
# receipt.available()이 False가 되어 PDF 업로드 UI만 자동으로 숨겨진다.
PY_FILES = [
    "app.py",
    "core/__init__.py", "core/env.py", "core/theme.py", "core/registry.py",
    "core/loader.py", "core/accounts.py", "core/report.py",
    "core/journal.py", "core/ledger.py",
    "core/income_tax.py", "core/receipt.py",
    "modules/__init__.py", "modules/stub.py",
    "modules/edit.py",
    "modules/lead.py", "modules/fs.py", "modules/jet.py", "modules/income_tax.py",
    "config/income-tax-2025.json",
]

# Pyodide에 기본 포함되지 않는 순수 파이썬 패키지만 적는다
# (pandas · numpy는 Pyodide에 이미 들어 있다)
REQUIREMENTS = ["openpyxl", "xlrd"]

STLITE_VER = "0.85.1"

HTML = """<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
<title>감사 데스크 — 브라우저에서 실행</title>
<link rel="stylesheet"
      href="https://cdn.jsdelivr.net/npm/@stlite/browser@{ver}/build/stlite.css">
<style>
  :root {{ --indigo:#4F46E5; --ink:#111827; --mute:#6B7280; --bg:#F7F8FC; --line:#E5E7EB; }}
  * {{ box-sizing:border-box; margin:0; padding:0 }}
  body {{ background:var(--bg); font-family:Pretendard,system-ui,-apple-system,sans-serif; }}
  #bar {{ display:flex; align-items:center; gap:14px; padding:11px 20px;
          background:#fff; border-bottom:1px solid var(--line); }}
  #bar a {{ color:var(--mute); text-decoration:none; font-size:13.5px; font-weight:600; }}
  #bar a:hover {{ color:var(--indigo); }}
  #bar b {{ font-size:15px; color:var(--ink); letter-spacing:-.02em; }}
  #bar .tag {{ margin-left:auto; font-size:11.5px; font-weight:600; padding:4px 11px;
               border-radius:999px; background:#D1FAE5; color:#065F46; }}
  #boot {{ max-width:560px; margin:70px auto; padding:0 22px; text-align:center; }}
  #boot h2 {{ font-size:19px; font-weight:800; color:var(--ink); letter-spacing:-.03em; }}
  #boot p {{ font-size:14px; color:var(--mute); margin-top:11px; line-height:1.7; }}
  #boot .spin {{ width:34px; height:34px; margin:0 auto 22px; border-radius:50%;
                 border:3px solid var(--line); border-top-color:var(--indigo);
                 animation:sp .9s linear infinite; }}
  @keyframes sp {{ to {{ transform:rotate(360deg) }} }}
  #boot .note {{ margin-top:26px; padding:14px 17px; background:#fff;
                 border:1px solid var(--line); border-radius:12px;
                 font-size:12.5px; color:var(--mute); text-align:left; line-height:1.7; }}
  #root {{ display:none; }}
  #root.on {{ display:block; }}
  @media (prefers-reduced-motion:reduce) {{ #boot .spin {{ animation:none }} }}
</style>
</head>
<body>

<div id="bar">
  <a href="./">← 홈</a>
  <b>감사 데스크</b>
  <span class="tag">브라우저에서 실행 · 파일 전송 없음</span>
</div>

<div id="boot">
  <div class="spin"></div>
  <h2>파이썬 실행 환경을 내려받는 중입니다</h2>
  <p>처음 한 번만 약 50MB를 받습니다. 30초에서 1분쯤 걸리고,<br>
     다음부터는 브라우저에 저장된 것을 써서 훨씬 빠릅니다.</p>
  <div class="note">
    <b>파일은 이 브라우저 안에서만 처리됩니다.</b><br>
    파이썬이 서버가 아니라 지금 이 브라우저에서 돌기 때문에,
    올리신 원장이나 분개장은 어디로도 전송되지 않습니다.
    탭을 닫으면 함께 사라집니다.
  </div>
</div>

<div id="root"></div>

<script type="module">
import {{ mount }} from "https://cdn.jsdelivr.net/npm/@stlite/browser@{ver}/build/stlite.js";

const files = {files};

mount(
  {{
    requirements: {reqs},
    entrypoint: "app.py",
    files,
    streamlitConfig: {{
      "client.toolbarMode": "viewer",
      "theme.base": "light",
      "theme.primaryColor": "#4F46E5",
      "theme.backgroundColor": "#FBFAF6",
      "theme.secondaryBackgroundColor": "#EFEDE6",
      "theme.textColor": "#16202E",
    }},
  }},
  document.getElementById("root"),
);

// 앱이 그려지면 안내문을 감춘다
const root = document.getElementById("root");
const boot = document.getElementById("boot");
const obs = new MutationObserver(() => {{
  if (root.querySelector('[data-testid="stAppViewContainer"], .stApp')) {{
    boot.style.display = "none";
    root.classList.add("on");
    obs.disconnect();
  }}
}});
obs.observe(root, {{ childList:true, subtree:true }});
</script>
</body>
</html>
"""


def main():
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)

    payload = {}
    for rel in PY_FILES:
        src = SRC / rel
        if not src.exists():
            print(f"  건너뜀 (없음): {rel}")
            continue
        payload[rel] = src.read_text(encoding="utf-8")

    # JSON으로 넣으므로 따옴표·역따옴표·중괄호를 신경 쓸 필요가 없다
    files_js = json.dumps(payload, ensure_ascii=False, indent=2)

    html = HTML.format(
        ver=STLITE_VER,
        files=files_js,
        reqs=json.dumps(REQUIREMENTS),
    )
    out = OUT / "tool.html"
    out.write_text(html, encoding="utf-8")

    print(f"web/tool.html 생성 완료 — 파이썬 {len(payload)}개 내장 · "
          f"{out.stat().st_size/1024:.0f}KB")
    print("배포: tool.html 파일 하나만 저장소 최상단에 올리면 /tool.html 로 열립니다.")


if __name__ == "__main__":
    main()
