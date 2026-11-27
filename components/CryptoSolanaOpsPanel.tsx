/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { useLanguage } from '../contexts/LanguageContext';

interface CryptoSolanaOpsPanelProps {
  onApplyToPrompt?: (snippet: string) => void;
}

type EscrowStep = 'Locked' | 'ReceiptVerified' | 'Released';

interface EscrowTicket {
  id: string;
  labelVi: string;
  labelEn: string;
  mint: 'USDC-SPL' | 'USDT-SPL';
  amount: number;
  pdaAddress: string;
  state: EscrowStep;
}

const INITIAL_ESCROWS: EscrowTicket[] = [
  { id: 'ESC-SOL-249', labelVi: 'Quỹ giải thưởng Vòng loại Pro League', labelEn: 'Pro League Qualifier Prize Pool', mint: 'USDC-SPL', amount: 249.00, pdaAddress: '7xKq...9vPm', state: 'Released' },
  { id: 'ESC-SOL-9022', labelVi: 'Lô Playtest TP.HCM + Đồng bộ Relic', labelEn: 'TP.HCM Playtest Batch + Relic Sync', mint: 'USDT-SPL', amount: 115.00, pdaAddress: '4mTr...3wQz', state: 'ReceiptVerified' },
  { id: 'ESC-SOL-100', labelVi: 'Gói 12,000 Cyber Gems Web Shop', labelEn: '12,000 Cyber Gems Web Shop', mint: 'USDC-SPL', amount: 99.99, pdaAddress: '9pLz...1kXn', state: 'Locked' },
];

