# FREE 100 시험 결과

CMS 40개, Player 75개 시험 통과. 실패 0개.

100대 24시간 서버 쓰기 시험: 접속 14,400행 / 상세 상태 9,600행 / 오류 4,800행. 보수적 추정 D1 쓰기 76,800행/일.
100개 영속 Player 예산 시험: 실패·재시작을 포함한 관리 대상 API 시도 최대 80,500회/일. 이 숫자는 계정 전체 Worker 호출량이 아닙니다.

추가 검증: UTC 날짜 전환, 경로별 예산 분리, 구 URL 최소 주기 보정, 통합 제어의 부분 실패와 한도 오류, 휴무 조회 실패 시 OFF 오판 방지, 좌우 독립 재생, 대기 이미지, 오프라인 캐시, 저장 저널, 파일 무결성, 서비스워커.

재현: CMS `node --test --test-concurrency=1 tests/*.test.*`, Player `node --test --test-concurrency=1 tests/*.test.cjs`. Node 24.19.0 / SQLite / 가상 DOM·시계·미디어 환경입니다. 일부 기존 재생 회귀시험은 테스트 하네스에서만 조회 주기를 단축합니다. 별도 production profile 시험은 실제 주기 보정을 그대로 검증합니다.

Cloudflare 실제 계정 사용량과 실물 100대 동시 운용은 검증하지 않았습니다. 원문은 verification/current-tests.tap입니다.
