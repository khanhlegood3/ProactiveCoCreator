/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import { AppMode, SavedSessionRecord } from '../types';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface SessionHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  sessions: SavedSessionRecord[];
  onRestoreSession: (session: SavedSessionRecord) => void;
  onDeleteSession: (id: string) => void;
  onClearAll: () => void;
  onSaveSnapshot: () => void;
  onDownloadAllJson: () => void;
  onDownloadSingleJson: (session: SavedSessionRecord) => void;
  onTriggerUploadJson: () => void;
}

const MODE_LABELS: Record<AppMode, string> = {
  image: 'Image',
  story: 'Story',
  video: 'Video',
  'game-portal': 'Game Portal',
  'crypto-solana': 'Crypto · Solana',
};

const ACTION_LABELS: Record<SavedSessionRecord['actionType'], string> = {
  analyze: 'Phân tích',
  refine: 'Tinh chỉnh Prompt',
  generate: 'Tạo kết quả',
  snapshot: 'Snapshot',
  imported: 'Đã nhập JSON',
};

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('vi-VN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function summarizeResults(session: SavedSessionRecord): string {
  const parts: string[] = [];
  const validImgCount = session.results.images.filter((i) => Boolean(i.url)).length;
  if (validImgCount > 0) parts.push(`${validImgCount} ảnh`);
  if (session.results.story) parts.push(`Truyện (${session.results.story.length} ký tự)`);
  if (session.results.video) parts.push('Video');
  if (session.results.blueprint) parts.push(`Blueprint: ${session.results.blueprint.title}`);
  if (session.results.error) parts.push(`Lỗi: ${session.results.error}`);
  return parts.length > 0 ? parts.join(' · ') : 'Chưa tạo kết quả (chỉ phân tích/chat)';
}

