"use client";

import { useState, useEffect, useRef, type FormEvent } from 'react';
import dynamic from 'next/dynamic';
import axios from 'axios';
import Link from 'next/link';
import { useRequireAuth } from '../../hooks/useRequireAuth';
import Navbar from '../../components/Navbar';
import { UploadCloud, AlertCircle, X, ImagePlus, Pencil, Trash2, Eye, EyeOff, Plus, ImageIcon, Package, Monitor, Smartphone, Star, ShoppingCart, Minus as MinusIcon, Plus as PlusIcon, ArrowLeft } from 'lucide-react';
import FallbackImage from '../../components/FallbackImage';
import toast from 'react-hot-toast';
import RichText from '../../components/RichText';
import DraggableImageList from '../../components/DraggableImageList';
import DraggableFileList from '../../components/DraggableFileList';
import 'react-quill-new/dist/quill.snow.css';

const ReactQuill = dynamic(() => import('react-quill-new'), { ssr: false });

const quillModules = {
  toolbar: [
    ['bold', 'italic', 'underline', 'strike'],
    [{ list: 'ordered' }, { list: 'bullet' }],
    [{ header: [1, 2, 3, false] }],
    ['link'],
    ['clean'],
  ],
  table: true,
};

const quillFormats = ['bold', 'italic', 'underline', 'strike', 'list', 'header', 'link', 'table'];

