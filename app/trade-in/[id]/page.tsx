"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import axios from 'axios';
import toast from 'react-hot-toast';
import {
  ArrowLeft,
  Calendar,
  Check,
  CheckCircle,
  Clock3,
  CreditCard,
  MessageCircle,
  Package,
  Printer,
  RefreshCw,
  Wallet,
  X,
  XCircle,
} from 'lucide-react';
import Navbar from '../../components/Navbar';
import Spinner from '../../components/Spinner';
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
  base_market_price: string | null;
  tcgplayer_url: string;
  is_accepted: boolean | null;
  admin_override_value: string | null;
  computed_credit: string;
}

interface TradeInRequest {
  id: number;
  user_email?: string;
  discord_handle?: string;
  status: string;
  payout_label: string;
  submission_method: string;
  estimated_total_value: string;
  final_payout_value: string | null;
  credit_percentage: string;
  pickup_label: string;
  counteroffer_message: string;
  counteroffer_expires_at: string | null;
  customer_notes: string;
  admin_notes: string;
  created_at: string;
  reviewed_at: string | null;
  completed_at: string | null;
  updated_at: string;
  items: TradeInItem[];
}

interface TimelineEntry {
  timestamp: string;
  detail: string;
}

const ACTIVE_STATUSES = ['pending_review', 'pending_counteroffer', 'approved_pending_receipt'];

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  pending_review: {
    label: 'Pending Review',
    color: 'bg-white/20 text-white border-white/30',
  },
  pending_counteroffer: {
    label: 'Counteroffer',
    color: 'bg-pkmn-yellow text-pkmn-gray-dark border-pkmn-yellow-dark',
  },
  approved_pending_receipt: {
    label: 'Awaiting Cards',
    color: 'bg-pkmn-blue text-white border-pkmn-blue-dark',
  },
  completed: {
    label: 'Completed',
    color: 'bg-green-400 text-white border-green-500',
  },
  rejected: {
    label: 'Rejected',
    color: 'bg-pkmn-red text-white border-pkmn-red-dark',
  },
};

function formatSubmissionMethod(method: string) {
  if (method === 'in_store_dropoff') {
    return 'Campus Drop-Off';
  }
  return method.replace(/_/g, ' ');
}

