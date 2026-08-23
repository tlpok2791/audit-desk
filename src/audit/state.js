/*
 * engagement(회사 × 결산일) 상태와 정산표 전역 보관소.
 *
 * 저장 위치
 *   - 브라우저 IndexedDB : 작업 중 자동 보관. 새로고침해도 남는다.
 *   - work/<회사코드>/<결산일>/ : 사용자가 내려받은 meta.json·worksheet.json 을 직접 넣는 곳.
 *     브라우저는 디스크에 쓸 수 없으므로 "저장" 버튼이 파일을 내려주고, 사람이 그 폴더에 넣는다.
 *     work/ 는 .gitignore 로 막혀 있어 실제 감사 데이터가 커밋되지 않는다.
 */
(function (root) {
  "use strict";

  var DB_NAME = "audit-desk";
  var DB_VER = 3;
  var STORE_ENG = "engagements";
  var STORE_WS = "worksheets";
  var STORE_COA = "coamaps";      // 회사코드 → COA 매핑표
  var STORE_SRC = "sources";      // engagement → 작업 중이던 원본·분개 (보관을 켠 경우에만)

  // 원본 보관 스위치. 켜면 업로드한 시산표·재무제표가 이 브라우저에 남는다.
  var KEEP_KEY = "audit-desk:keepSources";

  var listeners = [];
  var state = {
    engagements: [],   // [meta]
    currentId: null,
    worksheet: null,   // 현재 engagement 의 정산표
  };

  /* ── IndexedDB ─────────────────────────────────────── */
  function openDB() {
    return new Promise(function (resolve, reject) {
      if (!root.indexedDB) return reject(new Error("이 브라우저는 IndexedDB를 지원하지 않습니다."));
      var req = root.indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE_ENG)) db.createObjectStore(STORE_ENG, { keyPath: "id" });
        if (!db.objectStoreNames.contains(STORE_WS)) db.createObjectStore(STORE_WS, { keyPath: "id" });
        if (!db.objectStoreNames.contains(STORE_COA)) db.createObjectStore(STORE_COA, { keyPath: "id" });
        if (!db.objectStoreNames.contains(STORE_SRC)) db.createObjectStore(STORE_SRC, { keyPath: "id" });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function tx(store, mode, fn) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(store, mode);
        var s = t.objectStore(store);
        var out;
        try { out = fn(s); } catch (e) { reject(e); return; }
        t.oncomplete = function () { resolve(out && out.result !== undefined ? out.result : out); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error); };
      });
    });
  }

  function idbGetAll(store) {
    return tx(store, "readonly", function (s) { return s.getAll(); });
  }
  function idbPut(store, value) {
    return tx(store, "readwrite", function (s) { return s.put(value); });
  }
  function idbGet(store, key) {
    return tx(store, "readonly", function (s) { return s.get(key); });
  }
  function idbDelete(store, key) {
    return tx(store, "readwrite", function (s) { return s.delete(key); });
  }

  /* ── engagement ────────────────────────────────────── */
  function engagementId(meta) {
    return String(meta.회사코드 || "").trim() + "/" + String(meta.결산일 || "").trim();
  }

  function label(meta) {
    return (meta.회사명 || meta.회사코드 || "-") + " · " + (meta.결산일 || "-");
  }

  /** work/ 안의 저장 경로 — 화면 안내와 파일명에 쓴다 */
  function workPath(meta) {
    return "work/" + String(meta.회사코드 || "").trim() + "/" + String(meta.결산일 || "").trim() + "/";
  }

  function current() {
    return state.engagements.find(function (e) { return e.id === state.currentId; }) || null;
  }

  function notify() {
    listeners.forEach(function (fn) { try { fn(state); } catch (e) { console.error(e); } });
  }

  function subscribe(fn) { listeners.push(fn); return fn; }

  /* ── 공개 API ──────────────────────────────────────── */
  function init() {
    return idbGetAll(STORE_ENG)
      .then(function (list) {
        state.engagements = (list || []).sort(function (a, b) {
          return String(b.결산일).localeCompare(String(a.결산일));
        });
        var saved = null;
        try { saved = localStorage.getItem("audit-desk:current"); } catch (e) {}
        if (saved && state.engagements.some(function (e) { return e.id === saved; })) {
          state.currentId = saved;
        } else if (state.engagements.length) {
          state.currentId = state.engagements[0].id;
        }
        return state.currentId ? loadWorksheet(state.currentId) : null;
      })
      .then(function () { notify(); return state; })
      .catch(function (e) {
        console.warn("상태를 불러오지 못했습니다:", e);
        notify();
        return state;
      });
  }

  function saveEngagement(meta) {
    var rec = Object.assign({}, meta);
    rec.id = engagementId(rec);
    rec.updated_at = new Date().toISOString();
    return idbPut(STORE_ENG, rec).then(function () {
      var i = state.engagements.findIndex(function (e) { return e.id === rec.id; });
      if (i === -1) state.engagements.unshift(rec); else state.engagements[i] = rec;
      state.currentId = rec.id;
      try { localStorage.setItem("audit-desk:current", rec.id); } catch (e) {}
      return loadWorksheet(rec.id);
    }).then(function () { notify(); return rec; });
  }

  function setCurrent(id) {
    state.currentId = id || null;
    try {
      if (id) localStorage.setItem("audit-desk:current", id);
      else localStorage.removeItem("audit-desk:current");
    } catch (e) {}
    return loadWorksheet(id).then(function () { notify(); return state; });
  }

  function removeEngagement(id) {
    return Promise.all([idbDelete(STORE_ENG, id), idbDelete(STORE_WS, id),
                        idbDelete(STORE_SRC, id)]).then(function () {
      state.engagements = state.engagements.filter(function (e) { return e.id !== id; });
      if (state.currentId === id) {
        state.currentId = state.engagements.length ? state.engagements[0].id : null;
      }
      return setCurrent(state.currentId);
    });
  }

  function loadWorksheet(id) {
    if (!id) { state.worksheet = null; return Promise.resolve(null); }
    return idbGet(STORE_WS, id).then(function (rec) {
      state.worksheet = rec ? rec.data : null;
      return state.worksheet;
    }).catch(function () { state.worksheet = null; return null; });
  }

  /** 정산표를 브라우저에 보관한다 (파일 저장은 별도 버튼) */
  function saveWorksheet(ws) {
    var id = state.currentId;
    if (!id) return Promise.reject(new Error("engagement가 선택되지 않았습니다."));
    return idbPut(STORE_WS, { id: id, data: ws, updated_at: ws.updated_at })
      .then(function () { state.worksheet = ws; notify(); return ws; });
  }

  /** 파일에서 정산표를 불러온다 (새로고침·다른 PC 대응) */
  function importWorksheet(ws) {
    state.worksheet = ws;
    var id = state.currentId;
    // 파일의 meta 로 engagement 를 맞춰준다
    if (ws.meta && ws.meta.회사코드) {
      var wid = engagementId(ws.meta);
      var exists = state.engagements.some(function (e) { return e.id === wid; });
      if (!exists) return saveEngagement(ws.meta).then(function () { return saveWorksheet(ws); });
      if (id !== wid) {
        return setCurrent(wid).then(function () { return saveWorksheet(ws); });
      }
    }
    return saveWorksheet(ws);
  }

  function getState() { return state; }

  /* ── 작업 중이던 원본 보관 ─────────────────────────── */
  /*
   * 업로드한 시산표·재무제표(파싱 결과)와 매핑·분개·증감사유를 engagement 단위로 남긴다.
   * 새로고침하거나 다른 engagement를 다녀와도 이어서 작업할 수 있다.
   *
   * 실제 감사 금액이 이 브라우저에 남으므로 끌 수 있게 해 두었다.
   * 끄면 즉시 보관본을 지운다.
   */
  function keepSources() {
    try {
      var v = localStorage.getItem(KEEP_KEY);
      return v === null ? true : v === "1";     // 기본값: 보관함
    } catch (e) { return false; }
  }

  function setKeepSources(on) {
    try { localStorage.setItem(KEEP_KEY, on ? "1" : "0"); } catch (e) {}
    if (!on) return clearAllSources();
    return Promise.resolve();
  }

  /**
   * forId 를 반드시 받아 쓴다. 저장은 디바운스되므로 그 사이에 engagement 를 바꾸면
   * 실행 시점의 currentId 로는 A 의 자료가 B 밑으로 들어간다.
   */
  function saveSources(payload, forId) {
    var id = forId || state.currentId;
    if (!id || !keepSources()) return Promise.resolve(null);
    return idbPut(STORE_SRC, Object.assign({ id: id, savedAt: new Date().toISOString() }, payload))
      .catch(function (e) {
        // 용량 초과 등 — 작업은 계속되게 두고 알리기만 한다
        console.warn("원본을 보관하지 못했습니다:", e && e.name, e && e.message);
        return null;
      });
  }

  function loadSources(id) {
    if (!keepSources()) return Promise.resolve(null);
    return idbGet(STORE_SRC, id || state.currentId)
      .then(function (rec) { return rec || null; })
      .catch(function () { return null; });
  }

  function clearSources(id) {
    return idbDelete(STORE_SRC, id || state.currentId).catch(function () {});
  }

  function clearAllSources() {
    return tx(STORE_SRC, "readwrite", function (s) { return s.clear(); })
      .catch(function (e) { console.warn("보관본을 지우지 못했습니다:", e); });
  }

  /** 보관본이 차지하는 대략적인 크기 (화면 안내용) */
  function sourcesInfo() {
    return idbGetAll(STORE_SRC).then(function (list) {
      var bytes = 0;
      (list || []).forEach(function (rec) {
        try { bytes += JSON.stringify(rec).length; } catch (e) {}
      });
      return { count: (list || []).length, bytes: bytes };
    }).catch(function () { return { count: 0, bytes: 0 }; });
  }

  /* ── COA 매핑표 ────────────────────────────────────── */
  /** 브라우저 보관 (파일 저장은 화면의 "매핑 저장" 버튼) */
  function saveCoaMap(companyCode, map) {
    return idbPut(STORE_COA, { id: companyCode, data: map }).catch(function (e) {
      console.warn("COA 매핑을 보관하지 못했습니다:", e);
    });
  }

  /**
   * 저장된 매핑을 찾는다.
   * 1) config/coa-map/<회사코드>.json  — 저장소에 커밋해 둔 것 (다음 기수에 그대로 쓰인다)
   * 2) 브라우저 보관본                — 아직 파일로 안 옮긴 것
   */
  function loadCoaMap(companyCode) {
    if (!companyCode) return Promise.resolve(null);
    return fetch("config/coa-map/" + encodeURIComponent(companyCode) + ".json", { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .catch(function () {
        return idbGet(STORE_COA, companyCode).then(function (rec) {
          return rec ? rec.data : null;
        }).catch(function () { return null; });
      });
  }

  root.AuditState = {
    init: init,
    subscribe: subscribe,
    getState: getState,
    current: current,
    engagementId: engagementId,
    label: label,
    workPath: workPath,
    saveEngagement: saveEngagement,
    setCurrent: setCurrent,
    removeEngagement: removeEngagement,
    saveWorksheet: saveWorksheet,
    importWorksheet: importWorksheet,
    loadWorksheet: loadWorksheet,
    saveCoaMap: saveCoaMap,
    loadCoaMap: loadCoaMap,
    keepSources: keepSources,
    setKeepSources: setKeepSources,
    saveSources: saveSources,
    loadSources: loadSources,
    clearSources: clearSources,
    clearAllSources: clearAllSources,
    sourcesInfo: sourcesInfo,
    notify: notify,
  };
})(typeof self !== "undefined" ? self : this);
