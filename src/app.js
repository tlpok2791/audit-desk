/*
 * 탭 전환 + 기능 카드 렌더링.
 * src/data/cards.js의 CARDS 배열을 읽어 [data-cards="탭키"] 컨테이너마다
 * 입력 필드·실시간 프롬프트 미리보기·복사 버튼이 달린 카드를 그린다.
 */
(function () {
  document.addEventListener("DOMContentLoaded", function () {
    renderAllCards();
    renderPosts();
    decorateTabs();
    setupTabs();
    renderHome();
    loadAdRules();
  });

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function buildPrompt(card, values) {
    var out = String(card.template).replace(/\{(\w+)\}/g, function (m, key) {
      if (key === "rules") return card.injectRules ? adRules.text : m;
      var v = (values[key] || "").trim();
      if (v) return v;
      var f = (card.fields || []).find(function (x) { return x.key === key; });
      return f && f.placeholder ? f.placeholder : m;
    });
    // {rules} 자리를 안 잡아둔 카드는 맨 뒤에 붙인다
    if (card.injectRules && String(card.template).indexOf("{rules}") === -1) {
      out += "\n\n" + adRules.text;
    }
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
    // 규칙 필터가 바뀌면 이 카드의 미리보기도 다시 그린다
    if (card.injectRules) adRules.subscribers.push(update);

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
            (p.imageSlots
              ? '<span class="tag">이미지 ' + p.imageSlots + "곳</span>" : "") +
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

    // 본문 — 전체 복사는 그대로 두고, 이미지 자리가 있으면 조각별 보기를 덧붙인다
    var bh = label("본문");
    bh.appendChild(copyButton("본문 전체 복사", function () { return p.body || ""; }));
    body.appendChild(bh);
    var pre = document.createElement("div");
    pre.className = "body-box";
    pre.textContent = p.body || "";
    body.appendChild(pre);

    var segs = p.segments || [];
    var hasImg = segs.some(function (g) { return g.type === "image"; });
    if (hasImg) {
      var sh = label("옮겨 붙이는 순서 (이미지 " + (p.imageSlots || 0) + "곳)");
      body.appendChild(sh);
      var n = 0;
      segs.forEach(function (g) {
        if (g.type === "image") {
          var im = document.createElement("div");
          im.className = "seg-img";
          im.innerHTML = "<b>🖼 이미지 " + escapeHtml(g.no) + " 자리</b>";
          var sp = document.createElement("span");
          sp.textContent = g.desc || "아래 이미지 제작 목록의 " + g.no + "번을 넣습니다";
          im.appendChild(sp);
          body.appendChild(im);
          return;
        }
        n += 1;
        var box = document.createElement("div");
        box.className = "seg";
        var hd = document.createElement("div");
        hd.className = "seg-hd";
        hd.innerHTML = '<span class="grow">본문 ' + n + "번째 조각 · "
          + g.text.length.toLocaleString() + "자</span>";
        hd.appendChild(copyButton("이 조각 복사", function () { return g.text; }));
        box.appendChild(hd);
        var tx = document.createElement("div");
        tx.className = "seg-txt";
        tx.textContent = g.text;
        box.appendChild(tx);
        body.appendChild(box);
      });
    }

    // 이미지 제작 목록 — 어떤 이미지를 만들어야 하는지
    var specs = p.imageSpecs || [];
    var specRaw = p.imageSpecsRaw || "";
    if (specs.length || specRaw) {
      var ih = label("이미지 제작 목록");
      ih.appendChild(copyButton("이미지 목록 복사", function () { return specRaw; }));
      body.appendChild(ih);
      if (specs.length) {
        specs.forEach(function (sp) {
          var card = document.createElement("div");
          card.className = "imgspec";
          var h = document.createElement("h4");
          h.textContent = "이미지 " + sp.no;
          card.appendChild(h);
          var dl = document.createElement("dl");
          (sp.fields || []).forEach(function (f) {
            var dt = document.createElement("dt");
            dt.textContent = f.k;
            var dd = document.createElement("dd");
            dd.textContent = f.v;
            dl.appendChild(dt);
            dl.appendChild(dd);
          });
          card.appendChild(dl);
          card.appendChild(copyButton("이 이미지 설명 복사", function () {
            return "이미지 " + sp.no + "\n"
              + (sp.fields || []).map(function (f) { return "- " + f.k + ": " + f.v; })
                  .join("\n");
          }));
          body.appendChild(card);
        });
      } else {
        var raw = document.createElement("div");
        raw.className = "body-box";
        raw.textContent = specRaw;
        body.appendChild(raw);
      }
    }

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

    // 리포트 — 키워드 등장 횟수는 코드가 센 값이다
    var hits = p.keywordHits || [];
    if (p.report || hits.length) {
      body.appendChild(label("리포트"));
      if (hits.length) {
        var kr = document.createElement("div");
        kr.className = "kwrow";
        hits.forEach(function (h) {
          var b = document.createElement("span");
          b.className = "kw" + (h.n === 0 ? " zero" : "");
          b.textContent = h.k + " " + h.n + "회";
          kr.appendChild(b);
        });
        body.appendChild(kr);
      }
      if (p.report) {
        var r = document.createElement("div");
        r.className = "rep";
        r.textContent = p.report;
        body.appendChild(r);
      }
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

  /* ── 광고 규칙 (노션 KB 동기화 결과) ─────────────────── */

  var adRules = {
    data: null,          // { schema, rows, synced_at }
    source: "",          // 어느 파일을 읽었는지
    filters: {},         // { 속성명: 문자열 | [문자열] }
    filtered: [],
    text: "(광고 규칙을 불러오지 못했습니다)",
    subscribers: [],
  };

  // 필터 UI를 만들 수 있는 타입. 여기 없는 타입은 필터에 안 나오되 규칙 본문에는 쓰인다.
  var FILTERABLE = { select: 1, status: 1, multi_select: 1, checkbox: 1 };

  function loadAdRules() {
    var box = document.getElementById("ad-filters");
    if (!box) return;

    // 실제 동기화 결과가 없으면 샘플로 화면을 확인할 수 있게 한다
    tryFetch("config/ad-rules.json")
      .catch(function () {
        return tryFetch("config/ad-rules.sample.json").then(function (d) {
          d.__sample = true;
          return d;
        });
      })
      .then(function (data) {
        adRules.data = data;
        adRules.source = data.__sample
          ? "config/ad-rules.sample.json (예시 데이터 — 아직 동기화 전입니다)"
          : "config/ad-rules.json · 동기화 " + fmtDate(data.synced_at);
        renderAdFilters(box);
      })
      .catch(function () {
        box.innerHTML = '<div class="empty">광고 규칙을 불러오지 못했습니다.<br>'
          + "<code>node scripts/sync-ad-rules.js</code>로 노션에서 동기화해 주세요.</div>";
        adRules.text = "(광고 규칙 없음)";
        notifyRules();
      });
  }

  function tryFetch(url) {
    return fetch(url, { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    });
  }

  function fmtDate(iso) {
    if (!iso) return "-";
    var d = new Date(iso);
    return isNaN(d) ? String(iso) : d.toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
  }

  function renderAdFilters(box) {
    var schema = (adRules.data && adRules.data.schema) || [];
    var facets = schema.filter(function (s) { return FILTERABLE[s.type]; });

    box.innerHTML = "";
    var panel = document.createElement("div");
    panel.className = "filters";

    var grid = document.createElement("div");
    grid.className = "filter-grid";

    facets.forEach(function (f) {
      var cell = document.createElement("div");
      cell.className = "filt";
      var name = document.createElement("div");
      name.className = "filt-name";
      name.innerHTML = escapeHtml(f.name) + "<em>" + escapeHtml(f.type) + "</em>";
      cell.appendChild(name);

      if (f.type === "multi_select") {
        adRules.filters[f.name] = [];
        var chips = document.createElement("div");
        chips.className = "chips";
        optionsFor(f).forEach(function (opt) {
          var lab = document.createElement("label");
          lab.className = "chip";
          var cb = document.createElement("input");
          cb.type = "checkbox";
          cb.value = opt;
          cb.addEventListener("change", function () {
            var sel = adRules.filters[f.name];
            var i = sel.indexOf(opt);
            if (cb.checked && i === -1) sel.push(opt);
            if (!cb.checked && i !== -1) sel.splice(i, 1);
            lab.classList.toggle("on", cb.checked);
            applyAdFilters();
          });
          lab.appendChild(cb);
          lab.appendChild(document.createTextNode(opt));
          chips.appendChild(lab);
        });
        cell.appendChild(chips);
      } else {
        adRules.filters[f.name] = "";
        var sel = document.createElement("select");
        var opts = f.type === "checkbox" ? ["예", "아니오"] : optionsFor(f);
        sel.appendChild(new Option("전체", ""));
        opts.forEach(function (o) { sel.appendChild(new Option(o, o)); });
        sel.addEventListener("change", function () {
          adRules.filters[f.name] = sel.value;
          applyAdFilters();
        });
        cell.appendChild(sel);
      }
      grid.appendChild(cell);
    });

    if (!facets.length) {
      grid.innerHTML = '<p class="cap">필터로 쓸 수 있는 속성(선택·다중선택·체크박스)이 없습니다.</p>';
    }
    panel.appendChild(grid);

    var bar = document.createElement("div");
    bar.className = "filter-bar";
    bar.innerHTML = '<span class="hitcount"></span>'
      + '<span class="src-note">' + escapeHtml(adRules.source) + "</span>";
    panel.appendChild(bar);

    var list = document.createElement("div");
    list.className = "rule-list";
    panel.appendChild(list);

    box.appendChild(panel);
    adRules._hit = bar.querySelector(".hitcount");
    adRules._list = list;
    applyAdFilters();
  }

  /** 스키마에 options가 없으면 실제 행에서 값을 모아 만든다 */
  function optionsFor(f) {
    if (f.options && f.options.length) return f.options;
    var seen = [];
    (adRules.data.rows || []).forEach(function (r) {
      var v = r.props[f.name];
      (Array.isArray(v) ? v : [v]).forEach(function (x) {
        if (x && seen.indexOf(x) === -1) seen.push(x);
      });
    });
    return seen;
  }

  function rowMatches(row) {
    return Object.keys(adRules.filters).every(function (name) {
      var want = adRules.filters[name];
      var got = row.props[name];

      if (Array.isArray(want)) {                       // multi_select — 고른 것 중 하나라도
        if (!want.length) return true;
        var have = Array.isArray(got) ? got : (got ? [got] : []);
        return want.some(function (w) { return have.indexOf(w) !== -1; });
      }
      if (!want) return true;                          // "전체"
      if (typeof got === "boolean") return got === (want === "예");
      return String(got == null ? "" : got) === want;
    });
  }

  function applyAdFilters() {
    var rows = (adRules.data && adRules.data.rows) || [];
    adRules.filtered = rows.filter(rowMatches);
    adRules.text = formatRules(adRules.filtered);

    if (adRules._hit) {
      adRules._hit.innerHTML = "규칙 <b>" + adRules.filtered.length + "</b>건 선택됨 "
        + '<span style="color:var(--faint)">/ 전체 ' + rows.length + "건</span>";
    }
    if (adRules._list) renderRuleList(adRules._list);
    notifyRules();
  }

  function notifyRules() {
    adRules.subscribers.forEach(function (fn) { try { fn(); } catch (e) {} });
  }

  /* 스키마를 보고 규칙을 문장으로 만든다 — 속성명을 코드에 박지 않는다 */
  function schemaOf() { return (adRules.data && adRules.data.schema) || []; }

  function titleKey() {
    var t = schemaOf().find(function (s) { return s.type === "title"; });
    return t ? t.name : null;
  }

  function metaPairs(row) {
    return schemaOf()
      .filter(function (s) {
        return ["select", "status", "multi_select", "number", "checkbox", "formula"]
          .indexOf(s.type) !== -1;
      })
      .map(function (s) {
        var v = row.props[s.name];
        if (v === null || v === undefined || v === "") return null;
        if (Array.isArray(v)) return v.length ? s.name + ": " + v.join("/") : null;
        if (typeof v === "boolean") return s.name + ": " + (v ? "예" : "아니오");
        return s.name + ": " + v;
      })
      .filter(Boolean);
  }

  function bodyTexts(row) {
    return schemaOf()
      .filter(function (s) { return s.type === "rich_text"; })
      .map(function (s) {
        var v = row.props[s.name];
        return v ? (s.name + ": " + v) : null;
      })
      .filter(Boolean);
  }

  function formatRules(rows) {
    if (!rows.length) {
      return "[적용 규칙]\n선택된 규칙이 없습니다. 위 필터에서 규칙을 고르면 여기에 삽입됩니다.";
    }
    var tk = titleKey();
    var lines = rows.map(function (r, i) {
      var name = tk ? (r.props[tk] || "(제목 없음)") : "규칙 " + (i + 1);
      var meta = metaPairs(r);
      var head = (i + 1) + ". " + name + (meta.length ? "  [" + meta.join(" · ") + "]" : "");
      var body = bodyTexts(r).map(function (t) { return "   " + t; });
      return [head].concat(body).join("\n");
    });
    return "[적용 규칙 " + rows.length + "건]\n" + lines.join("\n");
  }

  function renderRuleList(list) {
    list.innerHTML = "";
    if (!adRules.filtered.length) {
      list.innerHTML = '<div class="rule-row" style="color:var(--faint)">'
        + "조건에 맞는 규칙이 없습니다.</div>";
      return;
    }
    var tk = titleKey();
    adRules.filtered.forEach(function (r) {
      var row = document.createElement("div");
      row.className = "rule-row";
      var meta = metaPairs(r).map(function (m) {
        return "<span>" + escapeHtml(m) + "</span>";
      }).join("");
      var body = bodyTexts(r).join(" / ");
      row.innerHTML = "<b>" + escapeHtml(tk ? (r.props[tk] || "(제목 없음)") : "규칙") + "</b>"
        + (meta ? '<div class="rmeta">' + meta + "</div>" : "")
        + (body ? "<p>" + escapeHtml(body) + "</p>" : "");
      list.appendChild(row);
    });
  }

  /* 홈 타일 아이콘 — 이모지 대신 직접 그린다.
   * 이모지는 폰트마다 크기·두께·색이 달라 나란히 두면 정돈이 안 된다.
   * 전부 24×24 뷰박스, 선 두께 1.8, 둥근 끝으로 규격을 맞췄다. */
  var ICONS = {
    worksheet: '<rect x="3" y="3" width="18" height="18" rx="2.5"/><path d="M3 9h18M3 15h18M9 3v18"/>',
    ledger:    '<path d="M5 4a2 2 0 0 1 2-2h12v18H7a2 2 0 0 0-2 2z"/><path d="M9 7h6M9 11h6"/>',
    grid:      '<rect x="3" y="3" width="7.5" height="7.5" rx="2.2"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="2.2"/>'
             + '<rect x="3" y="13.5" width="7.5" height="7.5" rx="2.2"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2.2"/>',
    calc:      '<rect x="4" y="2" width="16" height="20" rx="2.5"/><path d="M8 6h8M8 11h.01M12 11h.01M16 11h.01'
             + 'M8 15h.01M12 15h.01M16 15h.01M8 19h8"/>',
    docCheck:  '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 15l2 2 4-4"/>',
    pen:       '<path d="M12 20h9"/><path d="M16.4 3.6a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    layers:    '<path d="M12 2l9 5-9 5-9-5z"/><path d="M3 12l9 5 9-5"/><path d="M3 17l9 5 9-5"/>',
    send:      '<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/>',
    shield:    '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>',
    trend:     '<path d="M3 17l6-6 4 4 7-7"/><path d="M14 7h6v6"/>',
    home:      '<path d="M3 10.5L12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5"/><path d="M9.5 21v-6h5v6"/>',
    folder:    '<path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    megaphone: '<path d="M3 11v2a1 1 0 0 0 1 1h2l6 4V6L6 10H4a1 1 0 0 0-1 1z"/><path d="M16 9a4 4 0 0 1 0 6"/><path d="M19 6.5a8 8 0 0 1 0 11"/>',
  };

  /* 상단 탭 버튼의 이모지도 같은 아이콘으로 바꾼다.
   * 타일만 그려 놓으면 탭이 따로 놀아 오히려 정돈이 덜 돼 보인다. */
  var TAB_ICONS = {
    home: "home", audit: "folder", tax: "calc", blog: "pen", ads: "megaphone",
  };

  function decorateTabs() {
    document.querySelectorAll(".tab-btn").forEach(function (b) {
      var key = TAB_ICONS[b.dataset.tab];
      if (!key) return;
      var label = b.textContent.replace(/^\s*\S+\s*/, "").trim();  // 앞 이모지 제거
      b.innerHTML = iconSvg(key) + "<span>" + escapeHtml(label) + "</span>";
    });
  }

  function iconSvg(name) {
    var d = ICONS[name] || ICONS.grid;
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" '
      + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + "</svg>";
  }

  /* ── 홈(런처) ──────────────────────────────────────────
   * 타일은 src/data/home.js 의 HOME_GROUPS 에서 나온다.
   * { card: "id" } 형태는 CARDS 에서 icon·title·desc·tab 을 끌어다 쓴다.
   * 두 군데 고칠 일이 없도록 카드가 원본이다. */
  var activateTab = null;   // setupTabs 가 채운다

  function countTools() {
    if (typeof TOOLS === "undefined") return 0;
    return TOOLS.reduce(function (n, c) { return n + (c.items || []).length; }, 0);
  }

  function countReady() {
    if (typeof POSTS === "undefined") return 0;
    return POSTS.filter(function (p) { return p.stage === "ready"; }).length;
  }

  function badgeValue(kind) {
    if (kind === "tools") return countTools();
    if (kind === "ready") return countReady();
    return 0;
  }

  /** { card: "id" } 를 실제 타일 정보로 편다 */
  function resolveTile(t) {
    if (!t.card) return t;
    var c = (typeof CARDS === "undefined" ? [] : CARDS)
      .find(function (x) { return x.id === t.card; });
    if (!c) return null;                       // 카드가 지워졌으면 타일도 빠진다
    return {
      name: c.title, desc: c.desc, svg: t.svg, tab: c.tab,
      badge: t.badge, sub: t.sub,
    };
  }

  function goTile(t) {
    if (t.url) {
      if (/^https?:/i.test(t.url)) window.open(t.url, "_blank", "noopener");
      else location.href = t.url;
      return;
    }
    if (!t.tab || !activateTab) return;
    activateTab(t.tab, true);
    if (t.sub && window.AuditTabs && window.AuditTabs.goto) window.AuditTabs.goto(t.sub);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function tileEl(t, color) {
    var b = document.createElement("button");
    b.className = "tile";
    b.type = "button";

    var n = badgeValue(t.badge);
    b.innerHTML =
      '<span class="tile-ic ' + color + '">' + iconSvg(t.svg) + "</span>" +
      '<span class="tile-tx"><b>' + escapeHtml(t.name) + "</b>" +
      "<span>" + escapeHtml(t.desc || "") + "</span></span>" +
      (t.badge && n ? '<span class="tile-bdg">' + n + "</span>" : "");

    b.addEventListener("click", function () { goTile(t); });
    return b;
  }

  function renderHome() {
    var host = document.getElementById("home-groups");
    if (!host || typeof HOME_GROUPS === "undefined") return;

    HOME_GROUPS.forEach(function (g) {
      var tiles = (g.tiles || []).map(resolveTile).filter(Boolean);
      if (!tiles.length) return;

      var sec = el("section", "hgroup");
      var hd = el("div", "hgroup-hd");
      hd.appendChild(el("b", null, g.title));
      hd.appendChild(el("i"));
      sec.appendChild(hd);

      var grid = el("div", "hgrid");
      tiles.forEach(function (t) { grid.appendChild(tileEl(t, g.color || "indigo")); });
      sec.appendChild(grid);
      host.appendChild(sec);
    });

    // 인사줄 — 실제 숫자만 쓴다
    var sub = document.getElementById("hi-sub");
    if (sub) {
      var bits = [];
      var r = countReady();
      if (r) bits.push("발행 대기 원고 " + r + "건");
      var tn = countTools();
      if (tn) bits.push("도구 " + tn + "개");
      sub.textContent = bits.join(" · ");
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

    activateTab = activate;          // 홈 타일이 탭을 바꿀 때 쓴다

    var initial = (location.hash || "").replace("#", "");
    activate(panels[initial] ? initial : "home", false);
  }
})();
