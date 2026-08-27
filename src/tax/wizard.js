/*
 * 종합소득세 계산 화면 흐름.
 * 계산은 전부 src/tax/calc.js 가 하고, 여기서는 화면 전환·입력 수집만 한다.
 *
 * 사장님이 쓰는 화면이라 원칙 몇 가지를 지킨다.
 *   · 한 화면에 질문 하나 — 폼을 한꺼번에 쏟지 않는다
 *   · 금액은 치는 즉시 콤마와 "8,000만원" 읽기를 붙여 자릿수를 눈으로 확인시킨다
 *   · 매출을 넣는 순간부터 하단에 예상 세금을 계속 띄워 지금 뭘 하는 중인지 보이게 한다
 */
(function () {
  "use strict";

  var STEPS = ["intro", "1", "2", "3", "4", "result"];
  var LAST_INPUT = 4;            // 입력 단계 개수 (진행률 계산용)
  var RATES = window.TAX_RATES;
  var C = window.TaxCalc;

  var state = {
    step: 0,
    수입금액: 0,
    경비방식: "known",           // known | items | rate
    경비총액: 0,
    항목: [{ 항목: "", 금액: 0 }],
    경비율: 70,
    기본공제_인원: 1,
    경로우대_인원: 0,
    장애인_인원: 0,
    자녀세액공제_인원: 0,
    국민연금등_공제: 0,
    기납부세액: 0,
  };

  var $ = function (id) { return document.getElementById(id); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  /* ── 필요경비: 방식에 따라 값이 달라진다 ───────────── */
  function 필요경비() {
    if (state.경비방식 === "items") {
      return state.항목.reduce(function (s, r) { return s + C.num(r.금액); }, 0);
    }
    if (state.경비방식 === "rate") {
      return Math.round(state.수입금액 * state.경비율 / 100);
    }
    return state.경비총액;
  }

  function inputs() {
    return {
      수입금액: state.수입금액,
      필요경비: 필요경비(),
      국민연금등_공제: state.국민연금등_공제,
      기본공제_인원: state.기본공제_인원,
      경로우대_인원: state.경로우대_인원,
      장애인_인원: state.장애인_인원,
      자녀세액공제_인원: state.자녀세액공제_인원,
      기납부세액: state.기납부세액,
    };
  }

  /* ── 화면 전환 ─────────────────────────────────────── */
  function show(i) {
    state.step = Math.max(0, Math.min(STEPS.length - 1, i));
    var name = STEPS[state.step];

    $$(".screen").forEach(function (el) {
      el.classList.toggle("on", el.getAttribute("data-screen") === name);
    });

    var isIntro = name === "intro";
    var isResult = name === "result";

    $("back").hidden = isIntro || isResult;
    var pct = isResult ? 100 : (isIntro ? 0 : Math.round(state.step / LAST_INPUT * 100));
    $("prog").querySelector("i").style.width = pct + "%";
    $("prog").setAttribute("aria-valuenow", String(pct));
    $("stepn").textContent = (isIntro || isResult) ? "" : state.step + " / " + LAST_INPUT;

    $("dock").hidden = isResult;
    $("next").textContent = isIntro ? "시작하기"
      : (state.step === LAST_INPUT ? "계산 결과 보기" : "다음");

    if (isResult) renderResult();
    refreshDock();
    window.scrollTo({ top: 0, behavior: state.step === 0 ? "auto" : "smooth" });

    var h = document.querySelector('.screen.on .q, .screen.on .hero-h1');
    if (h) h.setAttribute("tabindex", "-1");
  }

  /* 다음으로 갈 수 있는지 — 매출 없이는 계산이 의미가 없다 */
  function canAdvance() {
    if (STEPS[state.step] === "1") return state.수입금액 > 0;
    return true;
  }

  function refreshDock() {
    var name = STEPS[state.step];
    var showEst = (name === "2" || name === "3" || name === "4") && state.수입금액 > 0;
    $("est").hidden = !showEst;
    $("dock").classList.toggle("solo", !showEst);

    if (showEst) {
      var r = C.calc(inputs(), RATES);
      $("est-lab").textContent = r.환급여부 ? "예상 환급" : "예상 세금";
      $("est-num").textContent = C.comma(Math.abs(r.차감납부세액)) + "원";
    }
    $("next").disabled = !canAdvance();
  }

  /* ── 금액 입력: 콤마 + 한글 읽기 ───────────────────── */
  function bindMoney(id, key, onChange) {
    var el = $(id);
    var read = $(id + "-read");

    function sync(raw) {
      var v = C.num(raw);
      el.value = v ? C.comma(v) : "";
      if (read) read.textContent = C.readable(v);
      if (key) state[key] = v;
      if (onChange) onChange(v);
      refreshDock();
    }

    el.addEventListener("input", function () {
      // 커서를 끝에 두는 단순 방식 — 금액 칸은 대개 끝에서 이어 치므로 충분하다
      sync(el.value);
    });
    el.addEventListener("blur", function () { sync(el.value); });

    var chips = document.querySelector('[data-chips="' + id + '"]');
    if (chips) {
      chips.addEventListener("click", function (e) {
        var b = e.target.closest("button");
        if (!b) return;
        if (b.hasAttribute("data-clear")) sync(0);
        else if (b.hasAttribute("data-set")) sync(b.getAttribute("data-set"));
        else if (b.hasAttribute("data-pct")) {
          sync(Math.round(state.수입금액 * parseFloat(b.getAttribute("data-pct")) / 100));
        } else if (b.hasAttribute("data-add")) {
          sync(C.num(el.value) + C.num(b.getAttribute("data-add")));
        }
        el.focus();
      });
    }
    return { sync: sync };
  }

  /* ── 인원 카운터 ───────────────────────────────────── */
  var COUNT_KEYS = {
    fam: { key: "기본공제_인원", min: 1 },
    old: { key: "경로우대_인원", min: 0 },
    dis: { key: "장애인_인원", min: 0 },
    kid: { key: "자녀세액공제_인원", min: 0 },
  };

  function bindCounters() {
    $$("[data-step-for]").forEach(function (box) {
      var id = box.getAttribute("data-step-for");
      var meta = COUNT_KEYS[id];
      var out = $(id);

      box.addEventListener("click", function (e) {
        var b = e.target.closest("button");
        if (!b) return;
        var next = state[meta.key] + parseInt(b.getAttribute("data-d"), 10);
        next = Math.max(meta.min, Math.min(20, next));
        state[meta.key] = next;
        out.textContent = String(next);
        syncCounterButtons(box, meta, next);
        refreshDock();
      });
      syncCounterButtons(box, meta, state[meta.key]);
    });
  }

  function syncCounterButtons(box, meta, v) {
    var minus = box.querySelector('[data-d="-1"]');
    if (minus) minus.disabled = v <= meta.min;
  }

  /* ── 경비 방식 선택 ────────────────────────────────── */
  function pickRadio(group, el) {
    group.forEach(function (b) {
      var on = b === el;
      b.classList.toggle("sel", on);
      b.setAttribute("aria-checked", on ? "true" : "false");
    });
  }

  function bindExpense() {
    var modes = $$("[data-exp]");
    modes.forEach(function (b) {
      b.addEventListener("click", function () {
        pickRadio(modes, b);
        state.경비방식 = b.getAttribute("data-exp");
        $$("[data-exp-pane]").forEach(function (p) {
          p.hidden = p.getAttribute("data-exp-pane") !== state.경비방식;
        });
        renderRateSum();
        refreshDock();
      });
    });

    var rates = $$("[data-rate]");
    rates.forEach(function (b) {
      b.addEventListener("click", function () {
        pickRadio(rates, b);
        state.경비율 = parseFloat(b.getAttribute("data-rate"));
        renderRateSum();
        refreshDock();
      });
    });

    $("row-add").addEventListener("click", function () {
      state.항목.push({ 항목: "", 금액: 0 });
      renderRows();
      var last = $$("#rows .row-item input[type=text]").slice(-2)[0];
      if (last) last.focus();
    });

    renderRows();
  }

  function renderRateSum() {
    $("rate-sum").textContent = C.comma(Math.round(state.수입금액 * state.경비율 / 100)) + "원";
  }

  function renderRows() {
    var box = $("rows");
    box.innerHTML = "";
    state.항목.forEach(function (row, i) {
      var el = document.createElement("div");
      el.className = "row-item";
      el.innerHTML =
        '<input type="text" placeholder="임차료, 재료비…" aria-label="항목 이름">' +
        '<input type="text" class="amt" inputmode="numeric" placeholder="0" aria-label="금액">' +
        '<button class="row-del" type="button" aria-label="이 항목 지우기">×</button>';

      var name = el.children[0], amt = el.children[1], del = el.children[2];
      name.value = row.항목;
      amt.value = row.금액 ? C.comma(row.금액) : "";

      name.addEventListener("input", function () { row.항목 = name.value; });
      amt.addEventListener("input", function () {
        row.금액 = C.num(amt.value);
        amt.value = row.금액 ? C.comma(row.금액) : "";
        renderRowsSum();
        refreshDock();
      });
      del.addEventListener("click", function () {
        state.항목.splice(i, 1);
        if (!state.항목.length) state.항목.push({ 항목: "", 금액: 0 });
        renderRows();
        refreshDock();
      });

      box.appendChild(el);
    });
    renderRowsSum();
  }

  function renderRowsSum() {
    var sum = state.항목.reduce(function (s, r) { return s + C.num(r.금액); }, 0);
    $("rows-sum").textContent = C.comma(sum) + "원";
  }

  /* ── 매출 엑셀 업로드 ──────────────────────────────── */
  function bindUpload(revMoney) {
    var drop = $("drop"), file = $("file"), picked = $("picked");

    ["dragenter", "dragover"].forEach(function (t) {
      drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add("over"); });
    });
    ["dragleave", "drop"].forEach(function (t) {
      drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove("over"); });
    });
    drop.addEventListener("drop", function (e) {
      if (e.dataTransfer.files && e.dataTransfer.files[0]) handle(e.dataTransfer.files[0]);
    });
    file.addEventListener("change", function () {
      if (file.files && file.files[0]) handle(file.files[0]);
    });

    function fail(msg) {
      picked.innerHTML = '<div class="picked" style="background:#FEF2F2;border-color:#FECACA">' +
        '<span class="ico">⚠️</span><span class="t"><b style="color:#B91C1C">' + esc(msg) + '</b>' +
        '<span style="color:#B91C1C">아래에 금액을 직접 입력하셔도 됩니다.</span></span></div>';
    }

    function handle(f) {
      var reader = new FileReader();
      reader.onload = function (e) {
        var rows;
        try {
          var wb = XLSX.read(new Uint8Array(e.target.result), { type: "array" });
          var ws = wb.Sheets[wb.SheetNames[0]];
          rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false });
        } catch (err) {
          return fail("파일을 읽지 못했어요");
        }
        if (!rows || rows.length < 2) return fail("자료가 비어 있어요");

        var head = rows[0].map(function (h) { return String(h == null ? "" : h).trim(); });
        var body = rows.slice(1);

        // 숫자가 실제로 들어 있는 열만 후보로 — 합계를 붙일 수 있는 열
        var cands = [];
        head.forEach(function (h, i) {
          var sum = 0, hits = 0;
          body.forEach(function (r) {
            var v = C.num(r[i]);
            if (v) { sum += v; hits++; }
          });
          if (hits >= Math.max(1, body.length * 0.3)) {
            cands.push({ i: i, name: h || ("열 " + (i + 1)), sum: sum });
          }
        });
        if (!cands.length) return fail("합칠 수 있는 금액 열을 찾지 못했어요");

        // 합계가 가장 큰 열이 대개 매출액이다
        cands.sort(function (a, b) { return b.sum - a.sum; });

        picked.innerHTML =
          '<div class="picked"><span class="ico">✅</span><span class="t">' +
          "<b>" + esc(f.name) + "</b><span>" + body.length.toLocaleString("ko-KR") +
          "건을 읽었어요</span></span></div>" +
          '<div class="pick-col"><label class="label" for="col">어느 열을 매출로 쓸까요?</label>' +
          '<select id="col"></select></div>';

        var sel = $("col");
        cands.forEach(function (c, k) {
          var o = document.createElement("option");
          o.value = String(k);
          o.textContent = c.name + " — 합계 " + C.comma(c.sum) + "원";
          sel.appendChild(o);
        });
        sel.addEventListener("change", function () {
          revMoney.sync(cands[parseInt(sel.value, 10)].sum);
        });
        revMoney.sync(cands[0].sum);
      };
      reader.onerror = function () { fail("파일을 읽지 못했어요"); };
      reader.readAsArrayBuffer(f);
    }
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ── 결과 ──────────────────────────────────────────── */
  var lastResult = null;

  function renderResult() {
    var r = C.calc(inputs(), RATES);
    lastResult = r;
    var amount = Math.abs(r.차감납부세액);
    var refund = r.환급여부;

    var v = $("verdict");
    v.classList.toggle("refund", refund);
    v.classList.toggle("pay", !refund);
    $("v-tag").textContent = refund ? "💚 돌려받아요" : "🗓️ 5월 31일까지";
    $("v-lab").textContent = refund ? "돌려받을 세금" : "5월에 내실 세금";
    $("v-note").textContent = refund
      ? "미리 낸 세금이 실제 세금보다 많아요. 신고하면 돌려받습니다."
      : "여기에 더해 지방소득세 " + C.comma(r.지방소득세_추정) + "원을 지자체에 따로 신고합니다.";

    countUp($("v-num"), amount);

    $("m-income").textContent = C.comma(r.사업소득금액) + "원";
    $("m-base").textContent = C.comma(r.과세표준) + "원";

    var lines = [
      ["번 돈 (매출)", r.수입금액, ""],
      ["쓴 돈 (경비)", -r.필요경비, "minus"],
      ["사업으로 번 소득", r.사업소득금액, "key"],
      ["가족 공제", -r.인적공제, "minus"],
      ["국민연금 공제", -r.국민연금등_공제, "minus"],
      ["세금을 매기는 금액", r.과세표준, "key"],
      ["세율을 적용한 세금", r.산출세액, ""],
      ["기본 세액공제", -r.표준세액공제, "minus"],
      ["자녀 세액공제", -r.자녀세액공제, "minus"],
      ["최종 세금", r.결정세액, "key"],
      ["미리 낸 세금", -r.기납부세액, "minus"],
      [refund ? "돌려받을 세금" : "내실 세금", r.차감납부세액, "key"],
    ];

    $("sheet-bd").innerHTML = lines.map(function (l) {
      // 0원인 줄은 빼준 게 없으므로 초록(minus)으로 칠하지 않는다 —
      // 공제가 실제로 적용된 줄만 눈에 띄어야 한다
      var mark = (l[2] === "minus" && l[1] === 0) ? "" : l[2];
      var cls = "line" + (mark ? " " + mark : "");
      var val = (l[1] < 0 ? "− " : "") + C.comma(Math.abs(l[1])) + "원";
      return '<div class="' + cls + '"><dt>' + esc(l[0]) + "</dt><dd>" + val + "</dd></div>";
    }).join("");
  }

  function countUp(el, target) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.textContent = C.comma(target);
      return;
    }
    var t0 = null, dur = 620;
    function frame(t) {
      if (t0 === null) t0 = t;
      var p = Math.min(1, (t - t0) / dur);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = C.comma(Math.round(target * eased));
      if (p < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  /* ── 엑셀 저장 ─────────────────────────────────────── */
  function download() {
    var r = lastResult || C.calc(inputs(), RATES);
    var rows = [
      ["2025년 귀속 종합소득세 계산 (참고용 추정치)"],
      ["실제 신고 전 세무사 확인이 필요합니다."],
      [],
      ["항목", "금액(원)"],
      ["번 돈 (매출)", r.수입금액],
      ["쓴 돈 (경비)", r.필요경비],
      ["사업으로 번 소득", r.사업소득금액],
      ["가족 공제", r.인적공제],
      ["국민연금 공제", r.국민연금등_공제],
      ["공제 합계", r.종합소득공제],
      ["세금을 매기는 금액 (과세표준)", r.과세표준],
      ["세율을 적용한 세금 (산출세액)", r.산출세액],
      ["기본 세액공제", r.표준세액공제],
      ["자녀 세액공제", r.자녀세액공제],
      ["최종 세금 (결정세액)", r.결정세액],
      ["미리 낸 세금", r.기납부세액],
      [r.환급여부 ? "돌려받을 세금" : "5월에 내실 세금", Math.abs(r.차감납부세액)],
      ["지방소득세 (지자체에 별도 신고)", r.지방소득세_추정],
    ];
    var ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{ wch: 32 }, { wch: 18 }];
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "종합소득세 계산");
    XLSX.writeFile(wb, "종합소득세_계산_2025.xlsx");
  }

  /* ── 시작 ──────────────────────────────────────────── */
  document.addEventListener("DOMContentLoaded", function () {
    var revMoney = bindMoney("rev", "수입금액", function () { renderRateSum(); });
    bindMoney("exp", "경비총액");
    bindMoney("pen", "국민연금등_공제");
    bindMoney("pre", "기납부세액");

    bindCounters();
    bindExpense();
    bindUpload(revMoney);

    $("next").addEventListener("click", function () {
      if (!canAdvance()) return;
      show(state.step + 1);
    });
    $("back").addEventListener("click", function () { show(state.step - 1); });

    $("sheet-tg").addEventListener("click", function () {
      var open = $("sheet").classList.toggle("open");
      $("sheet-tg").setAttribute("aria-expanded", open ? "true" : "false");
    });

    $("dl").addEventListener("click", download);
    $("again").addEventListener("click", function () { show(0); });

    window.addEventListener("scroll", function () {
      $("topbar").classList.toggle("scrolled", window.scrollY > 4);
    }, { passive: true });

    show(0);
  });
})();