const SessionHistoryModal: React.FC<SessionHistoryModalProps> = ({
  isOpen,
  onClose,
  sessions,
  onRestoreSession,
  onDeleteSession,
  onClearAll,
  onSaveSnapshot,
  onDownloadAllJson,
  onDownloadSingleJson,
  onTriggerUploadJson,
}) => {
  const modalRef = useFocusTrap(isOpen);
  const [filterMode, setFilterMode] = useState<'all' | AppMode>('all');
  const [query, setQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const filteredSessions = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sessions.filter((s) => {
      if (filterMode !== 'all' && s.mode !== filterMode) return false;
      if (!q) return true;
      const inPrompt = s.prompt.toLowerCase().includes(q);
      const inStory = (s.results.story || '').toLowerCase().includes(q);
      const inBlueprint = (s.results.blueprint?.title || '').toLowerCase().includes(q);
      const inEntities = (s.beliefGraph?.entities || []).some((e) =>
        e.name.toLowerCase().includes(q)
      );
      return inPrompt || inStory || inBlueprint || inEntities;
    });
  }, [sessions, filterMode, query]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[3000] bg-black/55 flex items-center justify-center p-3 sm:p-5 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="idb-history-title"
    >
      <div
        ref={modalRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 w-full max-w-4xl max-h-[88vh] flex flex-col overflow-hidden outline-none"
      >
        {/* Header */}
        <div className="px-4 sm:px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2
              id="idb-history-title"
              className="font-display text-lg font-bold text-gray-900 dark:text-gray-100"
            >
              IndexedDB Archive · Chat, Xử lý &amp; Kết quả
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 tabular-nums">
              {sessions.length} phiên đã lưu tự động trong trình duyệt
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={onSaveSnapshot}
              className="px-3 py-1.5 text-xs font-medium rounded-md border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors whitespace-nowrap shrink-0"
            >
              Lưu phiên hiện tại
            </button>
            <button
              onClick={onDownloadAllJson}
              className="px-3 py-1.5 text-xs font-medium rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors whitespace-nowrap shrink-0"
            >
              Tải xuống JSON
            </button>
            <button
              onClick={onTriggerUploadJson}
              className="px-3 py-1.5 text-xs font-medium rounded-md bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:opacity-90 transition-opacity whitespace-nowrap shrink-0"
            >
              Upload JSON
            </button>
            <button
              onClick={onClose}
              aria-label="Đóng lịch sử IndexedDB"
              className="p-1.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="px-4 sm:px-6 py-3 bg-gray-50 dark:bg-gray-900/40 border-b border-gray-200 dark:border-gray-700 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            {(['all', 'image', 'story', 'video', 'game-portal', 'crypto-solana'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setFilterMode(m)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md whitespace-nowrap shrink-0 transition-colors ${
                  filterMode === m
                    ? 'bg-blue-600 text-white'
                    : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                {m === 'all' ? 'Tất cả' : MODE_LABELS[m]}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 flex-1 sm:flex-initial justify-end">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Tìm prompt, entity, kết quả..."
              className="w-full sm:w-56 text-xs px-2.5 py-1.5 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {sessions.length > 0 && (
              confirmClear ? (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      onClearAll();
                      setConfirmClear(false);
                    }}
                    className="px-2.5 py-1 text-xs font-medium rounded-md bg-red-600 text-white hover:bg-red-700 whitespace-nowrap"
                  >
                    Xác nhận xóa
                  </button>
                  <button
                    onClick={() => setConfirmClear(false)}
                    className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400"
                  >
                    Hủy
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmClear(true)}
                  className="px-2.5 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md whitespace-nowrap"
                >
                  Xóa hết
                </button>
              )
            )}
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3 bg-white dark:bg-gray-800">
          {filteredSessions.length === 0 ? (
            <div className="text-center py-12 text-gray-500 dark:text-gray-400 text-sm">
              Chưa có phiên nào khớp bộ lọc trong IndexedDB. Hãy phân tích, tinh chỉnh hoặc tạo kết quả để tự động lưu.
            </div>
          ) : (
            filteredSessions.map((session) => {
              const isExpanded = expandedId === session.id;
              const entityCount = session.beliefGraph?.entities?.length ?? 0;
              const relCount = session.beliefGraph?.relationships?.length ?? 0;
              const qaCount = (session.qaPairs?.length || 0) + Object.keys(session.pendingClarificationAnswers || {}).length;

              return (
                <div
                  key={session.id}
                  className="border border-gray-200 dark:border-gray-700 rounded-lg p-3.5 bg-gray-50/60 dark:bg-gray-900/40"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium text-gray-500 dark:text-gray-400 tabular-nums">
                        {formatTime(session.updatedAt)} · {MODE_LABELS[session.mode]} · {ACTION_LABELS[session.actionType]}
                        {session.domainTrack ? ` · ${session.domainTrack}` : ''}
                      </div>
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100 mt-1 line-clamp-2">
                        {session.prompt || '(Trống)'}
                      </p>
                      <div className="text-xs text-gray-600 dark:text-gray-300 mt-1.5 tabular-nums">
                        Xử lý: {entityCount} entities · {relCount} relations · {session.clarifications.length} câu hỏi gợi ý · {qaCount} Q&amp;A
                      </div>
                      <div className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                        Kết quả: {summarizeResults(session)}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : session.id)}
                        className="px-2.5 py-1 text-xs font-medium rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 whitespace-nowrap"
                      >
                        {isExpanded ? 'Thu gọn' : 'Chi tiết'}
                      </button>
                      <button
                        onClick={() => onDownloadSingleJson(session)}
                        className="px-2.5 py-1 text-xs font-medium rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 whitespace-nowrap"
                      >
                        JSON
                      </button>
                      <button
                        onClick={() => {
                          onRestoreSession(session);
                          onClose();
                        }}
                        className="px-2.5 py-1 text-xs font-medium rounded bg-blue-600 text-white hover:bg-blue-700 whitespace-nowrap"
                      >
                        Khôi phục
                      </button>
                      <button
                        onClick={() => onDeleteSession(session.id)}
                        aria-label="Xóa phiên"
                        className="px-2 py-1 text-xs font-medium rounded text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 whitespace-nowrap"
                      >
                        Xóa
                      </button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700 space-y-2 text-xs text-gray-700 dark:text-gray-300">
                      {session.refinedFromPrompt && (
                        <div>
                          <span className="font-semibold text-gray-900 dark:text-gray-100">Prompt gốc trước tinh chỉnh:</span>{' '}
                          {session.refinedFromPrompt}
                        </div>
                      )}
                      {session.qaPairs && session.qaPairs.length > 0 && (
                        <div>
                          <span className="font-semibold text-gray-900 dark:text-gray-100">Lịch sử trả lời câu hỏi:</span>
                          <ul className="list-disc pl-4 mt-1 space-y-0.5">
                            {session.qaPairs.map((qa, i) => (
                              <li key={i}>
                                <span className="font-medium">{qa.question}</span> → {qa.answer}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {session.beliefGraph && session.beliefGraph.entities.length > 0 && (
                        <div>
                          <span className="font-semibold text-gray-900 dark:text-gray-100">Entities đã xử lý:</span>{' '}
                          {session.beliefGraph.entities.map((e) => e.name).join(', ')}
                        </div>
                      )}
                      {session.results.story && (
                        <div className="bg-white dark:bg-gray-800 p-2.5 rounded border border-gray-200 dark:border-gray-700 max-h-36 overflow-y-auto whitespace-pre-wrap">
                          {session.results.story}
                        </div>
                      )}
                      {session.results.blueprint && (
                        <div className="bg-white dark:bg-gray-800 p-2.5 rounded border border-gray-200 dark:border-gray-700">
                          <div className="font-semibold">{session.results.blueprint.title}</div>
                          <p className="mt-1 text-gray-600 dark:text-gray-400">
                            {session.results.blueprint.executiveSummary}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

export default SessionHistoryModal;
