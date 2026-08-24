/**
 * 정산표 계산 엔진 검증.  실행: node scripts/worksheet.test.js
 */
const assert = require("assert");
const WS = require("../src/audit/worksheet.js");

let passed = 0;
function test(name, fn) {
  try { fn(); console.log("  ✓ " + name); passed++; }
  catch (e) { console.error("  ✗ " + name + "\n    " + e.message); process.exitCode = 1; }
}

console.log("숫자·컬럼 인식");

test("금액 표기를 숫자로", () => {
  assert.strictEqual(WS.toNumber("1,234,000"), 1234000);
  assert.strictEqual(WS.toNumber("(1,234)"), -1234);
  assert.strictEqual(WS.toNumber("1,234원"), 1234);
  assert.strictEqual(WS.toNumber("-"), 0);
  assert.strictEqual(WS.toNumber(""), 0);
  assert.strictEqual(WS.toNumber(null), 0);
  assert.strictEqual(WS.toNumber(5000), 5000);
});

test("머리글 행과 컬럼 자동 인식", () => {
  const aoa = [
    ["마플 주식회사", null, null],
    ["2025 사업연도 시산표", null, null],
    ["계정코드", "계정과목", "잔액"],
    ["1100", "현금", 1000],
  ];
  const hdr = WS.findHeaderRow(aoa);
  assert.strictEqual(hdr, 2);
  const cols = WS.guessColumns(aoa[hdr]);
  assert.strictEqual(cols["계정코드"], 0);
  assert.strictEqual(cols["계정과목"], 1);
  assert.strictEqual(cols["금액"], 2);
});

test("차변·대변 두 컬럼 시산표", () => {
  const aoa = [
    ["코드", "계정과목", "차변", "대변"],
    ["1100", "현금", "1,000", ""],
    ["2100", "매입채무", "", "1,000"],
    ["", "합계", "1,000", "1,000"],       // 노이즈 행
  ];
  const cols = WS.guessColumns(aoa[0]);
  const rows = WS.extractAccounts(aoa, 0, cols, "drcr");
  assert.strictEqual(rows.length, 2, "합계 행은 제외돼야 한다");
  assert.strictEqual(rows[0].잔액, 1000);
  assert.strictEqual(rows[1].잔액, -1000, "대변은 음수");
});

console.log("BS/PL 추정");

test("계정코드 첫 자리로 구분", () => {
  assert.strictEqual(WS.inferSection("1100", "현금"), "BS");
  assert.strictEqual(WS.inferSection("2100", "매입채무"), "BS");
  assert.strictEqual(WS.inferSection("3100", "자본금"), "BS");
  assert.strictEqual(WS.inferSection("4100", "매출"), "PL");
  assert.strictEqual(WS.inferSection("8200", "지급수수료"), "PL");
  assert.strictEqual(WS.inferSection("", "매출원가"), "PL", "코드 없으면 이름으로");
});

console.log("표준COA 집계");

