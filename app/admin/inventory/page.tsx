"use client";
/* eslint-disable @next/next/no-img-element */

import { useState, useEffect, useRef, type FormEvent } from 'react';
import dynamic from 'next/dynamic';
import axios from 'axios';

import { useRequireAuth } from '../../hooks/useRequireAuth';
import Navbar from '../../components/Navbar';
import { AlertCircle, X, ImagePlus, Pencil, Trash2, Eye, EyeOff, Plus, ImageIcon, Package, Monitor, Smartphone, Star, ShoppingCart, Minus as MinusIcon, Plus as PlusIcon } from 'lucide-react';
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
  const [publishedAt, setPublishedAt] = useState('');
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [imagePath, setImagePath] = useState(''); // for TCG-imported external URL
  const [status, setStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);

  // Category + TCG fields
  const [categories, setCategories] = useState<{ id: number; name: string; slug: string }[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('');
  const [tcgType, setTcgType] = useState('');
  const [tcgStage, setTcgStage] = useState('');
  const [rarityType, setRarityType] = useState('');
  // Edit modal category/TCG
  const [editCategoryId, setEditCategoryId] = useState<string>('');
  const [editTcgType, setEditTcgType] = useState('');
  const [editTcgStage, setEditTcgStage] = useState('');
  const [editRarityType, setEditRarityType] = useState('');

  const TCG_TYPES   = ['Fire','Water','Grass','Psychic','Fighting','Darkness','Metal','Lightning','Fairy','Dragon','Colorless'];
  const TCG_STAGES  = ['Basic','Stage 1','Stage 2','Mega','BREAK','VMAX','VSTAR','Tera'];
  const TCG_RARITIES = ['Common','Uncommon','Rare','Holo Rare','Ultra Rare','Illustration Rare','Special Illustration Rare','Gold Secret Rare'];

  // TCG Import state
  const [showTCGModal, setShowTCGModal] = useState(false);
  const [tcgQuery, setTcgQuery] = useState('');
  const [tcgResults, setTcgResults] = useState<{
    api_id: string; name: string; set_name: string; set_id: string; set_printed_total: string;
    rarity: string; number: string; image_large: string; image_small: string;
    market_price: number | null; tcg_type: string; tcg_stage: string; rarity_type: string;
    short_description: string;
  }[]>([]);
  const [tcgLoading, setTcgLoading] = useState(false);

  const searchTCG = () => {
    if (!tcgQuery.trim()) return;
    setTcgLoading(true);
    const token = localStorage.getItem('access_token');
    axios.get(`http://localhost:8000/api/inventory/tcg-import/?q=${encodeURIComponent(tcgQuery)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => setTcgResults(r.data.results || []))
      .catch(() => toast.error('TCG search failed'))
      .finally(() => setTcgLoading(false));
  };

  const importTCGCard = (card: typeof tcgResults[0]) => {
    setTitle(card.name);
    setDescription(`<p>${card.name} from ${card.set_name}. Rarity: ${card.rarity}.</p>`);
    setShortDescription(card.short_description || `${card.set_name} - ${card.rarity}`);
    setImagePath(card.image_large);
    if (card.market_price) setPrice(String(card.market_price));
    if (card.tcg_type) setTcgType(card.tcg_type);
    if (card.tcg_stage) setTcgStage(card.tcg_stage);
    if (card.rarity_type) setRarityType(card.rarity_type);
    // Auto-select TCG Cards category if available
    const tcgCat = categories.find(c => c.slug === 'tcg-cards');
    if (tcgCat) setSelectedCategoryId(String(tcgCat.id));
    setShowTCGModal(false);
    setShowAddModal(true);
    toast.success(`Auto-filled: ${card.name}`);
  };

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
    published_at: string | null;
    scheduled_drops: { id: number; item: number; quantity: number; drop_time: string; is_processed: boolean; created_at: string }[];
    images: { id: number; url: string; position: number }[];
    image_path: string;
    category: number | null;
    tcg_type: string | null;
    tcg_stage: string | null;
    rarity_type: string | null;
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
  const [editPublishedAt, setEditPublishedAt] = useState('');
  const [editImages, setEditImages] = useState<File[]>([]);
  const [editImageUrls, setEditImageUrls] = useState<string[]>([]);
  const [editSaving, setEditSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  // Scheduled drops state for edit modal
  const [editDrops, setEditDrops] = useState<InventoryItem['scheduled_drops']>([]);
  const [newDropQty, setNewDropQty] = useState('');
  const [newDropTime, setNewDropTime] = useState('');
  const [dropSaving, setDropSaving] = useState(false);
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
      .then(r => setItems(r.data.results ?? r.data))
      .catch(() => {})
      .finally(() => setItemsLoading(false));
  };

  useEffect(() => {
    if (isAdmin) {
      fetchItems();
      axios.get('http://localhost:8000/api/inventory/categories/')
        .then(r => setCategories(Array.isArray(r.data) ? r.data : r.data.results || []))
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    if (!selectedCategoryId) {
      toast.error('Please select a category.');
      return;
    }
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
      formData.append('category', selectedCategoryId);
      if (price) formData.append('price', price);
      if (publishedAt) formData.append('published_at', new Date(publishedAt).toISOString());
      if (imagePath) formData.append('image_path', imagePath);
      if (tcgType) formData.append('tcg_type', tcgType);
      if (tcgStage) formData.append('tcg_stage', tcgStage);
      if (rarityType) formData.append('rarity_type', rarityType);
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
      setPublishedAt('');
      setImagePath('');
      setSelectedCategoryId('');
      setTcgType(''); setTcgStage(''); setRarityType('');
      imageUrls.forEach(url => URL.revokeObjectURL(url));
      setImageFiles([]);
      setImageUrls([]);
      setShowAddModal(false);
      fetchItems();
    } catch {
      setStatus('error');
      setMessage('Unable to create item. Please check your inputs and try again.');
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-pkmn-bg px-4">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-pkmn-blue mx-auto mb-4" />
          <p className="text-pkmn-gray">Redirecting to login&hellip;</p>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-pkmn-bg px-4">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-pkmn-blue mx-auto mb-4" />
          <p className="text-pkmn-gray">Redirecting to login&hellip;</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-pkmn-bg min-h-screen">
      <Navbar />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-10">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-pkmn-blue">Admin Inventory</p>
            <h1 className="mt-3 text-3xl sm:text-4xl font-extrabold text-pkmn-text">Manage Inventory</h1>
            <p className="mt-2 text-pkmn-gray max-w-2xl">
              View, edit, and manage your store items.
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setShowTCGModal(true)}
              className="inline-flex items-center gap-2 rounded-full bg-pkmn-blue px-5 py-3 text-sm font-semibold text-white shadow-lg transition hover:bg-pkmn-blue-dark active:scale-95"
            >
              Import Card from Database
            </button>
            <button
              onClick={() => { setShowAddModal(true); setStatus('idle'); setMessage(''); }}
              className="inline-flex items-center gap-2 rounded-full bg-pkmn-blue px-6 py-3 text-sm font-semibold text-white shadow-lg transition hover:bg-pkmn-blue-dark active:scale-95"
            >
              <Plus className="w-5 h-5" />
              Add New Item
            </button>
          </div>
        </div>

        {/* Inventory Data Table */}
        <div className="bg-white border border-pkmn-border rounded-3xl p-8 shadow-sm">
          <h2 className="text-2xl font-bold text-pkmn-text mb-6">Current Inventory</h2>

          {itemsLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-pkmn-blue"></div>
              <span className="ml-3 text-pkmn-gray">Loading items...</span>
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-12">
              <Package className="w-12 h-12 text-pkmn-gray-dark mx-auto mb-4" />
              <p className="text-pkmn-gray mb-4">No items yet. Add your first item to get started!</p>
              <button
                onClick={() => setShowAddModal(true)}
                className="inline-flex items-center gap-2 rounded-full bg-pkmn-blue px-6 py-3 text-sm font-semibold text-white hover:bg-pkmn-blue-dark transition"
              >
                <Plus className="w-4 h-4" />
                Add Your First Item
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-pkmn-bg border-b border-pkmn-border">
                  <tr>
                    <th className="text-left py-3 px-2 font-semibold text-pkmn-gray">Image</th>
                    <th className="text-left py-3 px-2 font-semibold text-pkmn-gray">Title</th>
                    <th className="text-left py-3 px-2 font-semibold text-pkmn-gray">Price</th>
                    <th className="text-left py-3 px-2 font-semibold text-pkmn-gray">Stock</th>
                    <th className="text-left py-3 px-2 font-semibold text-pkmn-gray">Visibility</th>
                    <th className="text-left py-3 px-2 font-semibold text-pkmn-gray">Status</th>
                    <th className="text-right py-3 px-2 font-semibold text-pkmn-gray">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id} className={`border-b border-pkmn-border even:bg-pkmn-bg/50 even: hover:bg-pkmn-bg transition-colors ${!item.is_active ? 'opacity-60' : ''}`}>
                      <td className="py-3 px-2">
                        {item.images?.[0]?.url ? (
                          <FallbackImage src={item.images[0].url} alt="" className="w-10 h-10 object-cover rounded-lg" fallbackClassName="w-10 h-10 bg-pkmn-bg rounded-lg flex items-center justify-center text-pkmn-gray-dark" fallbackSize={16} />
                        ) : (
                          <div className="w-10 h-10 bg-pkmn-bg rounded-lg flex items-center justify-center text-pkmn-gray-dark"><ImageIcon size={16} /></div>
                        )}
                      </td>
                      <td className="py-3 px-2 font-medium text-pkmn-text">{item.title}</td>
                      <td className="py-3 px-2 text-pkmn-gray-dark">${Number(item.price).toFixed(2)}</td>
                      <td className="py-3 px-2 text-pkmn-gray-dark">{item.stock}</td>
                      <td className="py-3 px-2">
                        {(() => {
                          if (!item.published_at) return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-pkmn-bg text-pkmn-gray">Draft</span>;
                          if (new Date(item.published_at) > new Date()) return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-pkmn-blue/15 text-pkmn-blue">Scheduled</span>;
                          return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-green-500/100/100/100/15 text-green-600">Live</span>;
                        })()}
                      </td>
                      <td className="py-3 px-2">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${item.is_active ? 'bg-green-500/100/100/100/15 text-green-600' : 'bg-pkmn-bg text-pkmn-gray'}`}>
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
                              setEditPublishedAt(item.published_at ? item.published_at.slice(0, 16) : '');
                              setEditDrops(item.scheduled_drops ?? []);
                              setNewDropQty(''); setNewDropTime('');
                              setEditImages([]);
                              setEditImageUrls(prev => { prev.forEach(u => URL.revokeObjectURL(u)); return []; });
                              setEditCategoryId(item.category ? String(item.category) : '');
                              setEditTcgType(item.tcg_type || '');
                              setEditTcgStage(item.tcg_stage || '');
                              setEditRarityType(item.rarity_type || '');
                            }}
                            className="p-1.5 text-pkmn-blue hover:bg-pkmn-blue/10 rounded-lg transition-colors"
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
                            className={`p-1.5 rounded-lg transition-colors ${item.is_active ? 'text-orange-600 hover:bg-orange-500/100/100/10' : 'text-green-600 hover:bg-green-500/100/100/10'}`}
                            title={item.is_active ? 'Deactivate' : 'Activate'}
                          >
                            {item.is_active ? <EyeOff size={16} /> : <Eye size={16} />}
                          </button>
                          <button
                            onClick={() => setDeleteConfirm(item.slug)}
                            className="p-1.5 text-pkmn-red hover:bg-pkmn-red/10 rounded-lg transition-colors"
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
            <div className="bg-white border border-pkmn-border rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h3 className="text-xl font-bold text-pkmn-text">Add New Item</h3>
                  <p className="text-sm text-pkmn-gray mt-0.5">Create a new inventory item with images</p>
                </div>
                <button onClick={() => setShowAddModal(false)} className="p-1.5 hover:bg-pkmn-bg rounded-full transition-colors"><X size={20} /></button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="text-sm font-semibold text-pkmn-gray-dark">Name *</span>
                    <input
                      value={title}
                      onChange={e => setTitle(e.target.value)}
                      required
                      placeholder="Enter item name"
                      className="mt-1.5 block w-full rounded-xl border border-pkmn-border bg-pkmn-bg px-4 py-2.5 text-pkmn-text focus:border-pkmn-blue focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
                    />
                  </label>
                  <label className="block">
                    <span className="text-sm font-semibold text-pkmn-gray-dark">Stock</span>
                    <input
                      type="number"
                      min={0}
                      value={stock}
                      onChange={e => setStock(e.target.value)}
                      placeholder="0"
                      className="mt-1.5 block w-full rounded-xl border border-pkmn-border bg-pkmn-bg px-4 py-2.5 text-pkmn-text focus:border-pkmn-blue focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
                    />
                  </label>
                </div>

                {/* Category — required */}
                <label className="block">
                  <span className="text-sm font-semibold text-pkmn-gray-dark">Category *</span>
                  <select
                    value={selectedCategoryId}
                    onChange={e => { setSelectedCategoryId(e.target.value); setTcgType(''); setTcgStage(''); setRarityType(''); }}
                    required
                    className="mt-1.5 block w-full rounded-xl border border-pkmn-border bg-pkmn-bg px-4 py-2.5 text-pkmn-text focus:border-pkmn-blue focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
                  >
                    <option value="">Select a category…</option>
                    {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </label>

                {/* TCG-specific fields — only shown for TCG Cards category */}
                {selectedCategoryId && categories.find(c => String(c.id) === selectedCategoryId)?.slug === 'tcg-cards' && (
                  <div className="border border-pkmn-blue/20 bg-pkmn-blue/5 rounded-xl p-4 space-y-3">
                    <p className="text-xs font-bold uppercase tracking-wider text-pkmn-blue">TCG Card Attributes</p>
                    <div className="grid grid-cols-3 gap-3">
                      <label className="block">
                        <span className="text-xs font-semibold text-pkmn-gray-dark">Type</span>
                        <select value={tcgType} onChange={e => setTcgType(e.target.value)} className="mt-1 block w-full rounded-lg border border-pkmn-border bg-white px-3 py-2 text-sm text-pkmn-text focus:border-pkmn-blue focus:outline-none">
                          <option value="">—</option>
                          {TCG_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </label>
                      <label className="block">
                        <span className="text-xs font-semibold text-pkmn-gray-dark">Stage</span>
                        <select value={tcgStage} onChange={e => setTcgStage(e.target.value)} className="mt-1 block w-full rounded-lg border border-pkmn-border bg-white px-3 py-2 text-sm text-pkmn-text focus:border-pkmn-blue focus:outline-none">
                          <option value="">—</option>
                          {TCG_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </label>
                      <label className="block">
                        <span className="text-xs font-semibold text-pkmn-gray-dark">Rarity</span>
                        <select value={rarityType} onChange={e => setRarityType(e.target.value)} className="mt-1 block w-full rounded-lg border border-pkmn-border bg-white px-3 py-2 text-sm text-pkmn-text focus:border-pkmn-blue focus:outline-none">
                          <option value="">—</option>
                          {TCG_RARITIES.map(r => <option key={r} value={r}>{r}</option>)}
                        </select>
                      </label>
                    </div>
                  </div>
                )}

                {/* Image URL from TCG import */}
                {imagePath && (
                  <div className="flex items-center gap-3 p-3 bg-pkmn-bg rounded-xl border border-pkmn-border">
                    <img src={imagePath} alt="TCG card preview" className="h-16 w-12 object-contain" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-pkmn-gray-dark">Imported image URL</p>
                      <p className="text-xs text-pkmn-gray truncate">{imagePath}</p>
                    </div>
                    <button type="button" onClick={() => setImagePath('')} className="text-pkmn-red p-1"><X size={14} /></button>
                  </div>
                )}

                <div className="grid gap-4 sm:grid-cols-3">
                  <label className="block">
                    <span className="text-sm font-semibold text-pkmn-gray-dark">Price ($)</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={price}
                      onChange={e => setPrice(e.target.value)}
                      placeholder="9.99"
                      className="mt-1.5 block w-full rounded-xl border border-pkmn-border bg-pkmn-bg px-4 py-2.5 text-pkmn-text focus:border-pkmn-blue focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
                    />
                  </label>
                  <label className="block">
                    <span className="text-sm font-semibold text-pkmn-gray-dark">Max/User</span>
                    <input
                      type="number"
                      min="1"
                      value={maxPerUser}
                      onChange={e => setMaxPerUser(e.target.value)}
                      placeholder="1"
                      className="mt-1.5 block w-full rounded-xl border border-pkmn-border bg-pkmn-bg px-4 py-2.5 text-pkmn-text focus:border-pkmn-blue focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
                    />
                  </label>
                  <div className="block">
                    <span className="text-sm font-semibold text-pkmn-gray-dark">Images</span>
                    <label className="mt-1.5 flex items-center gap-2 cursor-pointer rounded-xl border border-dashed border-pkmn-border bg-pkmn-bg px-4 py-2.5 hover:border-pkmn-blue hover:bg-pkmn-blue/10 transition-colors">
                      <ImagePlus className="w-5 h-5 text-pkmn-blue" />
                      <span className="text-sm text-pkmn-gray">Add&hellip;</span>
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
                  <span className="text-sm font-semibold text-pkmn-gray-dark">Publish Date</span>
                  <input
                    type="datetime-local"
                    value={publishedAt}
                    onChange={e => setPublishedAt(e.target.value)}
                    className="mt-1.5 block w-full rounded-xl border border-pkmn-border bg-pkmn-bg px-4 py-2.5 text-pkmn-text focus:border-pkmn-blue focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                  <p className="text-xs text-pkmn-gray mt-1">Leave empty to keep as a hidden draft, or set a future date to schedule the page reveal</p>
                </label>

                <DraggableFileList
                  files={imageFiles}
                  urls={imageUrls}
                  onReorder={(f, u) => { setImageFiles(f); setImageUrls(u); }}
                  onRemove={(idx) => removeFile(idx)}
                />

                <label className="block">
                  <span className="text-sm font-semibold text-pkmn-gray-dark">Short Description</span>
                  <input
                    value={shortDescription}
                    onChange={e => setShortDescription(e.target.value)}
                    maxLength={300}
                    placeholder="Brief summary shown on the storefront card"
                    className="mt-1.5 block w-full rounded-xl border border-pkmn-border bg-pkmn-bg px-4 py-2.5 text-pkmn-text focus:border-pkmn-blue focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                  <p className="text-xs text-pkmn-gray mt-1">{shortDescription.length}/300 - shown on product cards</p>
                </label>

                <div className="block">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-pkmn-gray-dark">Description</span>
                    <button type="button" onClick={() => setPreviewAdd(!previewAdd)} className="text-xs text-pkmn-blue hover:text-pkmn-blue-dark font-medium flex items-center gap-1">
                      <Eye size={12} /> {previewAdd ? 'Edit' : 'Preview'}
                    </button>
                  </div>
                  {previewAdd && (
                    <div className="mt-1.5 border border-pkmn-border rounded-xl p-4 min-h-[80px] bg-pkmn-bg">
                      <RichText html={description} className="text-pkmn-text [&>ul]:list-disc [&>ul]:pl-4 [&>ol]:list-decimal [&>ol]:pl-4 [&>p]:mb-1 [&_strong]:font-semibold [&_em]:italic" />
                    </div>
                  )}
                  <div className={`mt-1.5 [&_.ql-container]:rounded-b-xl [&_.ql-toolbar]:rounded-t-xl [&_.ql-editor]:min-h-[80px] [&_.ql-editor]:font-normal ${previewAdd ? 'hidden' : ''}`}>
                    <ReactQuill theme="snow" value={description} onChange={setDescription} placeholder="Write a short description for the new item." modules={quillModules} formats={quillFormats} />
                  </div>
                </div>

                {message && (
                  <div className={`rounded-xl px-4 py-3 text-sm font-medium ${status === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-pkmn-red/10 text-pkmn-red border border-red-100'}`}>
                    {message}
                  </div>
                )}

                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={() => setShowAddModal(false)} className="flex-1 border border-pkmn-border text-pkmn-gray-dark font-semibold py-2.5 rounded-xl hover:bg-pkmn-bg transition-colors">
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => { setLivePreview({ title, description, shortDescription, price, stock, maxPerUser, imageUrls }); setLivePreviewTab('quick'); }}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border-2 border-pkmn-blue/20 bg-pkmn-blue/10 py-2.5 text-sm font-semibold text-pkmn-blue transition hover:bg-pkmn-blue/15"
                  >
                    <Monitor size={16} /> Live Preview
                  </button>
                  <button
                    type="submit"
                    disabled={status === 'saving'}
                    className="flex-1 inline-flex items-center justify-center rounded-xl bg-pkmn-blue py-2.5 text-sm font-semibold text-white transition hover:bg-pkmn-blue-dark disabled:cursor-not-allowed disabled:bg-pkmn-blue/50"
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
            <div className="bg-white border border-pkmn-border rounded-2xl shadow-2xl max-w-sm w-full p-6 text-center">
              <AlertCircle className="w-10 h-10 text-pkmn-yellow mx-auto mb-3" />
              <h3 className="text-lg font-bold text-pkmn-text mb-2">Delete Item?</h3>
              <p className="text-pkmn-gray text-sm mb-6">This action cannot be undone. The item and all its images will be permanently deleted.</p>
              <div className="flex gap-3">
                <button
                  onClick={() => setDeleteConfirm(null)}
                  className="flex-1 border border-pkmn-border text-pkmn-gray-dark font-semibold py-2 rounded-lg hover:bg-pkmn-bg transition-colors"
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
                  className="flex-1 bg-pkmn-red text-white font-semibold py-2 rounded-lg hover:bg-pkmn-red-dark transition-colors"
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
<div className="bg-white border border-pkmn-border rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold text-pkmn-text">Edit Item</h3>
                <button onClick={() => setEditItem(null)} className="p-1 hover:bg-pkmn-bg rounded-full"><X size={20} /></button>
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
                    if (editPublishedAt) fd.append('published_at', new Date(editPublishedAt).toISOString());
                    else fd.append('published_at', '');
                    if (editCategoryId) fd.append('category', editCategoryId);
                    if (editTcgType) fd.append('tcg_type', editTcgType);
                    if (editTcgStage) fd.append('tcg_stage', editTcgStage);
                    if (editRarityType) fd.append('rarity_type', editRarityType);
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
                  <span className="text-sm font-semibold text-pkmn-gray-dark">Name</span>
                  <input value={editTitle} onChange={e => setEditTitle(e.target.value)} required className="mt-1 block w-full rounded-xl border border-pkmn-border bg-pkmn-bg px-4 py-2.5 text-pkmn-text focus:border-pkmn-blue focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100" />
                </label>
                {/* Category */}
                <label className="block">
                  <span className="text-sm font-semibold text-pkmn-gray-dark">Category</span>
                  <select
                    value={editCategoryId}
                    onChange={e => { setEditCategoryId(e.target.value); setEditTcgType(''); setEditTcgStage(''); setEditRarityType(''); }}
                    className="mt-1 block w-full rounded-xl border border-pkmn-border bg-pkmn-bg px-4 py-2.5 text-pkmn-text focus:border-pkmn-blue focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
                  >
                    <option value="">No category</option>
                    {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </label>
                {/* TCG fields — only when TCG Cards */}
                {editCategoryId && categories.find(c => String(c.id) === editCategoryId)?.slug === 'tcg-cards' && (
                  <div className="border border-pkmn-blue/20 bg-pkmn-blue/5 rounded-xl p-4 space-y-3">
                    <p className="text-xs font-bold uppercase tracking-wider text-pkmn-blue">TCG Card Attributes</p>
                    <div className="grid grid-cols-3 gap-3">
                      <label className="block">
                        <span className="text-xs font-semibold text-pkmn-gray-dark">Type</span>
                        <select value={editTcgType} onChange={e => setEditTcgType(e.target.value)} className="mt-1 block w-full rounded-lg border border-pkmn-border bg-white px-3 py-2 text-sm text-pkmn-text focus:border-pkmn-blue focus:outline-none">
                          <option value="">—</option>
                          {TCG_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </label>
                      <label className="block">
                        <span className="text-xs font-semibold text-pkmn-gray-dark">Stage</span>
                        <select value={editTcgStage} onChange={e => setEditTcgStage(e.target.value)} className="mt-1 block w-full rounded-lg border border-pkmn-border bg-white px-3 py-2 text-sm text-pkmn-text focus:border-pkmn-blue focus:outline-none">
                          <option value="">—</option>
                          {TCG_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </label>
                      <label className="block">
                        <span className="text-xs font-semibold text-pkmn-gray-dark">Rarity</span>
                        <select value={editRarityType} onChange={e => setEditRarityType(e.target.value)} className="mt-1 block w-full rounded-lg border border-pkmn-border bg-white px-3 py-2 text-sm text-pkmn-text focus:border-pkmn-blue focus:outline-none">
                          <option value="">—</option>
                          {TCG_RARITIES.map(r => <option key={r} value={r}>{r}</option>)}
                        </select>
                      </label>
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-3 gap-3">
                  <label className="block">
                    <span className="text-sm font-semibold text-pkmn-gray-dark">Price</span>
                    <input type="number" step="0.01" min="0" value={editPrice} onChange={e => setEditPrice(e.target.value)} className="mt-1 block w-full rounded-xl border border-pkmn-border bg-pkmn-bg px-4 py-2.5 text-pkmn-text focus:border-pkmn-blue focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100" />
                  </label>
                  <label className="block">
                    <span className="text-sm font-semibold text-pkmn-gray-dark">Stock</span>
                    <input type="number" min="0" value={editStock} onChange={e => setEditStock(e.target.value)} className="mt-1 block w-full rounded-xl border border-pkmn-border bg-pkmn-bg px-4 py-2.5 text-pkmn-text focus:border-pkmn-blue focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100" />
                  </label>
                  <label className="block">
                    <span className="text-sm font-semibold text-pkmn-gray-dark">Max/User</span>
                    <input type="number" min="1" value={editMaxPerUser} onChange={e => setEditMaxPerUser(e.target.value)} className="mt-1 block w-full rounded-xl border border-pkmn-border bg-pkmn-bg px-4 py-2.5 text-pkmn-text focus:border-pkmn-blue focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100" />
                  </label>
                </div>
                <label className="block">
                  <span className="text-sm font-semibold text-pkmn-gray-dark">Publish Date</span>
                  <input
                    type="datetime-local"
                    value={editPublishedAt}
                    onChange={e => setEditPublishedAt(e.target.value)}
                    className="mt-1 block w-full rounded-xl border border-pkmn-border bg-pkmn-bg px-4 py-2.5 text-pkmn-text focus:border-pkmn-blue focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                  <p className="text-xs text-pkmn-gray mt-1">Leave empty to keep as a hidden draft, or set a future date to schedule the page reveal</p>
                </label>

                {/* Scheduled Inventory Drops */}
                <div className="border border-pkmn-border rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-pkmn-gray-dark">Scheduled Restocks</span>
                    <span className="text-xs text-pkmn-gray-dark">{editDrops.filter(d => !d.is_processed).length} pending</span>
                  </div>
                  {editDrops.length > 0 && (
                    <div className="space-y-1.5 max-h-40 overflow-y-auto">
                      {editDrops.map(drop => (
                        <div key={drop.id} className={`flex items-center justify-between text-sm px-3 py-2 rounded-lg ${drop.is_processed ? 'bg-pkmn-bg opacity-60' : 'bg-pkmn-blue/10'}`}>
                          <div className="flex items-center gap-2">
                            <span className={`font-semibold ${drop.is_processed ? 'text-pkmn-gray' : 'text-pkmn-blue'}`}>+{drop.quantity}</span>
                            <span className="text-pkmn-gray">{new Date(drop.drop_time).toLocaleString()}</span>
                            {drop.is_processed && <span className="text-xs bg-pkmn-bg text-pkmn-gray px-1.5 py-0.5 rounded">processed</span>}
                          </div>
                          {!drop.is_processed && (
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  await axios.delete(`http://localhost:8000/api/inventory/inventory-drops/${drop.id}/`, { headers });
                                  setEditDrops(prev => prev.filter(d => d.id !== drop.id));
                                  toast.success('Drop removed');
                                } catch { toast.error('Failed to remove drop'); }
                              }}
                              className="text-pkmn-red hover:text-pkmn-red p-0.5"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <input
                      type="number"
                      min="1"
                      placeholder="Qty"
                      value={newDropQty}
                      onChange={e => setNewDropQty(e.target.value)}
                      className="w-20 rounded-lg border border-pkmn-border bg-pkmn-bg px-3 py-1.5 text-sm text-pkmn-text focus:border-pkmn-blue focus:outline-none"
                    />
                    <input
                      type="datetime-local"
                      value={newDropTime}
                      onChange={e => setNewDropTime(e.target.value)}
                      className="flex-1 rounded-lg border border-pkmn-border bg-pkmn-bg px-3 py-1.5 text-sm text-pkmn-text focus:border-pkmn-blue focus:outline-none"
                    />
                    <button
                      type="button"
                      disabled={dropSaving || !newDropQty || !newDropTime}
                      onClick={async () => {
                        setDropSaving(true);
                        try {
                          const res = await axios.post('http://localhost:8000/api/inventory/inventory-drops/', {
                            item: editItem.id,
                            quantity: Number(newDropQty),
                            drop_time: new Date(newDropTime).toISOString(),
                          }, { headers });
                          setEditDrops(prev => [...prev, res.data].sort((a, b) => new Date(a.drop_time).getTime() - new Date(b.drop_time).getTime()));
                          setNewDropQty(''); setNewDropTime('');
                          toast.success('Drop scheduled');
                        } catch { toast.error('Failed to schedule drop'); }
                        finally { setDropSaving(false); }
                      }}
                      className="inline-flex items-center gap-1 rounded-lg bg-pkmn-blue px-3 py-1.5 text-sm font-semibold text-white hover:bg-pkmn-blue-dark disabled:bg-pkmn-blue/50 transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" /> Add
                    </button>
                  </div>
                </div>

                <label className="block">
                  <span className="text-sm font-semibold text-pkmn-gray-dark">Short Description</span>
                  <input
                    value={editShortDescription}
                    onChange={e => setEditShortDescription(e.target.value)}
                    maxLength={300}
                    placeholder="Brief summary shown on the storefront card"
                    className="mt-1 block w-full rounded-xl border border-pkmn-border bg-pkmn-bg px-4 py-2.5 text-pkmn-text focus:border-pkmn-blue focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                  <p className="text-xs text-pkmn-gray mt-1">{editShortDescription.length}/300</p>
                </label>
                <div className="block">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-pkmn-gray-dark">Description</span>
                    <button type="button" onClick={() => setPreviewEdit(!previewEdit)} className="text-xs text-pkmn-blue hover:text-pkmn-blue-dark font-medium flex items-center gap-1">
                      <Eye size={12} /> {previewEdit ? 'Edit' : 'Preview'}
                    </button>
                  </div>
                  {previewEdit && (
                    <div className="mt-1 border border-pkmn-border rounded-xl p-4 min-h-[80px] bg-pkmn-bg">
                      <RichText html={editDescription} className="text-pkmn-text [&>ul]:list-disc [&>ul]:pl-4 [&>ol]:list-decimal [&>ol]:pl-4 [&>p]:mb-1 [&_strong]:font-semibold [&_em]:italic" />
                    </div>
                  )}
                  <div className={`mt-1 [&_.ql-container]:rounded-b-xl [&_.ql-toolbar]:rounded-t-xl [&_.ql-editor]:min-h-[80px] [&_.ql-editor]:font-normal ${previewEdit ? 'hidden' : ''}`}>
                    <ReactQuill theme="snow" value={editDescription} onChange={setEditDescription} modules={quillModules} formats={quillFormats} />
                  </div>
                </div>
                <div>
                  <span className="text-sm font-semibold text-pkmn-gray-dark">Current Images</span>
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
                  <span className="text-sm font-semibold text-pkmn-gray-dark">Replace Images</span>
                  <label className="mt-1 flex items-center gap-2 cursor-pointer rounded-xl border border-dashed border-pkmn-border bg-pkmn-bg px-4 py-2.5 hover:border-pkmn-blue hover:bg-pkmn-blue/10 transition-colors">
                    <ImagePlus className="w-5 h-5 text-pkmn-blue" />
                    <span className="text-sm text-pkmn-gray">{editImages.length ? `${editImages.length} file(s) selected - Add more…` : 'Choose new images...'}</span>
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
                  <p className="text-xs text-pkmn-gray mt-1">Leave empty to keep existing images</p>
                </div>
                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={() => setEditItem(null)} className="flex-1 border border-pkmn-border text-pkmn-gray-dark font-semibold py-2.5 rounded-xl hover:bg-pkmn-bg transition-colors">Cancel</button>
                  <button
                    type="button"
                    onClick={() => {
                      const urls = editItem.images.map(i => i.url);
                      setLivePreview({ title: editTitle, description: editDescription, shortDescription: editShortDescription, price: editPrice, stock: editStock, maxPerUser: editMaxPerUser, imageUrls: urls });
                      setLivePreviewTab('quick');
                    }}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border-2 border-pkmn-blue/20 bg-pkmn-blue/10 py-2.5 text-sm font-semibold text-pkmn-blue transition hover:bg-pkmn-blue/15"
                  >
                    <Monitor size={16} /> Live Preview
                  </button>
                  <button type="submit" disabled={editSaving} className="flex-1 bg-pkmn-blue text-white font-semibold py-2.5 rounded-xl hover:bg-pkmn-blue-dark disabled:bg-pkmn-blue/50 transition-colors">
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
            <div className="bg-white border border-pkmn-border rounded-2xl shadow-2xl max-w-5xl w-full max-h-[92vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
              {/* Header with tabs */}
              <div className="flex items-center justify-between border-b border-pkmn-border px-6 py-4">
                <div className="flex items-center gap-4">
                  <h3 className="text-lg font-bold text-pkmn-text">Live Preview</h3>
                  <div className="flex bg-pkmn-bg rounded-lg p-1">
                    <button
                      onClick={() => setLivePreviewTab('quick')}
                      className={`px-4 py-1.5 text-sm font-semibold rounded-md transition-colors ${livePreviewTab === 'quick' ? 'bg-white text-pkmn-blue shadow-sm' : 'text-pkmn-gray hover:text-pkmn-gray-dark'}`}
                    >
                      <Smartphone size={14} className="inline mr-1.5 -mt-0.5" />
                      Quick View
                    </button>
                    <button
                      onClick={() => setLivePreviewTab('full')}
                      className={`px-4 py-1.5 text-sm font-semibold rounded-md transition-colors ${livePreviewTab === 'full' ? 'bg-white text-pkmn-blue shadow-sm' : 'text-pkmn-gray hover:text-pkmn-gray-dark'}`}
                    >
                      <Monitor size={14} className="inline mr-1.5 -mt-0.5" />
                      Full Page
                    </button>
                  </div>
                </div>
                <button onClick={() => setLivePreview(null)} className="p-1.5 hover:bg-pkmn-bg rounded-full transition-colors"><X size={20} /></button>
              </div>

              {/* Preview content */}
              <div className="flex-1 overflow-y-auto bg-pkmn-bg p-6">
                {livePreviewTab === 'quick' ? (
                  /* Quick View - card as it appears on storefront grid */
                  <div className="max-w-sm mx-auto">
                    <div className="bg-white rounded-2xl border border-pkmn-border shadow-sm overflow-hidden">
                      <div className="aspect-square bg-pkmn-bg flex items-center justify-center overflow-hidden">
                        {livePreview.imageUrls[0] ? (
                          <FallbackImage src={livePreview.imageUrls[0]} alt={livePreview.title} className="w-full h-full object-contain" fallbackClassName="flex items-center justify-center" fallbackSize={48} />
                        ) : (
                          <ImageIcon size={48} className="text-pkmn-gray-dark" />
                        )}
                      </div>
                      <div className="p-4 space-y-2">
                        <h3 className="font-bold text-pkmn-text text-lg truncate">{livePreview.title || 'Untitled'}</h3>
                        {livePreview.shortDescription && (
                          <p className="text-sm text-pkmn-gray line-clamp-2">{livePreview.shortDescription}</p>
                        )}
                        <div className="flex items-center justify-between pt-1">
                          <span className="text-xl font-bold text-pkmn-blue">${Number(livePreview.price || 0).toFixed(2)}</span>
                          <span className="text-sm text-pkmn-gray">{livePreview.stock || 0} in stock</span>
                        </div>
                        <button className="w-full bg-gradient-to-r from-pkmn-yellow to-pkmn-red text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 text-sm cursor-default">
                          <ShoppingCart size={16} /> Add to Cart
                        </button>
                      </div>
                    </div>
                    <p className="text-center text-xs text-pkmn-gray-dark mt-4">This is how the card appears on the storefront grid</p>
                  </div>
                ) : (
                  /* Full Page - mirrors the actual product detail page layout */
                  <div className="max-w-4xl mx-auto">
                    <div className="bg-white rounded-2xl border border-pkmn-border shadow-sm overflow-hidden">
                      <div className="md:flex">
                        {/* Gallery */}
                        <div className="md:w-1/2 bg-pkmn-bg p-8">
                          <div className="flex items-center justify-center aspect-square mb-4">
                            {livePreview.imageUrls[0] ? (
                              <FallbackImage src={livePreview.imageUrls[0]} alt={livePreview.title} className="max-h-full max-w-full object-contain rounded-xl" fallbackClassName="flex items-center justify-center" fallbackSize={64} />
                            ) : (
                              <div className="flex items-center justify-center text-pkmn-gray-dark"><ImageIcon size={64} /></div>
                            )}
                          </div>
                          {livePreview.imageUrls.length > 1 && (
                            <div className="flex gap-2 justify-center flex-wrap">
                              {livePreview.imageUrls.map((url, idx) => (
                                <div key={idx} className="w-16 h-16 rounded-lg overflow-hidden border-2 border-pkmn-border">
                                  <img src={url} alt="" className="w-full h-full object-cover" />
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Details */}
                        <div className="md:w-1/2 p-8 flex flex-col">
                          <h1 className="text-3xl font-black text-pkmn-text mb-2 break-words">{livePreview.title || 'Untitled'}</h1>
                          <div className="flex items-center gap-2 mb-4">
                            <div className="flex text-yellow-400">
                              {[...Array(5)].map((_, i) => <Star key={i} size={16} fill="currentColor" />)}
                            </div>
                            <span className="text-sm text-pkmn-gray">(5.0)</span>
                          </div>
                          <p className="text-3xl font-bold text-pkmn-blue mb-6">${Number(livePreview.price || 0).toFixed(2)}</p>
                          <RichText html={livePreview.description} className="mb-6 leading-relaxed flex-grow text-pkmn-gray [&>ul]:list-disc [&>ul]:pl-4 [&>ol]:list-decimal [&>ol]:pl-4 [&>p]:mb-1 [&_strong]:font-semibold [&_em]:italic [&_table]:border-collapse [&_td]:border [&_td]:border-pkmn-border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-pkmn-border [&_th]:px-2 [&_th]:py-1 [&_th]:bg-pkmn-bg [&_th]:font-semibold" />
                          <div className="space-y-3 mb-6">
                            <div className="flex justify-between text-sm">
                              <span className="text-pkmn-gray">Availability</span>
                              <span className="font-semibold text-green-600">{livePreview.stock || 0} in stock</span>
                            </div>
                            <div className="flex justify-between text-sm">
                              <span className="text-pkmn-gray">Max per student</span>
                              <span className="font-semibold text-pkmn-text">{livePreview.maxPerUser || 1}</span>
                            </div>
                          </div>
                          <div className="space-y-3">
                            <div className="flex items-center gap-3">
                              <span className="text-sm font-semibold text-pkmn-gray-dark">Quantity:</span>
                              <div className="flex items-center bg-pkmn-bg rounded-lg p-1">
                                <button className="p-2 hover:bg-pkmn-bg rounded transition-colors text-pkmn-gray-dark cursor-default"><MinusIcon size={16} /></button>
                                <span className="w-10 text-center font-semibold text-pkmn-text">1</span>
                                <button className="p-2 hover:bg-pkmn-bg rounded transition-colors text-pkmn-gray-dark cursor-default"><PlusIcon size={16} /></button>
                              </div>
                            </div>
                            <button className="w-full bg-gradient-to-r from-pkmn-yellow to-pkmn-red text-white font-bold py-4 rounded-xl flex items-center justify-center gap-2 text-lg cursor-default">
                              <ShoppingCart size={20} /> Add to Cart
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                    <p className="text-center text-xs text-pkmn-gray-dark mt-4">This is how the full product page will appear to customers</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* TCG Import Modal */}
      {showTCGModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setShowTCGModal(false)}>
          <div className="bg-white rounded-xl shadow-2xl max-w-3xl w-full max-h-[80vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-black text-pkmn-text">Import Card from Database</h3>
              <button onClick={() => setShowTCGModal(false)} className="p-2 hover:bg-pkmn-bg rounded-full"><X size={20} /></button>
            </div>
            <div className="flex gap-3 mb-6">
              <input
                type="text"
                placeholder="Search by card name (e.g. Charizard)..."
                value={tcgQuery}
                onChange={e => setTcgQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && searchTCG()}
                className="flex-1 bg-white border border-pkmn-border p-3 rounded-md text-sm focus:outline-none focus:border-pkmn-blue focus:ring-1 focus:ring-pkmn-blue"
              />
              <button onClick={searchTCG} disabled={tcgLoading} className="bg-pkmn-blue text-white font-bold px-6 py-3 rounded-md hover:bg-pkmn-blue-dark transition-colors text-sm">
                {tcgLoading ? 'Searching...' : 'Search'}
              </button>
            </div>
            {tcgResults.length > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {tcgResults.map(card => (
                  <button
                    key={card.api_id}
                    onClick={() => importTCGCard(card)}
                    className="border border-pkmn-border rounded-lg p-2 hover:border-pkmn-blue hover:shadow-md transition-all text-left"
                  >
                    {card.image_small && (
                      <img src={card.image_small} alt={card.name} className="w-full rounded mb-2" />
                    )}
                    <p className="text-xs font-bold text-pkmn-text line-clamp-2">{card.name}</p>
                    <p className="text-xs text-pkmn-gray">{card.set_name}</p>
                  </button>
                ))}
              </div>
            )}
            {tcgResults.length === 0 && !tcgLoading && tcgQuery && (
              <p className="text-center text-pkmn-gray py-8">No results found. Try a different search.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
