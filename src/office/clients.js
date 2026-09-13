/*
 * 거래처 관리 + 이번 달 할 일.
 *
 * ── 저장 위치 ───────────────────────────────────────────
 * 거래처 정보는 **이 브라우저에만** 남는다 (localStorage).
 * 상호·사업자등록번호는 개인정보·과세정보이므로 저장소에 커밋하지 않는다.
 * work/ 를 .gitignore 로 막아 둔 것과 같은 이유다.
 * 옮기거나 백업하려면 "내보내기"로 JSON 을 내려받아 work/ 아래에 둔다.
 *
 * 신고 기한 계산은 src/office/deadlines.js 가 한다. 여기서는 그리기만 한다.
 */
(function () {
  "use strict";

  var KEY = "office:clients";
  var clients = [];
  var editing = null;        // 수정 중인 거래처 id (없으면 null)

  var ENTITY = { indiv: "개인", corp: "법인" };
  var VAT = { taxable: "과세", exempt: "면세", both: "겸업" };
  var WT = { monthly: "매월", half: "반기" };

  function $(id) { return document.getElementById(id); }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ── 저장 ─────────────────────────────────────────────── */

  function load() {
    try { clients = JSON.parse(localStorage.getItem(KEY)) || []; }
    catch (e) { clients = []; }
    if (!Array.isArray(clients)) clients = [];
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(clients)); }
    catch (e) { alert("브라우저에 저장하지 못했습니다. 저장 공간이 찼거나 시크릿 모드일 수 있습니다."); }
  }

  function newId() {
    return "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  /* ── 이번 달 할 일 ────────────────────────────────────── */

  function renderDue(host, month) {
    host.innerHTML = "";
    if (typeof Deadlines === "undefined") return;

    var rows = Deadlines.monthView(clients, month);

    var hd = el("div", "office-hd");
    hd.appendChild(el("b", null, month + "월에 할 일"));
    var n = rows.reduce(function (a, r) { return a + r.items.length; }, 0);
    hd.appendChild(el("span", "cap", clients.length
      ? "거래처 " + rows.length + "곳 · " + n + "건"
      : "거래처를 등록하면 여기에 뜹니다"));
    host.appendChild(hd);

    if (!clients.length) {
      host.appendChild(el("p", "empty",
        "아직 등록된 거래처가 없습니다. 아래에서 추가해 주세요."));
      return;
    }
    if (!rows.length) {
      host.appendChild(el("p", "empty", month + "월에 예정된 신고가 없습니다."));
      return;
    }

    rows.forEach(function (r) {
      var box = el("div", "due-row");
      var head = el("div", "due-name");
      head.appendChild(el("b", null, r.client.name));
      head.appendChild(el("span", "due-tag",
        ENTITY[r.client.entity] + " · " + VAT[r.client.vat]));
      box.appendChild(head);

      var ul = el("ul", "due-list");
      r.items.forEach(function (d) {
        var li = el("li");
        li.appendChild(el("span", "due-when", d.month === 0 ? "매월 10일" : d.when));
        li.appendChild(el("span", "due-what", d.what));
        if (d.note) li.appendChild(el("span", "due-note", d.note));
        ul.appendChild(li);
      });
      box.appendChild(ul);
      host.appendChild(box);
    });

    host.appendChild(el("p", "cap",
      "기한이 공휴일·주말이면 다음 영업일로 밀립니다. 신고 전에 원문 기한을 확인하세요."));
  }

  /* ── 거래처 표 ────────────────────────────────────────── */

  function renderList(host) {
    host.innerHTML = "";

    var hd = el("div", "office-hd");
    hd.appendChild(el("b", null, "거래처"));
    hd.appendChild(el("span", "cap", clients.length + "곳"));
    host.appendChild(hd);

    if (!clients.length) {
      host.appendChild(el("p", "empty", "등록된 거래처가 없습니다."));
      return;
    }

    var t = el("table", "otable");
    t.innerHTML = "<thead><tr><th>상호</th><th>구분</th><th>부가세</th>"
      + "<th>원천세</th><th>결산</th><th class=\"onum\">월 기장료</th><th></th></tr></thead>";
    var tb = el("tbody");

    clients.forEach(function (c) {
      var tr = el("tr");
      var fee = Number(c.fee) || 0;
      tr.innerHTML =
        "<td><b>" + esc(c.name) + "</b>"
          + (c.bizNo ? '<span class="biz">' + esc(c.bizNo) + "</span>" : "") + "</td>"
        + "<td>" + (ENTITY[c.entity] || "-")
          + (c.honest ? '<span class="chip">성실</span>' : "")
          + (c.medical ? '<span class="chip">병의원</span>' : "") + "</td>"
        + "<td>" + (VAT[c.vat] || "-") + "</td>"
        + "<td>" + (c.hasStaff ? (WT[c.wtPeriod] || "매월") : "—") + "</td>"
        + "<td>" + (c.entity === "corp" ? (c.fyEndMonth || 12) + "월" : "—") + "</td>"
        + "<td class=\"onum\">" + (fee ? fee.toLocaleString("ko-KR") : "—") + "</td>"
        + '<td class="act"></td>';

      var act = tr.querySelector(".act");
      var ed = el("button", "mini-btn", "수정");
      ed.type = "button";
      ed.addEventListener("click", function () { editing = c.id; renderAll(); });
      var rm = el("button", "mini-btn", "삭제");
      rm.type = "button";
      rm.addEventListener("click", function () {
        if (!confirm("'" + c.name + "'을(를) 지울까요? 되돌릴 수 없습니다.")) return;
        clients = clients.filter(function (x) { return x.id !== c.id; });
        save();
        renderAll();
      });
      act.appendChild(ed);
      act.appendChild(rm);
      tb.appendChild(tr);
    });

    t.appendChild(tb);
    host.appendChild(t);

    var sum = clients.reduce(function (a, c) { return a + (Number(c.fee) || 0); }, 0);
    if (sum) {
      host.appendChild(el("p", "cap",
        "월 기장료 합계 " + sum.toLocaleString("ko-KR") + "원 (등록된 값 기준)"));
    }
  }

  /* ── 추가 · 수정 폼 ───────────────────────────────────── */

  function renderForm(host) {
    host.innerHTML = "";
    var c = editing ? clients.find(function (x) { return x.id === editing; }) : null;
    var v = c || { entity: "indiv", vat: "taxable", wtPeriod: "monthly", fyEndMonth: 12 };

    var hd = el("div", "office-hd");
    hd.appendChild(el("b", null, c ? "거래처 수정" : "거래처 추가"));
    host.appendChild(hd);

    var f = el("div", "oform");
    f.innerHTML =
      '<label>상호 <input id="of-name" type="text" placeholder="행복의원"></label>'
      + '<label>사업자등록번호 <input id="of-biz" type="text" placeholder="123-45-67890"></label>'
      + '<label>구분 <select id="of-entity">'
        + '<option value="indiv">개인</option><option value="corp">법인</option></select></label>'
      + '<label>부가세 <select id="of-vat">'
        + '<option value="taxable">과세</option><option value="exempt">면세</option>'
        + '<option value="both">겸업</option></select></label>'
      + '<label>원천세 <select id="of-wt">'
        + '<option value="">직원 없음</option>'
        + '<option value="monthly">매월납</option><option value="half">반기납</option></select></label>'
      + '<label>결산월 (법인) <input id="of-fy" type="number" min="1" max="12" placeholder="12"></label>'
      + '<label>월 기장료 <input id="of-fee" type="number" min="0" step="10000" placeholder="300000"></label>'
      + '<label class="ck"><input id="of-honest" type="checkbox"> 성실신고확인 대상</label>'
      + '<label class="ck"><input id="of-medical" type="checkbox"> 병의원</label>';
    host.appendChild(f);

    $("of-name").value = v.name || "";
    $("of-biz").value = v.bizNo || "";
    $("of-entity").value = v.entity || "indiv";
    $("of-vat").value = v.vat || "taxable";
    $("of-wt").value = v.hasStaff ? (v.wtPeriod || "monthly") : "";
    $("of-fy").value = v.fyEndMonth || "";
    $("of-fee").value = v.fee || "";
    $("of-honest").checked = !!v.honest;
    $("of-medical").checked = !!v.medical;

    var acts = el("div", "save-actions");
    var ok = el("button", "copy-btn", c ? "수정 저장" : "추가");
    ok.type = "button";
    ok.addEventListener("click", function () {
      var name = $("of-name").value.trim();
      if (!name) { alert("상호를 입력해 주세요."); return; }
      var wt = $("of-wt").value;
      var data = {
        id: c ? c.id : newId(),
        name: name,
        bizNo: $("of-biz").value.trim(),
        entity: $("of-entity").value,
        vat: $("of-vat").value,
        hasStaff: !!wt,
        wtPeriod: wt || "monthly",
        fyEndMonth: Number($("of-fy").value) || 12,
        fee: Number($("of-fee").value) || 0,
        honest: $("of-honest").checked,
        medical: $("of-medical").checked,
      };
      if (c) clients = clients.map(function (x) { return x.id === c.id ? data : x; });
      else clients.push(data);
      save();
      editing = null;
      renderAll();
    });
    acts.appendChild(ok);

    if (c) {
      var cancel = el("button", "mini-btn", "취소");
      cancel.type = "button";
      cancel.addEventListener("click", function () { editing = null; renderAll(); });
      acts.appendChild(cancel);
    }
    host.appendChild(acts);
  }

  /* ── 내보내기 · 불러오기 ──────────────────────────────── */

  function renderIO(host) {
    host.innerHTML = "";
    var acts = el("div", "save-actions");

    var out = el("button", "mini-btn", "내보내기 (JSON)");
    out.type = "button";
    out.addEventListener("click", function () {
      var blob = new Blob([JSON.stringify(clients, null, 2)],
        { type: "application/json;charset=utf-8" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "clients.json";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    });
    acts.appendChild(out);

    var inp = el("button", "mini-btn", "불러오기");
    inp.type = "button";
    inp.addEventListener("click", function () {
      var i = document.createElement("input");
      i.type = "file";
      i.accept = ".json,application/json";
      i.addEventListener("change", function () {
        var file = i.files && i.files[0];
        if (!file) return;
        file.text().then(function (txt) {
          var arr;
          try { arr = JSON.parse(txt); } catch (e) { alert("JSON 을 읽지 못했습니다."); return; }
          if (!Array.isArray(arr)) { alert("거래처 목록(배열) 형태가 아닙니다."); return; }
          if (!confirm("지금 목록을 지우고 " + arr.length + "곳으로 바꿉니다. 계속할까요?")) return;
          clients = arr.filter(function (x) { return x && x.name; })
            .map(function (x) { if (!x.id) x.id = newId(); return x; });
          save();
          renderAll();
        });
      });
      i.click();
    });
    acts.appendChild(inp);

    if (clients.length) {
      var clr = el("button", "mini-btn", "전부 지우기");
      clr.type = "button";
      clr.addEventListener("click", function () {
        if (!confirm("거래처 " + clients.length + "곳을 전부 지웁니다. 되돌릴 수 없습니다.")) return;
        clients = [];
        save();
        renderAll();
      });
      acts.appendChild(clr);
    }

    host.appendChild(acts);
    host.appendChild(el("p", "cap",
      "거래처 정보는 이 브라우저에만 저장됩니다. 저장소에 올라가지 않습니다. "
      + "다른 PC로 옮기거나 백업하려면 내보내기로 받아 work/ 아래에 두세요."));
  }

  /* ── 전체 ─────────────────────────────────────────────── */

  function renderAll() {
    var due = $("office-due");
    var list = $("office-list");
    var form = $("office-form");
    var io = $("office-io");
    if (!due) return;

    var m = Number($("office-month") && $("office-month").value)
      || (new Date().getMonth() + 1);
    renderDue(due, m);
    renderList(list);
    renderForm(form);
    renderIO(io);
  }

  document.addEventListener("DOMContentLoaded", function () {
    var host = $("office-app");
    if (!host) return;
    load();

    var sel = $("office-month");
    if (sel) {
      for (var i = 1; i <= 12; i++) {
        var o = document.createElement("option");
        o.value = String(i);
        o.textContent = i + "월";
        sel.appendChild(o);
      }
      sel.value = String(new Date().getMonth() + 1);
      sel.addEventListener("change", renderAll);
    }
    renderAll();
  });

  window.OfficeClients = {
    count: function () { load(); return clients.length; },
    dueCount: function () {
      load();
      if (typeof Deadlines === "undefined") return 0;
      return Deadlines.monthCount(clients, new Date().getMonth() + 1);
    },
  };
})();
