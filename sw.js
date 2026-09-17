/*
 * 서비스 워커 — 홈 화면에 설치한 뒤 오프라인에서도 열리게 한다.
 *
 * ── 고칠 때 반드시 ──────────────────────────────────────
 * 파일을 추가하거나 지웠으면 ASSETS 를 고치고 VERSION 을 올린다.
 * VERSION 을 올리지 않으면 브라우저가 옛 캐시를 계속 쓴다.
 *
 * ── 저장 방식 ───────────────────────────────────────────
 * 캐시는 코드와 화면만 담는다. 거래처 명부와 감사 데이터는
 * localStorage 에 있고 이 워커가 건드리지 않는다.
 */
const VERSION = "v5";
const CACHE = "audit-desk-" + VERSION;

const ASSETS = [
  "./",
  "./index.html",
  "./tool.html",
  "./manifest.webmanifest",
  "./src/app.js",
  "./src/audit/coa.js",
  "./src/audit/export.js",
  "./src/audit/hub.js",
  "./src/audit/state.js",
  "./src/audit/tabs.js",
  "./src/audit/worksheet.js",
  "./src/data/cards.js",
  "./src/data/home.js",
  "./src/data/categories.js",
  "./src/data/posts.js",
  "./src/data/refs.js",
  "./src/data/tools.js",
  "./src/office/clients.js",
  "./src/office/deadlines.js",
  "./vendor/xlsx.full.min.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
];

self.addEventListener("install", function (e) {
  // 일부 파일이 실패해도 설치는 끝낸다. 하나 때문에 전체가 막히면 안 된다.
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return Promise.all(ASSETS.map(function (u) {
        return c.add(new Request(u, { cache: "reload" })).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === CACHE ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;

  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // 폰트 CDN 등은 그냥 통과

  // 화면 자체는 새것을 먼저 본다. 배포한 내용이 다음 실행에 바로 반영되게.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
        return res;
      }).catch(function () {
        return caches.match(req).then(function (hit) {
          return hit || caches.match("./index.html");
        });
      })
    );
    return;
  }

  // 나머지는 캐시를 먼저 주고 뒤에서 조용히 갱신한다.
  e.respondWith(
    caches.match(req).then(function (hit) {
      var live = fetch(req).then(function (res) {
        if (res && res.status === 200) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return hit; });
      return hit || live;
    })
  );
});
