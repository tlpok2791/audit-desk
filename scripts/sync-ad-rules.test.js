/**
 * sync-ad-rules.js 검증 — 노션 API를 흉내 내어 변환 규칙과 페이지네이션을 확인한다.
 * 실행: node scripts/sync-ad-rules.test.js
 */
const assert = require("assert");
const S = require("./sync-ad-rules.js");

let passed = 0;
function test(name, fn) {
  try { fn(); console.log("  ✓ " + name); passed++; }
  catch (e) { console.error("  ✗ " + name + "\n    " + e.message); process.exitCode = 1; }
}

console.log("변환 규칙");

test("title / rich_text → 문자열", () => {
  const row = S.convertRow({
    id: "p1",
    last_edited_time: "2026-01-01T00:00:00.000Z",
    properties: {
      규칙명: { type: "title", title: [{ plain_text: "최상급 " }, { plain_text: "표현 금지" }] },
      내용: { type: "rich_text", rich_text: [{ plain_text: "  근거 없이 쓰지 않는다  " }] },
    },
  });
  assert.strictEqual(row.props["규칙명"], "최상급 표현 금지");
  assert.strictEqual(row.props["내용"], "근거 없이 쓰지 않는다");
  assert.strictEqual(row.id, "p1");
  assert.strictEqual(row.last_edited_time, "2026-01-01T00:00:00.000Z");
});

test("select / status → 값 문자열, 비었으면 null", () => {
  const row = S.convertRow({
    properties: {
      채널: { type: "select", select: { name: "메타", color: "blue" } },
      중요도: { type: "status", status: { name: "필수" } },
      빈select: { type: "select", select: null },
    },
  });
  assert.strictEqual(row.props["채널"], "메타");
  assert.strictEqual(row.props["중요도"], "필수");
  assert.strictEqual(row.props["빈select"], null);
});

test("multi_select → 문자열 배열", () => {
  const row = S.convertRow({
    properties: {
      단계: { type: "multi_select", multi_select: [{ name: "기획" }, { name: "집행" }] },
      빈것: { type: "multi_select", multi_select: [] },
    },
  });
  assert.deepStrictEqual(row.props["단계"], ["기획", "집행"]);
  assert.deepStrictEqual(row.props["빈것"], []);
});

test("number / checkbox / date → 그대로", () => {
  const d = { start: "2026-07-01", end: null, time_zone: null };
  const row = S.convertRow({
    properties: {
      우선순위: { type: "number", number: 3 },
      영: { type: "number", number: 0 },
      빈수: { type: "number", number: null },
      활성: { type: "checkbox", checkbox: true },
      최종검토일: { type: "date", date: d },
      빈날짜: { type: "date", date: null },
    },
  });
  assert.strictEqual(row.props["우선순위"], 3);
  assert.strictEqual(row.props["영"], 0, "0이 null로 뭉개지면 안 된다");
  assert.strictEqual(row.props["빈수"], null);
  assert.strictEqual(row.props["활성"], true);
  assert.deepStrictEqual(row.props["최종검토일"], d, "date는 객체 그대로");
  assert.strictEqual(row.props["빈날짜"], null);
});

test("relation / rollup / formula → 표시값 문자열", () => {
  const row = S.convertRow({
    properties: {
      관련: { type: "relation", relation: [{ id: "a" }, { id: "b" }] },
      건수: { type: "rollup", rollup: { type: "number", number: 14 } },
      태그모음: {
        type: "rollup",
        rollup: { type: "array", array: [
          { type: "select", select: { name: "심의" } },
          { type: "rich_text", rich_text: [{ plain_text: "카피" }] },
        ] },
      },
      라벨: { type: "formula", formula: { type: "string", string: "[필수] 심의" } },
      계산수: { type: "formula", formula: { type: "number", number: 0 } },
      참거짓: { type: "formula", formula: { type: "boolean", boolean: false } },
    },
  });
  assert.strictEqual(row.props["관련"], "a, b");
  assert.strictEqual(row.props["건수"], "14");
  assert.strictEqual(row.props["태그모음"], "심의, 카피");
  assert.strictEqual(row.props["라벨"], "[필수] 심의");
  assert.strictEqual(row.props["계산수"], "0");
  assert.strictEqual(row.props["참거짓"], "false");
  assert.strictEqual(typeof row.props["건수"], "string", "표시값은 문자열이어야 한다");
});

test("사람·파일 속성은 아예 담지 않는다", () => {
  const row = S.convertRow({
    properties: {
      규칙명: { type: "title", title: [{ plain_text: "x" }] },
      담당자: { type: "people", people: [{ id: "u1", name: "홍길동" }] },
      첨부: { type: "files", files: [{ name: "a.png" }] },
      만든이: { type: "created_by", created_by: { id: "u2" } },
      고친이: { type: "last_edited_by", last_edited_by: { id: "u3" } },
    },
  });
  assert.deepStrictEqual(Object.keys(row.props), ["규칙명"]);
});

