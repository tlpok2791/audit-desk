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

  /* ── 카테고리 아이콘 ──────────────────────────────────────
     카테고리 id 로 찾는다. 없으면 기본 아이콘이 나온다.
     src/data/tools.js 에 새 카테고리를 넣으면 여기에도 한 줄 추가하면 된다. */
  var ICONS = {
    mine:       '<rect x="3" y="8" width="18" height="11" rx="1.5"/>'
              + '<path d="M8 8V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18"/>',
    nts:        '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h5"/>',
    disclosure: '<path d="M4 20h16"/><rect x="6" y="11" width="3" height="6"/>'
              + '<rect x="10.5" y="7" width="3" height="10"/>'
              + '<rect x="15" y="13" width="3" height="4"/>',
    registry:   '<path d="M12 4v15M6 19h12M4 8h16"/>'
              + '<path d="M7 8l-3 5h6zM17 8l3 5h-6z"/>',
    market:     '<circle cx="12" cy="12" r="8"/>'
              + '<path d="M4 12h16M12 4c2.4 2.7 2.4 12.3 0 16M12 4c-2.4 2.7-2.4 12.3 0 16"/>',
    labor:      '<circle cx="9" cy="8" r="3"/><path d="M3 19a6 6 0 0 1 12 0"/>'
              + '<path d="M16 5.6a3 3 0 0 1 0 5.8M17 14.2A5.5 5.5 0 0 1 21 19"/>',
    trade:      '<path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5z"/>'
              + '<path d="M3.5 7.5 12 12l8.5-4.5M12 12v9"/>',
    calc:       '<rect x="5" y="3" width="14" height="18" rx="1.5"/>'
              + '<rect x="8" y="6.5" width="8" height="3"/>'
              + '<path d="M8.6 13.5h.01M12 13.5h.01M15.4 13.5h.01'
              + 'M8.6 17.2h.01M12 17.2h.01M15.4 17.2h.01"/>',
    fav:        '<path d="m12 4 2.5 5 5.5.8-4 3.9.9 5.5L12 16.6 7.1 19.2l.9-5.5-4-3.9L9.5 9z"/>',
    _default:   '<rect x="4" y="4" width="16" height="16" rx="2"/>'
              + '<path d="M8 9h8M8 13h8M8 17h5"/>'
  };

  function icon(id) {
    var box = document.createElement("div");
    box.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">'
                  + (ICONS[id] || ICONS._default) + "</svg>";
    return box.firstChild;
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
    var row = el("div", "trow" + (item.soon ? " soon" : "")
                              + (item.hi ? " hi" : ""));

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
    else if (item.hi) main.appendChild(el("span", "trow-ext", "→"));
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
  // pairs 는 [{ cat: 카테고리, item: 도구 }, ...].
  // 즐겨찾기 카드는 도구마다 원래 카테고리가 다르므로 짝으로 받는다.
  function renderCard(head, pairs, favs, refresh, cls) {
    var card = el("div", "tcard" + (cls ? " " + cls : ""));

    var hd = el("div", "tcard-hd");
    var top = el("div", "t");
    top.appendChild(icon(head.id));
    top.appendChild(el("b", null, head.title));
    hd.appendChild(top);
    if (head.desc) hd.appendChild(el("em", null, head.desc));
    card.appendChild(hd);

    var body = el("div", "tcard-body");
    pairs.forEach(function (p) {
      body.appendChild(renderItem(p.cat, p.item, favs, refresh));
    });
    card.appendChild(body);
    return card;
  }

  /* ── 전체 ─────────────────────────────────────────────── */
  function render(host, goto) {
    onGoto = goto || onGoto;
    host.innerHTML = "";
    // 도구는 칸이 많아 본문보다 넓게 쓴다. 그 폭을 잡아 주는 상자.
    var box = el("div", "thub");
    host.appendChild(box);
    host = box;

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
      // 즐겨찾기도 같은 카드 모양. 폭이 넓어 안에서 여러 단으로 나뉜다.
      host.appendChild(renderCard(
        { id: "fav", title: "자주 쓰는 도구", desc: "★ 를 누른 항목만 모아 둡니다" },
        picked, favs, refresh, "tfav"));
    }

    /* 카테고리 그리드 */
    var grid = el("div", "tgrid");
    var shown = 0;
    all.forEach(function (cat) {
      var pairs = (cat.items || [])
        .filter(function (item) { return matches(cat, item); })
        .map(function (item) { return { cat: cat, item: item }; });
      if (!pairs.length) return;
      shown += pairs.length;
      grid.appendChild(renderCard(cat, pairs, favs, refresh));
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
