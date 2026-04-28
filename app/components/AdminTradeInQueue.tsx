"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { AlertCircle, Ban, Check, CheckCircle, Clock, Package, X } from 'lucide-react';
import toast from 'react-hot-toast';
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
  user_email: string;
  discord_handle: string;
  status: string;
  submission_method: string;
  payout_type: string;
  cash_payment_method: string;
  payout_label: string;
  pickup_label: string;
  estimated_total_value: string;
  final_payout_value: string | null;
  counteroffer_message: string;
  counteroffer_expires_at: string | null;
  customer_notes: string;
  admin_notes: string;
  reviewed_by_email: string | null;
  reviewed_at: string | null;
  completed_at: string | null;
  created_at: string;
  items: TradeInItem[];
}

type CardDecision = 'accept' | 'reject';

interface AdminTradeInQueueProps {
  onUpdated?: () => void;
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending_review: { label: 'Pending Review', color: 'bg-pkmn-blue/15 text-pkmn-blue' },
  pending_counteroffer: { label: 'Counteroffer', color: 'bg-pkmn-yellow/15 text-pkmn-yellow-dark' },
  approved_pending_receipt: { label: 'Awaiting Cards', color: 'bg-pkmn-yellow/15 text-pkmn-yellow-dark' },
  completed: { label: 'Completed', color: 'bg-green-500/15 text-green-700' },
  rejected: { label: 'Rejected', color: 'bg-pkmn-red/15 text-pkmn-red' },
};

function formatSubmissionMethod(method: string) {
  if (method === 'in_store_dropoff') return 'Drop-Off';
  return method.replace(/_/g, ' ');
}

function formatCondition(condition: string) {
  return condition.replace(/_/g, ' ');
}

function getPersistedDecisions(requestObj: TradeInRequest) {
  return Object.fromEntries(
    requestObj.items
      .filter((item) => item.is_accepted !== null)
      .map((item) => [String(item.id), item.is_accepted ? 'accept' : 'reject']),
  ) as Record<string, CardDecision>;
}

function getPersistedOverrides(requestObj: TradeInRequest) {
  return Object.fromEntries(
    requestObj.items
      .filter((item) => item.admin_override_value)
      .map((item) => [String(item.id), item.admin_override_value || '']),
  );
}