export default function AdminInventoryPage() {
  const { user } = useRequireAuth({ adminOnly: true });
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [shortDescription, setShortDescription] = useState('');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('');
  const [maxPerUser, setMaxPerUser] = useState('1');
  const [goLiveDate, setGoLiveDate] = useState('');
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [status, setStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);

  // Inventory table state
  interface InventoryItem {
    id: number;
    title: string;
    slug: string;
    price: string;
    stock: number;
    max_per_user: number;
    is_active: boolean;
    description: string;
    short_description: string;
    go_live_date: string | null;
    images: { id: number; url: string; position: number }[];
  }
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(true);
  const [editItem, setEditItem] = useState<InventoryItem | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editPrice, setEditPrice] = useState('');
  const [editStock, setEditStock] = useState('');
  const [editMaxPerUser, setEditMaxPerUser] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editShortDescription, setEditShortDescription] = useState('');
  const [editGoLiveDate, setEditGoLiveDate] = useState('');
  const [editImages, setEditImages] = useState<File[]>([]);
  const [editImageUrls, setEditImageUrls] = useState<string[]>([]);
  const [editSaving, setEditSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [previewAdd, setPreviewAdd] = useState(false);
  const [previewEdit, setPreviewEdit] = useState(false);
  const [livePreview, setLivePreview] = useState<{ title: string; description: string; shortDescription: string; price: string; stock: string; maxPerUser: string; imageUrls: string[] } | null>(null);
  const [livePreviewTab, setLivePreviewTab] = useState<'quick' | 'full'>('quick');

  const isAdmin = user?.is_admin;
  const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
  const headers = { Authorization: `Bearer ${token}` };

  const fetchItems = () => {
    setItemsLoading(true);
    axios
      .get('http://localhost:8000/api/inventory/items/', { headers })
      .then(r => setItems(r.data))
      .catch(() => {})
      .finally(() => setItemsLoading(false));
  };

  useEffect(() => {
    if (isAdmin) fetchItems();
  }, [isAdmin]);

  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const imageUrlsRef = useRef<string[]>([]);
  imageUrlsRef.current = imageUrls;

  // Revoke blob URLs on unmount only
  useEffect(() => {
    return () => { imageUrlsRef.current.forEach(url => URL.revokeObjectURL(url)); };
  }, []);

  const addFiles = (files: FileList | null) => {
    if (!files) return;
    const newFiles = Array.from(files);
    const newUrls = newFiles.map(f => URL.createObjectURL(f));
    setImageFiles(prev => [...prev, ...newFiles]);
    setImageUrls(prev => [...prev, ...newUrls]);
  };

  const removeFile = (idx: number) => {
    URL.revokeObjectURL(imageUrls[idx]);
    setImageFiles(prev => prev.filter((_, i) => i !== idx));
    setImageUrls(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus('saving');
    setMessage('');

    try {
      const token = localStorage.getItem('access_token');
      const formData = new FormData();
      formData.append('title', title);
      formData.append('description', description);
      formData.append('short_description', shortDescription);
      formData.append('stock', stock || '0');
      formData.append('max_per_user', maxPerUser || '1');
      formData.append('is_active', 'true');
      if (price) formData.append('price', price);
      if (goLiveDate) formData.append('go_live_date', new Date(goLiveDate).toISOString());
      imageFiles.forEach(f => formData.append('images', f));

      const response = await axios.post('http://localhost:8000/api/inventory/items/', formData, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'multipart/form-data',
        },
      });

      setStatus('success');
      setMessage(`Created item: ${response.data.title} (slug: ${response.data.slug})`);
      toast.success(`Item "${response.data.title}" created!`);
      setTitle('');
      setDescription('');
      setShortDescription('');
      setPrice('');
      setStock('');
      setMaxPerUser('1');
      setGoLiveDate('');
      imageUrls.forEach(url => URL.revokeObjectURL(url));
      setImageFiles([]);
      setImageUrls([]);
      setShowAddModal(false);
      fetchItems();
    } catch (error) {
      setStatus('error');
      setMessage('Unable to create item. Please check your inputs and try again.');
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-gray-800 px-4">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4" />
          <p className="text-gray-600">Redirecting to login&hellip;</p>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-gray-800 px-4">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4" />
          <p className="text-gray-600">Redirecting to login&hellip;</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-100 dark:bg-gray-800 min-h-screen">
      <Navbar />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-10">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-blue-600">Admin Inventory</p>
            <h1 className="mt-3 text-3xl sm:text-4xl font-extrabold text-gray-900 dark:text-gray-100">Manage Inventory</h1>
            <p className="mt-2 text-gray-600 max-w-2xl">
              View, edit, and manage your store items.
            </p>
          </div>
          <button
            onClick={() => { setShowAddModal(true); setStatus('idle'); setMessage(''); }}
            className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-200/40 transition hover:bg-blue-700 active:scale-95"
          >
            <Plus className="w-5 h-5" />
            Add New Item
          </button>
        </div>

        {/* Inventory Data Table */}
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-3xl p-8 shadow-sm">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">Current Inventory</h2>

          {itemsLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              <span className="ml-3 text-gray-600">Loading items...</span>
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-12">
              <Package className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-500 mb-4">No items yet. Add your first item to get started!</p>
              <button
                onClick={() => setShowAddModal(true)}
                className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-6 py-3 text-sm font-semibold text-white hover:bg-blue-700 transition"
              >
                <Plus className="w-4 h-4" />
                Add Your First Item
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700">
                    <th className="text-left py-3 px-2 font-semibold text-gray-600">Image</th>
                    <th className="text-left py-3 px-2 font-semibold text-gray-600">Title</th>
                    <th className="text-left py-3 px-2 font-semibold text-gray-600">Price</th>
                    <th className="text-left py-3 px-2 font-semibold text-gray-600">Stock</th>
                    <th className="text-left py-3 px-2 font-semibold text-gray-600">Status</th>
                    <th className="text-right py-3 px-2 font-semibold text-gray-600">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id} className={`border-b border-gray-100 hover:bg-gray-50 dark:hover:bg-zinc-800 transition-colors ${!item.is_active ? 'opacity-60' : ''}`}>
                      <td className="py-3 px-2">
                        {item.images?.[0]?.url ? (
                          <FallbackImage src={item.images[0].url} alt="" className="w-10 h-10 object-cover rounded-lg" fallbackClassName="w-10 h-10 bg-gray-200 rounded-lg flex items-center justify-center text-gray-400" fallbackSize={16} />
                        ) : (
                          <div className="w-10 h-10 bg-gray-200 rounded-lg flex items-center justify-center text-gray-400"><ImageIcon size={16} /></div>
                        )}
                      </td>
                      <td className="py-3 px-2 font-medium text-gray-900 dark:text-gray-100">{item.title}</td>
                      <td className="py-3 px-2 text-gray-700">${Number(item.price).toFixed(2)}</td>
                      <td className="py-3 px-2 text-gray-700">{item.stock}</td>
                      <td className="py-3 px-2">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${item.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 dark:bg-gray-800 text-gray-600'}`}>
                          {item.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="py-3 px-2 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => {
                              setEditItem(item);
                              setEditTitle(item.title);
                              setEditPrice(String(item.price));
                              setEditStock(String(item.stock));
                              setEditMaxPerUser(String(item.max_per_user));
                              setEditDescription(item.description);
                              setEditShortDescription(item.short_description || '');
                              setEditGoLiveDate(item.go_live_date ? item.go_live_date.slice(0, 16) : '');
                              setEditImages([]);
                              setEditImageUrls(prev => { prev.forEach(u => URL.revokeObjectURL(u)); return []; });
                            }}
                            className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                            title="Edit"
                          >
                            <Pencil size={16} />
                          </button>
                          <button
                            onClick={async () => {
                              try {
                                await axios.patch(`http://localhost:8000/api/inventory/items/${item.slug}/`, { is_active: !item.is_active }, { headers });
                                setItems(prev => prev.map(i => i.id === item.id ? { ...i, is_active: !i.is_active } : i));
                                toast.success(`Item ${item.is_active ? 'deactivated' : 'activated'}`);
                              } catch { toast.error('Failed to toggle status.'); }
                            }}
                            className={`p-1.5 rounded-lg transition-colors ${item.is_active ? 'text-orange-600 hover:bg-orange-50' : 'text-green-600 hover:bg-green-50'}`}
                            title={item.is_active ? 'Deactivate' : 'Activate'}
                          >
                            {item.is_active ? <EyeOff size={16} /> : <Eye size={16} />}
                          </button>
                          <button
                            onClick={() => setDeleteConfirm(item.slug)}
                            className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            title="Delete"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Add New Item Modal */}
        {showAddModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setShowAddModal(false)}>
            <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">Add New Item</h3>
                  <p className="text-sm text-gray-500 mt-0.5">Create a new inventory item with images</p>
                </div>
                <button onClick={() => setShowAddModal(false)} className="p-1.5 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-full transition-colors"><X size={20} /></button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="text-sm font-semibold text-gray-700">Name *</span>
                    <input
                      value={title}
                      onChange={e => setTitle(e.target.value)}
                      required
                      placeholder="Enter item name"
                      className="mt-1.5 block w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 px-4 py-2.5 text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    />
                  </label>
                  <label className="block">
                    <span className="text-sm font-semibold text-gray-700">Stock</span>
                    <input
                      type="number"
                      min={0}
                      value={stock}
                      onChange={e => setStock(e.target.value)}
                      placeholder="0"
                      className="mt-1.5 block w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 px-4 py-2.5 text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    />
                  </label>
                </div>

                <div className="grid gap-4 sm:grid-cols-3">
                  <label className="block">
                    <span className="text-sm font-semibold text-gray-700">Price ($)</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={price}
                      onChange={e => setPrice(e.target.value)}
                      placeholder="9.99"
                      className="mt-1.5 block w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 px-4 py-2.5 text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    />
                  </label>
                  <label className="block">
                    <span className="text-sm font-semibold text-gray-700">Max/User</span>
                    <input
                      type="number"
                      min="1"
                      value={maxPerUser}
                      onChange={e => setMaxPerUser(e.target.value)}
                      placeholder="1"
                      className="mt-1.5 block w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 px-4 py-2.5 text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    />
                  </label>
                  <div className="block">
                    <span className="text-sm font-semibold text-gray-700">Images</span>
                    <label className="mt-1.5 flex items-center gap-2 cursor-pointer rounded-xl border border-dashed border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-950 px-4 py-2.5 hover:border-blue-400 hover:bg-blue-50 transition-colors">
                      <ImagePlus className="w-5 h-5 text-blue-600" />
                      <span className="text-sm text-gray-600">Add&hellip;</span>
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        onChange={e => addFiles(e.target.files)}
                        className="hidden"
                      />
                    </label>
                  </div>
                </div>

                <label className="block">
                  <span className="text-sm font-semibold text-gray-700">Go Live Date</span>
                  <input
                    type="datetime-local"
                    value={goLiveDate}
                    onChange={e => setGoLiveDate(e.target.value)}
                    className="mt-1.5 block w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 px-4 py-2.5 text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                  <p className="text-xs text-gray-500 mt-1">Optional — leave empty to publish immediately</p>
                </label>

                <DraggableFileList
                  files={imageFiles}
                  urls={imageUrls}
                  onReorder={(f, u) => { setImageFiles(f); setImageUrls(u); }}
                  onRemove={(idx) => removeFile(idx)}
                />

                <label className="block">
                  <span className="text-sm font-semibold text-gray-700">Short Description</span>
                  <input
                    value={shortDescription}
                    onChange={e => setShortDescription(e.target.value)}
                    maxLength={300}
                    placeholder="Brief summary shown on the storefront card"
                    className="mt-1.5 block w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 px-4 py-2.5 text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                  <p className="text-xs text-gray-500 mt-1">{shortDescription.length}/300 — shown on product cards</p>
                </label>

                <div className="block">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-gray-700">Description</span>
                    <button type="button" onClick={() => setPreviewAdd(!previewAdd)} className="text-xs text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1">
                      <Eye size={12} /> {previewAdd ? 'Edit' : 'Preview'}
                    </button>
                  </div>
                  {previewAdd && (
                    <div className="mt-1.5 border border-gray-200 dark:border-gray-700 rounded-xl p-4 min-h-[80px] bg-gray-50 dark:bg-gray-950">
                      <RichText html={description} className="text-gray-900 dark:text-gray-100 [&>ul]:list-disc [&>ul]:pl-4 [&>ol]:list-decimal [&>ol]:pl-4 [&>p]:mb-1 [&_strong]:font-semibold [&_em]:italic" />
                    </div>
                  )}
                  <div className={`mt-1.5 [&_.ql-container]:rounded-b-xl [&_.ql-toolbar]:rounded-t-xl [&_.ql-toolbar]:border-gray-200 dark:border-gray-700 [&_.ql-container]:border-gray-200 dark:border-gray-700 [&_.ql-editor]:min-h-[80px] [&_.ql-editor]:text-gray-900 dark:text-gray-100 [&_.ql-editor]:font-normal ${previewAdd ? 'hidden' : ''}`}>
                    <ReactQuill theme="snow" value={description} onChange={setDescription} placeholder="Write a short description for the new item." modules={quillModules} formats={quillFormats} />
                  </div>
                </div>

                {message && (
                  <div className={`rounded-xl px-4 py-3 text-sm font-medium ${status === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-red-50 text-red-700 border border-red-100'}`}>
                    {message}
                  </div>
                )}

                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={() => setShowAddModal(false)} className="flex-1 border border-gray-300 dark:border-gray-600 text-gray-700 font-semibold py-2.5 rounded-xl hover:bg-gray-50 dark:hover:bg-zinc-800 transition-colors">
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => { setLivePreview({ title, description, shortDescription, price, stock, maxPerUser, imageUrls }); setLivePreviewTab('quick'); }}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border-2 border-blue-200 bg-blue-50 py-2.5 text-sm font-semibold text-blue-700 transition hover:bg-blue-100"
                  >
                    <Monitor size={16} /> Live Preview
                  </button>
                  <button
                    type="submit"
                    disabled={status === 'saving'}
                    className="flex-1 inline-flex items-center justify-center rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
                  >
                    {status === 'saving' ? 'Saving\u2026' : 'Create Item'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Delete Confirmation Dialog */}
        {deleteConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-sm w-full p-6 text-center">
              <AlertCircle className="w-10 h-10 text-yellow-500 mx-auto mb-3" />
              <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-2">Delete Item?</h3>
              <p className="text-gray-600 text-sm mb-6">This action cannot be undone. The item and all its images will be permanently deleted.</p>
              <div className="flex gap-3">
                <button
                  onClick={() => setDeleteConfirm(null)}
                  className="flex-1 border border-gray-300 dark:border-gray-600 text-gray-700 font-semibold py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-zinc-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    try {
                      await axios.delete(`http://localhost:8000/api/inventory/items/${deleteConfirm}/`, { headers });
                      setItems(prev => prev.filter(i => i.slug !== deleteConfirm));
                      setDeleteConfirm(null);
                      toast.success('Item deleted');
                    } catch { toast.error('Failed to delete item.'); }
                  }}
                  className="flex-1 bg-red-600 text-white font-semibold py-2 rounded-lg hover:bg-red-700 transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Edit Modal */}
        {editItem && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setEditItem(null)}>
            <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">Edit Item</h3>
                <button onClick={() => setEditItem(null)} className="p-1 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-full"><X size={20} /></button>
              </div>
              <form
                onSubmit={async (e: FormEvent) => {
                  e.preventDefault();
                  setEditSaving(true);
                  try {
                    const fd = new FormData();
                    fd.append('title', editTitle);
                    fd.append('description', editDescription);
                    fd.append('short_description', editShortDescription);
                    fd.append('price', editPrice || '0');
                    fd.append('stock', editStock || '0');
                    fd.append('max_per_user', editMaxPerUser || '1');
                    if (editGoLiveDate) fd.append('go_live_date', new Date(editGoLiveDate).toISOString());
                    else fd.append('go_live_date', '');
                    editImages.forEach(f => fd.append('images', f));
                    await axios.put(`http://localhost:8000/api/inventory/items/${editItem.slug}/`, fd, {
                      headers: { ...headers, 'Content-Type': 'multipart/form-data' },
                    });
                    setEditItem(null);
                    fetchItems();
                    toast.success('Item updated!');
                  } catch {
                    toast.error('Failed to update item.');
                  } finally {
                    setEditSaving(false);
                  }
                }}
                className="space-y-4"
              >
                <label className="block">
                  <span className="text-sm font-semibold text-gray-700">Name</span>
                  <input value={editTitle} onChange={e => setEditTitle(e.target.value)} required className="mt-1 block w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 px-4 py-2.5 text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-100" />
                </label>
                <div className="grid grid-cols-3 gap-3">
                  <label className="block">
                    <span className="text-sm font-semibold text-gray-700">Price</span>
                    <input type="number" step="0.01" min="0" value={editPrice} onChange={e => setEditPrice(e.target.value)} className="mt-1 block w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 px-4 py-2.5 text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-100" />
                  </label>
                  <label className="block">
                    <span className="text-sm font-semibold text-gray-700">Stock</span>
                    <input type="number" min="0" value={editStock} onChange={e => setEditStock(e.target.value)} className="mt-1 block w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 px-4 py-2.5 text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-100" />
                  </label>
                  <label className="block">
                    <span className="text-sm font-semibold text-gray-700">Max/User</span>
                    <input type="number" min="1" value={editMaxPerUser} onChange={e => setEditMaxPerUser(e.target.value)} className="mt-1 block w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 px-4 py-2.5 text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-100" />
                  </label>
                </div>
                <label className="block">
                  <span className="text-sm font-semibold text-gray-700">Go Live Date</span>
                  <input
                    type="datetime-local"
                    value={editGoLiveDate}
                    onChange={e => setEditGoLiveDate(e.target.value)}
                    className="mt-1 block w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 px-4 py-2.5 text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                  <p className="text-xs text-gray-500 mt-1">Optional — leave empty to publish immediately</p>
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-gray-700">Short Description</span>
                  <input
                    value={editShortDescription}
                    onChange={e => setEditShortDescription(e.target.value)}
                    maxLength={300}
                    placeholder="Brief summary shown on the storefront card"
                    className="mt-1 block w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 px-4 py-2.5 text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                  <p className="text-xs text-gray-500 mt-1">{editShortDescription.length}/300</p>
                </label>
                <div className="block">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-gray-700">Description</span>
                    <button type="button" onClick={() => setPreviewEdit(!previewEdit)} className="text-xs text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1">
                      <Eye size={12} /> {previewEdit ? 'Edit' : 'Preview'}
                    </button>
                  </div>
                  {previewEdit && (
                    <div className="mt-1 border border-gray-200 dark:border-gray-700 rounded-xl p-4 min-h-[80px] bg-gray-50 dark:bg-gray-950">
                      <RichText html={editDescription} className="text-gray-900 dark:text-gray-100 [&>ul]:list-disc [&>ul]:pl-4 [&>ol]:list-decimal [&>ol]:pl-4 [&>p]:mb-1 [&_strong]:font-semibold [&_em]:italic" />
                    </div>
                  )}
                  <div className={`mt-1 [&_.ql-container]:rounded-b-xl [&_.ql-toolbar]:rounded-t-xl [&_.ql-toolbar]:border-gray-200 dark:border-gray-700 [&_.ql-container]:border-gray-200 dark:border-gray-700 [&_.ql-editor]:min-h-[80px] [&_.ql-editor]:text-gray-900 dark:text-gray-100 [&_.ql-editor]:font-normal ${previewEdit ? 'hidden' : ''}`}>
                    <ReactQuill theme="snow" value={editDescription} onChange={setEditDescription} modules={quillModules} formats={quillFormats} />
                  </div>
                </div>
                <div>
                  <span className="text-sm font-semibold text-gray-700">Current Images</span>
                  {editItem.images.length > 0 && (
                    <div className="mt-1">
                      <DraggableImageList
                        images={editItem.images}
                        onReorder={async (orderedIds) => {
                          try {
                            await axios.post(
                              `http://localhost:8000/api/inventory/items/${editItem.slug}/reorder-images/`,
                              { order: orderedIds },
                              { headers }
                            );
                            toast.success('Image order saved');
                          } catch { toast.error('Failed to save image order'); }
                        }}
                      />
                    </div>
                  )}
                </div>
                <div>
                  <span className="text-sm font-semibold text-gray-700">Replace Images</span>
                  <label className="mt-1 flex items-center gap-2 cursor-pointer rounded-xl border border-dashed border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-950 px-4 py-2.5 hover:border-blue-400 hover:bg-blue-50 transition-colors">
                    <ImagePlus className="w-5 h-5 text-blue-600" />
                    <span className="text-sm text-gray-600">{editImages.length ? `${editImages.length} file(s) selected — Add more…` : 'Choose new images...'}</span>
                    <input type="file" accept="image/*" multiple onChange={e => {
                      if (!e.target.files) return;
                      const newFiles = Array.from(e.target.files);
                      const newUrls = newFiles.map(f => URL.createObjectURL(f));
                      setEditImages(prev => [...prev, ...newFiles]);
                      setEditImageUrls(prev => [...prev, ...newUrls]);
                    }} className="hidden" />
                  </label>
                  <DraggableFileList
                    files={editImages}
                    urls={editImageUrls}
                    onReorder={(f, u) => { setEditImages(f); setEditImageUrls(u); }}
                    onRemove={(idx) => {
                      URL.revokeObjectURL(editImageUrls[idx]);
                      setEditImages(prev => prev.filter((_, i) => i !== idx));
                      setEditImageUrls(prev => prev.filter((_, i) => i !== idx));
                    }}
                  />
                  <p className="text-xs text-gray-500 mt-1">Leave empty to keep existing images</p>
                </div>
                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={() => setEditItem(null)} className="flex-1 border border-gray-300 dark:border-gray-600 text-gray-700 font-semibold py-2.5 rounded-xl hover:bg-gray-50 dark:hover:bg-zinc-800 transition-colors">Cancel</button>
                  <button
                    type="button"
                    onClick={() => {
                      const urls = editItem.images.map(i => i.url);
                      setLivePreview({ title: editTitle, description: editDescription, shortDescription: editShortDescription, price: editPrice, stock: editStock, maxPerUser: editMaxPerUser, imageUrls: urls });
                      setLivePreviewTab('quick');
                    }}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border-2 border-blue-200 bg-blue-50 py-2.5 text-sm font-semibold text-blue-700 transition hover:bg-blue-100"
                  >
                    <Monitor size={16} /> Live Preview
                  </button>
                  <button type="submit" disabled={editSaving} className="flex-1 bg-blue-600 text-white font-semibold py-2.5 rounded-xl hover:bg-blue-700 disabled:bg-blue-300 transition-colors">
                    {editSaving ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Live Preview Modal */}
        {livePreview && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setLivePreview(null)}>
            <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-5xl w-full max-h-[92vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
              {/* Header with tabs */}
              <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 px-6 py-4">
                <div className="flex items-center gap-4">
                  <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">Live Preview</h3>
                  <div className="flex bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
                    <button
                      onClick={() => setLivePreviewTab('quick')}
                      className={`px-4 py-1.5 text-sm font-semibold rounded-md transition-colors ${livePreviewTab === 'quick' ? 'bg-white dark:bg-gray-900 text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:hover:text-zinc-200'}`}
                    >
                      <Smartphone size={14} className="inline mr-1.5 -mt-0.5" />
                      Quick View
                    </button>
                    <button
                      onClick={() => setLivePreviewTab('full')}
                      className={`px-4 py-1.5 text-sm font-semibold rounded-md transition-colors ${livePreviewTab === 'full' ? 'bg-white dark:bg-gray-900 text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:hover:text-zinc-200'}`}
                    >
                      <Monitor size={14} className="inline mr-1.5 -mt-0.5" />
                      Full Page
                    </button>
                  </div>
                </div>
                <button onClick={() => setLivePreview(null)} className="p-1.5 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-full transition-colors"><X size={20} /></button>
              </div>

              {/* Preview content */}
              <div className="flex-1 overflow-y-auto bg-zinc-50 p-6">
                {livePreviewTab === 'quick' ? (
                  /* Quick View — card as it appears on storefront grid */
                  <div className="max-w-sm mx-auto">
                    <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
                      <div className="aspect-square bg-gray-100 dark:bg-gray-800 flex items-center justify-center overflow-hidden">
                        {livePreview.imageUrls[0] ? (
                          <FallbackImage src={livePreview.imageUrls[0]} alt={livePreview.title} className="w-full h-full object-contain" fallbackClassName="flex items-center justify-center" fallbackSize={48} />
                        ) : (
                          <ImageIcon size={48} className="text-gray-300" />
                        )}
                      </div>
                      <div className="p-4 space-y-2">
                        <h3 className="font-bold text-gray-900 dark:text-gray-100 text-lg truncate">{livePreview.title || 'Untitled'}</h3>
                        {livePreview.shortDescription && (
                          <p className="text-sm text-gray-500 line-clamp-2">{livePreview.shortDescription}</p>
                        )}
                        <div className="flex items-center justify-between pt-1">
                          <span className="text-xl font-bold text-blue-600">${Number(livePreview.price || 0).toFixed(2)}</span>
                          <span className="text-sm text-gray-500">{livePreview.stock || 0} in stock</span>
                        </div>
                        <button className="w-full bg-gradient-to-r from-yellow-400 to-red-500 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 text-sm cursor-default">
                          <ShoppingCart size={16} /> Add to Cart
                        </button>
                      </div>
                    </div>
                    <p className="text-center text-xs text-gray-400 mt-4">This is how the card appears on the storefront grid</p>
                  </div>
                ) : (
                  /* Full Page — mirrors the actual product detail page layout */
                  <div className="max-w-4xl mx-auto">
                    <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
                      <div className="md:flex">
                        {/* Gallery */}
                        <div className="md:w-1/2 bg-gray-100 dark:bg-gray-800 p-8">
                          <div className="flex items-center justify-center aspect-square mb-4">
                            {livePreview.imageUrls[0] ? (
                              <FallbackImage src={livePreview.imageUrls[0]} alt={livePreview.title} className="max-h-full max-w-full object-contain rounded-xl" fallbackClassName="flex items-center justify-center" fallbackSize={64} />
                            ) : (
                              <div className="flex items-center justify-center text-gray-400"><ImageIcon size={64} /></div>
                            )}
                          </div>
                          {livePreview.imageUrls.length > 1 && (
                            <div className="flex gap-2 justify-center flex-wrap">
                              {livePreview.imageUrls.map((url, idx) => (
                                <div key={idx} className="w-16 h-16 rounded-lg overflow-hidden border-2 border-gray-200 dark:border-gray-700">
                                  <img src={url} alt="" className="w-full h-full object-cover" />
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Details */}
                        <div className="md:w-1/2 p-8 flex flex-col">
                          <h1 className="text-3xl font-black text-gray-900 dark:text-gray-100 mb-2 break-words">{livePreview.title || 'Untitled'}</h1>
                          <div className="flex items-center gap-2 mb-4">
                            <div className="flex text-yellow-400">
                              {[...Array(5)].map((_, i) => <Star key={i} size={16} fill="currentColor" />)}
                            </div>
                            <span className="text-sm text-gray-500">(5.0)</span>
                          </div>
                          <p className="text-3xl font-bold text-blue-600 mb-6">${Number(livePreview.price || 0).toFixed(2)}</p>
                          <RichText html={livePreview.description} className="mb-6 leading-relaxed flex-grow text-gray-600 [&>ul]:list-disc [&>ul]:pl-4 [&>ol]:list-decimal [&>ol]:pl-4 [&>p]:mb-1 [&_strong]:font-semibold [&_em]:italic [&_table]:border-collapse [&_td]:border [&_td]:border-gray-300 dark:border-gray-600 [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-gray-300 dark:border-gray-600 [&_th]:px-2 [&_th]:py-1 [&_th]:bg-gray-50 dark:bg-gray-950 [&_th]:font-semibold" />
                          <div className="space-y-3 mb-6">
                            <div className="flex justify-between text-sm">
                              <span className="text-gray-500">Availability</span>
                              <span className="font-semibold text-green-600">{livePreview.stock || 0} in stock</span>
                            </div>
                            <div className="flex justify-between text-sm">
                              <span className="text-gray-500">Max per student</span>
                              <span className="font-semibold text-gray-900 dark:text-gray-100">{livePreview.maxPerUser || 1}</span>
                            </div>
                          </div>
                          <div className="space-y-3">
                            <div className="flex items-center gap-3">
                              <span className="text-sm font-semibold text-gray-700">Quantity:</span>
                              <div className="flex items-center bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
                                <button className="p-2 hover:bg-gray-200 rounded transition-colors text-gray-700 cursor-default"><MinusIcon size={16} /></button>
                                <span className="w-10 text-center font-semibold text-gray-900 dark:text-gray-100">1</span>
                                <button className="p-2 hover:bg-gray-200 rounded transition-colors text-gray-700 cursor-default"><PlusIcon size={16} /></button>
                              </div>
                            </div>
                            <button className="w-full bg-gradient-to-r from-yellow-400 to-red-500 text-white font-bold py-4 rounded-xl flex items-center justify-center gap-2 text-lg cursor-default">
                              <ShoppingCart size={20} /> Add to Cart
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                    <p className="text-center text-xs text-gray-400 mt-4">This is how the full product page will appear to customers</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