const coaList = [
  { 코드: "1100", 표준계정과목명: "현금및현금성자산", 구분: "BS", 대분류: "자산", 표시순서: 10 },
  { 코드: "1200", 표준계정과목명: "매출채권", 구분: "BS", 대분류: "자산", 표시순서: 20 },
  { 코드: "2100", 표준계정과목명: "매입채무", 구분: "BS", 대분류: "부채", 표시순서: 30 },
  { 코드: "3100", 표준계정과목명: "자본금", 구분: "BS", 대분류: "자본", 표시순서: 40 },
  { 코드: "4100", 표준계정과목명: "매출", 구분: "PL", 대분류: "수익", 표시순서: 50 },
  { 코드: "6350", 표준계정과목명: "지급수수료", 구분: "PL", 대분류: "비용", 표시순서: 60 },
];
// 회사 계정과목명이 표준과 다르고, 여러 계정이 한 COA로 모이는 경우를 함께 본다
const mapRows = [
  { 회사계정코드: "101", 회사계정과목명: "현금", 표준COA코드: "1100" },
  { 회사계정코드: "103", 회사계정과목명: "보통예금", 표준COA코드: "1100" },
  { 회사계정코드: "108", 회사계정과목명: "외상매출금", 표준COA코드: "1200" },
  { 회사계정코드: "251", 회사계정과목명: "외상매입금", 표준COA코드: "2100" },
  { 회사계정코드: "331", 회사계정과목명: "자본금", 표준COA코드: "3100" },
  { 회사계정코드: "401", 회사계정과목명: "제품매출", 표준COA코드: "4100" },
  { 회사계정코드: "831", 회사계정과목명: "지급수수료", 표준COA코드: "6350" },
];
const curAcc = [
  { 코드: "101", 계정과목: "현금", 잔액: 300000 },
  { 코드: "103", 계정과목: "보통예금", 잔액: 500000 },
  { 코드: "108", 계정과목: "외상매출금", 잔액: 450000 },
  { 코드: "251", 계정과목: "외상매입금", 잔액: -300000 },
  { 코드: "331", 계정과목: "자본금", 잔액: -300000 },
  { 코드: "401", 계정과목: "제품매출", 잔액: -1650000 },
  { 코드: "831", 계정과목: "지급수수료", 잔액: 1000000 },
];
const priorAcc = [
  { 코드: "101", 계정과목: "현금", 잔액: 500000 },
  { 코드: "108", 계정과목: "외상매출금", 잔액: 300000 },
  { 코드: "251", 계정과목: "외상매입금", 잔액: -400000 },
  { 코드: "331", 계정과목: "자본금", 잔액: -300000 },
  { 코드: "401", 계정과목: "제품매출", 잔액: -900000 },
  { 코드: "831", 계정과목: "지급수수료", 잔액: 800000 },
];

test("여러 회사계정이 한 표준COA로 합쳐진다", () => {
  const sums = WS.aggregateByCoa(curAcc, mapRows);
  assert.strictEqual(sums.get("1100"), 800000, "현금 + 보통예금");
  assert.strictEqual(sums.get("1200"), 450000);
});

test("매핑되지 않은 계정은 집계에서 빠진다", () => {
  const sums = WS.aggregateByCoa(
    curAcc.concat([{ 코드: "999", 계정과목: "미매핑계정", 잔액: 12345 }]), mapRows);
  const total = Array.from(sums.values()).reduce((a, b) => a + b, 0);
  assert.strictEqual(total, 0, "매핑된 것만 합하면 차대가 맞는다");
});

console.log("정산표 행");

const curSums = WS.aggregateByCoa(curAcc, mapRows);
const priorSums = WS.aggregateByCoa(priorAcc, mapRows);

test("9열 정산표 행을 표시순서대로 만든다", () => {
  const rows = WS.buildRows(coaList, curSums, priorSums, []);
  assert.deepStrictEqual(rows.map(r => r.코드), ["1100", "1200", "2100", "3100", "4100", "6350"]);
  const cash = rows[0];
  assert.strictEqual(cash.전기, 500000);
  assert.strictEqual(cash.당기, 800000);
  assert.strictEqual(cash.수정분개, 0);
  assert.strictEqual(cash.수정후, 800000);
  assert.strictEqual(cash.증감액, 300000);
  assert.ok(Math.abs(cash.증감비율 - 0.6) < 1e-9);
});

test("어느 쪽에도 없는 COA는 행으로 만들지 않는다", () => {
  const extra = coaList.concat([{ 코드: "9999", 표준계정과목명: "안쓰는계정", 구분: "PL", 표시순서: 99 }]);
  const rows = WS.buildRows(extra, curSums, priorSums, []);
  assert.ok(!rows.some(r => r.코드 === "9999"));
});

test("전기가 0이면 증감비율은 null (엑셀에서 공란)", () => {
  const rows = WS.buildRows(coaList, curSums, new Map(), []);
  rows.forEach(r => assert.strictEqual(r.증감비율, null));
});

