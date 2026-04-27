"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import axios from 'axios';
import toast from 'react-hot-toast';
import { ArrowLeft, Check, X, RefreshCw, Wallet } from 'lucide-react';
import Navbar from '../../components/Navbar';
import { useRequireAuth } from '../../hooks/useRequireAuth';
import { API_BASE_URL as API } from '@/app/lib/api';

interface TradeInItem {
  id: number;
  card_name: string;
  set_name: string;
  card_number: string;
  condition: string;
  quantity: number;
  user_estimated_price: string;
  image_url: string;
  tcgplayer_url: string;
  is_accepted: boolean | null;
  admin_override_value: string | null;
  computed_credit: string;
}

interface TradeInRequest {
  id: number;
  status: string;
  estimated_total_value: string;
  final_payout_value: string | null;
  credit_percentage: string;
  pickup_label: string;
  counteroffer_message: string;
  counteroffer_expires_at: string | null;
  customer_notes: string;
  admin_notes: string;
  created_at: string;
  completed_at: string | null;
  items: TradeInItem[];
}

const STATUS_LABELS: Record<string, string> = {
  pending_review: 'Pending Review',
  pending_counteroffer: 'Counteroffer Pending',
  approved_pending_receipt: 'Approved - Awaiting Cards',
  completed: 'Completed',
  rejected: 'Rejected',
};

