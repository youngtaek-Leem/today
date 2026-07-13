import { useState, useRef, useCallback } from 'react';

interface RecorderState {
  isRecording: boolean;
  isPaused: boolean;
  duration: number;
  audioBlob: Blob | null;
  audioUrl: string | null;
}

export function useRecorder() {
  const [state, setState] = useState<RecorderState>({
    isRecording: false,
    isPaused: false,
    duration: 0,
    audioBlob: null,
    audioUrl: null,
  });

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const pausedDurationRef = useRef<number>(0);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const url = URL.createObjectURL(blob);
        setState((prev) => ({
          ...prev,
          isRecording: false,
          isPaused: false,
          audioBlob: blob,
          audioUrl: url,
        }));
        clearTimer();
        stream.getTracks().forEach((t) => t.stop());
      };

      recorder.start(1000); // 1초마다 데이터 수집
      startTimeRef.current = Date.now();
      pausedDurationRef.current = 0;

      timerRef.current = window.setInterval(() => {
        const elapsed = (Date.now() - startTimeRef.current) / 1000;
        setState((prev) => ({
          ...prev,
          duration: Math.floor(elapsed - pausedDurationRef.current),
        }));
      }, 200);

      setState((prev) => ({
        ...prev,
        isRecording: true,
        isPaused: false,
        audioBlob: null,
        audioUrl: null,
      }));
    } catch (err) {
      console.error('녹음 시작 실패:', err);
      alert('마이크 접근 권한이 필요합니다.');
    }
  }, [clearTimer]);

  const pauseRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.pause();
      clearTimer();
      pausedDurationRef.current +=
        (Date.now() - startTimeRef.current) / 1000;
      setState((prev) => ({ ...prev, isPaused: true }));
    }
  }, [clearTimer]);

  const resumeRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'paused') {
      mediaRecorderRef.current.resume();
      startTimeRef.current = Date.now();
      timerRef.current = window.setInterval(() => {
        const elapsed = (Date.now() - startTimeRef.current) / 1000;
        setState((prev) => ({
          ...prev,
          duration: Math.floor(
            elapsed + prev.duration,
          ),
        }));
      }, 200);
      setState((prev) => ({ ...prev, isPaused: false }));
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== 'inactive'
    ) {
      mediaRecorderRef.current.stop();
    }
  }, []);

  const reset = useCallback(() => {
    if (state.audioUrl) {
      URL.revokeObjectURL(state.audioUrl);
    }
    setState({
      isRecording: false,
      isPaused: false,
      duration: 0,
      audioBlob: null,
      audioUrl: null,
    });
  }, [state.audioUrl]);

  return {
    ...state,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
    reset,
  };
}