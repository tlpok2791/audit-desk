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
  ];

  var activeTab = "ws";
  var S = null;                  // AuditState
  var t1 = { prior: null, current: null, adjustments: [], merged: null, dirty: false };

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
      else { t1 = { prior: null, current: null, adjustments: [], merged: null, dirty: false }; S.setCurrent(sel.value); }
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
        + esc(t.name) + (t.locked ? ' <span class="lock">🔒</span>' : "");
      b.addEventListener("click", function () { activeTab = t.id; renderSubtabs(); renderPanel(); });
      bar.appendChild(b);
    });
  }

  /* ══ 정산표 상태 표시줄 (모든 탭 공통) ════════════════ */
  function renderWorksheetBar() {
    var bar = $("ws-bar");
    var ws = S.getState().worksheet;
    bar.innerHTML = "";
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
        t1.adjustments = (obj.adjustments || []).slice();
        t1.merged = { accounts: obj.accounts.slice(), unmatched: { priorOnly: [], currentOnly: [] } };
        S.importWorksheet(obj).then(renderAll);
      });
    });
    i.click();
  }

  /* ══ 패널 ═════════════════════════════════════════════ */
  function renderPanel() {
    var p = $("sub-panel");
    p.innerHTML = "";
    var tab = TABS.find(function (t) { return t.id === activeTab; });
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
    lock.innerHTML = '<div class="lock-ico">🔒</div>'
      + "<b>" + esc(tab.name) + " — 준비 중</b>"
      + "<p>골격만 잡아둔 자리입니다. 이 탭은 업로드 없이 위의 정산표를 그대로 받아 씁니다.</p>";
    p.appendChild(lock);
  }

  /* ══ 탭1 : 정산표 작성 ════════════════════════════════ */
  function renderTab1(p) {
    var cur = S.current();
    if (!cur) {
      p.appendChild(hint("engagement를 먼저 등록하세요. 위 드롭다운에서 “+ 새 engagement”를 고르면 됩니다."));
      return;
    }

    p.appendChild(step(1, "파일 올리기", "전기 재무제표와 당기 시산표를 올립니다. 파일은 브라우저 안에서만 처리되고 서버로 가지 않습니다."));
    var up = el("div", "up-grid");
    up.appendChild(uploader("prior", "전기 재무제표"));
    up.appendChild(uploader("current", "당기 시산표"));
    p.appendChild(up);

    if (!t1.prior || !t1.current) {
      p.appendChild(hint("두 파일을 모두 올리고 컬럼을 연결하면 정산표가 만들어집니다."));
      return;
    }
    if (!t1.prior.accounts || !t1.current.accounts) return;

    // 병합
    t1.merged = WS.mergeAccounts(t1.prior.accounts, t1.current.accounts);

    p.appendChild(step(2, "계정 매핑 결과", "계정코드를 기준으로 맞췄습니다. 한쪽에만 있는 계정은 아래에 따로 표시합니다."));
    p.appendChild(mappingSummary());

    p.appendChild(step(3, "수정·재분류분개", "차변/대변 계정코드와 금액을 넣습니다. 한쪽만 채우면 복합분개로 처리되며, 번호별로 차대가 맞아야 저장됩니다."));
    p.appendChild(adjustEditor());

    p.appendChild(step(4, "정산표", "전기말 · 당기말 수정전 · 수정분개 · 재분류 · 당기말 수정후. 대변 항목은 음수로 표시됩니다."));
    p.appendChild(worksheetTable());

    p.appendChild(step(5, "검증과 저장", "차대가 맞지 않으면 저장이 막힙니다."));
    p.appendChild(saveBlock());
  }

  function step(n, title, desc) {
    var d = el("div", "wstep");
    d.innerHTML = '<div class="wstep-h"><span class="wstep-n">' + n + "</span><b>" + esc(title) + "</b></div>"
      + (desc ? '<p class="cap">' + esc(desc) + "</p>" : "");
    return d;
  }
  function hint(text) { return el("div", "empty", esc(text)); }

  /* ── 업로더 ────────────────────────────────────────── */
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
        t1[slot] = { fileName: f.name, wb: wb, sheetName: wb.SheetNames[0], amountMode: "single" };
        loadSheet(slot);
        renderPanel();
      }).catch(function (e) { alert("파일을 읽지 못했습니다 — " + e.message); });
    });
    box.appendChild(inp);

    if (!st) return box;

    box.appendChild(el("div", "cap", esc(st.fileName)));

    // 시트 선택
    if (st.wb.SheetNames.length > 1) {
      box.appendChild(labelled("시트", selectOf(st.wb.SheetNames, st.sheetName, function (v) {
        st.sheetName = v; loadSheet(slot); renderPanel();
      })));
    }

    // 머리글 행
    var hrow = document.createElement("input");
    hrow.type = "number";
    hrow.min = "1";
    hrow.value = String((st.headerRow || 0) + 1);
    hrow.addEventListener("change", function () {
      st.headerRow = Math.max(0, Number(hrow.value) - 1);
      remap(slot); renderPanel();
    });
    box.appendChild(labelled("머리글 행", hrow));

    // 금액 서식
    box.appendChild(labelled("금액 서식", selectOf(
      [["single", "금액 한 컬럼"], ["drcr", "차변·대변 두 컬럼"]], st.amountMode, function (v) {
        st.amountMode = v; remap(slot); renderPanel();
      })));

    // 컬럼 연결
    var headers = (st.aoa[st.headerRow] || []).map(function (h, i) {
      return [String(i), (h === null || h === undefined || String(h).trim() === "") ? "(" + (i + 1) + "열)" : String(h)];
    });
    var need = ["계정코드", "계정과목"].concat(st.amountMode === "drcr" ? ["차변", "대변"] : ["금액"]);
    var grid = el("div", "map-grid");
    need.forEach(function (field) {
      var val = st.mapping[field];
      grid.appendChild(labelled(field, selectOf(
        [["", "(없음)"]].concat(headers),
        val === undefined ? "" : String(val),
        function (v) {
          if (v === "") delete st.mapping[field]; else st.mapping[field] = Number(v);
          remap(slot); renderPanel();
        })));
    });
    box.appendChild(grid);

    var missing = need.filter(function (f) { return st.mapping[f] === undefined; });
    if (missing.length) {
      box.appendChild(el("p", "cap err", "연결이 필요한 항목: " + missing.join(", ")));
    } else {
      box.appendChild(el("p", "cap ok", "계정 " + (st.accounts ? st.accounts.length : 0) + "개 인식"));
    }
    return box;
  }

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
    st.aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null, blankrows: false });
    var h = WS.findHeaderRow(st.aoa);
    st.headerRow = h >= 0 ? h : 0;
    st.mapping = WS.guessColumns(st.aoa[st.headerRow] || []);
    if (st.mapping["차변"] !== undefined && st.mapping["대변"] !== undefined) st.amountMode = "drcr";
    remap(slot);
  }

  function remap(slot) {
    var st = t1[slot];
    if (!st || !st.aoa) return;
    var need = ["계정코드", "계정과목"].concat(st.amountMode === "drcr" ? ["차변", "대변"] : ["금액"]);
    if (need.some(function (f) { return st.mapping[f] === undefined; })) { st.accounts = null; return; }
    st.accounts = WS.extractAccounts(st.aoa, st.headerRow, st.mapping, st.amountMode);
  }

  /* ── 매핑 요약 ─────────────────────────────────────── */
  function mappingSummary() {
    var m = t1.merged;
    var box = el("div", "mapsum");
    var po = m.unmatched.priorOnly, co = m.unmatched.currentOnly;
    box.innerHTML =
      '<div class="msum-row">' +
        '<span class="msum-k">병합된 계정</span><b>' + m.accounts.length + "개</b>" +
        '<span class="msum-k">전기에만</span><b class="' + (po.length ? "warn" : "") + '">' + po.length + "개</b>" +
        '<span class="msum-k">당기에만</span><b class="' + (co.length ? "warn" : "") + '">' + co.length + "개</b>" +
      "</div>";

    if (po.length || co.length) {
      var d = el("details", "unmatched");
      d.appendChild(el("summary", null, "미매핑 계정 보기 (" + (po.length + co.length) + "개)"));
      var t = el("div", "tbl-wrap");
      var rows = ['<tr><th>구분</th><th>코드</th><th>계정과목</th><th>금액</th></tr>'];
      po.forEach(function (a) {
        rows.push("<tr><td>전기에만</td><td class='k'>" + esc(a.코드) + "</td><td>" + esc(a.계정과목) + "</td><td class='n'>" + num(a.전기말) + "</td></tr>");
      });
      co.forEach(function (a) {
        rows.push("<tr><td>당기에만</td><td class='k'>" + esc(a.코드) + "</td><td>" + esc(a.계정과목) + "</td><td class='n'>" + num(a.당기말_수정전) + "</td></tr>");
      });
      t.innerHTML = "<table>" + rows.join("") + "</table>";
      d.appendChild(t);
      box.appendChild(d);
    }
    return box;
  }

  /* ── 분개 입력 ─────────────────────────────────────── */
  function adjustEditor() {
    var box = el("div", "adjbox");
    var t = el("div", "tbl-wrap");
    var table = document.createElement("table");
    table.className = "adjtable";
    table.innerHTML = "<tr><th>번호</th><th>구분</th><th>차변계정</th><th>대변계정</th>"
      + "<th>금액</th><th>적요</th><th>조서참조</th><th></th></tr>";

    t1.adjustments.forEach(function (j, idx) {
      var tr = document.createElement("tr");
      tr.appendChild(cellInput(j, "번호", "text", "1", idx));
      var td = document.createElement("td");
      td.appendChild(selectOf([["수정", "수정"], ["재분류", "재분류"]], j.구분 || "수정", function (v) {
        j.구분 = v; refreshCalc();
      }));
      tr.appendChild(td);
      tr.appendChild(cellInput(j, "차변계정", "text", "8200", idx));
      tr.appendChild(cellInput(j, "대변계정", "text", "2100", idx));
      tr.appendChild(cellInput(j, "금액", "number", "0", idx));
      tr.appendChild(cellInput(j, "적요", "text", "", idx));
      tr.appendChild(cellInput(j, "조서참조", "text", "A-01", idx));

      var del = document.createElement("td");
      var b = el("button", "mini-btn", "삭제");
      b.type = "button";
      b.addEventListener("click", function () { t1.adjustments.splice(idx, 1); renderPanel(); });
      del.appendChild(b);
      tr.appendChild(del);
      table.appendChild(tr);
    });
    t.appendChild(table);
    box.appendChild(t);

    var add = el("button", "mini-btn", "+ 분개 추가");
    add.type = "button";
    add.style.marginTop = "10px";
    add.addEventListener("click", function () {
      var next = String(t1.adjustments.length + 1);
      t1.adjustments.push({ 번호: next, 구분: "수정", 차변계정: "", 대변계정: "", 금액: 0, 적요: "", 조서참조: "" });
      renderPanel();
    });
    box.appendChild(add);
    return box;
  }

  function cellInput(obj, key, type, ph, idx) {
    var td = document.createElement("td");
    var i = document.createElement("input");
    i.type = type;
    i.placeholder = ph;
    i.value = obj[key] === undefined || obj[key] === null ? "" : obj[key];
    i.addEventListener("input", function () {
      obj[key] = type === "number" ? WS.toNumber(i.value) : i.value;
      refreshCalc();
    });
    td.appendChild(i);
    return td;
  }

  /** 표·검증만 다시 그린다 (입력 포커스를 잃지 않도록 전체 렌더는 피한다) */
  function refreshCalc() {
    var tbl = document.querySelector("#sub-panel .wstable-host");
    var sav = document.querySelector("#sub-panel .savehost");
    if (tbl) { tbl.innerHTML = ""; tbl.appendChild(worksheetTableInner()); }
    if (sav) { sav.innerHTML = ""; sav.appendChild(saveBlockInner()); }
  }

  /* ── 정산표 표 ─────────────────────────────────────── */
  function computed() {
    return WS.applyAdjustments(t1.merged.accounts, t1.adjustments);
  }

  function worksheetTable() {
    var host = el("div", "wstable-host");
    host.appendChild(worksheetTableInner());
    return host;
  }

  function worksheetTableInner() {
    var accts = computed();
    var wrap = el("div", "tbl-wrap");
    var rows = ["<tr><th>코드</th><th>계정과목</th><th>구분</th><th>전기말</th>"
      + "<th>당기말 수정전</th><th>수정분개</th><th>재분류</th><th>당기말 수정후</th></tr>"];

    accts.forEach(function (a) {
      var changed = a.수정분개액 || a.재분류액;
      rows.push("<tr" + (changed ? ' class="flag"' : "") + ">"
        + "<td class='k'>" + esc(a.코드) + "</td>"
        + "<td>" + esc(a.계정과목) + "</td>"
        + "<td>" + esc(a.구분) + "</td>"
        + "<td class='n'>" + num(a.전기말) + "</td>"
        + "<td class='n'>" + num(a.당기말_수정전) + "</td>"
        + "<td class='n'>" + (a.수정분개액 ? num(a.수정분개액) : "-") + "</td>"
        + "<td class='n'>" + (a.재분류액 ? num(a.재분류액) : "-") + "</td>"
        + "<td class='n'>" + num(a.당기말_수정후) + "</td></tr>");
    });

    function tot(k) { return accts.reduce(function (s, a) { return s + a[k]; }, 0); }
    rows.push("<tr class='sum'><td></td><td>합계</td><td></td>"
      + "<td class='n'>" + num(tot("전기말")) + "</td>"
      + "<td class='n'>" + num(tot("당기말_수정전")) + "</td>"
      + "<td class='n'>" + num(tot("수정분개액")) + "</td>"
      + "<td class='n'>" + num(tot("재분류액")) + "</td>"
      + "<td class='n'>" + num(tot("당기말_수정후")) + "</td></tr>");

    var table = document.createElement("table");
    table.innerHTML = rows.join("");
    wrap.appendChild(table);

    var note = el("p", "cap", "합계는 0이어야 차대가 맞습니다 (차변 양수 · 대변 음수 규약). "
      + "계정 " + accts.length + "개.");
    var box = el("div");
    box.appendChild(wrap);
    box.appendChild(note);
    return box;
  }

  /* ── 검증·저장 ─────────────────────────────────────── */
  function saveBlock() {
    var host = el("div", "savehost");
    host.appendChild(saveBlockInner());
    return host;
  }

  function saveBlockInner() {
    var accts = computed();
    var codes = accts.map(function (a) { return a.코드; }).filter(Boolean);
    var vAdj = WS.verifyAdjustments(t1.adjustments, codes);
    var vBal = WS.verifyBalance(accts);
    var ok = vAdj.ok && vBal.ok;

    var box = el("div");
    var card = el("div", "verify " + (ok ? "good" : "bad"));
    card.innerHTML = "<b>" + (ok ? "차대가 맞습니다. 저장할 수 있습니다."
      : "차대가 맞지 않아 저장할 수 없습니다.") + "</b>";

    var ul = el("ul", "vlist");
    ul.appendChild(li("정산표 합계 (당기말 수정후)", vBal.당기말_수정후, vBal.ok));
    ul.appendChild(li("당기말 수정전 합계", vBal.당기말_수정전, vBal.균형.당기말_수정전));
    ul.appendChild(li("전기말 합계", vBal.전기말, vBal.균형.전기말));
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

    var bSave = el("button", "copy-btn", "정산표 저장");
    bSave.type = "button";
    bSave.disabled = !ok;
    bSave.addEventListener("click", function () {
      var cur = S.current();
      var ws = WS.build(stripId(cur), t1.merged.accounts, t1.adjustments);
      S.saveWorksheet(ws).then(function () {
        download(JSON.stringify(ws, null, 2), "worksheet.json", "application/json");
        renderAll();
      });
    });
    actions.appendChild(bSave);

    var bXlsx = el("button", "mini-btn", "정산표 xlsx 내려받기");
    bXlsx.type = "button";
    bXlsx.disabled = !ok;
    bXlsx.addEventListener("click", function () { exportXlsx(accts, vAdj); });
    actions.appendChild(bXlsx);

    box.appendChild(actions);

    var cur = S.current();
    if (cur) {
      box.appendChild(el("p", "cap", "내려받은 파일은 " + esc(S.workPath(cur))
        + " 에 넣어 두세요. 이 폴더는 .gitignore로 막혀 있어 저장소에 올라가지 않습니다."));
    }
    return box;
  }

  function li(name, value, ok) {
    var l = el("li", ok ? "" : "bad");
    l.innerHTML = "<span>" + esc(name) + "</span><b>" + num(value) + "</b>";
    return l;
  }

  /* ── 산출물 ────────────────────────────────────────── */
  function exportXlsx(accts, vAdj) {
    var cur = S.current();
    var wb = XLSX.utils.book_new();

    var head = ["코드", "계정과목", "구분", "전기말", "당기말_수정전", "수정분개", "재분류", "당기말_수정후"];
    var aoa = [
      [(cur.회사명 || "") + " 정산표"],
      ["결산일 " + cur.결산일 + " · 작성 " + (cur.작성자 || "-") + " · 검토 " + (cur.검토자 || "-")],
      ["차변 양수 · 대변 음수 규약. 합계는 0이어야 합니다."],
      [],
      head,
    ];
    accts.forEach(function (a) {
      aoa.push([a.코드, a.계정과목, a.구분, a.전기말, a.당기말_수정전, a.수정분개액, a.재분류액, a.당기말_수정후]);
    });
    var first = 6, last = 5 + accts.length;
    var totalAt = last + 1;                       // 합계 행 (1-based)
    aoa.push(["", "합계", "", null, null, null, null, null]);

    var ws1 = XLSX.utils.aoa_to_sheet(aoa);
    // 합계는 =SUM() 수식으로 넣는다 — 숫자를 고치면 엑셀에서 다시 계산되도록.
    // 수식만 있고 캐시값이 없으면 기록에서 빠지므로 계산값(v)도 함께 넣는다.
    var sumKeys = ["전기말", "당기말_수정전", "수정분개액", "재분류액", "당기말_수정후"];
    ["D", "E", "F", "G", "H"].forEach(function (c, i) {
      var v = accts.reduce(function (s, a) { return s + (a[sumKeys[i]] || 0); }, 0);
      ws1[c + totalAt] = { t: "n", v: v, f: "SUM(" + c + first + ":" + c + last + ")" };
    });
    ws1["!cols"] = [{ wch: 10 }, { wch: 24 }, { wch: 6 }, { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 16 }];
    ws1["!freeze"] = { xSplit: 0, ySplit: 5 };
    XLSX.utils.book_append_sheet(wb, ws1, "정산표");

    if (t1.adjustments.length) {
      var a2 = [["번호", "구분", "차변계정", "대변계정", "금액", "적요", "조서참조"]];
      t1.adjustments.forEach(function (j) {
        a2.push([j.번호, j.구분 || "수정", j.차변계정, j.대변계정, WS.toNumber(j.금액), j.적요, j.조서참조]);
      });
      a2.push([]);
      a2.push(["번호별 차대"]);
      a2.push(["구분", "번호", "차변", "대변", "차액"]);
      vAdj.entries.forEach(function (g) { a2.push([g.구분, g.번호, g.차변, g.대변, g.차액]); });
      var ws2 = XLSX.utils.aoa_to_sheet(a2);
      ws2["!cols"] = [{ wch: 8 }, { wch: 8 }, { wch: 12 }, { wch: 12 }, { wch: 16 }, { wch: 30 }, { wch: 12 }];
      XLSX.utils.book_append_sheet(wb, ws2, "수정분개");
    }

    var un = t1.merged.unmatched;
    if (un.priorOnly.length || un.currentOnly.length) {
      var a3 = [["구분", "코드", "계정과목", "금액"]];
      un.priorOnly.forEach(function (a) { a3.push(["전기에만", a.코드, a.계정과목, a.전기말]); });
      un.currentOnly.forEach(function (a) { a3.push(["당기에만", a.코드, a.계정과목, a.당기말_수정전]); });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(a3), "미매핑");
    }

    // 파일명은 ASCII로 — 일부 브라우저가 download 속성에 한글이 있으면 이름을 버린다
    var name = safeName("FY" + String(cur.결산일).slice(2, 4) + "_"
      + (cur.회사코드 || "company") + "_worksheet") + ".xlsx";
    // writeFile 대신 직접 내려받는다 — 파일명을 확실히 잡기 위해
    var buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
    download(buf, name, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
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
