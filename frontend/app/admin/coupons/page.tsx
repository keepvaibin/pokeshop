"use client";

import { useState, useEffect } from 'react';
import axios from 'axios';
import { useRequireAuth } from '../../hooks/useRequireAuth';
import Navbar from '../../components/Navbar';
import { Plus, Trash2, Edit2, X, Tag } from 'lucide-react';
import toast from 'react-hot-toast';

interface Coupon {
  id: number;
  code: string;
  discount_amount: string | null;
  discount_percent: string | null;
  usage_limit: number;
  times_used: number;
  expires_at: string | null;
  is_active: boolean;
  created_at: string;
}

type CouponForm = {
  code: string;
  discount_type: 'amount' | 'percent';
  discount_value: string;
  usage_limit: string;
  expires_at: string;
  is_active: boolean;
};

const emptyForm: CouponForm = { code: '', discount_type: 'percent', discount_value: '', usage_limit: '0', expires_at: '', is_active: true };

export default function AdminCouponsPage() {
  const { user } = useRequireAuth({ adminOnly: true });
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<CouponForm>(emptyForm);
  const [saving, setSaving] = useState(false);

  const isAdmin = user?.is_admin;
  const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
  const headers = { Authorization: `Bearer ${token}` };

  const fetchCoupons = () => {
    if (!isAdmin) return;
    setLoading(true);
    axios.get('http://localhost:8000/api/orders/coupons/', { headers })
      .then(r => setCoupons(r.data))
      .catch(() => toast.error('Failed to load coupons'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchCoupons();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(true);
  };

  const openEdit = (c: Coupon) => {
    setEditingId(c.id);
    setForm({
      code: c.code,
      discount_type: c.discount_amount ? 'amount' : 'percent',
      discount_value: c.discount_amount || c.discount_percent || '',
      usage_limit: String(c.usage_limit),
      expires_at: c.expires_at ? c.expires_at.slice(0, 16) : '',
      is_active: c.is_active,
    });
    setShowForm(true);
  };

  const buildPayload = () => {
    const payload: Record<string, unknown> = {
      code: form.code.trim().toUpperCase(),
      is_active: form.is_active,
      usage_limit: parseInt(form.usage_limit) || 0,
      expires_at: form.expires_at || null,
    };
    if (form.discount_type === 'amount') {
      payload.discount_amount = parseFloat(form.discount_value) || 0;
      payload.discount_percent = null;
    } else {
      payload.discount_percent = parseFloat(form.discount_value) || 0;
      payload.discount_amount = null;
    }
    return payload;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.code.trim() || !form.discount_value) {
      toast.error('Code and discount value are required.');
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        await axios.put(`http://localhost:8000/api/orders/coupons/${editingId}/`, buildPayload(), { headers });
        toast.success('Coupon updated');
      } else {
        await axios.post('http://localhost:8000/api/orders/coupons/', buildPayload(), { headers });
        toast.success('Coupon created');
      }
      setShowForm(false);
      fetchCoupons();
    } catch {
      toast.error('Failed to save coupon.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this coupon?')) return;
    try {
      await axios.delete(`http://localhost:8000/api/orders/coupons/${id}/`, { headers });
      toast.success('Coupon deleted');
      fetchCoupons();
    } catch {
      toast.error('Failed to delete coupon.');
    }
  };

  if (!user?.is_admin) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-zinc-800">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto" />
    </div>
  );

  return (
    <div className="bg-gray-100 dark:bg-zinc-800 min-h-screen">
      <Navbar />
      <div className="max-w-4xl mx-auto px-2 sm:px-4 py-6 sm:py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl sm:text-4xl font-black text-gray-900 dark:text-zinc-100">Coupons</h1>
            <p className="text-gray-600">Manage promo codes</p>
          </div>
          <button onClick={openCreate} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors">
            <Plus size={18} /> New Coupon
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          </div>
        ) : coupons.length === 0 ? (
          <div className="bg-white dark:bg-zinc-900 border-2 border-dashed border-gray-300 dark:border-zinc-600 rounded-2xl p-8 text-center">
            <Tag className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-xl font-bold text-gray-800 mb-2">No Coupons</h3>
            <p className="text-gray-600">Create your first promo code.</p>
          </div>
        ) : (
          <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-zinc-950 border-b border-gray-200 dark:border-zinc-700">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Code</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Discount</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Usage</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Expires</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Status</th>
                  <th className="text-right px-4 py-3 font-semibold text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody>
                {coupons.map(c => (
                  <tr key={c.id} className="border-b border-gray-100 hover:bg-gray-50 dark:hover:bg-zinc-800">
                    <td className="px-4 py-3 font-mono font-bold text-gray-900 dark:text-zinc-100">{c.code}</td>
                    <td className="px-4 py-3 text-gray-800">
                      {c.discount_amount ? `$${Number(c.discount_amount).toFixed(2)} off` : `${Number(c.discount_percent)}% off`}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {c.times_used}{c.usage_limit > 0 ? ` / ${c.usage_limit}` : ' / ∞'}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {c.expires_at ? new Date(c.expires_at).toLocaleDateString() : 'Never'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-semibold ${c.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                        {c.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => openEdit(c)} className="p-1.5 rounded hover:bg-blue-100 text-blue-600 transition-colors"><Edit2 size={16} /></button>
                        <button onClick={() => handleDelete(c.id)} className="p-1.5 rounded hover:bg-red-100 text-red-600 transition-colors"><Trash2 size={16} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Create / Edit Modal */}
        {showForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl max-w-md w-full p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-gray-900 dark:text-zinc-100">{editingId ? 'Edit Coupon' : 'New Coupon'}</h3>
                <button onClick={() => setShowForm(false)} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-zinc-800"><X size={20} /></button>
              </div>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Code</label>
                  <input
                    type="text"
                    value={form.code}
                    onChange={e => setForm({ ...form, code: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 dark:border-zinc-700 rounded-lg text-sm text-gray-900 dark:text-zinc-100 uppercase focus:ring-2 focus:ring-blue-500"
                    placeholder="SUMMER2025"
                    required
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 mb-1">Discount Type</label>
                    <select
                      value={form.discount_type}
                      onChange={e => setForm({ ...form, discount_type: e.target.value as 'amount' | 'percent' })}
                      className="w-full px-3 py-2 border border-gray-200 dark:border-zinc-700 rounded-lg text-sm text-gray-900 dark:text-zinc-100"
                    >
                      <option value="percent">Percentage (%)</option>
                      <option value="amount">Flat Amount ($)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 mb-1">Value</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={form.discount_value}
                      onChange={e => setForm({ ...form, discount_value: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-200 dark:border-zinc-700 rounded-lg text-sm text-gray-900 dark:text-zinc-100"
                      placeholder={form.discount_type === 'percent' ? '10' : '5.00'}
                      required
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 mb-1">Usage Limit (0 = ∞)</label>
                    <input
                      type="number"
                      min="0"
                      value={form.usage_limit}
                      onChange={e => setForm({ ...form, usage_limit: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-200 dark:border-zinc-700 rounded-lg text-sm text-gray-900 dark:text-zinc-100"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 mb-1">Expires At</label>
                    <input
                      type="datetime-local"
                      value={form.expires_at}
                      onChange={e => setForm({ ...form, expires_at: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-200 dark:border-zinc-700 rounded-lg text-sm text-gray-900 dark:text-zinc-100"
                    />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={form.is_active}
                    onChange={e => setForm({ ...form, is_active: e.target.checked })}
                    className="rounded border-gray-300 dark:border-zinc-600"
                  />
                  Active
                </label>
                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={() => setShowForm(false)} className="flex-1 border border-gray-300 dark:border-zinc-600 text-gray-700 font-semibold py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-zinc-800">Cancel</button>
                  <button type="submit" disabled={saving} className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-semibold py-2 rounded-lg">
                    {saving ? 'Saving...' : editingId ? 'Update' : 'Create'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