test("수정분개가 표준COA 단위로 반영된다", () => {
  const adj = [
    { 번호: 1, 구분: "수정", 차변계정: "6350", 대변계정: "2100", 금액: 50000 },
    { 번호: 2, 구분: "재분류", 차변계정: "1200", 대변계정: "1100", 금액: 30000 },
  ];
  const rows = WS.buildRows(coaList, curSums, priorSums, adj);
  const by = Object.fromEntries(rows.map(r => [r.코드, r]));
  assert.strictEqual(by["6350"].수정분개, 50000);
  assert.strictEqual(by["2100"].수정분개, -50000);
  assert.strictEqual(by["6350"].수정후, 1000000 + 50000);
  assert.strictEqual(by["1100"].수정분개, -30000, "재분류도 같은 열에 합산된다");
  assert.strictEqual(by["1200"].수정분개, 30000);
});

test("두 번 만들어도 누적되지 않는다", () => {
  const adj = [{ 번호: 1, 차변계정: "6350", 대변계정: "2100", 금액: 50000 }];
  const a = WS.buildRows(coaList, curSums, priorSums, adj);
  const b = WS.buildRows(coaList, curSums, priorSums, adj);
  assert.strictEqual(a.find(r => r.코드 === "6350").수정분개,
                     b.find(r => r.코드 === "6350").수정분개);
});

console.log("중요성");

test("중요성금액 이상 변동한 행만 뽑는다", () => {
  const rows = WS.buildRows(coaList, curSums, priorSums, []);
  const m = WS.materialRows(rows, 200000);
  const codes = m.map(r => r.코드).sort();
  // 매출 -750,000 / 지급수수료 +200,000 / 현금 +300,000
  assert.ok(codes.includes("4100") && codes.includes("1100") && codes.includes("6350"));
  assert.ok(!codes.includes("3100"), "변동 없는 자본금은 빠진다");
});

test("중요성금액이 0이면 대상 없음", () => {
  const rows = WS.buildRows(coaList, curSums, priorSums, []);
  assert.strictEqual(WS.materialRows(rows, 0).length, 0);
});

console.log("차대 검증");

test("정상 분개는 통과", () => {
  const r = WS.verifyAdjustments(
    [{ 번호: 1, 차변계정: "6350", 대변계정: "2100", 금액: 50 }], ["6350", "2100"]);
  assert.ok(r.ok, r.errors.join(" / "));
  assert.strictEqual(r.차액합계, 0);
});

test("복합분개(한쪽만 입력)의 차대 불일치를 잡는다", () => {
  const r = WS.verifyAdjustments([
    { 번호: 3, 차변계정: "6350", 대변계정: "", 금액: 70 },
    { 번호: 3, 차변계정: "", 대변계정: "2100", 금액: 50 },
  ], ["6350", "2100"]);
  assert.ok(!r.ok);
  assert.ok(r.errors.some(e => /차대 불일치/.test(e)), r.errors.join(" / "));
  assert.strictEqual(r.차액합계, 20);
});

test("같은 번호라도 수정과 재분류는 따로 본다", () => {
  const r = WS.verifyAdjustments([
    { 번호: 1, 구분: "수정", 차변계정: "6350", 대변계정: "2100", 금액: 50 },
    { 번호: 1, 구분: "재분류", 차변계정: "1200", 대변계정: "1100", 금액: 30 },
  ], ["6350", "2100", "1200", "1100"]);
  assert.ok(r.ok, r.errors.join(" / "));
  assert.strictEqual(r.entries.length, 2);
});

test("정산표에 없는 COA 코드를 잡는다", () => {
  const r = WS.verifyAdjustments(
    [{ 번호: 1, 차변계정: "9999", 대변계정: "2100", 금액: 50 }], ["6350", "2100"]);
  assert.ok(!r.ok);
  assert.ok(r.errors.some(e => /9999/.test(e)));
});

console.log("정산표 차대평형");

test("차대가 맞고 자산 = 부채 + 자본 + 당기순손익", () => {
  const rows = WS.buildRows(coaList, curSums, priorSums, []);
  const b = WS.verifyBalance(rows);
  assert.ok(b.균형.차대일치, "수정후 총합 " + b.수정후);
  assert.ok(b.균형.자산_부채자본, "차이 " + b.자산_부채자본_차이);
  assert.ok(b.ok);
  // 손익 마감 전이므로 당기순손익을 넣어야 대차가 맞는다
  assert.strictEqual(b.당기순손익, 650000);
  assert.strictEqual(b.자산, 1250000);
  assert.strictEqual(-(b.부채 + b.자본) + b.당기순손익, b.자산);
});

