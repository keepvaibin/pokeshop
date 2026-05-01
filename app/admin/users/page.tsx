"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import Link from 'next/link';
import toast from 'react-hot-toast';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  DollarSign,
  ExternalLink,
  Mail,
  MessageCircle,
  Search,
  ShieldAlert,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import { API_BASE_URL as API } from '@/app/lib/api';
import { useRequireAuth } from '../../hooks/useRequireAuth';
import Navbar from '../../components/Navbar';
import FallbackImage from '../../components/FallbackImage';

const PAGE_SIZE = 48;

interface PokemonIconPayload {
  id: number;
  pokedex_number: number;
  display_name: string;
  region: string;
  filename: string;
}

interface AdminUserCard {
  id: number;
  email: string;
  username: string;
  is_admin: boolean;
  is_staff: boolean;
  is_active: boolean;
  first_name: string;
  last_name: string;
  nickname: string;
  display_name: string;
  discord_id: string | null;
  discord_handle: string;
  no_discord: boolean;
  pokemon_icon: PokemonIconPayload | null;
  pokemon_icon_filename: string | null;
  trade_credit_balance: string;
  strike_count: number;
  is_restricted: boolean;
  recent_order_count: number;
  current_order_count: number;
  date_joined: string | null;
  last_login: string | null;
}

interface AdminUsersResponse {
  count: number;
  page: number;
  page_size: number;
  total_pages: number;
  results: AdminUserCard[];
}

interface AdminOrderSummary {
  id: number;
  order_id: string;
  status: string;
  status_label: string;
  payment_method: string;
  payment_label: string;
  delivery_method: string;
  delivery_label: string;
  pickup_label: string;
  items_summary: string;
  total: string;
  discount_applied: string;
  store_credit_applied: string;
  created_at: string | null;
  updated_at: string | null;
}

interface StrikeSummary {
  id: number;
  reason: string;
  given_by_id: number | null;
  given_by_email: string | null;
  acknowledged: boolean;
  created_at: string | null;
}

interface CreditLedgerEntry {
  id: number;
  amount: string;
  transaction_type: string;
  reference_id: string;
  note: string;
  created_by_id: number | null;
  created_by_email: string | null;
  created_at: string | null;
}

interface AdminUserDetail {
  user: AdminUserCard;
  recent_orders: AdminOrderSummary[];
  current_orders: AdminOrderSummary[];
  strikes: StrikeSummary[];
  recent_credit_ledger: CreditLedgerEntry[];
}

function formatMoney(value: string | number) {
  const amount = Number(value || 0);
  return `$${amount.toFixed(2)}`;
}

