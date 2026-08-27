/*
 * 감사도구 > 도구 모음.
 *
 * src/data/tools.js 의 TOOLS 를 카테고리 카드로 그린다.
 * ★ 즐겨찾기는 이 브라우저에만 남는다 (localStorage). 서버로 가지 않는다.
 */
(function () {
  "use strict";

  var FAV_KEY = "audit-desk:tool-favs";
  var query = "";
  var onGoto = null;                 // 서브탭 이동 콜백 (tabs.js 가 넣어준다)

  /* ── 즐겨찾기 — 저장소가 막혀 있어도 화면은 떠야 한다 ── */
  function loadFavs() {
    try {
      var raw = localStorage.getItem(FAV_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  }

  function saveFavs(list) {
    try {
      localStorage.setItem(FAV_KEY, JSON.stringify(list));
    } catch (e) {
      /* 사생활 보호 모드 등 — 저장만 실패하고 화면은 그대로 돈다 */
    }
  }

  function isFav(favs, key) { return favs.indexOf(key) !== -1; }

  function toggleFav(key) {
    var favs = loadFavs();
    var i = favs.indexOf(key);
    if (i === -1) favs.push(key);
    else favs.splice(i, 1);
    saveFavs(favs);
  }

  /* ── 유틸 ─────────────────────────────────────────────── */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function keyOf(cat, item) { return cat.id + "/" + item.id; }

  function isExternal(url) { return /^https?:\/\//i.test(url || ""); }

  function matches(cat, item) {
    if (!query) return true;
    var q = query.toLowerCase();
    return (item.name || "").toLowerCase().indexOf(q) !== -1
        || (item.desc || "").toLowerCase().indexOf(q) !== -1
        || (cat.title || "").toLowerCase().indexOf(q) !== -1;
  }

  /* ── 도구 한 줄 ───────────────────────────────────────── */
  function renderItem(cat, item, favs, refresh) {
    var row = el("div", "trow" + (item.soon ? " soon" : ""));

    var main;
    if (item.soon) {
      main = el("span", "trow-main");
    } else if (item.url) {
      main = el("a", "trow-main");
      main.href = item.url;
      if (isExternal(item.url)) {
        main.target = "_blank";
        main.rel = "noopener noreferrer";
      }
    } else if (item.goto) {
      main = el("button", "trow-main");
      main.type = "button";
      main.addEventListener("click", function () {
        if (onGoto) onGoto(item.goto);
      });
    } else {
      main = el("span", "trow-main");
    }

    // 줄은 이름과 ★ 만 둔다. 설명은 올려놨을 때만 뜨게 해서 목록을 깨끗이 유지한다.
    if (item.desc) main.title = item.desc;
    main.appendChild(el("span", "trow-name", item.name));
    if (item.soon) main.appendChild(el("span", "trow-badge", "준비 중"));
    else if (item.url && isExternal(item.url)) main.appendChild(el("span", "trow-ext", "↗"));
    row.appendChild(main);

    var key = keyOf(cat, item);
    var star = el("button", "trow-star" + (isFav(favs, key) ? " on" : ""));
    star.type = "button";
    star.textContent = isFav(favs, key) ? "★" : "☆";
    star.title = isFav(favs, key) ? "즐겨찾기에서 빼기" : "즐겨찾기에 넣기";
    star.setAttribute("aria-label", item.name + " 즐겨찾기");
    star.addEventListener("click", function () {
      toggleFav(key);
      refresh();
    });
    row.appendChild(star);

    return row;
  }

  /* ── 카테고리 카드 ────────────────────────────────────── */
  function renderCard(cat, items, favs, refresh) {
    var card = el("div", "tcard");

    var hd = el("div", "tcard-hd");
    var txt = el("span", "tcard-txt");
    txt.appendChild(el("b", null, cat.title));
    if (cat.desc) txt.appendChild(el("em", null, cat.desc));
    hd.appendChild(txt);
    card.appendChild(hd);

    var body = el("div", "tcard-body");
    items.forEach(function (item) {
      body.appendChild(renderItem(cat, item, favs, refresh));
    });
    card.appendChild(body);
    return card;
  }

  /* ── 전체 ─────────────────────────────────────────────── */
  function render(host, goto) {
    onGoto = goto || onGoto;
    host.innerHTML = "";

    var all = (typeof TOOLS === "undefined") ? [] : TOOLS;
    if (!all.length) {
      host.appendChild(el("div", "empty",
        "도구 목록이 비어 있습니다. src/data/tools.js 를 확인하세요."));
      return;
    }

    var favs = loadFavs();
    function refresh() { render(host, onGoto); }

    /* 검색 */
    var bar = el("div", "tsearch");
    var input = el("input");
    input.type = "search";
    input.placeholder = "도구 이름으로 찾기";
    input.value = query;
    input.addEventListener("input", function () {
      query = input.value.trim();
      render(host, onGoto);
      var again = host.querySelector(".tsearch input");
      if (again) {
        again.focus();
        again.setSelectionRange(again.value.length, again.value.length);
      }
    });
    bar.appendChild(input);
    host.appendChild(bar);

    /* 자주 쓰는 도구 — ★ 를 누른 것만 위로 모은다 */
    var picked = [];
    all.forEach(function (cat) {
      (cat.items || []).forEach(function (item) {
        if (isFav(favs, keyOf(cat, item)) && matches(cat, item)) {
          picked.push({ cat: cat, item: item });
        }
      });
    });

    if (picked.length) {
      host.appendChild(el("div", "tsec", "자주 쓰는 도구"));
      var favBox = el("div", "tfav");
      picked.forEach(function (p) {
        favBox.appendChild(renderItem(p.cat, p.item, favs, refresh));
      });
      host.appendChild(favBox);
    }

    /* 카테고리 그리드 */
    var grid = el("div", "tgrid");
    var shown = 0;
    all.forEach(function (cat) {
      var items = (cat.items || []).filter(function (item) {
        return matches(cat, item);
      });
      if (!items.length) return;
      shown += items.length;
      grid.appendChild(renderCard(cat, items, favs, refresh));
    });

    if (!shown) {
      host.appendChild(el("div", "empty", "'" + query + "' 에 맞는 도구가 없습니다."));
      return;
    }
    host.appendChild(grid);

    var cap = el("p", "cap",
      "항목을 추가하려면 src/data/tools.js 를 고치세요. ★ 는 이 브라우저에만 저장됩니다.");
    cap.style.marginTop = "16px";
    host.appendChild(cap);
  }

  window.AuditHub = { render: render };
})();
