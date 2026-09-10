import { useState, useEffect } from 'react';
import {
  getEntriesByDate,
  addEntry,
  updateEntry,
  deleteEntry,
  blobToDataURL,
  createThumbnail,
  MAX_PHOTOS_PER_SAVE,
} from '../storage/service';
import type { Entry } from '../storage/types';

interface DetailPageProps {
  date: string;
  onBack: () => void;
}

export default function DetailPage({ date, onBack }: DetailPageProps) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [expandedPhoto, setExpandedPhoto] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadEntries();
  }, [date]);

  const loadEntries = async () => {
    setLoading(true);
    const data = await getEntriesByDate(date);
    setEntries(data);
    setLoading(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('이 기록을 삭제하시겠습니까?')) return;
    await deleteEntry(id);
    setEntries((prev) => prev.filter((e) => e.id !== id));
  };

  const handleReplacePhoto = async (id: string) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const thumbnail = await createThumbnail(file);
        await updateEntry(id, { blob: file, thumbnail });
        await loadEntries();
      } catch (err) {
        console.error('사진 교체 실패:', err);
        alert('사진 교체에 실패했습니다.');
      }
    };
    input.click();
  };

  const handleAddPhotos = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.onchange = async () => {
      const files = Array.from(input.files ?? []).filter((f) =>
        f.type.startsWith('image/'),
      );
      if (files.length === 0) return;
      const accepted = files.slice(0, MAX_PHOTOS_PER_SAVE);
      if (files.length > MAX_PHOTOS_PER_SAVE) {
        alert(
          `한 번에 최대 ${MAX_PHOTOS_PER_SAVE}장까지 추가할 수 있어 ${accepted.length}장만 추가됩니다.`,
        );
      }
      const baseOrder =
        entries.reduce(
          (max, e) => Math.max(max, e.sortOrder ?? e.createdAt),
          0,
        ) || Date.now();
      let failed = 0;
      for (let i = 0; i < accepted.length; i++) {
        try {
          const thumbnail = await createThumbnail(accepted[i]);
          await addEntry('photo', {
            blob: accepted[i],
            thumbnail,
            date,
            sortOrder: baseOrder + i + 1,
          });
        } catch (err) {
          console.error('사진 추가 실패:', err);
          failed++;
        }
      }
      await loadEntries();
      if (failed > 0) alert(`${failed}장의 사진 추가에 실패했습니다.`);
    };
    input.click();
  };

  const handleMovePhoto = async (id: string, direction: -1 | 1) => {
    const photos = entries.filter((e) => e.type === 'photo');
    const index = photos.findIndex((e) => e.id === id);
    const target = photos[index + direction];
    if (index < 0 || !target) return;
    const current = photos[index];
    const currentOrder = current.sortOrder ?? current.createdAt;
    const targetOrder = target.sortOrder ?? target.createdAt;
    await updateEntry(current.id, { sortOrder: targetOrder });
    await updateEntry(target.id, { sortOrder: currentOrder });
    await loadEntries();
  };

  const handleReplaceAudio = async (id: string) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      const recorder = new MediaRecorder(stream, { mimeType });
      const chunks: Blob[] = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = async () => {
        const blob = new Blob(chunks, { type: mimeType });
        const duration = Math.floor(
          (Date.now() - startTime) / 1000,
        );
        await updateEntry(id, { blob, duration });
        stream.getTracks().forEach((t) => t.stop());
        await loadEntries();
      };

      const startTime = Date.now();
      recorder.start(1000);

      // 1초 후 자동 중지 (간단 교체용)
      setTimeout(() => {
        if (recorder.state !== 'inactive') recorder.stop();
      }, 1000);

      alert('교체용 녹음이 시작되었습니다. 잠시만 기다려주세요...');
    } catch (err) {
      console.error('녹음 교체 실패:', err);
      alert('마이크 접근 권한이 필요합니다.');
    }
  };

  const startEdit = (entry: Entry) => {
    setEditingId(entry.id);
    setEditText(entry.content);
  };

  const saveEdit = async () => {
    if (!editingId) return;
    await updateEntry(editingId, { content: editText.trim() });
    setEditingId(null);
    setEditText('');
    await loadEntries();
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditText('');
  };

  const formatDate = (dateStr: string) => {
    const [y, m, d] = dateStr.split('-');
    return `${y}년 ${parseInt(m)}월 ${parseInt(d)}일`;
  };

  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString('ko-KR', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* 헤더 */}
      <div className="flex items-center p-4 bg-white border-b border-gray-200">
        <button
          onClick={onBack}
          className="mr-3 text-blue-600 text-lg font-medium"
        >
          ← 달력
        </button>
        <h2 className="text-lg font-bold text-gray-800">{formatDate(date)}</h2>
        <button
          onClick={handleAddPhotos}
          className="ml-auto text-sm text-blue-600 font-medium"
        >
          📷 사진 추가
        </button>
      </div>

      {/* 기록 목록 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {loading && (
          <div className="text-center text-gray-400 py-8">불러오는 중...</div>
        )}

        {!loading && entries.length === 0 && (
          <div className="text-center text-gray-400 py-8">
            이 날의 기록이 없습니다.
          </div>
        )}

        {entries.map((entry) => (
          <div
            key={entry.id}
            className="bg-white rounded-lg p-4 shadow-sm border border-gray-100"
          >
            {/* 타입 아이콘 + 시간 */}
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-500">
                {entry.type === 'memo' && '📝 메모'}
                {entry.type === 'photo' && '📷 사진'}
                {entry.type === 'audio' && '🎙️ 녹음'}
                {entry.type === 'audio' &&
                  ` (${formatDuration(entry.duration)})`}
              </span>
              <span className="text-xs text-gray-400">
                {formatTime(entry.createdAt)}
              </span>
            </div>

            {/* 메모 내용 */}
            {entry.type === 'memo' && (
              <>
                {editingId === entry.id ? (
                  <div className="space-y-2">
                    <textarea
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      className="w-full p-2 border border-gray-300 rounded text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                      rows={3}
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={saveEdit}
                        className="px-3 py-1 bg-blue-500 text-white text-sm rounded"
                      >
                        저장
                      </button>
                      <button
                        onClick={cancelEdit}
                        className="px-3 py-1 bg-gray-200 text-gray-700 text-sm rounded"
                      >
                        취소
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-gray-800 text-sm whitespace-pre-wrap">
                    {entry.content}
                  </p>
                )}
              </>
            )}

            {/* 사진 */}
            {entry.type === 'photo' && (
              <div className="space-y-2">
                <PhotoDisplay
                  blob={entry.blob}
                  expanded={expandedPhoto === entry.id}
                  onExpand={() =>
                    setExpandedPhoto(
                      expandedPhoto === entry.id ? null : entry.id,
                    )
                  }
                />
              </div>
            )}

            {/* 녹음 */}
            {entry.type === 'audio' && (
              <div className="space-y-2">
                <AudioPlayer blob={entry.blob} />
              </div>
            )}

            {/* 액션 버튼 */}
            <div className="flex gap-2 mt-3 pt-3 border-t border-gray-100">
              {entry.type === 'memo' && editingId !== entry.id && (
                <button
                  onClick={() => startEdit(entry)}
                  className="text-xs text-blue-500 font-medium"
                >
                  ✏️ 수정
                </button>
              )}
              {entry.type === 'photo' && (
                <>
                  <button
                    onClick={() => handleMovePhoto(entry.id, -1)}
                    className="text-xs text-blue-500 font-medium"
                  >
                    ◀ 앞으로
                  </button>
                  <button
                    onClick={() => handleMovePhoto(entry.id, 1)}
                    className="text-xs text-blue-500 font-medium"
                  >
                    뒤로 ▶
                  </button>
                  <button
                    onClick={() => handleReplacePhoto(entry.id)}
                    className="text-xs text-blue-500 font-medium"
                  >
                    🔄 사진 교체
                  </button>
                </>
              )}
              {entry.type === 'audio' && (
                <button
                  onClick={() => handleReplaceAudio(entry.id)}
                  className="text-xs text-blue-500 font-medium"
                >
                  🔄 녹음 교체
                </button>
              )}
              <button
                onClick={() => handleDelete(entry.id)}
                className="text-xs text-red-500 font-medium ml-auto"
              >
                🗑 삭제
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// 사진 표시 컴포넌트 (lazy load blob → dataURL)
function PhotoDisplay({
  blob,
  expanded,
  onExpand,
}: {
  blob: Blob;
  expanded: boolean;
  onExpand: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    blobToDataURL(blob).then(setUrl);
  }, [blob]);

  if (!url) return <div className="h-32 bg-gray-100 rounded animate-pulse" />;

  return (
    <div>
      <img
        src={url}
        alt="기록 사진"
        onClick={onExpand}
        className={`rounded object-cover cursor-pointer transition-all ${
          expanded ? 'w-full max-h-96' : 'w-full h-48'
        }`}
      />
      <button
        onClick={onExpand}
        className="mt-1 text-xs text-blue-500"
      >
        {expanded ? '축소' : '확대'}
      </button>
    </div>
  );
}

// 오디오 플레이어 컴포넌트
function AudioPlayer({ blob }: { blob: Blob }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);

  if (!url) return null;

  return <audio src={url} controls className="w-full" />;
}