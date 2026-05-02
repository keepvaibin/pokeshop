"use client";

import { useState, useEffect, useMemo } from 'react';
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
  specific_categories?: number[];
  specific_category_details?: TargetDetail[];
  specific_subcategories?: number[];
  specific_subcategory_details?: TargetDetail[];
  specific_tags?: number[];
  specific_tag_details?: TargetDetail[];
  requires_cash_only: boolean;
}

type TargetDetail = {
  id: number;
  name: string;
  slug?: string;
  category?: number;
};

type CategoryOption = {
  id: number;
  name: string;
  slug: string;
  is_active: boolean;
  subcategories?: TargetDetail[];
  tags?: TargetDetail[];
};

type CouponForm = {
  code: string;
  discount_type: 'amount' | 'percent';
  discount_value: string;
  usage_limit: string;
  expires_at: string;
  is_active: boolean;
  min_order_total: string;
  selected_categories: number[];
  selected_subcategories: number[];
  selected_tags: number[];
  selected_products: PickedProduct[];
  requires_cash_only: boolean;
};

const emptyForm: CouponForm = {
  code: '',
  discount_type: 'percent',
  discount_value: '',
  usage_limit: '0',
  expires_at: '',
  is_active: true,
  min_order_total: '',
  selected_categories: [],
  selected_subcategories: [],
  selected_tags: [],
  selected_products: [],
  requires_cash_only: false,
};

const toggleId = (values: number[], id: number) => (
  values.includes(id) ? values.filter(value => value !== id) : [...values, id]
);

const targetButtonClass = (active: boolean) => `px-3 py-2 border text-sm font-semibold transition-colors text-left ${
  active
    ? 'border-pkmn-blue bg-pkmn-blue/10 text-pkmn-blue-dark'
    : 'border-pkmn-border bg-white text-pkmn-gray-dark hover:border-pkmn-blue hover:text-pkmn-blue'
}`;

