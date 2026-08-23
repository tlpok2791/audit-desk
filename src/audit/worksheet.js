/*
 * 정산표 계산 엔진 — DOM을 건드리지 않는 순수 로직.
 * scripts/worksheet.test.js 가 이 파일을 그대로 불러 검증한다.
 *
 * 부호 규약: 모든 잔액은 (차변 - 대변).
 *   자산·비용 → 양수 / 부채·자본·수익 → 음수
 * 이렇게 두면 "전체 합계 = 0" 하나로 차대평형을 확인할 수 있다.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.WS = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var VERSION = 1;

  /* ── 숫자 정리 ─────────────────────────────────────── */
  function toNumber(v) {
    if (v === null || v === undefined || v === "") return 0;
    if (typeof v === "number") return isFinite(v) ? v : 0;
    var s = String(v).trim()
      .replace(/[,\s원₩]/g, "")
      .replace(/^\((.*)\)$/, "-$1");        // (1,234) → -1234
    if (s === "" || s === "-") return 0;
    var n = Number(s);
    return isFinite(n) ? n : 0;
  }

  function norm(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/[\s()\[\].\-_]/g, "").toLowerCase();
  }

  /* ── 헤더·컬럼 자동 인식 ───────────────────────────── */
  var GUESS = {
    계정코드: ["계정코드", "계정cd", "코드", "계정과목코드", "acctcd", "accountcode", "code"],
    계정과목: ["계정과목", "계정명", "계정", "과목", "account", "acctname"],
    금액: ["금액", "잔액", "당기말", "기말잔액", "합계", "amount", "balance"],
    차변: ["차변", "차변금액", "차변잔액", "debit", "dr"],
    대변: ["대변", "대변금액", "대변잔액", "credit", "cr"],
    구분: ["구분", "재무제표구분", "bspl", "계정구분"],
  };

  /** 표준 필드 → 실제 컬럼 인덱스 */
  function guessColumns(headerRow) {
    var out = {};
    var normed = headerRow.map(norm);
    Object.keys(GUESS).forEach(function (field) {
      for (var i = 0; i < GUESS[field].length; i++) {
        var idx = normed.indexOf(norm(GUESS[field][i]));
        if (idx !== -1) { out[field] = idx; return; }
      }
    });
    return out;
  }

  /** 회사명·기간이 위에 붙은 파일에서 진짜 머리글 행을 찾는다 */
  function findHeaderRow(aoa, scan) {
    scan = Math.min(scan || 15, aoa.length);
    var best = -1, bestHit = 0;
    for (var i = 0; i < scan; i++) {
      var row = (aoa[i] || []).filter(function (v) {
        return v !== null && v !== undefined && String(v).trim() !== "";
      });
      if (row.length < 2) continue;
      var hit = Object.keys(guessColumns(aoa[i] || [])).length;
      if (hit > bestHit) { bestHit = hit; best = i; }
    }
    return bestHit >= 2 ? best : -1;
  }

  /* ── 시트 → 계정 목록 ──────────────────────────────── */
  var NOISE = ["합계", "총계", "소계", "계정과목", "누계", "이월"];

  function isNoiseRow(name, code) {
    if (!code && !name) return true;
    var n = norm(name);
    if (!n) return false;
    return NOISE.some(function (w) { return n === norm(w); });
  }

  /**
   * aoa(2차원 배열)에서 계정 목록을 뽑는다.
   * mapping: { 계정코드, 계정과목, 금액? , 차변?, 대변?, 구분? } — 컬럼 인덱스
   * amountMode: "single" | "drcr"
   * 돌려주는 값: [{ 코드, 계정과목, 잔액, 구분? }]
   */
  function extractAccounts(aoa, headerRow, mapping, amountMode) {
    var out = [];
    for (var r = headerRow + 1; r < aoa.length; r++) {
      var row = aoa[r] || [];
      var code = String(row[mapping["계정코드"]] === undefined ? "" : row[mapping["계정코드"]]).trim();
      var name = String(row[mapping["계정과목"]] === undefined ? "" : row[mapping["계정과목"]]).trim();
      if (isNoiseRow(name, code)) continue;
      if (!code && !name) continue;

      var bal;
      if (amountMode === "drcr") {
        bal = toNumber(row[mapping["차변"]]) - toNumber(row[mapping["대변"]]);
      } else {
        bal = toNumber(row[mapping["금액"]]);
      }

      var item = { 코드: code, 계정과목: name, 잔액: bal };
      if (mapping["구분"] !== undefined) {
        var g = String(row[mapping["구분"]] || "").trim().toUpperCase();
        if (g === "BS" || g === "PL") item.구분 = g;
      }
      out.push(item);
    }
    return out;
  }

  /** 계정코드 첫 자리로 BS/PL 추정 (1~3 자산·부채·자본 → BS, 그 밖 → PL) */
  function inferSection(code, name) {
    var first = String(code || "").trim().charAt(0);
    if (/[123]/.test(first)) return "BS";
    if (/[456789]/.test(first)) return "PL";
    // 코드가 없으면 이름으로 최소한의 추정
    var n = norm(name);
    if (/매출|수익|원가|비용|판매관리비|이자|법인세/.test(n)) return "PL";
    return "BS";
  }

  /* ── 전기·당기 병합 ────────────────────────────────── */
  /**
   * prior: 전기 재무제표 계정 목록, current: 당기 시산표 계정 목록
   * 계정코드 기준으로 맞춘다. 코드가 비어 있으면 계정과목으로 대체 매칭.
   * 돌려주는 값: { accounts, unmatched: { priorOnly, currentOnly } }
   */
  function mergeAccounts(prior, current) {
    function keyOf(a) { return a.코드 ? "C:" + a.코드.trim() : "N:" + norm(a.계정과목); }

    var pMap = new Map(), cMap = new Map();
    prior.forEach(function (a) { pMap.set(keyOf(a), a); });
    current.forEach(function (a) { cMap.set(keyOf(a), a); });

    var accounts = [];
    var seen = new Set();

    // 당기 시산표 순서를 기준으로 삼는다
    current.forEach(function (c) {
      var k = keyOf(c);
      if (seen.has(k)) return;
      seen.add(k);
      var p = pMap.get(k);
      accounts.push(makeAccount(c.코드, c.계정과목, c.구분, p ? p.잔액 : 0, c.잔액));
    });

    // 전기에만 있는 계정도 정산표에 남긴다 (당기 0)
    var priorOnly = [];
    prior.forEach(function (p) {
      var k = keyOf(p);
      if (seen.has(k)) return;
      seen.add(k);
      priorOnly.push({ 코드: p.코드, 계정과목: p.계정과목, 전기말: p.잔액 });
      accounts.push(makeAccount(p.코드, p.계정과목, p.구분, p.잔액, 0));
    });

    var currentOnly = current
      .filter(function (c) { return !pMap.has(keyOf(c)); })
      .map(function (c) { return { 코드: c.코드, 계정과목: c.계정과목, 당기말_수정전: c.잔액 }; });

    return { accounts: accounts, unmatched: { priorOnly: priorOnly, currentOnly: currentOnly } };
  }

  function makeAccount(code, name, section, prior, cur) {
    return {
      코드: String(code || "").trim(),
      계정과목: String(name || "").trim(),
      구분: section || inferSection(code, name),
      전기말: prior || 0,
      당기말_수정전: cur || 0,
      수정분개액: 0,
      재분류액: 0,
      당기말_수정후: cur || 0,
    };
  }

  /* ── 분개 반영 ─────────────────────────────────────── */
  /**
   * 분개를 계정에 반영한다. 원본을 바꾸지 않고 새 배열을 돌려준다.
   * adjustments: [{ 번호, 차변계정, 대변계정, 금액, 적요, 조서참조, 구분 }]
   *   차변계정/대변계정은 계정코드. 한쪽만 채워도 된다(복합분개).
   */
  function applyAdjustments(accounts, adjustments) {
    var byCode = new Map();
    var out = accounts.map(function (a) {
      var copy = Object.assign({}, a, { 수정분개액: 0, 재분류액: 0 });
      if (copy.코드) byCode.set(copy.코드, copy);
      return copy;
    });

    (adjustments || []).forEach(function (j) {
      var amt = toNumber(j.금액);
      if (!amt) return;
      var field = j.구분 === "재분류" ? "재분류액" : "수정분개액";
      var dr = byCode.get(String(j.차변계정 || "").trim());
      var cr = byCode.get(String(j.대변계정 || "").trim());
      if (dr) dr[field] += amt;
      if (cr) cr[field] -= amt;
    });

    out.forEach(function (a) {
      a.당기말_수정후 = a.당기말_수정전 + a.수정분개액 + a.재분류액;
    });
    return out;
  }

  /* ── 검증 ──────────────────────────────────────────── */
  /**
   * 분개별(번호 단위) 차대 일치와 구분별 총계를 확인한다.
   * 돌려주는 값: { ok, entries: [{번호, 구분, 차변, 대변, 차액}], errors: [문자열], 차액합계 }
   */
  function verifyAdjustments(adjustments, accountCodes) {
    var codes = new Set(accountCodes || []);
    var groups = new Map();
    var errors = [];

    (adjustments || []).forEach(function (j, i) {
      var no = String(j.번호 === undefined || j.번호 === "" ? (i + 1) : j.번호).trim();
      var kind = j.구분 === "재분류" ? "재분류" : "수정";
      var key = kind + "#" + no;
      if (!groups.has(key)) groups.set(key, { 번호: no, 구분: kind, 차변: 0, 대변: 0, 줄수: 0 });
      var g = groups.get(key);
      var amt = toNumber(j.금액);
      g.줄수++;

      if (amt <= 0) errors.push(`${kind} ${no}번: 금액이 0 이하입니다.`);

      var drCode = String(j.차변계정 || "").trim();
      var crCode = String(j.대변계정 || "").trim();
      if (!drCode && !crCode) errors.push(`${kind} ${no}번: 차변·대변 계정이 모두 비어 있습니다.`);
      if (drCode) { g.차변 += amt; if (codes.size && !codes.has(drCode)) errors.push(`${kind} ${no}번: 차변계정 ${drCode} 를 정산표에서 찾지 못했습니다.`); }
      if (crCode) { g.대변 += amt; if (codes.size && !codes.has(crCode)) errors.push(`${kind} ${no}번: 대변계정 ${crCode} 를 정산표에서 찾지 못했습니다.`); }
    });

    var entries = Array.from(groups.values()).map(function (g) {
      g.차액 = g.차변 - g.대변;
      return g;
    });
    entries.filter(function (g) { return Math.abs(g.차액) >= 0.5; })
      .forEach(function (g) {
        errors.push(`${g.구분} ${g.번호}번: 차대 불일치 — 차변 ${fmt(g.차변)} / 대변 ${fmt(g.대변)} / 차액 ${fmt(g.차액)}`);
      });

    var 차액합계 = entries.reduce(function (s, g) { return s + g.차액; }, 0);
    return { ok: errors.length === 0, entries: entries, errors: errors, 차액합계: 차액합계 };
  }

  /** 정산표 자체의 차대평형 (합계가 0이어야 한다) */
  function verifyBalance(accounts) {
    function sum(k) { return accounts.reduce(function (s, a) { return s + (a[k] || 0); }, 0); }
    var 전기 = sum("전기말"), 수정전 = sum("당기말_수정전"), 수정후 = sum("당기말_수정후");
    return {
      전기말: 전기, 당기말_수정전: 수정전, 당기말_수정후: 수정후,
      ok: Math.abs(수정후) < 0.5,
      균형: {
        전기말: Math.abs(전기) < 0.5,
        당기말_수정전: Math.abs(수정전) < 0.5,
        당기말_수정후: Math.abs(수정후) < 0.5,
      },
    };
  }

  function fmt(n) {
    var v = Math.round(n || 0);
    return v.toLocaleString("ko-KR");
  }

  /* ── 정산표 객체 ───────────────────────────────────── */
  function build(meta, accounts, adjustments) {
    var applied = applyAdjustments(accounts, adjustments);
    return {
      version: VERSION,
      updated_at: new Date().toISOString(),
      meta: meta,
      accounts: applied,
      adjustments: (adjustments || []).slice(),
    };
  }

  /** 저장된 JSON이 정산표 모양인지 확인 */
  function validateShape(obj) {
    if (!obj || typeof obj !== "object") return "JSON 형식이 아닙니다.";
    if (!Array.isArray(obj.accounts)) return "accounts 배열이 없습니다.";
    if (!obj.meta || !obj.meta.회사코드) return "meta.회사코드 가 없습니다.";
    if (!Array.isArray(obj.adjustments)) return "adjustments 배열이 없습니다.";
    return null;
  }

  return {
    VERSION: VERSION,
    toNumber: toNumber,
    norm: norm,
    guessColumns: guessColumns,
    findHeaderRow: findHeaderRow,
    extractAccounts: extractAccounts,
    inferSection: inferSection,
    mergeAccounts: mergeAccounts,
    applyAdjustments: applyAdjustments,
    verifyAdjustments: verifyAdjustments,
    verifyBalance: verifyBalance,
    build: build,
    validateShape: validateShape,
    fmt: fmt,
  };
});
