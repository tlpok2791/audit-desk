/*
 * 탭 전환 + 기능 카드 렌더링.
 * src/data/cards.js의 CARDS 배열을 읽어 [data-cards="탭키"] 컨테이너마다
 * 입력 필드·실시간 프롬프트 미리보기·복사 버튼이 달린 카드를 그린다.
 */
(function () {
  document.addEventListener("DOMContentLoaded", function () {
    renderAllCards();
    setupTabs();
  });

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function buildPrompt(card, values) {
    var out = String(card.template).replace(/\{(\w+)\}/g, function (m, key) {
      var v = (values[key] || "").trim();
      if (v) return v;
      var f = (card.fields || []).find(function (x) { return x.key === key; });
      return f && f.placeholder ? f.placeholder : m;
    });
    return out;
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).catch(function () {
        return fallbackCopy(text);
      });
    }
    return fallbackCopy(text);
  }

  function fallbackCopy(text) {
    return new Promise(function (resolve) {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try { document.execCommand("copy"); } catch (e) { /* noop */ }
      document.body.removeChild(ta);
      resolve();
    });
  }

  function renderCard(card) {
    var el = document.createElement("article");
    el.className = "fcard";
    el.innerHTML =
      '<div class="fcard-hd">' +
        '<span class="fcard-ico">' + (card.icon || "✦") + "</span>" +
        '<div class="fcard-main">' +
          '<div class="fcard-title">' + escapeHtml(card.title) + "</div>" +
          '<div class="fcard-desc">' + escapeHtml(card.desc) + "</div>" +
        "</div>" +
      "</div>" +
      '<div class="fcard-fields"></div>' +
      '<div class="sublabel">프롬프트 미리보기</div>' +
      '<pre class="fcard-preview"></pre>' +
      '<div class="fcard-actions">' +
        '<button class="copy-btn" type="button">프롬프트 복사</button>' +
        '<span class="agent-badge">🤖 ' + escapeHtml(card.subagent || "미지정") + "</span>" +
      "</div>";

    var fieldsEl = el.querySelector(".fcard-fields");
    var previewEl = el.querySelector(".fcard-preview");
    var values = {};

    (card.fields || []).forEach(function (f) {
      values[f.key] = "";
      var label = document.createElement("label");
      label.className = "fcard-field";
      var span = document.createElement("span");
      span.textContent = f.label;
      var input = document.createElement("input");
      input.type = "text";
      input.placeholder = f.placeholder || "";
      input.addEventListener("input", function () {
        values[f.key] = input.value;
        update();
      });
      label.appendChild(span);
      label.appendChild(input);
      fieldsEl.appendChild(label);
    });

    function update() { previewEl.textContent = buildPrompt(card, values); }
    update();

    var btn = el.querySelector(".copy-btn");
    btn.addEventListener("click", function () {
      copyText(buildPrompt(card, values)).then(function () {
        var old = btn.textContent;
        btn.textContent = "복사됨 ✓";
        btn.classList.add("copied");
        setTimeout(function () {
          btn.textContent = old;
          btn.classList.remove("copied");
        }, 1500);
      });
    });

    return el;
  }

  function renderAllCards() {
    if (typeof CARDS === "undefined") return;
    document.querySelectorAll("[data-cards]").forEach(function (grid) {
      var tab = grid.getAttribute("data-cards");
      var list = CARDS.filter(function (c) { return c.tab === tab; });
      if (!list.length) {
        grid.innerHTML = '<p class="cap">아직 등록된 카드가 없습니다. '
          + "<code>src/data/cards.js</code>에 카드를 추가해 주세요.</p>";
        return;
      }
      list.forEach(function (card) { grid.appendChild(renderCard(card)); });
    });
  }

  function setupTabs() {
    var btns = Array.prototype.slice.call(document.querySelectorAll(".tab-btn"));
    var panels = {};
    document.querySelectorAll(".tab-panel").forEach(function (p) {
      panels[p.dataset.tab] = p;
    });
    if (!btns.length) return;

    function activate(key, updateHash) {
      if (!panels[key]) key = btns[0].dataset.tab;
      btns.forEach(function (b) {
        var on = b.dataset.tab === key;
        b.classList.toggle("active", on);
        b.setAttribute("aria-selected", on ? "true" : "false");
      });
      Object.keys(panels).forEach(function (k) {
        var on = k === key;
        panels[k].classList.toggle("active", on);
        panels[k].hidden = !on;
      });
      document.body.classList.toggle("tab-audit-active", key === "audit");
      if (updateHash) history.replaceState(null, "", "#" + key);
    }

    btns.forEach(function (b) {
      b.addEventListener("click", function () { activate(b.dataset.tab, true); });
    });

    var initial = (location.hash || "").replace("#", "");
    activate(panels[initial] ? initial : "audit", false);
  }
})();
