"use client";
/* eslint-disable @next/next/no-img-element */

import { useState, useEffect, useRef, type FormEvent } from 'react';
import dynamic from 'next/dynamic';
import axios from 'axios';
import { useRequireAuth } from '../../hooks/useRequireAuth';
import Navbar from '../../components/Navbar';
import { Star, Trash2, ImagePlus, X } from 'lucide-react';
import FallbackImage from '../../components/FallbackImage';
import RichText from '../../components/RichText';
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
        setMessage('Session expired - please log in again.');
        setMsgType('error');
        toast.error('Session expired - please log in again.');
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
        toast.error('Session expired - please log in again.');
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
        toast.error('Session expired - please log in again.');
      } else {
        toast.error('Failed to update card.');
      }
    }
  };

  if (!user?.is_admin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-pkmn-bg">
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
        <div className="mb-8">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-pkmn-yellow-dark">Admin</p>
          <h1 className="mt-3 text-3xl sm:text-4xl font-extrabold text-pkmn-text flex items-center gap-2">
            <Star className="w-8 h-8 text-pkmn-yellow" /> Wanted Cards
          </h1>
          <p className="mt-2 text-pkmn-gray">Cards you&apos;re looking to buy or trade for.</p>
        </div>

        {/* Create form */}
        <form onSubmit={handleCreate} className="bg-white border border-pkmn-border rounded-3xl p-8 shadow-sm space-y-5 mb-10">
          <h2 className="text-lg font-bold text-pkmn-text">Add Wanted Card</h2>

          <div className="grid gap-5 sm:grid-cols-3">
            <div className="block sm:col-span-2">
              <span className="text-sm font-semibold text-pkmn-gray-dark">Search TCG Database *</span>
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
                <div className="flex items-center gap-2 mt-1">
                  <p className="text-xs text-green-600">Linked to TCG #{tcgProductId} ({tcgSubType})</p>
                  <a
                    href={`https://www.tcgplayer.com/product/${tcgProductId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-pkmn-blue hover:text-pkmn-blue hover:underline"
                  >
                    TCGPlayer �-
                  </a>
                </div>
              )}
              <input type="hidden" value={name} required />
            </div>
            <label className="block">
              <span className="text-sm font-semibold text-pkmn-gray-dark">Est. Value ($)</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={estimatedValue}
                onChange={e => setEstimatedValue(e.target.value)}
                placeholder="50.00"
                className="mt-2 block w-full rounded-3xl border border-pkmn-border bg-pkmn-bg px-4 py-3 text-pkmn-text focus:border-pkmn-blue focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </label>
            <div className="block">
              <span className="text-sm font-semibold text-pkmn-gray-dark">Images</span>
              <label className="mt-2 flex items-center gap-2 cursor-pointer rounded-3xl border border-dashed border-pkmn-border bg-pkmn-bg px-4 py-3 hover:border-pkmn-blue hover:bg-pkmn-blue/10 transition-colors">
                <ImagePlus className="w-5 h-5 text-pkmn-blue" />
                <span className="text-sm text-pkmn-gray">Add images&hellip;</span>
                <input type="file" accept="image/*" multiple onChange={e => addFiles(e.target.files)} className="hidden" />
              </label>
            </div>
          </div>

          {imageFiles.length > 0 && (
            <div className="flex flex-wrap gap-3">
              {imageFiles.map((f, i) => (
                <div key={i} className="relative group">
                  <img src={imageUrls[i]} alt={f.name} className="w-16 h-16 object-cover rounded-xl border border-pkmn-border" />
                  <button type="button" onClick={() => removeFile(i)} className="absolute -top-2 -right-2 bg-pkmn-red/100 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="block">
            <span className="text-sm font-semibold text-pkmn-gray-dark">Description</span>
            <div className="mt-2 [&_.ql-container]:rounded-b-xl [&_.ql-toolbar]:rounded-t-xl [&_.ql-editor]:min-h-[80px] [&_.ql-editor]:font-normal">
              <ReactQuill theme="snow" value={description} onChange={setDescription} placeholder="Notes about condition, set, etc." modules={quillModules} formats={quillFormats} />
            </div>
          </div>

          <div className="flex items-center justify-between">
            {message && (
              <p className={`text-sm font-medium ${msgType === 'success' ? 'text-emerald-700' : 'text-pkmn-red'}`}>{message}</p>
            )}
            <button
              type="submit"
              disabled={saving}
              className="ml-auto inline-flex items-center justify-center rounded-full bg-pkmn-yellow px-6 py-3 text-sm font-semibold text-white shadow-lg transition hover:bg-yellow-600 disabled:bg-yellow-300"
            >
              {saving ? 'Saving\u2026' : '\u2B50 Add to Wanted List'}
            </button>
          </div>
        </form>

        {/* Existing wanted cards */}
        {cards.length === 0 ? (
          <div className="bg-white border-2 border-dashed border-pkmn-border rounded-2xl p-12 text-center">
            <Star className="w-12 h-12 text-pkmn-yellow mx-auto mb-4" />
            <h3 className="text-xl font-bold text-pkmn-text mb-2">No wanted cards yet</h3>
            <p className="text-pkmn-gray">Add your first card above.</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {cards.map(card => (
              <div key={card.id} className={`bg-white border rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow ${!card.is_active ? 'opacity-60' : ''}`}>
                {card.images.length > 0 ? (
                  <FallbackImage src={card.images[0].url} alt={card.name} className="w-full h-48 object-contain p-2" fallbackClassName="w-full h-48 bg-pkmn-bg flex items-center justify-center" fallbackSize={40} />
                ) : (
                  <div className="w-full h-48 bg-pkmn-bg flex items-center justify-center"><Star className="w-10 h-10 text-pkmn-gray-dark" /></div>
                )}
                <div className="p-4">
                  <h3 className="font-bold text-pkmn-text">{card.name}</h3>
                  {card.description && <div className="text-sm text-pkmn-gray mt-1 line-clamp-2 [&_p]:m-0"><RichText html={card.description} /></div>}
                  <p className="text-sm font-semibold text-green-600 mt-2">${Number(card.estimated_value).toFixed(2)}</p>
                  <div className="flex items-center gap-2 mt-3">
                    <button
                      onClick={() => toggleActive(card)}
                      className={`text-xs px-3 py-1 rounded-full font-semibold transition-colors ${card.is_active ? 'bg-green-500/100/100/100/15 text-green-600 hover:bg-green-500/100/100/20' : 'bg-pkmn-bg text-pkmn-gray hover:bg-pkmn-bg'}`}
                    >
                      {card.is_active ? 'Active' : 'Inactive'}
                    </button>
                    <button
                      onClick={() => handleDelete(card.slug)}
                      className="ml-auto text-pkmn-red hover:text-pkmn-red p-1 rounded transition-colors hover:bg-pkmn-red/10"
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
