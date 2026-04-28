"use client";

import { Package } from 'lucide-react';
import Navbar from '../../components/Navbar';
import { useRequireAuth } from '../../hooks/useRequireAuth';
import AdminTradeInQueue from '../../components/AdminTradeInQueue';

export default function AdminTradeInsPage() {
  const { user } = useRequireAuth({ adminOnly: true });

  if (!user?.is_admin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-pkmn-bg">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-pkmn-blue" />
      </div>
    );
  }

  return (
    <div className="bg-pkmn-bg min-h-screen">
      <Navbar adminMode />
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex items-center gap-3 mb-6">
          <Package className="w-8 h-8 text-pkmn-blue" />
          <div>
            <h1 className="text-3xl font-bold text-pkmn-text">Trade-In Queue</h1>
            <p className="text-pkmn-gray text-sm">Review standalone trade-ins with the same guarded workflow used in dispatch.</p>
          </div>
        </div>

        <AdminTradeInQueue />
      </div>
    </div>
  );
}