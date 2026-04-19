"use client";

import useSWR from 'swr';
import { authedFetcher } from '../lib/fetcher';
import Link from 'next/link';
import { Package, ShoppingCart, TrendingUp, AlertTriangle, Clock, Megaphone, Ticket, Plus, Star, Settings } from 'lucide-react';

interface DashboardData {
  kpis: {
    pending_dispatches: number;
    pending_dispatches_today: number;
    todays_orders: number;
    todays_revenue: number;
    low_stock: number;
    out_of_stock: number;
  };
  dispatch_queue: {
    id: number;
    order_id: string;
    status: string;
    created_at: string;
    items_summary: string;
    customer_email: string;
    qty: number;
  }[];
  promotions: {
    active_banners: number;
    active_coupons: number;
  };
}

export default function AdminDashboard() {
  const { data, error, mutate } = useSWR<DashboardData>(
    '/api/orders/admin-dashboard/',
    authedFetcher
  );

  if (!data && !error) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-12">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-pkmn-border rounded w-64" />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => <div key={i} className="h-24 bg-pkmn-border rounded-lg" />)}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-12 text-center">
        <p className="text-pkmn-red text-lg mb-3">Failed to load dashboard.</p>
        <button onClick={() => mutate()} className="text-pkmn-blue underline text-sm">Try Again</button>
      </div>
    );
  }

  if (!data) return null;

  const kpiCards = [
    { label: 'Pending Dispatches', value: data.kpis.pending_dispatches, icon: Package, color: 'text-amber-600', bg: 'bg-amber-50', link: '/admin/dispatch' },
    { label: 'Pending (Today)', value: data.kpis.pending_dispatches_today, icon: Package, color: 'text-amber-600', bg: 'bg-amber-50', link: '/admin/dispatch' },
    { label: "Today's Orders", value: data.kpis.todays_orders, icon: ShoppingCart, color: 'text-blue-600', bg: 'bg-blue-50', link: '/admin/orders' },
    { label: "Today's Revenue", value: `$${data.kpis.todays_revenue.toFixed(2)}`, icon: TrendingUp, color: 'text-green-600', bg: 'bg-green-50', link: '/admin/orders' },
    { label: 'Low Stock Items', value: data.kpis.low_stock, icon: AlertTriangle, color: 'text-orange-600', bg: 'bg-orange-50', link: '/admin/inventory' },
    { label: 'Out of Stock (Boxes)', value: data.kpis.out_of_stock, icon: AlertTriangle, color: 'text-red-600', bg: 'bg-red-50', link: '/admin/inventory' },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-black text-pkmn-text uppercase mb-6">Admin Dashboard</h1>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {kpiCards.map(kpi => (
          <Link key={kpi.label} href={kpi.link} className="no-underline">
            <div className={`${kpi.bg} border border-pkmn-border rounded-lg p-4 hover:shadow-md transition-shadow`}>
              <div className="flex items-center gap-3">
                <kpi.icon size={20} className={kpi.color} />
                <div>
                  <p className="text-xs text-pkmn-gray uppercase font-bold">{kpi.label}</p>
                  <p className={`text-2xl font-black ${kpi.color}`}>{kpi.value}</p>
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {/* Middle: Dispatch Queue */}
      <div className="mb-8">
        <div className="bg-white border border-pkmn-border rounded-lg">
          <div className="flex items-center justify-between p-4 border-b border-pkmn-border">
            <h2 className="font-bold text-pkmn-text flex items-center gap-2"><Clock size={16} /> Dispatch Queue</h2>
            <Link href="/admin/dispatch" className="text-xs text-pkmn-blue font-bold hover:underline">View All</Link>
          </div>
          {data.dispatch_queue.length === 0 ? (
            <p className="p-4 text-sm text-pkmn-gray text-center">No pending dispatches</p>
          ) : (
            <div className="divide-y divide-pkmn-border">
              {data.dispatch_queue.slice(0, 5).map(order => (
                <Link
                  key={order.order_id}
                  href={`/orders/${order.order_id}`}
                  className="block p-3 flex flex-row items-center justify-between text-sm hover:bg-pkmn-bg transition"
                  title={order.items_summary}
                  style={{ overflow: 'hidden' }}
                >
                  {/* Left: Order summary and email */}
                  <div className="flex flex-col items-start min-w-0 max-w-[60%]">
                    <p
                      className="font-bold text-pkmn-text truncate w-full"
                      style={{
                        maxWidth: '120px',
                        display: 'block',
                      }}
                    >
                      {/* Shorter truncation for mobile */}
                      <span className="block sm:hidden">
                        {order.items_summary.length > 22
                          ? order.items_summary.slice(0, 22) + '...'
                          : order.items_summary}
                      </span>
                      <span className="hidden sm:block">
                        {order.items_summary.length > 50
                          ? order.items_summary.slice(0, 50) + '...'
                          : order.items_summary}
                      </span>
                    </p>
                    <p className="text-xs text-pkmn-gray truncate w-full">{order.customer_email}</p>
                  </div>
                  {/* Right: Status and date */}
                  <div className="flex flex-col items-end min-w-[90px] ml-2">
                    <span className={`text-xs px-2 py-0.5 rounded font-bold ${
                      order.status === 'trade_review' ? 'bg-amber-100 text-amber-700' :
                      order.status === 'pending_counteroffer' ? 'bg-purple-100 text-purple-700' :
                      'bg-blue-100 text-blue-700'
                    }`}>
                      {order.status.replace(/_/g, ' ')}
                    </span>
                    <p className="text-xs text-pkmn-gray mt-1">{new Date(order.created_at).toLocaleDateString()}</p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Bottom: Promotions & Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Active Promotions */}
        <div className="bg-white border border-pkmn-border rounded-lg p-4">
          <h2 className="font-bold text-pkmn-text mb-3 flex items-center gap-2"><Megaphone size={16} /> Active Promotions</h2>
          <div className="grid grid-cols-2 gap-3">
            <Link href="/admin/promos" className="no-underline">
              <div className="bg-pkmn-bg rounded-lg p-3 text-center hover:shadow-sm transition-shadow">
                <p className="text-2xl font-black text-pkmn-blue">{data.promotions.active_banners}</p>
                <p className="text-xs text-pkmn-gray font-bold">Promo Banners</p>
              </div>
            </Link>
            <Link href="/admin/coupons" className="no-underline">
              <div className="bg-pkmn-bg rounded-lg p-3 text-center hover:shadow-sm transition-shadow">
                <p className="text-2xl font-black text-pkmn-blue">{data.promotions.active_coupons}</p>
                <p className="text-xs text-pkmn-gray font-bold">Active Coupons</p>
              </div>
            </Link>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="bg-white border border-pkmn-border rounded-lg p-4">
          <h2 className="font-bold text-pkmn-text mb-3 flex items-center gap-2"><Ticket size={16} /> Quick Actions</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { href: '/admin/inventory', icon: Plus, label: 'Inventory' },
              { href: '/admin/access-codes', icon: Plus, label: 'Access Codes' },
              { href: '/admin/promos', icon: Plus, label: 'Promo Banners' },
              { href: '/admin/wanted', icon: Star, label: 'Wanted Cards' },
              { href: '/admin/strikes', icon: AlertTriangle, label: 'Strikes' },
            ].map(({ href, icon: Icon, label }) => (
              <Link key={href} href={href} className="no-underline">
                <div className="flex items-center justify-center gap-2 bg-pkmn-blue text-white rounded-lg px-3 py-3 text-sm font-bold hover:bg-pkmn-blue-dark transition-colors text-center h-full">
                  <Icon size={14} className="flex-shrink-0" /> {label}
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* Settings at bottom */}
      <div className="flex justify-center">
        <Link href="/admin/settings" className="no-underline w-full max-w-xs">
          <div className="flex items-center justify-center gap-2 bg-white border border-pkmn-border rounded-lg px-6 py-3.5 text-sm font-bold text-pkmn-text hover:bg-pkmn-bg transition-colors cursor-pointer">
            <Settings size={18} /> Settings
          </div>
        </Link>
      </div>
    </div>
  );
}
