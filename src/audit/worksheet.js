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

  var VERSION = 2;   // 2: 표준COA 기반 9열 정산표

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

  /* ── 표준COA 단위로 집계 ───────────────────────────── */
  /**
   * 회사 계정 목록을 표준COA코드 단위로 합친다.
   * accounts : [{코드, 계정과목, 잔액}]  (회사 원본)
   * mapRows  : [{회사계정코드, 회사계정과목명, 표준COA코드}]
   * 돌려주는 값: Map(표준COA코드 → 합계)
   */
  function aggregateByCoa(accounts, mapRows) {
    var byName = new Map(), byCode = new Map();
    (mapRows || []).forEach(function (m) {
      if (!m.표준COA코드) return;
      if (m.회사계정과목명) byName.set(norm(m.회사계정과목명), m.표준COA코드);
      if (m.회사계정코드) byCode.set(String(m.회사계정코드).trim(), m.표준COA코드);
    });

    var sums = new Map();
    (accounts || []).forEach(function (a) {
      var coa = byCode.get(String(a.코드 || "").trim());
      if (coa === undefined) coa = byName.get(norm(a.계정과목));
      if (!coa) return;                       // 미매핑은 여기 오지 않는다 (생성 전에 막힌다)
      sums.set(coa, (sums.get(coa) || 0) + (a.잔액 || 0));
    });
    return sums;
  }

  /**
   * 정산표 행을 만든다 — 화면 미리보기와 강조 판단에 쓰는 계산값.
   * 실제 xlsx 는 이 값을 쓰지 않고 SUMIFS 수식으로 기록한다.
   *
   * 돌려주는 값: [{코드, 계정과목명, 구분, 대분류, 전기, 당기, 수정분개, 수정후, 증감액, 증감비율}]
   */
  function buildRows(coaList, curSums, priorSums, adjustments) {
    var adjBy = adjustmentsByCoa(adjustments);
    var used = new Set();
    [curSums, priorSums, adjBy].forEach(function (m) {
      m.forEach(function (_, k) { used.add(k); });
    });

    var rows = [];
    coaList.forEach(function (c) {
      if (!used.has(c.코드)) return;
      var 전기 = priorSums.get(c.코드) || 0;
      var 당기 = curSums.get(c.코드) || 0;
      var 수정분개 = adjBy.get(c.코드) || 0;
      var 수정후 = 당기 + 수정분개;
      var 증감액 = 수정후 - 전기;
      rows.push({
        코드: c.코드,
        계정과목명: c.표준계정과목명,
        구분: c.구분,
        대분류: c.대분류 || "",
        전기: 전기, 당기: 당기, 수정분개: 수정분개, 수정후: 수정후,
        증감액: 증감액,
        // 전기가 0이면 비율을 내지 않는다 (엑셀에서도 IFERROR 로 공란)
        증감비율: 전기 === 0 ? null : 증감액 / Math.abs(전기),
      });
    });
    return rows;
  }

  /** 수정·재분류분개를 표준COA 단위 순액(차변-대변)으로 */
  function adjustmentsByCoa(adjustments) {
    var m = new Map();
    (adjustments || []).forEach(function (j) {
      var amt = toNumber(j.금액);
      if (!amt) return;
      var dr = String(j.차변계정 || "").trim();
      var cr = String(j.대변계정 || "").trim();
      if (dr) m.set(dr, (m.get(dr) || 0) + amt);
      if (cr) m.set(cr, (m.get(cr) || 0) - amt);
    });
    return m;
  }

  /** 중요성금액 이상 증감한 행만 (증감사유 초안 대상) */
  function materialRows(rows, materiality) {
    var t = Math.abs(Number(materiality) || 0);
    if (!t) return [];
    return rows.filter(function (r) { return Math.abs(r.증감액) >= t; });
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

  /** 정산표 차대평형과 자산=부채+자본 (대분류는 COA 코드 첫 자리로 판단) */
  function verifyBalance(rows) {
    function sum(pred, key) {
      return rows.reduce(function (s, r) { return pred(r) ? s + (r[key] || 0) : s; }, 0);
    }
    var head = function (d) { return function (r) { return String(r.코드).charAt(0) === d; }; };
    var all = function () { return true; };

    var 자산 = sum(head("1"), "수정후");
    var 부채 = sum(head("2"), "수정후");
    var 자본 = sum(head("3"), "수정후");
    var 수익 = sum(head("4"), "수정후");
    var 비용 = sum(function (r) { return /[56789]/.test(String(r.코드).charAt(0)); }, "수정후");
    var 총합 = sum(all, "수정후");
    var 전기총합 = sum(all, "전기");
    var 당기총합 = sum(all, "당기");

    // 손익 마감 전이므로 자산 = 부채 + 자본 + 당기순손익 이다.
    // 부호 규약(차변 양수·대변 음수)에서는 자산+부채+자본+수익+비용 = 0 과 같다.
    var 당기순손익 = -(수익 + 비용);
    var bsDiff = 자산 + 부채 + 자본 + 수익 + 비용;

    return {
      자산: 자산, 부채: 부채, 자본: 자본, 수익: 수익, 비용: 비용,
      당기순손익: 당기순손익,
      전기: 전기총합, 당기: 당기총합, 수정후: 총합,
      자산_부채자본_차이: bsDiff,
      ok: Math.abs(총합) < 0.5 && Math.abs(bsDiff) < 0.5,
      균형: {
        차대일치: Math.abs(총합) < 0.5,
        자산_부채자본: Math.abs(bsDiff) < 0.5,
        전기: Math.abs(전기총합) < 0.5,
        당기: Math.abs(당기총합) < 0.5,
      },
    };
  }

  function fmt(n) {
    var v = Math.round(n || 0);
    return v.toLocaleString("ko-KR");
  }

  /* ── 정산표 객체 ───────────────────────────────────── */
  function build(meta, rows, adjustments, reasons) {
    return {
      version: VERSION,
      updated_at: new Date().toISOString(),
      meta: meta,
      accounts: rows.map(function (r) {
        return Object.assign({}, r, {
          증감사유: (reasons && reasons[r.코드] && reasons[r.코드].text) || "",
        });
      }),
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

  /** 증감사유 초안을 받을 프롬프트 (audit-fs-analyzer 에 넘긴다) */
  function reasonPrompt(rows, materiality) {
    var target = materialRows(rows, materiality);
    var lines = target.map(function (r) {
      return [r.코드, r.계정과목명, Math.round(r.전기), Math.round(r.수정후),
        Math.round(r.증감액), r.증감비율 === null ? "" : (r.증감비율 * 100).toFixed(1) + "%"]
        .join(" | ");
    });
    return "아래는 정산표에서 중요성금액 이상 변동한 계정이다. "
      + "각 계정의 증감사유 초안을 확인이 필요한 질문 형태로 작성해줘.\n\n"
      + "중요성금액: " + Math.round(Number(materiality) || 0).toLocaleString("ko-KR") + "\n\n"
      + "COA | 계정과목명 | 전기 | 수정후 | 증감액 | 증감비율\n"
      + lines.join("\n")
      + "\n\nJSON만 출력해줘. 키는 COA 코드, 값은 증감사유 초안 문자열.";
  }

  /** 에이전트가 돌려준 JSON 텍스트 → { 코드: {text, draft:true} } */
  function parseReasons(text, rows) {
    var t = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    var obj;
    try { obj = JSON.parse(t); } catch (e) { return { error: "JSON을 읽지 못했습니다: " + e.message }; }
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
      return { error: "{\"COA코드\": \"사유\"} 형태여야 합니다." };
    }
    var valid = new Set(rows.map(function (r) { return r.코드; }));
    var out = {}, unknown = [];
    Object.keys(obj).forEach(function (k) {
      if (!valid.has(k)) { unknown.push(k); return; }
      var v = obj[k];
      if (typeof v === "string" && v.trim()) out[k] = { text: v.trim(), draft: true };
    });
    return { reasons: out, unknown: unknown, count: Object.keys(out).length };
  }

  return {
    VERSION: VERSION,
    toNumber: toNumber,
    norm: norm,
    guessColumns: guessColumns,
    findHeaderRow: findHeaderRow,
    extractAccounts: extractAccounts,
    inferSection: inferSection,
    aggregateByCoa: aggregateByCoa,
    adjustmentsByCoa: adjustmentsByCoa,
    buildRows: buildRows,
    materialRows: materialRows,
    verifyAdjustments: verifyAdjustments,
    verifyBalance: verifyBalance,
    build: build,
    validateShape: validateShape,
    reasonPrompt: reasonPrompt,
    parseReasons: parseReasons,
    fmt: fmt,
  };
});
