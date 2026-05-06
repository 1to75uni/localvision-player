# LocalVision Player v1.6.2 Heartbeat + Notice Polish

## 확정 운영 도메인
- Player: https://localvision-player.pages.dev
- CMS/API: https://localvision-cms.pages.dev

## 변경점
- heartbeat 기본값을 60초에서 300초로 변경했습니다.
- commandPoll 기본값을 10초에서 300초로 변경했습니다.
- noticePollMs 기본값을 60초로 변경했습니다.
- 같은 공지는 `notice.id + updatedAt/revision` 기준으로 1회만 표시합니다.
- 공지 표시 시작 즉시 localStorage에 seen 처리하여, 이미지/영상 전환 또는 다음 공지 폴링 때 반복 표시되지 않게 했습니다.
- screenshot 명령은 기존처럼 Android TV APP Native 캡처 루틴에서 처리하도록 Web Player에서는 소모하지 않습니다.
