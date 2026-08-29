/*
 * 감사도구 >도구 모음 탭에 뜨는 목록입니다.
 *
 * 여기만 고치면 화면에 반영됩니다. 다른 파일은 건드리지 않아도 됩니다.
 * (index.html 은 이 파일을 그냥 읽어갑니다.)
 *
 * ── 카테고리 ────────────────────────────────────────────
 *   id     내부 구분용 문자열. 겹치지 않게.
 *   title  카드 제목
 *   desc   제목 아래 한 줄 설명
 *   items  아래 도구 목록
 *
 * ── 도구 한 줄 ──────────────────────────────────────────
 *   id     즐겨찾기(★)를 기억하는 열쇠. **한 번 정하면 바꾸지 마세요.**
 *          바꾸면 그 항목의 즐겨찾기가 풀립니다.
 *   name   화면에 보이는 이름
 *   desc   (선택) 마우스를 올리면 뜨는 설명. 짧게.
 *   url    (선택) 이동할 주소.
 *            http 로 시작하면 새 창으로 엽니다.
 *            "./tool.html"처럼 상대경로면 같은 창에서 엽니다.
 *   goto   (선택) 같은 감사도구 탭 안의 서브탭으로 이동. 값은 서브탭 id.
 *            현재 쓸 수 있는 값: "ws"(정산표 작성)
 *   soon   (선택) true 면 "준비 중"으로 회색 처리되고 눌리지 않습니다.
 *   hi     (선택) true 면 그 카테고리의 대표 도구로, 테두리 상자로 강조합니다.
 *            카드마다 하나만 쓰는 것이 좋습니다.
 *
 *   url · goto · soon 중 하나만 씁니다. hi 는 함께 쓸 수 있습니다.
 *
 * ── 카드 머리 아이콘 ────────────────────────────────────
 *   카테고리 id 로 골라집니다 (src/audit/hub.js 의 ICONS).
 *   새 id 를 쓰면 기본 아이콘이 나오니, 필요하면 거기에 한 줄 추가하세요.
 *
 * ── 새 항목 추가 예시 ───────────────────────────────────
 *   { id: "nts-law", name: "국세법령정보시스템", url: "https://taxlaw.nts.go.kr" },
 *   { id: "my-tool", name: "감가상각 계산", soon: true },
 */

