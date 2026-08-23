/*
 * 탭 전환 + 기능 카드 렌더링.
 * src/data/cards.js의 CARDS 배열을 읽어 [data-cards="탭키"] 컨테이너마다
 * 입력 필드·실시간 프롬프트 미리보기·복사 버튼이 달린 카드를 그린다.
 */
(function () {
  document.addEventListener("DOMContentLoaded", function () {
    renderAllCards();
    renderPosts();
    setupTabs();
  });

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function buildPrompt(card, values) {
    return String(card.template).replace(/\{(\w+)\}/g, function (m, key) {
      var v = (values[key] || "").trim();
      if (v) return v;
      var f = (card.fields || []).find(function (x) { return x.key === key; });
      return f && f.placeholder ? f.placeholder : m;
    });
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

  /* ── 네이버 발행 목록 ──────────────────────────────── */

  var CAT_LABEL = { medical: "병의원", transfer: "양도" };

  function catLabel(c) { return CAT_LABEL[c] || "미분류"; }

  // 발행 체크 상태는 이 브라우저에만 남는다 (파일을 고치지는 못한다)
  function pubKey(file) { return "naver-pub:" + file; }

  function loadPub(file) {
    try { return JSON.parse(localStorage.getItem(pubKey(file))) || {}; }
    catch (e) { return {}; }
  }

  function savePub(file, data) {
    try { localStorage.setItem(pubKey(file), JSON.stringify(data)); }
    catch (e) { /* 저장 못 해도 화면은 그대로 동작한다 */ }
  }

  function copyButton(label, getText) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "mini-btn";
    b.textContent = label;
    b.addEventListener("click", function () {
      copyText(getText()).then(function () {
        var old = b.textContent;
        b.textContent = "복사됨 ✓";
        b.classList.add("copied");
        setTimeout(function () {
          b.textContent = old;
          b.classList.remove("copied");
        }, 1500);
      });
    });
    return b;
  }

  function renderReadyPost(p) {
    var el = document.createElement("article");
    el.className = "post";

    var flagCount = (p.flags || []).length;
    el.innerHTML =
      '<button class="post-hd" type="button">' +
        '<span class="post-main">' +
          '<span class="post-title">' + escapeHtml(p.title) + "</span>" +
          '<span class="post-meta">' +
            '<span class="tag">' + (p.charCount || 0).toLocaleString() + "자</span>" +
            '<span class="tag">태그 ' + (p.tags || []).length + "개</span>" +
            (flagCount
              ? '<span class="tag" style="background:var(--rose);color:var(--rose-t)">검토 '
                + flagCount + "건</span>"
              : "") +
          "</span>" +
        "</span>" +
        '<span class="chev">▸</span>' +
      "</button>" +
      '<div class="post-body"></div>';

    var hd = el.querySelector(".post-hd");
    hd.addEventListener("click", function () { el.classList.toggle("open"); });

    var body = el.querySelector(".post-body");

    if (p.malformed) {
      var warn = document.createElement("div");
      warn.className = "flagbox";
      warn.style.marginTop = "14px";
      warn.innerHTML = "<li>형식이 어긋납니다 — 빠진 섹션: "
        + escapeHtml(p.malformed.join(", ")) + "</li>";
      body.appendChild(warn);
    }

    // 제목 후보
    body.appendChild(label("제목 후보"));
    (p.titleCandidates || []).forEach(function (t, i) {
      var row = document.createElement("div");
      row.className = "tcand";
      row.innerHTML = '<span class="tcand-n">' + (i + 1) + "</span>"
        + '<span class="tcand-t">' + escapeHtml(t) + "</span>"
        + '<span class="tcand-len">' + t.length + "자</span>";
      row.appendChild(copyButton("복사", function () { return t; }));
      body.appendChild(row);
    });

    // 본문
    var bh = label("본문");
    bh.appendChild(copyButton("본문 전체 복사", function () { return p.body || ""; }));
    body.appendChild(bh);
    var pre = document.createElement("div");
    pre.className = "body-box";
    pre.textContent = p.body || "";
    body.appendChild(pre);

    // 태그
    var th = label("태그");
    th.appendChild(copyButton("태그 복사", function () {
      return (p.tags || []).join(", ");
    }));
    body.appendChild(th);
    var tb = document.createElement("div");
    tb.className = "tag-box";
    (p.tags || []).forEach(function (t) {
      var s = document.createElement("span");
      s.className = "tag";
      s.textContent = "#" + t;
      tb.appendChild(s);
    });
    body.appendChild(tb);

    // 리포트
    if (p.report) {
      body.appendChild(label("리포트"));
      var r = document.createElement("div");
      r.className = "rep";
      r.textContent = p.report;
      body.appendChild(r);
    }

    // 검토 필요
    if (flagCount) {
      body.appendChild(label("검토 필요"));
      var fb = document.createElement("ul");
      fb.className = "flagbox";
      p.flags.forEach(function (f) {
        var li = document.createElement("li");
        li.textContent = f;
        fb.appendChild(li);
      });
      body.appendChild(fb);
    }

    body.appendChild(publishBlock(p));
    return el;
  }

  function label(text) {
    var d = document.createElement("div");
    d.className = "sublabel";
    d.style.display = "flex";
    d.style.alignItems = "center";
    d.style.gap = "10px";
    d.appendChild(document.createTextNode(text));
    return d;
  }

  function publishBlock(p) {
    var saved = loadPub(p.file);
    var wrap = document.createElement("div");
    wrap.className = "pub";

    var lab = document.createElement("label");
    lab.className = "pub-check";
    var cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !!saved.done;
    lab.appendChild(cb);
    lab.appendChild(document.createTextNode("발행 완료"));
    wrap.appendChild(lab);

    var form = document.createElement("div");
    form.className = "pub-form" + (saved.done ? " on" : "");
    var input = document.createElement("input");
    input.type = "url";
    input.placeholder = "https://blog.naver.com/...";
    input.value = saved.url || "";
    form.appendChild(input);

    var cmd = document.createElement("div");
    cmd.className = "pub-cmd";
    form.appendChild(cmd);

    var actions = document.createElement("div");
    actions.style.marginTop = "9px";
    actions.appendChild(copyButton("명령 복사", function () { return cmdText(); }));
    form.appendChild(actions);

    var note = document.createElement("p");
    note.className = "cap";
    note.textContent = "이 체크는 브라우저에만 남습니다. 파일을 실제로 옮기려면 "
      + "위 명령을 클로드 코드에서 실행하세요.";
    form.appendChild(note);

    wrap.appendChild(form);

    function cmdText() {
      return "/naver-done " + p.path + " " + (input.value.trim() || "<발행 URL>");
    }
    function sync() {
      cmd.textContent = cmdText();
      savePub(p.file, { done: cb.checked, url: input.value.trim() });
    }
    cb.addEventListener("change", function () {
      form.classList.toggle("on", cb.checked);
      sync();
    });
    input.addEventListener("input", sync);
    cmd.textContent = cmdText();

    return wrap;
  }

  function renderDraft(p) {
    var el = document.createElement("article");
    el.className = "post";
    el.innerHTML =
      '<div class="post-hd" style="cursor:default">' +
        '<span class="post-main">' +
          '<span class="post-title">' + escapeHtml(p.title) + "</span>" +
          '<span class="post-meta">' +
            '<span class="tag">' + escapeHtml(catLabel(p.category)) + "</span>" +
            '<span class="tag wait">변환 전</span>' +
          "</span>" +
        "</span>" +
      "</div>" +
      '<div class="draft-cmd" style="padding:0 19px 16px">' +
        '<div class="pub-cmd">/naver-ready ' + escapeHtml(p.path) + "</div>" +
        '<div style="margin-top:9px"></div>' +
      "</div>";
    el.querySelector(".draft-cmd > div:last-child").appendChild(
      copyButton("명령 복사", function () { return "/naver-ready " + p.path; })
    );
    return el;
  }

  function renderPosts() {
    var readyBox = document.getElementById("ready-list");
    var draftBox = document.getElementById("draft-list");
    if (!readyBox && !draftBox) return;
    var all = typeof POSTS === "undefined" ? [] : POSTS;

    if (readyBox) {
      var ready = all.filter(function (p) { return p.stage === "ready"; });
      if (!ready.length) {
        readyBox.innerHTML = '<div class="empty">발행 대기 중인 글이 없습니다. '
          + "<code>/naver-ready &lt;초안경로&gt;</code>로 초안을 변환하세요.</div>";
      } else {
        ["medical", "transfer"].concat(
          // 위 두 분류에 안 잡히는 값이 있으면 뒤에 붙인다
          ready.map(function (p) { return p.category; })
               .filter(function (c) { return c !== "medical" && c !== "transfer"; })
        ).filter(function (c, i, a) { return a.indexOf(c) === i; })
         .forEach(function (cat) {
          var list = ready.filter(function (p) { return p.category === cat; });
          if (!list.length) return;
          var block = document.createElement("div");
          block.className = "cat-block";
          block.innerHTML = '<div class="cat-hd"><b>' + escapeHtml(catLabel(cat))
            + "</b><span>" + list.length + "건</span></div>";
          list.forEach(function (p) { block.appendChild(renderReadyPost(p)); });
          readyBox.appendChild(block);
        });
      }
    }

    if (draftBox) {
      var drafts = all.filter(function (p) {
        return p.stage === "drafts" && !p.convertedAlready;
      });
      if (!drafts.length) {
        draftBox.innerHTML = '<div class="empty">변환을 기다리는 초안이 없습니다.</div>';
      } else {
        drafts.forEach(function (p) { draftBox.appendChild(renderDraft(p)); });
      }
    }
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
