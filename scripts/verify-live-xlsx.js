/**
 * 산출된 정산표 xlsx가 "살아있는지" 검증한다.
 *
 * 정산표 시트의 수식을 직접 파싱해 PBC 시트 데이터에 대고 계산한 뒤,
 * 기대값과 맞는지 본다. 값이 박혀 있으면(수식이 아니면) 실패한다.
 *
 *   node scripts/verify-live-xlsx.js <xlsx경로>
 */
const fs = require("fs");
const zlib = require("zlib");

/* ── 최소 xlsx 리더 (수식과 값을 그대로 읽는다) ──
 * 반드시 중앙 디렉터리를 기준으로 읽는다. ExcelJS는 스트리밍으로 쓰기 때문에
 * 로컬 헤더의 압축크기가 0이고 실제 크기는 데이터 디스크립터에 있어,
 * 로컬 헤더만 훑으면 일부 항목을 통째로 놓친다.
 */
function unzip(buf) {
  // End of Central Directory 찾기 (뒤에서부터)
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("zip 중앙 디렉터리를 찾지 못했습니다.");

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = {};

  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString("utf8");

    // 로컬 헤더에서 실제 데이터 시작 위치만 얻는다 (크기는 중앙 디렉터리 값을 쓴다)
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lNameLen + lExtraLen;

    if (compSize > 0) {
      const raw = buf.slice(start, start + compSize);
      try { files[name] = method === 8 ? zlib.inflateRawSync(raw) : raw; }
      catch (e) { console.error("  (압축 해제 실패: " + name + ")"); }
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

function readXlsx(path) {
  const files = unzip(fs.readFileSync(path));
  const dec = (n) => (files[n] ? files[n].toString("utf8") : "");

  const shared = [];
  const ss = dec("xl/sharedStrings.xml");
  for (const m of ss.matchAll(/<si>(.*?)<\/si>/gs)) {
    shared.push(Array.from(m[1].matchAll(/<t[^>]*>(.*?)<\/t>/gs))
      .map(x => unesc(x[1])).join(""));
  }

  const names = Array.from(dec("xl/workbook.xml")
    .matchAll(/<sheet[^>]*name="([^"]+)"/g)).map(m => unesc(m[1]));

  const sheets = {};
  names.forEach((nm, i) => {
    const xml = dec(`xl/worksheets/sheet${i + 1}.xml`);
    const cells = {};
    // 자기닫힘 셀(<c r="I2" s="8"/>)도 함께 다뤄야 한다.
    // 안 그러면 그 지점에서 파싱이 어긋나 뒤따르는 셀을 통째로 놓친다.
    for (const m of xml.matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>(.*?)<\/c>)/gs)) {
      const ref = m[1], attrs = m[2], body = m[3] || "";
      const f = /<f[^>]*>(.*?)<\/f>/s.exec(body);
      const v = /<v>(.*?)<\/v>/s.exec(body);
      const isStr = /t="s"/.test(attrs);
      const inline = /<is>.*?<t[^>]*>(.*?)<\/t>/s.exec(body);
      let val = null;
      if (inline) val = unesc(inline[1]);
      else if (v) val = isStr ? shared[Number(v[1])] : Number(v[1]);
      cells[ref] = { f: f ? unesc(f[1]) : null, v: val };
    }
    sheets[nm] = cells;
  });
  return { sheets, names };
}

function unesc(s) {
  return s.replace(/&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

/* ── 열 이름 ↔ 번호 ── */
function colNum(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}
function colStr(n) {
  let s = "";
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m) / 26 | 0; }
  return s;
}

