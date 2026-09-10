/**
 * Gemini BYOK 스토리 생성 모듈 (순수 클라이언트 직접호출)
 * - API 키는 localStorage에만 보관, 코드·커밋에 포함 금지
 * - 사진은 AI 전송 전 긴 변 1024px / JPEG 0.8로 축소
 */

const KEY_STORAGE = 'gemini_api_key';
const MODEL = 'gemini-3.6-flash';
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

export function getModelName(): string {
  return MODEL;
}

// === 글쓰기 스타일 지시 ===

const STYLE_STORAGE = 'gemini_style';

/** 프리셋 지시문 (빈 문자열 = 기본 문체) */
export const STYLE_PRESETS: { label: string; instruction: string }[] = [
  { label: '기본', instruction: '' },
  { label: '따뜻한 일기체', instruction: '따뜻하고 담백한 일기체로' },
  { label: '부드러운 톤', instruction: '부드럽고 다정한 톤으로' },
  { label: '아이에게 말하듯', instruction: '어린아이에게 말하듯 쉽고 다정하게' },
  { label: '유머러스하게', instruction: '유머러스하고 재치있게' },
  { label: '시적으로', instruction: '시적이고 감성적으로' },
  { label: '담백·간결하게', instruction: '담백하고 간결하게' },
];

export function getStyle(): string {
  return localStorage.getItem(STYLE_STORAGE) ?? '';
}

export function setStyle(instruction: string): void {
  localStorage.setItem(STYLE_STORAGE, instruction.trim());
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

export interface TokenUsage {
  promptTokens: number;
  responseTokens: number;
  totalTokens: number;
}

export interface StoryResult extends StoryDraft {
  /** STOP이 아니면 중간 끊김 */
  finishReason: string;
  truncated: boolean;
  usage: TokenUsage | null;
}

interface InlinePart {
  inline_data: { mime_type: string; data: string };
}

interface TextPart {
  text: string;
}

function buildPrompt(memos: string[], style?: string): string {
  const memoBlock =
    memos.length > 0
      ? memos.map((m, i) => `[메모 ${i + 1}]\n${m}`).join('\n\n')
      : '(메모 없음 — 사진 분위기 중심으로 작성)';
  const styleLine = style?.trim() ? `글쓰기 방향: ${style.trim()}\n` : '';
  return `너는 하루 기록 앱의 스토리 작가다. 아래 메모와 사진들을 보고 그날의 하루를 재구성하라.
${styleLine}요청 형식(반드시 지킬 것):
제목: <15자 이내 한 줄 제목>
본문:
<5~10문장 본문, 해시태그 금지>
<2~3문장마다 빈 줄로 단락을 나눌 것>

${memoBlock}`;
}

/**
 * 단락 정리: 빈 줄이 없는 본문을 문장 단위로 쪼개 2~3문장씩 단락으로 묶음.
 * 모델이 줄바꿈 없이 한 덩어리로 출력해도 읽기 형태로 보정.
 */
export function formatParagraphs(text: string): string {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  // 이미 단락 구분이 있으면 정리만 하고 반환
  if (paragraphs.length > 1) return paragraphs.join('\n\n');
  const single = paragraphs[0] ?? text.trim();
  if (!single) return '';
  // 종결 어미(. ! ? … 。！？ + 닫는 따옴표) 뒤에서 문장 분리
  const sentences = single
    .split(/(?<=[.!?…。！？]['"’”」]*)\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (sentences.length <= 1) return single;
  const grouped: string[] = [];
  for (let i = 0; i < sentences.length; i += 3) {
    grouped.push(sentences.slice(i, i + 3).join(' '));
  }
  return grouped.join('\n\n');
}

function parseDraft(raw: string): StoryDraft {
  const text = raw.trim();
  const titleMatch = text.match(/^제목\s*[:：]\s*(.+)$/m);
  const bodyMatch = text.match(/^본문\s*[:：]?\s*$/m);
  if (titleMatch && bodyMatch && bodyMatch.index !== undefined) {
    const title = titleMatch[1].trim();
    const content = text.slice(bodyMatch.index + bodyMatch[0].length).trim();
    if (title && content) return { title, content: formatParagraphs(content) };
  }
  // 폴백: 첫 줄을 제목, 나머지를 본문
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length >= 2) {
    return { title: lines[0].replace(/^제목\s*[:：]\s*/, '').trim(), content: formatParagraphs(lines.slice(1).join('\n').trim()) };
  }
  return { title: '오늘의 기록', content: formatParagraphs(text) };
}

interface GenerateResponse {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    finishReason?: string;
  }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  error?: { message?: string };
}

async function callGenerate(
  key: string,
  parts: (TextPart | InlinePart)[],
  maxOutputTokens: number,
  signal?: AbortSignal,
): Promise<GenerateResponse> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { temperature: 0.8, maxOutputTokens },
      }),
    },
  );

  if (!res.ok) {
    let detail = '';
    try {
      const errJson = (await res.json()) as GenerateResponse;
      if (errJson.error?.message) detail = `: ${errJson.error.message}`;
    } catch {
      // 본문 파싱 실패 시 상태코드만 사용
    }
    if (res.status === 400) {
      throw new Error(`API 키가 유효하지 않습니다. 키를 확인해주세요${detail}`);
    }
    if (res.status === 404) {
      throw new Error(`모델(${MODEL})을 찾을 수 없습니다. 모델명을 확인해주세요${detail}`);
    }
    throw new Error(`AI 생성 실패 (HTTP ${res.status})${detail}`);
  }
  return (await res.json()) as GenerateResponse;
}

