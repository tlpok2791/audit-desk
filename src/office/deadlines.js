/*
 * 신고 기한 규칙 엔진.
 *
 * 거래처 속성(개인·법인 / 과세·면세 / 직원 유무 / 결산월 …)을 넣으면
 * 그 거래처가 언제 무엇을 신고해야 하는지 목록을 돌려준다.
 *
 * 화면과 분리해 둔다. 순수 계산이라 scripts/deadlines.test.js 로 검증한다.
 *
 * ── 주의 ────────────────────────────────────────────────
 * 현행 세법 기준이다. 세법이 바뀌면 이 파일을 고쳐야 한다.
 * 기한이 공휴일·주말이면 다음 영업일로 밀린다 — 이 엔진은 그 보정을 하지 않는다.
 * 실제 신고 전에는 반드시 원문 기한을 확인한다.
 */
(function (root) {
  "use strict";

  /* 거래처 한 곳의 모양
   *   {
   *     name:      "마플 주식회사",
   *     bizNo:     "123-45-67890",
   *     entity:    "corp" | "indiv",        법인 | 개인
   *     vat:       "taxable" | "exempt" | "both",   과세 | 면세 | 겸업
   *     hasStaff:  true|false,              직원(원천징수 대상) 유무
   *     wtPeriod:  "monthly" | "半" → "half",  원천세 매월납 | 반기납
   *     fyEndMonth: 12,                     법인 결산월 (1~12)
   *     honest:    true|false,              성실신고확인 대상 (개인)
   *     medical:   true|false,              병의원 (면세 사업장현황신고 대상)
   *   }
   */

  function pad(n) { return n < 10 ? "0" + n : String(n); }

  /** 그 달의 마지막 날 */
  function lastDay(month) {
    return new Date(2001, month, 0).getDate();   // 2001 = 평년, 2월 28일
  }

  function item(month, day, what, note) {
    return { month: month, day: day, when: month + "월 " + day + "일",
             key: pad(month) + pad(day), what: what, note: note || "" };
  }

  /**
   * 거래처 하나의 연간 신고 일정.
   * @param {object} c 거래처
   * @returns {Array} month 오름차순
   */
  function forClient(c) {
    if (!c) return [];
    var out = [];
    var isCorp  = c.entity === "corp";
    var isIndiv = c.entity === "indiv";
    var taxable = c.vat === "taxable" || c.vat === "both";
    var exempt  = c.vat === "exempt"  || c.vat === "both";

    /* 부가가치세 — 과세분이 있는 경우 */
    if (taxable) {
      out.push(item(1, 25, "부가가치세 확정신고 (전년 2기)"));
      out.push(item(7, 25, "부가가치세 확정신고 (당해 1기)"));
      // 예정신고는 법인만. 개인은 원칙적으로 고지 납부다.
      if (isCorp) {
        out.push(item(4, 25, "부가가치세 예정신고 (1기)"));
        out.push(item(10, 25, "부가가치세 예정신고 (2기)"));
      } else {
        out.push(item(4, 25, "부가가치세 예정고지 납부", "고지서 금액 납부. 신고는 하지 않는다"));
        out.push(item(10, 25, "부가가치세 예정고지 납부", "고지서 금액 납부. 신고는 하지 않는다"));
      }
    }

    /* 사업장현황신고 — 면세사업자(개인). 의원이 대표적이다 */
    if (exempt && isIndiv) {
      out.push(item(2, 10, "사업장현황신고",
        c.medical ? "병의원 등 면세사업자" : "면세사업자"));
    }

    /* 원천세 */
    if (c.hasStaff) {
      if (c.wtPeriod === "half") {
        out.push(item(1, 10, "원천세 반기 신고·납부 (전년 하반기)"));
        out.push(item(7, 10, "원천세 반기 신고·납부 (당해 상반기)"));
      } else {
        out.push(item(0, 10, "원천세 신고·납부", "매월 10일"));   // month 0 = 매월
      }
      out.push(item(3, 10, "근로소득 지급명세서 제출 · 연말정산"));
    }

    /* 소득세 — 개인 */
    if (isIndiv) {
      out.push(item(5, 31, "종합소득세 확정신고"));
      if (c.honest) out.push(item(6, 30, "성실신고확인대상자 종합소득세 신고"));
      out.push(item(11, 30, "종합소득세 중간예납"));
    }

    /* 법인세 — 결산월 + 3개월의 말일 */
    if (isCorp) {
      var fy = Number(c.fyEndMonth) || 12;
      var m = ((fy + 3 - 1) % 12) + 1;
      out.push(item(m, lastDay(m), "법인세 신고",
        fy + "월 결산 기준. 결산월로부터 3개월 이내"));
    }

    return out.sort(function (a, b) {
      if (a.month !== b.month) return a.month - b.month;   // 0(매월)이 맨 앞
      return a.day - b.day;
    });
  }

  /**
   * 여러 거래처의 특정 달 할 일.
   * @param {Array} clients
   * @param {number} month 1~12
   * @returns {Array} [{ client, items:[...] }]  해당 달에 할 일이 있는 거래처만
   */
  function monthView(clients, month) {
    return (clients || []).map(function (c) {
      var hits = forClient(c).filter(function (d) {
        return d.month === month || d.month === 0;   // 0 = 매월
      });
      return { client: c, items: hits };
    }).filter(function (r) { return r.items.length; });
  }

  /** 거래처 전체에서 이번 달 건수 */
  function monthCount(clients, month) {
    return monthView(clients, month).reduce(function (n, r) {
      return n + r.items.length;
    }, 0);
  }

  var api = { forClient: forClient, monthView: monthView, monthCount: monthCount,
              lastDay: lastDay };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Deadlines = api;
})(typeof window !== "undefined" ? window : globalThis);