const TOOLS = [
  {
    id: "mine",
    title: "내 감사도구",
    desc: "파일이 브라우저 밖으로 나가지 않는 도구",
    items: [
      { id: "ws", name: "정산표 작성", goto: "ws", hi: true,
        desc: "전기 재무제표와 당기 시산표로 살아있는 정산표를 만듭니다" },
      { id: "jl", name: "분개장 · 계정별원장 편집", url: "./tool.html",
        desc: "회사별 분개장과 계정별원장을 한 화면에서 편집합니다" },
      { id: "lead", name: "리드시트 자동생성", soon: true },
      { id: "je-test", name: "전표 이상징후 추출", soon: true },
      { id: "ocr", name: "OCR 텍스트 추출", soon: true },
    ],
  },
  {
    id: "nts",
    title: "국세 · 지방세",
    desc: "신고·납부와 사업자 상태 확인",
    items: [
      { id: "hometax", name: "홈택스", url: "https://hometax.go.kr",
        desc: "신고·납부, 사업자등록 상태조회, 휴폐업 조회" },
      { id: "wetax", name: "위택스", url: "https://www.wetax.go.kr",
        desc: "지방세 신고·납부" },
      { id: "taxlaw", name: "국세법령정보시스템", url: "https://taxlaw.nts.go.kr",
        desc: "법령·예규·판례·질의회신 검색" },
      { id: "lawgo", name: "국가법령정보센터", url: "https://www.law.go.kr",
        desc: "법률·시행령·시행규칙 원문" },
      { id: "nts", name: "국세청", url: "https://www.nts.go.kr",
        desc: "고시·보도자료·세무서 안내" },
    ],
  },
  {
    id: "disclosure",
    title: "공시 · 기업정보",
    desc: "재무제표와 공시 원문 조회",
    items: [
      { id: "dart", name: "DART 전자공시", url: "https://dart.fss.or.kr",
        desc: "사업보고서·감사보고서 원문" },
      { id: "opendart", name: "DART Open API", url: "https://opendart.fss.or.kr",
        desc: "공시 데이터를 API 로 받아올 때" },
      { id: "acct-fss", name: "금감원 회계포털", url: "https://acct.fss.or.kr",
        desc: "감리·회계 관련 안내와 자료" },
      { id: "kasb", name: "한국회계기준원", url: "https://www.kasb.or.kr",
        desc: "K-IFRS · 일반기업회계기준 원문" },
      { id: "kicpa", name: "한국공인회계사회", url: "https://www.kicpa.or.kr",
        desc: "감사기준·연수·표준감사시간" },
    ],
  },
  {
    id: "registry",
    title: "등기 · 법원",
    desc: "등기부등본과 소송·사건 확인",
    items: [
      { id: "iros", name: "인터넷등기소", url: "https://www.iros.go.kr",
        desc: "법인·부동산 등기사항증명서 열람과 발급" },
      { id: "scourt", name: "대법원 대국민서비스", url: "https://www.scourt.go.kr",
        desc: "나의 사건 검색, 판결서 열람" },
      { id: "courtauction", name: "법원경매정보", url: "https://www.courtauction.go.kr",
        desc: "경매 물건 검색" },
      { id: "kftc", name: "금융결제원 어음·수표 조회", url: "https://www.kftc.or.kr",
        desc: "부도 어음·수표 확인" },
    ],
  },
  {
    id: "market",
    title: "시세 · 환율",
    desc: "평가와 환산에 쓰는 공시 시세",
    items: [
      { id: "ecos", name: "한국은행 ECOS", url: "https://ecos.bok.or.kr",
        desc: "기준환율·금리 시계열. 기말 환산에 쓰는 공식 자료" },
      { id: "smbs", name: "서울외국환중개 고시환율", url: "https://www.smbs.biz",
        desc: "매매기준율 일별 조회" },
      { id: "krx", name: "한국거래소 KRX", url: "https://www.krx.co.kr",
        desc: "상장주식 시세, 지수" },
      { id: "kisvalue", name: "금융투자협회 채권정보", url: "https://www.kofiabond.or.kr",
        desc: "채권 시가평가 기준수익률" },
    ],
  },
  {
    id: "labor",
    title: "4대보험 · 인사",
    desc: "인건비 실사와 급여 검증",
    items: [
      { id: "4insure", name: "4대사회보험 정보연계센터", url: "https://www.4insure.or.kr",
        desc: "가입자 명부, 취득·상실 이력" },
      { id: "nhis", name: "국민건강보험공단", url: "https://www.nhis.or.kr",
        desc: "건강보험 자격·부과 내역" },
      { id: "nps", name: "국민연금공단", url: "https://www.nps.or.kr",
        desc: "연금 가입 이력" },
      { id: "comwel", name: "근로복지공단", url: "https://www.comwel.or.kr",
        desc: "산재·고용보험" },
      { id: "moel", name: "고용노동부", url: "https://www.moel.go.kr",
        desc: "최저임금, 근로기준 고시" },
    ],
  },
  {
    id: "trade",
    title: "관세 · 무역",
    desc: "수출입 실적 대사",
    items: [
      { id: "unipass", name: "관세청 유니패스", url: "https://unipass.customs.go.kr",
        desc: "수입·수출 통관 진행조회, 수출이행 내역" },
      { id: "customs", name: "관세청", url: "https://www.customs.go.kr",
        desc: "관세율, 고시" },
      { id: "kita", name: "한국무역협회", url: "https://www.kita.net",
        desc: "무역통계" },
    ],
  },
  {
    id: "calc",
    title: "자동 계산",
    desc: "반복 계산을 도구로 (준비 중)",
    items: [
      { id: "materiality", name: "중요성금액 산정", soon: true },
      { id: "depreciation", name: "감가상각 스케줄", soon: true },
      { id: "pv", name: "현재가치 계산", soon: true },
      { id: "sampling", name: "표본 추출", soon: true },
    ],
  },
];
