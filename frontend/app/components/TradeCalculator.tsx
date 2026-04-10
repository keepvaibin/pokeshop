"use client";

import { useState } from 'react';
import { Calculator, Plus, Trash2, ChevronDown, ChevronUp } from 'lucide-react';

const CONDITION_OPTIONS = [
  { value: 'near_mint', label: 'NM', multiplier: 1.0 },
  { value: 'lightly_played', label: 'LP', multiplier: 0.85 },
  { value: 'moderately_played', label: 'MP', multiplier: 0.70 },
  { value: 'heavily_played', label: 'HP', multiplier: 0.50 },
  { value: 'damaged', label: 'DMG', multiplier: 0.30 },
];

interface CalcCard {
  name: string;
  basePrice: number;
  condition: string;
}

export default function TradeCalculator({ creditPercentage = 85 }: { creditPercentage?: number }) {
  const [cards, setCards] = useState<CalcCard[]>([]);
  const [salePrice, setSalePrice] = useState<number>(0);
  const [isOpen, setIsOpen] = useState(false);

  const addCard = () => setCards(prev => [...prev, { name: '', basePrice: 0, condition: 'near_mint' }]);
  const removeCard = (idx: number) => setCards(prev => prev.filter((_, i) => i !== idx));
  const updateCard = (idx: number, field: keyof CalcCard, value: string | number) => {
    setCards(prev => prev.map((c, i) => i === idx ? { ...c, [field]: value } : c));
  };

  const getMultiplier = (condition: string) => CONDITION_OPTIONS.find(o => o.value === condition)?.multiplier ?? 1.0;

  const rawTotal = cards.reduce((sum, c) => {
    const mult = getMultiplier(c.condition);
    return sum + (c.basePrice * mult);
  }, 0);
  const effectiveCredit = rawTotal * (creditPercentage / 100);
  const cashDue = Math.max(0, salePrice - effectiveCredit);
  const overage = Math.max(0, effectiveCredit - salePrice);

  return (
    <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl shadow-sm overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-50 dark:hover:bg-zinc-800 transition-colors"
      >
        <span className="flex items-center gap-2 font-semibold text-gray-900 dark:text-zinc-100 text-sm">
          <Calculator size={16} className="text-blue-600" /> Quick Trade Calculator
        </span>
        {isOpen ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
      </button>

      {isOpen && (
        <div className="px-4 pb-4 border-t border-gray-100 space-y-3">
          <div className="pt-3">
            <label className="block text-xs font-semibold text-gray-500 mb-1">Sale Price ($)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={salePrice || ''}
              onChange={(e) => setSalePrice(parseFloat(e.target.value) || 0)}
              placeholder="0.00"
              className="w-full p-2 border border-gray-200 dark:border-zinc-700 rounded-lg text-sm text-gray-900 dark:text-zinc-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {cards.map((card, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <input
                type="text"
                value={card.name}
                onChange={(e) => updateCard(idx, 'name', e.target.value)}
                placeholder="Card name"
                className="flex-1 p-2 border border-gray-200 dark:border-zinc-700 rounded-lg text-sm text-gray-900 dark:text-zinc-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <div className="relative">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">$</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={card.basePrice || ''}
                  onChange={(e) => updateCard(idx, 'basePrice', parseFloat(e.target.value) || 0)}
                  placeholder="NM price"
                  className="w-24 pl-5 pr-2 py-2 border border-gray-200 dark:border-zinc-700 rounded-lg text-sm text-gray-900 dark:text-zinc-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <select
                value={card.condition}
                onChange={(e) => updateCard(idx, 'condition', e.target.value)}
                className="w-16 p-2 border border-gray-200 dark:border-zinc-700 rounded-lg text-xs text-gray-900 dark:text-zinc-100 focus:ring-2 focus:ring-blue-500"
              >
                {CONDITION_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <span className="text-xs text-gray-500 w-14 text-right">
                ${(card.basePrice * getMultiplier(card.condition)).toFixed(2)}
              </span>
              <button onClick={() => removeCard(idx)} className="p-1 text-red-400 hover:text-red-600">
                <Trash2 size={14} />
              </button>
            </div>
          ))}

          <button
            onClick={addCard}
            className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium"
          >
            <Plus size={14} /> Add Card
          </button>

          {cards.length > 0 && (
            <div className="bg-gray-50 dark:bg-zinc-900 rounded-lg p-3 space-y-1 text-sm">
              <div className="flex justify-between text-gray-600">
                <span>Condition-adjusted total:</span>
                <span>${rawTotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-green-700">
                <span>Trade credit ({creditPercentage}%):</span>
                <span className="font-semibold">${effectiveCredit.toFixed(2)}</span>
              </div>
              {salePrice > 0 && (
                <>
                  <div className="flex justify-between border-t border-gray-200 dark:border-zinc-700 pt-1 text-gray-800 font-semibold">
                    <span>Cash due:</span>
                    <span className={cashDue > 0 ? 'text-orange-600' : 'text-green-600'}>${cashDue.toFixed(2)}</span>
                  </div>
                  {overage > 0 && (
                    <div className="flex justify-between text-amber-600 text-xs">
                      <span>Shop owes customer:</span>
                      <span>${overage.toFixed(2)}</span>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
