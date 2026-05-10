# 수학여행 모둠 체크인

학생 모둠장이 휴대폰으로 코스를 입력하고 출발/도착을 기록하면, 교사가 반별 탭에서 20개 모둠의 현재 위치와 지연 여부를 확인하는 웹앱입니다.

## 실행

```bash
npm install
npm run dev
```

## Firebase 설정

1. Firebase 콘솔에서 새 프로젝트를 만듭니다.
2. Firestore Database를 생성합니다.
3. 웹 앱을 추가하고 설정값을 복사합니다.
4. `.env.example`을 참고해 `.env`를 만듭니다.

```env
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```

환경값이 없으면 앱은 브라우저 localStorage에만 저장됩니다. 화면 확인용으로는 쓸 수 있지만, 여러 기기 실시간 공유는 Firebase 설정 후 동작합니다.

## Firestore 규칙

하루 행사 운영을 전제로 인증 없이 읽기/쓰기를 허용하는 예시 규칙을 `firestore.rules`에 넣었습니다. 실제 운영이 끝나면 Firestore를 비활성화하거나 규칙을 닫아두는 것을 권장합니다.

## 배포

Vercel에 연결한 뒤 위 Firebase 환경값을 Vercel Project Settings의 Environment Variables에 추가합니다. `/admin` 직접 접속을 위해 `vercel.json`에 SPA rewrite가 포함되어 있습니다.

