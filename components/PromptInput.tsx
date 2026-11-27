/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Tooltip } from './Tooltip';
import {
  AppMode,
  ImagePart,
  AspectRatio,
  StoryType,
  Proactiveness,
  GamePortalTrack,
  CryptoSolanaTrack,
} from '../types';
import { WrenchIcon } from './icons';
import { useFocusTrap } from '../hooks/useFocusTrap';

const MAX_UPLOAD_DIMENSION = 1024;

function downscaleImageDataUrl(rawDataUrl: string, fallbackMime: string): Promise<ImagePart | null> {
  return new Promise((resolve) => {
    const fallbackExtract = (): ImagePart | null => {
      const parts = rawDataUrl.split(',');
      if (parts.length < 2 || !parts[1]) return null;
      return {
        inlineData: {
          data: parts[1],
          mimeType: fallbackMime || 'image/jpeg',
        },
      };
    };

    const img = new Image();
    img.onload = () => {
      try {
        const srcW = img.naturalWidth || img.width || 1;
        const srcH = img.naturalHeight || img.height || 1;
        const scale = Math.min(1, MAX_UPLOAD_DIMENSION / Math.max(srcW, srcH));
        const dstW = Math.max(1, Math.round(srcW * scale));
        const dstH = Math.max(1, Math.round(srcH * scale));
        const canvas = document.createElement('canvas');
        canvas.width = dstW;
        canvas.height = dstH;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(fallbackExtract());
          return;
        }
        ctx.drawImage(img, 0, 0, dstW, dstH);
        const compressed = canvas.toDataURL('image/jpeg', 0.85);
        const base64 = compressed.split(',')[1];
        if (!base64) {
          resolve(fallbackExtract());
          return;
        }
        resolve({
          inlineData: {
            data: base64,
            mimeType: 'image/jpeg',
          },
        });
      } catch {
        resolve(fallbackExtract());
      }
    };
    img.onerror = () => resolve(fallbackExtract());
    img.src = rawDataUrl;
  });
}

const SUPPORTED_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/heic',
  'image/heif',
];

const GAME_PORTAL_PRESETS = [
  {
    label: 'Game9K Phase 1 (Playtest + Receipt Gate)',
    text: 'Thiết kế mô hình Game9K Giai đoạn 1 lấy PlaytestCloud B2B làm lõi kiếm tiền, dùng hạ tầng HTML5 không cần cài đặt chuẩn Poki, bộ chỉ số Voodoo Gate (crash rate <= 1.5%, completion >= 68%, D1 retention >= 32%) và cổng biên bản USDC/USDT Escrow đối soát tự động 100% để loại bỏ lỗi Delayed Delivery.',
  },
  {
    label: 'Phase 2 Web Shop & Tournament Escrow',
    text: 'Mở rộng Game9K sang Giai đoạn 2: phân phối game vượt Gate từ Giai đoạn 1 kèm Web Shop LiveOps (Battle Pass $15-$25, gói 12,000 Cyber Gems $99.99) và Giải đấu Pro League Qualifier USDC Escrow $249 cho thị trường TP.HCM, Los Angeles, Tokyo, Seoul.',
  },
];

const CRYPTO_SOLANA_PRESETS = [
  {
    label: 'Pump.fun Bonding Curve + Creator Split',
    text: 'Thiết kế cơ chế phát hành token trên Pump.fun (Solana SPL) với Bonding Curve 85 SOL trước khi graduate sang Raydium, chia Creator Fee & Protocol Treasury cho hệ sinh thái Game9K kèm cơ chế chống sybil.',
  },
  {
    label: 'Solana USDC/USDT Escrow Rail',
    text: 'Thiết kế kiến trúc thanh toán và ký quỹ PDA Escrow bằng USDC-SPL và USDT-SPL trên Solana (<400ms finality, phí ~$0.00025, 0% gateway fee) tích hợp Receipt Gate xác thực hành động chơi thử để triệt tiêu lệch đồng bộ đơn hàng.',
  },
];