test("알 수 없는 타입은 에러 없이 null", () => {
  const row = S.convertRow({
    properties: {
      신기능: { type: "brand_new_type_2027", brand_new_type_2027: { whatever: 1 } },
    },
  });
  assert.strictEqual(row.props["신기능"], null);
});

console.log("스키마");

test("select/status/multi_select는 options를 함께 담고, 사람·파일은 뺀다", () => {
  const schema = S.buildSchema({
    규칙명: { type: "title", title: {} },
    채널: { type: "select", select: { options: [{ name: "메타" }, { name: "블로그" }] } },
    중요도: { type: "status", status: { options: [{ name: "필수" }, { name: "권장" }] } },
    단계: { type: "multi_select", multi_select: { options: [{ name: "기획" }] } },
    우선순위: { type: "number", number: {} },
    담당자: { type: "people", people: {} },
    첨부: { type: "files", files: {} },
  });
  const byName = Object.fromEntries(schema.map(s => [s.name, s]));
  assert.deepStrictEqual(byName["채널"].options, ["메타", "블로그"]);
  assert.deepStrictEqual(byName["중요도"].options, ["필수", "권장"]);
  assert.deepStrictEqual(byName["단계"].options, ["기획"]);
  assert.strictEqual(byName["우선순위"].options, undefined);
  assert.strictEqual(byName["규칙명"].type, "title");
  assert.ok(!byName["담당자"], "people은 스키마에서 빠져야 한다");
  assert.ok(!byName["첨부"], "files는 스키마에서 빠져야 한다");
});

console.log("API 연동 (모의)");

function mockFetch(handler) {
  global.fetch = async (url, opts) => {
    const res = handler(url, opts);
    return {
      ok: res.status ? res.status < 400 : true,
      status: res.status || 200,
      statusText: "",
      headers: { get: () => null },
      text: async () => JSON.stringify(res.body),
    };
  };
}

(async function asyncTests() {
  // 페이지네이션 — 100건 초과
  let calls = 0;
  mockFetch((url, opts) => {
    if (url.endsWith("/query")) {
      calls++;
      const body = JSON.parse(opts.body);
      if (!body.start_cursor) {
        return { body: { results: Array.from({ length: 100 }, (_, i) => ({ id: "a" + i, properties: {} })), has_more: true, next_cursor: "c1" } };
      }
      return { body: { results: Array.from({ length: 37 }, (_, i) => ({ id: "b" + i, properties: {} })), has_more: false, next_cursor: null } };
    }
    return { body: {} };
  });

  const rows = await S.fetchAllRows("t", "2022-06-28", "/databases/x/query");
  test("100건 초과 페이지네이션", () => {
    assert.strictEqual(rows.length, 137);
    assert.strictEqual(calls, 2);
    assert.strictEqual(rows[136].id, "b36");
  });

  // 구버전 스키마 (properties 직접)
  mockFetch(url => ({ body: { properties: { 규칙명: { type: "title", title: {} } }, title: [{ plain_text: "광고 KB" }] } }));
  const oldSchema = await S.readSchema("t", "2022-06-28", "dbid");
  test("2022-06-28 — databases 응답의 properties를 읽는다", () => {
    assert.strictEqual(oldSchema.queryPath, "/databases/dbid/query");
    assert.ok(oldSchema.properties["규칙명"]);
    assert.strictEqual(oldSchema.title, "광고 KB");
  });

  // 신버전 스키마 (data_sources 경유)
  mockFetch(url => {
    if (url.includes("/data_sources/")) {
      return { body: { properties: { 채널: { type: "select", select: { options: [] } } } } };
    }
    return { body: { data_sources: [{ id: "ds1", name: "기본" }], title: [{ plain_text: "광고 KB" }] } };
  });
  const newSchema = await S.readSchema("t", "2025-09-03", "dbid");
  test("2025-09-03 — data_sources 경유로 스키마를 읽는다", () => {
    assert.strictEqual(newSchema.queryPath, "/data_sources/ds1/query");
    assert.ok(newSchema.properties["채널"]);
  });

  // 오류 전달
  mockFetch(() => ({ status: 404, body: { message: "Could not find database" } }));
  let threw = null;
  try { await S.readSchema("t", "2022-06-28", "nope"); } catch (e) { threw = e; }
  test("API 오류는 메시지를 담아 던진다", () => {
    assert.ok(threw, "에러가 나야 한다");
    assert.ok(/404/.test(threw.message) && /Could not find/.test(threw.message), threw.message);
  });

  console.log(`\n${passed}개 통과`);
})();
