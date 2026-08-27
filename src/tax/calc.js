/*
 * 종합소득세 계산 엔진 — DOM을 건드리지 않는 순수 로직.
 * core/income_tax.py 와 같은 계산을 하며, scripts/tax.test.js 가 두 결과를 대조한다.
 *
 * 세율·공제 상수는 여기 없다. src/data/tax-rates.js(= config/income-tax-2025.json)를
 * 인자로 받아 쓴다. 세법이 바뀌면 JSON만 고치면 된다.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TaxCalc = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function defaultRates() {
    if (typeof module === "object" && module.exports) return require("../data/tax-rates.js");
    return typeof self !== "undefined" ? self.TAX_RATES : null;
  }

  /* 사업소득금액 = 수입금액 - 필요경비. 음수는 0 (결손 이월은 범위 밖) */
  function businessIncome(수입금액, 필요경비) {
    return Math.max(0, num(수입금액) - num(필요경비));
  }

  /* 인적공제 합계. 부녀자·한부모는 중복 적용하지 않고 한부모가 우선한다. */
  function personalDeductionTotal(opts, cfg) {
    var c = (cfg || defaultRates())["인적공제"];
    var o = opts || {};
    var total = int(o.기본공제_인원, 1) * c["기본공제_1인당"];
    total += int(o.경로우대_인원, 0) * c["경로우대_70세이상_추가_1인당"];
    total += int(o.장애인_인원, 0) * c["장애인_추가_1인당"];
    if (o.한부모_해당) total += c["한부모_추가"];
    else if (o.부녀자_해당) total += c["부녀자_추가"];
    return total;
  }

  /* 누진세율표로 산출세액을 계산한다. 산출세액 = 과세표준 × 세율 - 누진공제 */
  function progressiveTax(과세표준, cfg) {
    var c = cfg || defaultRates();
    var base = Math.max(0, num(과세표준));
    var brackets = c["세율구간"];
    for (var i = 0; i < brackets.length; i++) {
      var 상한 = brackets[i]["과세표준_이하"];
      if (상한 === null || 상한 === undefined || base <= 상한) {
        return Math.max(0, base * brackets[i]["세율"] - brackets[i]["누진공제"]);
      }
    }
    throw new Error("세율구간 설정이 잘못되었습니다 (최고 구간에 이하값이 없어야 합니다).");
  }

  /* 8세 이상 기본공제대상 자녀 세액공제. 3인째부터 단가가 커진다. */
  function childTaxCredit(자녀수, cfg) {
    var c = (cfg || defaultRates())["자녀세액공제"];
    var n = Math.max(0, int(자녀수, 0));
    return Math.min(n, 2) * c["1_2인_1인당"] + Math.max(0, n - 2) * c["3인째부터_1인당"];
  }

  /*
   * 신고서 흐름을 그대로 담은 결과 객체를 돌려준다.
   * core/income_tax.py 의 calc() 와 키·값이 일치해야 한다.
   */
  function calc(inputs, cfg) {
    var c = cfg || defaultRates();
    var i = inputs || {};

    var 사업소득금액 = businessIncome(i.수입금액, i.필요경비);
    var 종합소득금액 = 사업소득금액;   // 사업소득만 있다고 가정

    var 인적공제 = personalDeductionTotal(i, c);
    var 국민연금등_공제 = num(i.국민연금등_공제);
    var 종합소득공제 = 인적공제 + 국민연금등_공제;

    var 과세표준 = Math.max(0, 종합소득금액 - 종합소득공제);
    var 산출세액 = progressiveTax(과세표준, c);

    var 표준세액공제 = c["표준세액공제_사업소득자"];
    var 자녀공제액 = childTaxCredit(i.자녀세액공제_인원, c);
    var 세액공제_합계 = 표준세액공제 + 자녀공제액;

    var 결정세액 = Math.max(0, 산출세액 - 세액공제_합계);
    var 기납부세액 = num(i.기납부세액);
    var 차감납부세액 = 결정세액 - 기납부세액;   // 음수면 환급

    return {
      수입금액: num(i.수입금액),
      필요경비: num(i.필요경비),
      사업소득금액: 사업소득금액,
      종합소득금액: 종합소득금액,
      인적공제: 인적공제,
      국민연금등_공제: 국민연금등_공제,
      종합소득공제: 종합소득공제,
      과세표준: 과세표준,
      산출세액: 산출세액,
      표준세액공제: 표준세액공제,
      자녀세액공제: 자녀공제액,
      세액공제_합계: 세액공제_합계,
      결정세액: 결정세액,
      기납부세액: 기납부세액,
      차감납부세액: 차감납부세액,
      환급여부: 차감납부세액 < 0,
      지방소득세_추정: Math.max(0, 결정세액) * c["지방소득세율"],
    };
  }

  /* ── 표시용 유틸 ─────────────────────────────────────── */

  function num(v) {
    if (v === null || v === undefined || v === "") return 0;
    var n = typeof v === "number" ? v : parseFloat(String(v).replace(/[,\s원₩]/g, ""));
    return isFinite(n) ? n : 0;
  }

  function int(v, dflt) {
    var n = parseInt(v, 10);
    return isFinite(n) ? n : dflt;
  }

  /* 1234000 → "1,234,000" */
  function comma(v) {
    return Math.round(num(v)).toLocaleString("ko-KR");
  }

  /*
   * 금액을 사람이 읽는 단위로. 입력창 아래에 확인용으로 띄운다.
   *   80000000 → "8,000만원",  123450000 → "1억 2,345만원"
   * 만원 미만은 굳이 읽어주지 않는다 (입력 확인이 목적이라 자릿수만 맞으면 된다).
   */
  function readable(v) {
    var n = Math.round(num(v));
    if (n === 0) return "";
    var sign = n < 0 ? "-" : "";
    n = Math.abs(n);
    if (n < 10000) return sign + comma(n) + "원";
    var 억 = Math.floor(n / 100000000);
    var 만 = Math.floor((n % 100000000) / 10000);
    var parts = [];
    if (억) parts.push(억.toLocaleString("ko-KR") + "억");
    if (만) parts.push(만.toLocaleString("ko-KR") + "만");
    return sign + parts.join(" ") + "원";
  }

  return {
    businessIncome: businessIncome,
    personalDeductionTotal: personalDeductionTotal,
    progressiveTax: progressiveTax,
    childTaxCredit: childTaxCredit,
    calc: calc,
    num: num,
    comma: comma,
    readable: readable,
  };
});
