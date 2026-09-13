#!/usr/bin/env node
/**
 * 신고 기한 규칙 엔진 검증.
 *
 *   node scripts/deadlines.test.js
 *
 * 거래처 유형별로 나와야 할 항목이 나오는지, 나오면 안 되는 것이 안 나오는지 본다.
 */

const D = require("../src/office/deadlines.js");

let pass = 0, fail = 0;

function ok(cond, label) {
  if (cond) { pass++; return; }
  fail++;
  console.error("  실패 — " + label);
}

function whats(list) { return list.map(d => d.what); }
function has(list, frag) { return whats(list).some(w => w.includes(frag)); }
function at(list, frag) { return list.find(d => d.what.includes(frag)); }

/* ── 병의원 개인 (면세, 직원 있음, 매월납) ────────────────── */
{
  const c = { name: "행복의원", entity: "indiv", vat: "exempt",
              hasStaff: true, wtPeriod: "monthly", medical: true };
  const r = D.forClient(c);

  ok(has(r, "사업장현황신고"), "면세 개인 → 사업장현황신고가 있어야 한다");
  ok(at(r, "사업장현황신고").month === 2 && at(r, "사업장현황신고").day === 10,
     "사업장현황신고는 2월 10일");
  ok(!has(r, "부가가치세"), "순수 면세사업자에게 부가세 신고가 나오면 안 된다");
  ok(has(r, "종합소득세 확정신고"), "개인 → 종합소득세");
  ok(has(r, "중간예납"), "개인 → 중간예납");
  ok(!has(r, "법인세"), "개인에게 법인세가 나오면 안 된다");
  ok(at(r, "원천세 신고").month === 0, "매월납 원천세는 month 0(매월)으로 표시");
  ok(has(r, "지급명세서"), "직원 있음 → 지급명세서");
  ok(!has(r, "성실신고"), "성실신고 대상이 아니면 나오면 안 된다");
}

/* ── 겸업 의원 (미용 시술 섞임) ──────────────────────────── */
{
  const c = { name: "겸업의원", entity: "indiv", vat: "both",
              hasStaff: true, wtPeriod: "monthly", medical: true };
  const r = D.forClient(c);
  ok(has(r, "부가가치세 확정신고"), "겸업 → 부가세 확정신고가 있어야 한다");
  ok(has(r, "사업장현황신고"), "겸업 → 사업장현황신고도 있어야 한다");
  ok(has(r, "예정고지"), "개인 과세분은 예정'고지'여야 한다 (예정신고가 아니라)");
  ok(!has(r, "예정신고"), "개인에게 부가세 예정신고가 나오면 안 된다");
}

/* ── 법인 12월 결산 (과세, 직원 있음) ───────────────────── */
{
  const c = { name: "마플", entity: "corp", vat: "taxable",
              hasStaff: true, wtPeriod: "monthly", fyEndMonth: 12 };
  const r = D.forClient(c);

  ok(has(r, "예정신고"), "법인 → 부가세 예정신고");
  ok(!has(r, "예정고지"), "법인에게 예정고지가 나오면 안 된다");
  const ct = at(r, "법인세");
  ok(ct && ct.month === 3 && ct.day === 31, "12월 결산 → 법인세는 3월 31일");
  ok(!has(r, "종합소득세"), "법인에게 종합소득세가 나오면 안 된다");
  ok(!has(r, "사업장현황신고"), "법인에게 사업장현황신고가 나오면 안 된다");
}

