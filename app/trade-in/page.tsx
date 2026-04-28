"use client";

import { useState, useEffect } from 'react';
import axios from 'axios';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRequireAuth } from '../hooks/useRequireAuth';
import Navbar from '../components/Navbar';
import TradeCardForm from '../components/TradeCardForm';
import PickupTimeslotSelector, { type TimeslotSelection } from '../components/PickupTimeslotSelector';
import { Package, ArrowLeft, MapPin, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { API_BASE_URL as API } from '@/app/lib/api';
import { getTradeCardQuantity, serializeTradeInRequestItems, type TradeCard } from '@/app/lib/tradeCards';

interface TradeInSettings {
  trade_credit_percentage: number;
  trade_cash_percentage: number;
  max_trade_cards_per_order: number;
  trade_ins_enabled: boolean;
  pay_venmo_enabled: boolean;
  pay_zelle_enabled: boolean;
  pay_paypal_enabled: boolean;
}

export default function TradeInSubmitPage() {
  const { user } = useRequireAuth();
  const router = useRouter();
  const [customerNotes, setCustomerNotes] = useState('');
  const [cards, setCards] = useState<TradeCard[]>([]);
  const [selectedTimeslot, setSelectedTimeslot] = useState<TimeslotSelection | null>(null);
  const [payoutType, setPayoutType] = useState<'store_credit' | 'cash'>('store_credit');
  const [cashPaymentMethod, setCashPaymentMethod] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [settings, setSettings] = useState<TradeInSettings>({
    trade_credit_percentage: 85,
    trade_cash_percentage: 65,
    max_trade_cards_per_order: 5,
    trade_ins_enabled: true,
    pay_venmo_enabled: true,
    pay_zelle_enabled: true,
    pay_paypal_enabled: true,
  });

  useEffect(() => {
    axios
      .get(`${API}/api/inventory/settings/`)
      .then((r) => setSettings({
        trade_credit_percentage: Number(r.data?.trade_credit_percentage ?? 85),
        trade_cash_percentage: Number(r.data?.trade_cash_percentage ?? 65),
        max_trade_cards_per_order: Number(r.data?.max_trade_cards_per_order ?? 5),
        trade_ins_enabled: r.data?.trade_ins_enabled !== false,
        pay_venmo_enabled: r.data?.pay_venmo_enabled !== false,
        pay_zelle_enabled: r.data?.pay_zelle_enabled !== false,
        pay_paypal_enabled: r.data?.pay_paypal_enabled !== false,
      }))
      .catch(() => {});
  }, []);

  const payoutPercentage = payoutType === 'cash'
    ? settings.trade_cash_percentage
    : settings.trade_credit_percentage;
  const enabledCashMethods = [
    settings.pay_venmo_enabled ? { value: 'venmo', label: 'Venmo' } : null,
    settings.pay_zelle_enabled ? { value: 'zelle', label: 'Zelle' } : null,
    settings.pay_paypal_enabled ? { value: 'paypal', label: 'PayPal' } : null,
  ].filter(Boolean) as Array<{ value: string; label: string }>;

  const totalCardValue = cards.reduce(
    (sum, card) => sum + (Number(card.estimated_value) || 0) * getTradeCardQuantity(card),
    0,
  );
  const estimatedCredit = totalCardValue * (payoutPercentage / 100);
  const totalQuantity = cards.reduce((sum, card) => sum + getTradeCardQuantity(card), 0);

  async function submit() {
    const validCards = cards.filter((card) => card.card_name.trim().length > 0);
    if (validCards.length === 0) {
      toast.error('Add at least one card.');
      return;
    }
    const invalidValue = validCards.find((card) => !card.estimated_value || card.estimated_value <= 0);
    if (invalidValue) {
      toast.error('Every card needs a value before submitting.');
      return;
    }
    if (!selectedTimeslot) {
      toast.error('Choose a drop-off timeslot.');
      return;
    }
    if (payoutType === 'cash' && !cashPaymentMethod) {
      toast.error('Choose how you want your cash payout sent.');
      return;
    }

    setSubmitting(true);
    try {
      const token = localStorage.getItem('access_token');
      const payload = {
        submission_method: 'in_store_dropoff',
        payout_type: payoutType,
        cash_payment_method: payoutType === 'cash' ? cashPaymentMethod : '',
        recurring_timeslot: selectedTimeslot.recurring_timeslot_id,
        pickup_date: selectedTimeslot.pickup_date,
        customer_notes: customerNotes,
        items: serializeTradeInRequestItems(validCards),
      };
      await axios.post(`${API}/api/trade-ins/`, payload, {
        headers: { Authorization: `Bearer ${token}` },
      });
      toast.success('Trade-in submitted. We will DM you on Discord once reviewed.');
      router.push('/trade-in/history');
    } catch (err) {
      const e = err as { response?: { data?: { detail?: string; error?: string; items?: string[] } } };
      const msg = e.response?.data?.detail || e.response?.data?.error || (Array.isArray(e.response?.data?.items) ? e.response?.data?.items?.[0] : null) || 'Failed to submit trade-in.';
      toast.error(typeof msg === 'string' ? msg : 'Failed to submit trade-in.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-pkmn-bg">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-pkmn-blue" />
      </div>
    );
  }

  return (
    <div className="bg-pkmn-bg min-h-screen">
      <Navbar />
      <div className="max-w-5xl mx-auto px-4 py-8">
        <Link
          href="/orders"
          className="flex items-center gap-2 text-sm text-pkmn-gray hover:text-pkmn-text mb-4"
        >
          <ArrowLeft size={16} /> Back to Orders
        </Link>

        {!settings.trade_ins_enabled && (
          <div className="bg-pkmn-yellow/10 border border-pkmn-yellow/40 rounded-md p-4 mb-6 text-pkmn-text">
            <p className="font-semibold text-sm">Trade-ins are currently closed.</p>
            <p className="text-xs text-pkmn-gray mt-1">New trade-in submissions are paused for now.</p>
          </div>
        )}

        <div className={!settings.trade_ins_enabled ? 'opacity-50 pointer-events-none' : ''}>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-6">
            <div className="flex items-start gap-3">
              <Package className="w-8 h-8 text-pkmn-blue mt-1" />
              <div>
                <h1 className="text-3xl font-heading font-black text-pkmn-text uppercase">Trade-In Cards</h1>
                <p className="text-pkmn-gray text-sm max-w-2xl">
                  Submit cards for store credit or cash. Store credit currently pays {settings.trade_credit_percentage}% and cash currently pays {settings.trade_cash_percentage}%.
                </p>
              </div>
            </div>
            <div className="rounded-md border border-pkmn-blue/20 bg-pkmn-blue/10 px-4 py-3 text-sm text-pkmn-blue-dark">
              <MapPin size={15} className="inline mr-1" /> Drop Off Timeslot
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_18rem] gap-6">
            <div className="space-y-6">
              <div className="bg-white border border-pkmn-border rounded-md p-5 shadow-sm">
                <h2 className="font-bold text-pkmn-text mb-3">Payout Type</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setPayoutType('store_credit');
                      setCashPaymentMethod('');
                    }}
                    className={`p-4 border-2 text-left transition-all ${payoutType === 'store_credit' ? 'bg-pkmn-blue/10 border-pkmn-blue text-pkmn-blue-dark' : 'bg-white border-pkmn-border text-pkmn-gray-dark hover:border-pkmn-blue'}`}
                  >
                    <p className="font-semibold text-sm">Store Credit</p>
                    <p className="text-xs opacity-75 mt-1">Pays {settings.trade_credit_percentage}% and is added to your checkout wallet after verification.</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPayoutType('cash')}
                    className={`p-4 border-2 text-left transition-all ${payoutType === 'cash' ? 'bg-pkmn-blue/10 border-pkmn-blue text-pkmn-blue-dark' : 'bg-white border-pkmn-border text-pkmn-gray-dark hover:border-pkmn-blue'}`}
                  >
                    <p className="font-semibold text-sm">Cash</p>
                    <p className="text-xs opacity-75 mt-1">Pays {settings.trade_cash_percentage}% and is sent manually after your cards are verified.</p>
                  </button>
                </div>
                {payoutType === 'cash' && (
                  <div className="mt-4 space-y-2">
                    <p className="text-sm font-semibold text-pkmn-text">Cash Payout Method</p>
                    {enabledCashMethods.length === 0 ? (
                      <p className="text-sm text-pkmn-red">Cash payouts are currently unavailable because Venmo, Zelle, and PayPal are all disabled.</p>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        {enabledCashMethods.map((method) => (
                          <button
                            key={method.value}
                            type="button"
                            onClick={() => setCashPaymentMethod(method.value)}
                            className={`p-3 border-2 text-center text-sm font-semibold transition-all ${cashPaymentMethod === method.value ? 'bg-pkmn-blue/10 border-pkmn-blue text-pkmn-blue-dark' : 'bg-white border-pkmn-border text-pkmn-gray-dark hover:border-pkmn-blue'}`}
                          >
                            {method.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="bg-white border border-pkmn-border rounded-md p-5 shadow-sm">
                <PickupTimeslotSelector
                  value={selectedTimeslot}
                  onChange={setSelectedTimeslot}
                  label="Drop-Off Timeslot"
                  emptyMessage="No drop-off timeslots are currently available. Check back later."
                />
              </div>

              <div className="bg-white border border-pkmn-border rounded-md p-5 shadow-sm">
                <TradeCardForm
                  cards={cards}
                  onChange={setCards}
                  creditPercentage={payoutPercentage}
                  maxCards={Math.max(1, settings.max_trade_cards_per_order)}
                  enableQuantity
                  allowPhotos={false}
                  title="Cards"
                />
              </div>

              <div className="bg-white border border-pkmn-border rounded-md p-5 shadow-sm">
                <h2 className="font-bold text-pkmn-text mb-2">Notes</h2>
                <textarea
                  value={customerNotes}
                  onChange={e => setCustomerNotes(e.target.value)}
                  rows={3}
                  maxLength={2000}
                  placeholder="Condition notes, variants, or anything we should verify"
                  className="w-full px-3 py-2 border border-pkmn-border rounded-md text-sm text-pkmn-text focus:ring-2 focus:ring-pkmn-blue focus:border-transparent"
                />
              </div>
            </div>

            <aside className="bg-white border border-pkmn-border rounded-md p-5 shadow-sm h-fit lg:sticky lg:top-8">
              <h2 className="font-heading font-black text-pkmn-text uppercase mb-4">Offer Summary</h2>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between text-pkmn-gray-dark">
                  <span>Cards</span>
                  <span>{totalQuantity}</span>
                </div>
                <div className="flex justify-between text-pkmn-gray-dark">
                  <span>Card Value</span>
                  <span>${totalCardValue.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-pkmn-gray-dark">
                  <span>{payoutType === 'cash' ? 'Cash Rate' : 'Credit Rate'}</span>
                  <span>{payoutPercentage}%</span>
                </div>
                <div className="flex justify-between border-t border-pkmn-border pt-3 text-base font-bold text-pkmn-blue">
                  <span>{payoutType === 'cash' ? 'Estimated Cash' : 'Estimated Credit'}</span>
                  <span>${estimatedCredit.toFixed(2)}</span>
                </div>
              </div>
              <div className="mt-4 rounded-md border border-pkmn-yellow/30 bg-pkmn-yellow/10 p-3 text-xs text-pkmn-yellow-dark">
                <AlertCircle size={14} className="inline mr-1" /> Final {payoutType === 'cash' ? 'cash payout' : 'credit payout'} is confirmed after review.
              </div>
              <button
                type="button"
                onClick={submit}
                disabled={submitting || cards.length === 0 || !selectedTimeslot || (payoutType === 'cash' && !cashPaymentMethod)}
                className="pkc-button-accent mt-5 w-full disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? 'Submitting...' : 'Submit Trade-In'}
              </button>
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
}