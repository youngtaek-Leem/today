import { useState, useEffect } from 'react';
import Calendar from 'react-calendar';
import 'react-calendar/dist/Calendar.css';
import { getAllDateSummaries } from '../storage/service';
import type { DateSummary } from '../storage/types';

type ValuePiece = Date | null;
type Value = ValuePiece | [ValuePiece, ValuePiece];

interface CalendarPageProps {
  onSelectDate: (date: string) => void;
}

export default function CalendarPage({ onSelectDate }: CalendarPageProps) {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [summaries, setSummaries] = useState<Map<string, DateSummary>>(
    new Map(),
  );

  useEffect(() => {
    loadSummaries();
  }, []);

  const loadSummaries = async () => {
    const data = await getAllDateSummaries();
    const map = new Map<string, DateSummary>();
    for (const s of data) {
      map.set(s.date, s);
    }
    setSummaries(map);
  };

  const toLocalDateString = (date: Date): string => {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };

  const handleDateChange = (value: Value) => {
    if (value instanceof Date) {
      setSelectedDate(value);
      const dateStr = toLocalDateString(value);
      onSelectDate(dateStr);
    }
  };

  const formatDate = (date: Date): string => {
    return toLocalDateString(date);
  };

  const tileContent = ({ date, view }: { date: Date; view: string }) => {
    if (view !== 'month') return null;
    const dateStr = formatDate(date);
    const summary = summaries.get(dateStr);
    if (!summary) return null;

    return (
      <div className="flex flex-col items-center mt-1 gap-0.5">
        {/* 썸네일 미리보기 */}
        {summary.thumbnails.length > 0 && (
          <div className="flex gap-0.5 justify-center">
            {summary.thumbnails.slice(0, 3).map((thumb, i) => (
              <img
                key={i}
                src={thumb}
                alt=""
                className="w-6 h-6 rounded object-cover"
              />
            ))}
          </div>
        )}
        {/* 카운트 표시 */}
        <div className="flex gap-1 text-[10px]">
          {summary.memoCount > 0 && (
            <span className="text-gray-500">📝{summary.memoCount}</span>
          )}
          {summary.photoCount > 0 && (
            <span className="text-gray-500">📷{summary.photoCount}</span>
          )}
          {summary.audioCount > 0 && (
            <span className="text-gray-500">🎙{summary.audioCount}</span>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="p-4 border-b border-gray-200">
        <h2 className="text-lg font-bold text-gray-800">
          {selectedDate.getFullYear()}년 {selectedDate.getMonth() + 1}월
        </h2>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        <Calendar
          onChange={handleDateChange}
          value={selectedDate}
          tileContent={tileContent}
          calendarType="gregory"
          formatDay={(_, date) => date.getDate().toString()}
          className="w-full border-none"
          tileClassName={({ date, view }) => {
            if (view !== 'month') return '';
            const dateStr = formatDate(date);
            const summary = summaries.get(dateStr);
            return summary ? 'font-bold' : '';
          }}
        />
      </div>
      {/* 새로고침 버튼 */}
      <div className="p-3 border-t border-gray-200">
        <button
          onClick={loadSummaries}
          className="w-full py-2 text-sm text-blue-600 font-medium active:text-blue-700"
        >
          🔄 새로고침
        </button>
      </div>
    </div>
  );
}