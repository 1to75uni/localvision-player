# LocalVision Player v1.1

LocalVision CMS v1.8과 연결되는 TV Player입니다.

## 기본 테스트 URL

https://localvision-player.pages.dev/?store=goobne&apiBase=https://localvision-cms.pages.dev&debug=1

## URL 옵션

- store=goobne
- apiBase=https://localvision-cms.pages.dev
- deviceId=dv_001
- refresh=60000
- heartbeat=30000
- restart=09:30
- restartMode=reload
- fit=cover
- debug=1

## 기능

- CMS `/api/player-config?store=...` 읽기
- 좌측 70% 매장 콘텐츠 재생
- 우측 30% 공통 콘텐츠 재생
- 이미지: CMS 재생시간(초) 기준 재생
- 영상: 영상 자체 길이대로 끝까지 재생
- 1분마다 CMS 데이터 다시 동기화
- deviceId가 있으면 단말기 ONLINE 상태 전송
- CMS에서 새로고침 명령이 기록되면 Player 자동 reload
- 5번 클릭/탭하면 진단 패널 표시
