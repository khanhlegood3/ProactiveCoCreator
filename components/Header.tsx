/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Tooltip } from './Tooltip';
import { AppMode } from '../types';
import { useLanguage } from '../contexts/LanguageContext';

interface HeaderProps {
  isDarkMode: boolean;
  toggleDarkMode: () => void;
  onShowInfo: () => void;
  onShowHistory: () => void;
  onDownloadJson: () => void;
  onTriggerUploadJson: () => void;
  savedCount: number;
  isLoading: boolean;
  mode: AppMode;
}

const Header: React.FC<HeaderProps> = ({
  isDarkMode,
  toggleDarkMode,
  onShowInfo,
  onShowHistory,
  onDownloadJson,
  onTriggerUploadJson,
  savedCount,
}) => {
  const { language, setLanguage, tr } = useLanguage();

  return (
    <header className="bg-white dark:bg-gray-850 py-2 px-3 sm:px-4 flex justify-between items-center gap-2 border-b border-gray-200 dark:border-gray-700 shadow-sm transition-colors duration-200 relative z-[100]">
      <h1 className="font-display text-base sm:text-xl font-bold tracking-tight text-gray-900 dark:text-gray-100 whitespace-nowrap shrink-0">
        Proactive Co-Creator
      </h1>

      <div className="flex items-center gap-1 sm:gap-1.5 shrink-0 overflow-x-auto no-scrollbar">
        {/* Bilingual VI / EN Toggle */}
        <Tooltip
          content={tr('Chuyển đổi ngôn ngữ Tiếng Việt / English', 'Switch language Vietnamese / English')}
          position="bottom-right"
        >
          <div
            role="group"
            aria-label={tr('Chọn ngôn ngữ', 'Select language')}
            className="flex items-center bg-gray-100 dark:bg-gray-800 p-0.5 rounded-md border border-gray-200 dark:border-gray-700 shrink-0"
          >
            <button
              type="button"
              onClick={() => setLanguage('vi')}
              aria-pressed={language === 'vi'}
              className={`px-2 py-1 text-[11px] sm:text-xs font-semibold rounded transition-colors whitespace-nowrap ${
                language === 'vi'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              VI
            </button>
            <button
              type="button"
              onClick={() => setLanguage('en')}
              aria-pressed={language === 'en'}
              className={`px-2 py-1 text-[11px] sm:text-xs font-semibold rounded transition-colors whitespace-nowrap ${
                language === 'en'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              EN
            </button>
          </div>
        </Tooltip>

        <Tooltip
          content={tr(
            'Xem & khôi phục dữ liệu chat, xử lý và kết quả đã lưu trong IndexedDB',
            'View & restore saved chats, processing state, and outputs in IndexedDB'
          )}
          position="bottom-right"
        >
          <button
            onClick={onShowHistory}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-gray-700 dark:text-gray-200 text-[12px] sm:text-[13px] font-medium border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 whitespace-nowrap shrink-0"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
            </svg>
            <span className="tabular-nums">
              {tr(`Lưu trữ (${savedCount})`, `Archive (${savedCount})`)}
            </span>
          </button>
        </Tooltip>

        <Tooltip
          content={tr(
            'Tải xuống toàn bộ chat, xử lý & kết quả dạng JSON',
            'Download all chats, processing state & outputs as JSON'
          )}
          position="bottom-right"
        >
          <button
            onClick={onDownloadJson}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-gray-700 dark:text-gray-200 text-[12px] sm:text-[13px] font-medium border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 whitespace-nowrap shrink-0"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-emerald-600 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            <span>{tr('Tải JSON', 'Export JSON')}</span>
          </button>
        </Tooltip>

        <Tooltip
          content={tr(
            'Upload file JSON để khôi phục dữ liệu vào IndexedDB',
            'Upload a JSON file to restore data into IndexedDB'
          )}
          position="bottom-right"
        >
          <button
            onClick={onTriggerUploadJson}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-gray-700 dark:text-gray-200 text-[12px] sm:text-[13px] font-medium border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 whitespace-nowrap shrink-0"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-indigo-600 dark:text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            <span>{tr('Tải lên JSON', 'Import JSON')}</span>
          </button>
        </Tooltip>

        <Tooltip content={tr('Tìm hiểu thêm về ứng dụng', 'Learn more about this app')} position="bottom-right">
          <button
            onClick={onShowInfo}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-gray-600 dark:text-gray-300 text-[13px] font-medium hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 whitespace-nowrap shrink-0"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="hidden md:inline">{tr('Thông tin', 'Info')}</span>
          </button>
        </Tooltip>

        <Tooltip
          content={
            isDarkMode
              ? tr('Chuyển sang chế độ Sáng', 'Switch to Light Mode')
              : tr('Chuyển sang chế độ Tối', 'Switch to Dark Mode')
          }
          position="bottom-right"
        >
          <button
            onClick={toggleDarkMode}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-gray-600 dark:text-gray-300 text-[13px] font-medium hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 whitespace-nowrap shrink-0"
          >
            {isDarkMode ? (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
            )}
            <span className="hidden md:inline">
              {isDarkMode ? tr('Sáng', 'Light') : tr('Tối', 'Dark')}
            </span>
          </button>
        </Tooltip>
      </div>
    </header>
  );
};

export default Header;
