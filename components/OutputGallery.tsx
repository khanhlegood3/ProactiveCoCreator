/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { Tooltip } from './Tooltip';
import { AppMode, DomainBlueprint, GeneratedImage } from '../types';
import GamePortalOpsPanel from './GamePortalOpsPanel';
import CryptoSolanaOpsPanel from './CryptoSolanaOpsPanel';
import { useLanguage } from '../contexts/LanguageContext';

interface OutputDisplayProps {
  images: GeneratedImage[];
  story: string | null;
  video: string | null;
  blueprint: DomainBlueprint | null;
  mode: AppMode;
  isLoading: boolean;
  error: string | null;
  isOutdated: boolean;
  requiresApiKey?: boolean;
  onSelectKey?: () => void;
  aspectRatio?: string;
  onUseAsReference?: (imageDataUrl: string) => void;
  onApplyToPrompt?: () => void;
  onApplySnippetToPrompt?: (snippet: string) => void;
}

function formatBlueprintMarkdown(bp: DomainBlueprint, tr: (vi: string, en: string) => string): string {
  const lines: string[] = [];
  lines.push(`# ${bp.title}`);
  lines.push('');
  lines.push(bp.executiveSummary);
  lines.push('');
  if (bp.architecturePhases.length > 0) {
    lines.push(tr('## Các giai đoạn kiến trúc', '## Architecture Phases'));
    bp.architecturePhases.forEach((p) => {
      lines.push(`- **${p.phase}**: ${p.objective} | Stack: ${p.stack} | ${tr('Doanh thu', 'Revenue')}: ${p.revenueModel}`);
    });
    lines.push('');
  }
  if (bp.tiersOrTokenomics.length > 0) {
    lines.push(
      bp.domain === 'game-portal'
        ? tr('## Gói giá Studio', '## Studio Pricing Tiers')
        : tr('## Tokenomics & Biểu phí', '## Tokenomics & Fee Schedule')
    );
    bp.tiersOrTokenomics.forEach((t) => {
      lines.push(`- **${t.name}** (${t.targetAudience}): ${t.priceOrFee} — ${t.deliverables} [${t.settlementRail}]`);
    });
    lines.push('');
  }
  if (bp.gateCriteria.length > 0) {
    lines.push(tr('## Ngưỡng kiểm định Gate', '## Gate & Verification Thresholds'));
    bp.gateCriteria.forEach((g) => {
      lines.push(`- **${g.metric}**: ${g.threshold} (${tr('Chuẩn', 'Benchmark')}: ${g.sourceBenchmark}) → ${tr('Khi không đạt', 'Fail Action')}: ${g.actionOnFail}`);
    });
    lines.push('');
  }
  if (bp.escrowAndReceiptFlow.length > 0) {
    lines.push(tr('## Luồng ký quỹ & đối soát biên bản', '## Escrow & Receipt Reconciliation Flow'));
    bp.escrowAndReceiptFlow.forEach((step, idx) => {
      lines.push(`${idx + 1}. ${step}`);
    });
    lines.push('');
  }
  if (bp.risks.length > 0) {
    lines.push(tr('## Ma trận rủi ro', '## Risk Matrix'));
    bp.risks.forEach((r) => {
      lines.push(`- **${r.risk}** (${tr('Bằng chứng', 'Evidence')}: ${r.evidence}) → ${tr('Giảm thiểu', 'Mitigation')}: ${r.mitigation}`);
    });
    lines.push('');
  }
  if (bp.nextActions.length > 0) {
    lines.push(tr('## Bước tiếp theo', '## Next Actions'));
    bp.nextActions.forEach((a, idx) => lines.push(`${idx + 1}. ${a}`));
  }
  return lines.join('\n');
}

