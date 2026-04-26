"use client";

import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useRequireAuth } from '../../hooks/useRequireAuth';
import Navbar from '../../components/Navbar';
import { Package, Check, X } from 'lucide-react';
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
}

interface TradeInRequest {
  id: number;
  user_email: string;
  discord_handle: string;
  status: string;
  submission_method: string;
  estimated_total_value: string;
  final_payout_value: string | null;
  customer_notes: string;
  admin_notes: string;
  reviewed_by_email: string | null;
  reviewed_at: string | null;
  completed_at: string | null;
  created_at: string;
  items: TradeInItem[];
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending_review: { label: 'Pending Review', color: 'bg-pkmn-blue/15 text-pkmn-blue' },
  approved_pending_receipt: { label: 'Awaiting Cards', color: 'bg-pkmn-yellow/15 text-pkmn-yellow-dark' },
  completed: { label: 'Completed', color: 'bg-green-500/15 text-green-700' },
  rejected: { label: 'Rejected', color: 'bg-pkmn-red/15 text-pkmn-red' },
};

export default function AdminTradeInsPage() {
  const { user } = useRequireAuth({ adminOnly: true });
  const [requests, setRequests] = useState<TradeInRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [active, setActive] = useState<TradeInRequest | null>(null);
  const [payoutInput, setPayoutInput] = useState('');
  const [adminNotesInput, setAdminNotesInput] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const isAdmin = user?.is_admin;
  const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  function refresh() {
    setLoading(true);
    const url = statusFilter
      ? `${API}/api/trade-ins/admin/?status=${encodeURIComponent(statusFilter)}`
      : `${API}/api/trade-ins/admin/`;
    axios.get(url, { headers })
      .then(r => setRequests(Array.isArray(r.data) ? r.data : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (!isAdmin) return;
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, statusFilter]);

  function openDetail(req: TradeInRequest) {
    setActive(req);
    setPayoutInput(req.final_payout_value ?? req.estimated_total_value ?? '0.00');
    setAdminNotesInput(req.admin_notes ?? '');
  }

  function closeDetail() {
    if (submitting) return;
    setActive(null);
  }

  async function approve() {
    if (!active) return;
    if (!payoutInput || Number(payoutInput) < 0) {
      toast.error('Enter a valid payout amount.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await axios.post(
        `${API}/api/trade-ins/admin/${active.id}/approve/`,
        { final_payout_value: payoutInput, admin_notes: adminNotesInput },
        { headers },
      );
      setRequests(prev => prev.map(r => (r.id === active.id ? res.data : r)));
      setActive(res.data);
      toast.success('Approved. Customer notified.');
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error ?? 'Failed to approve.');
    } finally {
      setSubmitting(false);
    }
  }

  async function complete() {
    if (!active) return;
    setSubmitting(true);
    try {
      const res = await axios.post(
        `${API}/api/trade-ins/admin/${active.id}/complete/`,
        {},
        { headers },
      );
      setRequests(prev => prev.map(r => (r.id === active.id ? res.data : r)));
      setActive(res.data);
      toast.success('Wallet funded. Customer notified.');
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error ?? 'Failed to complete.');
    } finally {
      setSubmitting(false);
    }
  }

  async function reject() {
    if (!active) return;
    if (!confirm('Reject this trade-in?')) return;
    setSubmitting(true);
    try {
      const res = await axios.post(
        `${API}/api/trade-ins/admin/${active.id}/reject/`,
        { admin_notes: adminNotesInput },
        { headers },
      );
      setRequests(prev => prev.map(r => (r.id === active.id ? res.data : r)));
      setActive(res.data);
      toast.success('Rejected. Customer notified.');
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error ?? 'Failed to reject.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!user?.is_admin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-pkmn-bg">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-pkmn-blue" />
      </div>
    );
  }

  return (
    <div className="bg-pkmn-bg min-h-screen">
      <Navbar adminMode />
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex items-center gap-3 mb-6">
          <Package className="w-8 h-8 text-pkmn-blue" />
          <div>
            <h1 className="text-3xl font-bold text-pkmn-text">Trade-In Queue</h1>
            <p className="text-pkmn-gray text-sm">Review submissions and fund customer wallets</p>
          </div>
        </div>

        <div className="bg-white border border-pkmn-border p-3 mb-4 flex items-center gap-3">
          <label className="text-xs font-semibold text-pkmn-gray">Status</label>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="px-3 py-1.5 border border-pkmn-border rounded text-sm bg-white"
          >
            <option value="">All</option>
            <option value="pending_review">Pending Review</option>
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
                  <th className="text-left py-3 px-4 font-semibold text-pkmn-gray">#</th>
                  <th className="text-left py-3 px-4 font-semibold text-pkmn-gray">Date</th>
                  <th className="text-left py-3 px-4 font-semibold text-pkmn-gray">Customer</th>
                  <th className="text-left py-3 px-4 font-semibold text-pkmn-gray">Items</th>
                  <th className="text-left py-3 px-4 font-semibold text-pkmn-gray">Method</th>
                  <th className="text-right py-3 px-4 font-semibold text-pkmn-gray">Estimate</th>
                  <th className="text-right py-3 px-4 font-semibold text-pkmn-gray">Payout</th>
                  <th className="text-left py-3 px-4 font-semibold text-pkmn-gray">Status</th>
                </tr>
              </thead>
              <tbody>
                {requests.map(req => {
                  const sc = STATUS_LABELS[req.status] || { label: req.status, color: 'bg-pkmn-bg text-pkmn-gray' };
                  return (
                    <tr
                      key={req.id}
                      className="border-b border-pkmn-border hover:bg-pkmn-bg/50 cursor-pointer"
                      onClick={() => openDetail(req)}
                    >
                      <td className="py-2 px-4 font-mono text-xs">#{req.id}</td>
                      <td className="py-2 px-4 text-pkmn-gray">
                        {new Date(req.created_at).toLocaleDateString()}
                      </td>
                      <td className="py-2 px-4">
                        <p className="text-pkmn-text font-medium">{req.user_email}</p>
                        <p className="text-xs text-pkmn-gray">{req.discord_handle}</p>
                      </td>
                      <td className="py-2 px-4 text-pkmn-gray-dark">{req.items.length}</td>
                      <td className="py-2 px-4 text-pkmn-gray-dark">
                        {req.submission_method.replace('_', ' ')}
                      </td>
                      <td className="py-2 px-4 text-right text-pkmn-gray-dark">${req.estimated_total_value}</td>
                      <td className="py-2 px-4 text-right text-pkmn-text font-semibold">
                        {req.final_payout_value ? `$${req.final_payout_value}` : '—'}
                      </td>
                      <td className="py-2 px-4">
                        <span className={`px-2.5 py-0.5 text-xs font-semibold rounded ${sc.color}`}>
                          {sc.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {active && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={closeDetail}
        >
          <div
            className="bg-white border border-pkmn-border shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-pkmn-border flex items-center justify-between sticky top-0 bg-white">
              <div>
                <h2 className="text-lg font-bold text-pkmn-text">
                  Trade-In #{active.id} — {active.user_email}
                </h2>
                <p className="text-xs text-pkmn-gray">
                  {STATUS_LABELS[active.status]?.label} · {active.submission_method.replace('_', ' ')} · Estimate ${active.estimated_total_value}
                </p>
              </div>
              <button
                type="button"
                onClick={closeDetail}
                className="text-pkmn-gray hover:text-pkmn-text"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {active.customer_notes && (
                <div className="bg-pkmn-bg border border-pkmn-border rounded p-3 text-sm">
                  <p className="text-xs font-semibold text-pkmn-gray uppercase mb-1">Customer notes</p>
                  <p className="text-pkmn-text whitespace-pre-wrap">{active.customer_notes}</p>
                </div>
              )}

              <div>
                <p className="text-xs font-semibold text-pkmn-gray uppercase mb-2">Cards ({active.items.length})</p>
                <div className="border border-pkmn-border rounded overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-pkmn-bg">
                      <tr>
                        <th className="text-left py-2 px-3 font-semibold text-pkmn-gray">Qty</th>
                        <th className="text-left py-2 px-3 font-semibold text-pkmn-gray">Card</th>
                        <th className="text-left py-2 px-3 font-semibold text-pkmn-gray">Set</th>
                        <th className="text-left py-2 px-3 font-semibold text-pkmn-gray">Cond</th>
                        <th className="text-right py-2 px-3 font-semibold text-pkmn-gray">$/ea</th>
                      </tr>
                    </thead>
                    <tbody>
                      {active.items.map(it => (
                        <tr key={it.id} className="border-t border-pkmn-border">
                          <td className="py-1.5 px-3">{it.quantity}</td>
                          <td className="py-1.5 px-3 text-pkmn-text">
                            {it.card_name}
                            {it.card_number ? ` #${it.card_number}` : ''}
                          </td>
                          <td className="py-1.5 px-3 text-pkmn-gray">{it.set_name || '—'}</td>
                          <td className="py-1.5 px-3">{it.condition}</td>
                          <td className="py-1.5 px-3 text-right">${it.user_estimated_price}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {active.status === 'pending_review' && (
                <div className="space-y-3 border-t border-pkmn-border pt-4">
                  <div>
                    <label className="block text-xs font-semibold text-pkmn-gray mb-1">
                      Final Payout ($)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min={0}
                      value={payoutInput}
                      onChange={e => setPayoutInput(e.target.value)}
                      className="w-full px-3 py-2 border border-pkmn-border rounded text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-pkmn-gray mb-1">
                      Admin Notes (visible to customer)
                    </label>
                    <textarea
                      value={adminNotesInput}
                      onChange={e => setAdminNotesInput(e.target.value)}
                      rows={3}
                      className="w-full px-3 py-2 border border-pkmn-border rounded text-sm"
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={reject}
                      disabled={submitting}
                      className="px-4 py-2 text-sm font-semibold rounded-md border border-pkmn-red text-pkmn-red hover:bg-pkmn-red hover:text-white disabled:opacity-50"
                    >
                      Reject
                    </button>
                    <button
                      type="button"
                      onClick={approve}
                      disabled={submitting}
                      className="px-4 py-2 text-sm font-semibold rounded-md bg-pkmn-blue text-white hover:bg-pkmn-blue-dark disabled:opacity-50"
                    >
                      Approve &amp; Send Drop-Off Instructions
                    </button>
                  </div>
                </div>
              )}

              {active.status === 'approved_pending_receipt' && (
                <div className="space-y-3 border-t border-pkmn-border pt-4">
                  <p className="text-sm text-pkmn-text bg-pkmn-yellow/10 border border-pkmn-yellow/30 p-3 rounded">
                    Customer was offered <span className="font-bold">${active.final_payout_value}</span>{' '}
                    and is shipping/dropping off cards. Once received, fund their wallet.
                  </p>
                  <div className="flex justify-end gap-2">
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
                      <Check size={14} /> Cards Received — Fund Wallet
                    </button>
                  </div>
                </div>
              )}

              {active.status === 'completed' && (
                <div className="text-sm bg-green-500/10 border border-green-500/30 p-3 rounded">
                  ✅ Funded ${active.final_payout_value} on{' '}
                  {active.completed_at ? new Date(active.completed_at).toLocaleString() : '—'}.
                </div>
              )}

              {active.status === 'rejected' && (
                <div className="text-sm bg-pkmn-red/10 border border-pkmn-red/30 p-3 rounded">
                  Rejected. {active.admin_notes && <span>Note: {active.admin_notes}</span>}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
