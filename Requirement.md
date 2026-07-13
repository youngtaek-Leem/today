# Requirement.md — 하루 기록 앱

> 마지막 갱신: 2026-07-14

## 1. 개요 및 목표

스마트폰에서 하루의 순간을 음성·사진·텍스트로 쉽게 기록하고, 달력 인터페이스로 날짜별 썸네일 요약을 확인할 수 있는 PWA 웹 앱. GitHub Pages에 배포하여 사용.

## 2. 기능 요구사항

| 번호 | 요구사항 | 우선순위 |
|------|----------|----------|
| FR1 | 음성 녹음: MediaRecorder API로 녹음, WebM/Opus 저장 | P0 |
| FR2 | 사진 촬영: 카메라 직접 촬영 + 갤러리 선택 지원 | P0 |
| FR3 | 텍스트 메모: 작성 및 수정 가능 | P0 |
| FR4 | 녹음/사진 교체 가능 (삭제 후 재등록) | P0 |
| FR5 | 날짜별 기록 관리: 등록/조회/삭제 | P0 |
| FR6 | 달력 UI: 날짜별 썸네일 미리보기 요약 | P0 |
| FR7 | 완전 오프라인 동작 (PWA) | P0 |
| FR8 | GitHub Pages 정적 배포 | P0 |
| FR9 | 메모 텍스트 수정 | P1 |
| FR10 | IndexedDB 용량 사용량 표시 | P2 |
| FR11 | 오래된 기록 정리 기능 | P2 |

## 3. 기술 스택 및 제약 조건

| 계층 | 기술 | 버전 |
|------|------|------|
| 프레임워크 | React + Vite | React 19, Vite 6 |
| 언어 | TypeScript | 5.x |
| 스타일링 | Tailwind CSS | 4.x |
| PWA | vite-plugin-pwa | 최신 |
| 클라이언트 DB | Dexie.js (IndexedDB) | 4.x |
| 녹음 | MediaRecorder API | 브라우저 내장 |
| 사진 | input[capture] + File API | 브라우저 내장 |
| 달력 | react-calendar | 최신 |
| 배포 | gh-pages | 최신 |

**제약 조건:**
- 서버 없이 순수 클라이언트 앱
- 모든 데이터는 IndexedDB에 저장 (기기 내)
- GitHub Pages 정적 호스팅만 사용
- HTTPS 환경 필수 (MediaRecorder 요구사항, GitHub Pages 기본 제공)

## 4. 모듈 분해표

| # | 모듈 | 책임 | 인터페이스 | 의존성 | 검증 방법 | 상태 |
|---|------|------|------------|--------|-----------|------|
| M1 | Storage Layer | Dexie.js 스키마 정의, Entry CRUD, 바이너리 blob 저장/조회 | Entry 타입, db 인스턴스 export | 없음 | 타입 체크 + 빌드 통과 | 완료 |
| M2 | Record Module | 녹음·사진·메모 입력 UI, MediaRecorder 제어, 파일 선택, 교체 | RecordPage 컴포넌트, useRecorder hook | M1 | 타입 체크 + 빌드 통과 | 완료 |
| M3 | Calendar Module | 달력 렌더링, 날짜별 썸네일 요약 표시 | CalendarPage 컴포넌트 | M1 | 타입 체크 + 빌드 통과 | 완료 |
| M4 | Detail Module | 특정 날짜 기록 목록, 재생/확대/수정/삭제 | DetailPage 컴포넌트 | M1 | 타입 체크 + 빌드 통과 | 완료 |
| M5 | PWA Shell | 서비스 워커, 오프라인 캐싱, 설치, GitHub Pages 배포 | vite.config.ts PWA 설정, gh-pages 스크립트 | M1~M4 | 타입 체크 + 빌드 통과 (PWA manifest/sw 생성 확인) | 완료 |

## 5. 데이터 스키마

```typescript
interface Entry {
  id: string;           // UUID
  date: string;         // YYYY-MM-DD
  type: 'memo' | 'photo' | 'audio';
  content: string;      // 메모 텍스트 (memo 타입)
  blob: Blob;           // 사진/녹음 바이너리 (photo, audio 타입)
  thumbnail: Blob;      // 사진 썸네일, 녹음은 null
  duration: number;     // 녹음 길이(초), audio 타입만
  createdAt: number;    // timestamp
  updatedAt: number;    // timestamp
}
```

## 6. 개발 순서

```
M1 (Storage) → M2 (Record) → M3 (Calendar) → M4 (Detail) → M5 (PWA + 배포)
```

## 7. 미결정·보류 사항

- iOS Safari MediaRecorder WebM 미지원 → MP4/AAC 폴백 (추후 대응)
- IndexedDB 용량 한계 → 용량 표시 및 정리 기능 (P2, MVP 이후)

## 8. 변경 이력

| 날짜 | 변경 내용 | 사유 |
|------|-----------|------|
| 2026-07-14 | 최초 작성 | 프로젝트 시작, 계획 승인 |