const OutputDisplay: React.FC<OutputDisplayProps> = ({
  images,
  story,
  video,
  blueprint,
  mode,
  isLoading,
  error,
  isOutdated,
  requiresApiKey,
  onSelectKey,
  aspectRatio,
  onUseAsReference,
  onApplyToPrompt,
  onApplySnippetToPrompt,
}) => {
  const { tr } = useLanguage();
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  const [showApplyConfirmation, setShowApplyConfirmation] = useState(false);
  const [industrySubView, setIndustrySubView] = useState<'ops' | 'blueprint'>('ops');

  const modalCloseButtonRef = useRef<HTMLButtonElement>(null);
  const confirmationCloseButtonRef = useRef<HTMLButtonElement>(null);
  const lightboxRef = useRef<HTMLDivElement>(null);
  const confirmationRef = useRef<HTMLDivElement>(null);
  const lastActiveElement = useRef<HTMLElement | null>(null);

  const placeholderCount = 4;
  const isIndustryMode = mode === 'game-portal' || mode === 'crypto-solana';

  useEffect(() => {
    if (isIndustryMode && (isLoading || (blueprint && blueprint.domain === mode))) {
      setIndustrySubView('blueprint');
    } else if (isIndustryMode && !blueprint && !isLoading) {
      setIndustrySubView('ops');
    }
  }, [isIndustryMode, isLoading, blueprint, mode]);

  useEffect(() => {
    if (selectedImage && lightboxRef.current) {
      lastActiveElement.current = document.activeElement as HTMLElement;
      const modal = lightboxRef.current;
      if (modalCloseButtonRef.current) modalCloseButtonRef.current.focus();

      const handleTab = (e: KeyboardEvent) => {
        const focusableElements = modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        const firstElement = focusableElements[0] as HTMLElement | undefined;
        const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement | undefined;

        if (e.key === 'Tab') {
          if (!modal.contains(document.activeElement)) {
            e.preventDefault();
            firstElement?.focus();
            return;
          }
          if (e.shiftKey) {
            if (document.activeElement === firstElement) {
              e.preventDefault();
              lastElement?.focus();
            }
          } else {
            if (document.activeElement === lastElement) {
              e.preventDefault();
              firstElement?.focus();
            }
          }
        }
        if (e.key === 'Escape') setSelectedImage(null);
      };

      document.addEventListener('keydown', handleTab);
      return () => {
        document.removeEventListener('keydown', handleTab);
        if (lastActiveElement.current && document.contains(lastActiveElement.current)) {
          lastActiveElement.current.focus();
        }
      };
    }
  }, [selectedImage]);

  useEffect(() => {
    if (showApplyConfirmation && confirmationRef.current) {
      lastActiveElement.current = document.activeElement as HTMLElement;
      const modal = confirmationRef.current;
      if (confirmationCloseButtonRef.current) confirmationCloseButtonRef.current.focus();

      const handleTab = (e: KeyboardEvent) => {
        const focusableElements = modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        const firstElement = focusableElements[0] as HTMLElement | undefined;
        const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement | undefined;

        if (e.key === 'Tab') {
          if (!modal.contains(document.activeElement)) {
            e.preventDefault();
            firstElement?.focus();
            return;
          }
          if (e.shiftKey) {
            if (document.activeElement === firstElement) {
              e.preventDefault();
              lastElement?.focus();
            }
          } else {
            if (document.activeElement === lastElement) {
              e.preventDefault();
              firstElement?.focus();
            }
          }
        }
        if (e.key === 'Escape') setShowApplyConfirmation(false);
      };

      document.addEventListener('keydown', handleTab);
      return () => {
        document.removeEventListener('keydown', handleTab);
        if (lastActiveElement.current && document.contains(lastActiveElement.current)) {
          lastActiveElement.current.focus();
        }
      };
    }
  }, [showApplyConfirmation]);

  const downloadTextFile = (content: string, filename: string, mime = 'text/plain') => {
    const element = document.createElement('a');
    const file = new Blob([content], { type: mime });
    const url = URL.createObjectURL(file);
    element.href = url;
    element.download = filename;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
    setTimeout(() => URL.revokeObjectURL(url), 100);
  };

  const copyText = (text: string) => {
    void navigator.clipboard?.writeText(text)?.catch(() => {});
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const handleConfirmApply = () => {
    if (onApplyToPrompt) onApplyToPrompt();
    setShowApplyConfirmation(false);
  };

  const renderImageContent = () => {
    if (isLoading) {
      return Array(placeholderCount)
        .fill(null)
        .map((_, index) => (
          <div key={index} className="aspect-square bg-gray-100 dark:bg-gray-700 rounded-lg flex items-center justify-center">
            <div className="flex flex-col items-center text-gray-500 dark:text-gray-400">
              <svg className="animate-spin h-8 w-8 text-gray-400 dark:text-gray-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span className="mt-2 text-sm text-center px-4">{tr('Đang tạo ảnh...', 'Generating images...')}</span>
            </div>
          </div>
        ));
    }

    if (images.length > 0) {
      const content = images.map((image, index) => {
        if (image.url) {
          return (
            <button
              key={index}
              className="aspect-square bg-gray-100 dark:bg-gray-700 rounded-lg overflow-hidden relative shadow-sm border border-gray-200 dark:border-gray-700 group cursor-zoom-in focus:outline-none focus:ring-4 focus:ring-blue-500"
              onClick={() => setSelectedImage(image.url)}
              aria-label={tr(`Xem trước ảnh ${index + 1}`, `Preview generated image ${index + 1}`)}
            >
              <img src={image.url} alt="" className="w-full h-full object-cover transition-transform group-hover:scale-105" />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors"></div>
            </button>
          );
        }
        return (
          <div key={index} className="aspect-square bg-gray-50 dark:bg-gray-800/50 rounded-lg border-2 border-dashed border-gray-200 dark:border-gray-700 flex flex-col items-center justify-center text-gray-400 text-center p-2">
            <span className="text-sm font-semibold">{tr('Tạo thất bại', 'Generation Failed')}</span>
            {image.error && <span className="text-xs mt-1 text-red-400 line-clamp-3">{image.error}</span>}
          </div>
        );
      });

      while (content.length < 4) {
        content.push(
          <div key={`missing-${content.length}`} className="aspect-square bg-gray-50 dark:bg-gray-800/50 rounded-lg border-2 border-dashed border-gray-200 dark:border-gray-700 flex flex-col items-center justify-center text-gray-400">
            <span className="text-sm">{tr('Tạo thất bại', 'Generation Failed')}</span>
          </div>
        );
      }
      return content;
    }

    return Array(placeholderCount)
      .fill(null)
      .map((_, index) => (
        <div key={index} className="aspect-square bg-gray-100 dark:bg-gray-700 rounded-lg flex items-center justify-center">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-gray-300 dark:text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </div>
      ));
  };

  const renderVideoContent = () => {
    if (isLoading) {
      return (
        <div className="h-full flex flex-col items-center justify-center text-gray-500 dark:text-gray-400">
          <svg className="animate-spin h-8 w-8 text-gray-400 dark:text-gray-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span className="mt-2 text-base">{tr('Đang tạo video...', 'Generating video...')}</span>
        </div>
      );
    }
    if (video) {
      const isPortrait = aspectRatio === '9:16';
      return (
        <div className="flex flex-col items-center justify-start min-h-full w-full p-2 sm:p-4">
          <div className={`w-full bg-black rounded-xl overflow-hidden shadow-2xl border border-gray-800 relative group shrink-0 ${isPortrait ? 'max-w-[400px]' : ''}`}>
            <video controls className="w-full h-auto max-h-[75vh]" src={video} autoPlay loop muted>
              {tr('Trình duyệt của bạn không hỗ trợ thẻ video.', 'Your browser does not support the video tag.')}
            </video>
          </div>
          <div className="flex gap-4 mt-6">
            <a
              href={video}
              download="generated-video.mp4"
              className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-lg font-medium text-sm shadow-lg flex items-center gap-2 transition-all"
            >
              {tr('Tải xuống MP4', 'Download MP4')}
            </a>
          </div>
        </div>
      );
    }
    return (
      <div className="h-full bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg flex flex-col items-center justify-center text-center text-gray-400 dark:text-gray-500 p-8 shadow-sm">
        <p className="text-sm font-medium">{tr('Video được tạo sẽ hiển thị tại đây.', 'Your generated video will appear here.')}</p>
      </div>
    );
  };

  const renderStoryContent = () => {
    if (isLoading) {
      return (
        <div className="h-full flex flex-col items-center justify-center text-gray-500 dark:text-gray-400">
          <svg className="animate-spin h-8 w-8 text-gray-400 dark:text-gray-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span className="mt-2 text-base">{tr('Đang viết nội dung...', 'Writing story...')}</span>
        </div>
      );
    }
    if (story) {
      return (
        <div className="prose prose-base dark:prose-invert max-w-none p-4 bg-gray-50 dark:bg-gray-900 rounded-lg border dark:border-gray-700">
          {story.split('\n').map((paragraph, index) => (
            <p key={index} className="text-gray-800 dark:text-gray-200">
              {paragraph}
            </p>
          ))}
        </div>
      );
    }
    return (
      <div className="h-full bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg flex flex-col items-center justify-center text-center text-gray-400 dark:text-gray-500 p-8 shadow-sm">
        <p className="text-sm font-medium">{tr('Câu chuyện sáng tạo của bạn sẽ hiển thị tại đây.', 'Your creative story will appear here.')}</p>
      </div>
    );
  };

  const renderBlueprintContent = () => {
    if (isLoading) {
      return (
        <div className="h-full flex flex-col items-center justify-center text-gray-500 dark:text-gray-400 p-8">
          <svg className="animate-spin h-8 w-8 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span className="mt-3 text-sm font-medium text-center">
            {mode === 'game-portal'
              ? tr(
                  'Đang tổng hợp Kiến trúc Game9K, Bảng giá & Chỉ số Gate...',
                  'Synthesizing Game9K Architecture, Pricing Tiers & Gate Metrics...'
                )
              : tr(
                  'Đang tổng hợp Blueprint Pump.fun Bonding Curve & Ký quỹ Solana USDC/USDT...',
                  'Synthesizing Pump.fun Bonding Curve & Solana USDC/USDT Escrow Blueprint...'
                )}
          </span>
        </div>
      );
    }

    if (!blueprint || blueprint.domain !== mode) {
      return (
        <div className="h-full bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg flex flex-col items-center justify-center text-center text-gray-500 dark:text-gray-400 p-8">
          <p className="text-sm font-medium">
            {tr('Nhấn ', 'Click ')}
            <strong className="text-blue-600 dark:text-blue-400">{tr('Tạo Blueprint', 'Generate Blueprint')}</strong>
            {mode === 'game-portal'
              ? tr(
                  ' để tạo bản thiết kế chi tiết cho Game9K Playtest & LiveOps, hoặc chọn ',
                  ' to synthesize a structured Game9K Playtest & LiveOps plan from your prompt, or switch to '
                )
              : tr(
                  ' để tạo bản thiết kế chi tiết cho Pump.fun / Solana / USDC-USDT, hoặc chọn ',
                  ' to synthesize a structured Pump.fun / Solana / USDC-USDT plan from your prompt, or switch to '
                )}
            <strong>{tr('Vận hành & Telemetry', 'Ops & Telemetry')}</strong>
            {tr(' phía trên để mở bảng mô phỏng trực tiếp.', ' above to explore the live console.')}
          </p>
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-5 pb-4 text-sm">
        <div className="p-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50/70 dark:bg-gray-900/40">
          <h3 className="font-display text-lg font-bold text-gray-900 dark:text-gray-100">{blueprint.title}</h3>
          <p className="text-sm text-gray-700 dark:text-gray-300 mt-2 leading-relaxed">{blueprint.executiveSummary}</p>
        </div>

        {blueprint.architecturePhases.length > 0 && (
          <div className="flex flex-col gap-2">
            <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400">
              {tr('Kiến trúc & Giai đoạn triển khai', 'Architecture & Phasing')}
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {blueprint.architecturePhases.map((p, idx) => (
                <div key={idx} className="p-3.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex flex-col gap-1.5">
                  <div className="font-semibold text-gray-900 dark:text-gray-100">{p.phase}</div>
                  <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">{p.objective}</p>
                  <div className="text-[11px] text-gray-500 dark:text-gray-400 pt-1 border-t border-gray-100 dark:border-gray-700">
                    {tr('Công nghệ', 'Stack')}: {p.stack} · {tr('Doanh thu', 'Revenue')}: {p.revenueModel}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {blueprint.tiersOrTokenomics.length > 0 && (
          <div className="flex flex-col gap-2">
            <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400">
              {mode === 'game-portal'
                ? tr('Gói giá Studio & LiveOps', 'Studio Pricing Tiers & LiveOps')
                : tr('Tokenomics & Biểu phí', 'Tokenomics & Fee Schedule')}
            </h4>
            <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-900/60 border-b border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400">
                    <th className="py-2 px-3 font-medium">{tr('Gói / Hạng mục', 'Tier / Item')}</th>
                    <th className="py-2 px-3 font-medium">{tr('Đối tượng', 'Target')}</th>
                    <th className="py-2 px-3 font-medium">{tr('Giá / Phí', 'Price / Fee')}</th>
                    <th className="py-2 px-3 font-medium">{tr('Hạng mục bàn giao', 'Deliverables')}</th>
                    <th className="py-2 px-3 font-medium">{tr('Cổng thanh toán', 'Rail')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700/70">
                  {blueprint.tiersOrTokenomics.map((t, idx) => (
                    <tr key={idx}>
                      <td className="py-2 px-3 font-semibold text-gray-900 dark:text-gray-100">{t.name}</td>
                      <td className="py-2 px-3 text-gray-600 dark:text-gray-300">{t.targetAudience}</td>
                      <td className="py-2 px-3 font-mono tabular-nums font-semibold text-blue-600 dark:text-blue-400 whitespace-nowrap">{t.priceOrFee}</td>
                      <td className="py-2 px-3 text-gray-700 dark:text-gray-300">{t.deliverables}</td>
                      <td className="py-2 px-3 text-gray-600 dark:text-gray-300 whitespace-nowrap">{t.settlementRail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {blueprint.gateCriteria.length > 0 && (
          <div className="flex flex-col gap-2">
            <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400">
              {tr('Tiêu chí Gate định lượng', 'Quantitative Gate Criteria')}
            </h4>
            <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-900/60 border-b border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400">
                    <th className="py-2 px-3 font-medium">{tr('Chỉ số', 'Metric')}</th>
                    <th className="py-2 px-3 font-medium">{tr('Ngưỡng đạt', 'Threshold')}</th>
                    <th className="py-2 px-3 font-medium">{tr('Chuẩn tham chiếu', 'Benchmark')}</th>
                    <th className="py-2 px-3 font-medium">{tr('Xử lý khi trượt', 'Fail Action')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700/70">
                  {blueprint.gateCriteria.map((g, idx) => (
                    <tr key={idx}>
                      <td className="py-2 px-3 font-semibold text-gray-900 dark:text-gray-100">{g.metric}</td>
                      <td className="py-2 px-3 font-mono tabular-nums font-semibold text-emerald-700 dark:text-emerald-400 whitespace-nowrap">{g.threshold}</td>
                      <td className="py-2 px-3 text-gray-600 dark:text-gray-300">{g.sourceBenchmark}</td>
                      <td className="py-2 px-3 text-gray-700 dark:text-gray-300">{g.actionOnFail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {blueprint.escrowAndReceiptFlow.length > 0 && (
          <div className="p-3.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
            <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">
              {tr('Luồng ký quỹ & đối soát biên bản', 'Escrow & Receipt Sync Flow')}
            </h4>
            <ol className="list-decimal pl-5 space-y-1 text-xs text-gray-700 dark:text-gray-300">
              {blueprint.escrowAndReceiptFlow.map((step, idx) => (
                <li key={idx}>{step}</li>
              ))}
            </ol>
          </div>
        )}

        {blueprint.risks.length > 0 && (
          <div className="flex flex-col gap-2">
            <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400">
              {tr('Rủi ro & Biện pháp giảm thiểu', 'Risks & Mitigations')}
            </h4>
            <div className="space-y-2">
              {blueprint.risks.map((r, idx) => (
                <div key={idx} className="p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs">
                  <div className="font-semibold text-gray-900 dark:text-gray-100">{r.risk}</div>
                  <div className="text-gray-500 dark:text-gray-400 mt-0.5">
                    {tr('Bằng chứng', 'Evidence')}: {r.evidence}
                  </div>
                  <div className="text-gray-700 dark:text-gray-300 mt-1">
                    {tr('Giảm thiểu', 'Mitigation')}: {r.mitigation}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderError = (errorMessage: string) => (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 px-1">
        <span className="text-base font-bold text-red-700 dark:text-red-300">
          {tr('Tạo kết quả thất bại', 'Generation Failed')}
        </span>
      </div>
      <div className="prose prose-base dark:prose-invert max-w-none p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-900/50">
        {errorMessage.split('\n').map((paragraph, index) => (
          <p key={index} className="text-red-700 dark:text-red-300">
            {paragraph}
          </p>
        ))}
      </div>
    </div>
  );

  if (requiresApiKey) {
    const title = mode === 'image' ? tr('Tạo hình ảnh', 'Image Generation') : tr('Tạo Video', 'Video Generation');
    const modelName = mode === 'image' ? 'Nano Banana 2 / Nano Banana Pro' : 'Gemini Omni Flash';
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg p-4 h-full border border-gray-200 dark:border-gray-700 flex flex-col relative overflow-hidden">
        <div className="flex justify-between items-center mb-4 border-b border-gray-100 dark:border-gray-700 pb-2 flex-shrink-0">
          <h2 className="text-lg font-semibold text-gray-700 dark:text-gray-200">{title}</h2>
        </div>
        <div className="h-full bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/50 rounded-lg flex flex-col items-center justify-center p-8 text-center">
          <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-2">
            {tr('Cần tài khoản thanh toán', 'Billing Account Required')}
          </h3>
          <p className="text-gray-600 dark:text-gray-300 text-sm max-w-sm mb-6">
            {tr(
              `Việc tạo bằng ${modelName} yêu cầu API Key trả phí từ Google Cloud.`,
              `Generating with ${modelName} requires a paid API Key from Google Cloud.`
            )}
          </p>
          <button
            onClick={onSelectKey}
            className="bg-amber-600 hover:bg-amber-700 text-white font-medium py-2 px-6 rounded-lg transition-colors shadow-md"
          >
            {tr('Chọn API Key', 'Select API Key')}
          </button>
        </div>
      </div>
    );
  }

  const firstImageError = mode === 'image' ? images.find((img) => img.error)?.error : null;
  const displayError = error || firstImageError;

  const panelTitle =
    mode === 'image'
      ? tr('Tạo hình ảnh', 'Image Generation')
      : mode === 'video'
        ? tr('Tạo Video', 'Video Generation')
        : mode === 'game-portal'
          ? tr('Game9K · Cổng Game Studio', 'Game9K · Game Portal Studio')
          : mode === 'crypto-solana'
            ? 'Pump.fun · Solana & USDC/USDT'
            : tr('Sáng tác nội dung', 'Creative Writing');

  return (
    <>
      <div className="bg-white dark:bg-gray-800 rounded-lg p-4 h-full border border-gray-200 dark:border-gray-700 flex flex-col relative overflow-hidden transition-colors duration-200">
        <div className="flex flex-wrap justify-between items-center gap-2 mb-3 border-b border-gray-100 dark:border-gray-700 pb-2.5 flex-shrink-0">
          <h2 className="font-display text-lg font-semibold text-gray-800 dark:text-gray-100 whitespace-nowrap">
            {panelTitle}
          </h2>

          {isIndustryMode && (
            <div className="flex items-center gap-2">
              <div className="flex items-center bg-gray-100 dark:bg-gray-900 p-1 rounded-lg border border-gray-200 dark:border-gray-700">
                <button
                  onClick={() => setIndustrySubView('ops')}
                  className={`px-3 py-1 text-xs font-medium rounded-md whitespace-nowrap shrink-0 transition-colors ${
                    industrySubView === 'ops'
                      ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                      : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                  }`}
                >
                  {tr('Vận hành & Telemetry', 'Ops & Telemetry')}
                </button>
                <button
                  onClick={() => setIndustrySubView('blueprint')}
                  className={`px-3 py-1 text-xs font-medium rounded-md whitespace-nowrap shrink-0 transition-colors ${
                    industrySubView === 'blueprint'
                      ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                      : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                  }`}
                >
                  {tr('Bản thiết kế AI', 'AI Blueprint')}
                </button>
              </div>

              {industrySubView === 'blueprint' && blueprint && blueprint.domain === mode && !isLoading && (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => copyText(formatBlueprintMarkdown(blueprint, tr))}
                    className="px-2 py-1 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded border border-gray-200 dark:border-gray-700 whitespace-nowrap"
                  >
                    {isCopied ? tr('Đã chép', 'Copied') : tr('Chép MD', 'Copy MD')}
                  </button>
                  <button
                    onClick={() => downloadTextFile(JSON.stringify(blueprint, null, 2), `${mode}-blueprint.json`, 'application/json')}
                    className="px-2 py-1 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded border border-gray-200 dark:border-gray-700 whitespace-nowrap"
                  >
                    JSON
                  </button>
                </div>
              )}
            </div>
          )}

          {mode === 'story' && story && !isLoading && (
            <div className="flex gap-2">
              {onApplyToPrompt && (
                <Tooltip content={tr('Dùng làm Prompt', 'Use as Prompt')}>
                  <button
                    onClick={() => setShowApplyConfirmation(true)}
                    className="text-gray-500 hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-400 p-1 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 rounded"
                    aria-label={tr('Dùng làm Prompt', 'Use as Prompt')}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                    </svg>
                  </button>
                </Tooltip>
              )}
              <Tooltip content={isCopied ? tr('Đã sao chép!', 'Copied!') : tr('Sao chép vào khay nhớ', 'Copy to Clipboard')}>
                <button
                  onClick={() => copyText(story)}
                  className={`p-1 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 rounded ${
                    isCopied ? 'text-green-500' : 'text-gray-500 hover:text-blue-600 dark:text-gray-400'
                  }`}
                  aria-label={tr('Sao chép vào khay nhớ', 'Copy to Clipboard')}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </button>
              </Tooltip>
              <Tooltip content={tr('Tải văn bản', 'Download Text')} position="bottom-right">
                <button
                  onClick={() => downloadTextFile(story, 'generated_story.txt')}
                  className="text-gray-500 hover:text-blue-600 dark:text-gray-400 p-1 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 rounded"
                  aria-label={tr('Tải văn bản', 'Download Text')}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                </button>
              </Tooltip>
            </div>
          )}
        </div>

        <div className="flex-grow min-h-0 relative">
          {displayError && !(isIndustryMode && industrySubView === 'ops') ? (
            <div className="h-full overflow-y-auto pr-1 scrollbar-thin">{renderError(displayError)}</div>
          ) : isIndustryMode ? (
            industrySubView === 'ops' ? (
              mode === 'game-portal' ? (
                <GamePortalOpsPanel onApplyToPrompt={onApplySnippetToPrompt} />
              ) : (
                <CryptoSolanaOpsPanel onApplyToPrompt={onApplySnippetToPrompt} />
              )
            ) : (
              <div className="h-full overflow-y-auto pr-1 scrollbar-thin">{renderBlueprintContent()}</div>
            )
          ) : mode === 'image' ? (
            <div className="h-full overflow-y-auto pr-1 scrollbar-thin">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pb-4">{renderImageContent()}</div>
            </div>
          ) : mode === 'video' ? (
            <div className="h-full overflow-y-auto pr-1 scrollbar-thin">{renderVideoContent()}</div>
          ) : (
            <div className="h-full overflow-y-auto pr-1 scrollbar-thin">{renderStoryContent()}</div>
          )}

          {isOutdated &&
            !isLoading &&
            !requiresApiKey &&
            !(isIndustryMode && industrySubView === 'ops') &&
            (images.length > 0 || story || video || (blueprint && blueprint.domain === mode)) && (
              <div className="absolute inset-0 bg-white/60 dark:bg-gray-900/60 backdrop-blur-[2px] flex items-center justify-center z-10 rounded-lg pointer-events-none">
                <div className="bg-white dark:bg-gray-800 px-6 py-4 rounded-xl shadow-lg border border-gray-200 dark:border-gray-600 text-center pointer-events-auto">
                  <h3 className="font-bold text-gray-800 dark:text-gray-100 text-lg">
                    {tr('Kết quả đã cũ', 'Results Outdated')}
                  </h3>
                  <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
                    {tr('Prompt đã thay đổi.', 'Prompt has changed.')}
                  </p>
                </div>
              </div>
            )}
        </div>
      </div>

      {selectedImage && (
        <div
          ref={lightboxRef}
          className="fixed inset-0 z-[2000] bg-black/95 flex flex-col backdrop-blur-sm overflow-y-auto"
          onClick={() => setSelectedImage(null)}
          role="dialog"
          aria-modal="true"
          aria-label={tr('Xem trước ảnh', 'Image Preview')}
          tabIndex={-1}
        >
          <button
            ref={modalCloseButtonRef}
            onClick={() => setSelectedImage(null)}
            className="fixed top-4 right-4 z-[2010] text-white/80 hover:text-white bg-black/40 hover:bg-black/60 rounded-full p-2 transition-all backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-white"
            aria-label={tr('Đóng xem trước', 'Close Preview')}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 sm:h-8 sm:w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          <div className="m-auto w-full max-w-7xl flex flex-col p-4 md:p-8 pointer-events-none">
            <img
              src={selectedImage}
              alt={tr('Xem ảnh đầy đủ', 'Full view')}
              className="w-auto h-auto max-w-full object-contain rounded-lg shadow-2xl pointer-events-auto mx-auto"
              onClick={(e) => e.stopPropagation()}
            />

            <div className="mt-6 flex flex-wrap justify-center gap-4 pointer-events-auto flex-shrink-0 bg-black/20 p-3 rounded-xl backdrop-blur-md border border-white/10 mx-auto" onClick={(e) => e.stopPropagation()}>
              {onUseAsReference && (
                <button
                  onClick={() => {
                    onUseAsReference(selectedImage);
                    setSelectedImage(null);
                  }}
                  className="bg-blue-600 text-white px-5 py-2 rounded-lg font-medium hover:bg-blue-700 transition-colors flex items-center gap-2 shadow-lg text-sm"
                >
                  {tr('Dùng làm ảnh tham chiếu', 'Use as Reference')}
                </button>
              )}
              <a
                href={selectedImage}
                download="generated-image.jpg"
                className="bg-white text-gray-900 px-5 py-2 rounded-lg font-medium hover:bg-gray-100 transition-colors flex items-center gap-2 shadow-lg text-sm"
              >
                {tr('Tải xuống', 'Download')}
              </a>
            </div>
          </div>
        </div>
      )}

      {showApplyConfirmation && (
        <div
          ref={confirmationRef}
          className="fixed inset-0 z-[3000] bg-black/50 flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in"
          onClick={() => setShowApplyConfirmation(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-modal-title"
          tabIndex={-1}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-sm w-full p-6 relative border border-gray-200 dark:border-gray-700"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="confirm-modal-title" className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-2">
              {tr('Thay thế Prompt?', 'Replace Prompt?')}
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-6 leading-relaxed">
              {tr('Thao tác này sẽ thay thế prompt hiện tại bằng nội dung vừa tạo. ', 'This will replace your current prompt with the generated text. ')}
              <span className="font-semibold text-red-500">
                {tr('Không thể hoàn tác thao tác này.', 'This action cannot be undone.')}
              </span>
            </p>
            <div className="flex gap-3 justify-end">
              <button
                ref={confirmationCloseButtonRef}
                onClick={() => setShowApplyConfirmation(false)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                {tr('Hủy', 'Cancel')}
              </button>
              <button
                onClick={handleConfirmApply}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
              >
                {tr('Đồng ý thay thế', 'Yes, Replace')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default OutputDisplay;
