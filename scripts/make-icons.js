#!/usr/bin/env node
/*
 * 앱 아이콘을 다시 굽는다.  node scripts/make-icons.js
 * 색을 바꾸면 manifest.webmanifest 의 theme_color 도 같이 고친다.
 */
// playwright 로 SVG 를 그려 PNG 로 찍는다. 전역 설치본도 찾아본다.
const { chromium } = (function () {
  for (const p of ["playwright", "playwright-core", "/opt/node22/lib/node_modules/playwright"]) {
    try { return require(p); } catch (e) { /* 다음 후보 */ }
  }
  throw new Error("playwright 가 없습니다.  npm i -g playwright");
})();

/* 앱 아이콘 — 사이트 헤더 띠와 같은 하늘색 그러데이션에 흰 체크리스트.
   inset 은 마스커블용 안전 영역(모서리가 잘려도 글리프가 살아남게). */
function svg(size, inset) {
  const S = 512, g = S * (1 - inset * 2), o = S * inset;
  const p = n => o + g * n;
  const box = g * 0.19, r = box * 0.28, bx = p(0.02);
  const rows = [0.13, 0.41, 0.69].map((ty, i) => {
    const y = p(ty);
    const lh = g * 0.105, lw = g * (i === 2 ? 0.40 : 0.62);
    const bar = `<rect x="${p(0.30)}" y="${y + box / 2 - lh / 2}" width="${lw}" height="${lh}"
                   rx="${lh / 2}" fill="#fff" opacity="${i === 2 ? 0.5 : 1}"/>`;
    if (i === 0) {
      const cx = bx + box / 2, cy = y + box / 2, u = box * 0.30;
      return `<rect x="${bx}" y="${y}" width="${box}" height="${box}" rx="${r}" fill="#fff"/>`
        + `<path d="M ${cx - u} ${cy} l ${u * 0.72} ${u * 0.72} l ${u * 1.28} ${-u * 1.5}"
              fill="none" stroke="#2563C9" stroke-width="${box * 0.17}"
              stroke-linecap="round" stroke-linejoin="round"/>` + bar;
    }
    const sw = box * 0.12;
    return `<rect x="${bx + sw / 2}" y="${y + sw / 2}" width="${box - sw}" height="${box - sw}"
              rx="${r}" fill="none" stroke="#fff" stroke-width="${sw}"
              opacity="${i === 2 ? 0.5 : 0.85}"/>` + bar;
  }).join("\n  ");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${S} ${S}">
  <defs><linearGradient id="b" x1="0" y1="0" x2="0.55" y2="1">
    <stop offset="0" stop-color="#4EA8F0"/><stop offset="0.55" stop-color="#2F80DE"/><stop offset="1" stop-color="#2563C9"/>
  </linearGradient></defs>
  <rect width="${S}" height="${S}" fill="url(#b)"/>
  ${rows}
</svg>`;
}

(async () => {
  const b = await chromium.launch();
  for (const [out, size, inset] of [
    ["icons/icon-192.png", 192, 0.18],
    ["icons/icon-512.png", 512, 0.18],
    ["icons/icon-maskable-512.png", 512, 0.28],
    ["icons/apple-touch-icon.png", 180, 0.18],
    ["icons/favicon-32.png", 32, 0.12],
  ]) {
    const p = await b.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await p.setContent(`<body style="margin:0">${svg(size, inset)}</body>`);
    await p.screenshot({ path: out });
    await p.close();
    console.log(out);
  }
  await b.close();
})();
