/**
 * Gemini BYOK 스토리 생성 모듈 (순수 클라이언트 직접호출)
 * - API 키는 localStorage에만 보관, 코드·커밋에 포함 금지
 * - 사진은 AI 전송 전 긴 변 1024px / JPEG 0.8로 축소
 */

const KEY_STORAGE = 'gemini_api_key';
const MODEL = 'gemini-3.1-flash-lite';
const MAX_AI_PHOTOS = 5;

export function getApiKey(): string {
  return localStorage.getItem(KEY_STORAGE) ?? '';
}

export function setApiKey(key: string): void {
  localStorage.setItem(KEY_STORAGE, key.trim());
}

export function clearApiKey(): void {
  localStorage.removeItem(KEY_STORAGE);
}

export function hasApiKey(): boolean {
  return getApiKey().length > 0;
}

/**
 * AI 전송용 이미지 축소 (긴 변 기준)
 */
export async function resizeImageForAI(
  blob: Blob,
  maxDim = 1024,
): Promise<{ base64: string; mimeType: string }> {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('이미지 로드 실패'));
      el.src = url;
    });
    let { width, height } = img;
    if (width > maxDim || height > maxDim) {
      const ratio = Math.min(maxDim / width, maxDim / height);
      width = Math.round(width * ratio);
      height = Math.round(height * ratio);
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('캔버스 생성 실패');
    ctx.drawImage(img, 0, 0, width, height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
    const base64 = dataUrl.split(',')[1];
    if (!base64) throw new Error('이미지 변환 실패');
    return { base64, mimeType: 'image/jpeg' };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export interface StoryDraft {
  title: string;
  content: string;
}

interface InlinePart {
  inline_data: { mime_type: string; data: string };
}

interface TextPart {
  text: string;
}

function buildPrompt(memos: string[]): string {
  const memoBlock =
    memos.length > 0
      ? memos.map((m, i) => `[메모 ${i + 1}]\n${m}`).join('\n\n')
      : '(메모 없음 — 사진 분위기 중심으로 작성)';
  return `너는 하루 기록 앱의 스토리 작가다. 아래 메모와 사진들을 보고 그날의 하루를 따뜻하고 담백한 일기체로 재구성하라.
요청 형식(반드시 지킬 것):
제목: <15자 이내 한 줄 제목>
본문:
<5~10문장 본문, 해시태그 금지>

${memoBlock}`;
}

function parseDraft(raw: string): StoryDraft {
  const text = raw.trim();
  const titleMatch = text.match(/^제목\s*[:：]\s*(.+)$/m);
  const bodyMatch = text.match(/^본문\s*[:：]?\s*$/m);
  if (titleMatch && bodyMatch && bodyMatch.index !== undefined) {
    const title = titleMatch[1].trim();
    const content = text.slice(bodyMatch.index + bodyMatch[0].length).trim();
    if (title && content) return { title, content };
  }
  // 폴백: 첫 줄을 제목, 나머지를 본문
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length >= 2) {
    return { title: lines[0].replace(/^제목\s*[:：]\s*/, '').trim(), content: lines.slice(1).join('\n').trim() };
  }
  return { title: '오늘의 기록', content: text };
}

/**
 * Gemini로 스토리 초안 생성 (사진 최대 5장까지 전송)
 */
export async function generateStory(
  memos: string[],
  photos: Blob[],
  signal?: AbortSignal,
): Promise<StoryDraft> {
  const key = getApiKey();
  if (!key) throw new Error('Gemini API 키가 없습니다. 설정에서 키를 입력해주세요.');

  const targets = photos.slice(0, MAX_AI_PHOTOS);
  const imageParts: InlinePart[] = [];
  for (const photo of targets) {
    const { base64, mimeType } = await resizeImageForAI(photo);
    imageParts.push({ inline_data: { mime_type: mimeType, data: base64 } });
  }

  const parts: (TextPart | InlinePart)[] = [
    { text: buildPrompt(memos) },
    ...imageParts,
  ];

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { temperature: 0.8, maxOutputTokens: 1024 },
      }),
    },
  );

  if (!res.ok) {
    if (res.status === 400) {
      throw new Error('API 키가 유효하지 않습니다. 키를 확인해주세요.');
    }
    throw new Error(`AI 생성 실패 (HTTP ${res.status})`);
  }

  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const raw = json.candidates?.[0]?.content?.parts
    ?.map((p) => p.text ?? '')
    .join('')
    .trim();
  if (!raw) throw new Error('AI 응답이 비어 있습니다. 다시 시도해주세요.');
  return parseDraft(raw);
}

/**
 * 오프라인·무키 폴백: 메모 이어붙이기식 로컬 초안
 */
export function buildLocalDraft(memos: string[], photoCount: number): StoryDraft {
  const content =
    memos.length > 0
      ? memos.join('\n\n')
      : photoCount > 0
        ? `오늘 남긴 사진 ${photoCount}장으로 하루를 돌아보세요. 인상 깊었던 순간을 아래에 이어 적어보세요.`
        : '오늘의 기록을 아래에 적어보세요.';
  return { title: '오늘의 기록', content };
}