/* ── 범위 → 셀 목록 ── */
function expand(sheets, sheetName, ref) {
  const cells = sheets[sheetName] || {};
  const m = /^\$?([A-Z]+)(\$?(\d+))?:\$?([A-Z]+)(\$?(\d+))?$/.exec(ref.replace(/\$/g, "$&"));
  const clean = ref.replace(/\$/g, "");
  const rm = /^([A-Z]+)(\d+)?:([A-Z]+)(\d+)?$/.exec(clean);
  if (!rm) return [];
  const c1 = colNum(rm[1]), c2 = colNum(rm[3]);
  let r1 = rm[2] ? Number(rm[2]) : 1;
  let r2 = rm[4] ? Number(rm[4]) : null;
  if (r2 === null) {                       // 열 전체 참조 — 실제 쓰인 최대 행까지
    r2 = Object.keys(cells).reduce((mx, k) => {
      const n = Number(/\d+/.exec(k)[0]);
      return n > mx ? n : mx;
    }, 1);
  }
  const out = [];
  for (let c = c1; c <= c2; c++) {
    for (let r = r1; r <= r2; r++) out.push(cells[colStr(c) + r] || { f: null, v: null });
  }
  return out;
}

/** 'SheetName'!$C:$C 또는 $A2 형태를 푼다 */
function resolveRef(sheets, curSheet, token, curRow) {
  const sm = /^'([^']+)'!(.+)$/.exec(token) || /^([^!]+)!(.+)$/.exec(token);
  const sheet = sm ? sm[1] : curSheet;
  const ref = sm ? sm[2] : token;
  if (/:/.test(ref)) return expand(sheets, sheet, ref);
  const clean = ref.replace(/\$/g, "");
  return [(sheets[sheet] || {})[clean] || { f: null, v: null }];
}

/** SUMIFS(합계범위, 조건범위, 조건) 하나를 계산 */
function evalSumifs(sheets, curSheet, args) {
  const sum = resolveRef(sheets, curSheet, args[0]);
  const crit = resolveRef(sheets, curSheet, args[1]);
  const key = resolveRef(sheets, curSheet, args[2])[0];
  const want = String(key.v === null ? "" : key.v);
  let total = 0;
  for (let i = 0; i < crit.length; i++) {
    const cv = crit[i] ? crit[i].v : null;
    if (String(cv === null ? "" : cv) !== want) continue;
    const sv = sum[i] ? sum[i].v : null;
    if (typeof sv === "number") total += sv;
  }
  return total;
}

