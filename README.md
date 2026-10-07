# LocalVision Player v3.0.0

기존 Player 전체 소스를 기반으로 만든 업데이트입니다. **Android APP은 수정하지 않습니다.**
CMS v3.0.0의 준비·편성 게시를 먼저 완료해야 합니다.

- 서버 정기 확인은 5분 player-sync 한 곳으로 통합.
- LEFT·RIGHT 독립 재생, 문제 파일만 제한된 재시도 후 일시 제외.
- 준비된 파일부터 재생, 원본 검증·캐시 재사용·순서 변경 재다운로드 없음.
- 인터넷·서버 장애 때 마지막 정상 편성과 정상 캐시 재생.
- 삭제 원장·최신 버전 경쟁 방지·새 SW 완전 설치 뒤 원격 교체.

## GitHub·Pages

압축을 풀어 이 폴더 안 파일 전체를 기존 Player 저장소 루트에 반영합니다.
기존 정적 Pages 설정·도메인·origin·URL·SW 범위를 유지하세요.
별도 프레임워크 빌드나 Android Studio/APK 재설치는 필요하지 않습니다.
정상 refresh·버전 업데이트는 미디어 캐시를 보존합니다. 명시적 삭제 명령은 다릅니다.
새 URL로 옮기거나 캐시를 삭제하면 오프라인 보호와 원격 교체 조건이 달라집니다.

## 확인 자료

- DEPLOY_AND_OPERATIONS_KO.md: CMS 먼저 / Player 다음 적용 순서.
- TEST_REPORT.md: 실제 구현·자동시험·아직 확인하지 못한 현장 조건.
- docs/FINAL_DESIGN.md: 원 설계안.
- verification/current-tests.tap: Player 자동시험 101개 통과 원문.
- tests/: Node 24에서 npm test로 재실행.

실제 TV·Android WebView·Cloudflare 계정 시험은 아직 하지 않았습니다.
APP 캡처 방식이나 TV 하드웨어 장애까지 웹 파일만으로 완벽히 고쳤다고 주장하지 않습니다.

