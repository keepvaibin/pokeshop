"use client";

import { useState, useEffect } from 'react';
import axios from 'axios';
import { useRequireAuth } from '../../hooks/useRequireAuth';
import Navbar from '../../components/Navbar';
import { Plus, Trash2, Edit2, X, Tag, Package } from 'lucide-react';
import toast from 'react-hot-toast';
import { API_BASE_URL as API } from '@/app/lib/api';
import ProductPickerModal, { type PickedProduct } from '../../components/ProductPickerModal';

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
  min_order_total: string | null;
  specific_products: number[];
  specific_product_details?: { id: number; title: string }[];
  requires_cash_only: boolean;
}

type CouponForm = {
  code: string;
  discount_type: 'amount' | 'percent';
  discount_value: string;
  usage_limit: string;
  expires_at: string;
  is_active: boolean;
  min_order_total: string;
  selected_products: PickedProduct[];
  requires_cash_only: boolean;
};

const emptyForm: CouponForm = { code: '', discount_type: 'percent', discount_value: '', usage_limit: '0', expires_at: '', is_active: true, min_order_total: '', selected_products: [], requires_cash_only: false };

export default function AdminCouponsPage() {
  const { user } = useRequireAuth({ adminOnly: true });
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<CouponForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [showPicker, setShowPicker] = useState(false);

  const isAdmin = user?.is_admin;
  const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
  const headers = { Authorization: `Bearer ${token}` };

  const fetchCoupons = () => {
    if (!isAdmin) return;
    setLoading(true);
    axios.get(`${API}/api/orders/coupons/`, { headers })
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
      min_order_total: c.min_order_total || '',
      selected_products: (c.specific_product_details || []).map(p => ({ id: p.id, title: p.title })),
      requires_cash_only: c.requires_cash_only ?? false,
    });
    setShowForm(true);
  };

  const buildPayload = () => {
    const payload: Record<string, unknown> = {
      code: form.code.trim().toUpperCase(),
      is_active: form.is_active,
      usage_limit: parseInt(form.usage_limit) || 0,
      expires_at: form.expires_at || null,
      min_order_total: form.min_order_total ? parseFloat(form.min_order_total) : null,
      specific_products: form.selected_products.map(p => p.id),
      requires_cash_only: form.requires_cash_only,
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
        await axios.put(`${API}/api/orders/coupons/${editingId}/`, buildPayload(), { headers });
        toast.success('Coupon updated');
      } else {
        await axios.post(`${API}/api/orders/coupons/`, buildPayload(), { headers });
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
      await axios.delete(`${API}/api/orders/coupons/${id}/`, { headers });
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
                  <th className="text-left px-4 py-3 font-semibold text-pkmn-gray">Conditions</th>
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
                    <td className="px-4 py-3 text-pkmn-gray text-xs space-y-0.5">
                      {c.min_order_total && <div>Min ${Number(c.min_order_total).toFixed(2)}</div>}
                      {c.specific_product_details && c.specific_product_details.length > 0 && (
                        <div>{c.specific_product_details.length} product{c.specific_product_details.length !== 1 ? 's' : ''}</div>
                      )}
                      {c.requires_cash_only && <div className="text-amber-600">Cash only</div>}
                      {!c.min_order_total && (!c.specific_product_details || c.specific_product_details.length === 0) && !c.requires_cash_only && <span className="text-pkmn-gray">—</span>}
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
                <div>
                  <label className="block text-xs font-semibold text-pkmn-gray mb-1">Min Order Total (after trade credit, leave blank for none)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.min_order_total}
                    onChange={e => setForm({ ...form, min_order_total: e.target.value })}
                    className="w-full px-3 py-2 border border-pkmn-border rounded-lg text-sm text-pkmn-text"
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-pkmn-gray mb-1.5">Specific Product(s)</label>
                  {form.selected_products.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {form.selected_products.map(p => (
                        <span key={p.id} className="inline-flex items-center gap-1 bg-pkmn-blue/10 text-pkmn-blue-dark text-xs font-medium pl-2 pr-1 py-1 rounded-full">
                          {p.title}
                          <button
                            type="button"
                            onClick={() => setForm({ ...form, selected_products: form.selected_products.filter(sp => sp.id !== p.id) })}
                            className="p-0.5 rounded-full hover:bg-pkmn-blue/20"
                          >
                            <X size={10} />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowPicker(true)}
                    className="w-full flex items-center justify-center gap-2 py-2 border-2 border-dashed border-pkmn-border rounded-lg text-sm font-medium text-pkmn-gray hover:border-pkmn-blue hover:text-pkmn-blue hover:bg-pkmn-blue/5 transition-all"
                  >
                    <Package size={14} /> {form.selected_products.length > 0 ? 'Change Products' : 'Select Products'}
                  </button>
                  <p className="text-[10px] text-pkmn-gray mt-1">Leave empty to apply to all products</p>
                </div>
                <div className="flex flex-col gap-2">
                  <label className="flex items-center gap-2 text-sm text-pkmn-gray-dark">
                    <input
                      type="checkbox"
                      checked={form.requires_cash_only}
                      onChange={e => setForm({ ...form, requires_cash_only: e.target.checked })}
                      className="rounded border-pkmn-border"
                    />
                    Cash-only (no trade-ins)
                  </label>
                  <label className="flex items-center gap-2 text-sm text-pkmn-gray-dark">
                    <input
                      type="checkbox"
                      checked={form.is_active}
                      onChange={e => setForm({ ...form, is_active: e.target.checked })}
                      className="rounded border-pkmn-border"
                    />
                    Active
                  </label>
                </div>
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

        <ProductPickerModal
          open={showPicker}
          onClose={() => setShowPicker(false)}
          selected={form.selected_products}
          onConfirm={(products) => setForm({ ...form, selected_products: products })}
        />
      </div>
    </div>
  );
}
