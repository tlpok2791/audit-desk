/*
 * 홈(런처) 타일 정의.
 *
 * 홈 탭에 뜨는 타일은 전부 이 배열에서 나옵니다.
 * 타일 하나 = 기능 하나. 누르면 해당 탭이나 주소로 갑니다.
 *
 * ── 그룹 ────────────────────────────────────────────────
 *   id     내부 구분용
 *   title  그룹 제목
 *   tiles  아래 타일 목록
 *
 * ── 타일 한 개 ──────────────────────────────────────────
 * 두 가지 방식으로 쓸 수 있습니다.
 *
 * ① 카드에서 가져오기 — 기장·블로그·광고 탭의 기능 카드
 *      { card: "bk-monthly-close", svg: "calc", color: "emerald" }
 *    src/data/cards.js 의 같은 id 를 찾아 title·desc·tab 을 그대로 씁니다.
 *    아이콘만은 svg 로 따로 지정합니다 (카드는 이모지, 홈 타일은 그린 아이콘).
 *    카드 내용을 고치면 홈 타일도 같이 바뀌므로 두 군데 고칠 일이 없습니다.
 *
 * ② 직접 적기 — 카드가 아닌 기능 (감사도구 등)
 *      name   타일 제목
 *      desc   한 줄 설명
 *      svg    아이콘 이름 — src/app.js 의 ICONS 에 있는 키
 *             worksheet · ledger · grid · calc · docCheck
 *             pen · layers · send · shield · trend
 *      tab    이동할 탭 키 ("audit" | "tax" | "blog" | "ads")
 *      sub    (선택) 감사도구 안의 서브탭 id ("ws" | "hub")
 *      url    (선택) 탭 대신 주소로 이동. http 면 새 창, 상대경로면 같은 창
 *      color  아이콘 색 — indigo · violet · blue · emerald · teal
 *             sky · cyan · amber · orange · rose · red · pink
 *             같은 계열끼리 묶여 있어 색만 봐도 어느 영역인지 알 수 있습니다
 *      badge  (선택) 숫자 뱃지 — "tools"(도구 개수) | "ready"(발행 대기 원고 수)
 *             | "clients"(거래처 수) | "due"(이번 달 신고 건수)
 *
 *   tab · url 중 하나만 씁니다.
 */

const HOME_GROUPS = [
  {
    id: "office",
    title: "사무소",
    tiles: [
      { name: "신고 기한", svg: "calendar", color: "sky", tab: "office", badge: "due",
        desc: "거래처별로 이번 달 무엇을 신고해야 하는지" },
      { name: "거래처 관리", svg: "users", color: "cyan", tab: "office", badge: "clients",
        desc: "고객 명부 — 이 브라우저에만 저장됩니다" },
      { card: "of-doc-request", svg: "send", color: "teal" },
      { card: "of-brief", svg: "docCheck", color: "indigo" },
    ],
  },
  {
    id: "audit",
    title: "감사",
    tiles: [
      { name: "정산표 작성", svg: "worksheet", color: "indigo", tab: "audit", sub: "ws",
        desc: "전기 재무제표와 당기 시산표로 살아있는 정산표" },
      { name: "분개장 · 원장 편집", svg: "ledger", color: "violet", url: "./tool.html",
        desc: "회사별 분개장과 계정별원장을 한 화면에서" },
      { name: "도구 모음", svg: "grid", color: "blue", tab: "audit", sub: "hub", badge: "tools",
        desc: "홈택스 · DART · 등기소 등 자주 쓰는 사이트" },
    ],
  },
  {
    id: "tax",
    title: "기장 · 세무조정",
    tiles: [
      { card: "bk-monthly-close", svg: "calc", color: "emerald" },
      { card: "tax-adjustment-check", svg: "docCheck", color: "teal" },
    ],
  },
  {
    id: "blog",
    title: "블로그",
    tiles: [
      { card: "blog-draft", svg: "pen", color: "amber" },
      { card: "blog-series-outline", svg: "layers", color: "orange" },
      { name: "발행 대기 원고", svg: "send", color: "rose", tab: "blog", badge: "ready",
        desc: "변환을 마치고 네이버에 올리기를 기다리는 글" },
    ],
  },
  {
    id: "ads",
    title: "광고마케팅",
    tiles: [
      { card: "ad-compliance-check", svg: "shield", color: "red" },
      { card: "ad-keyword-effect", svg: "trend", color: "pink" },
    ],
  },
];
