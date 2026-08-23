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

console.log("전기·당기 병합");

const prior = [
  { 코드: "1100", 계정과목: "현금", 잔액: 500 },
  { 코드: "2100", 계정과목: "매입채무", 잔액: -500 },
  { 코드: "1300", 계정과목: "선급금", 잔액: 100 },   // 당기에 없음
];
const current = [
  { 코드: "1100", 계정과목: "현금", 잔액: 800 },
  { 코드: "2100", 계정과목: "매입채무", 잔액: -300 },
  { 코드: "8200", 계정과목: "지급수수료", 잔액: 200 },  // 전기에 없음
  { 코드: "4100", 계정과목: "매출", 잔액: -700 },
];

test("계정코드 기준으로 맞추고 미매핑을 따로 뽑는다", () => {
  const { accounts, unmatched } = WS.mergeAccounts(prior, current);
  const by = Object.fromEntries(accounts.map(a => [a.코드, a]));

  assert.strictEqual(by["1100"].전기말, 500);
  assert.strictEqual(by["1100"].당기말_수정전, 800);

  assert.strictEqual(by["1300"].전기말, 100);
  assert.strictEqual(by["1300"].당기말_수정전, 0, "전기에만 있는 계정도 남긴다");

  assert.strictEqual(by["8200"].전기말, 0);
  assert.strictEqual(by["8200"].당기말_수정전, 200);

  assert.deepStrictEqual(unmatched.priorOnly.map(x => x.코드), ["1300"]);
  assert.deepStrictEqual(unmatched.currentOnly.map(x => x.코드).sort(), ["4100", "8200"]);
});

test("코드가 없으면 계정과목으로 매칭", () => {
  const { accounts } = WS.mergeAccounts(
    [{ 코드: "", 계정과목: "현 금", 잔액: 100 }],
    [{ 코드: "", 계정과목: "현금", 잔액: 300 }]
  );
  assert.strictEqual(accounts.length, 1, "공백 차이는 같은 계정으로 본다");
  assert.strictEqual(accounts[0].전기말, 100);
  assert.strictEqual(accounts[0].당기말_수정전, 300);
});

console.log("분개 반영");

const { accounts: base } = WS.mergeAccounts(prior, current);

test("수정분개와 재분류를 컬럼별로 나눠 반영", () => {
  const adj = [
    { 번호: 1, 구분: "수정", 차변계정: "8200", 대변계정: "2100", 금액: 50, 적요: "미지급 수수료" },
    { 번호: 2, 구분: "재분류", 차변계정: "1300", 대변계정: "1100", 금액: 30, 적요: "선급금 대체" },
  ];
  const out = WS.applyAdjustments(base, adj);
  const by = Object.fromEntries(out.map(a => [a.코드, a]));

  assert.strictEqual(by["8200"].수정분개액, 50);
  assert.strictEqual(by["2100"].수정분개액, -50);
  assert.strictEqual(by["8200"].재분류액, 0, "수정과 재분류는 섞이지 않는다");

  assert.strictEqual(by["1300"].재분류액, 30);
  assert.strictEqual(by["1100"].재분류액, -30);

  assert.strictEqual(by["8200"].당기말_수정후, 200 + 50);
  assert.strictEqual(by["1100"].당기말_수정후, 800 - 30);
});

test("원본 배열을 바꾸지 않는다", () => {
  const before = JSON.stringify(base);
  WS.applyAdjustments(base, [{ 번호: 1, 차변계정: "1100", 대변계정: "4100", 금액: 999 }]);
  assert.strictEqual(JSON.stringify(base), before);
});

test("두 번 적용해도 누적되지 않는다", () => {
  const adj = [{ 번호: 1, 차변계정: "8200", 대변계정: "2100", 금액: 50 }];
  const once = WS.applyAdjustments(base, adj);
  const twice = WS.applyAdjustments(once, adj);
  const a = twice.find(x => x.코드 === "8200");
  assert.strictEqual(a.수정분개액, 50, "재계산이므로 100이 되면 안 된다");
});

console.log("차대 검증");

test("정상 분개는 통과", () => {
  const r = WS.verifyAdjustments(
    [{ 번호: 1, 차변계정: "8200", 대변계정: "2100", 금액: 50 }],
    ["8200", "2100"]
  );
  assert.ok(r.ok, r.errors.join(" / "));
  assert.strictEqual(r.차액합계, 0);
});

