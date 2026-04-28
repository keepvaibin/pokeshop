"use client";

import { useEffect, useState } from 'react';
import axios from 'axios';
import Link from 'next/link';
import { useRequireAuth } from '../../hooks/useRequireAuth';
import Navbar from '../../components/Navbar';
import { ArrowLeft, Wallet, Package, Clock3, BadgeCheck, RefreshCw } from 'lucide-react';
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
}

interface TradeInRequest {
  id: number;
  user_email: string;
  status: string;
  submission_method: string;
  payout_label: string;
  pickup_label: string;
  estimated_total_value: string;
  final_payout_value: string | null;
  customer_notes: string;
  admin_notes: string;
  reviewed_at: string | null;
  completed_at: string | null;
  created_at: string;
  items: TradeInItem[];
}

interface LedgerEntry {
  id: number;
  amount: string;
  transaction_type: string;
  reference_id: string;
  note: string;
  created_at: string;
}

function formatSubmissionMethod(method: string) {
  if (method === 'in_store_dropoff') return 'Campus Drop-Off';
  return method.replace(/_/g, ' ');
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending_review: { label: 'Pending Review', color: 'bg-pkmn-blue/15 text-pkmn-blue' },
  pending_counteroffer: { label: 'Counteroffer', color: 'bg-pkmn-yellow/15 text-pkmn-yellow-dark' },
  approved_pending_receipt: { label: 'Awaiting Cards', color: 'bg-pkmn-yellow/15 text-pkmn-yellow-dark' },
  completed: { label: 'Completed', color: 'bg-green-500/15 text-green-700' },
  rejected: { label: 'Rejected', color: 'bg-pkmn-red/15 text-pkmn-red' },
};

