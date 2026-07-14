import { useState } from 'react';
import RecordPage from './components/RecordPage';
import CalendarPage from './components/CalendarPage';
import DetailPage from './components/DetailPage';

type Page = 'record' | 'calendar' | 'detail';

export default function App() {
  const [currentPage, setCurrentPage] = useState<Page>('calendar');
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  });

  const handleSelectDate = (date: string) => {
    setSelectedDate(date);
    setCurrentPage('detail');
  };

  const handleBackToCalendar = () => {
    setCurrentPage('calendar');
  };

  return (
    <div className="flex flex-col h-svh max-w-md mx-auto bg-white shadow-lg">
      {/* 하단 네비게이션 바 */}
      {currentPage !== 'detail' && (
        <div className="flex-1 overflow-hidden">
          {currentPage === 'calendar' && (
            <CalendarPage onSelectDate={handleSelectDate} />
          )}
          {currentPage === 'record' && <RecordPage />}
        </div>
      )}

      {currentPage === 'detail' && (
        <div className="flex-1 overflow-hidden">
          <DetailPage date={selectedDate} onBack={handleBackToCalendar} />
        </div>
      )}

      {/* 하단 탭 바 */}
      {currentPage !== 'detail' && (
        <nav className="flex border-t border-gray-200 bg-white">
          <button
            onClick={() => setCurrentPage('calendar')}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              currentPage === 'calendar'
                ? 'text-blue-600 border-t-2 border-blue-600'
                : 'text-gray-500'
            }`}
          >
            📅 달력
          </button>
          <button
            onClick={() => setCurrentPage('record')}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              currentPage === 'record'
                ? 'text-blue-600 border-t-2 border-blue-600'
                : 'text-gray-500'
            }`}
          >
            ✍️ 기록
          </button>
        </nav>
      )}
    </div>
  );
}