function toResult(json: GenerateResponse): StoryResult {
  const candidate = json.candidates?.[0];
  const raw = (candidate?.content?.parts ?? [])
    .map((p) => p.text ?? '')
    .join('')
    .trim();
  if (!raw) throw new Error('AI 응답이 비어 있습니다. 다시 시도해주세요.');
  const finishReason = candidate?.finishReason ?? 'UNKNOWN';
  const draft = parseDraft(raw);
  const u = json.usageMetadata;
  return {
    ...draft,
    finishReason,
    truncated: finishReason !== 'STOP',
    usage: u
      ? {
          promptTokens: u.promptTokenCount ?? 0,
          responseTokens: u.candidatesTokenCount ?? 0,
          totalTokens: u.totalTokenCount ?? 0,
        }
      : null,
  };
}

/**
 * Gemini로 스토리 초안 생성 (사진 최대 5장까지 전송)
 */
export async function generateStory(
  memos: string[],
  photos: Blob[],
  signal?: AbortSignal,
  style?: string,
): Promise<StoryResult> {
  const key = getApiKey();
  if (!key) throw new Error('Gemini API 키가 없습니다. 설정에서 키를 입력해주세요.');

  const targets = photos.slice(0, MAX_AI_PHOTOS);
  const imageParts: InlinePart[] = [];
  for (const photo of targets) {
    const { base64, mimeType } = await resizeImageForAI(photo);
    imageParts.push({ inline_data: { mime_type: mimeType, data: base64 } });
  }

  const parts: (TextPart | InlinePart)[] = [
    { text: buildPrompt(memos, style) },
    ...imageParts,
  ];

  return toResult(await callGenerate(key, parts, 4096, signal));
}

/**
 * 끊긴 스토리 이어쓰기: 기존 본문 뒤에 이어지는 문장만 생성
 */
export async function continueStory(
  prevContent: string,
  signal?: AbortSignal,
  style?: string,
): Promise<StoryResult> {
  const key = getApiKey();
  if (!key) throw new Error('Gemini API 키가 없습니다. 설정에서 키를 입력해주세요.');
  const styleLine = style?.trim() ? `글쓰기 방향: ${style.trim()}\n` : '';
  const parts: TextPart[] = [
    {
      text: `아래는 하루 기록 스토리 본문의 앞부분이다. 문체와 흐름을 유지해 바로 이어지는 뒷부분만 3~7문장으로 써라. ${styleLine}제목·머리말 없이 본문 문장만 출력하고, 2~3문장마다 빈 줄로 단락을 나눠라.\n\n[앞부분]\n${prevContent}`,
    },
  ];
  const result = await toResult(await callGenerate(key, parts, 2048, signal));
  // 이어쓰기 결과는 파싱 없이 본문 그대로 사용
  return { ...result, title: '', content: formatParagraphs(result.content) };
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
