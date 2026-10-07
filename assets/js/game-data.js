/* ═══════════════════════════════════════════════════════════════
 *  마을 대사 · 배치 설정
 *  - x      : 월드 가로 위치 (0 = 왼쪽 끝, 1 = 오른쪽 끝)
 *  - chatter: 머리 위 말풍선에 번갈아 나오는 짧은 한마디 (무엇을 알려 줄지 미리 보여 줌)
 *  - pages  : 대화 페이지. **굵게** 를 쓸 수 있습니다.
 *  - choices: 마지막 페이지의 선택지
 *             { label, href }          → 페이지 이동 (http 로 시작하면 새 탭)
 *             { label, action: 'close' } → 대화 끝내기
 *             { label, action: 'talk:아이디' } → 다른 NPC 와 대화
 *             { label, action: 'quest' }   → 퀘스트 창 열기
 *  우체부(post)의 연락 선택지는 config.js 의 github · email 값으로 자동 생성됩니다.
 *
 *  quests: 퀘스트 창(미니맵 아래 📜 · 단축키 Q)에 나오는 지금 하고 있는 일 · 해낸 일
 *  - status   : 'progress'(진행 중) 또는 'done'(완료)
 *  - date     : 'YYYY-MM-DD' (있으면 D-day 를 자동 계산), dateLabel: 날짜 이름 (예: '시험일')
 *  - desc     : 설명. **굵게** 를 쓸 수 있습니다.
 *  - steps    : (선택) [{ text, done }] 체크리스트
 *  - reward   : (선택) 보상 한 줄
 *  - link     : (선택) { label, href }
 * ═══════════════════════════════════════════════════════════════ */
