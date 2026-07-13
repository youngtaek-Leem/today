import { v4 as uuidv4 } from 'uuid';
import { db } from './db';
import type { Entry, EntryType, DateSummary } from './types';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function now(): number {
  return Date.now();
}

/**
 * 썸네일 생성: 이미지 Blob을 최대 200x200으로 리사이즈한 JPEG Blob 반환
 */
export async function createThumbnail(blob: Blob): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const maxSize = 200;
      let { width, height } = img;
      if (width > maxSize || height > maxSize) {
        const ratio = Math.min(maxSize / width, maxSize / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (b) => {
          if (b) resolve(b);
          else reject(new Error('썸네일 생성 실패'));
        },
        'image/jpeg',
        0.7,
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('이미지 로드 실패'));
    };
    img.src = url;
  });
}

/**
 * Blob을 base64 data URL로 변환
 */
export function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Blob 읽기 실패'));
    reader.readAsDataURL(blob);
  });
}

// === CRUD Operations ===

export async function addEntry(
  type: EntryType,
  data: {
    content?: string;
    blob?: Blob;
    thumbnail?: Blob | null;
    duration?: number;
    date?: string;
  },
): Promise<string> {
  const id = uuidv4();
  const entry: Entry = {
    id,
    date: data.date || today(),
    type,
    content: data.content || '',
    blob: data.blob || new Blob(),
    thumbnail: data.thumbnail ?? null,
    duration: data.duration || 0,
    createdAt: now(),
    updatedAt: now(),
  };
  await db.entries.add(entry);
  return id;
}

export async function getEntry(id: string): Promise<Entry | undefined> {
  return db.entries.get(id);
}

export async function getEntriesByDate(date: string): Promise<Entry[]> {
  return db.entries.where('date').equals(date).toArray();
}

export async function updateEntry(
  id: string,
  updates: Partial<Pick<Entry, 'content' | 'blob' | 'thumbnail' | 'duration'>>,
): Promise<void> {
  await db.entries.update(id, {
    ...updates,
    updatedAt: now(),
  });
}

export async function deleteEntry(id: string): Promise<void> {
  await db.entries.delete(id);
}

export async function getAllDates(): Promise<string[]> {
  const entries = await db.entries.orderBy('date').keys();
  return [...new Set(entries)] as string[];
}

export async function getDateSummary(date: string): Promise<DateSummary> {
  const entries = await getEntriesByDate(date);
  const memoCount = entries.filter((e) => e.type === 'memo').length;
  const photoCount = entries.filter((e) => e.type === 'photo').length;
  const audioCount = entries.filter((e) => e.type === 'audio').length;

  const thumbnails: string[] = [];
  for (const entry of entries) {
    if (entry.type === 'photo' && entry.thumbnail) {
      thumbnails.push(await blobToDataURL(entry.thumbnail));
    } else if (entry.type === 'memo' && thumbnails.length < 3) {
      // 메모는 텍스트 미리보기 없음, 아이콘으로 대체
    }
  }

  return { date, memoCount, photoCount, audioCount, thumbnails };
}

/**
 * 모든 날짜의 요약 정보를 한 번에 가져옴 (달력 표시용)
 */
export async function getAllDateSummaries(): Promise<DateSummary[]> {
  const dates = await getAllDates();
  const summaries: DateSummary[] = [];
  for (const date of dates) {
    summaries.push(await getDateSummary(date));
  }
  return summaries;
}

/**
 * IndexedDB 사용량 추정 (bytes)
 */
export async function getStorageUsage(): Promise<number> {
  if ('storage' in navigator && 'estimate' in navigator.storage) {
    const estimate = await navigator.storage.estimate();
    return estimate.usage ?? 0;
  }
  return 0;
}