export default function TradeInHistoryPage() {
  const { user } = useRequireAuth();
  const [requests, setRequests] = useState<TradeInRequest[]>([]);
  const [balance, setBalance] = useState('0.00');
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    let cancelled = false;

    const loadTradeHistory = async (silent = false) => {
      if (!silent) {
        setLoading(true);
      }
      const token = localStorage.getItem('access_token');
      const headers = { Authorization: `Bearer ${token}` };
      try {
        const [reqRes, walletRes] = await Promise.all([
          axios.get(`${API}/api/trade-ins/`, { headers }),
          axios.get(`${API}/api/trade-ins/wallet/`, { headers }),
        ]);
        if (cancelled) return;
        setRequests(Array.isArray(reqRes.data) ? reqRes.data : []);
        setBalance(String(walletRes.data?.balance ?? '0.00'));
        setLedger(Array.isArray(walletRes.data?.ledger) ? walletRes.data.ledger : []);
      } catch {
        if (cancelled || silent) return;
        setRequests([]);
        setBalance('0.00');
        setLedger([]);
      } finally {
        if (!cancelled && !silent) {
          setLoading(false);
        }
      }
    };

    const handleFocusRefresh = () => {
      void loadTradeHistory(true);
    };
    const handleVisibilityRefresh = () => {
      if (document.visibilityState === 'visible') {
        void loadTradeHistory(true);
      }
    };

    void loadTradeHistory();
    window.addEventListener('focus', handleFocusRefresh);
    window.addEventListener('pageshow', handleFocusRefresh);
    document.addEventListener('visibilitychange', handleVisibilityRefresh);

    return () => {
      cancelled = true;
      window.removeEventListener('focus', handleFocusRefresh);
      window.removeEventListener('pageshow', handleFocusRefresh);
      document.removeEventListener('visibilitychange', handleVisibilityRefresh);
    };
  }, [user]);

  const pendingCount = requests.filter((request) => request.status === 'pending_review').length;
  const counterofferCount = requests.filter((request) => request.status === 'pending_counteroffer').length;
  const completedCount = requests.filter((request) => request.status === 'completed').length;

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

        <div className="bg-white border-2 border-pkmn-blue/20 bg-pkmn-blue/5 rounded-md p-5 mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Wallet className="w-7 h-7 text-pkmn-blue" />
            <div>
              <p className="text-xs font-semibold text-pkmn-gray uppercase">Store Credit Balance</p>
              <p className="text-2xl font-bold text-pkmn-text">${balance}</p>
            </div>
          </div>
          <Link
            href="/trade-in"
            className="pkc-button-primary no-underline hover:no-underline text-sm"
          >
            Submit Another
          </Link>
        </div>

        <div className="grid gap-3 sm:grid-cols-3 mb-6">
          <div className="rounded-md border border-pkmn-border bg-white p-4 text-sm">
            <p className="text-xs font-semibold uppercase text-pkmn-gray">Pending Review</p>
            <p className="mt-1 text-2xl font-bold text-pkmn-text">{pendingCount}</p>
          </div>
          <div className="rounded-md border border-pkmn-border bg-white p-4 text-sm">
            <p className="text-xs font-semibold uppercase text-pkmn-gray">Counteroffers</p>
            <p className="mt-1 text-2xl font-bold text-pkmn-text">{counterofferCount}</p>
          </div>
          <div className="rounded-md border border-pkmn-border bg-white p-4 text-sm">
            <p className="text-xs font-semibold uppercase text-pkmn-gray">Completed</p>
            <p className="mt-1 text-2xl font-bold text-pkmn-text">{completedCount}</p>
          </div>
        </div>

        <h2 className="text-xl font-bold text-pkmn-text mb-3 flex items-center gap-2">
          <Package size={20} /> Trade-In History
        </h2>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-pkmn-blue" />
          </div>
        ) : requests.length === 0 ? (
          <div className="bg-white border border-dashed border-pkmn-border p-12 text-center text-pkmn-gray">
            You haven&apos;t submitted any trade-ins yet.
          </div>
        ) : (
          <div className="space-y-3">
            {requests.map(req => {
              const sc = STATUS_LABELS[req.status] || { label: req.status, color: 'bg-pkmn-bg text-pkmn-gray' };
              const acceptedCount = req.items.filter((item) => item.is_accepted === true).length;
              const rejectedCount = req.items.filter((item) => item.is_accepted === false).length;
              const thumbnailItems = req.items.filter((item) => item.image_url).slice(0, 3);
              return (
                <div key={req.id} className="bg-white border border-pkmn-border rounded-md overflow-hidden">
                  <div className="px-5 py-3 flex items-center justify-between gap-3 border-b border-pkmn-border">
                    <div className="min-w-0">
                      <p className="font-semibold text-pkmn-text truncate">
                        Trade-In #{req.id} ·{' '}
                        <span className="text-pkmn-gray font-normal">
                          {new Date(req.created_at).toLocaleDateString()}
                        </span>
                      </p>
                      <p className="text-xs text-pkmn-gray truncate" title={`${req.items.length} card${req.items.length === 1 ? '' : 's'} · ${req.pickup_label || formatSubmissionMethod(req.submission_method)}`}>
                        {req.items.length} card{req.items.length === 1 ? '' : 's'} · {req.pickup_label || formatSubmissionMethod(req.submission_method)}
                      </p>
                      <p className="text-xs text-pkmn-gray-dark mt-0.5 truncate" title={req.payout_label || 'Store Credit'}>{req.payout_label || 'Store Credit'}</p>
                    </div>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${sc.color}`}>
                      {sc.label}
                    </span>
                  </div>
                  {thumbnailItems.length > 0 && (
                    <div className="px-5 pt-3 flex items-center gap-2">
                      {thumbnailItems.map((item) => (
                        <img key={item.id} src={item.image_url} alt={item.card_name} className="h-12 w-9 rounded border border-pkmn-border object-cover" />
                      ))}
                    </div>
                  )}
                  <div className="px-5 py-3 grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <p className="text-xs text-pkmn-gray uppercase">Your estimate</p>
                      <p className="font-semibold text-pkmn-text">${req.estimated_total_value}</p>
                    </div>
                    <div>
                      <p className="text-xs text-pkmn-gray uppercase">Final payout</p>
                      <p className="font-semibold text-pkmn-text">
                        {req.final_payout_value ? `$${req.final_payout_value}` : '—'}
                      </p>
                    </div>
                  </div>
                  <div className="px-5 pb-3 flex flex-nowrap overflow-x-auto gap-3 text-xs text-pkmn-gray-dark whitespace-nowrap">
                    <span><Clock3 size={12} className="inline mr-1" />Submitted {new Date(req.created_at).toLocaleDateString()}</span>
                    {(acceptedCount > 0 || rejectedCount > 0) && (
                      <span><BadgeCheck size={12} className="inline mr-1" />{acceptedCount} accepted · {rejectedCount} rejected</span>
                    )}
                    {req.status === 'pending_counteroffer' && <span><RefreshCw size={12} className="inline mr-1" />Action needed</span>}
                  </div>
                  {req.admin_notes && (
                    <div className="px-5 py-2 text-xs text-pkmn-gray border-t border-pkmn-border truncate" title={req.admin_notes}>
                      <span className="font-semibold">Note from shop:</span> {req.admin_notes}
                    </div>
                  )}
                  <div className="px-5 py-3 border-t border-pkmn-border flex flex-wrap gap-2">
                    <Link href={`/trade-details/${req.id}`} className={`${req.status === 'pending_counteroffer' ? 'pkc-button-accent' : 'pkc-button-primary'} inline-flex whitespace-nowrap no-underline hover:no-underline text-xs`}>
                      {req.status === 'pending_counteroffer' ? 'Review Counteroffer' : 'View Details'}
                    </Link>
                  </div>
                  <details className="px-5 py-2 border-t border-pkmn-border text-sm">
                    <summary className="cursor-pointer text-pkmn-blue font-semibold">
                      View {req.items.length} card{req.items.length === 1 ? '' : 's'}
                    </summary>
                    <ul className="mt-2 space-y-1 text-pkmn-gray-dark">
                      {req.items.map(it => (
                        <li key={it.id}>
                          {it.quantity}x {it.card_name}
                          {it.set_name ? ` (${it.set_name})` : ''} — {it.condition} — ${it.user_estimated_price}
                          {it.tcgplayer_url && (
                            <a href={it.tcgplayer_url} target="_blank" rel="noopener noreferrer" className="ml-2 text-pkmn-blue hover:underline">
                              TCGPlayer
                            </a>
                          )}
                        </li>
                      ))}
                    </ul>
                  </details>
                </div>
              );
            })}
          </div>
        )}

        {ledger.length > 0 && (
          <>
            <h2 className="text-xl font-bold text-pkmn-text mt-8 mb-3">Wallet Activity</h2>
            <div className="bg-white border border-pkmn-border rounded-md overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-pkmn-bg border-b border-pkmn-border">
                  <tr>
                    <th className="text-left py-2 px-4 font-semibold text-pkmn-gray">Date</th>
                    <th className="text-left py-2 px-4 font-semibold text-pkmn-gray">Type</th>
                    <th className="text-left py-2 px-4 font-semibold text-pkmn-gray">Note</th>
                    <th className="text-right py-2 px-4 font-semibold text-pkmn-gray">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.map(entry => {
                    const amt = Number(entry.amount);
                    return (
                      <tr key={entry.id} className="border-b border-pkmn-border last:border-b-0">
                        <td className="py-2 px-4 text-pkmn-gray">
                          {new Date(entry.created_at).toLocaleDateString()}
                        </td>
                        <td className="py-2 px-4 capitalize">{entry.transaction_type.replace(/_/g, ' ')}</td>
                        <td className="py-2 px-4 text-pkmn-gray">{entry.note || entry.reference_id}</td>
                        <td className={`py-2 px-4 text-right font-semibold ${amt >= 0 ? 'text-green-700' : 'text-pkmn-red'}`}>
                          {amt >= 0 ? '+' : ''}${amt.toFixed(2)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
