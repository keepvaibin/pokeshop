"use client";

import { useEffect, useState, useCallback, useRef } from 'react';
import axios from 'axios';
import { API_BASE_URL as API } from '@/app/lib/api';
import { useRequireAuth } from '../../hooks/useRequireAuth';
import Navbar from '../../components/Navbar';
import { AlertTriangle, Plus, Trash2, Search, ShieldAlert, User } from 'lucide-react';
import toast from 'react-hot-toast';

interface Strike {
  id: number;
  user_id: number;
  user_email: string;
  reason: string;
  given_by_email: string | null;
  acknowledged: boolean;
  created_at: string;
}

interface UserWithStrikes {
  id: number;
  email: string;
  username: string;
  strike_count: number;
}

interface SearchResult {
  id: number;
  email: string;
  display: string;
}

export default function AdminStrikesPage() {
  const { user } = useRequireAuth({ adminOnly: true });
  const [usersWithStrikes, setUsersWithStrikes] = useState<UserWithStrikes[]>([]);
  const [strikes, setStrikes] = useState<Strike[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);

  // New strike form
  const [searchQuery, setSearchQuery] = useState('');
  const [targetUserId, setTargetUserId] = useState<number | null>(null);
  const [targetEmail, setTargetEmail] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const getHeaders = () => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
    return { Authorization: `Bearer ${token}` };
  };

  const fetchUsersWithStrikes = useCallback(async () => {
    try {
      const res = await axios.get(`${API}/api/auth/users-with-strikes/`, { headers: getHeaders() });
      setUsersWithStrikes(res.data);
    } catch {
      toast.error('Failed to load strike data');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchStrikesForUser = useCallback(async (userId: number) => {
    try {
      const res = await axios.get(`${API}/api/auth/strikes/?user_id=${userId}`, { headers: getHeaders() });
      setStrikes(res.data);
    } catch {
      toast.error('Failed to load strikes');
    }
  }, []);

  useEffect(() => {
    if (user?.is_admin) fetchUsersWithStrikes();
  }, [user, fetchUsersWithStrikes]);

  useEffect(() => {
    if (selectedUserId) fetchStrikesForUser(selectedUserId);
    else setStrikes([]);
  }, [selectedUserId, fetchStrikesForUser]);

  // Live debounced search
  useEffect(() => {
    if (targetUserId) return; // Don't search when a user is already selected
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await axios.get(`${API}/api/auth/search-users/?q=${encodeURIComponent(q)}`, { headers: getHeaders() });
        setSearchResults(res.data);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [searchQuery, targetUserId]);

  const handleAddStrike = async () => {
    if (!targetUserId || !reason.trim()) {
      toast.error('Please select a user and enter a reason');
      return;
    }
    setSubmitting(true);
    try {
      const res = await axios.post(`${API}/api/auth/strikes/`, {
        user_id: targetUserId,
        reason: reason.trim(),
      }, { headers: getHeaders() });
      toast.success(`Strike added (${res.data.total_strikes} total)`);
      setReason('');
      setTargetUserId(null);
      setTargetEmail('');
      setSearchQuery('');
      setSearchResults([]);
      fetchUsersWithStrikes();
      if (selectedUserId === targetUserId) fetchStrikesForUser(selectedUserId);
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.data?.error) {
        toast.error(err.response.data.error);
      } else {
        toast.error('Failed to add strike');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteStrike = async (strikeId: number) => {
    if (!confirm('Remove this strike?')) return;
    try {
      await axios.delete(`${API}/api/auth/strikes/${strikeId}/`, { headers: getHeaders() });
      toast.success('Strike removed');
      setStrikes(prev => prev.filter(s => s.id !== strikeId));
      fetchUsersWithStrikes();
    } catch {
      toast.error('Failed to remove strike');
    }
  };

  if (!user) return null;

  return (
    <div className="pkc-shell bg-pkmn-bg min-h-screen">
      <Navbar />
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="flex items-center gap-3 mb-6">
          <ShieldAlert className="w-8 h-8 text-pkmn-red" />
          <div>
            <h1 className="text-3xl font-heading font-bold text-pkmn-text uppercase">Strike Management</h1>
            <p className="text-pkmn-gray text-sm">Manage user strikes. 3 strikes = restricted from ordering.</p>
          </div>
        </div>

        {/* Add Strike Form */}
        <div className="pkc-panel p-4 mb-6">
          <h2 className="font-bold text-pkmn-text mb-3 flex items-center gap-2">
            <Plus size={16} /> Issue New Strike
          </h2>
          <div className="space-y-3">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-pkmn-gray-dark" />
              <input
                type="text"
                placeholder="Search by name, nickname, discord, or email..."
                value={searchQuery}
                onChange={e => { setSearchQuery(e.target.value); if (targetUserId) { setTargetUserId(null); setTargetEmail(''); } }}
                className="w-full pl-10 pr-3 py-2.5 border border-pkmn-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pkmn-blue/30"
              />
              {searching && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-pkmn-blue" />
                </div>
              )}
            </div>

            {searchResults.length > 0 && !targetUserId && (
              <div className="bg-pkmn-bg border border-pkmn-border rounded-lg p-2 space-y-1 max-h-48 overflow-y-auto">
                {searchResults.map(u => (
                  <button
                    key={u.id}
                    onClick={() => { setTargetUserId(u.id); setTargetEmail(u.email); setSearchResults([]); setSearchQuery(u.email); }}
                    className="w-full text-left px-3 py-2 rounded-lg hover:bg-white text-sm text-pkmn-text transition-colors flex items-center gap-2"
                  >
                    <User size={14} className="text-pkmn-gray flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="font-medium truncate">{u.email}</p>
                      {u.display !== u.email && <p className="text-xs text-pkmn-gray truncate">{u.display}</p>}
                    </div>
                  </button>
                ))}
              </div>
            )}

            {searchQuery.trim().length >= 2 && searchResults.length === 0 && !searching && !targetUserId && (
              <p className="text-xs text-pkmn-gray text-center py-2">No users found</p>
            )}

            {targetUserId && (
              <div className="flex items-center gap-2 bg-pkmn-blue/10 border border-pkmn-blue/20 rounded-lg px-3 py-2 text-sm">
                <User size={14} className="text-pkmn-blue" />
                <span className="text-pkmn-text font-medium">{targetEmail}</span>
                <button onClick={() => { setTargetUserId(null); setTargetEmail(''); setSearchQuery(''); }} className="ml-auto text-pkmn-gray hover:text-pkmn-red transition-colors text-xs font-bold">Clear</button>
              </div>
            )}

            <textarea
              placeholder="Reason for the strike..."
              value={reason}
              onChange={e => setReason(e.target.value)}
              className="w-full px-3 py-2 border border-pkmn-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pkmn-blue/30 resize-none"
              rows={2}
            />
            <button
              onClick={handleAddStrike}
              disabled={!targetUserId || !reason.trim() || submitting}
              className="w-full bg-pkmn-red text-white font-bold py-2.5 px-4 rounded-lg hover:bg-pkmn-red-dark transition-all active:scale-95 disabled:opacity-50 text-sm flex items-center justify-center gap-2"
            >
              <AlertTriangle size={16} />
              {submitting ? 'Adding Strike...' : 'Issue Strike'}
            </button>
          </div>
        </div>

        {/* Users with Strikes */}
        <div className="pkc-panel p-4">
          <h2 className="font-bold text-pkmn-text mb-3">Users with Strikes</h2>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-pkmn-blue" />
            </div>
          ) : usersWithStrikes.length === 0 ? (
            <p className="text-pkmn-gray text-sm text-center py-6">No users have strikes.</p>
          ) : (
            <div className="space-y-2">
              {usersWithStrikes.map(u => (
                <button
                  key={u.id}
                  onClick={() => setSelectedUserId(selectedUserId === u.id ? null : u.id)}
                  className={`w-full text-left px-4 py-3 rounded-lg border transition-colors ${
                    selectedUserId === u.id
                      ? 'bg-pkmn-blue/10 border-pkmn-blue/30'
                      : 'bg-white border-pkmn-border hover:bg-pkmn-bg'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-pkmn-text">{u.email}</p>
                      <p className="text-xs text-pkmn-gray">@{u.username}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                        u.strike_count >= 3
                          ? 'bg-pkmn-red/15 text-pkmn-red'
                          : u.strike_count >= 2
                            ? 'bg-pkmn-yellow/15 text-pkmn-yellow-dark'
                            : 'bg-pkmn-gray/10 text-pkmn-gray-dark'
                      }`}>
                        {u.strike_count} strike{u.strike_count !== 1 ? 's' : ''}
                      </span>
                      {u.strike_count >= 3 && (
                        <span className="text-[10px] font-bold text-pkmn-red uppercase">Restricted</span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Strike details for selected user */}
          {selectedUserId && strikes.length > 0 && (
            <div className="mt-4 border-t border-pkmn-border pt-4 space-y-2">
              <h3 className="text-sm font-bold text-pkmn-gray uppercase mb-2">Strike History</h3>
              {strikes.map(s => (
                <div key={s.id} className="flex items-start justify-between bg-pkmn-bg rounded-lg p-3 border border-pkmn-border">
                  <div>
                    <p className="text-sm text-pkmn-text">{s.reason}</p>
                    <p className="text-[10px] text-pkmn-gray mt-1">
                      {new Date(s.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      {s.given_by_email && ` · by ${s.given_by_email}`}
                      {s.acknowledged && ' · acknowledged'}
                    </p>
                  </div>
                  <button
                    onClick={() => handleDeleteStrike(s.id)}
                    className="p-1.5 text-pkmn-gray hover:text-pkmn-red hover:bg-pkmn-red/10 rounded-lg transition-colors flex-shrink-0"
                    title="Remove strike"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
