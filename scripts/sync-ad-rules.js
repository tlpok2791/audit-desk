#!/usr/bin/env node
/**
 * 광고마케팅 KB 동기화 — 노션 데이터베이스 → config/ad-rules.json
 *
 *   NOTION_TOKEN=secret_xxx NOTION_AD_RULES_DB=<database_id> node scripts/sync-ad-rules.js
 *
 * 속성명을 코드에 하드코딩하지 않는다. 스키마를 런타임에 읽어 그대로 옮긴다.
 * 노션에서 속성을 추가하면 다시 돌리기만 하면 되고, 홈페이지 필터 UI도 따라 늘어난다.
 *
 * 페이지 본문(블록)은 가져오지 않는다. 행 속성만 가져온다.
 *
 * 옵션
 *   --db <id>      NOTION_AD_RULES_DB 대신 인자로 지정
 *   --out <path>   기본 config/ad-rules.json
 *   --dry          파일을 쓰지 않고 요약만 출력
 */

const fs = require("fs");
const path = require("path");

const API = "https://api.notion.com/v1";
const DEFAULT_VERSION = "2022-06-28";
const ROOT = path.resolve(__dirname, "..");

// 사람·파일 계열은 개인정보/만료 URL이라 담지 않는다
const SKIP_TYPES = new Set([
  "people", "files", "created_by", "last_edited_by",
]);

const warned = new Set();

function warn(msg) {
  if (warned.has(msg)) return;
  warned.add(msg);
  console.warn("  경고: " + msg);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--db") out.db = argv[++i];
    else if (a === "--out") out.out = argv[++i];
    else if (a === "--dry") out.dry = true;
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

/* ── 노션 호출 ─────────────────────────────────────────── */

async function notion(token, version, endpoint, options = {}) {
  const url = API + endpoint;
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: "Bearer " + token,
        "Notion-Version": version,
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });

    if (res.status === 429 || res.status >= 500) {
      const wait = Number(res.headers.get("retry-after") || 0) * 1000
        || Math.min(1000 * 2 ** attempt, 8000);
      console.warn(`  ${res.status} — ${Math.round(wait / 1000)}초 후 재시도`);
      await sleep(wait);
      continue;
    }

    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch (e) { body = { raw: text }; }

    if (!res.ok) {
      const msg = body.message || body.raw || res.statusText;
      throw new Error(`노션 API ${res.status} — ${msg}`);
    }
    return body;
  }
  throw new Error("재시도 한도를 넘었습니다. 잠시 후 다시 실행해 주세요.");
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * 스키마를 읽는다.
 * 2022-06-28: 데이터베이스가 properties를 직접 가진다.
 * 2025-09-03~: 데이터베이스가 data_sources를 가지고 스키마는 그 아래에 있다.
 * 어느 쪽이든 동작하도록 응답 모양을 보고 갈라진다.
 */
async function readSchema(token, version, dbId) {
  const db = await notion(token, version, `/databases/${dbId}`);

  if (db.properties) {
    return { properties: db.properties, queryPath: `/databases/${dbId}/query`, title: plainTitle(db) };
  }

  const sources = db.data_sources || [];
  if (!sources.length) {
    throw new Error("데이터베이스에서 속성 스키마를 찾지 못했습니다. 통합(integration)에 이 DB가 연결되어 있는지 확인해 주세요.");
  }
  if (sources.length > 1) {
    warn(`데이터 소스가 ${sources.length}개입니다. 첫 번째(${sources[0].name || sources[0].id})만 동기화합니다.`);
  }
  const ds = await notion(token, version, `/data_sources/${sources[0].id}`);
  return {
    properties: ds.properties || {},
    queryPath: `/data_sources/${sources[0].id}/query`,
    title: plainTitle(db),
  };
}

function plainTitle(db) {
  return (db.title || []).map(t => t.plain_text || "").join("").trim();
}

/** 100건 초과도 전부 가져온다. */
async function fetchAllRows(token, version, queryPath) {
  const rows = [];
  let cursor;
  let page = 0;

  do {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;

    const res = await notion(token, version, queryPath, {
      method: "POST",
      body: JSON.stringify(body),
    });

    rows.push(...(res.results || []));
    cursor = res.has_more ? res.next_cursor : null;
    page++;
    process.stdout.write(`\r  ${rows.length}건 조회`);
    if (cursor) await sleep(120); // 초당 3회 제한을 넉넉히 지킨다
  } while (cursor);

  process.stdout.write(`\r  ${rows.length}건 조회 완료 (${page}페이지)\n`);
  return rows;
}

/* ── 스키마 · 값 변환 ──────────────────────────────────── */

function buildSchema(properties) {
  const out = [];
  for (const [name, def] of Object.entries(properties)) {
    if (SKIP_TYPES.has(def.type)) continue;

    const entry = { name, type: def.type };
    const cfg = def[def.type];

    if (cfg && Array.isArray(cfg.options)) {
      entry.options = cfg.options.map(o => o.name);
    } else if (def.type === "status" && cfg && Array.isArray(cfg.options)) {
      entry.options = cfg.options.map(o => o.name);
    }
    out.push(entry);
  }
  return out;
}

function richText(arr) {
  return (arr || []).map(t => t.plain_text || "").join("").trim();
}

