"use client";

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { BarChart3, CircleDollarSign, ClipboardList, TrendingUp, Users } from 'lucide-react';
import Navbar from '../../components/Navbar';
import { useRequireAuth } from '../../hooks/useRequireAuth';
import { authedFetcher } from '../../lib/fetcher';

interface DailyMetric {
  date: string;
  orders: number;
  revenue: number;
  cancelled: number;
}

interface RankedProduct {
  item_title: string;
  quantity: number;
  revenue: number;
}

interface CategoryRevenue {
  category: string;
  revenue: number;
}

interface PaymentMethodMetric {
  payment_method: string;
  orders: number;
  revenue: number;
}

interface StatusCount {
  status: string;
  orders: number;
}

interface MetricsResponse {
  range: {
    days: number;
    all_time?: boolean;
    start_date: string;
    end_date: string;
    timezone: string;
  };
  summary: {
    orders: number;
    revenue: number;
    average_order_value: number;
    active_customers: number;
    cancelled_orders: number;
    fulfilled_orders: number;
    fulfillment_rate: number;
    pending_dispatches: number;
  };
  daily: DailyMetric[];
  top_products: RankedProduct[];
  category_revenue: CategoryRevenue[];
  payment_methods: PaymentMethodMetric[];
  status_counts: StatusCount[];
}

const RANGE_OPTIONS = [
  { value: '7', label: '7D' },
  { value: '30', label: '30D' },
  { value: '90', label: '90D' },
  { value: 'all', label: 'All Time' },
] as const;

type MetricsRange = typeof RANGE_OPTIONS[number]['value'];

function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

