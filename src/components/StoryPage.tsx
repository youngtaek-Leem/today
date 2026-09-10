import { useState, useEffect, useRef } from 'react';
import {
  getEntriesByDate,
  getStoryByDate,
  saveStory,
  deleteStory,
  buildShareText,
  blobToDataURL,
  appendPhotoMarkers,
  parseStoryBlocks,
  insertMarkerAtGap,
  moveMarkerToGap,
} from '../storage/service';
import type { Entry } from '../storage/types';
import {
  getApiKey,
  setApiKey,
  clearApiKey,
  hasApiKey,
  getModelName,
  generateStory,
  continueStory,
  buildLocalDraft,
  formatParagraphs,
  STYLE_PRESETS,
  getStyle,
  setStyle as persistStyle,
} from '../ai/gemini';

function toLocalDateString(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-');
  return `${y}년 ${parseInt(m)}월 ${parseInt(d)}일`;
}

export default function StoryPage({ initialDate }: { initialDate: string }) {
  const [date, setDate] = useState(initialDate);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [photoIds, setPhotoIds] = useState<string[]>([]);
  const [source, setSource] = useState<'local' | 'ai'>('local');
  const [storyId, setStoryId] = useState<string | null>(null);
  const [thumbs, setThumbs] = useState<Map<string, string>>(new Map());
  const [keyInput, setKeyInput] = useState('');
  const [keySaved, setKeySaved] = useState(hasApiKey());
  const [showKeyBox, setShowKeyBox] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const [genInfo, setGenInfo] = useState<{
    finishReason: string;
    truncated: boolean;
    usage: string;
    style: string;
  } | null>(null);
  const [style, setStyle] = useState(getStyle());
  // 직접 입력 초안 (저장 버튼을 눌러야 실제 지시문으로 반영)
  const [styleDraft, setStyleDraft] = useState(() =>
    STYLE_PRESETS.some((p) => p.instruction === getStyle()) ? '' : getStyle(),
  );
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const cursorRef = useRef<number | null>(null);
  // 드래그 진행 상태 (ref: 로직용, state: 고스트·강조 렌더용)
  const dragRef = useRef<{
    photoNumber: number;
    occurrence: number | null; // null = 칩트레이(신규 삽입), 숫자 = 미리보기 마커 이동
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  const [dragView, setDragView] = useState<{
    x: number;
    y: number;
    thumb: string | null;
    overGap: number | null;
    overEditor: boolean;
  } | null>(null);

  const todayStr = toLocalDateString(new Date());
  const photos = entries.filter((e) => e.type === 'photo');
  const memos = entries.filter((e) => e.type === 'memo').map((e) => e.content);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const data = await getEntriesByDate(date);
      if (cancelled) return;
      setEntries(data);
      const story = await getStoryByDate(date);
      if (cancelled) return;
      if (story) {
        setStoryId(story.id);
        setTitle(story.title);
        setContent(story.content);
        setSource(story.source);
        setPhotoIds(story.photoIds.filter((id) => data.some((e) => e.id === id)));
      } else {
        setStoryId(null);
        setTitle('');
        setContent('');
        setSource('local');
        setPhotoIds(data.filter((e) => e.type === 'photo').map((e) => e.id));
      }
      setDirty(false);
      setGenInfo(null);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [date]);

  // 사진 썸네일 준비
  useEffect(() => {
    let cancelled = false;
    const loadThumbs = async () => {
      const map = new Map<string, string>();
      for (const p of photos) {
        const src = p.thumbnail ?? p.blob;
        try {
          map.set(p.id, await blobToDataURL(src));
        } catch {
          // 개별 실패는 무시
        }
      }
      if (!cancelled) setThumbs(map);
    };
    if (photos.length > 0) loadThumbs();
    else setThumbs(new Map());
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries]);

  const markDirty = (t: string, c: string, ids: string[]) => {
    setTitle(t);
    setContent(c);
    setPhotoIds(ids);
    setDirty(true);
  };

  const handleLocalDraft = () => {
    const draft = buildLocalDraft(memos, photos.length);
    const ids = photos.map((p) => p.id);
    markDirty(draft.title, appendPhotoMarkers(draft.content, ids.length), ids);
    setSource('local');
    setGenInfo(null);
  };

  const updateStyle = (v: string) => {
    setStyle(v);
    persistStyle(v);
    if (!STYLE_PRESETS.some((p) => p.instruction === v)) {
      setStyleDraft(v);
    } else {
      setStyleDraft('');
    }
  };

  const handleSaveStyle = () => {
    if (!styleDraft.trim()) {
      alert('저장할 지시문을 입력해주세요.');
      return;
    }
    updateStyle(styleDraft.trim());
  };

  const handleClearStyle = () => {
    updateStyle('');
  };

  const toUsageText = (u: { promptTokens: number; responseTokens: number; totalTokens: number } | null) =>
    u ? `입력 ${u.promptTokens} · 출력 ${u.responseTokens} · 합계 ${u.totalTokens} 토큰` : '토큰 정보 없음';

  const handleGenerate = async () => {
    if (!hasApiKey()) {
      setShowKeyBox(true);
      alert('먼저 Gemini API 키를 입력해주세요.');
      return;
    }
    if (memos.length === 0 && photos.length === 0) {
      alert('이 날짜에 메모나 사진이 없습니다.');
      return;
    }
    setGenerating(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const result = await generateStory(
        memos,
        photos.map((p) => p.blob),
        ctrl.signal,
        style || undefined,
      );
      const ids = photos.map((p) => p.id);
      markDirty(result.title, appendPhotoMarkers(result.content, ids.length), ids);
      setSource('ai');
      setGenInfo({
        finishReason: result.finishReason,
        truncated: result.truncated,
        usage: toUsageText(result.usage),
        style: style || '기본',
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      console.error('AI 생성 실패:', err);
      alert((err as Error).message || 'AI 생성에 실패했습니다.');
    } finally {
      setGenerating(false);
      abortRef.current = null;
    }
  };

  const handleContinue = async () => {
    if (!content.trim()) {
      alert('이어쓸 본문이 없습니다.');
      return;
    }
    setContinuing(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const result = await continueStory(content, ctrl.signal, style || undefined);
      markDirty(title, `${content.trim()}\n${result.content}`, photoIds);
      setGenInfo({
        finishReason: result.finishReason,
        truncated: result.truncated,
        usage: toUsageText(result.usage),
        style: style || '기본',
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      console.error('이어쓰기 실패:', err);
      alert((err as Error).message || '이어쓰기에 실패했습니다.');
    } finally {
      setContinuing(false);
      abortRef.current = null;
    }
  };

  const handleSave = async () => {
    if (!content.trim()) {
      alert('스토리 내용을 입력해주세요.');
      return;
    }
    setSaving(true);
    try {
      const saved = await saveStory(date, {
        title: title.trim() || '무제',
        content: content.trim(),
        photoIds,
        source,
      });
      setStoryId(saved.id);
      setDirty(false);
    } catch (err) {
      console.error('스토리 저장 실패:', err);
      alert('스토리를 저장하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!storyId) return;
    if (!confirm('이 스토리를 삭제하시겠습니까? (원본 기록은 유지됩니다)')) return;
    await deleteStory(storyId);
    setStoryId(null);
    setTitle('');
    setContent('');
    setPhotoIds(photos.map((p) => p.id));
    setDirty(false);
  };

  const togglePhoto = (id: string) => {
    const next = photoIds.includes(id)
      ? photoIds.filter((x) => x !== id)
      : [...photoIds, id];
    markDirty(title, content, next);
  };

  const movePhoto = (id: string, dir: -1 | 1) => {
    const idx = photoIds.indexOf(id);
    const j = idx + dir;
    if (idx < 0 || j < 0 || j >= photoIds.length) return;
    const next = [...photoIds];
    [next[idx], next[j]] = [next[j], next[idx]];
    markDirty(title, content, next);
  };

  // --- 사진 칩 드래그&드롭 ([사진n] 배치) ---

  const trackCursor = () => {
    const el = textAreaRef.current;
    if (el) cursorRef.current = el.selectionStart ?? content.length;
  };

  const insertMarkerAtCursor = (photoNumber: number) => {
    const marker = `[사진${photoNumber}]`;
    const pos = Math.max(
      0,
      Math.min(cursorRef.current ?? content.length, content.length),
    );
    const before = content.slice(0, pos).trimEnd();
    const after = content.slice(pos).trimStart();
    const chunks = [before, marker, after].filter((c) => c.length > 0);
    markDirty(title, chunks.join('\n\n'), photoIds);
    const newPos = (before ? before.length + 2 : 0) + marker.length;
    requestAnimationFrame(() => {
      const el = textAreaRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(newPos, newPos);
        cursorRef.current = newPos;
      }
    });
  };

  const thumbForNumber = (n: number): string | null => {
    const id = photoIds[n - 1];
    return (id && thumbs.get(id)) || null;
  };

  const dropTargetAt = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y);
    const gapEl = el?.closest?.('[data-gap]');
    const editorEl = el?.closest?.('[data-editor]');
    return {
      gap: gapEl ? parseInt(gapEl.getAttribute('data-gap') || '-1', 10) : null,
      editor: !!editorEl,
    };
  };

  const [dragArmed, setDragArmed] = useState(false);
  const beginChipDrag = (
    e: React.PointerEvent,
    photoNumber: number,
    occurrence: number | null,
  ) => {
    if (e.button !== undefined && e.button !== 0) return;
    dragRef.current = {
      photoNumber,
      occurrence,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
    };
    setDragArmed(true);
  };

  useEffect(() => {
    if (!dragArmed) return;
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (!d.moved) {
        if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 10) return;
        d.moved = true;
      }
      const t = dropTargetAt(e.clientX, e.clientY);
      setDragView({
        x: e.clientX,
        y: e.clientY,
        thumb: thumbForNumber(d.photoNumber),
        overGap: t.gap !== null && t.gap >= 0 ? t.gap : null,
        overEditor: t.editor,
      });
    };
    const onUp = (e: PointerEvent) => {
      const d = dragRef.current;
      dragRef.current = null;
      setDragView(null);
      setDragArmed(false);
      if (!d) return;
      if (!d.moved) {
        // 탭: 칩트레이 칩만 커서에 삽입 (미리보기 마커 탭은 무시)
        if (d.occurrence === null) insertMarkerAtCursor(d.photoNumber);
        return;
      }
      const t = dropTargetAt(e.clientX, e.clientY);
      if (t.gap !== null && t.gap >= 0) {
        const next =
          d.occurrence === null
            ? insertMarkerAtGap(content, d.photoNumber, t.gap)
            : moveMarkerToGap(content, d.occurrence, t.gap);
        markDirty(title, next, photoIds);
      } else if (t.editor) {
        trackCursor();
        insertMarkerAtCursor(d.photoNumber);
      }
      // 그 외 영역 드롭 = 취소
    };
    const onCancel = () => {
      dragRef.current = null;
      setDragView(null);
      setDragArmed(false);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragArmed, content, title, photoIds]);

  const handleSaveKey = () => {
    if (!keyInput.trim()) {
      alert('API 키를 입력해주세요.');
      return;
    }
    setApiKey(keyInput);
    setKeyInput('');
    setKeySaved(true);
    setShowKeyBox(false);
  };

  const handleClearKey = () => {
    clearApiKey();
    setKeySaved(false);
    setKeyInput('');
  };

  const shareText = buildShareText(date, title, content);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareText);
      alert('공유 텍스트가 복사되었습니다. Band·카페에 붙여넣으세요.');
    } catch {
      alert('복사에 실패했습니다. 미리보기를 길게 눌러 직접 복사해주세요.');
    }
  };

  const handleSystemShare = async () => {
    const selected = photoIds
      .map((id) => entries.find((e) => e.id === id))
      .filter((e): e is Entry => !!e && e.type === 'photo');
    const files = selected.map(
      (e, i) =>
        new File([e.blob], `photo-${i + 1}.jpg`, {
          type: e.blob.type || 'image/jpeg',
        }),
    );
    const base = { title: title || '하루 기록', text: shareText };
    try {
      if (files.length > 0 && navigator.canShare?.({ ...base, files })) {
        await navigator.share({ ...base, files });
      } else if (navigator.canShare?.(base) || 'share' in navigator) {
        await navigator.share(base);
        if (files.length > 0) {
          alert('이 기기에서는 사진 첨부 공유가 안 되어 텍스트만 공유했습니다. 사진은 상세 화면에서 저장 후 올려주세요.');
        }
      } else {
        alert('이 브라우저는 시스템 공유를 지원하지 않습니다. 텍스트 복사를 이용해주세요.');
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        console.error('공유 실패:', err);
        alert('공유에 실패했습니다. 텍스트 복사를 이용해주세요.');
      }
    }
  };

  const handleDownloadText = () => {
    const blob = new Blob([shareText], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `story-${date}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* 헤더 */}
      <div className="flex items-center gap-2 p-4 bg-white border-b border-gray-200">
        <h2 className="text-lg font-bold text-gray-800">📖 스토리</h2>
        <input
          type="date"
          value={date}
          max={todayStr}
          onChange={(e) => e.target.value && setDate(e.target.value)}
          className="ml-auto text-sm border border-gray-300 rounded px-2 py-1"
        />
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <p className="text-xs text-gray-500">{formatDate(date)} · 메모 {memos.length} · 사진 {photos.length}</p>

        {/* 글쓰기 지시 */}
        <div className="bg-white rounded-lg border border-gray-100 p-3">
          <p className="text-xs text-gray-500 font-medium mb-2">✍️ 글쓰기 방향 (AI 생성·이어쓰기에 적용)</p>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {STYLE_PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => updateStyle(p.instruction)}
                className={`px-2.5 py-1.5 rounded-full text-xs font-medium ${
                  style === p.instruction
                    ? 'bg-violet-600 text-white'
                    : 'bg-gray-100 text-gray-600 active:bg-gray-200'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <input
            value={styleDraft}
            onChange={(e) => setStyleDraft(e.target.value)}
            placeholder="직접 지시하기 (예: 어린아이에게 말하듯 작성해줘)"
            className="w-full p-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
          />
          <div className="flex gap-2 mt-2">
            <button
              onClick={handleSaveStyle}
              className="flex-1 py-1.5 bg-violet-600 text-white text-sm rounded active:bg-violet-700"
            >
              지시문 저장
            </button>
            {style && (
              <button
                onClick={handleClearStyle}
                className="flex-1 py-1.5 bg-gray-200 text-gray-700 text-sm rounded active:bg-gray-300"
              >
                지시문 삭제
              </button>
            )}
          </div>
          {style ? (
            <p className="text-[11px] text-violet-700 mt-1.5">사용 중: {style}</p>
          ) : (
            <p className="text-[11px] text-gray-400 mt-1.5">사용 중: 기본 문체</p>
          )}
        </div>

        {/* 생성 버튼 */}
        <div className="flex gap-2">
          <button
            onClick={handleLocalDraft}
            className="flex-1 py-2.5 bg-gray-200 text-gray-700 rounded-lg text-sm font-medium active:bg-gray-300"
          >
            📝 기본 초안
          </button>
          <button
            onClick={generating ? () => abortRef.current?.abort() : handleGenerate}
            disabled={saving}
            className={`flex-1 py-2.5 rounded-lg text-sm font-bold text-white ${
              generating ? 'bg-red-500' : 'bg-violet-600 active:bg-violet-700'
            }`}
          >
            {generating ? '⏹ 생성 취소' : '✨ AI로 생성'}
          </button>
        </div>
        {generating && (
          <p className="text-xs text-violet-600 animate-pulse text-center">AI가 하루를 엮고 있습니다…</p>
        )}
        {genInfo && (
          <div className={`rounded-lg border p-3 text-xs ${genInfo.truncated ? 'bg-amber-50 border-amber-300' : 'bg-gray-50 border-gray-200'}`}>
            {genInfo.truncated ? (
              <div className="space-y-2">
                <p className="text-amber-700 font-bold">
                  ⚠️ 생성이 중간에 끊겼습니다 (사유: {genInfo.finishReason})
                </p>
                <p className="text-gray-500">모델 {getModelName()} · 문체 {genInfo.style} · {genInfo.usage}</p>
                <button
                  onClick={continuing ? () => abortRef.current?.abort() : handleContinue}
                  disabled={generating}
                  className={`w-full py-2 rounded-lg text-sm font-bold text-white ${continuing ? 'bg-red-500' : 'bg-amber-600 active:bg-amber-700'}`}
                >
                  {continuing ? '⏹ 이어쓰기 취소' : '✍️ 끊긴 곳부터 이어쓰기'}
                </button>
              </div>
            ) : (
              <p className="text-gray-500">
                ✅ 생성 완료 (STOP) · 모델 {getModelName()} · 문체 {genInfo.style} · {genInfo.usage}
              </p>
            )}
          </div>
        )}

        {/* API 키 설정 */}
        <div className="bg-white rounded-lg border border-gray-100 p-3">
          <button
            onClick={() => {
              setShowKeyBox((v) => !v);
              setKeyInput(getApiKey());
            }}
            className="text-xs text-gray-500 font-medium"
          >
            {keySaved ? '🔑 API 키 등록됨 (변경)' : '🔑 Gemini API 키 등록'} {showKeyBox ? '▲' : '▼'}
          </button>
          {showKeyBox && (
            <div className="mt-2 space-y-2">
              <input
                type="password"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                placeholder="AIza… (본인 키만 입력)"
                className="w-full p-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleSaveKey}
                  className="flex-1 py-1.5 bg-violet-600 text-white text-sm rounded"
                >
                  저장
                </button>
                {keySaved && (
                  <button
                    onClick={handleClearKey}
                    className="flex-1 py-1.5 bg-gray-200 text-gray-700 text-sm rounded"
                  >
                    삭제
                  </button>
                )}
              </div>
              <p className="text-[11px] text-gray-400">키는 이 기기 브라우저에만 저장되며 서버로 전송되지 않습니다.</p>
              <a
                href="ai-test.html"
                className="block text-[11px] text-violet-600 underline"
              >
                🔧 연결 테스트 페이지 열기 (실패 원인 진단용)
              </a>
            </div>
          )}
        </div>

        {/* 편집 */}
        <div className="bg-white rounded-lg border border-gray-100 p-3 space-y-2">
          <input
            value={title}
            onChange={(e) => markDirty(e.target.value, content, photoIds)}
            placeholder="제목"
            className="w-full p-2 border border-gray-300 rounded text-base font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <textarea
            ref={textAreaRef}
            data-editor="story"
            value={content}
            onChange={(e) => markDirty(title, e.target.value, photoIds)}
            onSelect={trackCursor}
            onClick={trackCursor}
            onKeyUp={trackCursor}
            placeholder="스토리를 쓰거나 AI로 생성해보세요…"
            rows={8}
            className={`w-full p-2 border rounded text-sm resize-y focus:outline-none focus:ring-2 ${
              dragView?.overEditor
                ? 'border-blue-500 ring-2 ring-blue-300'
                : 'border-gray-300 focus:ring-blue-500'
            }`}
          />
          {photoIds.length > 0 && (
            <div>
              <p className="text-[11px] text-gray-500 mb-1.5">
                📷 사진 칩을 끌어다 본문·미리보기에 놓으세요 (탭 = 커서 위치에 삽입)
              </p>
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                {photoIds.map((id, i) => (
                  <div
                    key={id}
                    role="button"
                    aria-label={`${i + 1}번 사진 칩`}
                    onPointerDown={(e) => beginChipDrag(e, i + 1, null)}
                    className="relative shrink-0 rounded overflow-hidden cursor-grab active:cursor-grabbing select-none"
                    style={{ touchAction: 'none' }}
                  >
                    {thumbs.get(id) ? (
                      <img src={thumbs.get(id)} alt="" draggable={false} className="w-14 h-14 object-cover" />
                    ) : (
                      <div className="w-14 h-14 bg-gray-100 animate-pulse" />
                    )}
                    <span className="absolute bottom-0.5 left-0.5 min-w-5 h-5 px-1 bg-blue-600 text-white text-[11px] rounded-full flex items-center justify-center font-bold">
                      {i + 1}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => markDirty(title, formatParagraphs(content), photoIds)}
              className="px-3 py-1.5 bg-gray-100 text-gray-600 text-xs rounded active:bg-gray-200"
            >
              📝 단락 정리
            </button>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className={`flex-1 py-2.5 rounded-lg font-bold text-white text-sm ${saving ? 'bg-gray-400' : 'bg-blue-600 active:bg-blue-700'}`}
            >
              {saving ? '저장 중…' : storyId ? (dirty ? '● 수정사항 저장' : '✓ 저장됨') : '스토리 저장'}
            </button>
            {storyId && (
              <button
                onClick={handleDelete}
                className="px-4 py-2.5 text-sm text-red-500 font-medium"
              >
                삭제
              </button>
            )}
          </div>
        </div>

        {/* 사진 선택·순서 */}
        {photos.length > 0 && (
          <div className="bg-white rounded-lg border border-gray-100 p-3">
            <p className="text-xs text-gray-500 font-medium mb-2">
              공유 사진 선택·순서 ({photoIds.length}/{photos.length}) — 탭하여 선택/해제
            </p>
            <div className="grid grid-cols-4 gap-2">
              {photos.map((p) => {
                const order = photoIds.indexOf(p.id);
                const selected = order >= 0;
                return (
                  <button
                    key={p.id}
                    onClick={() => togglePhoto(p.id)}
                    className={`relative rounded overflow-hidden ${selected ? 'ring-2 ring-blue-500' : 'opacity-50'}`}
                  >
                    {thumbs.get(p.id) ? (
                      <img src={thumbs.get(p.id)} alt="" className="w-full h-16 object-cover" />
                    ) : (
                      <div className="w-full h-16 bg-gray-100 animate-pulse" />
                    )}
                    {selected && (
                      <span className="absolute top-0.5 left-0.5 w-5 h-5 bg-blue-600 text-white text-[11px] rounded-full flex items-center justify-center font-bold">
                        {order + 1}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            {photoIds.length > 1 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {photoIds.map((id, i) => (
                  <span key={id} className="inline-flex items-center gap-1 text-xs bg-gray-100 rounded-full pl-2.5 pr-1 py-1">
                    {i + 1}번
                    <button onClick={() => movePhoto(id, -1)} aria-label="앞으로" className="px-1 text-blue-600">◀</button>
                    <button onClick={() => movePhoto(id, 1)} aria-label="뒤로" className="px-1 text-blue-600">▶</button>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 공유 미리보기 (문단 사이 드롭으로 마커 배치) */}
        {(title.trim() || content.trim()) && (
          <div className="bg-white rounded-lg border border-gray-100 p-3">
            <p className="text-xs text-gray-500 font-medium mb-2">공유 미리보기 (Band·카페 붙여넣기용)</p>
            <div className="bg-gray-50 rounded p-3 max-h-80 overflow-y-auto">
              <p className="text-xs text-gray-500">{formatDate(date)}</p>
              <p className="text-base font-bold text-gray-800 mb-2">『{title.trim() || '무제'}』</p>
              <StoryBlocks
                content={content}
                photoIds={photoIds}
                thumbs={thumbs}
                dragGap={dragView?.overGap ?? null}
                onMarkerDown={beginChipDrag}
              />
              <p className="text-xs text-gray-400 mt-2">#하루기록 #오늘의기록</p>
            </div>
            <div className="flex gap-2 mt-3">
              <button
                onClick={handleCopy}
                className="flex-1 py-2.5 bg-gray-200 text-gray-700 rounded-lg text-sm font-medium active:bg-gray-300"
              >
                📋 텍스트 복사
              </button>
              <button
                onClick={handleSystemShare}
                className="flex-1 py-2.5 bg-green-600 text-white rounded-lg text-sm font-bold active:bg-green-700"
              >
                📤 공유하기
              </button>
              <button
                onClick={handleDownloadText}
                aria-label="텍스트 파일 저장"
                className="px-3 py-2.5 bg-gray-200 text-gray-700 rounded-lg text-sm active:bg-gray-300"
              >
                ⬇️
              </button>
            </div>
          </div>
        )}
      </div>
      {/* 드래그 고스트 */}
      {dragView && (
        <div
          className="fixed z-50 pointer-events-none opacity-80 rounded overflow-hidden shadow-lg ring-2 ring-blue-500"
          style={{
            left: dragView.x - 28,
            top: dragView.y - 28,
            touchAction: 'none',
          }}
        >
          {dragView.thumb ? (
            <img src={dragView.thumb} alt="" draggable={false} className="w-14 h-14 object-cover" />
          ) : (
            <div className="w-14 h-14 bg-blue-100 flex items-center justify-center text-2xl">📷</div>
          )}
        </div>
      )}
    </div>
  );
}

// 미리보기 블록 렌더: 텍스트 문단 + 사진 마커 칩 + 문단 사이 드롭 갭
function StoryBlocks({
  content,
  photoIds,
  thumbs,
  dragGap,
  onMarkerDown,
}: {
  content: string;
  photoIds: string[];
  thumbs: Map<string, string>;
  dragGap: number | null;
  onMarkerDown: (e: React.PointerEvent, photoNumber: number, occurrence: number | null) => void;
}) {
  const blocks = parseStoryBlocks(content);
  let occurrence = -1;
  const gapClass = (i: number) =>
    `rounded transition-all ${dragGap === i ? 'h-6 bg-blue-200' : dragGap !== null ? 'h-3 bg-blue-50' : 'h-1'}`;
  return (
    <div className="text-sm text-gray-800">
      {blocks.length === 0 && (
        <p className="text-gray-400">본문이 비어 있습니다.</p>
      )}
      <div data-gap={0} className={gapClass(0)} />
      {blocks.map((b, i) => {
        if (b.kind === 'text') {
          return (
            <div key={i}>
              <p className="whitespace-pre-wrap">{b.text}</p>
              <div data-gap={i + 1} className={gapClass(i + 1)} />
            </div>
          );
        }
        occurrence += 1;
        const occ = occurrence;
        const entryId = photoIds[b.index - 1];
        const thumb = entryId ? thumbs.get(entryId) : undefined;
        return (
          <div key={i}>
            {!thumb ? (
              <div className="rounded bg-amber-50 border border-amber-300 text-amber-700 text-xs p-2">
                ⚠️ [사진{b.index}] — 선택된 사진이 없습니다
              </div>
            ) : (
              <div
                role="button"
                aria-label={`${b.index}번 사진 마커 (드래그하여 이동)`}
                onPointerDown={(e) => onMarkerDown(e, b.index, occ)}
                className="relative rounded overflow-hidden cursor-grab active:cursor-grabbing select-none"
                style={{ touchAction: 'none' }}
              >
                <img src={thumb} alt={`${b.index}번 사진`} draggable={false} className="w-full max-h-56 object-cover" />
                <span className="absolute top-1 left-1 px-1.5 h-5 bg-blue-600 text-white text-[11px] rounded-full flex items-center font-bold">
                  사진 {b.index} ⠿
                </span>
              </div>
            )}
            <div data-gap={i + 1} className={gapClass(i + 1)} />
          </div>
        );
      })}
    </div>
  );
}