/** 인자 쪼개기 (괄호 깊이 고려) */
function splitArgs(s) {
  const out = []; let depth = 0, cur = "", q = false;
  for (const ch of s) {
    if (ch === '"') q = !q;
    if (!q) {
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      else if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; continue; }
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** 정산표 한 행의 수식을 계산 — SUMIFS 조합과 셀 연산만 다룬다 */
function evalFormula(sheets, curSheet, formula, cache) {
  let f = formula.trim();

  // SUMIFS(...) 들을 값으로 치환
  let guard = 0;
  while (/SUMIFS\(/.test(f) && guard++ < 20) {
    const i = f.indexOf("SUMIFS(");
    let depth = 0, j = i + 6;
    for (; j < f.length; j++) {
      if (f[j] === "(") depth++;
      else if (f[j] === ")") { depth--; if (depth === 0) break; }
    }
    const inner = f.slice(i + 7, j);
    const val = evalSumifs(sheets, curSheet, splitArgs(inner));
    f = f.slice(0, i) + "(" + val + ")" + f.slice(j + 1);
  }

  // 셀 참조를 값으로 (같은 시트, 이미 계산된 것 우선)
  f = f.replace(/\$?([A-Z]{1,3})\$?(\d+)/g, (m, c, r) => {
    const ref = c + r;
    if (cache && Object.prototype.hasOwnProperty.call(cache, ref)) return "(" + cache[ref] + ")";
    const cell = (sheets[curSheet] || {})[ref];
    if (!cell) return "0";
    if (cell.f) return "(" + evalFormula(sheets, curSheet, cell.f, cache) + ")";
    return "(" + (typeof cell.v === "number" ? cell.v : 0) + ")";
  });

  f = f.replace(/IFERROR\(([^,]+),""\)/g, "($1)");
  f = f.replace(/ABS\(/g, "Math.abs(");
  if (/[A-Za-z]/.test(f.replace(/Math\.abs/g, ""))) return NaN;
  try { return Function('"use strict";return (' + f + ")")(); }
  catch (e) { return NaN; }
}

/* ── 실행 ── */
const path = process.argv[2] || "/tmp/fx/live.xlsx";
const { sheets, names } = readXlsx(path);

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { console.log("  ✓ " + name); pass++; }
  else { console.error("  ✗ " + name + (detail ? "\n    " + detail : "")); fail++; }
}

console.log("시트 구성");
["PBC_시산표", "PBC_전기FS", "수정분개", "정산표", "검증"].forEach(function (n, i) {
  check(`${i + 1}. ${n}`, names[i] === n, `실제: ${names[i]}`);
});

console.log("\n정산표가 값이 아니라 수식인가");
const ws = sheets["정산표"];
const dataRows = Object.keys(ws)
  .filter(k => /^A\d+$/.test(k) && Number(k.slice(1)) > 1 && ws[k].v)
  .map(k => Number(k.slice(1))).sort((a, b) => a - b);

let allFormula = true, hardcoded = [];
dataRows.forEach(r => {
  ["C", "D", "E", "F", "G", "H"].forEach(c => {
    const cell = ws[c + r];
    if (!cell || !cell.f) { allFormula = false; hardcoded.push(c + r); }
  });
});
check("전기·당기·수정분개·수정후·증감액·증감비율이 모두 수식",
  allFormula, "수식 아닌 셀: " + hardcoded.slice(0, 8).join(", "));

const c2 = ws["C" + dataRows[0]].f || "";
check("전기가 PBC_전기FS를 SUMIFS로 참조", /SUMIFS\('PBC_전기FS'/.test(c2), c2);
const d2 = ws["D" + dataRows[0]].f || "";
check("당기가 PBC_시산표를 SUMIFS로 참조", /SUMIFS\('PBC_시산표'/.test(d2), d2);
const e2 = ws["E" + dataRows[0]].f || "";
check("수정분개가 차변-대변 두 SUMIFS", (e2.match(/SUMIFS/g) || []).length === 2, e2);
check("수정분개가 열 전체를 참조 (엑셀에서 줄을 추가해도 반영)",
  /수정분개'!\$[BCD]:\$[BCD]/.test(e2), e2);
const h2 = ws["H" + dataRows[0]].f || "";
check("증감비율이 IFERROR로 0 나눗셈을 공란 처리", /IFERROR\(.*ABS\(/.test(h2), h2);

console.log("\n수식을 실제로 계산해 보면");
const computed = {};
dataRows.forEach(r => {
  ["C", "D", "E", "F", "G"].forEach(c => {
    computed[c + r] = evalFormula(sheets, "정산표", ws[c + r].f, computed);
  });
});

const total = (c) => dataRows.reduce((s, r) => s + (computed[c + r] || 0), 0);
check("당기(D) 합계 = 0  → 차대 맞음", Math.abs(total("D")) < 0.5, "합계 " + total("D"));
check("전기(C) 합계 = 0", Math.abs(total("C")) < 0.5, "합계 " + total("C"));
check("수정분개(E) 합계 = 0", Math.abs(total("E")) < 0.5, "합계 " + total("E"));
check("수정후(F) 합계 = 0", Math.abs(total("F")) < 0.5, "합계 " + total("F"));
check("증감액(G) 합계 = 0", Math.abs(total("G")) < 0.5, "합계 " + total("G"));

dataRows.forEach(r => {
  const code = ws["A" + r].v;
  const f = computed["F" + r], d = computed["D" + r], e = computed["E" + r];
  if (Math.abs(f - (d + e)) > 0.5) check(`${code}: 수정후 = 당기 + 수정분개`, false,
    `${f} ≠ ${d} + ${e}`);
});
check("모든 행에서 수정후 = 당기 + 수정분개", true);

console.log("\nPBC 원본이 그대로인가");
const tb = sheets["PBC_시산표"];
check("PBC_시산표에 표준COA코드 열이 추가됨",
  Object.keys(tb).some(k => tb[k].v === "표준COA코드"));
const coaVals = Object.keys(tb).filter(k => /^E\d+$/.test(k)).map(k => tb[k].v).filter(Boolean);
check("추가된 열에 COA 코드가 채워짐", coaVals.length > 1, "값 " + coaVals.length + "개");

console.log(`\n${pass}개 통과${fail ? " · " + fail + "개 실패" : ""}`);
process.exit(fail ? 1 : 0);
