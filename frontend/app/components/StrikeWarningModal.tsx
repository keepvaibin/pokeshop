"use client";

import { useEffect, useState } from 'react';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import { API_BASE_URL as API } from '@/app/lib/api';
import { AlertTriangle, ShieldAlert } from 'lucide-react';

interface UnacknowledgedStrike {
  id: number;
  reason: string;
  created_at: string;
}

export default function StrikeWarningModal() {
  const { user } = useAuth();
  const [strikes, setStrikes] = useState<UnacknowledgedStrike[]>([]);
  const [visible, setVisible] = useState(false);
  const [acknowledging, setAcknowledging] = useState(false);

  useEffect(() => {
    if (!user || user.is_admin) return;
    const token = localStorage.getItem('access_token');
    if (!token) return;

    axios.get(`${API}/api/auth/my-strikes/`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(res => {
        const unacked = res.data.unacknowledged ?? [];
        if (unacked.length > 0) {
          setStrikes(unacked);
          setVisible(true);
        }
      })
      .catch(() => { /* silent */ });
  }, [user]);

  const handleAcknowledge = async () => {
    setAcknowledging(true);
    const token = localStorage.getItem('access_token');
    try {
      // Acknowledge all unacknowledged strikes
      await Promise.all(
        strikes.map(s =>
          axios.post(`${API}/api/auth/my-strikes/`, { strike_id: s.id }, {
            headers: { Authorization: `Bearer ${token}` },
          })
        )
      );
    } catch {
      // still dismiss the modal
    }
    setVisible(false);
    setAcknowledging(false);
  };

  if (!visible || strikes.length === 0) return null;

  const isRestricted = (user?.strike_count ?? 0) >= 3;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white border-2 border-pkmn-red/30 rounded-2xl shadow-2xl max-w-md w-full p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-full bg-pkmn-red/10 flex items-center justify-center flex-shrink-0">
            <ShieldAlert className="w-6 h-6 text-pkmn-red" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-pkmn-text">Strike Notice</h2>
            <p className="text-xs text-pkmn-gray">You have received {strikes.length} new strike{strikes.length !== 1 ? 's' : ''}</p>
          </div>
        </div>

        <div className="space-y-2 mb-4 max-h-48 overflow-y-auto">
          {strikes.map(s => (
            <div key={s.id} className="bg-pkmn-red/5 border border-pkmn-red/15 rounded-lg p-3">
              <div className="flex items-start gap-2">
                <AlertTriangle size={14} className="text-pkmn-red flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm text-pkmn-text">{s.reason}</p>
                  <p className="text-[10px] text-pkmn-gray mt-1">
                    {new Date(s.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="bg-pkmn-bg border border-pkmn-border rounded-lg p-3 mb-4">
          <p className="text-sm text-pkmn-text">
            You have been given a strike. This means you are being warned about misconduct on the website or server. Any additional strikes may result in your account being restricted from placing orders.
          </p>
        </div>

        {isRestricted && (
          <div className="bg-pkmn-red/10 border border-pkmn-red/20 rounded-lg p-3 mb-4">
            <p className="text-sm font-bold text-pkmn-red">Your account is now restricted.</p>
            <p className="text-xs text-pkmn-red/80">You have 3 or more strikes and cannot place new orders until strikes are resolved.</p>
          </div>
        )}

        <button
          onClick={handleAcknowledge}
          disabled={acknowledging}
          className="w-full bg-pkmn-red text-white font-bold py-3 px-4 rounded-lg hover:bg-pkmn-red-dark transition-all active:scale-95 disabled:opacity-50 text-sm"
        >
          {acknowledging ? 'Acknowledging...' : 'I Understand'}
        </button>
      </div>
    </div>
  );
}
