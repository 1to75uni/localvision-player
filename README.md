# LocalVision Player v1.6 · store 기준 하트비트

이 Player는 LocalVision CMS v1.6 / APP v8.2와 함께 사용하는 웹 플레이어입니다.

## 핵심 변경사항

1. deviceId 없이 동작
   - URL에는 `store`와 `apiBase`만 있으면 됩니다.
   - `deviceId`가 없어도 하트비트, 원격 새로고침, 공지, 오류 보고가 동작합니다.

2. 하트비트
   - 기본값: `heartbeat=180000` = 3분
   - 전송 내용: `store`, `online`, `lastSeen`, `app`
   - CMS는 마지막 접속 10분 이내를 ONLINE으로 표시합니다.

3. 원격 명령
   - CMS의 단말기 명령을 `deviceId`가 아니라 `store`로도 찾습니다.
   - 동일 매장 URL 1개 = TV 1대 운영 구조에 맞췄습니다.

4. 버전
   - Player: `v1.6`
   - 캐시명: `lv-player-app-v1-6`, `lv-media-bundle-v1-6`

## 예시 URL

```txt
https://localvision-player.pages.dev/?store=palpal&apiBase=https%3A%2F%2Flocalvision-cms.pages.dev&heartbeat=180000&refresh=3600000&restart=09%3A30&restartMode=reload&restartJitterSec=0&cacheMax=20&noticePollMs=15000&bundleMode=cache&cacheAll=1&videoMode=cache&cacheVia=api&activateWhenCached=1&fit=cover
```
