"use client";

import { useEffect, useState } from 'react';
import axios from 'axios';
import Navbar from '../../components/Navbar';
import toast from 'react-hot-toast';
import { Trash2, Plus, X } from 'lucide-react';
import { API_BASE_URL as API } from '@/app/lib/api';

interface SubCategory {
  id: number;
  name: string;
  slug: string;
  is_active: boolean;
}

interface Category {
  id: number;
  name: string;
  slug: string;
  image_url: string | null;
  is_active: boolean;
  is_core: boolean;
  subcategories: SubCategory[];
}

export default function CategoriesAdmin() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [showSubForm, setShowSubForm] = useState<number | null>(null);
  const [form, setForm] = useState({ name: '', slug: '', image_url: '' });
  const [subForm, setSubForm] = useState({ name: '', slug: '' });
  const [loading, setLoading] = useState(true);

  const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : '';
  const headers = { Authorization: `Bearer ${token}` };

  const fetchCategories = () => {
    setLoading(true);
    axios.get(`${API}/api/inventory/categories/`, { headers })
      .then(r => setCategories(Array.isArray(r.data) ? r.data : r.data.results || []))
      .catch(() => toast.error('Failed to load categories'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    axios.get(`${API}/api/inventory/categories/`, { headers })
      .then(r => setCategories(Array.isArray(r.data) ? r.data : r.data.results || []))
      .catch(() => toast.error('Failed to load categories'))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createCategory = () => {
    if (!form.name || !form.slug) { toast.error('Name and slug are required'); return; }
    axios.post(`${API}/api/inventory/categories/`, {
      name: form.name,
      slug: form.slug,
      image_url: form.image_url || null,
    }, { headers })
      .then(() => {
        toast.success('Category created');
        setForm({ name: '', slug: '', image_url: '' });
        setShowForm(false);
        fetchCategories();
      })
      .catch(e => toast.error(e.response?.data?.detail || 'Failed to create'));
  };

  const deleteCategory = (slug: string, name: string) => {
    if (!confirm(`Delete category "${name}"? This will remove all subcategories too.`)) return;
    axios.delete(`${API}/api/inventory/categories/${slug}/`, { headers })
      .then(() => { toast.success('Deleted'); fetchCategories(); })
      .catch(() => toast.error('Failed to delete'));
  };

  const createSubCategory = (categoryId: number) => {
    if (!subForm.name || !subForm.slug) { toast.error('Name and slug required'); return; }
    axios.post(`${API}/api/inventory/subcategories/`, {
      category: categoryId,
      name: subForm.name,
      slug: subForm.slug,
    }, { headers })
      .then(() => {
        toast.success('Subcategory created');
        setSubForm({ name: '', slug: '' });
        setShowSubForm(null);
        fetchCategories();
      })
      .catch(e => toast.error(e.response?.data?.detail || 'Failed to create'));
  };

  const deleteSubCategory = (id: number, name: string) => {
    if (!confirm(`Delete subcategory "${name}"?`)) return;
    axios.delete(`${API}/api/inventory/subcategories/${id}/`, { headers })
      .then(() => { toast.success('Deleted'); fetchCategories(); })
      .catch(() => toast.error('Failed to delete'));
  };

  return (
    <div className="bg-white min-h-screen">
      <Navbar adminMode />
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-black text-pkmn-text uppercase">Category Management</h1>
          <button
            onClick={() => setShowForm(!showForm)}
            className="bg-pkmn-blue text-white font-bold px-4 py-2 rounded-md hover:bg-pkmn-blue-dark transition-colors text-sm uppercase tracking-wide flex items-center gap-2"
          >
            <Plus size={16} /> New Category
          </button>
        </div>

        {showForm && (
          <div className="bg-pkmn-bg border border-pkmn-border rounded-md p-4 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-pkmn-text">New Category</h3>
              <button onClick={() => setShowForm(false)}><X size={18} className="text-pkmn-gray" /></button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <input
                placeholder="Name"
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value, slug: e.target.value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') })}
                className="bg-white border border-pkmn-border p-2.5 rounded text-sm focus:outline-none focus:border-pkmn-blue"
              />
              <input
                placeholder="Slug"
                value={form.slug}
                onChange={e => setForm({ ...form, slug: e.target.value })}
                className="bg-white border border-pkmn-border p-2.5 rounded text-sm focus:outline-none focus:border-pkmn-blue"
              />
              <input
                placeholder="Image URL (optional)"
                value={form.image_url}
                onChange={e => setForm({ ...form, image_url: e.target.value })}
                className="bg-white border border-pkmn-border p-2.5 rounded text-sm focus:outline-none focus:border-pkmn-blue"
              />
            </div>
            <button onClick={createCategory} className="mt-4 bg-pkmn-blue text-white font-bold px-6 py-2 rounded-md text-sm hover:bg-pkmn-blue-dark transition-colors">
              Create
            </button>
          </div>
        )}

        {loading ? (
          <p className="text-pkmn-gray text-center py-12">Loading...</p>
        ) : categories.length === 0 ? (
          <p className="text-pkmn-gray text-center py-12">No categories yet. Create one above.</p>
        ) : (
          <div className="space-y-4">
            {categories.map(cat => (
              <div key={cat.id} className="bg-white border border-pkmn-border rounded-md overflow-hidden">
                <div className="flex items-center justify-between p-4 bg-pkmn-bg">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-pkmn-text">{cat.name}</h3>
                      {cat.is_core && (
                        <span className="text-xs bg-pkmn-blue text-white px-1.5 py-0.5 rounded font-bold uppercase tracking-wide">Core</span>
                      )}
                    </div>
                    <p className="text-xs text-pkmn-gray">/{cat.slug} &bull; {cat.subcategories.length} subcategories</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setShowSubForm(showSubForm === cat.id ? null : cat.id)}
                      className="text-pkmn-blue text-xs font-bold hover:underline"
                    >
                      + Add Sub
                    </button>
                    {!cat.is_core && (
                      <button onClick={() => deleteCategory(cat.slug, cat.name)} className="text-pkmn-red hover:text-pkmn-red-dark transition-colors">
                        <Trash2 size={16} />
                      </button>
                    )}
                    {cat.is_core && (
                      <span title="Core categories cannot be deleted">
                        <Trash2 size={16} className="text-pkmn-border cursor-not-allowed" />
                      </span>
                    )}
                  </div>
                </div>

                {showSubForm === cat.id && (
                  <div className="px-4 py-3 border-t border-pkmn-border bg-white">
                    <div className="flex gap-3">
                      <input
                        placeholder="Subcategory name"
                        value={subForm.name}
                        onChange={e => setSubForm({ name: e.target.value, slug: e.target.value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') })}
                        className="flex-1 bg-white border border-pkmn-border p-2 rounded text-sm focus:outline-none focus:border-pkmn-blue"
                      />
                      <input
                        placeholder="Slug"
                        value={subForm.slug}
                        onChange={e => setSubForm({ ...subForm, slug: e.target.value })}
                        className="flex-1 bg-white border border-pkmn-border p-2 rounded text-sm focus:outline-none focus:border-pkmn-blue"
                      />
                      <button onClick={() => createSubCategory(cat.id)} className="bg-pkmn-blue text-white font-bold px-4 py-2 rounded text-sm">
                        Add
                      </button>
                    </div>
                  </div>
                )}

                {cat.subcategories.length > 0 && (
                  <div className="px-4 pb-3">
                    {cat.subcategories.map(sub => (
                      <div key={sub.id} className="flex items-center justify-between py-2 border-b border-pkmn-border last:border-0">
                        <span className="text-sm text-pkmn-text ml-4">{sub.name} <span className="text-pkmn-gray">/{sub.slug}</span></span>
                        <button onClick={() => deleteSubCategory(sub.id, sub.name)} className="text-pkmn-red hover:text-pkmn-red-dark">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
