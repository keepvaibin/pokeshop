"use client";

import { useState } from 'react';
import axios from 'axios';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRequireAuth } from '../hooks/useRequireAuth';
import Navbar from '../components/Navbar';
import { Plus, Trash2, Package, ArrowLeft } from 'lucide-react';
import toast from 'react-hot-toast';
import { API_BASE_URL as API } from '@/app/lib/api';

const CONDITION_OPTIONS = [
  { value: 'NM', label: 'Near Mint (NM)' },
  { value: 'LP', label: 'Lightly Played (LP)' },
  { value: 'MP', label: 'Moderately Played (MP)' },
  { value: 'HP', label: 'Heavily Played (HP)' },
  { value: 'DMG', label: 'Damaged (DMG)' },
];

interface ItemRow {
  card_name: string;
  set_name: string;
  card_number: string;
  condition: string;
  quantity: number;
  user_estimated_price: string;
}

const blankRow = (): ItemRow => ({
  card_name: '',
  set_name: '',
  card_number: '',
  condition: 'NM',
  quantity: 1,
  user_estimated_price: '0.00',
});

export default function TradeInSubmitPage() {
  const { user } = useRequireAuth();
  const router = useRouter();
  const [submissionMethod, setSubmissionMethod] = useState<'mail_in' | 'in_store_dropoff'>('in_store_dropoff');
  const [customerNotes, setCustomerNotes] = useState('');
  const [rows, setRows] = useState<ItemRow[]>([blankRow()]);
  const [submitting, setSubmitting] = useState(false);

  const total = rows.reduce(
    (sum, r) => sum + (Number(r.user_estimated_price) || 0) * (Number(r.quantity) || 0),
    0,
  );

  function updateRow(idx: number, patch: Partial<ItemRow>) {
    setRows(prev => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows(prev => [...prev, blankRow()]);
  }

  function removeRow(idx: number) {
    setRows(prev => (prev.length === 1 ? prev : prev.filter((_, i) => i !== idx)));
  }

  async function submit() {
    const validRows = rows.filter(r => r.card_name.trim().length > 0);
    if (validRows.length === 0) {
      toast.error('Add at least one card.');
      return;
    }
    setSubmitting(true);
    try {
      const token = localStorage.getItem('access_token');
      const payload = {
        submission_method: submissionMethod,
        customer_notes: customerNotes,
        items: validRows.map(r => ({
          card_name: r.card_name.trim(),
          set_name: r.set_name.trim(),
          card_number: r.card_number.trim(),
          condition: r.condition,
          quantity: Number(r.quantity) || 1,
          user_estimated_price: r.user_estimated_price || '0.00',
        })),
      };
      await axios.post(`${API}/api/trade-ins/`, payload, {
        headers: { Authorization: `Bearer ${token}` },
      });
      toast.success('Trade-in submitted! We’ll DM you on Discord once reviewed.');
      router.push('/trade-in/history');
    } catch (err) {
      const e = err as { response?: { data?: { detail?: string; items?: string[] } } };
      const msg = e.response?.data?.detail || (Array.isArray(e.response?.data?.items) ? e.response?.data?.items?.[0] : null) || 'Failed to submit trade-in.';
      toast.error(typeof msg === 'string' ? msg : 'Failed to submit trade-in.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-pkmn-bg">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-pkmn-blue" />
      </div>
    );
  }

  return (
    <div className="bg-pkmn-bg min-h-screen">
      <Navbar />
      <div className="max-w-4xl mx-auto px-4 py-8">
        <Link
          href="/orders"
          className="flex items-center gap-2 text-sm text-pkmn-gray hover:text-pkmn-text mb-4"
        >
          <ArrowLeft size={16} /> Back to Orders
        </Link>

        <div className="flex items-center gap-3 mb-6">
          <Package className="w-8 h-8 text-pkmn-blue" />
          <div>
            <h1 className="text-3xl font-bold text-pkmn-text">Trade-In Cards for Store Credit</h1>
            <p className="text-pkmn-gray text-sm">
              List the cards you want to trade. We’ll review your submission and offer a payout amount.
              Once we receive your cards, the credit will be added to your wallet automatically.
            </p>
          </div>
        </div>

        {/* Submission method */}
        <div className="bg-white border border-pkmn-border rounded-md p-5 mb-6">
          <h2 className="font-bold text-pkmn-text mb-3">How will you get us the cards?</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {(['in_store_dropoff', 'mail_in'] as const).map(opt => (
              <label
                key={opt}
                className={`flex items-center gap-3 p-3 border rounded-md cursor-pointer transition-colors ${
                  submissionMethod === opt
                    ? 'border-pkmn-blue bg-pkmn-blue/5'
                    : 'border-pkmn-border hover:bg-pkmn-bg'
                }`}
              >
                <input
                  type="radio"
                  name="submission_method"
                  value={opt}
                  checked={submissionMethod === opt}
                  onChange={() => setSubmissionMethod(opt)}
                />
                <span className="font-semibold text-pkmn-text">
                  {opt === 'in_store_dropoff' ? 'In-Store Drop-Off' : 'Mail-In'}
                </span>
              </label>
            ))}
          </div>
        </div>

        {/* Items table */}
        <div className="bg-white border border-pkmn-border rounded-md p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-pkmn-text">Cards</h2>
            <button
              type="button"
              onClick={addRow}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-md bg-pkmn-blue text-white hover:bg-pkmn-blue-dark"
            >
              <Plus size={14} /> Add Card
            </button>
          </div>
          <div className="space-y-2">
            {rows.map((row, idx) => (
              <div
                key={idx}
                className="grid grid-cols-12 gap-2 items-end border-b border-pkmn-border pb-2"
              >
                <div className="col-span-12 sm:col-span-4">
                  <label className="block text-[11px] font-semibold text-pkmn-gray mb-0.5">Card name</label>
                  <input
                    type="text"
                    value={row.card_name}
                    onChange={e => updateRow(idx, { card_name: e.target.value })}
                    placeholder="Charizard"
                    className="w-full px-2 py-1.5 border border-pkmn-border rounded text-sm"
                  />
                </div>
                <div className="col-span-6 sm:col-span-3">
                  <label className="block text-[11px] font-semibold text-pkmn-gray mb-0.5">Set</label>
                  <input
                    type="text"
                    value={row.set_name}
                    onChange={e => updateRow(idx, { set_name: e.target.value })}
                    placeholder="Base Set"
                    className="w-full px-2 py-1.5 border border-pkmn-border rounded text-sm"
                  />
                </div>
                <div className="col-span-6 sm:col-span-1">
                  <label className="block text-[11px] font-semibold text-pkmn-gray mb-0.5">#</label>
                  <input
                    type="text"
                    value={row.card_number}
                    onChange={e => updateRow(idx, { card_number: e.target.value })}
                    placeholder="4/102"
                    className="w-full px-2 py-1.5 border border-pkmn-border rounded text-sm"
                  />
                </div>
                <div className="col-span-4 sm:col-span-2">
                  <label className="block text-[11px] font-semibold text-pkmn-gray mb-0.5">Cond.</label>
                  <select
                    value={row.condition}
                    onChange={e => updateRow(idx, { condition: e.target.value })}
                    className="w-full px-2 py-1.5 border border-pkmn-border rounded text-sm bg-white"
                  >
                    {CONDITION_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.value}</option>
                    ))}
                  </select>
                </div>
                <div className="col-span-3 sm:col-span-1">
                  <label className="block text-[11px] font-semibold text-pkmn-gray mb-0.5">Qty</label>
                  <input
                    type="number"
                    min={1}
                    value={row.quantity}
                    onChange={e => updateRow(idx, { quantity: Math.max(1, Number(e.target.value) || 1) })}
                    className="w-full px-2 py-1.5 border border-pkmn-border rounded text-sm"
                  />
                </div>
                <div className="col-span-4 sm:col-span-1">
                  <label className="block text-[11px] font-semibold text-pkmn-gray mb-0.5">$ each</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={row.user_estimated_price}
                    onChange={e => updateRow(idx, { user_estimated_price: e.target.value })}
                    className="w-full px-2 py-1.5 border border-pkmn-border rounded text-sm"
                  />
                </div>
                <div className="col-span-1 flex justify-end">
                  <button
                    type="button"
                    onClick={() => removeRow(idx)}
                    disabled={rows.length === 1}
                    className="p-1.5 text-pkmn-red hover:bg-pkmn-red/10 rounded disabled:opacity-30 disabled:hover:bg-transparent"
                    title="Remove row"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-between items-center mt-4 pt-3 border-t border-pkmn-border">
            <span className="text-sm text-pkmn-gray">Your estimated total</span>
            <span className="text-xl font-bold text-pkmn-text">${total.toFixed(2)}</span>
          </div>
        </div>

        {/* Notes */}
        <div className="bg-white border border-pkmn-border rounded-md p-5 mb-6">
          <h2 className="font-bold text-pkmn-text mb-2">Notes (optional)</h2>
          <textarea
            value={customerNotes}
            onChange={e => setCustomerNotes(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="Any special details about your cards or trade preferences"
            className="w-full px-3 py-2 border border-pkmn-border rounded text-sm"
          />
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="px-6 py-3 text-sm font-bold rounded-md bg-pkmn-blue text-white hover:bg-pkmn-blue-dark disabled:opacity-50"
          >
            {submitting ? 'Submitting…' : 'Submit Trade-In'}
          </button>
        </div>
      </div>
    </div>
  );
}
