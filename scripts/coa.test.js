/** COA 매핑 엔진 검증.  실행: node scripts/coa.test.js */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const COA = require("../src/audit/coa.js");

const std = JSON.parse(fs.readFileSync(path.join(__dirname, "../config/standard-coa.json"), "utf8"));

let passed = 0;
function test(name, fn) {
  try { fn(); console.log("  ✓ " + name); passed++; }
  catch (e) { console.error("  ✗ " + name + "\n    " + e.message); process.exitCode = 1; }
}

console.log("표준 COA 파일");

test("규격을 만족하고 코드 첫 자리 규약을 지킨다", () => {
  assert.strictEqual(COA.validateCoaShape(std), null);
  const 대분류별 = { "1": "자산", "2": "부채", "3": "자본", "4": "수익" };
  std.accounts.forEach(a => {
    const head = a.코드[0];
    const want = 대분류별[head] || "비용";
    assert.strictEqual(a.대분류, want, `${a.코드} ${a.표준계정과목명} 은 ${want} 여야 한다`);
    assert.ok(a.구분 === "BS" || a.구분 === "PL", a.코드 + " 구분");
  });
});

test("코드 중복 없음", () => {
  const codes = std.accounts.map(a => a.코드);
  assert.strictEqual(new Set(codes).size, codes.length);
});

console.log("유사도 후보 제안");

const list = std.accounts;

test("정확히 같은 이름이 1등", () => {
  const s = COA.suggest("매출채권", list);
  assert.strictEqual(s[0].표준계정과목명, "매출채권");
  assert.strictEqual(s[0].score, 1);
});

test("회사마다 다른 표기를 후보 위로 올린다", () => {
  const cases = [
    ["외상매출금", "매출채권"],
    ["보통예금", "현금및현금성자산"],
    ["외상매입금", "매입채무"],
    ["기업업무추진비", "접대비"],
    ["제품매출", "매출"],
    ["차량유지비", "차량유지비"],
    ["급 여", "급여"],
    ["소모품비(사무)", "소모품비"],
  ];
  cases.forEach(([company, want]) => {
    const s = COA.suggest(company, list, 5);
    const names = s.map(x => x.표준계정과목명);
    assert.ok(names.includes(want),
      `"${company}" 후보에 ${want} 가 없다 — 실제: ${names.join(", ")}`);
  });
});

test("후보를 돌려줄 뿐 자동 확정하지 않는다", () => {
  const s = COA.suggest("외상매출금", list);
  assert.ok(Array.isArray(s));
  assert.ok(s.every(x => typeof x.score === "number"));
  // 확정 여부를 담는 필드가 없다 — 결정은 화면에서 사람이 한다
  assert.ok(!("confirmed" in s[0]));
});

test("전혀 다른 이름은 점수가 낮다", () => {
  const s = COA.suggest("우주선구입비", list);
  assert.ok(s[0].score < 0.6, "실제 점수 " + s[0].score);
});

console.log("매핑 적용");

const company = [
  { 코드: "101", 계정과목: "현금" },
  { 코드: "108", 계정과목: "외상매출금" },
  { 코드: "251", 계정과목: "외상매입금" },
  { 코드: "999", 계정과목: "신규계정" },
];

test("저장된 매핑이 없으면 전부 미매핑", () => {
  const rows = COA.applyMap(company, COA.emptyMap("MAPLE"));
  assert.strictEqual(COA.unmapped(rows).length, 4);
  assert.ok(rows.every(r => r.출처 === ""));
});

test("이전 기수 매핑을 붙이고 신규 계정만 남긴다", () => {
  const prev = {
    회사코드: "MAPLE", entries: [
      { 회사계정코드: "101", 회사계정과목명: "현금", 표준COA코드: "1100" },
      { 회사계정코드: "108", 회사계정과목명: "외상매출금", 표준COA코드: "1200" },
      { 회사계정코드: "251", 회사계정과목명: "외상매입금", 표준COA코드: "2100" },
    ],
  };
  const rows = COA.applyMap(company, prev);
  const un = COA.unmapped(rows);
  assert.strictEqual(un.length, 1, "신규계정 하나만 남아야 한다");
  assert.strictEqual(un[0].회사계정과목명, "신규계정");
  assert.strictEqual(rows[0].표준COA코드, "1100");
  assert.strictEqual(rows[0].출처, "저장");
});

test("계정코드가 바뀌어도 이름으로 붙는다", () => {
  const prev = { entries: [{ 회사계정코드: "0108", 회사계정과목명: "외상매출금", 표준COA코드: "1200" }] };
  const rows = COA.applyMap([{ 코드: "108", 계정과목: "외상 매출금" }], prev);
  assert.strictEqual(rows[0].표준COA코드, "1200", "공백 차이·코드 차이를 넘어 매칭");
});

test("미매핑이 하나라도 있으면 unmapped 가 비지 않는다 (생성 차단 근거)", () => {
  const rows = COA.applyMap(company, COA.emptyMap("X"));
  rows.forEach((r, i) => { if (i < 3) r.표준COA코드 = "1100"; });
  assert.strictEqual(COA.unmapped(rows).length, 1);
});

console.log("매핑 저장");

test("확정 매핑을 파일 모양으로 만들고 기존 것과 합친다", () => {
  const prev = {
    회사코드: "MAPLE",
    entries: [{ 회사계정코드: "101", 회사계정과목명: "현금", 표준COA코드: "1100" }],
  };
  const rows = [
    { 회사계정코드: "108", 회사계정과목명: "외상매출금", 표준COA코드: "1200" },
    { 회사계정코드: "999", 회사계정과목명: "신규계정", 표준COA코드: "6390" },
    { 회사계정코드: "777", 회사계정과목명: "미확정", 표준COA코드: "" },  // 저장 안 됨
  ];
  const m = COA.buildMap("MAPLE", rows, prev);
  assert.strictEqual(COA.validateMapShape(m), null);
  assert.strictEqual(m.회사코드, "MAPLE");
  assert.ok(m.updated_at);
  const names = m.entries.map(e => e.회사계정과목명).sort();
  assert.deepStrictEqual(names, ["신규계정", "외상매출금", "현금"], "미확정은 저장되지 않는다");
});

test("같은 계정을 다시 확정하면 덮어쓴다", () => {
  const prev = { entries: [{ 회사계정코드: "108", 회사계정과목명: "외상매출금", 표준COA코드: "9999" }] };
  const m = COA.buildMap("X", [{ 회사계정코드: "108", 회사계정과목명: "외상매출금", 표준COA코드: "1200" }], prev);
  assert.strictEqual(m.entries.length, 1);
  assert.strictEqual(m.entries[0].표준COA코드, "1200");
});

test("깨진 매핑 파일은 걸러진다", () => {
  assert.ok(COA.validateMapShape(null));
  assert.ok(COA.validateMapShape({ 회사코드: "X" }));
  assert.strictEqual(COA.validateMapShape({ entries: [] }), null);
});

console.log(`\n${passed}개 통과`);
