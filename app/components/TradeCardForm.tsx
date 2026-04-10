"use client";

import { useState } from 'react';
import imageCompression from 'browser-image-compression';
import { Plus, Trash2, Star, ChevronDown, ChevronUp, RefreshCw, Search as SearchIcon, Edit3, Camera, X, Loader2 } from 'lucide-react';
import WantedCardsModal from './WantedCardsModal';
import TCGCardSearch, { type TCGCard } from './TCGCardSearch';

export interface TradeCard {
  card_name: string;
  estimated_value: number;
  condition: string;
  rarity: string;
  is_wanted_card: boolean;
  tcg_product_id?: number | null;
  tcg_sub_type?: string;
  base_market_price?: number | null;
  custom_price?: number | null;
  photo?: File | null;
}

interface TradeCardFormProps {
  cards: TradeCard[];
  onChange: (cards: TradeCard[]) => void;
  creditPercentage: number;
  maxCards: number;
}

const CONDITION_OPTIONS = [
  { value: 'near_mint', label: 'Near Mint', multiplier: 1.0 },
  { value: 'lightly_played', label: 'Lightly Played', multiplier: 0.85 },
  { value: 'moderately_played', label: 'Moderately Played', multiplier: 0.70 },
  { value: 'heavily_played', label: 'Heavily Played', multiplier: 0.50 },
  { value: 'damaged', label: 'Damaged', multiplier: 0.30 },
];


