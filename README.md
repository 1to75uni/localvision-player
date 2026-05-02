# LocalVision Android TV App v3.0 DeviceId Fix

Android TV 14 / Google TV에서 접근성 토글이 꺼지는 문제를 줄이기 위해 접근성 서비스 구조를 단순화한 안정화 버전입니다.

## v2.2 수정 사항

- 접근성 서비스 설정을 XML 고정 방식으로 단순화
- 코드에서 serviceInfo를 다시 세팅하던 부분 제거
- 접근성 토글이 켜졌다가 꺼지는 문제 완화
- 홈/런처로 나가면 8초 뒤 LocalVision 자동 복귀
- 설정/권한 화면에서는 자동 복귀하지 않도록 예외 처리
- 앱 정보 열기 버튼 추가
- WebView 로딩 실패 시 LocalVision 오류 안내 화면 표시
- MainActivity launchMode singleTask 적용
- BootReceiver directBootAware 추가

## 설치 시 가장 중요한 점

Android TV 14 / Google TV에서는 파일관리자나 브라우저로 APK를 설치하면 접근성 기능이 제한될 수 있습니다.

권장 설치 방식:

무선 ADB 설치

```powershell
cd "$env:LOCALAPPDATA\Android\Sdk\platform-tools"
.\adb connect TV_IP:PORT
.\adb install -r "C:\localvision-app\app\build\outputs\apk\debug\app-debug.apk"
```

이미 파일관리자로 설치했다면 먼저 삭제 후 ADB로 다시 설치하세요.

```powershell
.\adb uninstall com.localvision.tvapp
.\adb install -r "C:\localvision-app\app\build\outputs\apk\debug\app-debug.apk"
```

## TV 설치 후 해야 할 것

1. 앱 실행
2. OK 버튼 5번 또는 MENU 버튼으로 설정 화면 열기
3. 접근성 설정 열기
4. LocalVision 접근성 ON
5. 전원 최적화 끄기
6. 홈 버튼을 눌러 8초 뒤 자동 복귀되는지 테스트

## 접근성이 계속 안 켜질 때

1. 앱을 TV에서 삭제
2. 무선 ADB로 APK 설치
3. TV 재부팅
4. 접근성 설정에서 LocalVision ON
5. 그래도 안 되면 앱 정보 열기 → 제한된 설정 허용 확인


## v2.4 수정 사항

- MainActivity.java에서 누락된 showLocalErrorPage(String) 함수 추가
- WebView 로딩 실패 시 오류 안내 화면 표시
- compileDebugJavaWithJavac cannot find symbol 오류 수정


## v2.5 수정 사항

- MainActivity 크래시 수정
- requestWindowFeature()를 onCreate 시작 시 1회만 호출하도록 변경
- onResume에서 setupWindow()가 다시 호출되어도 requestFeature 크래시가 나지 않도록 수정
- SettingsActivity도 동일한 방식으로 정리
- ADB 테스트 편의를 위해 SettingsActivity direct start 허용


## v2.6 추가 기능

- CMS 명령 polling 추가
- refresh 명령 수신 시 WebView reload
- screenshot 명령 수신 시 WebView 실제 화면 캡처
- 캡처 PNG를 `/api/screenshots`로 업로드
- 명령 처리 후 `refresh_done`, `screenshot_done`, `screenshot_failed` 상태 기록

## CMS v2.0 필요

스크린샷 기능은 CMS v2.0의 `/api/screenshots`가 있어야 동작합니다.


## v2.7 추가

- Player v1.3 안정화 옵션 기본 적용
- refresh=600000
- heartbeat=30000
- prefetchAhead=1
- videoMode=stream
- fit=cover
- 기존 접근성 자동복귀/스크린샷 명령 기능 유지


## v2.8 추가

- Player v1.4 오프라인 번들 캐시 옵션 기본 적용
- refresh=3600000
- bundleMode=cache
- cacheAll=1
- videoMode=cache
- activateWhenCached=1
- cacheMax 기본 60
- 기존 접근성 자동복귀/스크린샷 명령 기능 유지


## v2.9 추가

- Player URL에 `cacheVia=api` 기본 포함
- R2 직접 fetch 대신 CMS `/api/media` 경유 캐시 다운로드
- 기존 접근성 자동복귀/스크린샷 명령 기능 유지


## v3.0 수정

- Android ContextWrapper의 `getDeviceId()`와 충돌하던 함수명 수정
- `getDeviceId()` → `getLvDeviceId()`
- `attempting to assign weaker access privileges; was public` 빌드 오류 해결
- 기존 Player v1.4.2 / cacheVia=api / 접근성 자동복귀 / 스크린샷 명령 기능 유지


## v1.4.3 수정

- 왼쪽 하단 상태 표시 탭(`#statusPill`)이 상태 메시지를 표시한 뒤 5초 후 자동으로 사라지도록 수정
- 새 상태 메시지나 오류 메시지가 뜨면 다시 나타났다가 5초 뒤 숨김
- 디버그 패널은 기존처럼 5번 탭으로 열고 닫을 수 있도록 유지
- `sw.js` 앱 캐시 이름을 `lv-player-app-v1.4.3`으로 변경해 TV에서 새 파일을 확실히 받도록 처리
