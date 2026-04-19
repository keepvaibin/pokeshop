"use client";

import { useState, useEffect } from 'react';
import axios from 'axios';
import { useRequireAuth } from '../../hooks/useRequireAuth';
import Navbar from '../../components/Navbar';
import { Plus, Trash2, Edit2, X, Key } from 'lucide-react';
import toast from 'react-hot-toast';
import { API_BASE_URL as API } from '@/app/lib/api';

interface AccessCode {
  id: number;
  code: string;
  usage_limit: number;
  times_used: number;
  expires_at: string | null;
  is_active: boolean;
  note: string;
  created_at: string;
}

type CodeForm = {
  code: string;
  usage_limit: string;
  expires_at: string;
  is_active: boolean;
  note: string;
};

const emptyForm: CodeForm = { code: '', usage_limit: '1', expires_at: '', is_active: true, note: '' };

export default function AdminAccessCodesPage() {
  const { user } = useRequireAuth({ adminOnly: true });
  const [codes, setCodes] = useState<AccessCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<CodeForm>(emptyForm);
  const [saving, setSaving] = useState(false);

  const isAdmin = user?.is_admin;
  const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
  const headers = { Authorization: `Bearer ${token}` };

  const fetchCodes = () => {
    if (!isAdmin) return;
    setLoading(true);
    axios.get(`${API}/api/inventory/access-codes/`, { headers })
      .then(r => setCodes(r.data.results ?? r.data))
      .catch(() => toast.error('Failed to load access codes'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchCodes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(true);
  };

  const openEdit = (c: AccessCode) => {
    setEditingId(c.id);
    setForm({
      code: c.code,
      usage_limit: String(c.usage_limit),
      expires_at: c.expires_at ? c.expires_at.slice(0, 16) : '',
      is_active: c.is_active,
      note: c.note,
    });
    setShowForm(true);
  };

  const buildPayload = () => ({
    code: form.code.trim().toUpperCase(),
    usage_limit: parseInt(form.usage_limit) || 1,
    expires_at: form.expires_at || null,
    is_active: form.is_active,
    note: form.note.trim(),
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.code.trim()) { toast.error('Code is required.'); return; }
    setSaving(true);
    try {
      if (editingId) {
        await axios.put(`${API}/api/inventory/access-codes/${editingId}/`, buildPayload(), { headers });
        toast.success('Access code updated');
      } else {
        await axios.post(`${API}/api/inventory/access-codes/`, buildPayload(), { headers });
        toast.success('Access code created');
      }
      setShowForm(false);
      fetchCodes();
    } catch {
      toast.error('Failed to save access code.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this access code?')) return;
    try {
      await axios.delete(`${API}/api/inventory/access-codes/${id}/`, { headers });
      toast.success('Access code deleted');
      fetchCodes();
    } catch {
      toast.error('Failed to delete access code.');
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
            <h1 className="text-3xl sm:text-4xl font-black text-pkmn-text">Access Codes</h1>
            <p className="text-pkmn-gray">Manage codes for non-UCSC users</p>
          </div>
          <button onClick={openCreate} className="flex items-center gap-2 px-4 py-2 bg-pkmn-blue text-white rounded-md font-semibold hover:bg-pkmn-blue-dark transition-colors">
            <Plus size={18} /> New Code
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-pkmn-blue" />
          </div>
        ) : codes.length === 0 ? (
          <div className="bg-white border-2 border-dashed border-pkmn-border p-8 text-center">
            <Key className="w-12 h-12 text-pkmn-gray-dark mx-auto mb-4" />
            <h3 className="text-xl font-bold text-pkmn-text mb-2">No Access Codes</h3>
            <p className="text-pkmn-gray">Create codes to allow non-UCSC users to register.</p>
          </div>
        ) : (
          <div className="bg-white border border-pkmn-border overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-pkmn-bg border-b border-pkmn-border">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold text-pkmn-gray">Code</th>
                  <th className="text-left px-4 py-3 font-semibold text-pkmn-gray">Usage</th>
                  <th className="text-left px-4 py-3 font-semibold text-pkmn-gray">Expires</th>
                  <th className="text-left px-4 py-3 font-semibold text-pkmn-gray">Note</th>
                  <th className="text-left px-4 py-3 font-semibold text-pkmn-gray">Status</th>
                  <th className="text-right px-4 py-3 font-semibold text-pkmn-gray">Actions</th>
                </tr>
              </thead>
              <tbody>
                {codes.map(c => (
                  <tr key={c.id} className="border-b border-pkmn-border even:bg-pkmn-bg/50 even: hover:bg-pkmn-bg">
                    <td className="px-4 py-3 font-mono font-bold text-pkmn-text">{c.code}</td>
                    <td className="px-4 py-3 text-pkmn-gray">
                      {c.times_used}{c.usage_limit > 0 ? ` / ${c.usage_limit}` : ' / ∞'}
                    </td>
                    <td className="px-4 py-3 text-pkmn-gray">
                      {c.expires_at ? new Date(c.expires_at).toLocaleDateString() : 'Never'}
                    </td>
                    <td className="px-4 py-3 text-pkmn-gray truncate max-w-[200px]">{c.note || '-'}</td>
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
            <div className="bg-white border border-pkmn-border shadow-2xl max-w-md w-full p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-pkmn-text">{editingId ? 'Edit Access Code' : 'New Access Code'}</h3>
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
                    placeholder="FRIEND2025"
                    required
                  />
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
                  <label className="block text-xs font-semibold text-pkmn-gray mb-1">Note (internal)</label>
                  <input
                    type="text"
                    value={form.note}
                    onChange={e => setForm({ ...form, note: e.target.value })}
                    className="w-full px-3 py-2 border border-pkmn-border rounded-md text-sm text-pkmn-text"
                    placeholder="Issued for..."
                  />
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
                  <button type="button" onClick={() => setShowForm(false)} className="flex-1 border border-pkmn-border text-pkmn-gray-dark font-semibold py-2 rounded-md hover:bg-pkmn-bg">Cancel</button>
                  <button type="submit" disabled={saving} className="flex-1 bg-pkmn-blue hover:bg-pkmn-blue-dark disabled:bg-pkmn-gray-dark text-white font-semibold py-2 rounded-md">
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