interface PromptInputProps {
  prompt: string;
  setPrompt: (prompt: string) => void;
  onSubmit: () => void;
  onAnalyze: () => void;
  isLoading: boolean;
  isGenerating: boolean;
  isAnalyzing?: boolean;
  isFirstRun: boolean;
  mode: AppMode;
  setMode: (mode: AppMode) => void;
  uploadedImages: ImagePart[];
  setUploadedImages: (imgs: ImagePart[]) => void;
  pendingAttributeUpdates?: Record<string, string>;
  pendingRelationshipUpdates?: Record<string, string>;
  aspectRatio: AspectRatio;
  setAspectRatio: (ratio: AspectRatio) => void;
  resolution: string;
  setResolution: (res: string) => void;
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  selectedClarificationModel: string;
  setSelectedClarificationModel: (model: string) => void;
  storyType: StoryType;
  setStoryType: (type: StoryType) => void;
  proactiveness: Proactiveness;
  setProactiveness: (proactiveness: Proactiveness) => void;
  gamePortalTrack: GamePortalTrack;
  setGamePortalTrack: (track: GamePortalTrack) => void;
  cryptoSolanaTrack: CryptoSolanaTrack;
  setCryptoSolanaTrack: (track: CryptoSolanaTrack) => void;
}

const PromptInput: React.FC<PromptInputProps> = ({
  prompt,
  setPrompt,
  onSubmit,
  onAnalyze,
  isLoading,
  isGenerating,
  isAnalyzing = false,
  mode,
  setMode,
  uploadedImages,
  setUploadedImages,
  pendingAttributeUpdates = {},
  pendingRelationshipUpdates = {},
  aspectRatio,
  setAspectRatio,
  resolution,
  setResolution,
  selectedModel,
  setSelectedModel,
  selectedClarificationModel,
  setSelectedClarificationModel,
  storyType,
  setStoryType,
  proactiveness,
  setProactiveness,
  gamePortalTrack,
  setGamePortalTrack,
  cryptoSolanaTrack,
  setCryptoSolanaTrack,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isInfoModalOpen, setIsInfoModalOpen] = useState(false);
  const [showDisclaimerModal, setShowDisclaimerModal] = useState(false);
  const [hasAcceptedDisclaimer, setHasAcceptedDisclaimer] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);

  const infoModalRef = useFocusTrap(isInfoModalOpen);
  const disclaimerModalRef = useFocusTrap(showDisclaimerModal);

  const handleUploadClick = () => {
    if (!hasAcceptedDisclaimer) {
      setShowDisclaimerModal(true);
    } else {
      fileInputRef.current?.click();
    }
  };

  const handleAcceptDisclaimer = () => {
    setHasAcceptedDisclaimer(true);
    setShowDisclaimerModal(false);
    setTimeout(() => {
      fileInputRef.current?.click();
    }, 0);
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(event.target as Node)) {
        setShowSettings(false);
      }
    };
    if (showSettings) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showSettings]);

  const getModelOptions = () => {
    switch (mode) {
      case 'image':
        return [
          { value: 'gemini-2.5-flash-image', label: 'Nano Banana' },
          { value: 'gemini-3.1-flash-image-preview', label: 'Nano Banana 2' },
          { value: 'gemini-3-pro-image-preview', label: 'Nano Banana Pro' },
          { value: 'imagen-4.0-generate-001', label: 'Imagen 4' },
        ];
      case 'video':
        return [{ value: 'gemini-omni-1.2-flash', label: 'Gemini Omni Flash' }];
      case 'game-portal':
      case 'crypto-solana':
      case 'story':
      default:
        return [
          { value: 'gemini-3-flash-preview', label: 'Gemini 3 Flash' },
          { value: 'gemini-3.1-flash-lite-preview', label: 'Flash Lite' },
          { value: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro' },
        ];
    }
  };

  const getResolutionOptions = () => {
    if (mode === 'video') return ['720p', '1080p'];
    if (mode === 'image') return ['512px', '1K', '2K', '4K'];
    return [];
  };

  const showResolutionSelector = mode === 'video' || mode === 'image';
  const isIndustryMode = mode === 'game-portal' || mode === 'crypto-solana';

  const hasUpdates =
    Object.keys(pendingAttributeUpdates).length > 0 ||
    Object.keys(pendingRelationshipUpdates).length > 0;

  const generateLabel = isIndustryMode ? 'Generate Blueprint' : 'Generate';
  const generateTooltipText =
    mode === 'game-portal'
      ? `Generate Game9K Blueprint & Tiers${hasUpdates ? ' with updates' : ''}`
      : mode === 'crypto-solana'
        ? `Generate Pump.fun / Solana / USDT-USDC Blueprint${hasUpdates ? ' with updates' : ''}`
        : `Generate ${mode === 'story' ? 'a story' : mode === 'video' ? 'a video' : 'images'} based on your prompt${hasUpdates ? ' and updates' : ''}`;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const selectedFiles = Array.from(files).filter((file: File) => {
        if (!SUPPORTED_MIME_TYPES.includes(file.type)) {
          console.warn(`Skipping unsupported image type: ${file.type}`);
          return false;
        }
        return true;
      });
      e.target.value = '';
      if (selectedFiles.length === 0) return;

      void Promise.all(
        selectedFiles.map(
          (file: File) =>
            new Promise<ImagePart | null>((resolve) => {
              const reader = new FileReader();
              reader.onloadend = () => {
                if (typeof reader.result !== 'string') {
                  resolve(null);
                  return;
                }
                void downscaleImageDataUrl(reader.result, file.type).then(resolve);
              };
              reader.onerror = () => resolve(null);
              reader.readAsDataURL(file);
            })
        )
      ).then((results) => {
        const valid = results.filter((img): img is ImagePart => img !== null);
        if (valid.length > 0) {
          setUploadedImages([...uploadedImages, ...valid]);
        }
      });
    }
  };

  const removeImage = (index: number) => {
    setUploadedImages(uploadedImages.filter((_, i) => i !== index));
  };

  return (
    <div className="bg-white dark:bg-gray-800 flex flex-col transition-colors duration-200">
      {/* Header with Title and Mode Selection */}
      <div className="px-3 sm:px-4 py-2 bg-transparent flex flex-wrap justify-between items-center gap-2 relative z-[60]">
        <div className="flex items-center gap-2">
          <h2 className="font-display text-base sm:text-lg font-semibold text-gray-800 dark:text-gray-200 tracking-tight whitespace-nowrap shrink-0">
            Prompt Studio
          </h2>

          {/* Settings Button & Popover */}
          <div className="relative" ref={settingsRef}>
            <Tooltip content="Configure generation settings">
              <button
                onClick={() => setShowSettings(!showSettings)}
                className={`flex items-center justify-center p-1.5 rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  showSettings
                    ? 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100'
                    : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
                aria-label="Model Settings"
              >
                <WrenchIcon className="h-4 w-4" />
              </button>
            </Tooltip>

            {showSettings && (
              <div className="absolute top-full left-0 mt-2 w-52 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 p-3 flex flex-col gap-3 animate-fade-in z-[100]">
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">Model</span>
                  <select
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-xs text-gray-700 dark:text-gray-200 focus:ring-1 focus:ring-blue-500 focus:outline-none"
                  >
                    {getModelOptions().map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col gap-1">
                  <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">Clarification Model</span>
                  <select
                    value={selectedClarificationModel}
                    onChange={(e) => setSelectedClarificationModel(e.target.value)}
                    className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-xs text-gray-700 dark:text-gray-200 focus:ring-1 focus:ring-blue-500 focus:outline-none"
                  >
                    <option value="gemini-3.1-flash-lite-preview">Lite (Fastest)</option>
                    <option value="gemini-3-flash-preview">Flash (Balanced)</option>
                    <option value="gemini-3.1-pro-preview">Pro (Deepest)</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1">
                  <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">AI Proactiveness</span>
                  <select
                    value={proactiveness}
                    onChange={(e) => setProactiveness(e.target.value as Proactiveness)}
                    className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-xs text-gray-700 dark:text-gray-200 focus:ring-1 focus:ring-blue-500 focus:outline-none"
                  >
                    <option value="low">Low (Strict to prompt)</option>
                    <option value="medium">Medium (Balanced)</option>
                    <option value="high">High (Creative liberty)</option>
                  </select>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 min-w-0 max-w-full">
          {/* Mode Selector - scrollable on tight screens, single-line */}
          <div className="flex items-center bg-gray-100 dark:bg-gray-700/60 p-1 rounded-lg overflow-x-auto no-scrollbar gap-1 border border-gray-200/80 dark:border-gray-700">
            <button
              onClick={() => setMode('image')}
              className={`flex items-center px-2.5 py-1.5 rounded-md transition-colors text-xs font-medium whitespace-nowrap shrink-0 gap-1 ${
                mode === 'image'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              Image
            </button>

            <button
              onClick={() => setMode('story')}
              className={`flex items-center px-2.5 py-1.5 rounded-md transition-colors text-xs font-medium whitespace-nowrap shrink-0 gap-1 ${
                mode === 'story'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              Story
            </button>

            <button
              onClick={() => setMode('video')}
              className={`flex items-center px-2.5 py-1.5 rounded-md transition-colors text-xs font-medium whitespace-nowrap shrink-0 gap-1 ${
                mode === 'video'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              Video
            </button>

            <button
              onClick={() => setMode('game-portal')}
              className={`flex items-center px-2.5 py-1.5 rounded-md transition-colors text-xs font-medium whitespace-nowrap shrink-0 gap-1 ${
                mode === 'game-portal'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              Game Portal
            </button>

            <button
              onClick={() => setMode('crypto-solana')}
              className={`flex items-center px-2.5 py-1.5 rounded-md transition-colors text-xs font-medium whitespace-nowrap shrink-0 gap-1 ${
                mode === 'crypto-solana'
                  ? 'bg-slate-900 dark:bg-indigo-600 text-white shadow-sm'
                  : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              Crypto · Solana
            </button>
          </div>

          <Tooltip content="How to use" position="bottom-right">
            <button
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors flex items-center justify-center p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 shrink-0"
              onClick={() => setIsInfoModalOpen(true)}
              aria-label="Info about modes and refining"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-3a1 1 0 00-.867.5 1 1 0 11-1.731-1A3 3 0 0113 8a3.001 3.001 0 01-2 2.83V11a1 1 0 11-2 0v-1a1 1 0 011-1 1 1 0 100-2zm0 8a1 1 0 100-2 1 1 0 000 2z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Industry Preset Strip when in Game Portal or Crypto Solana mode */}
      {isIndustryMode && (
        <div className="px-3 pb-1 flex items-center gap-2 overflow-x-auto no-scrollbar">
          <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap shrink-0">
            Presets:
          </span>
          {(mode === 'game-portal' ? GAME_PORTAL_PRESETS : CRYPTO_SOLANA_PRESETS).map((preset) => (
            <button
              key={preset.label}
              type="button"
              disabled={isLoading}
              onClick={() => setPrompt(preset.text)}
              className="text-[11px] font-medium px-2.5 py-1 rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/60 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 whitespace-nowrap shrink-0 transition-colors disabled:opacity-50"
            >
              {preset.label}
            </button>
          ))}
        </div>
      )}

      <div className="p-2 md:px-3 md:py-1.5 flex flex-col gap-2">
        <div className="w-full relative rounded-lg flex flex-col p-[1px] bg-gray-300 dark:bg-gray-600">
          <div className="w-full h-full bg-white dark:bg-gray-800 rounded-[7px] flex flex-col">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={
                mode === 'game-portal'
                  ? 'Describe your Game9K Playtest B2B, Poki SDK, Voodoo Gate, or USDC/USDT Receipt flow...'
                  : mode === 'crypto-solana'
                    ? 'Describe your Pump.fun bonding curve, Solana SPL program, or USDC/USDT Escrow flow...'
                    : 'Describe your vision here...'
              }
              className={`w-full h-[94px] md:h-[115px] bg-transparent p-2.5 md:p-3 text-gray-800 dark:text-gray-100 focus:outline-none resize-none text-[13px] leading-relaxed transition-all disabled:opacity-50 disabled:pointer-events-none ${
                isLoading ? 'opacity-50 pointer-events-none' : ''
              }`}
              disabled={isLoading}
            />

            <div className="flex flex-col w-full">
              {uploadedImages.length > 0 && (
                <div className="flex gap-1.5 items-center flex-wrap px-2 pb-2">
                  {uploadedImages.map((img, idx) => (
                    <div key={idx} className={`relative group ${isLoading ? 'opacity-50' : ''}`}>
                      <img
                        src={`data:${img.inlineData.mimeType};base64,${img.inlineData.data}`}
                        alt={`Ref ${idx}`}
                        className="h-8 w-8 md:h-10 md:w-10 object-cover rounded border border-gray-300 dark:border-gray-600 shadow-sm"
                      />
                      <Tooltip content="Remove image" position="bottom-left" className="absolute -top-1.5 -right-1.5">
                        <button
                          onClick={() => removeImage(idx)}
                          disabled={isLoading}
                          className="bg-red-500 text-white rounded-full h-3.5 w-3.5 flex items-center justify-center text-[8px] shadow-sm hover:bg-red-600 transition-colors disabled:opacity-50 disabled:pointer-events-none"
                        >
                          &times;
                        </button>
                      </Tooltip>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex flex-row flex-wrap items-center justify-between p-1.5 md:p-2 pt-0 gap-2 w-full">
                <div className="flex gap-1.5 items-center shrink min-w-0 flex-wrap">
                  {showResolutionSelector && (
                    <div className="flex items-center gap-1.5 h-8 md:h-9 bg-gray-100/70 dark:bg-gray-900/50 rounded-lg p-1 border border-gray-200 dark:border-gray-700">
                      <Tooltip content="Aspect ratio" position="top-left">
                        <select
                          value={aspectRatio}
                          onChange={(e) => setAspectRatio(e.target.value as AspectRatio)}
                          className="h-full bg-transparent text-xs text-gray-600 dark:text-gray-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded cursor-pointer px-1"
                          disabled={isLoading}
                        >
                          <option className="bg-white dark:bg-gray-800" value="16:9">16:9</option>
                          {mode === 'image' && <option className="bg-white dark:bg-gray-800" value="1:1">1:1</option>}
                          <option className="bg-white dark:bg-gray-800" value="9:16">9:16</option>
                          {mode === 'image' && (
                            <>
                              <option className="bg-white dark:bg-gray-800" value="4:3">4:3</option>
                              <option className="bg-white dark:bg-gray-800" value="3:4">3:4</option>
                              {selectedModel === 'gemini-3.1-flash-image-preview' && (
                                <>
                                  <option className="bg-white dark:bg-gray-800" value="1:4">1:4</option>
                                  <option className="bg-white dark:bg-gray-800" value="1:8">1:8</option>
                                  <option className="bg-white dark:bg-gray-800" value="4:1">4:1</option>
                                  <option className="bg-white dark:bg-gray-800" value="8:1">8:1</option>
                                </>
                              )}
                            </>
                          )}
                        </select>
                      </Tooltip>
                      <div className="w-px h-4 bg-gray-300 dark:bg-gray-600"></div>
                      <Tooltip content="Resolution" position="top">
                        <select
                          value={resolution}
                          onChange={(e) => setResolution(e.target.value)}
                          className="h-full bg-transparent text-xs text-gray-600 dark:text-gray-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded cursor-pointer px-1"
                          disabled={isLoading}
                        >
                          {getResolutionOptions().map((res) => (
                            <option className="bg-white dark:bg-gray-800" key={res} value={res}>
                              {res}
                            </option>
                          ))}
                        </select>
                      </Tooltip>
                    </div>
                  )}

                  {mode === 'story' && (
                    <div className="flex items-center h-8 md:h-9 bg-gray-100 dark:bg-gray-900/60 rounded-lg p-1 border border-gray-200 dark:border-gray-700">
                      <button
                        onClick={() => setStoryType('generic')}
                        disabled={isLoading}
                        className={`h-full text-xs px-3 rounded-md transition-colors font-medium whitespace-nowrap ${
                          storyType === 'generic'
                            ? 'bg-white dark:bg-gray-700 shadow-sm text-blue-600 dark:text-blue-400'
                            : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                        }`}
                      >
                        Generic
                      </button>
                      <button
                        onClick={() => setStoryType('video-prompt')}
                        disabled={isLoading}
                        className={`h-full text-xs px-3 rounded-md transition-colors font-medium whitespace-nowrap ${
                          storyType === 'video-prompt'
                            ? 'bg-white dark:bg-gray-700 shadow-sm text-blue-600 dark:text-blue-400'
                            : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                        }`}
                      >
                        Video
                      </button>
                    </div>
                  )}

                  {mode === 'game-portal' && (
                    <div className="flex items-center h-8 md:h-9 bg-gray-100 dark:bg-gray-900/60 rounded-lg p-1 border border-gray-200 dark:border-gray-700">
                      {(
                        [
                          { id: 'playtest-b2b', label: 'Playtest B2B' },
                          { id: 'gate-pricing', label: 'Gate & Tiers' },
                          { id: 'distribution-liveops', label: 'Phase 2 LiveOps' },
                        ] as const
                      ).map((t) => (
                        <button
                          key={t.id}
                          onClick={() => setGamePortalTrack(t.id)}
                          disabled={isLoading}
                          className={`h-full text-xs px-2.5 rounded-md transition-colors font-medium whitespace-nowrap shrink-0 ${
                            gamePortalTrack === t.id
                              ? 'bg-white dark:bg-gray-700 shadow-sm text-emerald-700 dark:text-emerald-400'
                              : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                          }`}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                  )}

                  {mode === 'crypto-solana' && (
                    <div className="flex items-center h-8 md:h-9 bg-gray-100 dark:bg-gray-900/60 rounded-lg p-1 border border-gray-200 dark:border-gray-700">
                      {(
                        [
                          { id: 'pumpfun-launch', label: 'Pump.fun' },
                          { id: 'solana-escrow', label: 'Solana Escrow' },
                          { id: 'usdt-usdc-rails', label: 'USDT / USDC' },
                        ] as const
                      ).map((t) => (
                        <button
                          key={t.id}
                          onClick={() => setCryptoSolanaTrack(t.id)}
                          disabled={isLoading}
                          className={`h-full text-xs px-2.5 rounded-md transition-colors font-medium whitespace-nowrap shrink-0 ${
                            cryptoSolanaTrack === t.id
                              ? 'bg-white dark:bg-gray-700 shadow-sm text-indigo-700 dark:text-indigo-400'
                              : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                          }`}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                  )}

                  {!isIndustryMode && (
                    <Tooltip content="Upload reference images" position="bottom-left" className="h-8 md:h-9">
                      <button
                        onClick={handleUploadClick}
                        disabled={isLoading}
                        className="h-8 w-8 md:h-9 md:w-9 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 rounded-lg text-gray-600 dark:text-gray-300 transition-all border border-gray-200 dark:border-gray-700 disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center shadow-sm"
                        aria-label="Upload reference images"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                          />
                        </svg>
                      </button>
                    </Tooltip>
                  )}
                </div>

                <div className="flex shrink-0 h-8 md:h-9 gap-1.5 justify-end ml-auto">
                  <Tooltip
                    content="Refine your prompt through guided questions and an editable belief graph."
                    className="h-full"
                    position="bottom-left"
                    contentClassName="w-full"
                  >
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        onAnalyze();
                      }}
                      disabled={isLoading || (!prompt && uploadedImages.length === 0)}
                      className={`
                        h-full px-3 md:px-4 rounded-lg flex items-center justify-center gap-1.5 transition-all shadow-sm
                        text-xs md:text-sm font-medium whitespace-nowrap shrink-0 disabled:pointer-events-none focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500
                        ${
                          isLoading || (!prompt && uploadedImages.length === 0)
                            ? 'bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed'
                            : isAnalyzing
                              ? 'bg-blue-600/90 text-white cursor-wait'
                              : 'bg-blue-600 hover:bg-blue-700 text-white'
                        }
                      `}
                    >
                      {isAnalyzing && (
                        <svg className="animate-spin w-4 h-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                      )}
                      <span>Refine prompt</span>
                    </button>
                  </Tooltip>

                  <Tooltip content={generateTooltipText} position="top-right" className="h-full" contentClassName="w-max max-w-[180px]">
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        onSubmit();
                      }}
                      disabled={isLoading || (!prompt && uploadedImages.length === 0)}
                      className={`
                        h-full px-3 md:px-5 rounded-lg flex items-center justify-center gap-1.5 transition-all shadow-sm
                        text-xs md:text-sm font-medium whitespace-nowrap shrink-0 border disabled:pointer-events-none
                        ${
                          isLoading || (!prompt && uploadedImages.length === 0)
                            ? 'bg-gray-50 dark:bg-gray-800 text-gray-400 dark:text-gray-600 border-gray-200 dark:border-gray-700 cursor-not-allowed'
                            : 'bg-blue-50 hover:bg-blue-100 text-blue-900 dark:bg-blue-900/50 dark:hover:bg-blue-800/70 dark:text-blue-100 border-blue-200 dark:border-blue-800'
                        }
                      `}
                    >
                      {isGenerating && (
                        <svg className="animate-spin h-4 w-4 text-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                      )}
                      <span>{generateLabel}</span>
                    </button>
                  </Tooltip>
                </div>
              </div>
            </div>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              className="hidden"
              multiple
              accept="image/png,image/jpeg,image/webp,image/heic,image/heif"
            />
          </div>
        </div>
      </div>

      {/* Info Modal */}
      {isInfoModalOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-[3000] bg-black/50 flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in"
            onClick={() => setIsInfoModalOpen(false)}
          >
            <div
              ref={infoModalRef}
              role="dialog"
              aria-modal="true"
              tabIndex={-1}
              className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-sm overflow-hidden flex flex-col outline-none"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between p-4 border-b border-gray-100 dark:border-gray-700">
                <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100">How to use</h3>
                <button
                  onClick={() => setIsInfoModalOpen(false)}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
                  aria-label="Close modal"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="p-4 text-sm text-gray-600 dark:text-gray-300 space-y-3">
                <p>
                  <strong>1. Choose Domain Mode:</strong> Switch between Image, Story, Video, <strong>Game Portal (Game9K)</strong>, and <strong>Crypto · Solana (Pump.fun & USDC/USDT)</strong>.
                </p>
                <p>
                  <strong>2. Refine Prompt:</strong> Click "Refine prompt" to map entities into an editable Belief Graph and answer targeted clarifying questions.
                </p>
                <p>
                  <strong>3. Generate & Simulate:</strong> Generate structured blueprints alongside interactive Game9K 2026 ledger, Voodoo gate, and Solana USDC/USDT escrow simulators.
                </p>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* Disclaimer Modal */}
      {showDisclaimerModal &&
        createPortal(
          <div
            className="fixed inset-0 z-[3000] bg-black/50 flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in"
            onClick={() => setShowDisclaimerModal(false)}
          >
            <div
              ref={disclaimerModalRef}
              role="dialog"
              aria-modal="true"
              tabIndex={-1}
              className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md overflow-hidden flex flex-col outline-none"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between p-4 border-b border-gray-100 dark:border-gray-700">
                <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100">Upload Reference Image</h3>
                <button
                  onClick={() => setShowDisclaimerModal(false)}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
                  aria-label="Close modal"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="p-4 text-sm text-gray-600 dark:text-gray-300 space-y-4">
                <p>
                  By using this feature, you confirm that you have the necessary rights to any content that you upload. Do not generate content that infringes on others’ intellectual property or privacy rights.
                </p>
              </div>
              <div className="p-4 border-t border-gray-100 dark:border-gray-700 flex justify-end gap-3 bg-gray-50 dark:bg-gray-800/50">
                <button
                  onClick={() => setShowDisclaimerModal(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAcceptDisclaimer}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors shadow-sm"
                >
                  I Confirm
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};

export default PromptInput;