export default function TradeCardForm({ cards, onChange, creditPercentage, maxCards }: TradeCardFormProps) {
  const [showWantedModal, setShowWantedModal] = useState(false);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [manualMode, setManualMode] = useState<Record<number, boolean>>({});
  const [compressingIdx, setCompressingIdx] = useState<number | null>(null);

  function getConditionMultiplier(condition: string): number {
    return CONDITION_OPTIONS.find(o => o.value === condition)?.multiplier ?? 0.85;
  }

  const addCard = (card?: Partial<TradeCard>) => {
    if (cards.length >= maxCards) return;
    const newCard: TradeCard = {
      card_name: card?.card_name ?? '',
      estimated_value: card?.estimated_value ?? 0,
      condition: card?.condition ?? 'near_mint',
      rarity: card?.rarity ?? '',
      is_wanted_card: card?.is_wanted_card ?? false,
      tcg_product_id: card?.tcg_product_id ?? null,
      tcg_sub_type: card?.tcg_sub_type ?? '',
      base_market_price: card?.base_market_price ?? null,
      custom_price: card?.custom_price ?? null,
    };
    onChange([...cards, newCard]);
    setExpandedIdx(cards.length);
  };

  const updateCard = (idx: number, field: keyof TradeCard, value: string | number | boolean | File | null) => {
    const updated = cards.map((c, i) => (i === idx ? { ...c, [field]: value } : c));
    // If base_market_price & condition available, auto-compute estimated_value
    if ((field === 'condition' || field === 'base_market_price') && updated[idx].base_market_price) {
      const base = updated[idx].base_market_price!;
      const mult = getConditionMultiplier(updated[idx].condition);
      updated[idx].estimated_value = parseFloat((base * mult).toFixed(2));
    }
    onChange(updated);
  };

  const handleTCGSelect = (idx: number, card: TCGCard) => {
    const mp = parseFloat(card.market_price);
    const condition = cards[idx].condition || 'near_mint';
    const mult = getConditionMultiplier(condition);
    const conditionAdjusted = parseFloat((mp * mult).toFixed(2));
    const updated = cards.map((c, i) => i === idx ? {
      ...c,
      card_name: card.clean_name,
      tcg_product_id: card.product_id,
      tcg_sub_type: card.sub_type_name,
      base_market_price: mp,
      estimated_value: conditionAdjusted,
      rarity: card.rarity || '',
    } : c);
    onChange(updated);
    setManualMode(prev => ({ ...prev, [idx]: false }));
  };

  const removeCard = (idx: number) => {
    onChange(cards.filter((_, i) => i !== idx));
    if (expandedIdx === idx) setExpandedIdx(null);
  };

  const rawTotal = cards.reduce((sum, c) => sum + (Number(c.estimated_value) || 0), 0);
  const effectiveCredit = rawTotal * (creditPercentage / 100);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-blue-900 flex items-center gap-2"><RefreshCw size={16} /> Trade-In Cards</h3>
        <p className="text-xs text-blue-700">{creditPercentage}% credit rate</p>
      </div>

      {/* Cards list */}
      {cards.map((card, idx) => {
        const isManual = manualMode[idx] || false;
        const hasOracle = !!card.tcg_product_id && !!card.base_market_price;
        const condMult = getConditionMultiplier(card.condition);
        const conditionAdjusted = card.base_market_price ? parseFloat((card.base_market_price * condMult).toFixed(2)) : null;
        const cardCredit = (Number(card.estimated_value) || 0) * creditPercentage / 100;

        return (
        <div key={idx} className={`border rounded-xl overflow-hidden transition-all ${card.is_wanted_card ? 'border-yellow-300 dark:border-yellow-600/50 bg-yellow-50/50 dark:bg-yellow-900/10' : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900'}`}>
          {/* Collapsed header */}
          <div
            className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-zinc-800/50"
            onClick={() => setExpandedIdx(expandedIdx === idx ? null : idx)}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-900 dark:text-gray-100 truncate text-sm">
                  {card.card_name || `Card #${idx + 1}`}
                </span>
                {card.is_wanted_card && (
                  <span className="bg-yellow-100 text-yellow-700 text-[10px] font-bold px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                    <Star size={10} /> WANTED
                  </span>
                )}
                {hasOracle && (
                  <span className="bg-green-100 text-green-700 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                    TCG VERIFIED
                  </span>
                )}
              </div>
              {card.estimated_value > 0 && (
                <p className="text-xs text-gray-500">
                  ${Number(card.estimated_value).toFixed(2)} &rarr; credit: ${cardCredit.toFixed(2)}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); removeCard(idx); }}
              className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
            >
              <Trash2 size={14} />
            </button>
            {expandedIdx === idx ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
          </div>

          {/* Expanded details */}
          {expandedIdx === idx && (
            <div className="px-4 pb-4 space-y-3 border-t border-gray-100">
              <div className="pt-3">
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-gray-600">Card Name *</label>
                  <button
                    type="button"
                    onClick={() => setManualMode(prev => ({ ...prev, [idx]: !isManual }))}
                    className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                  >
                    {isManual ? <><SearchIcon size={10} /> Search TCG DB</> : <><Edit3 size={10} /> Manual Entry</>}
                  </button>
                </div>
                {isManual ? (
                  <input
                    type="text"
                    value={card.card_name}
                    onChange={(e) => updateCard(idx, 'card_name', e.target.value)}
                    placeholder="e.g., Charizard VMAX"
                    className="w-full p-2.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                ) : (
                  <TCGCardSearch
                    onSelect={(c) => handleTCGSelect(idx, c)}
                    initialValue={card.card_name}
                  />
                )}
              </div>

              {/* Oracle price math */}
              {hasOracle && conditionAdjusted !== null && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-xs space-y-1">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Base Market Price (NM):</span>
                    <span className="font-semibold text-gray-900 dark:text-gray-100">${card.base_market_price!.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Condition ({CONDITION_OPTIONS.find(o => o.value === card.condition)?.label}): &times;{condMult}</span>
                    <span className="font-semibold text-gray-900 dark:text-gray-100">${conditionAdjusted.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between border-t border-green-200 pt-1">
                    <span className="text-green-800 font-bold">Trade Credit ({creditPercentage}%):</span>
                    <span className="font-bold text-green-800">${cardCredit.toFixed(2)}</span>
                  </div>
                </div>
              )}

              {/* Custom user pricing — optional override */}
              {hasOracle && (
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Your offer price ($) <span className="font-normal text-gray-400">— optional</span></label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={card.custom_price ?? ''}
                    onChange={(e) => updateCard(idx, 'custom_price', e.target.value ? parseFloat(e.target.value) : null)}
                    placeholder={conditionAdjusted?.toFixed(2) ?? '0.00'}
                    className="w-full p-2.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <p className="text-[10px] text-gray-400 mt-0.5">Leave blank to accept the oracle-derived price above</p>
                </div>
              )}

              {/* Manual estimated value for non-oracle cards */}
              {!hasOracle && (
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Estimated Value ($) *</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={card.estimated_value || ''}
                    onChange={(e) => updateCard(idx, 'estimated_value', parseFloat(e.target.value) || 0)}
                    placeholder="0.00"
                    className="w-full p-2.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Condition</label>
                <select
                  value={card.condition}
                  onChange={(e) => updateCard(idx, 'condition', e.target.value)}
                  className="w-full p-2.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  {CONDITION_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>

              {/* Photo upload */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Card Photo (optional)</label>
                {card.photo ? (
                  <div className="relative inline-block">
                    <img
                      src={URL.createObjectURL(card.photo)}
                      alt="Card photo"
                      className="w-20 h-20 object-cover rounded-lg border border-gray-200 dark:border-gray-700"
                    />
                    <button
                      type="button"
                      onClick={() => updateCard(idx, 'photo', null)}
                      className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full p-0.5"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ) : (
                  <label className={`flex items-center gap-2 cursor-pointer rounded-lg border border-dashed border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-950 px-3 py-2 hover:border-blue-400 hover:bg-blue-50 transition-colors w-fit ${compressingIdx === idx ? 'opacity-50 pointer-events-none' : ''}`}>
                    {compressingIdx === idx ? <Loader2 size={16} className="text-blue-600 animate-spin" /> : <Camera size={16} className="text-blue-600" />}
                    <span className="text-xs text-gray-600">{compressingIdx === idx ? 'Compressing...' : 'Upload photo'}</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0] || null;
                        if (!file) return;
                        try {
                          setCompressingIdx(idx);
                          const compressed = await imageCompression(file, {
                            maxSizeMB: 1,
                            maxWidthOrHeight: 1920,
                            useWebWorker: true,
                          });
                          updateCard(idx, 'photo', new File([compressed], file.name, { type: compressed.type }));
                        } catch {
                          updateCard(idx, 'photo', file);
                        } finally {
                          setCompressingIdx(null);
                        }
                      }}
                    />
                  </label>
                )}
              </div>
            </div>
          )}
        </div>
        );
      })}

      {/* Add card buttons */}
      {cards.length < maxCards && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => addCard()}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl text-sm font-medium text-gray-600 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50/50 transition-all"
          >
            <Plus size={16} /> Add Card
          </button>
          <button
            type="button"
            onClick={() => setShowWantedModal(true)}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 border-2 border-dashed border-yellow-300 rounded-xl text-sm font-medium text-yellow-700 hover:border-yellow-400 hover:bg-yellow-50 transition-all"
          >
            <Star size={16} /> Browse Wanted List
          </button>
        </div>
      )}

      {/* Summary */}
      {cards.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-1">
          <div className="flex justify-between text-sm">
            <span className="text-gray-700">Card Value ({cards.length} card{cards.length !== 1 ? 's' : ''}):</span>
            <span className="font-semibold text-gray-900 dark:text-gray-100">${rawTotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-700">Credit Rate:</span>
            <span className="text-gray-600">{creditPercentage}%</span>
          </div>
          <div className="flex justify-between text-sm font-bold border-t border-blue-200 pt-2 mt-2">
            <span className="text-blue-800">Trade Credit:</span>
            <span className="text-blue-700">${effectiveCredit.toFixed(2)}</span>
          </div>
        </div>
      )}

      {showWantedModal && (
        <WantedCardsModal
          open={showWantedModal}
          onClose={() => setShowWantedModal(false)}
          onSelect={(card) => addCard(card)}
        />
      )}
    </div>
  );
}
