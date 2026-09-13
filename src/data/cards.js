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
 *            index.html에 <div class="card-grid" data-cards="새탭키"></div> 를 추가)
 *   icon     카드 왼쪽에 붙는 이모지 한 글자
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
    icon: "🧮",
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
    icon: "🧾",
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
  {
    id: "blog-draft",
    tab: "blog",
    icon: "✍️",
    title: "블로그 초안 작성",
    desc: "주제와 핵심 키워드를 주면 SEO 구조에 맞춰 블로그 글 초안을 작성합니다.",
    subagent: "blog-agent",
    fields: [
      { key: "topic", label: "주제", placeholder: "1인 사업자 부가세 신고 방법" },
      { key: "keyword", label: "핵심 키워드", placeholder: "부가세 신고, 홈택스" },
      { key: "tone", label: "톤앤매너", placeholder: "친근하고 쉬운 설명체" },
    ],
    template:
      "'{topic}'을 주제로 블로그 글 초안을 써줘. 핵심 키워드는 '{keyword}'이고, " +
      "톤앤매너는 '{tone}'으로 써줘. 소제목 구조와 메타 설명(요약)도 같이 만들어줘.",
  },
  {
    id: "blog-series-outline",
    tab: "blog",
    icon: "🗂️",
    title: "블로그 시리즈 목차 기획",
    desc: "주제 하나로 시리즈 발행용 목차와 각 편의 핵심 메시지를 잡아줍니다.",
    subagent: "blog-agent",
    fields: [
      { key: "topic", label: "시리즈 주제", placeholder: "스타트업 초기 세무 가이드" },
      { key: "count", label: "편수", placeholder: "5편" },
      { key: "audience", label: "타깃 독자", placeholder: "예비 창업자" },
    ],
    template:
      "'{topic}' 주제로 {count}짜리 블로그 시리즈 목차를 기획해줘. 타깃 독자는 '{audience}'이고, " +
      "편마다 제목과 핵심 메시지를 2~3줄로 정리해줘.",
  },

  // ── 광고마케팅 ──────────────────────────────────────────────
  // injectRules: true 인 카드는 광고 탭 상단 필터로 고른 규칙이
  // template 안의 {rules} 자리에 삽입된다. {rules}가 없으면 맨 뒤에 붙는다.
  {
    id: "ad-campaign-plan",
    tab: "ads",
    icon: "📊",
    title: "캠페인 기획",
    desc: "목표와 예산을 주면 타깃·메시지·채널믹스를 잡아줍니다. 위에서 고른 규칙을 지켜서 기획합니다.",
    subagent: "ad-agent",
    injectRules: true,
    fields: [
      { key: "goal", label: "캠페인 목표", placeholder: "신규 상담 문의 30건" },
      { key: "budget", label: "예산", placeholder: "월 300만원" },
      { key: "period", label: "기간", placeholder: "2026년 4분기" },
    ],
    template:
      "목표가 '{goal}'이고 예산은 '{budget}', 기간은 '{period}'인 광고 캠페인 기획안을 만들어줘. " +
      "타깃 오디언스, 핵심 메시지, 채널 믹스, 대략적 일정을 포함해줘.\n\n" +
      "{rules}\n\n" +
      "위 규칙에 어긋나는 제안은 하지 말고, 규칙과 충돌하는 지점이 있으면 먼저 알려줘.",
  },
  {
    id: "ad-performance-review",
    tab: "ads",
    icon: "📈",
    title: "성과 분석",
    desc: "집행 결과를 주면 무엇이 문제인지 진단하고 다음 조치를 제안합니다.",
    subagent: "ad-agent",
    injectRules: true,
    fields: [
      { key: "channel", label: "채널", placeholder: "구글 검색광고" },
      { key: "period", label: "분석 기간", placeholder: "2026년 10월" },
      { key: "metrics", label: "주요 지표", placeholder: "노출 12만, 클릭 900, 문의 8건, 비용 280만원" },
    ],
    template:
      "'{channel}'의 '{period}' 광고 성과를 분석해줘. 지표는 다음과 같아: {metrics}.\n" +
      "어느 단계(노출·클릭·랜딩·문의)에서 이탈이 큰지 짚고, 원인 가설과 다음 조치를 우선순위로 제안해줘.\n\n" +
      "{rules}\n\n" +
      "진단과 제안은 위 규칙에 비추어 판단해줘.",
  },
  {
    id: "ad-compliance-check",
    tab: "ads",
    icon: "🔍",
    title: "소재 점검",
    desc: "작성한 광고 소재가 규칙에 어긋나지 않는지 문구 단위로 점검합니다.",
    subagent: "ad-agent",
    injectRules: true,
    fields: [
      { key: "channel", label: "채널", placeholder: "네이버 검색광고" },
      { key: "copy", label: "점검할 소재", placeholder: "병의원 세무 1위, 100% 절세 보장" },
    ],
    template:
      "'{channel}'에 집행할 아래 광고 소재를 점검해줘.\n\n소재: {copy}\n\n" +
      "{rules}\n\n" +
      "규칙을 어긴 문구를 그대로 인용하고, 어떤 규칙에 걸리는지와 대체 문구를 함께 제시해줘. " +
      "판단이 애매한 문구는 임의로 결론내지 말고 확인이 필요하다고 표시해줘.",
  },
];
