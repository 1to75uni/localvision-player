# LocalVision Player v1.2 Cache Stable

LocalVision CMS v1.8과 연결되는 안정화 Player입니다.

## 핵심 재생 로직

부팅
↓
CMS API 호출
↓
playlist 가져오기
↓
현재 콘텐츠 재생
↓
다음 콘텐츠 prefetch
↓
10분마다 CMS API 재확인
↓
playlist가 바뀌었으면 새 파일 prefetch
↓
새 파일 준비 완료 후 재생목록 교체
↓
오래된 캐시 정리

## 기본 테스트 URL

https://localvision-player.pages.dev/?store=goobne&apiBase=https://localvision-cms.pages.dev&debug=1

## TV 운영 URL 예시

https://localvision-player.pages.dev/?store=goobne&deviceId=dv_001&apiBase=https://localvision-cms.pages.dev&restart=09:30&restartMode=reload&cacheMax=20

## URL 옵션

- store=goobne
- apiBase=https://localvision-cms.pages.dev
- deviceId=dv_001
- refresh=600000
- heartbeat=30000
- cacheMax=20
- prefetchAhead=2
- restart=09:30
- restartMode=reload
- restartJitterSec=0
- fit=cover 또는 contain
- debug=1

## v1.2 기능

- CMS API 10분마다 재확인
- 이미지/영상 CacheStorage 저장
- 현재 콘텐츠 우선 재생
- 다음 콘텐츠 1~2개 prefetch
- playlist 변경 시 새 파일 준비 후 교체
- 오래된 캐시 정리
- 네트워크 오류 시 기존 재생목록 유지
- Service Worker로 앱 기본 파일 캐시
- 영상은 영상 길이대로 재생
- 이미지는 CMS 재생시간 기준 재생
- CMS 새로고침 명령 수신 시 reload