test("복합분개(한쪽만 입력)의 차대 불일치를 잡는다", () => {
  const r = WS.verifyAdjustments([
    { 번호: 3, 차변계정: "8200", 대변계정: "", 금액: 70 },
    { 번호: 3, 차변계정: "", 대변계정: "2100", 금액: 50 },
  ], ["8200", "2100"]);
  assert.ok(!r.ok);
  assert.ok(r.errors.some(e => /차대 불일치/.test(e)), r.errors.join(" / "));
  assert.strictEqual(r.차액합계, 20);
});

test("복합분개가 맞으면 통과", () => {
  const r = WS.verifyAdjustments([
    { 번호: 3, 차변계정: "8200", 대변계정: "", 금액: 70 },
    { 번호: 3, 차변계정: "", 대변계정: "2100", 금액: 50 },
    { 번호: 3, 차변계정: "", 대변계정: "1100", 금액: 20 },
  ], ["8200", "2100", "1100"]);
  assert.ok(r.ok, r.errors.join(" / "));
});

test("같은 번호라도 수정과 재분류는 따로 본다", () => {
  const r = WS.verifyAdjustments([
    { 번호: 1, 구분: "수정", 차변계정: "8200", 대변계정: "2100", 금액: 50 },
    { 번호: 1, 구분: "재분류", 차변계정: "1300", 대변계정: "1100", 금액: 30 },
  ], ["8200", "2100", "1300", "1100"]);
  assert.ok(r.ok, r.errors.join(" / "));
  assert.strictEqual(r.entries.length, 2);
});

test("정산표에 없는 계정코드를 잡는다", () => {
  const r = WS.verifyAdjustments(
    [{ 번호: 1, 차변계정: "9999", 대변계정: "2100", 금액: 50 }],
    ["8200", "2100"]
  );
  assert.ok(!r.ok);
  assert.ok(r.errors.some(e => /9999/.test(e)));
});

test("금액 0 이하와 계정 미입력을 잡는다", () => {
  const r = WS.verifyAdjustments([
    { 번호: 1, 차변계정: "8200", 대변계정: "2100", 금액: 0 },
    { 번호: 2, 차변계정: "", 대변계정: "", 금액: 10 },
  ], ["8200", "2100"]);
  assert.ok(!r.ok);
  assert.ok(r.errors.some(e => /금액이 0 이하/.test(e)));
  assert.ok(r.errors.some(e => /모두 비어/.test(e)));
});

console.log("정산표 차대평형");

test("합계가 0이면 균형", () => {
  const bal = WS.verifyBalance(WS.applyAdjustments(base, []));
  assert.strictEqual(bal.당기말_수정전, 0, "차대가 맞는 시산표는 합계 0");
  assert.ok(bal.ok);
});

test("한쪽만 반영되면 불균형으로 잡힌다", () => {
  const broken = WS.applyAdjustments(base, []).map(a =>
    a.코드 === "1100" ? Object.assign({}, a, { 당기말_수정후: a.당기말_수정후 + 100 }) : a);
  const bal = WS.verifyBalance(broken);
  assert.ok(!bal.ok);
  assert.strictEqual(bal.당기말_수정후, 100);
});

console.log("정산표 객체");

test("build 결과가 규격을 만족", () => {
  const meta = { 회사명: "마플", 회사코드: "MAPLE", 결산일: "2025-12-31" };
  const ws = WS.build(meta, base, [{ 번호: 1, 차변계정: "8200", 대변계정: "2100", 금액: 50 }]);
  assert.strictEqual(ws.version, WS.VERSION);
  assert.ok(ws.updated_at);
  assert.strictEqual(ws.meta.회사코드, "MAPLE");
  assert.ok(Array.isArray(ws.accounts) && ws.accounts.length);
  assert.strictEqual(ws.adjustments.length, 1);
  const keys = Object.keys(ws.accounts[0]);
  ["코드", "계정과목", "구분", "전기말", "당기말_수정전", "수정분개액", "재분류액", "당기말_수정후"]
    .forEach(k => assert.ok(keys.includes(k), k + " 컬럼이 있어야 한다"));
  assert.strictEqual(WS.validateShape(ws), null);
});

test("깨진 JSON은 불러오기에서 걸러진다", () => {
  assert.ok(WS.validateShape(null));
  assert.ok(WS.validateShape({ accounts: [] }), "meta 없음");
  assert.ok(WS.validateShape({ meta: { 회사코드: "X" } }), "accounts 없음");
});

console.log(`\n${passed}개 통과`);