export default function AdminCouponsPage() {
  const { user } = useRequireAuth({ adminOnly: true });
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<CouponForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);

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

  const fetchCategories = () => {
    if (!isAdmin) return;
    setCategoriesLoading(true);
    axios.get(`${API}/api/inventory/categories/`, { headers })
      .then(r => setCategories(r.data.results ?? r.data))
      .catch(() => toast.error('Failed to load coupon categories'))
      .finally(() => setCategoriesLoading(false));
  };

  useEffect(() => { fetchCoupons(); fetchCategories();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  const subcategoryOptions = useMemo(
    () => categories.flatMap(category => (category.subcategories || []).map(subcategory => ({ ...subcategory, category: category.id }))),
    [categories]
  );

  const tagOptions = useMemo(
    () => categories.flatMap(category => (category.tags || []).map(tag => ({ ...tag, category: category.id }))),
    [categories]
  );

  const categoryNameById = useMemo(
    () => new Map(categories.map(category => [category.id, category.name])),
    [categories]
  );

  const hasSelectedTargets = (
    form.selected_categories.length > 0 ||
    form.selected_subcategories.length > 0 ||
    form.selected_tags.length > 0 ||
    form.selected_products.length > 0
  );

  const selectedTargetLabels = useMemo(() => {
    const labels: string[] = [];
    form.selected_categories.forEach(id => labels.push(`${categoryNameById.get(id) || 'Category'} category`));
    form.selected_subcategories.forEach(id => {
      const subcategory = subcategoryOptions.find(option => option.id === id);
      labels.push(`${subcategory?.name || 'Subcategory'} subcategory`);
    });
    form.selected_tags.forEach(id => {
      const tag = tagOptions.find(option => option.id === id);
      labels.push(`${tag?.name || 'Tag'} tag`);
    });
    form.selected_products.forEach(product => labels.push(product.title));
    return labels;
  }, [categoryNameById, form.selected_categories, form.selected_products, form.selected_subcategories, form.selected_tags, subcategoryOptions, tagOptions]);

  const couponTargetSummary = (coupon: Coupon) => {
    const categoryCount = coupon.specific_category_details?.length ?? coupon.specific_categories?.length ?? 0;
    const subcategoryCount = coupon.specific_subcategory_details?.length ?? coupon.specific_subcategories?.length ?? 0;
    const tagCount = coupon.specific_tag_details?.length ?? coupon.specific_tags?.length ?? 0;
    const productCount = coupon.specific_product_details?.length ?? coupon.specific_products?.length ?? 0;
    const parts = [];
    if (categoryCount) parts.push(`${categoryCount} categor${categoryCount === 1 ? 'y' : 'ies'}`);
    if (subcategoryCount) parts.push(`${subcategoryCount} subcategor${subcategoryCount === 1 ? 'y' : 'ies'}`);
    if (tagCount) parts.push(`${tagCount} tag${tagCount === 1 ? '' : 's'}`);
    if (productCount) parts.push(`${productCount} product${productCount === 1 ? '' : 's'}`);
    return parts.length ? parts.join(', ') : 'All products';
  };

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
      selected_categories: c.specific_categories || (c.specific_category_details || []).map(category => category.id),
      selected_subcategories: c.specific_subcategories || (c.specific_subcategory_details || []).map(subcategory => subcategory.id),
      selected_tags: c.specific_tags || (c.specific_tag_details || []).map(tag => tag.id),
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
      specific_categories: form.selected_categories,
      specific_subcategories: form.selected_subcategories,
      specific_tags: form.selected_tags,
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
      <Navbar adminMode />
      <div className="max-w-4xl mx-auto px-2 sm:px-4 py-6 sm:py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl sm:text-4xl font-black text-pkmn-text">Coupons</h1>
            <p className="text-pkmn-gray">Manage promo codes</p>
          </div>
          <button onClick={openCreate} className="flex items-center gap-2 px-4 py-2 bg-pkmn-blue text-white rounded-md font-semibold hover:bg-pkmn-blue-dark transition-colors">
            <Plus size={18} /> New Coupon
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-pkmn-blue" />
          </div>
        ) : coupons.length === 0 ? (
          <div className="bg-white border-2 border-dashed border-pkmn-border p-8 text-center">
            <Tag className="w-12 h-12 text-pkmn-gray-dark mx-auto mb-4" />
            <h3 className="text-xl font-bold text-pkmn-text mb-2">No Coupons</h3>
            <p className="text-pkmn-gray">Create your first promo code.</p>
          </div>
        ) : (
          <div className="bg-white border border-pkmn-border overflow-hidden shadow-sm">
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
                      <div>{couponTargetSummary(c)}</div>
                      {c.requires_cash_only && <div className="text-amber-600">Cash only</div>}
                    </td>
                    <td className="px-4 py-3 text-pkmn-gray">
                      {c.times_used}{c.usage_limit > 0 ? ` / ${c.usage_limit}` : ' / ∞'}
                    </td>
                    <td className="px-4 py-3 text-pkmn-gray">
                      {c.expires_at ? new Date(c.expires_at).toLocaleDateString() : 'Never'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 text-xs font-semibold ${c.is_active ? 'bg-green-500/15 text-green-600' : 'bg-pkmn-red/15 text-pkmn-red'}`}>
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
            <div className="bg-white border border-pkmn-border shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto p-6">
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
                    className="w-full px-3 py-2 border border-pkmn-border rounded-md text-sm text-pkmn-text uppercase focus:ring-2 focus:ring-pkmn-blue"
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
                      className="w-full px-3 py-2 border border-pkmn-border rounded-md text-sm text-pkmn-text bg-white focus:ring-2 focus:ring-pkmn-blue focus:border-transparent focus:outline-none transition-colors duration-200"
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
                      className="w-full px-3 py-2 border border-pkmn-border rounded-md text-sm text-pkmn-text"
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
                      className="w-full px-3 py-2 border border-pkmn-border rounded-md text-sm text-pkmn-text"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-pkmn-gray mb-1">Expires At</label>
                    <input
                      type="datetime-local"
                      value={form.expires_at}
                      onChange={e => setForm({ ...form, expires_at: e.target.value })}
                      className="w-full px-3 py-2 border border-pkmn-border rounded-md text-sm text-pkmn-text"
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
                    className="w-full px-3 py-2 border border-pkmn-border rounded-md text-sm text-pkmn-text"
                    placeholder="0.00"
                  />
                </div>
                <div className="border border-pkmn-border p-4 space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-pkmn-gray mb-1">Product Targeting</label>
                      <p className="text-xs text-pkmn-gray">
                        Select whole categories like Cards, then add subcategories, tags, or individual products on top.
                      </p>
                    </div>
                    {hasSelectedTargets && (
                      <button
                        type="button"
                        onClick={() => setForm({ ...form, selected_categories: [], selected_subcategories: [], selected_tags: [], selected_products: [] })}
                        className="text-xs font-semibold text-pkmn-red hover:text-pkmn-red whitespace-nowrap"
                      >
                        Clear targeting
                      </button>
                    )}
                  </div>

                  {!hasSelectedTargets && (
                    <div className="border border-green-500/20 bg-green-500/10 px-3 py-2 text-sm font-semibold text-green-700">
                      No targeting selected; this coupon applies to every product.
                    </div>
                  )}

                  {hasSelectedTargets && (
                    <div className="border border-pkmn-blue/20 bg-pkmn-blue/5 px-3 py-2">
                      <p className="mb-2 text-xs font-semibold uppercase text-pkmn-blue-dark">Selected targets</p>
                      <div className="flex flex-wrap gap-1.5">
                        {selectedTargetLabels.map((label, index) => (
                          <span key={`${label}-${index}`} className="bg-white border border-pkmn-border px-2 py-1 text-xs font-medium text-pkmn-gray-dark">
                            {label}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Package size={14} className="text-pkmn-blue" />
                      <p className="text-xs font-semibold uppercase text-pkmn-gray">Whole Categories</p>
                    </div>
                    {categoriesLoading ? (
                      <p className="text-sm text-pkmn-gray">Loading categories...</p>
                    ) : categories.length === 0 ? (
                      <p className="text-sm text-pkmn-gray">No categories available.</p>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        {categories.map(category => {
                          const active = form.selected_categories.includes(category.id);
                          return (
                            <button
                              key={category.id}
                              type="button"
                              aria-pressed={active}
                              onClick={() => setForm({ ...form, selected_categories: toggleId(form.selected_categories, category.id) })}
                              className={targetButtonClass(active)}
                            >
                              <span className="block">{category.name}</span>
                              <span className="block text-[10px] font-medium opacity-75">All products in this category</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {subcategoryOptions.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold uppercase text-pkmn-gray mb-2">Subcategories</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-36 overflow-y-auto pr-1">
                        {subcategoryOptions.map(subcategory => {
                          const active = form.selected_subcategories.includes(subcategory.id);
                          return (
                            <button
                              key={subcategory.id}
                              type="button"
                              aria-pressed={active}
                              onClick={() => setForm({ ...form, selected_subcategories: toggleId(form.selected_subcategories, subcategory.id) })}
                              className={targetButtonClass(active)}
                            >
                              <span className="block">{subcategory.name}</span>
                              <span className="block text-[10px] font-medium opacity-75">{categoryNameById.get(subcategory.category || 0)}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {tagOptions.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <Tag size={14} className="text-pkmn-blue" />
                        <p className="text-xs font-semibold uppercase text-pkmn-gray">Custom Tags</p>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-36 overflow-y-auto pr-1">
                        {tagOptions.map(tag => {
                          const active = form.selected_tags.includes(tag.id);
                          return (
                            <button
                              key={tag.id}
                              type="button"
                              aria-pressed={active}
                              onClick={() => setForm({ ...form, selected_tags: toggleId(form.selected_tags, tag.id) })}
                              className={targetButtonClass(active)}
                            >
                              <span className="block">{tag.name}</span>
                              <span className="block text-[10px] font-medium opacity-75">{categoryNameById.get(tag.category || 0)}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div>
                    <p className="text-xs font-semibold uppercase text-pkmn-gray mb-1">Additional Specific Products</p>
                    <p className="mb-2 text-xs text-pkmn-gray">Use this for products outside selected categories, or for product-only coupons.</p>
                    {form.selected_products.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {form.selected_products.map(p => (
                          <span key={p.id} className="inline-flex items-center gap-1 bg-pkmn-blue/10 text-pkmn-blue-dark text-xs font-medium pl-2 pr-1 py-1">
                            {p.title}
                            <button
                              type="button"
                              onClick={() => setForm({ ...form, selected_products: form.selected_products.filter(sp => sp.id !== p.id) })}
                              className="p-0.5 hover:bg-pkmn-blue/20"
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
                      className="w-full flex items-center justify-center gap-2 py-2 border-2 border-dashed border-pkmn-border text-sm font-medium text-pkmn-gray hover:border-pkmn-blue hover:text-pkmn-blue hover:bg-pkmn-blue/5 transition-all"
                    >
                      <Package size={14} /> {form.selected_products.length > 0 ? 'Change Specific Products' : 'Add Specific Products'}
                    </button>
                  </div>
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
                  <button type="button" onClick={() => setShowForm(false)} className="flex-1 border border-pkmn-border text-pkmn-gray-dark font-semibold py-2 rounded-md hover:bg-pkmn-bg">Cancel</button>
                  <button type="submit" disabled={saving} className="flex-1 bg-pkmn-blue hover:bg-pkmn-blue-dark disabled:bg-pkmn-gray-dark text-white font-semibold py-2 rounded-md">
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
          coveredCategoryIds={form.selected_categories}
          coveredSubcategoryIds={form.selected_subcategories}
          coveredTagIds={form.selected_tags}
        />
      </div>
    </div>
  );
}
