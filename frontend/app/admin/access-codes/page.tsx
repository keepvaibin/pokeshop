"use client";

import { useState, useEffect } from 'react';
import axios from 'axios';
import { useRequireAuth } from '../../hooks/useRequireAuth';
import Navbar from '../../components/Navbar';
import { Plus, Trash2, Edit2, X, Key } from 'lucide-react';
import toast from 'react-hot-toast';

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
    axios.get('http://localhost:8000/api/inventory/access-codes/', { headers })
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
        await axios.put(`http://localhost:8000/api/inventory/access-codes/${editingId}/`, buildPayload(), { headers });
        toast.success('Access code updated');
      } else {
        await axios.post('http://localhost:8000/api/inventory/access-codes/', buildPayload(), { headers });
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
      await axios.delete(`http://localhost:8000/api/inventory/access-codes/${id}/`, { headers });
      toast.success('Access code deleted');
      fetchCodes();
    } catch {
      toast.error('Failed to delete access code.');
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
            <h1 className="text-3xl sm:text-4xl font-black text-gray-900 dark:text-zinc-100">Access Codes</h1>
            <p className="text-gray-600">Manage codes for non-UCSC users</p>
          </div>
          <button onClick={openCreate} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors">
            <Plus size={18} /> New Code
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          </div>
        ) : codes.length === 0 ? (
          <div className="bg-white dark:bg-zinc-800 border-2 border-dashed border-gray-300 dark:border-zinc-600 rounded-2xl p-8 text-center">
            <Key className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-xl font-bold text-gray-800 mb-2">No Access Codes</h3>
            <p className="text-gray-600">Create codes to allow non-UCSC users to register.</p>
          </div>
        ) : (
          <div className="bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-zinc-900 border-b border-gray-200 dark:border-zinc-700">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Code</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Usage</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Expires</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Note</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Status</th>
                  <th className="text-right px-4 py-3 font-semibold text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody>
                {codes.map(c => (
                  <tr key={c.id} className="border-b border-gray-100 hover:bg-gray-50 dark:hover:bg-zinc-800">
                    <td className="px-4 py-3 font-mono font-bold text-gray-900 dark:text-zinc-100">{c.code}</td>
                    <td className="px-4 py-3 text-gray-600">
                      {c.times_used}{c.usage_limit > 0 ? ` / ${c.usage_limit}` : ' / ∞'}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {c.expires_at ? new Date(c.expires_at).toLocaleDateString() : 'Never'}
                    </td>
                    <td className="px-4 py-3 text-gray-500 truncate max-w-[200px]">{c.note || '—'}</td>
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
            <div className="bg-white dark:bg-zinc-800 rounded-2xl shadow-2xl max-w-md w-full p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-gray-900 dark:text-zinc-100">{editingId ? 'Edit Access Code' : 'New Access Code'}</h3>
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
                    placeholder="FRIEND2025"
                    required
                  />
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
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Note (internal)</label>
                  <input
                    type="text"
                    value={form.note}
                    onChange={e => setForm({ ...form, note: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 dark:border-zinc-700 rounded-lg text-sm text-gray-900 dark:text-zinc-100"
                    placeholder="Issued for..."
                  />
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