const CryptoSolanaOpsPanel: React.FC<CryptoSolanaOpsPanelProps> = ({ onApplyToPrompt }) => {
  const { language, tr } = useLanguage();
  const [subTab, setSubTab] = useState<'curve' | 'escrow'>('curve');

  // Pump.fun Bonding Curve Parameters
  const [solRaised, setSolRaised] = useState<number>(42);
  const graduationSol = 85; // Standard Pump.fun ~85 SOL bonding curve cap
  const [solPriceUsd, setSolPriceUsd] = useState<number>(195);
  const [creatorFeeBps, setCreatorFeeBps] = useState<number>(50); // 0.50%
  const [protocolFeeBps, setProtocolFeeBps] = useState<number>(50); // 0.50%

  // Escrow State Machine
  const [escrows, setEscrows] = useState<EscrowTicket[]>(INITIAL_ESCROWS);
  const [settlementAmount, setSettlementAmount] = useState<number>(249);

  const curveStats = useMemo(() => {
    const progressPct = Math.min(100, (solRaised / graduationSol) * 100);
    const marketCapUsd = (30 + solRaised) * solPriceUsd * 1.15;
    const totalVolumeUsd = solRaised * solPriceUsd * 3.2;
    const creatorYieldUsd = (totalVolumeUsd * creatorFeeBps) / 10_000;
    const protocolYieldUsd = (totalVolumeUsd * protocolFeeBps) / 10_000;
    const isGraduated = solRaised >= graduationSol;
    return { progressPct, marketCapUsd, totalVolumeUsd, creatorYieldUsd, protocolYieldUsd, isGraduated };
  }, [solRaised, solPriceUsd, creatorFeeBps, protocolFeeBps]);

  const railComparison = useMemo(() => {
    const solanaFee = 0.00025;
    const cardFee = settlementAmount * 0.029 + 0.30;
    const saved = Math.max(0, cardFee - solanaFee);
    return { solanaFee, cardFee, saved };
  }, [settlementAmount]);

  const advanceEscrow = (id: string) => {
    setEscrows((prev) =>
      prev.map((e) => {
        if (e.id !== id) return e;
        if (e.state === 'Locked') return { ...e, state: 'ReceiptVerified' };
        if (e.state === 'ReceiptVerified') return { ...e, state: 'Released' };
        return e;
      })
    );
  };

  const handlePushToPrompt = () => {
    if (!onApplyToPrompt) return;
    const snippet =
      language === 'vi'
        ? `Thiết kế hệ thống Pump.fun Bonding Curve + Solana SPL USDC/USDT Escrow cho Game9K: Bonding Curve hiện đạt ${solRaised}/${graduationSol} SOL (${curveStats.progressPct.toFixed(1)}%, MCap ~$${Math.round(curveStats.marketCapUsd).toLocaleString()}, fee ${(creatorFeeBps + protocolFeeBps) / 100}% chia Creator/Protocol trước khi graduate sang Raydium/PumpSwap). Kênh thanh toán USDC-SPL và USDT-SPL trên Solana đạt finality ~400ms với phí ~$0.00025 (tiết kiệm $${railComparison.saved.toFixed(2)} so với thẻ cho giao dịch $${settlementAmount}), kết hợp Anchor PDA Escrow khóa giải ngân theo Proof-of-Play Receipt Hash để triệt tiêu 100% rủi ro Delayed Delivery.`
        : `Design a Pump.fun Bonding Curve + Solana SPL USDC/USDT Escrow system for Game9K: Bonding Curve at ${solRaised}/${graduationSol} SOL (${curveStats.progressPct.toFixed(1)}%, Est. MCap ~$${Math.round(curveStats.marketCapUsd).toLocaleString()}, ${(creatorFeeBps + protocolFeeBps) / 100}% total fee split Creator/Protocol before graduating to Raydium/PumpSwap). Native USDC-SPL and USDT-SPL rails on Solana achieve ~400ms finality at ~$0.00025 fee (saving $${railComparison.saved.toFixed(2)} vs Fiat Card on a $${settlementAmount} ticket), paired with Anchor PDA Escrow gated by Proof-of-Play Receipt Hash to eliminate Delayed Delivery risk.`;
    onApplyToPrompt(snippet);
  };

  const formatEscrowState = (state: EscrowStep) => {
    if (state === 'Released') return tr('Đã giải ngân', 'Released');
    if (state === 'ReceiptVerified') return tr('Đã khớp biên bản', 'ReceiptVerified');
    return tr('Đang khóa', 'Locked');
  };

  return (
    <div className="flex flex-col h-full min-h-0 gap-4 overflow-y-auto pr-1 scrollbar-thin">
      {/* Top KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 shrink-0">
        <div className="p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50/70 dark:bg-gray-900/40">
          <div className="text-xs text-gray-500 dark:text-gray-400">{tr('Tốc độ & Phí Solana', 'Solana Finality & Fee')}</div>
          <div className="text-lg font-bold font-mono tabular-nums text-gray-900 dark:text-gray-100 mt-0.5">
            ~400ms · $0.00025
          </div>
          <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
            {tr('Kênh gốc SPL USDC & USDT', 'SPL USDC & USDT native rails')}
          </div>
        </div>

        <div className="p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50/70 dark:bg-gray-900/40">
          <div className="text-xs text-gray-500 dark:text-gray-400">{tr('Tiến độ Graduate Pump.fun', 'Pump.fun Graduation')}</div>
          <div className="text-lg font-bold font-mono tabular-nums text-blue-600 dark:text-blue-400 mt-0.5">
            {curveStats.progressPct.toFixed(1)}%
          </div>
          <div className="text-[11px] text-gray-500 dark:text-gray-400 font-mono tabular-nums mt-0.5">
            {solRaised} / {graduationSol} SOL · {curveStats.isGraduated ? tr('Đã lên Raydium', 'Raydium Live') : tr('Trên Curve', 'On Curve')}
          </div>
        </div>

        <div className="p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50/70 dark:bg-gray-900/40">
          <div className="text-xs text-gray-500 dark:text-gray-400">{tr('Tiết kiệm phí cổng', 'Gateway Fee Saved')}</div>
          <div className="text-lg font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-400 mt-0.5">
            ${railComparison.saved.toFixed(2)} / tx
          </div>
          <div className="text-[11px] text-gray-500 dark:text-gray-400 font-mono tabular-nums mt-0.5">
            {tr(`Đơn $${settlementAmount} USDC so với Thẻ`, `On $${settlementAmount} USDC vs Fiat Card`)}
          </div>
        </div>

        <div className="p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50/70 dark:bg-gray-900/40">
          <div className="text-xs text-gray-500 dark:text-gray-400">{tr('Bất biến Escrow', 'Escrow Invariant')}</div>
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 mt-1">
            {tr('PDA Khóa theo Biên bản', 'PDA Receipt-Gated')}
          </div>
          <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
            {tr('Khóa → Xác thực Proof → Giải ngân', 'Lock → Proof Verify → Release')}
          </div>
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 dark:border-gray-700 pb-2 shrink-0">
        <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-900 p-1 rounded-lg">
          <button
            onClick={() => setSubTab('curve')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 transition-colors ${
              subTab === 'curve'
                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
            }`}
          >
            {tr('Đường cong Pump.fun', 'Pump.fun Bonding Curve')}
          </button>
          <button
            onClick={() => setSubTab('escrow')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 transition-colors ${
              subTab === 'escrow'
                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
            }`}
          >
            {tr('Ký quỹ PDA USDC / USDT', 'USDC / USDT PDA Escrow')}
          </button>
        </div>

        {onApplyToPrompt && (
          <button
            onClick={handlePushToPrompt}
            className="px-3 py-1.5 text-xs font-medium text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50 border border-blue-200 dark:border-blue-800 rounded-md whitespace-nowrap shrink-0 transition-colors"
          >
            {tr('Đẩy thông số vào Prompt', 'Apply Spec to Prompt')}
          </button>
        )}
      </div>

      {subTab === 'curve' && (
        <div className="flex flex-col gap-4">
          <div className="p-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{tr('Mô phỏng Pump.fun Bonding Curve trên Solana', 'Solana Pump.fun Bonding Curve Simulator')}</h4>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{tr('Mô phỏng tích lũy thanh khoản SOL, chia phí Creator/Protocol và ngưỡng lên Raydium / PumpSwap.', 'Model SOL liquidity accumulation, creator fee split, and Raydium / PumpSwap graduation.')}</p>
              </div>
              <span className={`text-xs font-semibold px-2.5 py-1 rounded border ${curveStats.isGraduated ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800' : 'bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800'}`}>
                {curveStats.isGraduated ? tr('Đã Graduate lên DEX LP', 'Graduated to DEX LP') : tr('Bonding Curve đang chạy', 'Bonding Curve Active')}
              </span>
            </div>

            {/* Progress Bar */}
            <div className="w-full h-3 bg-gray-100 dark:bg-gray-900 rounded-full overflow-hidden border border-gray-200 dark:border-gray-700">
              <div
                className={`h-full transition-all duration-200 ${curveStats.isGraduated ? 'bg-emerald-600' : 'bg-blue-600'}`}
                style={{ width: `${curveStats.progressPct}%` }}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <label className="flex flex-col gap-1">
                <span className="font-medium text-gray-700 dark:text-gray-300">{tr('Dự trữ SOL trên Curve:', 'Curve SOL Reserve:')} <span className="font-mono tabular-nums">{solRaised} / {graduationSol} SOL</span></span>
                <input type="range" min={1} max={85} step={1} value={solRaised} onChange={(e) => setSolRaised(Number(e.target.value))} className="accent-blue-600" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-medium text-gray-700 dark:text-gray-300">{tr('Giá tham chiếu SOL:', 'SOL Reference Price:')} <span className="font-mono tabular-nums">${solPriceUsd}</span></span>
                <input type="range" min={80} max={350} step={5} value={solPriceUsd} onChange={(e) => setSolPriceUsd(Number(e.target.value))} className="accent-blue-600" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-medium text-gray-700 dark:text-gray-300">{tr('Phí chia Creator:', 'Creator Fee Share:')} <span className="font-mono tabular-nums">{(creatorFeeBps / 100).toFixed(2)}%</span></span>
                <input type="range" min={10} max={150} step={5} value={creatorFeeBps} onChange={(e) => setCreatorFeeBps(Number(e.target.value))} className="accent-blue-600" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-medium text-gray-700 dark:text-gray-300">{tr('Phí kho bạc Protocol:', 'Protocol Treasury Fee:')} <span className="font-mono tabular-nums">{(protocolFeeBps / 100).toFixed(2)}%</span></span>
                <input type="range" min={10} max={150} step={5} value={protocolFeeBps} onChange={(e) => setProtocolFeeBps(Number(e.target.value))} className="accent-blue-600" />
              </label>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-gray-200 dark:border-gray-700 text-xs">
              <div>
                <div className="text-gray-500 dark:text-gray-400">{tr('Vốn hóa ước tính', 'Est. Market Cap')}</div>
                <div className="text-sm font-bold font-mono tabular-nums text-gray-900 dark:text-gray-100">${Math.round(curveStats.marketCapUsd).toLocaleString()}</div>
              </div>
              <div>
                <div className="text-gray-500 dark:text-gray-400">{tr('Khối lượng Curve', 'Est. Curve Volume')}</div>
                <div className="text-sm font-bold font-mono tabular-nums text-gray-900 dark:text-gray-100">${Math.round(curveStats.totalVolumeUsd).toLocaleString()}</div>
              </div>
              <div>
                <div className="text-gray-500 dark:text-gray-400">{tr('Kho bạc Creator (USDC)', 'Creator Treasury (USDC)')}</div>
                <div className="text-sm font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-400">${curveStats.creatorYieldUsd.toFixed(2)}</div>
              </div>
              <div>
                <div className="text-gray-500 dark:text-gray-400">{tr('Doanh thu Protocol', 'Protocol Revenue')}</div>
                <div className="text-sm font-bold font-mono tabular-nums text-blue-600 dark:text-blue-400">${curveStats.protocolYieldUsd.toFixed(2)}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {subTab === 'escrow' && (
        <div className="flex flex-col gap-4">
          {/* Fee Comparison Calculator */}
          <div className="p-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50/70 dark:bg-gray-900/40 flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-gray-900 dark:text-gray-100">{tr('So sánh chi phí USDC-SPL / USDT-SPL với Thẻ Fiat', 'USDC-SPL / USDT-SPL vs Fiat Card Cost Comparison')}</span>
              <span className="text-xs font-mono tabular-nums text-gray-600 dark:text-gray-300">{tr('Giá trị đơn:', 'Ticket:')} ${settlementAmount.toFixed(2)}</span>
            </div>
            <input type="range" min={15} max={1000} step={5} value={settlementAmount} onChange={(e) => setSettlementAmount(Number(e.target.value))} className="accent-blue-600" />
            <div className="grid grid-cols-3 gap-3 text-xs pt-1">
              <div>
                <div className="text-gray-500 dark:text-gray-400">{tr('Kênh Solana SPL', 'Solana SPL Rail')}</div>
                <div className="font-mono tabular-nums font-bold text-emerald-700 dark:text-emerald-400">${railComparison.solanaFee.toFixed(5)} · &lt;1s</div>
              </div>
              <div>
                <div className="text-gray-500 dark:text-gray-400">{tr('Thẻ tín dụng (2.9%+$0.30)', 'Credit Card (2.9%+$0.30)')}</div>
                <div className="font-mono tabular-nums font-bold text-amber-600 dark:text-amber-400">${railComparison.cardFee.toFixed(2)} · T+2</div>
              </div>
              <div>
                <div className="text-gray-500 dark:text-gray-400">{tr('Tiết kiệm ròng', 'Net Savings')}</div>
                <div className="font-mono tabular-nums font-bold text-gray-900 dark:text-gray-100">${railComparison.saved.toFixed(2)}</div>
              </div>
            </div>
          </div>

          {/* Escrow PDA State Machine Table */}
          <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-900/60 border-b border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400">
                  <th className="py-2 px-3 font-medium">{tr('Mã Escrow', 'Escrow ID')}</th>
                  <th className="py-2 px-3 font-medium">{tr('Mục đích · PDA', 'Purpose · PDA')}</th>
                  <th className="py-2 px-3 font-medium">{tr('Tài sản', 'Asset')}</th>
                  <th className="py-2 px-3 font-medium text-right">{tr('Số tiền', 'Amount')}</th>
                  <th className="py-2 px-3 font-medium">{tr('Trạng thái', 'State')}</th>
                  <th className="py-2 px-3 font-medium text-right">{tr('Chuyển trạng thái', 'Transition')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700/70">
                {escrows.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50/80 dark:hover:bg-gray-700/30">
                    <td className="py-2 px-3 font-mono tabular-nums text-gray-900 dark:text-gray-100 whitespace-nowrap">{item.id}</td>
                    <td className="py-2 px-3">
                      <div className="font-medium text-gray-800 dark:text-gray-200">{language === 'vi' ? item.labelVi : item.labelEn}</div>
                      <div className="font-mono text-[11px] text-gray-500 dark:text-gray-400">PDA: {item.pdaAddress}</div>
                    </td>
                    <td className="py-2 px-3 font-mono text-gray-700 dark:text-gray-300 whitespace-nowrap">{item.mint}</td>
                    <td className="py-2 px-3 font-mono tabular-nums text-right font-semibold text-gray-900 dark:text-gray-100 whitespace-nowrap">
                      ${item.amount.toFixed(2)}
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap">
                      <span className={`font-medium ${item.state === 'Released' ? 'text-emerald-700 dark:text-emerald-400' : item.state === 'ReceiptVerified' ? 'text-blue-600 dark:text-blue-400' : 'text-amber-600 dark:text-amber-400'}`}>
                        {formatEscrowState(item.state)}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right whitespace-nowrap">
                      {item.state !== 'Released' ? (
                        <button
                          onClick={() => advanceEscrow(item.id)}
                          className="px-2.5 py-1 text-[11px] font-medium bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
                        >
                          {item.state === 'Locked' ? tr('Xác thực biên bản', 'Verify Receipt') : tr('Giải ngân', 'Release Funds')}
                        </button>
                      ) : (
                        <span className="text-[11px] text-gray-400 dark:text-gray-500">{tr('Hoàn tất', 'Finalized')}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default CryptoSolanaOpsPanel;