/* ── 법인 3월 결산 — 결산월 + 3개월 말일 ────────────────── */
{
  const r = D.forClient({ entity: "corp", vat: "taxable", fyEndMonth: 3 });
  const ct = at(r, "법인세");
  ok(ct && ct.month === 6 && ct.day === 30, "3월 결산 → 6월 30일");
}
{
  const r = D.forClient({ entity: "corp", vat: "taxable", fyEndMonth: 10 });
  const ct = at(r, "법인세");
  ok(ct && ct.month === 1 && ct.day === 31, "10월 결산 → 이듬해 1월 31일 (해 넘김)");
}
{
  const r = D.forClient({ entity: "corp", vat: "taxable", fyEndMonth: 11 });
  const ct = at(r, "법인세");
  ok(ct && ct.month === 2 && ct.day === 28, "11월 결산 → 2월 말일(28)");
}

/* ── 원천세 반기납 ──────────────────────────────────────── */
{
  const r = D.forClient({ entity: "indiv", vat: "taxable",
                          hasStaff: true, wtPeriod: "half" });
  const halves = r.filter(d => d.what.includes("원천세 반기"));
  ok(halves.length === 2, "반기납 → 1월·7월 두 건");
  ok(halves.every(d => d.day === 10), "반기납 기한은 10일");
  ok(!r.some(d => d.month === 0), "반기납이면 '매월' 항목이 없어야 한다");
}

/* ── 직원 없음 ──────────────────────────────────────────── */
{
  const r = D.forClient({ entity: "indiv", vat: "taxable", hasStaff: false });
  ok(!has(r, "원천세"), "직원 없음 → 원천세 없음");
  ok(!has(r, "지급명세서"), "직원 없음 → 지급명세서 없음");
}

/* ── 성실신고 대상 ──────────────────────────────────────── */
{
  const r = D.forClient({ entity: "indiv", vat: "taxable", honest: true });
  const h = at(r, "성실신고");
  ok(h && h.month === 6 && h.day === 30, "성실신고확인 → 6월 30일");
}

/* ── 정렬 ───────────────────────────────────────────────── */
{
  const r = D.forClient({ entity: "indiv", vat: "taxable",
                          hasStaff: true, wtPeriod: "monthly" });
  const months = r.map(d => d.month);
  ok(months[0] === 0, "'매월' 항목이 맨 앞에 온다");
  const rest = months.slice(1);
  ok(rest.every((m, i) => i === 0 || rest[i - 1] <= m), "나머지는 월 오름차순");
}

/* ── 여러 거래처의 달별 보기 ────────────────────────────── */
{
  const clients = [
    { name: "행복의원", entity: "indiv", vat: "exempt", hasStaff: true, wtPeriod: "monthly" },
    { name: "마플",     entity: "corp",  vat: "taxable", hasStaff: false, fyEndMonth: 12 },
    { name: "김사장",   entity: "indiv", vat: "taxable", hasStaff: false },
  ];

  const feb = D.monthView(clients, 2);
  ok(feb.some(r => r.client.name === "행복의원"), "2월 → 행복의원(사업장현황신고)");

  const jan = D.monthView(clients, 1);
  ok(jan.some(r => r.client.name === "마플"), "1월 → 마플(부가세 확정)");
  ok(jan.some(r => r.client.name === "행복의원"), "1월 → 행복의원(매월 원천세)");

  const may = D.monthView(clients, 5);
  ok(may.length === 2, "5월 → 개인 2곳(종소세). 법인은 빠진다");

  ok(D.monthCount(clients, 3) > 0, "3월 건수가 0보다 크다");
  ok(D.monthView([], 5).length === 0, "거래처가 없으면 빈 배열");
}

/* ── 빈 입력 ────────────────────────────────────────────── */
ok(D.forClient(null).length === 0, "null 이면 빈 배열");
ok(D.forClient({}).length === 0, "속성이 없으면 빈 배열");

/* ── lastDay ────────────────────────────────────────────── */
ok(D.lastDay(1) === 31 && D.lastDay(2) === 28 && D.lastDay(4) === 30,
   "말일 계산 (평년 기준)");

console.log(`\n신고 기한 엔진 — ${pass}건 통과${fail ? `, ${fail}건 실패` : ""}`);
process.exit(fail ? 1 : 0);
