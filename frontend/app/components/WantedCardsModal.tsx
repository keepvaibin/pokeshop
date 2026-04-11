"use client";

import { useEffect, useState } from 'react';
import axios from 'axios';
import { X, Star, Search } from 'lucide-react';
import FallbackImage from './FallbackImage';

interface WantedCardImage {
  id: number;
  url: string;
  position: number;
}

interface WantedCard {
  id: number;
  name: string;
  slug: string;
  description: string;
  estimated_value: number;
  is_active: boolean;
  images: WantedCardImage[];
}

interface WantedCardsModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (card: { card_name: string; estimated_value: number; is_wanted_card: boolean }) => void;
}

export default function WantedCardsModal({ open, onClose, onSelect }: WantedCardsModalProps) {
  const [cards, setCards] = useState<WantedCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
    axios
      .get('http://localhost:8000/api/inventory/wanted/', token ? { headers: { Authorization: `Bearer ${token}` } } : {})
      .then((r) => setCards(r.data.results ?? r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open]);

  if (!open) return null;

  const filtered = cards.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="relative bg-white border border-pkmn-border rounded-2xl shadow-2xl max-w-2xl w-full max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-pkmn-border">
          <div>
            <h2 className="text-xl font-bold text-pkmn-text flex items-center gap-2">
              <Star size={20} className="text-pkmn-yellow" /> Wanted Cards
            </h2>
            <p className="text-sm text-pkmn-gray mt-0.5">Select a card to add to your trade offer</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-pkmn-bg rounded-full transition-colors">
            <X size={20} className="text-pkmn-gray" />
          </button>
        </div>

        {/* Search */}
        <div className="px-5 pt-4">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-pkmn-gray-dark" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search wanted cards..."
              className="w-full pl-9 pr-4 py-2.5 border border-pkmn-border rounded-xl text-sm text-pkmn-text focus:ring-2 focus:ring-pkmn-blue focus:border-transparent"
            />
          </div>
        </div>

        {/* Card List */}
        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-pkmn-blue"></div>
              <span className="ml-2 text-sm text-pkmn-gray">Loading...</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-8">
              <Search className="w-10 h-10 text-pkmn-gray-dark mx-auto mb-2" />
              <p className="text-pkmn-gray text-sm">No wanted cards found</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {filtered.map((card) => (
                <button
                  key={card.id}
                  onClick={() => {
                    onSelect({
                      card_name: card.name,
                      estimated_value: Number(card.estimated_value),
                      is_wanted_card: true,
                    });
                    onClose();
                  }}
                  className="flex items-center gap-3 p-3 border border-pkmn-border rounded-xl hover:border-pkmn-blue hover:bg-pkmn-blue/10 transition-all text-left group"
                >
                  {card.images?.[0]?.url ? (
                    <FallbackImage
                      src={card.images[0].url}
                      alt={card.name}
                      className="w-14 h-14 object-cover rounded-lg"
                      fallbackClassName="w-14 h-14 bg-pkmn-bg rounded-lg flex items-center justify-center text-pkmn-gray-dark"
                      fallbackSize={20}
                    />
                  ) : (
                    <div className="w-14 h-14 bg-pkmn-bg rounded-lg flex items-center justify-center text-pkmn-gray-dark">
                      <Star size={20} />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-pkmn-text truncate group-hover:text-pkmn-blue transition-colors">
                      {card.name}
                    </p>
                    <p className="text-sm text-pkmn-blue font-bold">
                      ~${Number(card.estimated_value).toFixed(2)}
                    </p>
                  </div>
                  <div className="bg-pkmn-yellow/15 text-pkmn-yellow-dark text-xs font-bold px-2 py-1 rounded-full shrink-0">
                    WANTED
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
