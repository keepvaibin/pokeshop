"use client";

import { useEffect, useState } from 'react';
import axios from 'axios';
import Navbar from '../../components/Navbar';
import toast from 'react-hot-toast';
import { Trash2, Plus, X, Eye } from 'lucide-react';
import Image from 'next/image';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

interface PromoBanner {
  id: number;
  title: string;
  subtitle: string | null;
  image_url: string;
  link_url: string;
  size: string;
  position_order: number;
  is_active: boolean;
}

const defaultForm = { title: '', subtitle: '', image_url: '', link_url: '', size: 'QUARTER', position_order: 0 };

export default function PromosAdmin() {
  const [banners, setBanners] = useState<PromoBanner[]>([]);
  const [form, setForm] = useState(defaultForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : '';
  const headers = { Authorization: `Bearer ${token}` };

  const fetchBanners = () => {
    setLoading(true);
    axios.get(`${API}/api/inventory/promo-banners/`, { headers })
      .then(r => setBanners(Array.isArray(r.data) ? r.data : r.data.results || []))
      .catch(() => toast.error('Failed to load banners'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchBanners(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const saveBanner = () => {
    if (!form.title || !form.image_url || !form.link_url) {
      toast.error('Title, Image URL, and Link URL are required');
      return;
    }
    const data = { ...form, subtitle: form.subtitle || null, position_order: Number(form.position_order) };
    const req = editingId
      ? axios.put(`${API}/api/inventory/promo-banners/${editingId}/`, data, { headers })
      : axios.post(`${API}/api/inventory/promo-banners/`, data, { headers });

    req
      .then(() => {
        toast.success(editingId ? 'Banner updated' : 'Banner created');
        setForm(defaultForm);
        setEditingId(null);
        fetchBanners();
      })
      .catch(e => toast.error(e.response?.data?.detail || 'Failed to save'));
  };

  const deleteBanner = (id: number) => {
    if (!confirm('Delete this banner?')) return;
    axios.delete(`${API}/api/inventory/promo-banners/${id}/`, { headers })
      .then(() => { toast.success('Deleted'); fetchBanners(); })
      .catch(() => toast.error('Failed to delete'));
  };

  const previewSrc = form.image_url || '';

  return (
    <div className="bg-white min-h-screen">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-black text-pkmn-text uppercase mb-6">Promo Banner Management</h1>

        {/* 2-column layout: Form + Preview */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
          {/* Form */}
          <div className="bg-pkmn-bg border border-pkmn-border rounded-lg p-6">
            <h3 className="font-bold text-pkmn-text mb-4">{editingId ? 'Edit Banner' : 'New Banner'}</h3>
            <div className="space-y-3">
              <input
                placeholder="Title"
                value={form.title}
                onChange={e => setForm({ ...form, title: e.target.value })}
                className="w-full bg-white border border-pkmn-border p-2.5 rounded text-sm focus:outline-none focus:border-pkmn-blue"
              />
              <input
                placeholder="Subtitle (optional)"
                value={form.subtitle}
                onChange={e => setForm({ ...form, subtitle: e.target.value })}
                className="w-full bg-white border border-pkmn-border p-2.5 rounded text-sm focus:outline-none focus:border-pkmn-blue"
              />
              <input
                placeholder="Image URL"
                value={form.image_url}
                onChange={e => setForm({ ...form, image_url: e.target.value })}
                className="w-full bg-white border border-pkmn-border p-2.5 rounded text-sm focus:outline-none focus:border-pkmn-blue"
              />
              <input
                placeholder="Link URL (e.g. /tcg/cards or /new-releases)"
                value={form.link_url}
                onChange={e => setForm({ ...form, link_url: e.target.value })}
                className="w-full bg-white border border-pkmn-border p-2.5 rounded text-sm focus:outline-none focus:border-pkmn-blue"
              />
              <div className="grid grid-cols-2 gap-3">
                <select
                  value={form.size}
                  onChange={e => setForm({ ...form, size: e.target.value })}
                  className="bg-white border border-pkmn-border p-2.5 rounded text-sm focus:outline-none focus:border-pkmn-blue"
                >
                  <option value="FULL">Full Width</option>
                  <option value="HALF">Half Width</option>
                  <option value="QUARTER">Quarter (Grid)</option>
                </select>
                <input
                  type="number"
                  placeholder="Position Order"
                  value={form.position_order}
                  onChange={e => setForm({ ...form, position_order: parseInt(e.target.value) || 0 })}
                  className="bg-white border border-pkmn-border p-2.5 rounded text-sm focus:outline-none focus:border-pkmn-blue"
                />
              </div>
              <div className="flex gap-3">
                <button onClick={saveBanner} className="bg-pkmn-blue text-white font-bold px-6 py-2 rounded-md text-sm hover:bg-pkmn-blue-dark transition-colors">
                  {editingId ? 'Update' : 'Create'}
                </button>
                {editingId && (
                  <button onClick={() => { setForm(defaultForm); setEditingId(null); }} className="border border-pkmn-border text-pkmn-text font-bold px-6 py-2 rounded-md text-sm hover:bg-pkmn-bg transition-colors">
                    Cancel
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Live Preview */}
          <div className="bg-pkmn-bg border border-pkmn-border rounded-lg p-6">
            <h3 className="font-bold text-pkmn-text mb-4 flex items-center gap-2"><Eye size={16} /> Live Preview</h3>
            <div className="relative w-full aspect-video rounded-lg overflow-hidden bg-pkmn-bg">
              {previewSrc ? (
                <Image
                  src={previewSrc}
                  alt="Preview"
                  fill
                  className="object-cover"
                  unoptimized
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-pkmn-gray">
                  Enter an image URL to preview
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
              <div className="absolute bottom-4 left-4 text-white z-10">
                <h4 className="font-bold text-xl">{form.title || 'Banner Title'}</h4>
                {form.subtitle && <p className="text-sm text-white/80">{form.subtitle}</p>}
              </div>
            </div>
          </div>
        </div>

        {/* Existing Banners Table */}
        <h2 className="text-lg font-black text-pkmn-text uppercase mb-4">Existing Banners</h2>
        {loading ? (
          <p className="text-pkmn-gray text-center py-8">Loading...</p>
        ) : banners.length === 0 ? (
          <p className="text-pkmn-gray text-center py-8">No banners yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-pkmn-bg text-pkmn-text uppercase text-xs font-bold">
                  <th className="p-3 text-left">Order</th>
                  <th className="p-3 text-left">Title</th>
                  <th className="p-3 text-left">Size</th>
                  <th className="p-3 text-left">Link</th>
                  <th className="p-3 text-left">Active</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {banners.map(b => (
                  <tr key={b.id} className="border-b border-pkmn-border hover:bg-pkmn-bg transition-colors">
                    <td className="p-3">{b.position_order}</td>
                    <td className="p-3 font-bold">{b.title}</td>
                    <td className="p-3">{b.size}</td>
                    <td className="p-3 text-pkmn-blue">{b.link_url}</td>
                    <td className="p-3">{b.is_active ? '✓' : '✗'}</td>
                    <td className="p-3 text-right">
                      <button
                        onClick={() => {
                          setForm({
                            title: b.title,
                            subtitle: b.subtitle || '',
                            image_url: b.image_url,
                            link_url: b.link_url,
                            size: b.size,
                            position_order: b.position_order,
                          });
                          setEditingId(b.id);
                        }}
                        className="text-pkmn-blue hover:underline text-xs font-bold mr-3"
                      >
                        Edit
                      </button>
                      <button onClick={() => deleteBanner(b.id)} className="text-pkmn-red hover:text-pkmn-red-dark">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