function formatDate(value: string | null) {
  if (!value) return 'Never';
  return new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatDateTime(value: string | null) {
  if (!value) return 'Never';
  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function initialsFor(user: AdminUserCard) {
  const first = user.first_name?.trim()?.[0] || '';
  const last = user.last_name?.trim()?.[0] || '';
  const initials = `${first}${last}` || user.display_name?.trim()?.[0] || user.email?.trim()?.[0] || '?';
  return initials.toUpperCase();
}

function UserAvatar({ user, size = 'lg' }: { user: AdminUserCard; size?: 'md' | 'lg' | 'xl' }) {
  const sizeClass = size === 'xl' ? 'h-24 w-24' : size === 'lg' ? 'h-16 w-16' : 'h-11 w-11';
  const iconSize = size === 'xl' ? 42 : size === 'lg' ? 30 : 20;
  const filename = user.pokemon_icon_filename;
  if (filename) {
    return (
      <FallbackImage
        src={`/pkmn_icons/${filename}`}
        alt={`${user.display_name} profile icon`}
        className={`${sizeClass} object-contain`}
        fallbackSize={iconSize}
        fallbackClassName={`${sizeClass} bg-pkmn-bg border border-pkmn-border flex items-center justify-center`}
      />
    );
  }
  return (
    <div className={`${sizeClass} bg-pkmn-blue/10 border border-pkmn-blue/20 flex items-center justify-center text-pkmn-blue font-heading font-black`}>
      {initialsFor(user)}
    </div>
  );
}

function statusBadgeClass(status: string) {
  if (status === 'pending') return 'bg-pkmn-blue/15 text-pkmn-blue';
  if (status === 'fulfilled') return 'bg-green-500/15 text-green-600';
  if (status === 'cancelled') return 'bg-pkmn-red/15 text-pkmn-red';
  if (status === 'cash_needed') return 'bg-pkmn-yellow/20 text-pkmn-yellow-dark';
  if (status === 'trade_review' || status === 'pending_counteroffer') return 'bg-purple-500/15 text-purple-600';
  return 'bg-pkmn-bg text-pkmn-gray-dark';
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 px-4 py-6">
      <div className="w-full max-w-md bg-white border border-pkmn-border shadow-2xl">
        <div className="flex items-center justify-between border-b border-pkmn-border px-5 py-4">
          <h2 className="font-heading text-lg font-black uppercase text-pkmn-text">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="h-9 w-9 inline-flex items-center justify-center text-pkmn-gray hover:bg-pkmn-bg hover:text-pkmn-red transition-colors"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export default function AdminUsersPage() {
  const { user, loading: authLoading } = useRequireAuth({ adminOnly: true });
  const [users, setUsers] = useState<AdminUserCard[]>([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [strikeModalOpen, setStrikeModalOpen] = useState(false);
  const [creditModalOpen, setCreditModalOpen] = useState(false);
  const [strikeReason, setStrikeReason] = useState('');
  const [creditAmount, setCreditAmount] = useState('');
  const [creditNote, setCreditNote] = useState('');
  const [submittingStrike, setSubmittingStrike] = useState(false);
  const [submittingCredit, setSubmittingCredit] = useState(false);

  const canUseAdmin = !authLoading && !!user?.is_admin;

  const fetchUsers = useCallback(async () => {
    if (!canUseAdmin) return;
    setLoadingUsers(true);
    try {
      const params = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) });
      if (search.trim()) params.set('search', search.trim());
      const response = await axios.get<AdminUsersResponse>(`${API}/api/auth/admin/users/?${params.toString()}`);
      setUsers(response.data.results);
      setTotalCount(response.data.count);
      setTotalPages(response.data.total_pages);
      if (selectedId && !response.data.results.some(result => result.id === selectedId)) {
        setSelectedId(null);
        setDetail(null);
      }
    } catch {
      toast.error('Failed to load users');
    } finally {
      setLoadingUsers(false);
    }
  }, [canUseAdmin, page, search, selectedId]);

  const fetchDetail = useCallback(async (userId: number) => {
    setDetailLoading(true);
    try {
      const response = await axios.get<AdminUserDetail>(`${API}/api/auth/admin/users/${userId}/`);
      setDetail(response.data);
    } catch {
      toast.error('Failed to load user details');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!canUseAdmin) return;
    const timer = setTimeout(() => {
      fetchUsers();
    }, search.trim() ? 250 : 0);
    return () => clearTimeout(timer);
  }, [canUseAdmin, fetchUsers, search]);

  useEffect(() => {
    if (selectedId) fetchDetail(selectedId);
  }, [selectedId, fetchDetail]);

  function selectUser(nextUser: AdminUserCard) {
    setSelectedId(nextUser.id);
    setActionsOpen(false);
    setStrikeModalOpen(false);
    setCreditModalOpen(false);
  }

  async function submitStrike() {
    if (!detail || !strikeReason.trim()) {
      toast.error('Enter a strike reason');
      return;
    }
    setSubmittingStrike(true);
    try {
      await axios.post(`${API}/api/auth/strikes/`, {
        user_id: detail.user.id,
        reason: strikeReason.trim(),
      });
      toast.success('Strike issued');
      setStrikeReason('');
      setStrikeModalOpen(false);
      await fetchDetail(detail.user.id);
      await fetchUsers();
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.data?.error) {
        toast.error(err.response.data.error);
      } else {
        toast.error('Failed to issue strike');
      }
    } finally {
      setSubmittingStrike(false);
    }
  }

  async function submitCreditGrant() {
    if (!detail) return;
    const amount = Number(creditAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Enter a positive credit amount');
      return;
    }
    setSubmittingCredit(true);
    try {
      await axios.post(`${API}/api/trade-ins/admin/grant-credit/`, {
        user_id: detail.user.id,
        amount: amount.toFixed(2),
        note: creditNote.trim(),
      });
      toast.success('Store credit granted');
      setCreditAmount('');
      setCreditNote('');
      setCreditModalOpen(false);
      await fetchDetail(detail.user.id);
      await fetchUsers();
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.data?.error) {
        toast.error(err.response.data.error);
      } else {
        toast.error('Failed to grant store credit');
      }
    } finally {
      setSubmittingCredit(false);
    }
  }

  const selectedUser = detail?.user;
  const currentOrdersUrl = selectedUser ? `/admin/orders?user=${encodeURIComponent(selectedUser.email)}&status=active` : '/admin/orders';
  const pageLabel = useMemo(() => {
    if (!totalCount) return 'No users';
    const start = (page - 1) * PAGE_SIZE + 1;
    const end = Math.min(totalCount, page * PAGE_SIZE);
    return `${start}-${end} of ${totalCount}`;
  }, [page, totalCount]);

  if (authLoading || !user?.is_admin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-pkmn-bg">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-pkmn-blue mx-auto mb-4" />
          <p className="text-pkmn-gray">Redirecting to login...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-pkmn-bg min-h-screen">
      <Navbar adminMode />
      <main className="max-w-7xl mx-auto px-3 py-6 sm:px-4 sm:py-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 bg-pkmn-blue text-white flex items-center justify-center">
              <Users size={24} />
            </div>
            <div>
              <h1 className="text-3xl font-heading font-black uppercase text-pkmn-text">Users</h1>
              <p className="text-sm text-pkmn-gray">Search accounts, review orders, issue strikes, and grant store credit.</p>
            </div>
          </div>
          <div className="text-xs font-semibold uppercase tracking-[0.08rem] text-pkmn-gray">
            {pageLabel}
          </div>
        </div>

        <div className="bg-white border border-pkmn-border shadow-sm p-4 mb-6">
          <label className="block text-xs font-bold uppercase text-pkmn-gray mb-2">Search users</label>
          <div className="relative">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-pkmn-gray-dark" />
            <input
              type="text"
              value={search}
              onChange={(event) => { setSearch(event.target.value); setPage(1); }}
              placeholder="Email, name, nickname, Discord username, Discord ID..."
              className="w-full pl-10 pr-4 py-3 border border-pkmn-border rounded-md text-sm text-pkmn-text focus:outline-none focus:ring-2 focus:ring-pkmn-blue/30"
            />
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
          <section>
            {loadingUsers ? (
              <div className="flex items-center justify-center py-16 bg-white border border-pkmn-border shadow-sm">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-pkmn-blue" />
              </div>
            ) : users.length === 0 ? (
              <div className="bg-white border border-pkmn-border shadow-sm p-10 text-center">
                <Users className="mx-auto h-9 w-9 text-pkmn-gray mb-3" />
                <p className="font-heading font-bold uppercase text-pkmn-text">No users found</p>
                <p className="text-sm text-pkmn-gray mt-1">Try a different email, name, or Discord search.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {users.map(account => {
                  const active = selectedId === account.id;
                  return (
                    <button
                      key={account.id}
                      type="button"
                      onClick={() => selectUser(account)}
                      className={`min-h-[176px] bg-white border p-4 text-left shadow-sm transition-all hover:border-pkmn-blue hover:shadow-md focus:outline-none focus:ring-2 focus:ring-pkmn-blue/30 ${
                        active ? 'border-pkmn-blue ring-2 ring-pkmn-blue/20' : 'border-pkmn-border'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <UserAvatar user={account} />
                        <div className="flex flex-col items-end gap-1">
                          {account.is_admin && <span className="bg-pkmn-blue/15 text-pkmn-blue px-2 py-0.5 text-[10px] font-black uppercase">Admin</span>}
                          {account.is_restricted && <span className="bg-pkmn-red/15 text-pkmn-red px-2 py-0.5 text-[10px] font-black uppercase">Restricted</span>}
                        </div>
                      </div>
                      <div className="mt-4 min-w-0">
                        <p className="font-heading font-black text-pkmn-text truncate">{account.display_name}</p>
                        <p className="text-sm text-pkmn-gray truncate">{account.email}</p>
                        <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold">
                          <span className="bg-pkmn-bg border border-pkmn-border px-2 py-1 text-pkmn-gray-dark">
                            {account.current_order_count} current
                          </span>
                          <span className={`border px-2 py-1 ${account.strike_count > 0 ? 'bg-pkmn-red/10 border-pkmn-red/20 text-pkmn-red' : 'bg-pkmn-bg border-pkmn-border text-pkmn-gray-dark'}`}>
                            {account.strike_count} strikes
                          </span>
                          <span className="bg-green-500/10 border border-green-500/20 px-2 py-1 text-green-700">
                            {formatMoney(account.trade_credit_balance)} credit
                          </span>
                        </div>
                        {account.discord_handle && (
                          <p className="mt-3 text-xs text-pkmn-gray truncate">Discord: {account.discord_handle}</p>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {totalPages > 1 && (
              <div className="mt-6 flex flex-col gap-3 bg-white border border-pkmn-border p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
                <button
                  type="button"
                  onClick={() => setPage(prev => Math.max(1, prev - 1))}
                  disabled={page <= 1}
                  className="inline-flex w-full items-center justify-center gap-2 px-3 py-2 text-sm font-semibold text-pkmn-text border border-pkmn-border hover:bg-pkmn-bg disabled:opacity-40 sm:w-auto"
                >
                  <ChevronLeft size={16} /> Previous
                </button>
                <span className="text-center text-sm font-semibold text-pkmn-gray">Page {page} of {totalPages}</span>
                <button
                  type="button"
                  onClick={() => setPage(prev => Math.min(totalPages, prev + 1))}
                  disabled={page >= totalPages}
                  className="inline-flex w-full items-center justify-center gap-2 px-3 py-2 text-sm font-semibold text-pkmn-text border border-pkmn-border hover:bg-pkmn-bg disabled:opacity-40 sm:w-auto"
                >
                  Next <ChevronRight size={16} />
                </button>
              </div>
            )}
          </section>

          <aside className="bg-white border border-pkmn-border shadow-sm min-h-[520px] lg:sticky lg:top-4 lg:self-start">
            {detailLoading ? (
              <div className="flex items-center justify-center h-[520px]">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-pkmn-blue" />
              </div>
            ) : !detail || !selectedUser ? (
              <div className="h-[520px] flex flex-col items-center justify-center text-center p-8">
                <UserRound className="h-10 w-10 text-pkmn-gray mb-3" />
                <p className="font-heading font-black uppercase text-pkmn-text">Select a user</p>
                <p className="text-sm text-pkmn-gray mt-1">Account details and actions will appear here.</p>
              </div>
            ) : (
              <div>
                <div className="border-b border-pkmn-border p-5 bg-pkmn-bg/70">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                    <UserAvatar user={selectedUser} size="xl" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <h2 className="font-heading font-black text-xl text-pkmn-text truncate">{selectedUser.display_name}</h2>
                          <p className="text-sm text-pkmn-gray truncate">{selectedUser.email}</p>
                        </div>
                        <div className="relative sm:shrink-0">
                          <button
                            type="button"
                            onClick={() => setActionsOpen(prev => !prev)}
                            className="inline-flex items-center gap-1 px-3 py-2 bg-pkmn-blue text-white text-xs font-bold uppercase hover:bg-pkmn-blue-dark transition-colors"
                          >
                            Actions <ChevronDown size={14} />
                          </button>
                          {actionsOpen && (
                            <div className="absolute right-0 mt-2 w-56 max-w-[calc(100vw-2rem)] bg-white border border-pkmn-border shadow-lg z-20">
                              <button
                                type="button"
                                onClick={() => { setStrikeModalOpen(true); setActionsOpen(false); }}
                                className="w-full flex items-center gap-2 px-4 py-3 text-left text-sm hover:bg-pkmn-bg text-pkmn-text"
                              >
                                <ShieldAlert size={16} className="text-pkmn-red" /> Administer strike
                              </button>
                              <Link
                                href={currentOrdersUrl}
                                onClick={() => setActionsOpen(false)}
                                className="flex items-center gap-2 px-4 py-3 text-sm hover:bg-pkmn-bg text-pkmn-text"
                              >
                                <ExternalLink size={16} className="text-pkmn-blue" /> View current orders
                              </Link>
                              <button
                                type="button"
                                onClick={() => { setCreditModalOpen(true); setActionsOpen(false); }}
                                className="w-full flex items-center gap-2 px-4 py-3 text-left text-sm hover:bg-pkmn-bg text-pkmn-text"
                              >
                                <DollarSign size={16} className="text-green-600" /> Give store credit
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                        <div className="bg-white border border-pkmn-border p-2">
                          <p className="text-[10px] uppercase font-bold text-pkmn-gray">Credit</p>
                          <p className="text-sm font-black text-green-700">{formatMoney(selectedUser.trade_credit_balance)}</p>
                        </div>
                        <div className="bg-white border border-pkmn-border p-2">
                          <p className="text-[10px] uppercase font-bold text-pkmn-gray">Orders</p>
                          <p className="text-sm font-black text-pkmn-text">{selectedUser.recent_order_count}</p>
                        </div>
                        <div className="bg-white border border-pkmn-border p-2">
                          <p className="text-[10px] uppercase font-bold text-pkmn-gray">Strikes</p>
                          <p className={`text-sm font-black ${selectedUser.strike_count ? 'text-pkmn-red' : 'text-pkmn-text'}`}>{selectedUser.strike_count}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="p-5 space-y-6">
                  <section>
                    <h3 className="text-xs font-black uppercase text-pkmn-gray mb-3">Profile</h3>
                    <div className="space-y-2 text-sm">
                      <p className="flex min-w-0 items-center gap-2 break-all text-pkmn-text"><Mail size={15} className="shrink-0 text-pkmn-gray" /> {selectedUser.email}</p>
                      <p className="flex min-w-0 items-center gap-2 break-all text-pkmn-text"><MessageCircle size={15} className="shrink-0 text-pkmn-gray" /> {selectedUser.discord_handle || (selectedUser.no_discord ? 'No Discord' : 'Not linked')}</p>
                      <p className="flex items-center gap-2 text-pkmn-text"><Clock size={15} className="text-pkmn-gray" /> Joined {formatDate(selectedUser.date_joined)}</p>
                    </div>
                  </section>

                  <section>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-xs font-black uppercase text-pkmn-gray">Current orders</h3>
                      <Link href={currentOrdersUrl} className="text-xs font-bold text-pkmn-blue hover:underline">Open all</Link>
                    </div>
                    {detail.current_orders.length === 0 ? (
                      <p className="text-sm text-pkmn-gray bg-pkmn-bg border border-pkmn-border p-3">No current orders.</p>
                    ) : (
                      <div className="space-y-2">
                        {detail.current_orders.slice(0, 4).map(order => (
                          <Link key={order.id} href={`/orders/${order.order_id}`} className="block border border-pkmn-border p-3 hover:bg-pkmn-bg transition-colors">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-sm font-semibold text-pkmn-text truncate">{order.items_summary || `Order ${order.order_id.slice(0, 8)}`}</p>
                                <p className="text-xs text-pkmn-gray truncate">{order.pickup_label}</p>
                              </div>
                              <span className={`text-[10px] font-bold px-2 py-1 ${statusBadgeClass(order.status)}`}>{order.status_label}</span>
                            </div>
                          </Link>
                        ))}
                      </div>
                    )}
                  </section>

                  <section>
                    <h3 className="text-xs font-black uppercase text-pkmn-gray mb-3">Recent orders</h3>
                    {detail.recent_orders.length === 0 ? (
                      <p className="text-sm text-pkmn-gray bg-pkmn-bg border border-pkmn-border p-3">No orders placed yet.</p>
                    ) : (
                      <div className="divide-y divide-pkmn-border border border-pkmn-border">
                        {detail.recent_orders.map(order => (
                          <div key={order.id} className="p-3">
                            <div className="flex items-center justify-between gap-3">
                              <p className="text-sm font-semibold text-pkmn-text truncate">{order.items_summary || `Order ${order.order_id.slice(0, 8)}`}</p>
                              <p className="text-sm font-black text-pkmn-text">{formatMoney(order.total)}</p>
                            </div>
                            <p className="text-xs text-pkmn-gray mt-1">{formatDate(order.created_at)} - {order.status_label}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>

                  <section>
                    <h3 className="text-xs font-black uppercase text-pkmn-gray mb-3">Strikes</h3>
                    {detail.strikes.length === 0 ? (
                      <p className="text-sm text-pkmn-gray bg-pkmn-bg border border-pkmn-border p-3">No strikes on this account.</p>
                    ) : (
                      <div className="space-y-2">
                        {detail.strikes.map(strike => (
                          <div key={strike.id} className="border border-pkmn-red/20 bg-pkmn-red/5 p-3">
                            <p className="text-sm text-pkmn-text">{strike.reason}</p>
                            <p className="text-xs text-pkmn-gray mt-1">{formatDateTime(strike.created_at)}{strike.given_by_email ? ` by ${strike.given_by_email}` : ''}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>

                  <section>
                    <h3 className="text-xs font-black uppercase text-pkmn-gray mb-3">Recent credit activity</h3>
                    {detail.recent_credit_ledger.length === 0 ? (
                      <p className="text-sm text-pkmn-gray bg-pkmn-bg border border-pkmn-border p-3">No wallet activity yet.</p>
                    ) : (
                      <div className="space-y-2">
                        {detail.recent_credit_ledger.map(entry => (
                          <div key={entry.id} className="flex items-start justify-between gap-3 border border-pkmn-border p-3">
                            <div className="min-w-0">
                              <p className="break-words text-sm font-semibold text-pkmn-text">{entry.note || entry.transaction_type.replace('_', ' ')}</p>
                              <p className="text-xs text-pkmn-gray">{formatDateTime(entry.created_at)}</p>
                            </div>
                            <p className={`text-sm font-black ${Number(entry.amount) >= 0 ? 'text-green-700' : 'text-pkmn-red'}`}>{formatMoney(entry.amount)}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                </div>
              </div>
            )}
          </aside>
        </div>
      </main>

      {strikeModalOpen && detail && (
        <ModalShell title="Issue Strike" onClose={() => setStrikeModalOpen(false)}>
          <div className="space-y-4">
            <p className="text-sm text-pkmn-gray">Issue a strike to <span className="font-semibold text-pkmn-text">{detail.user.email}</span>.</p>
            <textarea
              value={strikeReason}
              onChange={(event) => setStrikeReason(event.target.value)}
              rows={4}
              placeholder="Reason for the strike..."
              className="w-full border border-pkmn-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pkmn-blue/30 resize-none"
            />
            <button
              type="button"
              onClick={submitStrike}
              disabled={!strikeReason.trim() || submittingStrike}
              className="w-full inline-flex items-center justify-center gap-2 bg-pkmn-red text-white px-4 py-3 text-sm font-bold uppercase hover:bg-pkmn-red-dark disabled:opacity-50"
            >
              <ShieldAlert size={16} /> {submittingStrike ? 'Issuing...' : 'Issue strike'}
            </button>
          </div>
        </ModalShell>
      )}

      {creditModalOpen && detail && (
        <ModalShell title="Grant Store Credit" onClose={() => setCreditModalOpen(false)}>
          <div className="space-y-4">
            <div className="bg-pkmn-bg border border-pkmn-border p-3">
              <p className="text-xs uppercase font-bold text-pkmn-gray">Current balance</p>
              <p className="text-xl font-black text-green-700">{formatMoney(detail.user.trade_credit_balance)}</p>
            </div>
            <div>
              <label className="block text-xs font-bold uppercase text-pkmn-gray mb-1">Amount to add</label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={creditAmount}
                onChange={(event) => setCreditAmount(event.target.value)}
                placeholder="0.00"
                className="w-full border border-pkmn-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pkmn-blue/30"
              />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase text-pkmn-gray mb-1">Discord message</label>
              <textarea
                value={creditNote}
                onChange={(event) => setCreditNote(event.target.value)}
                rows={3}
                placeholder="Why this credit is being added..."
                className="w-full border border-pkmn-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pkmn-blue/30 resize-none"
              />
            </div>
            <button
              type="button"
              onClick={submitCreditGrant}
              disabled={submittingCredit || Number(creditAmount) <= 0}
              className="w-full inline-flex items-center justify-center gap-2 bg-pkmn-blue text-white px-4 py-3 text-sm font-bold uppercase hover:bg-pkmn-blue-dark disabled:opacity-50"
            >
              <DollarSign size={16} /> {submittingCredit ? 'Granting...' : 'Grant credit'}
            </button>
          </div>
        </ModalShell>
      )}
    </div>
  );
}