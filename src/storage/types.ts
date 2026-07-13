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
}

export type EntryType = Entry['type'];

export interface DateSummary {
  date: string;
  memoCount: number;
  photoCount: number;
  audioCount: number;
  thumbnails: string[]; // base64 data URLs for preview
}