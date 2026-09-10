import { v4 as uuidv4 } from 'uuid';
import { db } from './db';
import type { Entry, EntryType, DateSummary, Story } from './types';

/** 저장 1회당 사진 최대 선택 수 */
export const MAX_PHOTOS_PER_SAVE = 20;

/** 달력 썸네일 변환 상한 (성능 방어) */
const MAX_SUMMARY_THUMBNAILS = 4;

function today(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
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
    sortOrder?: number;
  },
): Promise<string> {
  const id = uuidv4();
  const timestamp = now();
  const entry: Entry = {
    id,
    date: data.date || today(),
    type,
    content: data.content || '',
    blob: data.blob || new Blob(),
    thumbnail: data.thumbnail ?? null,
    duration: data.duration || 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    sortOrder: data.sortOrder ?? timestamp,
  };
  await db.entries.add(entry);
  return id;
}

export async function getEntry(id: string): Promise<Entry | undefined> {
  return db.entries.get(id);
}

export async function getEntriesByDate(date: string): Promise<Entry[]> {
  const entries = await db.entries.where('date').equals(date).toArray();
  return entries.sort(
    (a, b) => (a.sortOrder ?? a.createdAt) - (b.sortOrder ?? b.createdAt),
  );
}

export async function updateEntry(
  id: string,
  updates: Partial<
    Pick<Entry, 'content' | 'blob' | 'thumbnail' | 'duration' | 'sortOrder'>
  >,
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
    if (thumbnails.length >= MAX_SUMMARY_THUMBNAILS) break;
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

// === Story Operations (하루 1개 upsert) ===

export async function getStoryByDate(date: string): Promise<Story | undefined> {
  const stories = await db.stories.where('date').equals(date).toArray();
  return stories.sort((a, b) => b.updatedAt - a.updatedAt)[0];
}

export async function saveStory(
  date: string,
  data: { title: string; content: string; photoIds: string[]; source: Story['source'] },
): Promise<Story> {
  const existing = await getStoryByDate(date);
  const timestamp = now();
  if (existing) {
    const updated: Story = {
      ...existing,
      title: data.title,
      content: data.content,
      photoIds: data.photoIds,
      source: data.source,
      updatedAt: timestamp,
    };
    await db.stories.put(updated);
    return updated;
  }
  const created: Story = {
    id: uuidv4(),
    date,
    title: data.title,
    content: data.content,
    photoIds: data.photoIds,
    source: data.source,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await db.stories.add(created);
  return created;
}

export async function deleteStory(id: string): Promise<void> {
  await db.stories.delete(id);
}

/**
 * 공유용 텍스트 템플릿 (Band/카페 붙여넣기)
 * 본문 속 [사진n] 마커는 '📷 사진 n' 한 줄로 치환
 */
export function buildShareText(
  date: string,
  title: string,
  content: string,
): string {
  const [y, m, d] = date.split('-');
  const dateLine = `🗓 ${y}년 ${parseInt(m)}월 ${parseInt(d)}일 하루 기록`;
  const body = content
    .trim()
    .replace(/\[사진(\d+)\]/g, '📷 사진 $1');
  return `${dateLine}\n\n『${title.trim() || '무제'}』\n\n${body}\n\n#하루기록 #오늘의기록`;
}

// === Story photo markers ([사진n]) ===

/** 본문 속 사진 마커 (1-based, photoIds 순서 기준) */
export const PHOTO_MARKER_RE = /\[사진(\d+)\]/g;

export type StoryBlock =
  | { kind: 'text'; text: string }
  | { kind: 'photo'; index: number }; // 1-based

/**
 * 본문을 텍스트/사진 블록으로 분리.
 * 텍스트는 빈 줄 기준 문단 단위로 나눔 (미리보기 드롭 갭과 일치).
 * 마커가 문장 중간에 있어도 분리됨.
 */
export function parseStoryBlocks(content: string): StoryBlock[] {
  const pushText = (blocks: StoryBlock[], chunk: string) => {
    for (const p of chunk.split(/\n\s*\n/)) {
      const text = p.trim();
      if (text) blocks.push({ kind: 'text', text });
    }
  };
  const blocks: StoryBlock[] = [];
  let last = 0;
  PHOTO_MARKER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PHOTO_MARKER_RE.exec(content)) !== null) {
    pushText(blocks, content.slice(last, m.index));
    blocks.push({ kind: 'photo', index: parseInt(m[1], 10) });
    last = m.index + m[0].length;
  }
  pushText(blocks, content.slice(last));
  return blocks;
}

/**
 * 생성 직후 본문 끝에 [사진1]…[사진n] 자동 배치.
 * 이미 마커가 있으면 중복 추가하지 않음.
 */
export function appendPhotoMarkers(content: string, count: number): string {
  if (count <= 0) return content;
  PHOTO_MARKER_RE.lastIndex = 0;
  if (PHOTO_MARKER_RE.test(content)) return content;
  const markers = Array.from(
    { length: count },
    (_, i) => `[사진${i + 1}]`,
  ).join('\n\n');
  const trimmed = content.trim();
  return trimmed ? `${trimmed}\n\n${markers}` : markers;
}