/** 표시값만 문자열로 (relation/rollup/formula 용) */
function displayString(prop) {
  switch (prop.type) {
    case "formula": {
      const f = prop.formula || {};
      if (f.type === "string") return f.string || "";
      if (f.type === "number") return f.number === null || f.number === undefined ? "" : String(f.number);
      if (f.type === "boolean") return f.boolean === null || f.boolean === undefined ? "" : String(f.boolean);
      if (f.type === "date") return f.date ? [f.date.start, f.date.end].filter(Boolean).join(" ~ ") : "";
      return "";
    }
    case "rollup": {
      const r = prop.rollup || {};
      if (r.type === "number") return r.number === null || r.number === undefined ? "" : String(r.number);
      if (r.type === "date") return r.date ? [r.date.start, r.date.end].filter(Boolean).join(" ~ ") : "";
      if (r.type === "array") {
        return (r.array || []).map(item => displayString(item)).filter(Boolean).join(", ");
      }
      return "";
    }
    // rollup array 안에 들어오는 원소들
    case "title": return richText(prop.title);
    case "rich_text": return richText(prop.rich_text);
    case "select": return prop.select ? prop.select.name : "";
    case "status": return prop.status ? prop.status.name : "";
    case "multi_select": return (prop.multi_select || []).map(o => o.name).join(", ");
    case "number": return prop.number === null || prop.number === undefined ? "" : String(prop.number);
    case "checkbox": return String(!!prop.checkbox);
    case "date": return prop.date ? [prop.date.start, prop.date.end].filter(Boolean).join(" ~ ") : "";
    case "relation":
      // 관계된 페이지 제목은 별도 조회가 필요하므로 ID만 남긴다
      return (prop.relation || []).map(r => r.id).join(", ");
    default:
      return "";
  }
}

const SKIP = Symbol("skip");

function convertValue(name, prop) {
  if (!prop || !prop.type) return null;
  if (SKIP_TYPES.has(prop.type)) return SKIP;

  switch (prop.type) {
    // 문자열
    case "title": return richText(prop.title);
    case "rich_text": return richText(prop.rich_text);

    // 값 문자열
    case "select": return prop.select ? prop.select.name : null;
    case "status": return prop.status ? prop.status.name : null;

    // 문자열 배열
    case "multi_select": return (prop.multi_select || []).map(o => o.name);

    // 그대로
    case "number": return prop.number ?? null;
    case "checkbox": return !!prop.checkbox;
    case "date": return prop.date ?? null;

    // 표시값만 문자열로
    case "relation":
    case "rollup":
    case "formula":
      return displayString(prop);

    default:
      warn(`알 수 없는 속성 타입 "${prop.type}" (속성: ${name}) — null 처리했습니다.`);
      return null;
  }
}

function convertRow(page) {
  const props = {};
  for (const [name, prop] of Object.entries(page.properties || {})) {
    const v = convertValue(name, prop);
    if (v === SKIP) continue;
    props[name] = v;
  }
  return {
    id: page.id,
    props,
    last_edited_time: page.last_edited_time || null,
  };
}

/* ── 실행 ──────────────────────────────────────────────── */

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log("사용법: NOTION_TOKEN=... NOTION_AD_RULES_DB=... node scripts/sync-ad-rules.js [--db ID] [--out 경로] [--dry]");
    return;
  }

  const token = process.env.NOTION_TOKEN || process.env.NOTION_API_KEY;
  const dbId = args.db || process.env.NOTION_AD_RULES_DB;
  const version = process.env.NOTION_VERSION || DEFAULT_VERSION;

  if (!token) {
    console.error("NOTION_TOKEN 이 없습니다. 노션 통합 토큰을 환경변수로 넣어 주세요.");
    console.error("  예: NOTION_TOKEN=secret_xxx NOTION_AD_RULES_DB=... node scripts/sync-ad-rules.js");
    process.exit(1);
  }
  if (!dbId) {
    console.error("NOTION_AD_RULES_DB 가 없습니다. 데이터베이스 ID를 넣거나 --db 로 지정해 주세요.");
    process.exit(1);
  }

  console.log(`노션 스키마를 읽는 중… (Notion-Version: ${version})`);
  const { properties, queryPath, title } = await readSchema(token, version, dbId);
  const schema = buildSchema(properties);

  const skipped = Object.entries(properties)
    .filter(([, d]) => SKIP_TYPES.has(d.type))
    .map(([n, d]) => `${n}(${d.type})`);
  if (skipped.length) {
    console.log(`  건너뛴 속성: ${skipped.join(", ")}`);
  }
  console.log(`  속성 ${schema.length}개: ${schema.map(s => `${s.name}(${s.type})`).join(", ")}`);

  console.log("행을 조회하는 중…");
  const pages = await fetchAllRows(token, version, queryPath);
  const rows = pages.map(convertRow);

  const payload = {
    database: { id: dbId, title: title || "" },
    schema,
    rows,
    synced_at: new Date().toISOString(),
  };

  if (args.dry) {
    console.log("--dry — 파일을 쓰지 않았습니다.");
    console.log(JSON.stringify({ ...payload, rows: rows.slice(0, 2) }, null, 2));
    return;
  }

  const outPath = path.resolve(ROOT, args.out || "config/ad-rules.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + "\n", "utf-8");

  console.log(`\n${path.relative(ROOT, outPath)} 저장 완료 — 속성 ${schema.length}개 · 행 ${rows.length}건`);
  console.log("홈페이지 광고마케팅 탭이 이 파일을 그대로 읽습니다.");
}

if (require.main === module) {
  main().catch(err => {
    console.error("\n동기화 실패 — " + err.message);
    process.exit(1);
  });
}

// 테스트에서 쓴다
module.exports = { buildSchema, convertRow, convertValue, displayString, readSchema, fetchAllRows, SKIP };