window.GAME_DATA = {
  mapName: '김호성의 마을',
  npcs: [
    {
      id: 'board', kind: 'board', name: '이력 게시판', title: '게시판', x: 0.06,
      chatter: ['📌 2021 건축공학과 입학', '📌 2025 청맥 회장', '📌 캡스톤 SOC-MAP', '📌 건축기사 · 한국사 1급'],
      pages: [
        '📌 **2021** — 전남대학교 건축공학과 입학 (21학번)',
        '📌 **2025** — 축구동아리 「청맥」 회장',
        '📌 **캡스톤 디자인** — SOC-MAP, 공사 현장 위험 관제 시스템',
        '📌 **자격증** — 건축기사 · 한국사능력검정 1급 취득, 산업안전기사 · 컴퓨터활용능력 1급 필기 합격',
      ],
      choices: [
        { label: '소개 페이지에서 자세히 보기', href: 'about/#history' },
        { label: '자격증 자세히 보기', href: 'about/#certs' },
        { label: '닫기', action: 'close' },
      ],
    },
    {
      id: 'me', kind: 'npc', sprite: 'me', name: '김호성', title: '마을 주인', x: 0.2, host: true,
      chatter: ['어서 오세요! 저를 눌러 보세요', '전남대 건축공학과 21학번이에요', '공사 현장 안전에 관심이 많아요'],
      pages: [
        '안녕하세요! 저는 **김호성**이에요. 제 홈페이지에 와 주셔서 반가워요.',
        '전남대학교 **건축공학과 21학번**이에요. 공사 현장의 **안전**에 관심이 많아요.',
        '이 마을 사람들이 저를 대신 소개해 줄 거예요. 사람들을 눌러서 이야기를 들어 보세요!',
      ],
      choices: [
        { label: '자기소개 페이지 보기', href: 'about/' },
        { label: '이력 게시판 보기', action: 'talk:board' },
        { label: '요즘 하고 있는 일 (퀘스트) 보기', action: 'quest' },
        { label: '마을 둘러보기', action: 'close' },
      ],
    },
    {
      id: 'hobby', kind: 'npc', sprite: 'hobby', name: '취미 친구', title: '큐브 · 주식', x: 0.335,
      chatter: ['큐브 최고 기록 48초! 🧩', '주식은... 실현손익은 플러스! 📈', '축구 말고 다른 취미도 있어요'],
      pages: [
        '안녕하세요! 저는 김호성의 **취미 친구**예요. 축구 말고 다른 취미를 알려 드릴게요.',
        '김호성은 **큐브**를 맞출 줄 알아요. 최고 기록은 **48초**, 보통 1분 안쪽(**sub-60**)으로 맞춘대요. 🧩',
        '**주식 투자**도 해요. 지금 평가손익은 마이너스지만... **실현손익은 아직 플러스**예요! 📈',
      ],
      choices: [
        { label: '취미 · 활동 페이지 보기', href: 'activities/' },
        { label: '재밌네요!', action: 'close' },
      ],
    },
    {
      id: 'safety', kind: 'npc', sprite: 'safety', name: '현장 안전요원', title: 'SOC-MAP 현장', x: 0.47,
      chatter: ['여기는 SOC-MAP 현장이에요!', '장비 위험 반경을 m 단위로 계산해요', '위험 구역에 다가가면 휴대폰 경보!', 'AI가 도면에서 건물을 찾아요'],
      pages: [
        '어서 오세요! 여기는 김호성의 캡스톤 디자인 프로젝트, **SOC-MAP** 현장이에요.',
        '공사 현장을 **실제 GPS 위치**에 등록하고, 굴착기·크레인 같은 장비의 **위험 반경**을 m 단위로 계산해요.',
        '작업자와 장비 운전원의 휴대폰이 **1초마다** 위치를 나눠서, 위험 구역에 다가가면 본인에게, 들어가면 **관리자에게** 경보가 가요.',
        '도면에서 건물을 **AI로 인식**하고, 위험 구역을 피하는 **안전 경로**도 찾아 준답니다.',
      ],
      choices: [
        { label: '프로젝트 자세히 보기', href: 'projects/soc-map/' },
        { label: '라이브 데모 해 보기', href: 'projects/soc-map/demo/' },
        { label: '프로젝트 목록', href: 'projects/' },
        { label: '다음에 볼게요', action: 'close' },
      ],
    },
    {
      id: 'soccer', kind: 'npc', sprite: 'soccer', name: '청맥 부원', title: '축구동아리 청맥', x: 0.685,
      chatter: ['축구 좋아하세요? ⚽', '김호성의 취미는 축구예요', '2025년 청맥 회장이 김호성!'],
      pages: [
        '축구 좋아하세요? 여기는 축구동아리 **청맥**의 운동장이에요!',
        '김호성은 **축구**가 취미예요. **2025년**에는 우리 청맥의 **회장**을 맡았어요.',
      ],
      choices: [
        { label: '취미 · 활동 페이지 보기', href: 'activities/' },
        { label: '멋지네요!', action: 'close' },
      ],
    },
    {
      id: 'post', kind: 'npc', sprite: 'post', name: '우체부', title: '연락', x: 0.895, contact: true,
      chatter: ['연락하고 싶으신가요? ✉️', '김호성에게 편지를 전해 드려요', '저를 누르면 연락 방법을 알려 드려요'],
      pages: [
        '편지를 보내고 싶으신가요? 김호성에게 연락하는 방법을 알려 드릴게요.',
      ],
      choices: [],
    },
  ],

  quests: [
    // ── 진행 중 ──
    {
      id: 'toeic-speaking', status: 'progress', category: '시험', title: '토익 스피킹 시험',
      date: '2026-10-11', dateLabel: '시험일',
      desc: '영어 말하기 시험 **토익 스피킹**을 봐요. 시험일은 **10월 11일**이에요.',
      reward: '영어 말하기 자신감 +10',
    },
    {
      id: 'homepage', status: 'progress', category: '프로젝트', title: '개인 홈페이지 「김호성의 마을」',
      desc: '지금 보고 있는 이 홈페이지예요. 마을 사람, 낮 · 밤 풍경, 퀘스트 창처럼 재미있는 것을 하나씩 더하고 있어요.',
      link: { label: '소스 보기 (GitHub)', href: 'https://github.com/kimhoring/kimhoring.github.io' },
    },
    {
      id: 'soc-map', status: 'progress', category: '캡스톤 디자인', title: 'SOC-MAP 공사 현장 위험 관제 시스템',
      desc: '장비 위험 반경과 휴대폰 GPS 경보를 묶은 현장 안전 관제 시스템. 캡스톤 디자인 프로젝트를 **마무리**하고 있어요.',
      link: { label: '프로젝트 보기', href: 'projects/soc-map/' },
    },
    // ── 완료 ──
    { id: 'cert-architect', status: 'done', category: '자격증', title: '건축기사 취득', desc: '**건축기사** 자격을 땄어요.' },
    { id: 'cert-history', status: 'done', category: '자격증', title: '한국사능력검정시험 1급', desc: '**한국사능력검정시험 1급**을 땄어요.' },
    { id: 'cert-safety', status: 'done', category: '자격증', title: '산업안전기사 필기 합격', desc: '**산업안전기사** 필기시험에 합격했어요.' },
    { id: 'cert-computer', status: 'done', category: '자격증', title: '컴퓨터활용능력 1급 필기 합격', desc: '**컴퓨터활용능력 1급** 필기시험에 합격했어요.' },
    { id: 'club-captain', status: 'done', category: '동아리 · 2025', title: '축구동아리 「청맥」 회장', desc: '2025년 축구동아리 **청맥**의 회장을 맡았어요.', link: { label: '취미 · 활동 보기', href: 'activities/' } },
  ],
};
