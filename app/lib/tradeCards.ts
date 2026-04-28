export interface TradeCard {
  card_name: string;
  estimated_value: number;
  condition: string;
  rarity: string;
  is_wanted_card: boolean;
  quantity?: number;
  set_name?: string;
  card_number?: string;
  image_url?: string;
  tcgplayer_url?: string;
  tcg_product_id?: number | null;
  tcg_sub_type?: string;
  base_market_price?: number | null;
  custom_price?: number | null;
  photo?: File | null;
}

const CONDITION_TO_TRADE_IN: Record<string, string> = {
  near_mint: 'NM',
  lightly_played: 'LP',
  moderately_played: 'MP',
  heavily_played: 'HP',
  damaged: 'DMG',
};

export function roundTradeMoney(value: number) {
  return Math.round(value * 100) / 100;
}

export function getTradeCardQuantity(card: TradeCard) {
  return Math.max(1, Number(card.quantity) || 1);
}

export function serializeCheckoutTradeCards(cards: TradeCard[]) {
  return cards.map((card) => ({
    card_name: card.card_name,
    estimated_value: roundTradeMoney(Number(card.estimated_value) || 0),
    condition: card.condition,
    rarity: card.rarity,
    is_wanted_card: card.is_wanted_card,
    tcg_product_id: card.tcg_product_id || null,
    tcg_sub_type: card.tcg_sub_type || '',
    base_market_price: card.base_market_price != null ? roundTradeMoney(card.base_market_price) : null,
    image_url: card.image_url || '',
    tcgplayer_url: card.tcgplayer_url || '',
    custom_price: card.custom_price != null ? roundTradeMoney(card.custom_price) : null,
  }));
}

export function serializeTradeInRequestItems(cards: TradeCard[]) {
  return cards.map((card) => ({
    card_name: card.card_name.trim(),
    set_name: (card.set_name || '').trim(),
    card_number: (card.card_number || '').trim(),
    condition: CONDITION_TO_TRADE_IN[card.condition] || 'LP',
    quantity: getTradeCardQuantity(card),
    estimated_value: roundTradeMoney(Number(card.estimated_value) || 0).toFixed(2),
    image_url: card.image_url || '',
    tcgplayer_url: card.tcgplayer_url || '',
    tcg_product_id: card.tcg_product_id || null,
    tcg_sub_type: card.tcg_sub_type || '',
    base_market_price: card.base_market_price != null ? roundTradeMoney(card.base_market_price).toFixed(2) : null,
  }));
}