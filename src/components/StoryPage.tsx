import { useState, useEffect, useRef } from 'react';
import {
  getEntriesByDate,
  getStoryByDate,
  saveStory,
  deleteStory,
  buildShareText,
  blobToDataURL,
} from '../storage/service';
import type { Entry } from '../storage/types';
import {
  getApiKey,
  setApiKey,
  clearApiKey,
  hasApiKey,
  generateStory,
  buildLocalDraft,
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
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

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
    markDirty(draft.title, draft.content, photos.map((p) => p.id));
    setSource('local');
  };

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
      const draft = await generateStory(
        memos,
        photos.map((p) => p.blob),
        ctrl.signal,
      );
      markDirty(draft.title, draft.content, photos.map((p) => p.id));
      setSource('ai');
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      console.error('AI 생성 실패:', err);
      alert((err as Error).message || 'AI 생성에 실패했습니다.');
    } finally {
      setGenerating(false);
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
            value={content}
            onChange={(e) => markDirty(title, e.target.value, photoIds)}
            placeholder="스토리를 쓰거나 AI로 생성해보세요…"
            rows={8}
            className="w-full p-2 border border-gray-300 rounded text-sm resize-y focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
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

        {/* 공유 미리보기 */}
        {(title.trim() || content.trim()) && (
          <div className="bg-white rounded-lg border border-gray-100 p-3">
            <p className="text-xs text-gray-500 font-medium mb-2">공유 미리보기 (Band·카페 붙여넣기용)</p>
            <div className="bg-gray-50 rounded p-3 text-sm text-gray-800 whitespace-pre-wrap max-h-64 overflow-y-auto">
              {shareText}
            </div>
            {photoIds.length > 0 && (
              <div className="flex gap-1.5 mt-2 overflow-x-auto">
                {photoIds.slice(0, 5).map((id) => (
                  thumbs.get(id) ? (
                    <img key={id} src={thumbs.get(id)} alt="" className="w-14 h-14 rounded object-cover shrink-0" />
                  ) : null
                ))}
                {photoIds.length > 5 && (
                  <span className="text-xs text-gray-400 self-center">+{photoIds.length - 5}</span>
                )}
              </div>
            )}
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
    </div>
  );
}
