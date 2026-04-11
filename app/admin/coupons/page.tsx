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
      .then(r => setCoupons(r.data.results ?? r.data))
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
    <div className="min-h-screen flex items-center justify-center bg-pkmn-bg">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-pkmn-blue mx-auto" />
    </div>
  );

  return (
    <div className="bg-pkmn-bg min-h-screen">
      <Navbar />
      <div className="max-w-4xl mx-auto px-2 sm:px-4 py-6 sm:py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl sm:text-4xl font-black text-pkmn-text">Coupons</h1>
            <p className="text-pkmn-gray">Manage promo codes</p>
          </div>
          <button onClick={openCreate} className="flex items-center gap-2 px-4 py-2 bg-pkmn-blue text-white rounded-lg font-semibold hover:bg-pkmn-blue-dark transition-colors">
            <Plus size={18} /> New Coupon
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-pkmn-blue" />
          </div>
        ) : coupons.length === 0 ? (
          <div className="bg-white border-2 border-dashed border-pkmn-border rounded-2xl p-8 text-center">
            <Tag className="w-12 h-12 text-pkmn-gray-dark mx-auto mb-4" />
            <h3 className="text-xl font-bold text-pkmn-text mb-2">No Coupons</h3>
            <p className="text-pkmn-gray">Create your first promo code.</p>
          </div>
        ) : (
          <div className="bg-white border border-pkmn-border rounded-xl overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-pkmn-bg border-b border-pkmn-border">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold text-pkmn-gray">Code</th>
                  <th className="text-left px-4 py-3 font-semibold text-pkmn-gray">Discount</th>
                  <th className="text-left px-4 py-3 font-semibold text-pkmn-gray">Usage</th>
                  <th className="text-left px-4 py-3 font-semibold text-pkmn-gray">Expires</th>
                  <th className="text-left px-4 py-3 font-semibold text-pkmn-gray">Status</th>
                  <th className="text-right px-4 py-3 font-semibold text-pkmn-gray">Actions</th>
                </tr>
              </thead>
              <tbody>
                {coupons.map(c => (
                  <tr key={c.id} className="border-b border-pkmn-border even:bg-pkmn-bg/50 even: hover:bg-pkmn-bg">
                    <td className="px-4 py-3 font-mono font-bold text-pkmn-text">{c.code}</td>
                    <td className="px-4 py-3 text-pkmn-text">
                      {c.discount_amount ? `$${Number(c.discount_amount).toFixed(2)} off` : `${Number(c.discount_percent)}% off`}
                    </td>
                    <td className="px-4 py-3 text-pkmn-gray">
                      {c.times_used}{c.usage_limit > 0 ? ` / ${c.usage_limit}` : ' / ∞'}
                    </td>
                    <td className="px-4 py-3 text-pkmn-gray">
                      {c.expires_at ? new Date(c.expires_at).toLocaleDateString() : 'Never'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-semibold ${c.is_active ? 'bg-green-500/15 text-green-600' : 'bg-pkmn-red/15 text-pkmn-red'}`}>
                        {c.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => openEdit(c)} className="p-1.5 rounded hover:bg-pkmn-blue/15 text-pkmn-blue transition-colors"><Edit2 size={16} /></button>
                        <button onClick={() => handleDelete(c.id)} className="p-1.5 rounded hover:bg-pkmn-red/15 text-pkmn-red transition-colors"><Trash2 size={16} /></button>
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
            <div className="bg-white border border-pkmn-border rounded-2xl shadow-2xl max-w-md w-full p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-pkmn-text">{editingId ? 'Edit Coupon' : 'New Coupon'}</h3>
                <button onClick={() => setShowForm(false)} className="p-1 rounded hover:bg-pkmn-bg"><X size={20} /></button>
              </div>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-pkmn-gray mb-1">Code</label>
                  <input
                    type="text"
                    value={form.code}
                    onChange={e => setForm({ ...form, code: e.target.value })}
                    className="w-full px-3 py-2 border border-pkmn-border rounded-lg text-sm text-pkmn-text uppercase focus:ring-2 focus:ring-pkmn-blue"
                    placeholder="SUMMER2025"
                    required
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-pkmn-gray mb-1">Discount Type</label>
                    <select
                      value={form.discount_type}
                      onChange={e => setForm({ ...form, discount_type: e.target.value as 'amount' | 'percent' })}
                      className="w-full px-3 py-2 border border-pkmn-border rounded-lg text-sm text-pkmn-text bg-white focus:ring-2 focus:ring-pkmn-blue focus:border-transparent focus:outline-none transition-colors duration-200"
                    >
                      <option value="percent">Percentage (%)</option>
                      <option value="amount">Flat Amount ($)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-pkmn-gray mb-1">Value</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={form.discount_value}
                      onChange={e => setForm({ ...form, discount_value: e.target.value })}
                      className="w-full px-3 py-2 border border-pkmn-border rounded-lg text-sm text-pkmn-text"
                      placeholder={form.discount_type === 'percent' ? '10' : '5.00'}
                      required
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-pkmn-gray mb-1">Usage Limit (0 = ∞)</label>
                    <input
                      type="number"
                      min="0"
                      value={form.usage_limit}
                      onChange={e => setForm({ ...form, usage_limit: e.target.value })}
                      className="w-full px-3 py-2 border border-pkmn-border rounded-lg text-sm text-pkmn-text"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-pkmn-gray mb-1">Expires At</label>
                    <input
                      type="datetime-local"
                      value={form.expires_at}
                      onChange={e => setForm({ ...form, expires_at: e.target.value })}
                      className="w-full px-3 py-2 border border-pkmn-border rounded-lg text-sm text-pkmn-text"
                    />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm text-pkmn-gray-dark">
                  <input
                    type="checkbox"
                    checked={form.is_active}
                    onChange={e => setForm({ ...form, is_active: e.target.checked })}
                    className="rounded border-pkmn-border"
                  />
                  Active
                </label>
                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={() => setShowForm(false)} className="flex-1 border border-pkmn-border text-pkmn-gray-dark font-semibold py-2 rounded-lg hover:bg-pkmn-bg">Cancel</button>
                  <button type="submit" disabled={saving} className="flex-1 bg-pkmn-blue hover:bg-pkmn-blue-dark disabled:bg-pkmn-gray-dark text-white font-semibold py-2 rounded-lg">
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
