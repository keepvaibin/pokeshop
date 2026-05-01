"use client";

import useSWR from 'swr';
import { authedFetcher } from '../lib/fetcher';
import Link from 'next/link';
import { Package, ShoppingCart, TrendingUp, AlertTriangle, Clock, Megaphone, Ticket, Plus, Star, Settings, BarChart3 } from 'lucide-react';

interface DailyMetric {
  date: string;
  orders: number;
  revenue: number;
}

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
  metrics_preview?: {
    summary: {
      orders: number;
      revenue: number;
      average_order_value: number;
    };
    daily: DailyMetric[];
  };
}

function MiniMetricLine({ rows, valueKey, color }: { rows: DailyMetric[]; valueKey: 'orders' | 'revenue'; color: string }) {
  const maxValue = Math.max(...rows.map(row => Number(row[valueKey])), 1);
  const width = 360;
  const height = 110;
  const padding = 10;
  const chartWidth = width - padding * 2;
  const chartHeight = height - padding * 2;
  const points = rows.map((row, index) => {
    const x = padding + (rows.length === 1 ? chartWidth / 2 : (index / (rows.length - 1)) * chartWidth);
    const y = padding + chartHeight - (Number(row[valueKey]) / maxValue) * chartHeight;
    return `${x},${y}`;
  }).join(' ');

  return (
    <div className="h-28 overflow-hidden border border-pkmn-border bg-white">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-full w-full" role="img" aria-label={`${valueKey} trend`}>
        {[0.25, 0.5, 0.75].map(line => {
          const y = padding + chartHeight - line * chartHeight;
          return <line key={line} x1={padding} x2={width - padding} y1={y} y2={y} stroke="#e5e7eb" strokeWidth="1" />;
        })}
        <polyline points={points} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
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
            {[...Array(4)].map((_, i) => <div key={i} className="h-24 bg-pkmn-border rounded-md" />)}
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
    { label: "Today's Orders", value: data.kpis.todays_orders, icon: ShoppingCart, color: 'text-blue-600', bg: 'bg-blue-50', link: '/admin/metrics' },
    { label: "Today's Revenue", value: `$${data.kpis.todays_revenue.toFixed(2)}`, icon: TrendingUp, color: 'text-green-600', bg: 'bg-green-50', link: '/admin/metrics' },
    { label: 'Low Stock Boxes', value: data.kpis.low_stock, icon: AlertTriangle, color: 'text-orange-600', bg: 'bg-orange-50', link: '/admin/inventory' },
    { label: 'Out of Stock (Boxes)', value: data.kpis.out_of_stock, icon: AlertTriangle, color: 'text-red-600', bg: 'bg-red-50', link: '/admin/inventory' },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-black text-pkmn-text uppercase mb-6">Admin Dashboard</h1>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {kpiCards.map(kpi => (
          <Link key={kpi.label} href={kpi.link} className="no-underline">
            <div className={`${kpi.bg} border border-pkmn-border rounded-md p-4 hover:shadow-md transition-shadow`}>
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

      {data.metrics_preview && (
        <div className="bg-white border border-pkmn-border rounded-md p-4 mb-8">
          <div className="flex items-center justify-between gap-4 mb-4">
            <h2 className="font-bold text-pkmn-text flex items-center gap-2"><BarChart3 size={16} /> Performance Snapshot</h2>
            <Link href="/admin/metrics" className="text-xs text-pkmn-blue font-bold hover:underline">View Metrics</Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-pkmn-bg border border-pkmn-border p-3">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs text-pkmn-gray uppercase font-bold">7-Day Revenue</p>
                <p className="text-sm font-black text-green-600">${data.metrics_preview.summary.revenue.toFixed(2)}</p>
              </div>
              <MiniMetricLine rows={data.metrics_preview.daily} valueKey="revenue" color="#16a34a" />
            </div>
            <div className="bg-pkmn-bg border border-pkmn-border p-3">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs text-pkmn-gray uppercase font-bold">7-Day Orders</p>
                <p className="text-sm font-black text-blue-600">{data.metrics_preview.summary.orders}</p>
              </div>
              <MiniMetricLine rows={data.metrics_preview.daily} valueKey="orders" color="#2563eb" />
            </div>
          </div>
        </div>
      )}

      {/* Middle: Dispatch Queue */}
      <div className="mb-8">
        <div className="bg-white border border-pkmn-border rounded-md">
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
                  className="flex flex-col gap-2 p-3 text-sm transition hover:bg-pkmn-bg sm:flex-row sm:items-start sm:justify-between"
                  title={order.items_summary}
                >
                  {/* Left: Order summary and email */}
                  <div className="min-w-0 flex-1">
                    <p className="whitespace-normal break-words font-bold leading-snug text-pkmn-text">
                      {order.items_summary}
                    </p>
                    <p className="mt-1 break-all text-xs text-pkmn-gray">{order.customer_email}</p>
                  </div>
                  {/* Right: Status and date */}
                  <div className="flex shrink-0 flex-col items-start sm:items-end">
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
        <div className="bg-white border border-pkmn-border rounded-md p-4">
          <h2 className="font-bold text-pkmn-text mb-3 flex items-center gap-2"><Megaphone size={16} /> Active Promotions</h2>
          <div className="grid grid-cols-2 gap-3">
            <Link href="/admin/promos" className="no-underline">
              <div className="bg-pkmn-bg rounded-md p-3 text-center hover:shadow-sm transition-shadow">
                <p className="text-2xl font-black text-pkmn-blue">{data.promotions.active_banners}</p>
                <p className="text-xs text-pkmn-gray font-bold">Promo Banners</p>
              </div>
            </Link>
            <Link href="/admin/coupons" className="no-underline">
              <div className="bg-pkmn-bg rounded-md p-3 text-center hover:shadow-sm transition-shadow">
                <p className="text-2xl font-black text-pkmn-blue">{data.promotions.active_coupons}</p>
                <p className="text-xs text-pkmn-gray font-bold">Active Coupons</p>
              </div>
            </Link>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="bg-white border border-pkmn-border rounded-md p-4">
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
                <div className="flex items-center justify-center gap-2 bg-pkmn-blue text-white rounded-md px-3 py-3 text-sm font-bold hover:bg-pkmn-blue-dark transition-colors text-center h-full">
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
          <div className="flex items-center justify-center gap-2 bg-white border border-pkmn-border rounded-md px-6 py-3.5 text-sm font-bold text-pkmn-text hover:bg-pkmn-bg transition-colors cursor-pointer">
            <Settings size={18} /> Settings
          </div>
        </Link>
      </div>
    </div>
  );
}
