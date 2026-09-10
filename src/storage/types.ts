export interface Entry {
  id: string;
  date: string; // YYYY-MM-DD
  type: 'memo' | 'photo' | 'audio';
  content: string; // 메모 텍스트
  blob: Blob; // 사진/녹음 바이너리
  thumbnail: Blob | null; // 사진 썸네일, 녹음은 null
  duration: number; // 녹음 길이(초), audio만
  createdAt: number; // timestamp
  updatedAt: number; // timestamp
  sortOrder?: number; // 사진 순서 (없으면 createdAt 대체)
}

export type EntryType = Entry['type'];

export interface Story {
  id: string;
  date: string; // YYYY-MM-DD (하루 1개)
  title: string;
  content: string; // 스토리 본문 (마크다운 아닌 일반 텍스트)
  photoIds: string[]; // 사용 사진 Entry id (순서 = 공유 순서)
  source: 'local' | 'ai'; // 초안 생성 방식
  createdAt: number; // timestamp
  updatedAt: number; // timestamp
}

export interface DateSummary {
  date: string;
  memoCount: number;
  photoCount: number;
  audioCount: number;
  thumbnails: string[]; // base64 data URLs for preview
}