export default function TradeInDetailPage() {
  const { user } = useRequireAuth();
  const params = useParams<{ id: string }>();
  const [tradeIn, setTradeIn] = useState<TradeInRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [responding, setResponding] = useState(false);

  useEffect(() => {
    if (!user || !params.id) return;
    const token = localStorage.getItem('access_token');
    axios.get(`${API}/api/trade-ins/${params.id}/`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((res) => setTradeIn(res.data))
      .catch(() => toast.error('Failed to load trade-in.'))
      .finally(() => setLoading(false));
  }, [params.id, user]);

  async function respond(response: 'accept' | 'decline') {
    if (!tradeIn) return;
    if (response === 'decline' && !confirm('Decline this counteroffer?')) return;
    setResponding(true);
    try {
      const token = localStorage.getItem('access_token');
      const res = await axios.post(`${API}/api/trade-ins/${tradeIn.id}/respond-counteroffer/`, { response }, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setTradeIn(res.data);
      toast.success(response === 'accept' ? 'Counteroffer accepted.' : 'Counteroffer declined.');
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error || 'Failed to respond.');
    } finally {
      setResponding(false);
    }
  }

  if (!user || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-pkmn-bg">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-pkmn-blue" />
      </div>
    );
  }

  if (!tradeIn) {
    return (
      <div className="min-h-screen bg-pkmn-bg">
        <Navbar />
        <div className="mx-auto max-w-3xl px-4 py-12 text-center text-pkmn-gray">Trade-in not found.</div>
      </div>
    );
  }

  const acceptedItems = tradeIn.items.filter(item => item.is_accepted === true);
  const acceptedValue = acceptedItems.reduce((sum, item) => {
    const unit = Number(item.admin_override_value || item.user_estimated_price || 0);
    return sum + unit * item.quantity;
  }, 0);

  return (
    <div className="min-h-screen bg-pkmn-bg">
      <Navbar />
      <div className="mx-auto max-w-4xl px-4 py-8">
        <Link href="/trade-in/history" className="mb-4 flex items-center gap-2 text-sm text-pkmn-gray hover:text-pkmn-text">
          <ArrowLeft size={16} /> Back to Trade-In History
        </Link>

        <div className="mb-6 rounded-md border border-pkmn-border bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="text-2xl font-heading font-black uppercase text-pkmn-text">Trade-In #{tradeIn.id}</h1>
              <p className="mt-1 text-sm text-pkmn-gray">
                {STATUS_LABELS[tradeIn.status] || tradeIn.status} - submitted {new Date(tradeIn.created_at).toLocaleDateString()}
              </p>
              {tradeIn.pickup_label && (
                <p className="mt-1 text-sm font-semibold text-pkmn-blue-dark">Pickup: {tradeIn.pickup_label}</p>
              )}
            </div>
            <div className="rounded-md border border-pkmn-blue/20 bg-pkmn-blue/10 px-4 py-3 text-sm text-pkmn-blue-dark">
              <Wallet size={15} className="inline mr-1" /> ${tradeIn.final_payout_value || tradeIn.estimated_total_value}
            </div>
          </div>
        </div>

        {tradeIn.status === 'pending_counteroffer' && (
          <div className="mb-6 rounded-md border border-pkmn-yellow/30 bg-pkmn-yellow/10 p-5">
            <h2 className="flex items-center gap-2 text-lg font-bold text-pkmn-text">
              <RefreshCw size={18} /> Counteroffer Ready
            </h2>
            {tradeIn.counteroffer_message && (
              <p className="mt-2 text-sm text-pkmn-yellow-dark">{tradeIn.counteroffer_message}</p>
            )}
            {tradeIn.counteroffer_expires_at && (
              <p className="mt-1 text-xs text-pkmn-yellow-dark">
                Respond by {new Date(tradeIn.counteroffer_expires_at).toLocaleString()}.
              </p>
            )}
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-md border border-pkmn-border bg-white p-4">
                <p className="text-xs font-semibold uppercase text-pkmn-gray">Original Estimate</p>
                <p className="mt-1 text-xl font-bold text-pkmn-gray-dark">${tradeIn.estimated_total_value}</p>
              </div>
              <div className="rounded-md border border-pkmn-yellow/40 bg-white p-4">
                <p className="text-xs font-semibold uppercase text-pkmn-yellow-dark">Counteroffer</p>
                <p className="mt-1 text-2xl font-black text-pkmn-text">${acceptedValue.toFixed(2)}</p>
              </div>
            </div>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={() => respond('accept')}
                disabled={responding}
                className="flex-1 rounded-md bg-green-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-green-700 disabled:opacity-50"
              >
                <Check size={15} className="inline mr-1" /> Accept Counteroffer
              </button>
              <button
                type="button"
                onClick={() => respond('decline')}
                disabled={responding}
                className="flex-1 rounded-md bg-pkmn-red px-4 py-2.5 text-sm font-bold text-white hover:bg-pkmn-red-dark disabled:opacity-50"
              >
                <X size={15} className="inline mr-1" /> Decline
              </button>
            </div>
          </div>
        )}

        <div className="rounded-md border border-pkmn-border bg-white shadow-sm">
          <div className="border-b border-pkmn-border px-5 py-3">
            <h2 className="font-bold text-pkmn-text">Cards</h2>
          </div>
          <div className="divide-y divide-pkmn-border">
            {tradeIn.items.map((item) => {
              const statusLabel = item.is_accepted === true ? 'Accepted' : item.is_accepted === false ? 'Rejected' : 'Pending';
              const unit = Number(item.admin_override_value || item.user_estimated_price || 0);
              return (
                <div key={item.id} className="flex gap-3 px-5 py-4">
                  {item.image_url && (
                    <img src={item.image_url} alt={item.card_name} className="h-16 w-12 rounded border border-pkmn-border object-cover" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-pkmn-text">
                      {item.quantity}x {item.card_name}{item.card_number ? ` #${item.card_number}` : ''}
                    </p>
                    <p className="text-xs text-pkmn-gray">
                      {[item.set_name, item.condition, statusLabel].filter(Boolean).join(' - ')}
                    </p>
                    {item.tcgplayer_url && (
                      <a href={item.tcgplayer_url} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-pkmn-blue hover:underline">
                        TCGPlayer
                      </a>
                    )}
                  </div>
                  <div className="text-right text-sm">
                    <p className="font-bold text-pkmn-text">${(unit * item.quantity).toFixed(2)}</p>
                    {item.admin_override_value && <p className="text-xs text-pkmn-yellow-dark">countered</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {(tradeIn.admin_notes || tradeIn.customer_notes) && (
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {tradeIn.customer_notes && (
              <div className="rounded-md border border-pkmn-border bg-white p-4 text-sm">
                <p className="mb-1 text-xs font-semibold uppercase text-pkmn-gray">Your Notes</p>
                <p className="whitespace-pre-wrap text-pkmn-text">{tradeIn.customer_notes}</p>
              </div>
            )}
            {tradeIn.admin_notes && (
              <div className="rounded-md border border-pkmn-border bg-white p-4 text-sm">
                <p className="mb-1 text-xs font-semibold uppercase text-pkmn-gray">Shop Notes</p>
                <p className="whitespace-pre-wrap text-pkmn-text">{tradeIn.admin_notes}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}