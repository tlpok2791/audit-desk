/**
 * 종합소득세 계산 엔진 검증.  실행: node scripts/tax.test.js
 *
 * 브라우저용 src/tax/calc.js 와 파이썬 core/income_tax.py 는 같은 계산을 해야 한다.
 * 여기서는 JS 쪽 로직을 검증하고, 두 구현이 실제로 같은 값을 내는지는
 * tests/test_income_tax.py 의 동일한 시나리오와 기대값을 맞춰 두는 것으로 확인한다.
 */
const assert = require("assert");
const T = require("../src/tax/calc.js");
const R = require("../src/data/tax-rates.js");

let passed = 0;
function test(name, fn) {
  try { fn(); console.log("  ✓ " + name); passed++; }
  catch (e) { console.error("  ✗ " + name + "\n    " + e.message); process.exitCode = 1; }
}

console.log("세율구간");

test("구간 경계값은 낮은 세율이 적용된다", () => {
  assert.strictEqual(T.progressiveTax(0, R), 0);
  assert.strictEqual(T.progressiveTax(14000000, R), 14000000 * 0.06);
  // 경계 바로 위는 다음 구간
  assert.strictEqual(T.progressiveTax(14000001, R), 14000001 * 0.15 - 1260000);
  assert.strictEqual(T.progressiveTax(50000000, R), 50000000 * 0.15 - 1260000);
});

test("최고 구간(상한 없음)도 계산된다", () => {
  assert.strictEqual(T.progressiveTax(1000000001, R), 1000000001 * 0.45 - 65940000);
});

test("음수 과세표준은 0으로", () => {
  assert.strictEqual(T.progressiveTax(-5000000, R), 0);
});

console.log("공제");

test("사업소득금액은 음수가 되지 않는다", () => {
  assert.strictEqual(T.businessIncome(1000000, 5000000), 0);
  assert.strictEqual(T.businessIncome(5000000, 1000000), 4000000);
});

test("한부모공제가 부녀자공제보다 우선하고 중복되지 않는다", () => {
  const base = T.personalDeductionTotal({ 기본공제_인원: 1 }, R);
  const both = T.personalDeductionTotal(
    { 기본공제_인원: 1, 부녀자_해당: true, 한부모_해당: true }, R);
  assert.strictEqual(both - base, R["인적공제"]["한부모_추가"]);
});

test("인적공제 인원별 합산", () => {
  const c = R["인적공제"];
  const total = T.personalDeductionTotal(
    { 기본공제_인원: 3, 경로우대_인원: 1, 장애인_인원: 1 }, R);
  assert.strictEqual(total,
    3 * c["기본공제_1인당"] + c["경로우대_70세이상_추가_1인당"] + c["장애인_추가_1인당"]);
});

test("자녀세액공제는 3인째부터 단가가 커진다", () => {
  const c = R["자녀세액공제"];
  assert.strictEqual(T.childTaxCredit(0, R), 0);
  assert.strictEqual(T.childTaxCredit(2, R), 2 * c["1_2인_1인당"]);
  assert.strictEqual(T.childTaxCredit(3, R), 2 * c["1_2인_1인당"] + c["3인째부터_1인당"]);
});

console.log("전체 계산");

test("납부 시나리오 — 파이썬 테스트와 같은 입력·같은 결과", () => {
  const r = T.calc({
    수입금액: 80000000, 필요경비: 30000000, 국민연금등_공제: 2000000,
    기본공제_인원: 2, 기납부세액: 1000000,
  }, R);
  assert.strictEqual(r.사업소득금액, 50000000);
  assert.strictEqual(r.종합소득공제, 2 * R["인적공제"]["기본공제_1인당"] + 2000000);
  assert.strictEqual(r.과세표준, r.종합소득금액 - r.종합소득공제);
  assert.strictEqual(r.산출세액, T.progressiveTax(r.과세표준, R));
  assert.strictEqual(r.결정세액, Math.max(0, r.산출세액 - r.세액공제_합계));
  assert.strictEqual(r.차감납부세액, r.결정세액 - 1000000);
  assert.strictEqual(r.환급여부, false);
});

test("UI에서 확인한 값과 일치한다 (매출 8천만·경비 0·2인·연금 200만·기납부 100만)", () => {
  const r = T.calc({
    수입금액: 80000000, 필요경비: 0, 국민연금등_공제: 2000000,
    기본공제_인원: 2, 기납부세액: 1000000,
  }, R);
  assert.strictEqual(r.과세표준, 75000000);
  assert.strictEqual(r.산출세액, 12240000);
  assert.strictEqual(r.결정세액, 12170000);
  assert.strictEqual(r.차감납부세액, 11170000);
  assert.strictEqual(r.지방소득세_추정, 1217000);
});

test("환급 시나리오", () => {
  const r = T.calc({
    수입금액: 20000000, 필요경비: 15000000, 기본공제_인원: 1, 기납부세액: 5000000,
  }, R);
  assert.strictEqual(r.환급여부, true);
  assert.ok(r.차감납부세액 < 0);
});

console.log("표시 유틸");

test("금액 표기를 숫자로", () => {
  assert.strictEqual(T.num("1,234,000"), 1234000);
  assert.strictEqual(T.num("1,234,000원"), 1234000);
  assert.strictEqual(T.num(""), 0);
  assert.strictEqual(T.num(null), 0);
  assert.strictEqual(T.num(5000), 5000);
});

test("사람이 읽는 단위로", () => {
  assert.strictEqual(T.readable(0), "");
  assert.strictEqual(T.readable(5000), "5,000원");
  assert.strictEqual(T.readable(80000000), "8,000만원");
  assert.strictEqual(T.readable(123450000), "1억 2,345만원");
  assert.strictEqual(T.readable(100000000), "1억원");
});

console.log("\n" + passed + "개 통과");
