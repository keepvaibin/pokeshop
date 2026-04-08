"use client";

import { useState, type FormEvent } from 'react';
import axios from 'axios';
import Link from 'next/link';
import { useAuth } from '../../contexts/AuthContext';
import Navbar from '../../components/Navbar';
import { UploadCloud, AlertCircle } from 'lucide-react';

export default function AdminInventoryPage() {
  const { user } = useAuth();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('');
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [status, setStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const isAdmin = user?.is_admin;
  const handleImageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      setImageFiles(Array.from(event.target.files));
    }
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
      formData.append('stock', stock || '0');
      formData.append('max_per_user', '1');
      formData.append('is_active', 'true');
      if (price) {
        formData.append('price', price);
      }
      imageFiles.forEach((file, index) => {
        formData.append('image', file);
      });

      const response = await axios.post('http://localhost:8000/api/inventory/items/', formData, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'multipart/form-data',
        },
      });

      setStatus('success');
      setMessage(`Created item: ${response.data.title}`);
      setTitle('');
      setDescription('');
      setPrice('');
      setStock('');
      setImageFiles([]);
    } catch (error) {
      console.error('Inventory creation failed', error);
      setStatus('error');
      setMessage('Unable to create item. Please check your inputs and try again.');
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 px-4">
        <div className="max-w-xl w-full bg-white rounded-3xl border border-gray-200 p-10 text-center shadow-lg">
          <AlertCircle className="mx-auto mb-4 w-16 h-16 text-red-500" />
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Please log in to access admin tools.</h1>
          <p className="text-gray-600">You must be signed in with a staff or admin account to manage inventory.</p>
          <Link href="/login" className="mt-6 inline-flex items-center justify-center rounded-full bg-blue-600 px-6 py-3 text-white font-semibold hover:bg-blue-700 transition-colors">
            Go to Login
          </Link>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 px-4">
        <div className="max-w-xl w-full bg-white rounded-3xl border border-gray-200 p-10 text-center shadow-lg">
          <AlertCircle className="mx-auto mb-4 w-16 h-16 text-red-500" />
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Access Denied</h1>
          <p className="text-gray-600">Only admin users can use the inventory management panel.</p>
          <Link href="/" className="mt-6 inline-flex items-center justify-center rounded-full bg-blue-600 px-6 py-3 text-white font-semibold hover:bg-blue-700 transition-colors">
            Return Home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-100 min-h-screen">
      <Navbar />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-10">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-blue-600">Admin Inventory</p>
            <h1 className="mt-3 text-3xl sm:text-4xl font-extrabold text-gray-900">Add a new item</h1>
            <p className="mt-2 text-gray-600 max-w-2xl">
              Create a fresh inventory item with image upload and live admin access.
            </p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-3 border border-gray-200 shadow-sm">
            <UploadCloud className="w-5 h-5 text-blue-600" />
            <span className="text-sm font-semibold text-gray-700">Multiple image upload</span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6 bg-white border border-gray-200 rounded-3xl p-8 shadow-sm">
          <div className="grid gap-6 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-semibold text-gray-700">Name</span>
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                required
                placeholder="Enter item name"
                className="mt-2 block w-full rounded-3xl border border-gray-200 bg-gray-50 px-4 py-3 text-gray-900 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
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
                className="mt-2 block w-full rounded-3xl border border-gray-200 bg-gray-50 px-4 py-3 text-gray-900 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </label>
          </div>

          <div className="grid gap-6 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-semibold text-gray-700">Price</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={price}
                onChange={e => setPrice(e.target.value)}
                placeholder="9.99"
                className="mt-2 block w-full rounded-3xl border border-gray-200 bg-gray-50 px-4 py-3 text-gray-900 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </label>

            <label className="block">
              <span className="text-sm font-semibold text-gray-700">Image</span>
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={handleImageChange}
                className="mt-2 block w-full text-sm text-gray-700 file:mr-4 file:rounded-full file:border-0 file:bg-blue-600 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-blue-700"
              />
              {imageFiles.length > 0 && (
                <p className="mt-2 text-sm text-gray-600">{imageFiles.length} file(s) selected</p>
              )}
            </label>
          </div>

          <label className="block">
            <span className="text-sm font-semibold text-gray-700">Description</span>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={6}
              placeholder="Write a short description for the new item."
              className="mt-2 block w-full rounded-3xl border border-gray-200 bg-gray-50 px-4 py-4 text-gray-900 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
          </label>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm text-gray-600">All fields are saved through the secure admin API.</p>
            </div>
            <button
              type="submit"
              disabled={status === 'saving'}
              className="inline-flex items-center justify-center rounded-full bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-200/20 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
            >
              {status === 'saving' ? 'Saving…' : 'Create Item'}
            </button>
          </div>

          {message && (
            <div className={`rounded-3xl px-5 py-4 text-sm font-medium ${status === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-red-50 text-red-700 border border-red-100'}`}>
              {message}
            </div>
          )}
        </form>

        <div className="mt-8 rounded-3xl border border-dashed border-gray-200 bg-white p-6 text-sm text-gray-600 shadow-sm">
          <p className="font-semibold text-gray-900">Pro tip</p>
          <p className="mt-2">Use clean, descriptive item names and upload a high-resolution image to make shop listings feel premium.</p>
        </div>
      </main>
    </div>
  );
}