export default function AdminTradeInQueue({ onUpdated }: AdminTradeInQueueProps) {
  const [requests, setRequests] = useState<TradeInRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [active, setActive] = useState<TradeInRequest | null>(null);
  const [cardDecisions, setCardDecisions] = useState<Record<string, CardDecision>>({});
  const [cardOverrides, setCardOverrides] = useState<Record<string, string>>({});
  const [counterofferMessage, setCounterofferMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const refresh = async () => {
    setLoading(true);
    const url = statusFilter
      ? `${API}/api/trade-ins/admin/?status=${encodeURIComponent(statusFilter)}`
      : `${API}/api/trade-ins/admin/`;
    try {
      const response = await axios.get(url, { headers });
      setRequests(Array.isArray(response.data) ? response.data : []);
    } catch {
      setRequests([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  function openDetail(requestObj: TradeInRequest) {
    setActive(requestObj);
    setCounterofferMessage(requestObj.counteroffer_message || requestObj.admin_notes || '');
    const persistedDecisions = getPersistedDecisions(requestObj);
    setCardDecisions(
      requestObj.status === 'pending_review' && Object.keys(persistedDecisions).length === 0
        ? {}
        : persistedDecisions,
    );
    setCardOverrides(getPersistedOverrides(requestObj));
  }

  function closeDetail() {
    if (submitting) return;
    setActive(null);
    setCardDecisions({});
    setCardOverrides({});
    setCounterofferMessage('');
  }

  function applyUpdatedRequest(updated: TradeInRequest) {
    setRequests((previous) => previous.map((requestObj) => (
      requestObj.id === updated.id ? updated : requestObj
    )));
    setActive(updated);
    onUpdated?.();
  }

  function setDecision(itemId: number, decision: CardDecision) {
    const itemKey = String(itemId);
    setCardDecisions((previous) => {
      const next = { ...previous };
      if (next[itemKey] === decision) {
        delete next[itemKey];
      } else {
        next[itemKey] = decision;
      }
      return next;
    });
    if (decision === 'reject') {
      setCardOverrides((previous) => {
        const next = { ...previous };
        delete next[itemKey];
        return next;
      });
    }
  }

  function setOverride(itemId: number, value: string) {
    setCardOverrides((previous) => ({ ...previous, [String(itemId)]: value }));
  }

  function getReviewTotal(requestObj: TradeInRequest) {
    return requestObj.items.reduce((sum, item) => {
      if (cardDecisions[String(item.id)] !== 'accept') return sum;
      const override = cardOverrides[String(item.id)];
      const unitCredit = override ? Number(override) : Number(item.user_estimated_price || 0);
      return sum + unitCredit * item.quantity;
    }, 0);
  }

  function buildReviewPayload(requestObj: TradeInRequest, overrideDecisions?: Record<string, { decision: CardDecision; overridden_value: string | null }>) {
    if (overrideDecisions) {
      return overrideDecisions;
    }
    return Object.fromEntries(requestObj.items.map((item) => {
      const itemKey = String(item.id);
      return [
        itemKey,
        {
          decision: cardDecisions[itemKey] || 'accept',
          overridden_value: cardOverrides[itemKey] || null,
        },
      ];
    }));
  }

  async function reviewCards(sendCounteroffer: boolean, overrideDecisions?: Record<string, { decision: CardDecision; overridden_value: string | null }>) {
    if (!active) return;
    setSubmitting(true);
    try {
      const response = await axios.post(
        `${API}/api/trade-ins/admin/${active.id}/review/`,
        {
          card_decisions: buildReviewPayload(active, overrideDecisions),
          counteroffer_message: counterofferMessage,
          send_counteroffer: sendCounteroffer,
        },
        { headers },
      );
      applyUpdatedRequest(response.data);
      toast.success(sendCounteroffer ? 'Counteroffer sent.' : 'Trade-in reviewed.');
    } catch (error) {
      const axiosError = error as { response?: { data?: { error?: string; send_counteroffer?: string[] } } };
      toast.error(
        axiosError.response?.data?.error
          ?? axiosError.response?.data?.send_counteroffer?.[0]
          ?? 'Failed to review trade-in.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function complete() {
    if (!active) return;
    setSubmitting(true);
    try {
      const response = await axios.post(
        `${API}/api/trade-ins/admin/${active.id}/complete/`,
        {},
        { headers },
      );
      applyUpdatedRequest(response.data);
      toast.success(active.payout_type === 'cash' ? 'Trade-in completed.' : 'Wallet funded. Customer notified.');
    } catch (error) {
      const axiosError = error as { response?: { data?: { error?: string } } };
      toast.error(axiosError.response?.data?.error ?? 'Failed to complete.');
    } finally {
      setSubmitting(false);
    }
  }

  async function reject() {
    if (!active) return;
    if (!confirm('Reject this trade-in?')) return;
    setSubmitting(true);
    try {
      const response = await axios.post(
        `${API}/api/trade-ins/admin/${active.id}/reject/`,
        { admin_notes: counterofferMessage },
        { headers },
      );
      applyUpdatedRequest(response.data);
      toast.success('Rejected. Customer notified.');
    } catch (error) {
      const axiosError = error as { response?: { data?: { error?: string } } };
      toast.error(axiosError.response?.data?.error ?? 'Failed to reject.');
    } finally {
      setSubmitting(false);
    }
  }

  const reviewState = useMemo(() => {
    if (!active) return null;
    const totalCards = active.items.length;
    const decidedCardsCount = active.items.reduce((sum, item) => (
      cardDecisions[String(item.id)] ? sum + 1 : sum
    ), 0);
    const allDecided = totalCards > 0 && decidedCardsCount === totalCards;
    const hasOverrides = Object.values(cardOverrides).some((value) => value !== undefined && value !== '');
    const isAllAccepted = allDecided && active.items.every((item) => cardDecisions[String(item.id)] === 'accept');
    const isAllRejected = allDecided && active.items.every((item) => cardDecisions[String(item.id)] === 'reject');
    return {
      totalCards,
      decidedCardsCount,
      allDecided,
      hasOverrides,
      isAllAccepted,
      isAllRejected,
    };
  }, [active, cardDecisions, cardOverrides]);

  const quickApprovePayload = active
    ? Object.fromEntries(active.items.map((item) => [
        String(item.id),
        { decision: 'accept' as CardDecision, overridden_value: null },
      ]))
    : {};

  return (
    <>
      <div className="bg-white border border-pkmn-border p-3 mb-4 flex items-center gap-3">
        <label className="text-xs font-semibold text-pkmn-gray">Status</label>
        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
          className="px-3 py-1.5 border border-pkmn-border rounded text-sm bg-white"
        >
          <option value="">All</option>
          <option value="pending_review">Pending Review</option>
          <option value="pending_counteroffer">Counteroffer</option>
          <option value="approved_pending_receipt">Awaiting Cards</option>
          <option value="completed">Completed</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-pkmn-blue" />
        </div>
      ) : requests.length === 0 ? (
        <div className="bg-white border border-dashed border-pkmn-border p-12 text-center text-pkmn-gray">
          No trade-ins to show.
        </div>
      ) : (
        <div className="bg-white border border-pkmn-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-pkmn-bg border-b border-pkmn-border">
              <tr>
                <th className="text-left py-3 px-4 font-semibold text-pkmn-gray whitespace-nowrap">#</th>
                <th className="text-left py-3 px-4 font-semibold text-pkmn-gray whitespace-nowrap">Date</th>
                <th className="text-left py-3 px-4 font-semibold text-pkmn-gray whitespace-nowrap">Customer</th>
                <th className="text-left py-3 px-4 font-semibold text-pkmn-gray whitespace-nowrap">Cards</th>
                <th className="text-left py-3 px-4 font-semibold text-pkmn-gray whitespace-nowrap">Drop-Off</th>
                <th className="text-left py-3 px-4 font-semibold text-pkmn-gray whitespace-nowrap">Payout Type</th>
                <th className="text-right py-3 px-4 font-semibold text-pkmn-gray whitespace-nowrap">Estimate</th>
                <th className="text-right py-3 px-4 font-semibold text-pkmn-gray whitespace-nowrap">Final</th>
                <th className="text-left py-3 px-4 font-semibold text-pkmn-gray whitespace-nowrap">Status</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((requestObj) => {
                const statusConfig = STATUS_LABELS[requestObj.status] || { label: requestObj.status, color: 'bg-pkmn-bg text-pkmn-gray' };
                const customerSummary = [requestObj.user_email, requestObj.discord_handle].filter(Boolean).join(' • ');
                const cardSummary = `${requestObj.items[0]?.card_name || 'Trade'}${requestObj.items.length > 1 ? ` +${requestObj.items.length - 1} more` : ''}`;
                const dropoffSummary = requestObj.pickup_label || formatSubmissionMethod(requestObj.submission_method);
                const payoutSummary = requestObj.payout_label || requestObj.payout_type;
                return (
                  <tr
                    key={requestObj.id}
                    className="border-b border-pkmn-border hover:bg-pkmn-bg/50 cursor-pointer"
                    onClick={() => openDetail(requestObj)}
                  >
                    <td className="py-2 px-4 font-mono text-xs whitespace-nowrap">#{requestObj.id}</td>
                    <td className="py-2 px-4 text-pkmn-gray whitespace-nowrap">{new Date(requestObj.created_at).toLocaleDateString()}</td>
                    <td className="py-2 px-4">
                      <p className="max-w-[220px] truncate text-pkmn-text font-medium whitespace-nowrap" title={customerSummary}>{customerSummary}</p>
                    </td>
                    <td className="py-2 px-4 text-pkmn-gray-dark">
                      <p className="max-w-[220px] truncate whitespace-nowrap" title={cardSummary}>{cardSummary}</p>
                    </td>
                    <td className="py-2 px-4 text-pkmn-gray-dark">
                      <p className="max-w-[240px] truncate whitespace-nowrap" title={dropoffSummary}>{dropoffSummary}</p>
                    </td>
                    <td className="py-2 px-4 text-pkmn-gray-dark">
                      <p className="max-w-[180px] truncate whitespace-nowrap" title={payoutSummary}>{payoutSummary}</p>
                    </td>
                    <td className="py-2 px-4 text-right text-pkmn-gray-dark whitespace-nowrap">${requestObj.estimated_total_value}</td>
                    <td className="py-2 px-4 text-right text-pkmn-text font-semibold whitespace-nowrap">
                      {requestObj.final_payout_value ? `$${requestObj.final_payout_value}` : '—'}
                    </td>
                    <td className="py-2 px-4">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${statusConfig.color}`}>
                        {statusConfig.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {active && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={closeDetail}>
          <div
            className="bg-white border border-pkmn-border shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-pkmn-border flex items-center justify-between sticky top-0 bg-white z-10">
              <div>
                <h2 className="text-lg font-bold text-pkmn-text">Trade-In #{active.id} — {active.user_email}</h2>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-pkmn-gray">
                  <span className={`rounded-full px-2.5 py-0.5 font-semibold whitespace-nowrap ${(STATUS_LABELS[active.status] || { color: 'bg-pkmn-bg text-pkmn-gray' }).color}`}>
                    {STATUS_LABELS[active.status]?.label || active.status}
                  </span>
                  <span>{active.pickup_label || formatSubmissionMethod(active.submission_method)}</span>
                  <span>{active.payout_label || active.payout_type}</span>
                  <span>Estimate ${active.estimated_total_value}</span>
                </div>
              </div>
              <button type="button" onClick={closeDetail} className="text-pkmn-gray hover:text-pkmn-text">
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {active.customer_notes && (
                <div className="bg-pkmn-bg border border-pkmn-border rounded p-3 text-sm">
                  <p className="text-xs font-semibold text-pkmn-gray uppercase mb-1">Customer Notes</p>
                  <p className="text-pkmn-text whitespace-pre-wrap">{active.customer_notes}</p>
                </div>
              )}

              {active.status === 'pending_counteroffer' && (
                <div className="rounded-md border border-pkmn-yellow/20 bg-pkmn-yellow/10 p-4 text-sm text-pkmn-yellow-dark">
                  <div className="flex items-center gap-2 font-semibold text-pkmn-text">
                    <Clock size={15} /> Waiting on customer response
                  </div>
                  <p className="mt-1">This counteroffer is locked until the customer accepts or declines it.</p>
                  {active.counteroffer_expires_at && (
                    <p className="mt-1 text-xs">Expires {new Date(active.counteroffer_expires_at).toLocaleString()}.</p>
                  )}
                  {active.counteroffer_message && (
                    <p className="mt-2 whitespace-pre-wrap text-pkmn-gray-dark">{active.counteroffer_message}</p>
                  )}
                </div>
              )}

              <div>
                <p className="text-xs font-semibold text-pkmn-gray uppercase mb-2">
                  {active.status === 'pending_review' ? 'Card Review' : `Cards (${active.items.length})`}
                </p>
                <div className="space-y-2">
                  {active.items.map((item) => {
                    const itemKey = String(item.id);
                    const persistedDecision = item.is_accepted === true ? 'accept' : item.is_accepted === false ? 'reject' : undefined;
                    const decision = active.status === 'pending_review' ? cardDecisions[itemKey] : persistedDecision;
                    const overrideValue = active.status === 'pending_review'
                      ? (cardOverrides[itemKey] || '')
                      : (item.admin_override_value || '');
                    const proposedUnit = Number(item.user_estimated_price || 0);
                    const unitPayout = overrideValue ? Number(overrideValue) : proposedUnit;
                    const linePayout = decision === 'reject' ? 0 : unitPayout * item.quantity;
                    const containerClass = decision === 'accept'
                      ? 'border-green-500/20 bg-green-500/10'
                      : decision === 'reject'
                        ? 'border-pkmn-red/20 bg-pkmn-red/10'
                        : 'border-pkmn-border bg-white';

                    return (
                      <div key={item.id} className={`rounded-md border p-3 ${containerClass}`}>
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start gap-3">
                              {item.image_url && (
                                <img src={item.image_url} alt={item.card_name} className="h-16 w-12 rounded border border-pkmn-border object-cover" />
                              )}
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="font-semibold text-sm text-pkmn-text">
                                    {item.quantity}x {item.card_name}{item.card_number ? ` #${item.card_number}` : ''}
                                  </p>
                                  {decision === 'accept' && <span className="text-xs font-semibold text-green-700">Accepted</span>}
                                  {decision === 'reject' && <span className="text-xs font-semibold text-pkmn-red">Rejected</span>}
                                  {!decision && <span className="text-xs font-semibold text-pkmn-gray-dark">Pending</span>}
                                </div>
                                <p className="text-xs text-pkmn-gray">
                                  {[item.set_name, formatCondition(item.condition), `$${proposedUnit.toFixed(2)} each`].filter(Boolean).join(' · ')}
                                </p>
                                {item.tcgplayer_url && (
                                  <a href={item.tcgplayer_url} target="_blank" rel="noopener noreferrer" className="text-xs text-pkmn-blue hover:underline">
                                    TCGPlayer
                                  </a>
                                )}
                              </div>
                            </div>

                            {active.status === 'pending_review' && decision === 'accept' && (
                              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                <label className="text-xs text-pkmn-gray">
                                  Final payout each ($)
                                  <input
                                    type="number"
                                    min={0}
                                    step="0.01"
                                    placeholder={proposedUnit.toFixed(2)}
                                    value={overrideValue}
                                    onChange={(event) => setOverride(item.id, event.target.value)}
                                    className="ml-0 mt-1 w-full rounded border border-pkmn-border px-2 py-1 text-sm text-pkmn-text sm:ml-2 sm:mt-0 sm:w-28"
                                  />
                                </label>
                                <span className="text-xs font-semibold text-green-700">Line payout: ${linePayout.toFixed(2)}</span>
                              </div>
                            )}
                          </div>

                          {active.status === 'pending_review' && (
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => setDecision(item.id, 'accept')}
                                className={`px-3 py-1.5 text-xs font-semibold rounded-md ${decision === 'accept' ? 'bg-green-600 text-white' : 'bg-white text-green-700 border border-green-600/30'}`}
                              >
                                <Check size={12} className="inline mr-1" /> Accept
                              </button>
                              <button
                                type="button"
                                onClick={() => setDecision(item.id, 'reject')}
                                className={`px-3 py-1.5 text-xs font-semibold rounded-md ${decision === 'reject' ? 'bg-pkmn-red text-white' : 'bg-white text-pkmn-red border border-pkmn-red/30'}`}
                              >
                                <X size={12} className="inline mr-1" /> Reject
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {active.status === 'pending_review' && reviewState && (
                <div className="space-y-3 border-t border-pkmn-border pt-4">
                  <p className="text-xs text-pkmn-gray">
                    {reviewState.decidedCardsCount}/{reviewState.totalCards} cards decided
                  </p>

                  {reviewState.allDecided && reviewState.hasOverrides && (
                    <>
                      <div className="rounded-md border border-pkmn-yellow/20 bg-pkmn-yellow/10 px-3 py-2 text-xs text-pkmn-yellow-dark">
                        Price overrides detected. The customer must accept a counteroffer before this trade can move forward.
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-pkmn-gray mb-1">Counteroffer Notes</label>
                        <textarea
                          value={counterofferMessage}
                          onChange={(event) => setCounterofferMessage(event.target.value)}
                          rows={3}
                          className="w-full px-3 py-2 border border-pkmn-border rounded text-sm"
                        />
                      </div>
                    </>
                  )}

                  <div className="rounded-md border border-pkmn-blue/20 bg-pkmn-blue/10 p-3 text-sm text-pkmn-blue-dark flex items-center justify-between">
                    <span>Selected card payout</span>
                    <span className="font-bold text-pkmn-blue">${getReviewTotal(active).toFixed(2)}</span>
                  </div>

                  <div className="flex flex-wrap justify-end gap-2">
                    {reviewState.decidedCardsCount === 0 && (
                      <>
                        <button
                          type="button"
                          onClick={reject}
                          disabled={submitting}
                          className="px-4 py-2 text-sm font-semibold rounded-md border border-pkmn-red text-pkmn-red hover:bg-pkmn-red hover:text-white disabled:opacity-50"
                        >
                          Reject Trade
                        </button>
                        <button
                          type="button"
                          onClick={() => reviewCards(false, quickApprovePayload)}
                          disabled={submitting}
                          className="px-4 py-2 text-sm font-semibold rounded-md bg-pkmn-blue text-white hover:bg-pkmn-blue-dark disabled:opacity-50"
                        >
                          Approve As Submitted
                        </button>
                      </>
                    )}

                    {reviewState.decidedCardsCount > 0 && !reviewState.allDecided && (
                      <>
                        <button
                          type="button"
                          disabled
                          className="px-4 py-2 text-sm font-semibold rounded-md border border-pkmn-border text-pkmn-gray-dark opacity-50 cursor-not-allowed"
                        >
                          Reject Trade
                        </button>
                        <button
                          type="button"
                          disabled
                          className="px-4 py-2 text-sm font-semibold rounded-md bg-pkmn-gray-mid text-pkmn-gray-dark opacity-50 cursor-not-allowed"
                        >
                          Finish Reviewing All Cards
                        </button>
                      </>
                    )}

                    {reviewState.allDecided && !reviewState.hasOverrides && !reviewState.isAllRejected && (
                      <>
                        <button
                          type="button"
                          onClick={reject}
                          disabled={submitting}
                          className="px-4 py-2 text-sm font-semibold rounded-md border border-pkmn-red text-pkmn-red hover:bg-pkmn-red hover:text-white disabled:opacity-50"
                        >
                          Reject Trade
                        </button>
                        <button
                          type="button"
                          onClick={() => reviewCards(false)}
                          disabled={submitting}
                          className="px-4 py-2 text-sm font-semibold rounded-md bg-pkmn-blue text-white hover:bg-pkmn-blue-dark disabled:opacity-50"
                        >
                          {reviewState.isAllAccepted ? 'Approve Trade' : 'Approve Selected Cards'}
                        </button>
                      </>
                    )}

                    {reviewState.allDecided && !reviewState.hasOverrides && reviewState.isAllRejected && (
                      <button
                        type="button"
                        onClick={() => reviewCards(false)}
                        disabled={submitting}
                        className="px-4 py-2 text-sm font-semibold rounded-md border border-pkmn-red text-pkmn-red hover:bg-pkmn-red hover:text-white disabled:opacity-50"
                      >
                        Reject Selected Cards
                      </button>
                    )}

                    {reviewState.allDecided && reviewState.hasOverrides && (
                      <>
                        <button
                          type="button"
                          onClick={reject}
                          disabled={submitting}
                          className="px-4 py-2 text-sm font-semibold rounded-md border border-pkmn-red text-pkmn-red hover:bg-pkmn-red hover:text-white disabled:opacity-50"
                        >
                          Reject Trade
                        </button>
                        <button
                          type="button"
                          onClick={() => reviewCards(true)}
                          disabled={submitting}
                          className="px-4 py-2 text-sm font-semibold rounded-md border border-pkmn-yellow text-pkmn-yellow-dark hover:bg-pkmn-yellow/10 disabled:opacity-50"
                        >
                          Send Counteroffer
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}

              {active.status === 'approved_pending_receipt' && (
                <div className="space-y-3 border-t border-pkmn-border pt-4">
                  <p className="text-sm text-pkmn-text bg-pkmn-yellow/10 border border-pkmn-yellow/30 p-3 rounded">
                    Customer was offered <span className="font-bold">${active.final_payout_value}</span> via{' '}
                    <span className="font-bold">{active.payout_label || active.payout_type}</span> and will bring cards to their drop-off timeslot.
                  </p>
                  <div className="flex justify-center gap-2">
                    <button
                      type="button"
                      onClick={reject}
                      disabled={submitting}
                      className="px-4 py-2 text-sm font-semibold rounded-md border border-pkmn-red text-pkmn-red hover:bg-pkmn-red hover:text-white disabled:opacity-50"
                    >
                      Reject (Cards Not Received / Misrepresented)
                    </button>
                    <button
                      type="button"
                      onClick={complete}
                      disabled={submitting}
                      className="flex items-center gap-1 px-4 py-2 text-sm font-semibold rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                    >
                      <CheckCircle size={14} />
                      {active.payout_type === 'cash' ? 'Cards Received — Mark Cash Paid' : 'Cards Received — Fund Wallet'}
                    </button>
                  </div>
                </div>
              )}

              {active.status === 'pending_counteroffer' && (
                <div className="flex justify-end border-t border-pkmn-border pt-4">
                  <button
                    type="button"
                    onClick={reject}
                    disabled={submitting}
                    className="px-4 py-2 text-sm font-semibold rounded-md border border-pkmn-red text-pkmn-red hover:bg-pkmn-red hover:text-white disabled:opacity-50"
                  >
                    Withdraw and Reject Trade
                  </button>
                </div>
              )}

              {active.status === 'completed' && (
                <div className="text-sm bg-green-500/10 border border-green-500/30 p-3 rounded">
                  ✅ Completed ${active.final_payout_value} on {active.completed_at ? new Date(active.completed_at).toLocaleString() : '—'}.
                </div>
              )}

              {active.status === 'rejected' && (
                <div className="text-sm bg-pkmn-red/10 border border-pkmn-red/30 p-3 rounded">
                  Rejected. {active.admin_notes && <span>Note: {active.admin_notes}</span>}
                </div>
              )}

              {!['pending_review', 'pending_counteroffer', 'approved_pending_receipt', 'completed', 'rejected'].includes(active.status) && (
                <div className="bg-pkmn-bg px-4 py-3 border border-pkmn-border rounded-md text-sm text-pkmn-gray flex items-center gap-2">
                  <Ban size={16} />
                  Trade-in is locked in its current status.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}