test("한쪽이 어긋나면 불균형으로 잡힌다", () => {
  const rows = WS.buildRows(coaList, curSums, priorSums, []);
  rows.find(r => r.코드 === "1100").수정후 += 100;
  const b = WS.verifyBalance(rows);
  assert.ok(!b.ok);
  assert.strictEqual(b.수정후, 100);
});

console.log("증감사유 초안 연결");

test("중요성 이상 행만 담은 프롬프트를 만든다", () => {
  const rows = WS.buildRows(coaList, curSums, priorSums, []);
  const p = WS.reasonPrompt(rows, 200000);
  assert.ok(p.includes("중요성금액: 200,000"));
  assert.ok(p.includes("4100"), "매출이 들어가야 한다");
  assert.ok(!p.includes("3100"), "변동 없는 자본금은 빠져야 한다");
  assert.ok(/COA \| 계정과목명 \| 전기 \| 수정후 \| 증감액 \| 증감비율/.test(p));
});

test("에이전트 JSON을 초안으로 읽는다", () => {
  const rows = WS.buildRows(coaList, curSums, priorSums, []);
  const r = WS.parseReasons('{"4100":"매출이 감소한 원인을 확인할 것."}', rows);
  assert.ok(!r.error);
  assert.strictEqual(r.count, 1);
  assert.strictEqual(r.reasons["4100"].draft, true, "초안 표시가 있어야 배경색이 붙는다");
});

test("코드펜스가 붙어 와도 읽는다", () => {
  const rows = WS.buildRows(coaList, curSums, priorSums, []);
  const r = WS.parseReasons('```json\n{"4100":"확인 필요"}\n```', rows);
  assert.ok(!r.error);
  assert.strictEqual(r.count, 1);
});

test("정산표에 없는 코드는 버리고 알려준다", () => {
  const rows = WS.buildRows(coaList, curSums, priorSums, []);
  const r = WS.parseReasons('{"4100":"확인 필요","0000":"엉뚱한 코드"}', rows);
  assert.strictEqual(r.count, 1);
  assert.deepStrictEqual(r.unknown, ["0000"]);
});

test("깨진 JSON은 오류를 돌려준다", () => {
  const rows = WS.buildRows(coaList, curSums, priorSums, []);
  assert.ok(WS.parseReasons("이건 JSON이 아닙니다", rows).error);
  assert.ok(WS.parseReasons('["배열"]', rows).error);
});

console.log("정산표 객체");

test("build 결과가 규격을 만족", () => {
  const meta = { 회사명: "마플", 회사코드: "MAPLE", 결산일: "2025-12-31" };
  const rows = WS.buildRows(coaList, curSums, priorSums, []);
  const ws = WS.build(meta, rows,
    [{ 번호: 1, 차변계정: "6350", 대변계정: "2100", 금액: 50 }],
    { "4100": { text: "확인 필요", draft: true } });
  assert.strictEqual(ws.version, 2);
  assert.ok(ws.updated_at);
  assert.strictEqual(ws.meta.회사코드, "MAPLE");
  assert.strictEqual(ws.adjustments.length, 1);
  const keys = Object.keys(ws.accounts[0]);
  ["코드", "계정과목명", "구분", "전기", "당기", "수정분개", "수정후", "증감액", "증감비율", "증감사유"]
    .forEach(k => assert.ok(keys.includes(k), k + " 컬럼이 있어야 한다"));
  assert.strictEqual(ws.accounts.find(a => a.코드 === "4100").증감사유, "확인 필요");
  assert.strictEqual(WS.validateShape(ws), null);
});

test("깨진 JSON은 불러오기에서 걸러진다", () => {
  assert.ok(WS.validateShape(null));
  assert.ok(WS.validateShape({ accounts: [] }), "meta 없음");
  assert.ok(WS.validateShape({ meta: { 회사코드: "X" } }), "accounts 없음");
});

console.log(`\n${passed}개 통과`);
