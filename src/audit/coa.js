/*
 * 표준 COA 매핑 — 회사 계정과목명을 표준 계정과목에 붙인다.
 *
 * 회사마다 회계프로그램과 계정과목명이 다르므로 이 단계를 건너뛸 수 없다.
 * 유사도로 후보를 제안하지만 절대 자동 확정하지 않는다. 사람이 고른다.
 *
 * DOM을 건드리지 않는 순수 로직. scripts/coa.test.js 가 그대로 불러 검증한다.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.COA = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ── 정규화 ────────────────────────────────────────── */
  // 계정과목명 비교용. 공백·괄호·중점 등을 털어내고 흔한 이형을 통일한다.
  var SYNONYM = [
    [/현금및현금성자산|현금및현금등가물|현금성자산/g, "현금"],
    [/보통예금|당좌예금|제예금/g, "현금"],
    [/외상매출금|받을어음/g, "매출채권"],
    [/외상매입금|지급어음/g, "매입채무"],
    [/감가상각누계|상각누계/g, "감가상각누계액"],
    [/접대비|기업업무추진비/g, "접대비"],
    [/복리후생|후생복리/g, "복리후생비"],
    [/지급수수료|수수료비용/g, "지급수수료"],
    [/제품매출|상품매출|용역매출/g, "매출"],
  ];

  function norm(s) {
    var t = String(s === null || s === undefined ? "" : s)
      .replace(/[\s()（）\[\]{}·.,\-_/]/g, "")
      .toLowerCase();
    SYNONYM.forEach(function (p) { t = t.replace(p[0], p[1]); });
    return t;
  }

  /* ── 유사도 ────────────────────────────────────────── */
  function bigrams(s) {
    if (s.length < 2) return s ? [s] : [];
    var out = [];
    for (var i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
    return out;
  }

  /** Dice 계수 (0~1) */
  function dice(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    var A = bigrams(a), B = bigrams(b);
    if (!A.length || !B.length) return 0;
    var pool = B.slice(), hit = 0;
    A.forEach(function (g) {
      var i = pool.indexOf(g);
      if (i !== -1) { pool.splice(i, 1); hit++; }
    });
    return (2 * hit) / (A.length + B.length);
  }

  /**
   * 회사 계정과목명 하나에 대한 표준 COA 후보를 점수순으로 돌려준다.
   * 자동 확정하지 않는다 — 화면에서 사람이 고른다.
   */
  function suggest(companyName, coaList, limit) {
    var q = norm(companyName);
    var scored = coaList.map(function (c) {
      var t = norm(c.표준계정과목명);
      var score = dice(q, t);
      if (q && t) {
        if (q === t) score = 1;
        else if (t.indexOf(q) !== -1 || q.indexOf(t) !== -1) {
          // 포함 관계는 길이 비율만큼 가산 (짧은 쪽이 너무 유리해지지 않게)
          var ratio = Math.min(q.length, t.length) / Math.max(q.length, t.length);
          score = Math.max(score, 0.55 + 0.35 * ratio);
        }
      }
      return { 코드: c.코드, 표준계정과목명: c.표준계정과목명, 구분: c.구분, score: score };
    });
    scored.sort(function (a, b) {
      return b.score - a.score || String(a.코드).localeCompare(String(b.코드));
    });
    return scored.slice(0, limit || 5);
  }

  /* ── 매핑표 ────────────────────────────────────────── */
  /** 저장 파일 모양: { 회사코드, updated_at, entries: [{회사계정코드, 회사계정과목명, 표준COA코드}] } */
  function emptyMap(companyCode) {
    return { 회사코드: companyCode, version: 1, updated_at: null, entries: [] };
  }

  function validateMapShape(obj) {
    if (!obj || typeof obj !== "object") return "JSON 형식이 아닙니다.";
    if (!Array.isArray(obj.entries)) return "entries 배열이 없습니다.";
    return null;
  }

  /** 이름·코드 양쪽으로 찾을 수 있게 색인을 만든다 */
  function indexMap(map) {
    var byName = new Map(), byCode = new Map();
    (map.entries || []).forEach(function (e) {
      if (e.회사계정과목명) byName.set(norm(e.회사계정과목명), e.표준COA코드);
      if (e.회사계정코드) byCode.set(String(e.회사계정코드).trim(), e.표준COA코드);
    });
    return { byName: byName, byCode: byCode };
  }

  /**
   * 회사 계정 목록에 저장된 매핑을 붙인다.
   * 돌려주는 값: [{회사계정코드, 회사계정과목명, 표준COA코드, 출처}]
   *   출처: "저장" (이전 기수 매핑) | "" (미매핑 — 사람이 골라야 함)
   */
  function applyMap(companyAccounts, map) {
    var ix = indexMap(map || emptyMap(""));
    return companyAccounts.map(function (a) {
      var code = ix.byCode.get(String(a.코드 || "").trim());
      if (code === undefined) code = ix.byName.get(norm(a.계정과목));
      return {
        회사계정코드: a.코드 || "",
        회사계정과목명: a.계정과목 || "",
        표준COA코드: code || "",
        출처: code ? "저장" : "",
      };
    });
  }

  /** 아직 표준COA코드가 비어 있는 항목 (하나라도 있으면 생성 차단) */
  function unmapped(rows) {
    return rows.filter(function (r) { return !r.표준COA코드; });
  }

  /** 화면에서 확정한 매핑을 저장 파일 모양으로 (기존 매핑과 합친다) */
  function buildMap(companyCode, rows, prevMap) {
    var merged = new Map();
    ((prevMap && prevMap.entries) || []).forEach(function (e) {
      merged.set(norm(e.회사계정과목명) + "|" + String(e.회사계정코드 || "").trim(), e);
    });
    rows.forEach(function (r) {
      if (!r.표준COA코드) return;
      merged.set(norm(r.회사계정과목명) + "|" + String(r.회사계정코드 || "").trim(), {
        회사계정코드: r.회사계정코드,
        회사계정과목명: r.회사계정과목명,
        표준COA코드: r.표준COA코드,
      });
    });
    return {
      회사코드: companyCode,
      version: 1,
      updated_at: new Date().toISOString(),
      entries: Array.from(merged.values()),
    };
  }

  /** 표준 COA를 표시순서대로 */
  function sortCoa(list) {
    return list.slice().sort(function (a, b) {
      return (a.표시순서 || 0) - (b.표시순서 || 0)
        || String(a.코드).localeCompare(String(b.코드));
    });
  }

  function validateCoaShape(obj) {
    if (!obj || !Array.isArray(obj.accounts)) return "accounts 배열이 없습니다.";
    var bad = obj.accounts.filter(function (a) { return !a.코드 || !a.표준계정과목명; });
    if (bad.length) return bad.length + "개 계정에 코드 또는 표준계정과목명이 없습니다.";
    return null;
  }

  return {
    norm: norm,
    dice: dice,
    suggest: suggest,
    emptyMap: emptyMap,
    validateMapShape: validateMapShape,
    validateCoaShape: validateCoaShape,
    applyMap: applyMap,
    unmapped: unmapped,
    buildMap: buildMap,
    sortCoa: sortCoa,
  };
});