function shortDate(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function statusLabel(status: string): string {
  return status.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
}

function paymentLabel(method: string): string {
  return method.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
}

function StatPanel({ icon: Icon, label, value, tone }: { icon: typeof CircleDollarSign; label: string; value: string; tone: string }) {
  return (
    <div className="bg-white border border-pkmn-border p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <div className={`h-10 w-10 flex items-center justify-center ${tone}`}>
          <Icon size={20} />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase text-pkmn-gray">{label}</p>
          <p className="text-2xl font-black text-pkmn-text">{value}</p>
        </div>
      </div>
    </div>
  );
}

function sampleIndexes(total: number, targetCount = 6) {
  if (total <= 0) return [];
  if (total <= targetCount) return Array.from({ length: total }, (_, index) => index);
  const lastIndex = total - 1;
  const indexes = new Set<number>([0, lastIndex]);
  for (let tickIndex = 1; tickIndex < targetCount - 1; tickIndex += 1) {
    indexes.add(Math.round((tickIndex / (targetCount - 1)) * lastIndex));
  }
  return Array.from(indexes).sort((first, second) => first - second);
}

function MetricLineChart({ rows, metric, ariaLabel, color, valueLabel }: {
  rows: DailyMetric[];
  metric: 'revenue' | 'orders';
  ariaLabel: string;
  color: string;
  valueLabel: (row: DailyMetric) => string;
}) {
  if (rows.length === 0) {
    return <p className="py-12 text-center text-sm text-pkmn-gray">No data for this range.</p>;
  }

  const maxValue = Math.max(...rows.map(row => row[metric]), 1);
  const width = 720;
  const height = 240;
  const padding = { top: 18, right: 18, bottom: 34, left: 42 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const coordinateFor = (row: DailyMetric, index: number) => {
    const x = padding.left + (rows.length === 1 ? chartWidth / 2 : (index / (rows.length - 1)) * chartWidth);
    const y = padding.top + chartHeight - (row[metric] / maxValue) * chartHeight;
    return { x, y };
  };
  const points = rows.map((row, index) => {
    const { x, y } = coordinateFor(row, index);
    return `${x},${y}`;
  }).join(' ');
  const firstPoint = coordinateFor(rows[0], 0);
  const lastPoint = coordinateFor(rows[rows.length - 1], rows.length - 1);
  const areaPoints = `${padding.left},${padding.top + chartHeight} ${points} ${lastPoint.x},${padding.top + chartHeight}`;
  const tickIndexes = sampleIndexes(rows.length);
  const gridLines = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div className="h-72 overflow-hidden border border-pkmn-border bg-white px-1 pt-2">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-full w-full" role="img" aria-label={ariaLabel}>
        {gridLines.map((line) => {
          const y = padding.top + chartHeight - (line * chartHeight);
          return <line key={line} x1={padding.left} x2={width - padding.right} y1={y} y2={y} stroke="#e5e7eb" strokeWidth="1" />;
        })}
        <polyline points={areaPoints} fill={color} fillOpacity="0.09" stroke="none" />
        <polyline points={points} fill="none" stroke={color} strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={firstPoint.x} cy={firstPoint.y} r="4" fill={color} />
        <circle cx={lastPoint.x} cy={lastPoint.y} r="4" fill={color} />
        {rows.length <= 45 && rows.map((row, index) => {
          const { x, y } = coordinateFor(row, index);
          return <circle key={row.date} cx={x} cy={y} r="3.5" fill="#ffffff" stroke={color} strokeWidth="2"><title>{`${shortDate(row.date)}: ${valueLabel(row)}`}</title></circle>;
        })}
        {tickIndexes.map((index) => {
          const row = rows[index];
          const { x } = coordinateFor(row, index);
          const anchor = index === 0 ? 'start' : index === rows.length - 1 ? 'end' : 'middle';
          return (
            <text key={row.date} x={x} y={height - 10} textAnchor={anchor} className="fill-pkmn-gray text-[11px] font-semibold">
              {shortDate(row.date)}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

function RankedBars({ rows, getLabel, getValue, valueLabel }: { rows: unknown[]; getLabel: (row: unknown) => string; getValue: (row: unknown) => number; valueLabel: (row: unknown) => string }) {
  const maxValue = Math.max(...rows.map(getValue), 1);
  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-pkmn-gray">No data for this range.</p>;
  }

  return (
    <div className="space-y-3">
      {rows.map((row) => {
        const label = getLabel(row);
        const width = Math.max(6, (getValue(row) / maxValue) * 100);
        return (
          <div key={label}>
            <div className="mb-1 flex items-center justify-between gap-3 text-sm">
              <span className="truncate font-semibold text-pkmn-text">{label}</span>
              <span className="shrink-0 font-bold text-pkmn-blue">{valueLabel(row)}</span>
            </div>
            <div className="h-2 bg-pkmn-bg">
              <div className="h-full bg-pkmn-yellow" style={{ width: `${width}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function AdminMetricsPage() {
  const { user } = useRequireAuth({ adminOnly: true });
  const [range, setRange] = useState<MetricsRange>('30');
  const metricsKey = range === 'all' ? '/api/orders/admin-metrics/?days=all' : `/api/orders/admin-metrics/?days=${range}`;
  const { data, error, isLoading, mutate } = useSWR<MetricsResponse>(metricsKey, authedFetcher);
  const dateRange = useMemo(() => {
    if (!data) return '';
    return `${shortDate(data.range.start_date)} - ${shortDate(data.range.end_date)} (${data.range.timezone})`;
  }, [data]);

  if (!user?.is_admin) {
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
    <div className="min-h-screen bg-pkmn-bg">
      <Navbar adminMode />
      <main className="mx-auto max-w-7xl px-4 py-8">
        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 bg-pkmn-blue text-white flex items-center justify-center">
              <BarChart3 size={24} />
            </div>
            <div>
              <h1 className="text-3xl font-heading font-black uppercase text-pkmn-text">Metrics</h1>
              <p className="text-sm text-pkmn-gray">{data ? dateRange : 'Loading performance data...'}</p>
            </div>
          </div>
          <div className="inline-flex self-start border border-pkmn-border bg-white md:self-auto">
            {RANGE_OPTIONS.map(option => (
              <button
                key={option.value}
                onClick={() => setRange(option.value)}
                className={`px-4 py-2 text-sm font-bold transition-colors ${range === option.value ? 'bg-pkmn-blue text-white' : 'text-pkmn-text hover:bg-pkmn-bg'}`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="bg-white border border-pkmn-border p-6 text-center shadow-sm">
            <p className="mb-3 text-pkmn-red font-semibold">Failed to load metrics.</p>
            <button onClick={() => mutate()} className="text-sm font-bold text-pkmn-blue underline">Try Again</button>
          </div>
        )}

        {isLoading && !data && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            {[...Array(4)].map((_, index) => <div key={index} className="h-24 animate-pulse bg-white border border-pkmn-border" />)}
          </div>
        )}

        {data && (
          <>
            <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatPanel icon={CircleDollarSign} label="Revenue" value={money(data.summary.revenue)} tone="bg-green-50 text-green-700" />
              <StatPanel icon={ClipboardList} label="Orders" value={String(data.summary.orders)} tone="bg-blue-50 text-blue-700" />
              <StatPanel icon={TrendingUp} label="Average Order" value={money(data.summary.average_order_value)} tone="bg-amber-50 text-amber-700" />
              <StatPanel icon={Users} label="Active Customers" value={String(data.summary.active_customers)} tone="bg-purple-50 text-purple-700" />
            </div>

            <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
              <section className="bg-white border border-pkmn-border p-4 shadow-sm">
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="font-heading text-lg font-black uppercase text-pkmn-text">Revenue Over Time</h2>
                  <span className="text-sm font-bold text-pkmn-blue">{money(data.summary.revenue)}</span>
                </div>
                <MetricLineChart rows={data.daily} metric="revenue" ariaLabel="Revenue over time" color="#2563eb" valueLabel={(row) => money(row.revenue)} />
              </section>
              <section className="bg-white border border-pkmn-border p-4 shadow-sm">
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="font-heading text-lg font-black uppercase text-pkmn-text">Orders Over Time</h2>
                  <span className="text-sm font-bold text-pkmn-blue">{data.summary.orders} orders</span>
                </div>
                <MetricLineChart rows={data.daily} metric="orders" ariaLabel="Orders over time" color="#16a34a" valueLabel={(row) => `${row.orders} orders`} />
              </section>
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <section className="bg-white border border-pkmn-border p-4 shadow-sm">
                <h2 className="mb-4 font-heading text-base font-black uppercase text-pkmn-text">Top Products</h2>
                <RankedBars
                  rows={data.top_products}
                  getLabel={(row) => (row as RankedProduct).item_title}
                  getValue={(row) => (row as RankedProduct).revenue}
                  valueLabel={(row) => `${(row as RankedProduct).quantity} sold • ${money((row as RankedProduct).revenue)}`}
                />
              </section>
              <section className="bg-white border border-pkmn-border p-4 shadow-sm">
                <h2 className="mb-4 font-heading text-base font-black uppercase text-pkmn-text">Category Revenue</h2>
                <RankedBars
                  rows={data.category_revenue}
                  getLabel={(row) => (row as CategoryRevenue).category}
                  getValue={(row) => (row as CategoryRevenue).revenue}
                  valueLabel={(row) => money((row as CategoryRevenue).revenue)}
                />
              </section>
              <section className="bg-white border border-pkmn-border p-4 shadow-sm">
                <h2 className="mb-4 font-heading text-base font-black uppercase text-pkmn-text">Operations</h2>
                <div className="space-y-3 text-sm">
                  <div className="flex items-center justify-between border-b border-pkmn-border pb-2"><span className="text-pkmn-gray">Pending Dispatches</span><span className="font-black text-pkmn-text">{data.summary.pending_dispatches}</span></div>
                  <div className="flex items-center justify-between border-b border-pkmn-border pb-2"><span className="text-pkmn-gray">Fulfillment Rate</span><span className="font-black text-pkmn-text">{data.summary.fulfillment_rate}%</span></div>
                  <div className="flex items-center justify-between border-b border-pkmn-border pb-2"><span className="text-pkmn-gray">Cancelled Orders</span><span className="font-black text-pkmn-text">{data.summary.cancelled_orders}</span></div>
                </div>
                <div className="mt-5 space-y-2">
                  {data.payment_methods.map(method => (
                    <div key={method.payment_method} className="flex items-center justify-between bg-pkmn-bg px-3 py-2 text-sm">
                      <span className="font-semibold text-pkmn-text">{paymentLabel(method.payment_method)}</span>
                      <span className="font-bold text-pkmn-blue">{method.orders} • {money(method.revenue)}</span>
                    </div>
                  ))}
                  {data.status_counts.map(row => (
                    <div key={row.status} className="flex items-center justify-between px-3 py-1 text-xs text-pkmn-gray">
                      <span>{statusLabel(row.status)}</span>
                      <span>{row.orders}</span>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </>
        )}
      </main>
    </div>
  );
}