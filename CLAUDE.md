# 나다주앱 — 작업 규칙

학원 부원장이 쓰는 개인수업 스케줄 관리 앱. 전체 설명은 `README.md` 에 있다.

## 이 레포만 본다

**나다주앱은 이 레포 하나로 완결된다.** 다른 프로젝트(`sisu`, `schedule`, `bbs` 등)의
코드·설정·디자인 규칙을 가져오지 않고, 그쪽이 바뀌어도 여기는 영향을 받지 않는다.

- 한 세션에 다른 레포가 같이 붙어 있어도 **거기 있는 파일을 읽어 와 흉내 내지 않는다**
- 디자인은 `README.md` 의 「디자인 시스템」이 기준이다. 다른 화면과 맞추려고 여기를
  고치지 않는다
- 폰트·아이콘은 `public/` 안에 있는 것만 쓴다. 외부 CDN을 부르지 않는다
- 고치다가 다른 레포를 열어 봐야 한다면 의존성이 생긴 것이다. 가져오지 말고
  필요한 만큼만 여기에 새로 적는다

## 손댈 때 꼭 지킬 것

- **규칙이 두 벌이다.** 시각·날짜 계산과 상수(선생님·수업종류·격자 범위·기본 수업
  시간)가 `src/model.ts` 와 `public/app.js` 에 복제돼 있다. **한쪽만 고치면 화면과
  저장이 어긋난다.** 둘을 같이 본다
- **Notion 스키마도 짝이다.** 선생님·수업종류를 늘리면 `src/model.ts` 의 상수와
  Notion 선택 속성의 항목 이름을 **같게** 맞춘다. 한쪽만 고치면 그 행을 조용히
  건너뛴다
- **인라인 스크립트를 되살리지 않는다.** 화면 코드는 `public/app.js` 와
  `public/png.js` 두 파일이고 (`png.js` 가 `app.js` 의 `window.__nadajoo` 를 쓰므로
  **순서가 중요하다**), 인라인으로 되돌리면 CSP 의 `script-src 'self'` 가 깨진다
- **PNG는 화면을 캡처하지 않는다.** 캔버스에 직접 그린다. 블록 모양을 바꾸면
  `public/app.js` 의 격자와 `public/png.js` 의 캔버스를 **둘 다** 고친다
- `README.md` 의 「함정들」을 먼저 읽는다. 이미 밟은 것들이 적혀 있다

## 확인하는 법

```bash
npm install
npx tsc --noEmit                 # 서버 타입
node --check public/app.js       # 화면 문법
node --check public/png.js
npx wrangler deploy --dry-run --outdir /tmp/dry   # 빌드 (배포 아님)
```

`main` 에 푸시하면 GitHub Actions 가 배포한다. 손으로 `wrangler deploy` 를 칠 일은
없다. 배포 전에 타입 검사가 막아 준다.
