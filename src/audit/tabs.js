/*
 * 감사도구 세부탭 골격 + 탭1(정산표 작성).
 * 탭2~5는 잠금 placeholder. 정산표는 AuditState 전역 상태를 단일 소스로 쓴다.
 * 엑셀은 SheetJS로 브라우저 안에서만 처리한다. 파일은 서버로 가지 않는다.
 */
(function () {
  "use strict";

  var TABS = [
    { id: "ws", num: 1, name: "정산표 작성", locked: false,
      desc: "전기 재무제표와 당기 시산표로 정산표를 만들고 수정·재분류분개를 반영합니다." },
    { id: "t2", num: 2, name: "준비 중 2", locked: true },
    { id: "t3", num: 3, name: "준비 중 3", locked: true },
    { id: "t4", num: 4, name: "준비 중 4", locked: true },
    { id: "t5", num: 5, name: "준비 중 5", locked: true },
    { id: "hub", num: "·", name: "도구 모음", locked: false,
      desc: "자주 쓰는 사이트와 도구를 한곳에 모아 둡니다." },
  ];

  var activeTab = "ws";
  var S = null;                  // AuditState
  var t1 = newT1();

  function newT1() {
    return { current: null, prior: null, coa: null, mapRows: null, prevMap: null,
             adjustments: [], reasons: {}, rows: null, showUnmappedOnly: true,
             _restored: false, _restoring: false, _engId: null };
  }

  var $ = function (id) { return document.getElementById(id); };

  function esc(s) {
    return String(s === null || s === undefined ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function num(n) { return WS.fmt(n); }
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  /* ══ 진입점 ═══════════════════════════════════════════ */
  document.addEventListener("DOMContentLoaded", function () {
    var host = $("audit-app");
    if (!host || typeof AuditState === "undefined") return;
    S = AuditState;
    host.innerHTML =
      '<div id="eng-bar"></div>' +
      '<div class="subtabs" id="subtabs" role="tablist"></div>' +
      '<div id="ws-bar"></div>' +
      '<div id="sub-panel"></div>';
    S.subscribe(renderAll);
    S.init().then(renderAll);
  });

  function renderAll() {
    renderEngagementBar();
    renderSubtabs();
    renderWorksheetBar();
    renderPanel();
  }

  /* ══ engagement 표시 + 전환 ═══════════════════════════ */
  function renderEngagementBar() {
    var bar = $("eng-bar");
    var st = S.getState();
    var cur = S.current();
    bar.innerHTML = "";

    var box = el("div", "engbar");
    var left = el("div", "engbar-l");

    if (cur) {
      left.innerHTML =
        '<span class="engbar-co">' + esc(cur.회사명 || cur.회사코드) + "</span>" +
        '<span class="engbar-dt">' + esc(cur.결산일) + "</span>" +
        '<span class="engbar-path">' + esc(S.workPath(cur)) + "</span>";
    } else {
      left.innerHTML = '<span class="engbar-co">engagement 없음</span>'
        + '<span class="engbar-dt">회사와 결산일을 먼저 등록하세요</span>';
    }
    box.appendChild(left);

    var right = el("div", "engbar-r");
    var sel = el("select", "eng-sel");
    st.engagements.forEach(function (e) {
      var o = new Option(S.label(e), e.id);
      if (e.id === st.currentId) o.selected = true;
      sel.appendChild(o);
    });
    sel.appendChild(new Option("+ 새 engagement", "__new__"));
    sel.addEventListener("change", function () {
      if (sel.value === "__new__") { openEngForm(null); renderEngagementBar(); }
      else { var coa = t1.coa; t1 = newT1(); t1.coa = coa; S.setCurrent(sel.value); }
      // _restored 는 newT1() 에서 false 로 돌아가 새 engagement 의 보관본을 다시 읽는다
    });
    right.appendChild(sel);

    if (cur) {
      var edit = el("button", "mini-btn", "정보 수정");
      edit.type = "button";
      edit.addEventListener("click", function () { openEngForm(cur); });
      right.appendChild(edit);
    }
    box.appendChild(right);
    bar.appendChild(box);

    if (!cur || bar.dataset.formOpen === "1") openEngForm(cur, true);
  }

  function openEngForm(meta, keepOpen) {
    var bar = $("eng-bar");
    if (bar.querySelector(".engform") && !keepOpen) { bar.dataset.formOpen = "0"; bar.querySelector(".engform").remove(); return; }
    if (bar.querySelector(".engform")) return;
    bar.dataset.formOpen = "1";

    var m = meta || {};
    var f = el("div", "engform");
    var fields = [
      ["회사명", "회사명", "마플 주식회사", "text"],
      ["회사코드", "회사코드", "MAPLE", "text"],
      ["결산일", "결산일", "", "date"],
      ["작성자", "작성자", "", "text"],
      ["검토자", "검토자", "", "text"],
      ["중요성금액", "중요성금액", "500000000", "number"],
      ["수행중요성", "수행중요성", "375000000", "number"],
    ];
    f.innerHTML = '<div class="sublabel">engagement 정보 (meta.json)</div>';
    var grid = el("div", "engform-grid");
    fields.forEach(function (fd) {
      var wrap = el("label", "fcard-field");
      wrap.appendChild(el("span", null, fd[0]));
      var i = document.createElement("input");
      i.type = fd[3];
      i.placeholder = fd[2];
      i.value = m[fd[1]] === undefined || m[fd[1]] === null ? "" : m[fd[1]];
      i.dataset.k = fd[1];
      wrap.appendChild(i);
      grid.appendChild(wrap);
    });
    f.appendChild(grid);

    var msg = el("p", "cap");
    f.appendChild(msg);

    var row = el("div", "engform-actions");
    var save = el("button", "copy-btn", meta ? "정보 저장" : "engagement 만들기");
    save.type = "button";
    save.addEventListener("click", function () {
      var data = {};
      grid.querySelectorAll("input").forEach(function (i) {
        var v = i.value.trim();
        data[i.dataset.k] = i.type === "number" ? (v === "" ? null : Number(v)) : v;
      });
      if (!data.회사명 || !data.회사코드 || !data.결산일) {
        msg.textContent = "회사명·회사코드·결산일은 반드시 입력해야 합니다.";
        msg.style.color = "var(--rose-t)";
        return;
      }
      if (!/^[A-Za-z0-9_-]+$/.test(data.회사코드)) {
        msg.textContent = "회사코드는 폴더 이름이 되므로 영문·숫자·하이픈만 씁니다.";
        msg.style.color = "var(--rose-t)";
        return;
      }
      bar.dataset.formOpen = "0";
      S.saveEngagement(data);
    });
    row.appendChild(save);

    var dl = el("button", "mini-btn", "meta.json 내려받기");
    dl.type = "button";
    dl.addEventListener("click", function () {
      var cur = S.current();
      if (!cur) return;
      download(JSON.stringify(stripId(cur), null, 2), "meta.json", "application/json");
    });
    if (meta) row.appendChild(dl);

    if (meta) {
      var close = el("button", "mini-btn", "닫기");
      close.type = "button";
      close.addEventListener("click", function () { bar.dataset.formOpen = "0"; f.remove(); });
      row.appendChild(close);
    }
    f.appendChild(row);
    bar.appendChild(f);
  }

  function stripId(o) { var c = Object.assign({}, o); delete c.id; return c; }

  /* ══ 서브탭 ═══════════════════════════════════════════ */
  function renderSubtabs() {
    var bar = $("subtabs");
    bar.innerHTML = "";
    TABS.forEach(function (t) {
      var b = el("button", "subtab" + (t.id === activeTab ? " active" : "") + (t.locked ? " locked" : ""));
      b.type = "button";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", t.id === activeTab ? "true" : "false");
      b.innerHTML = '<span class="subtab-n">' + t.num + "</span>"
        + esc(t.name);
      b.addEventListener("click", function () {
        activeTab = t.id;
        renderSubtabs();
        renderWorksheetBar();      // 탭마다 보일지 말지가 다르다
        renderPanel();
      });
      bar.appendChild(b);
    });
  }

  /* ══ 정산표 상태 표시줄 (모든 탭 공통) ════════════════ */
  function renderWorksheetBar() {
    var bar = $("ws-bar");
    var ws = S.getState().worksheet;
    bar.innerHTML = "";
    if (activeTab === "hub") return;      // 도구 모음에는 정산표 상태가 필요 없다
    var box = el("div", "wsbar" + (ws ? "" : " none"));

    if (ws) {
      var n = ws.accounts.length;
      box.innerHTML =
        '<div class="wsbar-l">' +
          '<span class="wsbar-tag">사용 중인 정산표</span>' +
          "<b>" + esc(ws.meta.회사명 || ws.meta.회사코드) + "</b>" +
          '<span class="wsbar-s">' + esc(ws.meta.결산일) + "</span>" +
          '<span class="wsbar-s">계정 ' + n + "개</span>" +
          '<span class="wsbar-s">갱신 ' + esc(fmtTime(ws.updated_at)) + "</span>" +
        "</div>";
    } else {
      box.innerHTML = '<div class="wsbar-l"><span class="wsbar-tag off">정산표 없음</span>'
        + '<span class="wsbar-s">탭1에서 작성하거나 worksheet.json을 불러오세요</span></div>';
    }

    var right = el("div", "wsbar-r");
    var load = el("button", "mini-btn", "정산표 불러오기");
    load.type = "button";
    load.addEventListener("click", pickWorksheetFile);
    right.appendChild(load);
    box.appendChild(right);
    bar.appendChild(box);
  }

  function fmtTime(iso) {
    if (!iso) return "-";
    var d = new Date(iso);
    return isNaN(d) ? String(iso) : d.toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
  }

  function pickWorksheetFile() {
    var i = document.createElement("input");
    i.type = "file";
    i.accept = ".json,application/json";
    i.addEventListener("change", function () {
      var f = i.files && i.files[0];
      if (!f) return;
      f.text().then(function (txt) {
        var obj;
        try { obj = JSON.parse(txt); } catch (e) { alert("JSON을 읽지 못했습니다: " + e.message); return; }
        var err = WS.validateShape(obj);
        if (err) { alert("정산표 파일이 아닙니다 — " + err); return; }
        // 불러온 정산표의 분개·증감사유는 이어서 쓸 수 있게 복원한다.
        // 원본 PBC 는 파일에 없으므로 xlsx 를 다시 만들려면 엑셀을 다시 올려야 한다.
        t1.adjustments = (obj.adjustments || []).slice();
        t1.reasons = {};
        (obj.accounts || []).forEach(function (a) {
          if (a.증감사유) t1.reasons[a.코드] = { text: a.증감사유, draft: true };
        });
        S.importWorksheet(obj).then(renderAll);
      });
    });
    i.click();
  }

  /* ══ 도구 모음 ════════════════════════════════════════ */
  function renderHub(p) {
    if (!window.AuditHub) {
      p.innerHTML = '<div class="empty">도구 목록을 불러오지 못했습니다 '
        + "(src/audit/hub.js).</div>";
      return;
    }
    window.AuditHub.render(p, function (id) {
      activeTab = id;
      renderSubtabs();
      renderWorksheetBar();
      renderPanel();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  /* ══ 패널 ═════════════════════════════════════════════ */
  function renderPanel() {
    var p = $("sub-panel");
    p.innerHTML = "";
    var tab = TABS.find(function (t) { return t.id === activeTab; });
    if (tab.id === "hub") return renderHub(p);
    if (!tab.locked) return renderTab1(p);

    var ws = S.getState().worksheet;
    if (!ws) {
      var guard = el("div", "guard");
      guard.innerHTML = "<b>먼저 정산표를 작성하거나 불러오세요.</b>"
        + "<p>탭2~5는 탭1에서 만든 정산표를 그대로 씁니다. 여기에 따로 파일을 올리지 않습니다.</p>";
      var go = el("button", "copy-btn", "탭1 정산표 작성으로 이동");
      go.type = "button";
      go.addEventListener("click", function () { activeTab = "ws"; renderSubtabs(); renderPanel(); window.scrollTo({ top: 0, behavior: "smooth" }); });
      guard.appendChild(go);
      p.appendChild(guard);
    }

    var lock = el("div", "lockcard");
    lock.innerHTML = '<div class="lock-ico"></div>'
      + "<b>" + esc(tab.name) + " — 준비 중</b>"
      + "<p>골격만 잡아둔 자리입니다. 이 탭은 업로드 없이 위의 정산표를 그대로 받아 씁니다.</p>";
    p.appendChild(lock);
  }

  /* ══ 탭1 : 정산표 작성 ════════════════════════════════ */
  /*
   * 흐름: 파일 → 표준COA 매핑 → 수정분개 → 미리보기 → 증감사유 초안 → 생성
   * 미리보기 숫자는 화면·강조 판단용일 뿐이고, xlsx 에는 SUMIFS 수식이 들어간다.
   */
  function renderTab1(p) {
    var cur = S.current();
    if (!cur) {
      p.appendChild(hint("engagement를 먼저 등록하세요. 위 드롭다운에서 “+ 새 engagement”를 고르면 됩니다."));
      return;
    }
    // engagement 가 바뀌면 작업 상태를 반드시 비운다.
    // 새 engagement 를 만드는 경로에서는 드롭다운 핸들러를 타지 않으므로
    // 여기서 잡지 않으면 앞 회사의 파일이 그대로 남아 남의 자료가 섞인다.
    var engId = S.getState().currentId;
    if (t1._engId !== engId) {
      var keepCoa = t1.coa;
      t1 = newT1();
      t1.coa = keepCoa;          // 표준 COA 는 회사와 무관한 공용 자료
      t1._engId = engId;
    }

    if (!t1.coa) { ensureCoa(); p.appendChild(hint("표준 COA를 불러오는 중입니다…")); return; }
    if (!t1._restored) { restoreSources(); p.appendChild(hint("이어서 할 작업이 있는지 확인하는 중입니다…")); return; }

    p.appendChild(step(1, "파일 올리기",
      "회사 원본 엑셀을 그대로 올립니다. 시트·컬럼 구조는 회사마다 다르므로 아래에서 직접 지정합니다. "
      + "파일은 브라우저 안에서만 처리되고 서버로 가지 않습니다."));
    p.appendChild(keepBar());
    var up = el("div", "up-grid");
    up.appendChild(uploader("current", "당기 시산표 (또는 계정별 잔액)"));
    up.appendChild(uploader("prior", "전기 재무제표"));
    p.appendChild(up);

    if (!ready("current") || !ready("prior")) {
      p.appendChild(hint("두 파일의 계정코드·계정과목명·금액 컬럼을 모두 지정하면 다음 단계가 열립니다."));
      return;
    }

    p.appendChild(step(2, "표준 COA 매핑",
      "회사 계정과목을 표준 계정과목에 붙입니다. 유사도로 후보를 제안하지만 확정은 직접 하셔야 합니다. "
      + "미매핑이 하나라도 남으면 정산표를 만들 수 없습니다."));
    p.appendChild(coaMapper());

    if (!t1.mapRows || COA.unmapped(t1.mapRows).length) return;

    p.appendChild(step(3, "수정·재분류분개",
      "차변/대변에는 표준 COA 코드를 넣습니다. 한쪽만 채우면 복합분개로 보고 번호별로 차대를 검증합니다."));
    p.appendChild(adjustEditor());

    p.appendChild(step(4, "정산표 미리보기",
      "아래 숫자는 확인용입니다. 실제 xlsx 에는 PBC 시트를 참조하는 SUMIFS 수식이 들어갑니다."));
    p.appendChild(previewTable());

    p.appendChild(step(5, "증감사유 초안",
      "중요성금액 이상 변동한 계정만 audit-fs-analyzer 에 맡깁니다. 초안은 확정 결론이 아니라 확인할 질문입니다."));
    p.appendChild(reasonBlock());

    p.appendChild(step(6, "검증과 생성", "차대가 맞지 않으면 생성이 막힙니다."));
    p.appendChild(saveBlock());
  }

  function ready(slot) {
    var st = t1[slot];
    return st && st.accounts && st.accounts.length;
  }

  function step(n, title, desc) {
    var d = el("div", "wstep");
    d.innerHTML = '<div class="wstep-h"><span class="wstep-n">' + n + "</span><b>"
      + esc(title) + "</b></div>" + (desc ? '<p class="cap">' + esc(desc) + "</p>" : "");
    return d;
  }

  function hint(text) { return el("div", "empty", esc(text)); }

  /* ── 표준 COA ──────────────────────────────────────── */
  function ensureCoa() {
    if (t1._coaLoading) return;
    t1._coaLoading = true;
    fetch("config/standard-coa.json", { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (doc) {
        var err = COA.validateCoaShape(doc);
        if (err) throw new Error(err);
        t1.coa = COA.sortCoa(doc.accounts);
        renderPanel();
      })
      .catch(function (e) {
        t1._coaLoading = false;
        var p = $("sub-panel");
        p.innerHTML = "";
        p.appendChild(hint("표준 COA를 불러오지 못했습니다 — " + e.message
          + " (config/standard-coa.json)"));
      });
  }

  /* ── 이어서 작업 : 보관본 복원 · 저장 ──────────────── */
  /*
   * 새로고침하거나 다른 engagement를 다녀와도 이어서 하도록,
   * 업로드한 원본의 파싱 결과와 매핑·분개·증감사유를 engagement 단위로 남긴다.
   * 워크북 객체(wb)는 저장하지 않는다 — 크고 직렬화도 안 된다.
   * 대신 시트 목록만 남겨두고, 시트를 바꾸려면 파일을 다시 올리게 한다.
   */
  function restoreSources() {
    if (t1._restoring) return;
    t1._restoring = true;

    S.loadSources().then(function (rec) {
      if (rec) {
        ["current", "prior"].forEach(function (slot) {
          var s = rec[slot];
          if (!s || !s.aoa) return;
          t1[slot] = {
            fileName: s.fileName, sheetName: s.sheetName, sheetNames: s.sheetNames || [],
            aoa: s.aoa, headerRow: s.headerRow, mapping: s.mapping || {},
            amountMode: s.amountMode || "single", wb: null, restored: true,
          };
          remap(slot);
        });
        if (rec.mapRows) t1.mapRows = rec.mapRows;
        if (rec.prevMap) t1.prevMap = rec.prevMap;
        if (rec.adjustments) t1.adjustments = rec.adjustments;
        if (rec.reasons) t1.reasons = rec.reasons;
      }

      // 보관본에 분개가 없으면 저장된 정산표에서라도 살려낸다
      var ws = S.getState().worksheet;
      if (ws && !t1.adjustments.length) {
        t1.adjustments = (ws.adjustments || []).slice();
        if (!Object.keys(t1.reasons).length) {
          (ws.accounts || []).forEach(function (a) {
            if (a.증감사유) t1.reasons[a.코드] = { text: a.증감사유, draft: true };
          });
        }
      }

      t1._restored = true;
      t1._restoring = false;
      renderPanel();
    });
  }

  var persistTimer = null;
  function persist() {
    clearTimeout(persistTimer);
    // 저장 대상 engagement 를 예약 시점에 고정한다.
    // 디바운스 도중 engagement 를 바꾸면 남의 폴더에 저장될 수 있다.
    var forId = S.getState().currentId;
    persistTimer = setTimeout(function () {
      function slim(st) {
        if (!st || !st.aoa) return null;
        return {
          fileName: st.fileName, sheetName: st.sheetName,
          sheetNames: st.sheetNames || (st.wb ? st.wb.SheetNames : []),
          aoa: st.aoa, headerRow: st.headerRow,
          mapping: st.mapping, amountMode: st.amountMode,
        };
      }
      S.saveSources({
        current: slim(t1.current), prior: slim(t1.prior),
        mapRows: t1.mapRows, prevMap: t1.prevMap,
        adjustments: t1.adjustments, reasons: t1.reasons,
      }, forId);
    }, 400);
  }

  /** 1단계 위에 붙는 보관 스위치 */
  function keepBar() {
    var box = el("div", "keepbar");
    var on = S.keepSources();

    var lab = el("label", "pub-check");
    var cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = on;
    cb.addEventListener("change", function () {
      S.setKeepSources(cb.checked).then(function () {
        if (!cb.checked) { t1._restored = true; }
        renderPanel();
      });
      if (cb.checked) persist();
    });
    lab.appendChild(cb);
    lab.appendChild(document.createTextNode("이 브라우저에 작업 내용 보관"));
    box.appendChild(lab);

    var note = el("span", "cap");
    note.style.margin = "0";
    note.textContent = on
      ? "올린 시산표·재무제표와 매핑·분개가 이 브라우저에 남아, 새로고침해도 이어서 작업할 수 있습니다."
      : "보관을 껐습니다. 새로고침하면 올린 파일과 입력한 분개가 사라집니다.";
    box.appendChild(note);

    if (on) {
      var del = el("button", "mini-btn", "보관본 지우기");
      del.type = "button";
      del.addEventListener("click", function () {
        var coa = t1.coa;
        S.clearAllSources().then(function () {
          t1 = newT1();
          t1.coa = coa;          // 표준 COA는 공용 자료라 다시 받을 필요 없다
          t1._restored = true;
          renderPanel();
        });
      });
      box.appendChild(del);

      S.sourcesInfo().then(function (info) {
        if (!info.count) return;
        var kb = Math.round(info.bytes / 1024);
        note.textContent += "  (현재 " + info.count + "건 · 약 "
          + (kb > 1024 ? (kb / 1024).toFixed(1) + "MB" : kb + "KB") + ")";
      });
    }
    return box;
  }

  /* ── 업로더 : 계정코드 / 계정과목명 / 금액 ─────────── */
  function uploader(slot, title) {
    var box = el("div", "upbox");
    var st = t1[slot];
    box.appendChild(el("div", "upbox-t", esc(title)));

    var inp = document.createElement("input");
    inp.type = "file";
    inp.accept = ".xlsx,.xls,.xlsm,.csv";
    inp.className = "upfile";
    inp.addEventListener("change", function () {
      var f = inp.files && inp.files[0];
      if (!f) return;
      readWorkbook(f).then(function (wb) {
        t1[slot] = { fileName: f.name, wb: wb, sheetName: wb.SheetNames[0],
                     sheetNames: wb.SheetNames, amountMode: "single" };
        loadSheet(slot);
        t1.mapRows = null;              // 원본이 바뀌면 매핑을 다시 확인한다
        persist();
        renderPanel();
      }).catch(function (e) { alert("파일을 읽지 못했습니다 — " + e.message); });
    });
    box.appendChild(inp);
    if (!st) return box;

    box.appendChild(el("div", "cap", esc(st.fileName)
      + (st.restored ? "  · 보관본에서 이어받음" : "")));

    var sheetNames = st.sheetNames || (st.wb ? st.wb.SheetNames : []);
    if (st.wb && sheetNames.length > 1) {
      box.appendChild(labelled("시트", selectOf(sheetNames, st.sheetName, function (v) {
        st.sheetName = v; loadSheet(slot); t1.mapRows = null; persist(); renderPanel();
      })));
    } else if (!st.wb && sheetNames.length > 1) {
      // 보관본에서 되살린 상태 — 시트를 바꾸려면 파일을 다시 올려야 한다
      box.appendChild(el("p", "cap", "시트: " + esc(st.sheetName)
        + " (다른 시트를 쓰려면 파일을 다시 올리세요)"));
    }

    var hrow = document.createElement("input");
    hrow.type = "number";
    hrow.min = "1";
    hrow.value = String((st.headerRow || 0) + 1);
    hrow.addEventListener("change", function () {
      st.headerRow = Math.max(0, Number(hrow.value) - 1);
      st.mapping = WS.guessColumns(st.aoa[st.headerRow] || []);
      remap(slot); t1.mapRows = null; persist(); renderPanel();
    });
    box.appendChild(labelled("머리글 행", hrow));

    box.appendChild(labelled("금액 서식", selectOf(
      [["single", "금액 한 컬럼"], ["drcr", "차변·대변 두 컬럼"]], st.amountMode, function (v) {
        st.amountMode = v; remap(slot); t1.mapRows = null; persist(); renderPanel();
      })));

    var headers = (st.aoa[st.headerRow] || []).map(function (h, i) {
      return [String(i), (h === null || h === undefined || String(h).trim() === "")
        ? "(" + colName(i) + "열)" : String(h)];
    });
    var need = neededCols(st);
    var grid = el("div", "map-grid");
    need.forEach(function (field) {
      var val = st.mapping[field];
      grid.appendChild(labelled(field, selectOf(
        [["", "(없음)"]].concat(headers),
        val === undefined ? "" : String(val),
        function (v) {
          if (v === "") delete st.mapping[field]; else st.mapping[field] = Number(v);
          remap(slot); t1.mapRows = null; persist(); renderPanel();
        })));
    });
    box.appendChild(grid);

    var missing = need.filter(function (f) { return st.mapping[f] === undefined; });
    if (missing.length) box.appendChild(el("p", "cap err", "지정이 필요한 컬럼: " + missing.join(", ")));
    else box.appendChild(el("p", "cap ok", "계정 " + st.accounts.length + "개 인식"));
    return box;
  }

  function neededCols(st) {
    return ["계정코드", "계정과목"].concat(st.amountMode === "drcr" ? ["차변", "대변"] : ["금액"]);
  }
  function colName(i) { return WSExport.colLetter(i); }

  function labelled(name, node) {
    var w = el("label", "fcard-field");
    w.appendChild(el("span", null, esc(name)));
    w.appendChild(node);
    return w;
  }

  function selectOf(items, value, onChange) {
    var s = document.createElement("select");
    items.forEach(function (it) {
      var v = Array.isArray(it) ? it[0] : it;
      var t = Array.isArray(it) ? it[1] : it;
      var o = new Option(t, v);
      if (String(v) === String(value)) o.selected = true;
      s.appendChild(o);
    });
    s.addEventListener("change", function () { onChange(s.value); });
    return s;
  }

  function readWorkbook(file) {
    return file.arrayBuffer().then(function (buf) {
      return XLSX.read(new Uint8Array(buf), { type: "array", cellDates: false });
    });
  }

  function loadSheet(slot) {
    var st = t1[slot];
    var sheet = st.wb.Sheets[st.sheetName];
    st.aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null, blankrows: true });
    var h = WS.findHeaderRow(st.aoa);
    st.headerRow = h >= 0 ? h : 0;
    st.mapping = WS.guessColumns(st.aoa[st.headerRow] || []);
    if (st.mapping["차변"] !== undefined && st.mapping["대변"] !== undefined) st.amountMode = "drcr";
    remap(slot);
  }

  function remap(slot) {
    var st = t1[slot];
    if (!st || !st.aoa) return;
    if (neededCols(st).some(function (f) { return st.mapping[f] === undefined; })) {
      st.accounts = null; return;
    }
    st.accounts = WS.extractAccounts(st.aoa, st.headerRow, st.mapping, st.amountMode);
  }

  /* ── COA 매핑 화면 ─────────────────────────────────── */
  function buildMapRows() {
    // 당기·전기 양쪽의 회사 계정을 한 목록으로 모은다
    var seen = new Map();
    [t1.current, t1.prior].forEach(function (st) {
      (st.accounts || []).forEach(function (a) {
        var k = String(a.코드 || "").trim() + "|" + COA.norm(a.계정과목);
        if (!seen.has(k)) seen.set(k, { 코드: a.코드, 계정과목: a.계정과목 });
      });
    });
    t1.mapRows = COA.applyMap(Array.from(seen.values()), t1.prevMap || COA.emptyMap(""));
  }

  function coaMapper() {
    // 이전 기수 매핑을 먼저 찾아본다 (config/coa-map/<회사코드>.json → 브라우저 보관본)
    if (!t1.mapRows && !t1._mapLoading && t1.prevMap === null) {
      t1._mapLoading = true;
      var code = (S.current() || {}).회사코드;
      S.loadCoaMap(code).then(function (m) {
        t1._mapLoading = false;
        t1.prevMap = m && !COA.validateMapShape(m) ? m : COA.emptyMap(code);
        buildMapRows();
        renderPanel();
      });
      var box0 = el("div", "adjbox");
      box0.appendChild(el("p", "cap", "저장된 매핑을 찾는 중입니다…"));
      return box0;
    }
    if (!t1.mapRows) buildMapRows();
    var box = el("div", "adjbox");
    var un = COA.unmapped(t1.mapRows);

    var bar = el("div", "msum-row");
    bar.innerHTML = '<span class="msum-k">회사 계정</span><b>' + t1.mapRows.length + "개</b>"
      + '<span class="msum-k">매핑 완료</span><b>' + (t1.mapRows.length - un.length) + "개</b>"
      + '<span class="msum-k">미매핑</span><b class="' + (un.length ? "warn" : "") + '">'
      + un.length + "개</b>";
    box.appendChild(bar);

    var acts = el("div", "save-actions");
    var load = el("button", "mini-btn", "저장된 매핑 불러오기");
    load.type = "button";
    load.addEventListener("click", pickMapFile);
    acts.appendChild(load);

    var save = el("button", "mini-btn", "매핑 저장 (내려받기)");
    save.type = "button";
    save.addEventListener("click", function () {
      var cur = S.current();
      var m = COA.buildMap(cur.회사코드, t1.mapRows, t1.prevMap);
      t1.prevMap = m;
      S.saveCoaMap(cur.회사코드, m);
      download(JSON.stringify(m, null, 2), safeName(cur.회사코드) + ".json", "application/json");
    });
    acts.appendChild(save);

    var only = el("label", "pub-check");
    var cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = t1.showUnmappedOnly !== false;
    cb.addEventListener("change", function () { t1.showUnmappedOnly = cb.checked; renderPanel(); });
    only.appendChild(cb);
    only.appendChild(document.createTextNode("미매핑만 보기"));
    acts.appendChild(only);
    box.appendChild(acts);

    if (un.length) {
      box.appendChild(el("p", "cap err",
        "미매핑 " + un.length + "개가 남아 있어 정산표를 만들 수 없습니다. 모두 지정해 주세요."));
    } else {
      box.appendChild(el("p", "cap ok", "모든 계정이 표준 COA에 연결되었습니다."));
    }

    var showOnly = t1.showUnmappedOnly !== false;
    var list = showOnly ? un : t1.mapRows;

    var wrap = el("div", "tbl-wrap");
    wrap.style.maxHeight = "420px";
    wrap.style.overflow = "auto";
    var table = document.createElement("table");
    table.className = "adjtable";
    table.innerHTML = "<tr><th>회사 코드</th><th>회사 계정과목명</th><th>표준 COA</th><th>상태</th></tr>";

    list.forEach(function (r) {
      var tr = document.createElement("tr");
      tr.appendChild(td(esc(r.회사계정코드), "k"));
      tr.appendChild(td(esc(r.회사계정과목명)));

      var pick = document.createElement("td");
      pick.appendChild(coaSelect(r));
      tr.appendChild(pick);

      var stTd = document.createElement("td");
      stTd.innerHTML = r.표준COA코드
        ? '<span class="tag on">' + (r.출처 === "저장" ? "이전 기수" : "확정") + "</span>"
        : '<span class="tag" style="background:var(--rose);color:var(--rose-t)">확인 필요</span>';
      tr.appendChild(stTd);
      table.appendChild(tr);
    });
    wrap.appendChild(table);
    box.appendChild(wrap);

    if (showOnly && !un.length) {
      box.appendChild(el("p", "cap", "미매핑이 없습니다. 전체를 보려면 위 체크를 해제하세요."));
    }
    return box;
  }

  function td(html, cls) {
    var d = document.createElement("td");
    if (cls) d.className = cls;
    d.innerHTML = html;
    return d;
  }

  /** 후보 상위 5개를 먼저, 그 아래 전체 목록. 자동 확정은 하지 않는다. */
  function coaSelect(row) {
    var s = document.createElement("select");
    s.appendChild(new Option("— 선택하세요 —", ""));

    var sug = COA.suggest(row.회사계정과목명, t1.coa, 5);
    var g1 = document.createElement("optgroup");
    g1.label = "추천 후보";
    sug.forEach(function (c) {
      g1.appendChild(new Option(
        c.표준계정과목명 + " (" + c.코드 + ") · " + Math.round(c.score * 100) + "%", c.코드));
    });
    s.appendChild(g1);

    var g2 = document.createElement("optgroup");
    g2.label = "전체 표준 COA";
    t1.coa.forEach(function (c) {
      g2.appendChild(new Option(c.표준계정과목명 + " (" + c.코드 + ")", c.코드));
    });
    s.appendChild(g2);

    s.value = row.표준COA코드 || "";
    s.addEventListener("change", function () {
      row.표준COA코드 = s.value;
      row.출처 = s.value ? "확정" : "";
      persist();
      renderPanel();
    });
    return s;
  }

  function pickMapFile() {
    var i = document.createElement("input");
    i.type = "file";
    i.accept = ".json,application/json";
    i.addEventListener("change", function () {
      var f = i.files && i.files[0];
      if (!f) return;
      f.text().then(function (txt) {
        var obj;
        try { obj = JSON.parse(txt); } catch (e) { alert("JSON을 읽지 못했습니다: " + e.message); return; }
        var err = COA.validateMapShape(obj);
        if (err) { alert("매핑 파일이 아닙니다 — " + err); return; }
        t1.prevMap = obj;
        buildMapRows();
        persist();
        renderPanel();
      });
    });
    i.click();
  }

  /* ── 수정·재분류분개 ───────────────────────────────── */
  function adjustEditor() {
    var box = el("div", "adjbox");
    var wrap = el("div", "tbl-wrap");
    var table = document.createElement("table");
    table.className = "adjtable";
    table.innerHTML = "<tr><th>번호</th><th>구분</th><th>차변코드</th><th>대변코드</th>"
      + "<th>금액</th><th>적요</th><th>조서참조</th><th></th></tr>";

    t1.adjustments.forEach(function (j, idx) {
      var tr = document.createElement("tr");
      tr.appendChild(cellInput(j, "번호", "text", "1"));
      var g = document.createElement("td");
      g.appendChild(selectOf([["수정", "수정"], ["재분류", "재분류"]], j.구분 || "수정", function (v) {
        j.구분 = v; persist(); refreshCalc();
      }));
      tr.appendChild(g);
      tr.appendChild(cellInput(j, "차변계정", "text", "6350"));
      tr.appendChild(cellInput(j, "대변계정", "text", "2100"));
      tr.appendChild(cellInput(j, "금액", "number", "0"));
      tr.appendChild(cellInput(j, "적요", "text", ""));
      tr.appendChild(cellInput(j, "조서참조", "text", "A-01"));

      var del = document.createElement("td");
      var b = el("button", "mini-btn", "삭제");
      b.type = "button";
      b.addEventListener("click", function () { t1.adjustments.splice(idx, 1); persist(); renderPanel(); });
      del.appendChild(b);
      tr.appendChild(del);
      table.appendChild(tr);
    });
    wrap.appendChild(table);
    box.appendChild(wrap);

    var add = el("button", "mini-btn", "+ 분개 추가");
    add.type = "button";
    add.style.marginTop = "10px";
    add.addEventListener("click", function () {
      t1.adjustments.push({ 번호: String(t1.adjustments.length + 1), 구분: "수정",
        차변계정: "", 대변계정: "", 금액: 0, 적요: "", 조서참조: "" });
      persist();
      renderPanel();
    });
    box.appendChild(add);
    return box;
  }

  function cellInput(obj, key, type, ph) {
    var d = document.createElement("td");
    var i = document.createElement("input");
    i.type = type;
    i.placeholder = ph;
    i.value = obj[key] === undefined || obj[key] === null ? "" : obj[key];
    i.addEventListener("input", function () {
      obj[key] = type === "number" ? WS.toNumber(i.value) : i.value;
      persist();
      refreshCalc();
    });
    d.appendChild(i);
    return d;
  }

  function refreshCalc() {
    var host = document.querySelector("#sub-panel .wstable-host");
    var sav = document.querySelector("#sub-panel .savehost");
    if (host) { host.innerHTML = ""; host.appendChild(previewTableInner()); }
    if (sav) { sav.innerHTML = ""; sav.appendChild(saveBlockInner()); }
  }

  /* ── 계산 ──────────────────────────────────────────── */
  function computeRows() {
    var curSums = WS.aggregateByCoa(t1.current.accounts, t1.mapRows);
    var priorSums = WS.aggregateByCoa(t1.prior.accounts, t1.mapRows);
    return WS.buildRows(t1.coa, curSums, priorSums, t1.adjustments);
  }

  function previewTable() {
    var host = el("div", "wstable-host");
    host.appendChild(previewTableInner());
    return host;
  }

  function previewTableInner() {
    var rows = computeRows();
    t1.rows = rows;
    var cur = S.current();
    var material = Math.abs(Number(cur.중요성금액) || 0);

    var wrap = el("div", "tbl-wrap");
    wrap.style.maxHeight = "440px";
    wrap.style.overflow = "auto";
    var out = ["<tr><th>COA</th><th>계정과목명</th><th>전기</th><th>당기</th><th>수정분개</th>"
      + "<th>수정후</th><th>증감액</th><th>증감비율</th><th>증감사유</th></tr>"];

    function line(r) {
      var big = material && Math.abs(r.증감액) >= material;
      var reason = t1.reasons[r.코드];
      out.push("<tr" + (big ? ' class="flag"' : "") + ">"
        + "<td class='k'>" + esc(r.코드) + "</td>"
        + "<td>" + esc(r.계정과목명) + "</td>"
        + "<td class='n'>" + num(r.전기) + "</td>"
        + "<td class='n'>" + num(r.당기) + "</td>"
        + "<td class='n'>" + (r.수정분개 ? num(r.수정분개) : "-") + "</td>"
        + "<td class='n'>" + num(r.수정후) + "</td>"
        + "<td class='n'>" + num(r.증감액) + "</td>"
        + "<td class='n'>" + (r.증감비율 === null ? "" : (r.증감비율 * 100).toFixed(1) + "%") + "</td>"
        + "<td style='white-space:normal;max-width:280px'>"
        + (reason ? "<span class='tag' style='background:var(--indigo-l);color:var(--indigo-d)'>초안</span> "
          + esc(reason.text) : "") + "</td></tr>");
    }
    function subtotal(label, list) {
      if (!list.length) return;
      function s(k) { return list.reduce(function (a, r) { return a + r[k]; }, 0); }
      out.push("<tr class='sum'><td></td><td>" + label + "</td>"
        + "<td class='n'>" + num(s("전기")) + "</td><td class='n'>" + num(s("당기")) + "</td>"
        + "<td class='n'>" + num(s("수정분개")) + "</td><td class='n'>" + num(s("수정후")) + "</td>"
        + "<td class='n'>" + num(s("증감액")) + "</td><td></td><td></td></tr>");
    }
    var bs = rows.filter(function (r) { return r.구분 !== "PL"; });
    var pl = rows.filter(function (r) { return r.구분 === "PL"; });
    bs.forEach(line); subtotal("BS 소계", bs);
    pl.forEach(line); subtotal("PL 소계", pl);

    var table = document.createElement("table");
    table.innerHTML = out.join("");
    wrap.appendChild(table);

    var box = el("div");
    box.appendChild(wrap);
    box.appendChild(el("p", "cap", "계정 " + rows.length + "개 · 노란 행은 증감액이 중요성금액("
      + num(material) + ") 이상입니다. 대변 항목은 음수로 표시됩니다."));
    return box;
  }

  /* ── 증감사유 초안 ─────────────────────────────────── */
  function reasonBlock() {
    var box = el("div", "adjbox");
    var cur = S.current();
    var rows = t1.rows || computeRows();
    var material = WS.materialRows(rows, cur.중요성금액);

    if (!material.length) {
      box.appendChild(el("p", "cap", "중요성금액("
        + num(Number(cur.중요성금액) || 0) + ") 이상 변동한 계정이 없습니다. 증감사유는 비워 둡니다."));
      return box;
    }

    box.appendChild(el("p", "cap", "대상 " + material.length + "개 계정 · "
      + "아래 프롬프트를 복사해 audit-fs-analyzer 에 넘기고, 돌아온 JSON을 붙여넣으세요."));

    var acts = el("div", "save-actions");
    acts.appendChild(copyButton("프롬프트 복사", function () {
      return WS.reasonPrompt(rows, cur.중요성금액);
    }));
    var badge = el("span", "agent-badge", " audit-fs-analyzer");
    acts.appendChild(badge);
    box.appendChild(acts);

    var ta = document.createElement("textarea");
    ta.className = "reason-in";
    ta.rows = 4;
    ta.placeholder = '{"1200":"매출채권이 … 확인할 것.", "1400":"…"}';
    box.appendChild(ta);

    var msg = el("p", "cap");
    var apply = el("button", "mini-btn", "초안 반영");
    apply.type = "button";
    apply.addEventListener("click", function () {
      var r = WS.parseReasons(ta.value, rows);
      if (r.error) { msg.className = "cap err"; msg.textContent = r.error; return; }
      t1.reasons = Object.assign({}, t1.reasons, r.reasons);
      persist();
      msg.className = "cap ok";
      msg.textContent = r.count + "개 반영했습니다."
        + (r.unknown.length ? "정산표에 없는 코드 " + r.unknown.length + "개는 버렸습니다." : "");
      renderPanel();
    });
    var act2 = el("div", "save-actions");
    act2.appendChild(apply);
    if (Object.keys(t1.reasons).length) {
      var clr = el("button", "mini-btn", "초안 지우기");
      clr.type = "button";
      clr.addEventListener("click", function () { t1.reasons = {}; persist(); renderPanel(); });
      act2.appendChild(clr);
      act2.appendChild(el("span", "cap", Object.keys(t1.reasons).length + "개 초안 보관 중"));
    }
    box.appendChild(act2);
    box.appendChild(msg);
    return box;
  }

  function copyButton(label, getText) {
    var b = el("button", "copy-btn", label);
    b.type = "button";
    b.addEventListener("click", function () {
      var text = getText();
      var done = function () {
        var old = b.textContent;
        b.textContent = "복사됨 ✓";
        setTimeout(function () { b.textContent = old; }, 1500);
      };
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
      } else { fallbackCopy(text); done(); }
    });
    return b;
  }

  function fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch (e) {}
    document.body.removeChild(ta);
  }

  /* ── 검증·생성 ─────────────────────────────────────── */
  function saveBlock() {
    var host = el("div", "savehost");
    host.appendChild(saveBlockInner());
    return host;
  }

  function saveBlockInner() {
    var rows = t1.rows || computeRows();
    var codes = rows.map(function (r) { return r.코드; });
    var vAdj = WS.verifyAdjustments(t1.adjustments, codes);
    var vBal = WS.verifyBalance(rows);
    var ok = vAdj.ok && vBal.ok;

    var box = el("div");
    var card = el("div", "verify " + (ok ? "good" : "bad"));
    card.innerHTML = "<b>" + (ok ? "차대가 맞습니다. 정산표를 만들 수 있습니다."
      : "차대가 맞지 않아 만들 수 없습니다.") + "</b>";

    var ul = el("ul", "vlist");
    ul.appendChild(li("정산표 수정후 총합 (차대일치)", vBal.수정후, vBal.균형.차대일치));
    ul.appendChild(li("자산 - (부채+자본+당기순손익)", vBal.자산_부채자본_차이, vBal.균형.자산_부채자본));
    ul.appendChild(li("자산 합계", vBal.자산, true));
    ul.appendChild(li("당기순손익", vBal.당기순손익, true));
    if (t1.adjustments.length) {
      ul.appendChild(li("분개 차액 합계", vAdj.차액합계, Math.abs(vAdj.차액합계) < 0.5));
    }
    card.appendChild(ul);

    if (vAdj.errors.length) {
      var e = el("ul", "flagbox");
      vAdj.errors.slice(0, 20).forEach(function (t) { e.appendChild(el("li", null, esc(t))); });
      card.appendChild(e);
    }
    box.appendChild(card);

    var actions = el("div", "save-actions");
    var bXlsx = el("button", "copy-btn", "정산표 xlsx 만들기");
    bXlsx.type = "button";
    bXlsx.disabled = !ok;
    bXlsx.addEventListener("click", function () {
      bXlsx.disabled = true;
      var old = bXlsx.textContent;
      bXlsx.textContent = "만드는 중…";
      exportXlsx(rows, vBal).then(function () {
        bXlsx.textContent = old; bXlsx.disabled = false;
      }).catch(function (err) {
        alert("엑셀을 만들지 못했습니다 — " + err.message);
        bXlsx.textContent = old; bXlsx.disabled = false;
      });
    });
    actions.appendChild(bXlsx);

    var bJson = el("button", "mini-btn", "worksheet.json 저장");
    bJson.type = "button";
    bJson.disabled = !ok;
    bJson.addEventListener("click", function () {
      var cur = S.current();
      var ws = WS.build(stripId(cur), rows, t1.adjustments, t1.reasons);
      S.saveWorksheet(ws).then(function () {
        download(JSON.stringify(ws, null, 2), "worksheet.json", "application/json");
        renderAll();
      });
    });
    actions.appendChild(bJson);
    box.appendChild(actions);

    var cur = S.current();
    box.appendChild(el("p", "cap", "내려받은 파일은 " + esc(S.workPath(cur))
      + "에 넣어 두세요. 이 폴더는 .gitignore로 막혀 있어 저장소에 올라가지 않습니다."));
    box.appendChild(el("p", "cap", "정산표 시트의 전기·당기·수정분개·수정후·증감액·증감비율은 값이 아니라 "
      + "SUMIFS 수식입니다. PBC 시트나 수정분개 시트를 엑셀에서 고치면 정산표가 따라 갱신됩니다."));
    return box;
  }

  function li(name, value, ok) {
    var l = el("li", ok ? "" : "bad");
    l.innerHTML = "<span>" + esc(name) + "</span><b>" + num(value) + "</b>";
    return l;
  }

  /* ── xlsx 생성 ─────────────────────────────────────── */
  /** 원본 각 행에 붙일 표준COA코드 배열 (행 번호 → 코드) */
  function coaOfRows(st) {
    var byName = new Map(), byCode = new Map();
    t1.mapRows.forEach(function (m) {
      if (!m.표준COA코드) return;
      if (m.회사계정과목명) byName.set(COA.norm(m.회사계정과목명), m.표준COA코드);
      if (m.회사계정코드) byCode.set(String(m.회사계정코드).trim(), m.표준COA코드);
    });
    var out = [];
    for (var i = st.headerRow + 1; i < st.aoa.length; i++) {
      var row = st.aoa[i] || [];
      var code = String(row[st.mapping["계정코드"]] === undefined ? "" : row[st.mapping["계정코드"]]).trim();
      var name = String(row[st.mapping["계정과목"]] === undefined ? "" : row[st.mapping["계정과목"]]).trim();
      var coa = byCode.get(code);
      if (coa === undefined) coa = byName.get(COA.norm(name));
      out[i] = coa || "";
    }
    return out;
  }

  function amountCols(st) {
    return st.amountMode === "drcr"
      ? [st.mapping["차변"], st.mapping["대변"]]
      : [st.mapping["금액"]];
  }

  function exportXlsx(rows, vBal) {
    var cur = S.current();
    return WSExport.build({
      meta: stripId(cur),
      pbcCurrent: { aoa: t1.current.aoa, headerRow: t1.current.headerRow, amountCols: amountCols(t1.current) },
      pbcPrior: { aoa: t1.prior.aoa, headerRow: t1.prior.headerRow, amountCols: amountCols(t1.prior) },
      coaOfRow: { current: coaOfRows(t1.current), prior: coaOfRows(t1.prior) },
      adjustments: t1.adjustments,
      rows: rows,
      reasons: t1.reasons,
      checks: [],
    }).then(function (buf) {
      var name = safeName("FY" + String(cur.결산일).slice(2, 4) + "_"
        + (cur.회사코드 || "company") + "_worksheet") + ".xlsx";
      download(buf, name, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    });
  }


  /** 브라우저가 확실히 지켜주는 이름으로 (비ASCII·경로문자 제거) */
  function safeName(s) {
    var out = String(s).replace(/[^\x20-\x7E]/g, "").replace(/[\\/:*?"<>|]/g, "").trim();
    return out || "worksheet";
  }

  function download(data, filename, mime) {
    var blob = typeof data === "string"
      ? new Blob([data], { type: mime + ";charset=utf-8" })
      : new Blob([data], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
})();
