/*
 * 기능 카드 데이터.
 *
 * 감사도구 탭을 뺀 나머지 탭(기장 및 세무조정 · 블로그 작성 · 광고마케팅)에 나타나는
 * "기능 카드"는 전부 이 배열에서 만들어집니다. 카드 하나를 추가하려면 아래 형태로
 * 객체 하나를 CARDS 배열에 더 넣으면 되고, 화면·프롬프트 미리보기·복사 버튼은
 * src/app.js가 자동으로 그려줍니다. index.html이나 app.js는 건드릴 필요 없습니다.
 *
 * 필드 설명
 *   id       고유 식별자 (영문·숫자·하이픈)
 *   tab      어느 탭에 나타날지 — "tax" | "blog" | "ads" (필요하면 새 탭 키를 만들고
 *            index.html에 <div class="card-grid" data-cards="새탭키"></div>를 추가)
 *   title    기능명
 *   desc     한 줄 설명
 *   subagent 이 프롬프트가 호출할 서브에이전트 이름 (표시용 문자열)
 *   fields   입력 필드 목록. { key, label, placeholder } 객체 배열.
 *            key는 template 안에서 {key} 형태로 참조합니다.
 *   template 완성 프롬프트 문자열. {필드key}가 입력값으로 실시간 치환되고,
 *            비어 있으면 그 필드의 placeholder 값으로 대신 채워 미리보기를 보여줍니다.
 */

const CARDS = [
  // ── 기장 및 세무조정 (placeholder 2개) ──────────────────────
  {
    id: "bk-monthly-close",
    tab: "tax",
    title: "월 마감 기장 정리",
    desc: "은행·카드 거래내역을 받아 월 마감 분개를 정리하고 확인할 항목을 뽑습니다.",
    subagent: "bookkeeping-agent",
    fields: [
      { key: "company", label: "회사명", placeholder: "마플 주식회사" },
      { key: "period", label: "기수", placeholder: "2025년 3월" },
      { key: "filePath", label: "파일 경로", placeholder: "/data/마플_3월_거래내역.xlsx" },
    ],
    template:
      "{company}의 {period} 은행·카드 거래내역({filePath})을 받아 월 마감 분개를 정리해줘. " +
      "중복·미분류 거래를 표로 정리하고, 계정과목 추천과 추가 확인이 필요한 항목을 함께 알려줘.",
  },
  {
    id: "tax-adjustment-check",
    tab: "tax",
    title: "세무조정 항목 점검",
    desc: "결산서와 세무조정계산서를 비교해 누락·오류 가능성이 있는 조정 항목을 짚어줍니다.",
    subagent: "tax-adjustment-agent",
    fields: [
      { key: "company", label: "회사명", placeholder: "마플 주식회사" },
      { key: "fiscalYear", label: "기수", placeholder: "제10기 (2025.01.01~2025.12.31)" },
      { key: "filePath", label: "파일 경로", placeholder: "/data/마플_결산서_10기.xlsx" },
    ],
    template:
      "{company} {fiscalYear} 결산서와 세무조정계산서({filePath})를 검토해서 손금불산입·익금산입 등 " +
      "세무조정 항목 중 누락되거나 근거가 약한 항목을 찾아 표로 정리해줘.",
  },

  // ── 블로그 작성 (placeholder 2개) ───────────────────────────

  // ── 광고마케팅 ──────────────────────────────────────────────
  // injectRules: true 인 카드는 광고 탭 상단 필터로 고른 규칙이
  // template 안의 {rules} 자리에 삽입된다. {rules}가 없으면 맨 뒤에 붙는다.
];
