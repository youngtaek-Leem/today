import { useState, useRef, useEffect } from 'react';
import { useRecorder } from '../hooks/useRecorder';
import {
  addEntry,
  createThumbnail,
  MAX_PHOTOS_PER_SAVE,
} from '../storage/service';

type InputMode = 'memo' | 'photo' | 'audio';

export default function RecordPage() {
  const [mode, setMode] = useState<InputMode>('memo');
  const [memoText, setMemoText] = useState('');
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recorder = useRecorder();

  // 미리보기 object URL 정리 (메모리 누수 방지)
  useEffect(() => {
    return () => {
      for (const url of photoPreviews) URL.revokeObjectURL(url);
    };
  }, [photoPreviews]);

  const clearPhotoSelection = () => {
    for (const url of photoPreviews) URL.revokeObjectURL(url);
    setPhotoFiles([]);
    setPhotoPreviews([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removePhotoAt = (index: number) => {
    URL.revokeObjectURL(photoPreviews[index]);
    setPhotoFiles((prev) => prev.filter((_, i) => i !== index));
    setPhotoPreviews((prev) => prev.filter((_, i) => i !== index));
  };

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).filter((f) =>
      f.type.startsWith('image/'),
    );
    if (files.length === 0) return;
    const remaining = MAX_PHOTOS_PER_SAVE - photoFiles.length;
    if (remaining <= 0) {
      alert(`한 번에 최대 ${MAX_PHOTOS_PER_SAVE}장까지 저장할 수 있습니다.`);
      e.target.value = '';
      return;
    }
    const accepted = files.slice(0, remaining);
    if (files.length > remaining) {
      alert(
        `한 번에 최대 ${MAX_PHOTOS_PER_SAVE}장까지 저장할 수 있어 ${accepted.length}장만 추가됩니다.`,
      );
    }
    setPhotoFiles((prev) => [...prev, ...accepted]);
    setPhotoPreviews((prev) => [
      ...prev,
      ...accepted.map((f) => URL.createObjectURL(f)),
    ]);
    e.target.value = '';
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (mode === 'memo') {
        if (!memoText.trim()) {
          alert('메모 내용을 입력해주세요.');
          setSaving(false);
          return;
        }
        await addEntry('memo', { content: memoText.trim() });
        setMemoText('');
      } else if (mode === 'photo') {
        if (photoFiles.length === 0) {
          alert('사진을 선택해주세요.');
          setSaving(false);
          return;
        }
        let failed = 0;
        const baseOrder = Date.now();
        for (let i = 0; i < photoFiles.length; i++) {
          try {
            const thumbnail = await createThumbnail(photoFiles[i]);
            await addEntry('photo', {
              blob: photoFiles[i],
              thumbnail,
              sortOrder: baseOrder + i,
            });
          } catch (photoErr) {
            console.error('사진 저장 실패:', photoErr);
            failed++;
          }
        }
        clearPhotoSelection();
        if (failed > 0) {
          alert(`${failed}장의 사진 저장에 실패했습니다.`);
          setSaving(false);
          return;
        }
      } else if (mode === 'audio') {
        if (!recorder.audioBlob) {
          alert('녹음을 먼저 완료해주세요.');
          setSaving(false);
          return;
        }
        await addEntry('audio', {
          blob: recorder.audioBlob,
          duration: recorder.duration,
        });
        recorder.reset();
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error('저장 실패:', err);
      alert('저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* 모드 선택 탭 */}
      <div className="flex border-b border-gray-200 bg-white">
        {(['memo', 'photo', 'audio'] as InputMode[]).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              mode === m
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {m === 'memo' && '📝 메모'}
            {m === 'photo' && '📷 사진'}
            {m === 'audio' && '🎙️ 녹음'}
          </button>
        ))}
      </div>

      {/* 입력 영역 */}
      <div className="flex-1 p-4 overflow-y-auto">
        {/* 메모 모드 */}
        {mode === 'memo' && (
          <div className="space-y-3">
            <textarea
              value={memoText}
              onChange={(e) => setMemoText(e.target.value)}
              placeholder="오늘의 생각을 기록해보세요..."
              className="w-full h-40 p-3 border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 text-base"
            />
          </div>
        )}

        {/* 사진 모드 */}
        {mode === 'photo' && (
          <div className="space-y-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              capture="environment"
              onChange={handlePhotoSelect}
              className="hidden"
            />
            <div className="flex gap-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex-1 py-3 bg-blue-500 text-white rounded-lg font-medium active:bg-blue-600 transition-colors"
              >
                📷 카메라로 촬영
              </button>
              <button
                onClick={() => {
                  const input = fileInputRef.current;
                  if (input) {
                    input.removeAttribute('capture');
                    input.setAttribute('multiple', '');
                    input.click();
                    input.setAttribute('capture', 'environment');
                  }
                }}
                className="flex-1 py-3 bg-gray-200 text-gray-700 rounded-lg font-medium active:bg-gray-300 transition-colors"
              >
                🖼️ 갤러리에서 선택
              </button>
            </div>
            <p className="text-xs text-gray-500 text-center">
              한 번에 최대 {MAX_PHOTOS_PER_SAVE}장 · 현재 {photoFiles.length}장
            </p>
            {photoPreviews.length > 0 && (
              <div>
                <div className="grid grid-cols-3 gap-2">
                  {photoPreviews.map((preview, i) => (
                    <div
                      key={`${preview}-${i}`}
                      className="relative rounded-lg overflow-hidden"
                    >
                      <img
                        src={preview}
                        alt={`미리보기 ${i + 1}`}
                        className="w-full h-24 object-cover"
                      />
                      <button
                        onClick={() => removePhotoAt(i)}
                        aria-label={`${i + 1}번째 사진 제거`}
                        className="absolute top-1 right-1 w-6 h-6 bg-black/50 text-white rounded-full flex items-center justify-center text-xs"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
                {photoFiles.length > 1 && (
                  <button
                    onClick={clearPhotoSelection}
                    className="mt-2 w-full py-2 text-sm text-gray-500 underline"
                  >
                    전체 지우기
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* 녹음 모드 */}
        {mode === 'audio' && (
          <div className="space-y-4">
            <div className="text-center">
              <div className="text-4xl font-mono font-bold text-gray-800">
                {formatDuration(recorder.duration)}
              </div>
              {recorder.isRecording && (
                <div className="mt-1 text-sm text-red-500 animate-pulse">
                  {recorder.isPaused ? '일시정지' : '녹음 중...'}
                </div>
              )}
            </div>

            <div className="flex justify-center gap-3">
              {!recorder.isRecording && !recorder.audioBlob && (
                <button
                  onClick={recorder.startRecording}
                  className="w-16 h-16 bg-red-500 text-white rounded-full flex items-center justify-center text-2xl shadow-lg active:bg-red-600 transition-colors"
                >
                  ⏺
                </button>
              )}

              {recorder.isRecording && !recorder.isPaused && (
                <button
                  onClick={recorder.pauseRecording}
                  className="w-16 h-16 bg-yellow-500 text-white rounded-full flex items-center justify-center text-2xl shadow-lg active:bg-yellow-600 transition-colors"
                >
                  ⏸
                </button>
              )}

              {recorder.isRecording && recorder.isPaused && (
                <button
                  onClick={recorder.resumeRecording}
                  className="w-16 h-16 bg-green-500 text-white rounded-full flex items-center justify-center text-2xl shadow-lg active:bg-green-600 transition-colors"
                >
                  ▶
                </button>
              )}

              {recorder.isRecording && (
                <button
                  onClick={recorder.stopRecording}
                  className="w-16 h-16 bg-gray-700 text-white rounded-full flex items-center justify-center text-lg shadow-lg active:bg-gray-800 transition-colors"
                >
                  ⏹
                </button>
              )}
            </div>

            {recorder.audioUrl && (
              <div className="mt-3">
                <audio
                  src={recorder.audioUrl}
                  controls
                  className="w-full"
                />
                <button
                  onClick={recorder.reset}
                  className="mt-2 w-full py-2 text-sm text-gray-500 underline"
                >
                  다시 녹음하기
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 저장 버튼 */}
      <div className="p-4 bg-white border-t border-gray-200">
        <button
          onClick={handleSave}
          disabled={saving}
          className={`w-full py-3 rounded-lg font-bold text-white transition-colors ${
            saving
              ? 'bg-gray-400'
              : saved
                ? 'bg-green-500'
                : 'bg-blue-600 active:bg-blue-700'
          }`}
        >
          {saving ? '저장 중...' : saved ? '✓ 저장 완료!' : '기록 저장'}
        </button>
      </div>
    </div>
  );
}