function formatTimelineTimestamp(value: string) {
  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getStatusConfig(status: string) {
  return STATUS_CONFIG[status] || {
    label: status.replace(/_/g, ' '),
    color: 'bg-white/20 text-white border-white/30',
  };
}

function buildTimeline(tradeIn: TradeInRequest, displayedOffer: number, totalCopies: number) {
  const entries: TimelineEntry[] = [];
  const entryLabel = `${tradeIn.items.length} entr${tradeIn.items.length === 1 ? 'y' : 'ies'}`;
  const copyLabel = `${totalCopies} total card${totalCopies === 1 ? '' : 's'}`;
  const dropoffLabel = tradeIn.pickup_label || formatSubmissionMethod(tradeIn.submission_method);
  const reviewTimestamp = tradeIn.reviewed_at || tradeIn.updated_at || tradeIn.created_at;
  const hasCounterofferHistory = Boolean((tradeIn.counteroffer_message || '').trim())
    || tradeIn.items.some((item) => item.admin_override_value !== null);

  entries.push({
    timestamp: tradeIn.created_at,
    detail: `Trade-in submitted with ${entryLabel} (${copyLabel}) for ${tradeIn.payout_label || 'Store Credit'}.`,
  });
  entries.push({
    timestamp: tradeIn.created_at,
    detail: `Drop-off selected for ${dropoffLabel}.`,
  });

  if (tradeIn.status === 'pending_review') {
    entries.push({
      timestamp: tradeIn.updated_at || tradeIn.created_at,
      detail: 'Your cards are currently waiting for shop review.',
    });
  }

  if (hasCounterofferHistory) {
    const expiresText = tradeIn.counteroffer_expires_at
      ? ` Respond by ${new Date(tradeIn.counteroffer_expires_at).toLocaleString()}.`
      : '';
    entries.push({
      timestamp: reviewTimestamp,
      detail: `The shop reviewed your cards and sent a counteroffer for $${displayedOffer.toFixed(2)}.${expiresText}`,
    });
  }

  if (tradeIn.status === 'approved_pending_receipt') {
    entries.push({
      timestamp: hasCounterofferHistory ? (tradeIn.updated_at || reviewTimestamp) : reviewTimestamp,
      detail: hasCounterofferHistory
        ? `You accepted the counteroffer. Bring your cards to ${dropoffLabel} to receive $${displayedOffer.toFixed(2)}.`
        : `Your trade-in was approved for $${displayedOffer.toFixed(2)}. Bring your cards to ${dropoffLabel} to finish the payout.`,
    });
  }

  if (tradeIn.status === 'rejected') {
    entries.push({
      timestamp: hasCounterofferHistory ? (tradeIn.updated_at || reviewTimestamp) : reviewTimestamp,
      detail: tradeIn.admin_notes
        ? `The shop closed this trade-in. ${tradeIn.admin_notes}`
        : hasCounterofferHistory
          ? 'The counteroffer was not accepted, so this trade-in is now closed.'
          : 'The shop closed this trade-in after review.',
    });
  }

  if (tradeIn.status === 'completed') {
    if (!hasCounterofferHistory) {
      entries.push({
        timestamp: reviewTimestamp,
        detail: `Your trade-in was approved for $${displayedOffer.toFixed(2)}. Bring your cards to ${dropoffLabel} to finish the payout.`,
      });
    }
    entries.push({
      timestamp: tradeIn.completed_at || tradeIn.updated_at || reviewTimestamp,
      detail: `Trade-in completed. Final payout: $${displayedOffer.toFixed(2)} via ${tradeIn.payout_label || 'Store Credit'}.`,
    });
  }

  return entries;
}

export default function TradeInDetailPage() {
  const { user } = useRequireAuth();
  const params = useParams<{ id: string }>();
  const [tradeIn, setTradeIn] = useState<TradeInRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [responding, setResponding] = useState(false);

  useEffect(() => {
    if (!user || !params.id) {
      return;
    }
    setLoading(true);
    setError('');
    const token = localStorage.getItem('access_token');
    axios.get(`${API}/api/trade-ins/${params.id}/`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((res) => {
      setTradeIn(res.data);
    }).catch(() => {
      setError('Trade-in not found or you do not have permission to view it.');
    }).finally(() => setLoading(false));
  }, [params.id, user]);

  async function respond(response: 'accept' | 'decline') {
    if (!tradeIn) {
      return;
    }
    if (response === 'decline' && !confirm('Decline this counteroffer?')) {
      return;
    }
    setResponding(true);
    try {
      const token = localStorage.getItem('access_token');
      const res = await axios.post(`${API}/api/trade-ins/${tradeIn.id}/respond-counteroffer/`, { response }, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setTradeIn(res.data);
      setError('');
      toast.success(response === 'accept' ? 'Counteroffer accepted.' : 'Counteroffer declined.');
    } catch (err) {
      const axiosError = err as { response?: { data?: { error?: string } } };
      toast.error(axiosError.response?.data?.error || 'Failed to respond.');
    } finally {
      setResponding(false);
    }
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-pkmn-bg">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-pkmn-blue mx-auto mb-4" />
          <p className="text-pkmn-gray">Redirecting to login&hellip;</p>
        </div>
      </div>
    );
  }

  const acceptedItems = tradeIn?.items.filter((item) => item.is_accepted === true) ?? [];
  const rejectedItems = tradeIn?.items.filter((item) => item.is_accepted === false) ?? [];
  const pendingItems = tradeIn?.items.filter((item) => item.is_accepted === null) ?? [];
  const totalCopies = tradeIn?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0;
  const estimatedOffer = Number(tradeIn?.estimated_total_value || 0);
  const reviewedOffer = acceptedItems.reduce((sum, item) => {
    const unit = Number(item.admin_override_value || item.user_estimated_price || 0);
    return sum + unit * item.quantity;
  }, 0);

  let displayedOffer = estimatedOffer;
  if (tradeIn) {
    if (tradeIn.status === 'rejected') {
      displayedOffer = Number(tradeIn.final_payout_value || 0);
    } else if (tradeIn.final_payout_value !== null) {
      displayedOffer = Number(tradeIn.final_payout_value);
    } else if (acceptedItems.length > 0) {
      displayedOffer = reviewedOffer;
    }
  }

  const currentStatus = tradeIn ? getStatusConfig(tradeIn.status) : null;
  const timeline = tradeIn ? buildTimeline(tradeIn, displayedOffer, totalCopies) : [];

  return (
    <div className="bg-pkmn-bg min-h-screen">
      <div className="print:hidden">
        <Navbar />
      </div>
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6 print:hidden">
          <Link href="/trade-in/history" className="flex items-center gap-2 text-sm text-pkmn-gray hover:text-pkmn-text transition-colors">
            <ArrowLeft size={16} /> Back to Trade History
          </Link>
          <button
            type="button"
            onClick={() => window.print()}
            className="flex items-center gap-2 text-sm font-medium text-pkmn-blue hover:text-pkmn-blue-dark transition-colors"
          >
            <Printer size={16} /> Print Receipt
          </button>
        </div>

        {loading ? (
          <Spinner label="Loading trade-in..." />
        ) : error ? (
          <div className="bg-pkmn-red/10 border border-pkmn-red/20 rounded-md p-8 text-center">
            <XCircle className="w-10 h-10 text-red-400 mx-auto mb-3" />
            <p className="text-pkmn-red font-medium">{error}</p>
            <Link href="/trade-in/history" className="text-pkmn-blue hover:underline text-sm mt-2 inline-block">
              View Trade History
            </Link>
          </div>
        ) : tradeIn && currentStatus ? (
          <div className="bg-white border border-pkmn-border rounded-md shadow-sm overflow-hidden print:shadow-none print:border-0">
            <div className="px-8 py-6 text-white print:bg-white print:text-pkmn-text" style={{ background: 'linear-gradient(to right, #0054a6, #003087)' }}>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h1 className="text-2xl font-bold flex items-center gap-2">
                    <Package size={24} />
                    {new Date(tradeIn.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
                  </h1>
                  <p className="text-blue-200 text-xs mt-1 font-mono print:text-pkmn-gray">Trade-In #{tradeIn.id}</p>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-bold border whitespace-nowrap ${currentStatus.color}`}>
                  {currentStatus.label}
                </span>
              </div>
            </div>

            <div className="p-8 space-y-6">
              {tradeIn.status === 'pending_counteroffer' && tradeIn.counteroffer_expires_at && (
                <div className="print:hidden">
                  <div className="inline-flex rounded-xl border border-pkmn-yellow/30 bg-pkmn-yellow/10 px-4 py-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-pkmn-yellow-dark">Response Deadline</p>
                      <p className="mt-1 text-sm font-semibold text-pkmn-text">{new Date(tradeIn.counteroffer_expires_at).toLocaleString()}</p>
                    </div>
                  </div>
                </div>
              )}

              {ACTIVE_STATUSES.includes(tradeIn.status) && (
                <div className="flex items-center gap-4 bg-pkmn-blue/10 border border-pkmn-blue/20 p-4 print:hidden">
                  <MessageCircle size={20} className="text-pkmn-blue flex-shrink-0" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p className="text-sm font-semibold text-pkmn-text">Need help with this trade-in? DM keepvaibin if you have questions.</p>
                    <p className="text-xs text-pkmn-gray mt-0.5">
                      {tradeIn.discord_handle ? `Discord: ${tradeIn.discord_handle}` : 'Status updates will continue to appear on this page.'}
                    </p>
                  </div>
                  <a
                    href="https://discordapp.com/channels/@me/306226303051497473"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ background: '#5865F2', color: '#fff', padding: '8px 20px', borderRadius: '6px', fontSize: '14px', fontWeight: 600, textDecoration: 'none', flexShrink: 0, display: 'inline-block' }}
                  >
                    DM
                  </a>
                </div>
              )}

              {tradeIn.status === 'approved_pending_receipt' && (
                <div className="bg-pkmn-blue/10 border border-pkmn-blue/20 rounded-md p-4 text-sm text-pkmn-blue">
                  <Wallet size={14} className="inline mr-1.5" />
                  Your cards are approved. Bring them to <strong>{tradeIn.pickup_label || formatSubmissionMethod(tradeIn.submission_method)}</strong> to receive <strong>${displayedOffer.toFixed(2)}</strong> via <strong>{tradeIn.payout_label || 'Store Credit'}</strong>.
                </div>
              )}

              {tradeIn.status === 'completed' && (
                <div className="bg-green-500/10 border border-green-500/20 rounded-md p-4 text-sm text-green-700">
                  <CheckCircle size={14} className="inline mr-1.5" />
                  This trade-in is complete. Final payout: <strong>${displayedOffer.toFixed(2)}</strong>{tradeIn.completed_at ? ` on ${new Date(tradeIn.completed_at).toLocaleString()}` : ''}.
                </div>
              )}

              {tradeIn.status === 'rejected' && (
                <div className="bg-pkmn-red/10 border-2 border-pkmn-red rounded-md p-5 print:border-pkmn-red">
                  <div className="flex items-start gap-3">
                    <XCircle size={24} className="text-pkmn-red flex-shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <h2 className="text-base font-bold text-pkmn-red">This trade-in has been closed by the shop</h2>
                      <p className="text-sm text-pkmn-text mt-1">{tradeIn.admin_notes || 'Review the notes below if the shop included more details.'}</p>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex items-start gap-4 bg-pkmn-bg border border-pkmn-border p-4">
                <Calendar size={18} className="text-pkmn-blue flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-pkmn-text">Drop-Off Details</p>
                  <p className="text-sm text-pkmn-gray">{tradeIn.pickup_label || formatSubmissionMethod(tradeIn.submission_method)}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <div>
                  <p className="text-xs font-semibold text-pkmn-gray uppercase">Date</p>
                  <p className="text-pkmn-text font-medium text-sm">
                    {new Date(tradeIn.created_at).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-pkmn-gray uppercase">Customer</p>
                  <p className="text-pkmn-text font-medium text-sm">{tradeIn.user_email || user.email}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-pkmn-gray uppercase">Payout</p>
                  <p className="text-pkmn-text font-medium text-sm">{tradeIn.payout_label || 'Store Credit'}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-pkmn-gray uppercase">Drop-Off</p>
                  <p className="text-pkmn-text font-medium text-sm">{tradeIn.pickup_label || formatSubmissionMethod(tradeIn.submission_method)}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-pkmn-gray uppercase">Cards</p>
                  <p className="text-pkmn-text font-medium text-sm">{tradeIn.items.length} entries / {totalCopies} total</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-pkmn-gray uppercase">Review</p>
                  <p className="text-pkmn-text font-medium text-sm">{acceptedItems.length} accepted / {rejectedItems.length} rejected / {pendingItems.length} pending</p>
                </div>
              </div>

              <div className="border border-pkmn-border rounded-md overflow-hidden">
                <div className="bg-pkmn-bg px-5 py-3 border-b border-pkmn-border">
                  <h3 className="text-sm font-bold text-pkmn-gray-dark">Card Details</h3>
                </div>
                <div className="divide-y divide-gray-100">
                  {tradeIn.items.map((item) => {
                    const statusLabel = item.is_accepted === true ? 'Accepted' : item.is_accepted === false ? 'Rejected' : 'Pending';
                    const unit = Number(item.admin_override_value || item.user_estimated_price || 0);
                    const lineTotal = unit * item.quantity;
                    return (
                      <div key={item.id} className="px-5 py-4 flex items-start justify-between gap-4">
                        <div className="flex items-start gap-3 min-w-0">
                          {item.image_url ? (
                            <img src={item.image_url} alt={item.card_name} className="h-16 w-12 rounded border border-pkmn-border object-cover flex-shrink-0" />
                          ) : null}
                          <div className="min-w-0">
                            <p className="font-semibold text-pkmn-text break-words">
                              {item.quantity}x {item.card_name}{item.card_number ? ` #${item.card_number}` : ''}
                            </p>
                            <p className="text-sm text-pkmn-gray">{[item.set_name, item.condition, statusLabel].filter(Boolean).join(' • ')}</p>
                            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-pkmn-gray-dark">
                              {item.base_market_price ? (
                                <span><Clock3 size={12} className="inline mr-1" />Market ${Number(item.base_market_price).toFixed(2)}</span>
                              ) : null}
                              <span><Package size={12} className="inline mr-1" />Offer ${unit.toFixed(2)} each</span>
                            </div>
                            {item.tcgplayer_url ? (
                              <a href={item.tcgplayer_url} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-pkmn-blue hover:underline inline-block mt-1">
                                TCGPlayer
                              </a>
                            ) : null}
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-lg font-bold text-pkmn-text">${lineTotal.toFixed(2)}</p>
                          {item.admin_override_value ? (
                            <p className="text-xs text-pkmn-yellow-dark">countered</p>
                          ) : item.is_accepted === false ? (
                            <p className="text-xs text-pkmn-red">not accepted</p>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="border border-pkmn-border rounded-md overflow-hidden">
                <div className="bg-pkmn-bg px-5 py-3 border-b border-pkmn-border">
                  <h3 className="text-sm font-bold text-pkmn-gray-dark flex items-center gap-1.5">
                    <CreditCard size={14} /> Payout Summary
                  </h3>
                </div>
                <div className="px-5 py-4 space-y-2 text-sm">
                  <div className="flex justify-between text-pkmn-gray">
                    <span>Original Estimate</span>
                    <span>${estimatedOffer.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-pkmn-gray">
                    <span>Payout Method</span>
                    <span>{tradeIn.payout_label || 'Store Credit'}</span>
                  </div>
                  <div className="flex justify-between text-pkmn-gray">
                    <span>Reviewed Cards</span>
                    <span>{acceptedItems.length} accepted / {rejectedItems.length} rejected / {pendingItems.length} pending</span>
                  </div>
                  <div className="flex justify-between pt-3 border-t border-pkmn-border text-lg font-bold text-pkmn-text">
                    <span>Current Payout</span>
                    <span>${displayedOffer.toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {tradeIn.status === 'pending_counteroffer' ? (
                <div className="bg-pkmn-yellow/10 border border-amber-300 rounded-md p-5 space-y-4">
                  <div>
                    <h3 className="text-base font-bold text-pkmn-text flex items-center gap-2">
                      <RefreshCw size={16} /> Counteroffer Comparison
                    </h3>
                    {tradeIn.counteroffer_message ? (
                      <p className="mt-1 text-sm text-pkmn-yellow-dark">{tradeIn.counteroffer_message}</p>
                    ) : null}
                    {tradeIn.counteroffer_expires_at ? (
                      <p className="mt-1 text-xs text-pkmn-yellow-dark">
                        Expires: {new Date(tradeIn.counteroffer_expires_at).toLocaleString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                    ) : null}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-white border border-pkmn-yellow/20 p-3 text-center">
                      <p className="text-xs text-pkmn-gray uppercase font-semibold mb-1">Original Estimate</p>
                      <p className="text-lg font-bold text-pkmn-gray-dark">${estimatedOffer.toFixed(2)}</p>
                      <p className="text-xs text-pkmn-gray-dark mt-0.5">based on your submitted estimate</p>
                    </div>
                    <div className="bg-pkmn-yellow/15 border border-pkmn-yellow p-3 text-center">
                      <p className="text-xs text-pkmn-yellow-dark uppercase font-semibold mb-1">Counteroffer</p>
                      <p className="text-2xl font-black text-pkmn-text">${displayedOffer.toFixed(2)}</p>
                      <p className="text-xs text-pkmn-yellow-dark mt-0.5">current payout if accepted</p>
                    </div>
                  </div>
                  <div className="flex gap-2 flex-col sm:flex-row">
                    <button
                      type="button"
                      onClick={() => respond('accept')}
                      disabled={responding}
                      className="flex-1 bg-green-600 text-white font-bold py-2.5 px-4 hover:bg-green-700 transition-all active:scale-95 text-sm disabled:opacity-50"
                    >
                      <Check size={15} className="inline mr-1" /> Accept Counteroffer
                    </button>
                    <button
                      type="button"
                      onClick={() => respond('decline')}
                      disabled={responding}
                      className="flex-1 bg-pkmn-red text-white font-bold py-2.5 px-4 hover:bg-pkmn-red-dark transition-all active:scale-95 text-sm disabled:opacity-50"
                    >
                      <X size={15} className="inline mr-1" /> Decline Counteroffer
                    </button>
                  </div>
                </div>
              ) : null}

              {(tradeIn.customer_notes || tradeIn.admin_notes) ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  {tradeIn.customer_notes ? (
                    <div className="rounded-md border border-pkmn-border bg-white p-4 text-sm">
                      <p className="mb-1 text-xs font-semibold uppercase text-pkmn-gray">Your Notes</p>
                      <p className="whitespace-pre-wrap text-pkmn-text">{tradeIn.customer_notes}</p>
                    </div>
                  ) : null}
                  {tradeIn.admin_notes ? (
                    <div className="rounded-md border border-pkmn-border bg-white p-4 text-sm">
                      <p className="mb-1 text-xs font-semibold uppercase text-pkmn-gray">Shop Notes</p>
                      <p className="whitespace-pre-wrap text-pkmn-text">{tradeIn.admin_notes}</p>
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="border border-pkmn-border rounded-md overflow-hidden">
                <div className="bg-pkmn-bg px-5 py-3 border-b border-pkmn-border">
                  <h3 className="text-sm font-bold text-pkmn-gray-dark">Trade Timeline</h3>
                </div>
                <style dangerouslySetInnerHTML={{ __html: `
                  @keyframes timeline-pulse {
                    0%, 100% { box-shadow: 0 0 0 0 rgba(0, 84, 166, 0.4); }
                    50% { box-shadow: 0 0 8px 3px rgba(0, 84, 166, 0.25); }
                  }
                ` }} />
                <div style={{ padding: '16px 20px' }}>
                  {timeline.map((evt, index) => {
                    const isLast = index === timeline.length - 1;
                    return (
                      <div key={`${evt.timestamp}-${index}`} style={{ display: 'flex', gap: '16px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '12px', flexShrink: 0 }}>
                          <div style={{ width: '2px', height: '12px', background: index > 0 ? '#94a3b8' : 'transparent' }} />
                          <div
                            style={{
                              width: '12px',
                              height: '12px',
                              borderRadius: '50%',
                              background: '#0054a6',
                              flexShrink: 0,
                              ...(isLast ? { animation: 'timeline-pulse 2s ease-in-out infinite' } : {}),
                            }}
                          />
                          <div style={{ width: '2px', flexGrow: 1, background: isLast ? 'transparent' : '#94a3b8', minHeight: '8px' }} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0, paddingTop: '4px', paddingBottom: isLast ? '0' : '12px' }}>
                          <p className="text-xs text-pkmn-gray">{formatTimelineTimestamp(evt.timestamp)}</p>
                          <p className="text-sm text-pkmn-text" style={{ marginTop: '4px' }}>{evt.detail}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
