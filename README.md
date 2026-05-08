# LocalVision Player v1.7.0 OFFLINE FIRST

## 운영 기본값
- heartbeat: `300000`
- commandPoll: `300000`
- noticePollMs: `60000`
- 기본 콘텐츠 재생시간: `20초`

## 핵심 변경
- `id=lv001` / `appId=lv001` 파라미터를 인식합니다.
- `apiBase`가 있을 경우 `/api/app-config?id=lv001`을 5분마다 확인합니다.
- CMS의 app-config Player URL이 바뀌면 Player가 자동으로 새 URL로 이동합니다.
- 콘텐츠 재생 오류 1회는 해당 콘텐츠 스킵, 2회 누적은 Player 전체 새로고침을 수행합니다.
- 자동 새로고침 루프 방지를 위해 5분 쿨다운과 1시간 3회 제한을 적용했습니다.
- 기존 캐시명과 SW 캐시명을 v1.7.0으로 올려 구버전 캐시 충돌을 줄였습니다.
