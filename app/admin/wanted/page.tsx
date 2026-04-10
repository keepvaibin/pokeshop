"use client";
/* eslint-disable @next/next/no-img-element */

import { useState, useEffect, useRef, type FormEvent } from 'react';
import dynamic from 'next/dynamic';
import axios from 'axios';
import { useRequireAuth } from '../../hooks/useRequireAuth';
import Navbar from '../../components/Navbar';
import { Star, Trash2, ImagePlus, X } from 'lucide-react';
import FallbackImage from '../../components/FallbackImage';
import toast from 'react-hot-toast';
import TCGCardSearch, { type TCGCard } from '../../components/TCGCardSearch';

import 'react-quill-new/dist/quill.snow.css';

const ReactQuill = dynamic(() => import('react-quill-new'), { ssr: false });

const quillModules = {
  toolbar: [
    ['bold', 'italic', 'underline'],
    [{ list: 'ordered' }, { list: 'bullet' }],
    ['clean'],
  ],
};

const quillFormats = ['bold', 'italic', 'underline', 'list'];

interface WantedCard {
  id: number;
  name: string;
  slug: string;
  description: string;
  estimated_value: string;
  is_active: boolean;
  images: { id: number; url: string; position: number }[];
}

export default function AdminWantedPage() {
  const { user } = useRequireAuth({ adminOnly: true });
  const [cards, setCards] = useState<WantedCard[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [estimatedValue, setEstimatedValue] = useState('');
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [tcgProductId, setTcgProductId] = useState<number | null>(null);
  const [tcgSubType, setTcgSubType] = useState('');
  const [message, setMessage] = useState('');
  const [msgType, setMsgType] = useState<'success' | 'error'>('success');

  const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
  const headers = { Authorization: `Bearer ${token}` };

  const fetchCards = () => {
    axios
      .get('http://localhost:8000/api/inventory/wanted/', { headers })
      .then(r => setCards(r.data.results ?? r.data))
      .catch(() => {});
  };

  const isAdmin = user?.is_admin;
  useEffect(() => {
    if (isAdmin) fetchCards();
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

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      const fd = new FormData();
      fd.append('name', name);
      fd.append('description', description);
      fd.append('estimated_value', estimatedValue || '0');
      fd.append('is_active', 'true');
      if (tcgProductId) fd.append('tcg_product_id', String(tcgProductId));
      if (tcgSubType) fd.append('tcg_sub_type', tcgSubType);
      imageFiles.forEach(f => fd.append('images', f));
      await axios.post('http://localhost:8000/api/inventory/wanted/', fd, {
        headers: { ...headers, 'Content-Type': 'multipart/form-data' },
      });
      setName('');
      setDescription('');
      setEstimatedValue('');
      setTcgProductId(null);
      setTcgSubType('');
      imageUrls.forEach(url => URL.revokeObjectURL(url));
      setImageFiles([]);
      setImageUrls([]);
      setMessage('Wanted card created!');
      setMsgType('success');
      toast.success('Wanted card created!');
      fetchCards();
    } catch (err: unknown) {
      if (axios.isAxiosError(err) && err.response?.status === 401) {
        setMessage('Session expired — please log in again.');
        setMsgType('error');
        toast.error('Session expired — please log in again.');
      } else {
        setMessage('Failed to create wanted card.');
        setMsgType('error');
        toast.error('Failed to create wanted card.');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (slug: string) => {
    if (!confirm('Remove this wanted card?')) return;
    try {
      await axios.delete(`http://localhost:8000/api/inventory/wanted/${slug}/`, { headers });
      setCards(prev => prev.filter(c => c.slug !== slug));
      toast.success('Card deleted');
    } catch (err: unknown) {
      if (axios.isAxiosError(err) && err.response?.status === 401) {
        toast.error('Session expired — please log in again.');
      } else {
        toast.error('Failed to delete card.');
      }
    }
  };

  const toggleActive = async (card: WantedCard) => {
    try {
      await axios.patch(
        `http://localhost:8000/api/inventory/wanted/${card.slug}/`,
        { is_active: !card.is_active },
        { headers }
      );
      setCards(prev => prev.map(c => (c.id === card.id ? { ...c, is_active: !c.is_active } : c)));
      toast.success(`Card ${card.is_active ? 'deactivated' : 'activated'}`);
    } catch (err: unknown) {
      if (axios.isAxiosError(err) && err.response?.status === 401) {
        toast.error('Session expired — please log in again.');
      } else {
        toast.error('Failed to update card.');
      }
    }
  };

  if (!user?.is_admin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-zinc-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4" />
          <p className="text-gray-600">Redirecting to login&hellip;</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-100 dark:bg-zinc-900 min-h-screen">
      <Navbar />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-10">
        <div className="mb-8">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-yellow-600">Admin</p>
          <h1 className="mt-3 text-3xl sm:text-4xl font-extrabold text-gray-900 dark:text-zinc-100 flex items-center gap-2">
            <Star className="w-8 h-8 text-yellow-500" /> Wanted Cards
          </h1>
          <p className="mt-2 text-gray-600">Cards you&apos;re looking to buy or trade for.</p>
        </div>

        {/* Create form */}
        <form onSubmit={handleCreate} className="bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-3xl p-8 shadow-sm space-y-5 mb-10">
          <h2 className="text-lg font-bold text-gray-800">Add Wanted Card</h2>

          <div className="grid gap-5 sm:grid-cols-3">
            <div className="block sm:col-span-2">
              <span className="text-sm font-semibold text-gray-700">Search TCG Database *</span>
              <div className="mt-2">
                <TCGCardSearch
                  onSelect={(card: TCGCard) => {
                    setName(card.name);
                    setEstimatedValue(String(card.market_price));
                    setTcgProductId(card.product_id);
                    setTcgSubType(card.sub_type_name);
                  }}
                  initialValue={name}
                />
              </div>
              {tcgProductId && (
                <p className="text-xs text-green-600 mt-1">Linked to TCG #{tcgProductId} ({tcgSubType})</p>
              )}
              <input type="hidden" value={name} required />
            </div>
            <label className="block">
              <span className="text-sm font-semibold text-gray-700">Est. Value ($)</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={estimatedValue}
                onChange={e => setEstimatedValue(e.target.value)}
                placeholder="50.00"
                className="mt-2 block w-full rounded-3xl border border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-900 px-4 py-3 text-gray-900 dark:text-zinc-100 focus:border-blue-500 focus:bg-white dark:focus:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </label>
            <div className="block">
              <span className="text-sm font-semibold text-gray-700">Images</span>
              <label className="mt-2 flex items-center gap-2 cursor-pointer rounded-3xl border border-dashed border-gray-300 dark:border-zinc-600 bg-gray-50 dark:bg-zinc-900 px-4 py-3 hover:border-blue-400 hover:bg-blue-50 transition-colors">
                <ImagePlus className="w-5 h-5 text-blue-600" />
                <span className="text-sm text-gray-600">Add images&hellip;</span>
                <input type="file" accept="image/*" multiple onChange={e => addFiles(e.target.files)} className="hidden" />
              </label>
            </div>
          </div>

          {imageFiles.length > 0 && (
            <div className="flex flex-wrap gap-3">
              {imageFiles.map((f, i) => (
                <div key={i} className="relative group">
                  <img src={imageUrls[i]} alt={f.name} className="w-16 h-16 object-cover rounded-xl border border-gray-200 dark:border-zinc-700" />
                  <button type="button" onClick={() => removeFile(i)} className="absolute -top-2 -right-2 bg-red-500 text-zinc-50 dark:text-zinc-100 rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="block">
            <span className="text-sm font-semibold text-gray-700">Description</span>
            <div className="mt-2 [&_.ql-container]:rounded-b-xl [&_.ql-toolbar]:rounded-t-xl [&_.ql-toolbar]:border-gray-200 dark:border-zinc-700 [&_.ql-container]:border-gray-200 dark:border-zinc-700 [&_.ql-editor]:min-h-[80px] [&_.ql-editor]:text-gray-900 dark:text-zinc-100 [&_.ql-editor]:font-normal">
              <ReactQuill theme="snow" value={description} onChange={setDescription} placeholder="Notes about condition, set, etc." modules={quillModules} formats={quillFormats} />
            </div>
          </div>

          <div className="flex items-center justify-between">
            {message && (
              <p className={`text-sm font-medium ${msgType === 'success' ? 'text-emerald-700' : 'text-red-700'}`}>{message}</p>
            )}
            <button
              type="submit"
              disabled={saving}
              className="ml-auto inline-flex items-center justify-center rounded-full bg-yellow-500 px-6 py-3 text-sm font-semibold text-zinc-50 dark:text-zinc-100 shadow-lg transition hover:bg-yellow-600 disabled:bg-yellow-300"
            >
              {saving ? 'Saving\u2026' : '\u2B50 Add to Wanted List'}
            </button>
          </div>
        </form>

        {/* Existing wanted cards */}
        {cards.length === 0 ? (
          <div className="bg-white dark:bg-zinc-800 border-2 border-dashed border-gray-300 dark:border-zinc-600 rounded-2xl p-12 text-center">
            <Star className="w-12 h-12 text-yellow-500 mx-auto mb-4" />
            <h3 className="text-xl font-bold text-gray-800 mb-2">No wanted cards yet</h3>
            <p className="text-gray-600">Add your first card above.</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {cards.map(card => (
              <div key={card.id} className={`bg-white dark:bg-zinc-800 border rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow ${!card.is_active ? 'opacity-60' : ''}`}>
                {card.images.length > 0 ? (
                  <FallbackImage src={card.images[0].url} alt={card.name} className="w-full h-40 object-cover" fallbackClassName="w-full h-40 bg-gray-100 dark:bg-zinc-800 flex items-center justify-center" fallbackSize={40} />
                ) : (
                  <div className="w-full h-40 bg-gray-100 dark:bg-zinc-800 flex items-center justify-center"><Star className="w-10 h-10 text-gray-300" /></div>
                )}
                <div className="p-4">
                  <h3 className="font-bold text-gray-900 dark:text-zinc-100">{card.name}</h3>
                  {card.description && <p className="text-sm text-gray-600 mt-1 line-clamp-2">{card.description}</p>}
                  <p className="text-sm font-semibold text-green-700 mt-2">${Number(card.estimated_value).toFixed(2)}</p>
                  <div className="flex items-center gap-2 mt-3">
                    <button
                      onClick={() => toggleActive(card)}
                      className={`text-xs px-3 py-1 rounded-full font-semibold transition-colors ${card.is_active ? 'bg-green-100 text-green-800 hover:bg-green-200' : 'bg-gray-100 dark:bg-zinc-800 text-gray-600 hover:bg-gray-200'}`}
                    >
                      {card.is_active ? 'Active' : 'Inactive'}
                    </button>
                    <button
                      onClick={() => handleDelete(card.slug)}
                      className="ml-auto text-red-500 hover:text-red-700 p-1 rounded transition-colors hover:bg-red-50"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
