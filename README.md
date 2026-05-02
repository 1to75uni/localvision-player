# LocalVision Player v1.4.2 Real API Media Cache

네트워크가 불안정한 매장용 안정화 Player입니다.

## 핵심 로직

부팅
↓
이전에 저장된 playlist가 있으면 즉시 캐시 재생
↓
CMS API 호출
↓
left/right playlist 가져오기
↓
이미지/영상 전체 다운로드
↓
전체 다운로드 성공 시에만 새 playlist로 교체
↓
1시간마다 CMS API 재확인
↓
새 playlist 감지 시 다시 전체 다운로드 후 교체

## 기본 운영 URL

https://localvision-player.pages.dev/?store=goobne&deviceId=dv_001&apiBase=https://localvision-cms.pages.dev&refresh=3600000&bundleMode=cache&cacheAll=1&videoMode=cache&cacheMax=60&activateWhenCached=1&restart=09:30&restartMode=reload

## 옵션

- refresh=3600000 : 1시간마다 CMS 재생목록 확인
- bundleMode=cache : 이미지/영상 전체 캐시 후 재생
- cacheAll=1 : 현재 playlist의 모든 미디어 다운로드
- videoMode=cache : 영상도 캐시 Blob URL로 재생
- cacheMax=60 : 캐시 보관 개수
- activateWhenCached=1 : 새 묶음 전체 다운로드 성공 후 교체
- heartbeat=30000 : 30초마다 단말기 온라인 갱신


## v1.4.1 수정

- R2 public URL 직접 fetch 대신 CMS `/api/media?key=...`를 통해 다운로드
- R2 CORS 문제로 `Failed to fetch`가 나는 현상 완화
- `cacheVia=api` 기본값 추가
- `loading.jpg` 포함


## v1.4.2 실제 수정

- `index.html` 표시 버전을 v1.4.2로 변경
- `app.js`에 `cacheVia=api` 실제 로직 반영
- R2 public URL을 `CMS /api/media?key=stores/...`로 변환해서 다운로드
- 캐시 키도 R2 URL이 아니라 `/api/media` URL 기준으로 저장
- `sw.js` 캐시 이름을 v1.4.2로 변경해 기존 v1.4 캐시를 밀어냄
