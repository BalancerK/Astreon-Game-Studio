// Playing cards as numbers 0 to 51.
// suit = card / 13 (0 spades, 1 hearts, 2 diamonds, 3 clubs); rank = card % 13 (0 ace, 1 two ... 7 eight ... 10 jack, 11 queen, 12 king).

export const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'];
export const SUIT_SYMBOLS = ['♠', '♥', '♦', '♣'];
export const RANK_LABELS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export const EIGHT = 7, TWO = 1, JACK = 10, QUEEN = 11;

export const suitOf = (card) => Math.floor(card / 13);
export const rankOf = (card) => card % 13;
/** "8♥" */
export const cardName = (card) => `${RANK_LABELS[rankOf(card)]}${SUIT_SYMBOLS[suitOf(card)]}`;
export const isRed = (card) => suitOf(card) === 1 || suitOf(card) === 2;

/** What a card in your hand costs you when someone else goes out: an eight is 50, a picture card 10, any other its number (an ace is 1). */
export function points(card) {
  const r = rankOf(card);
  return r === EIGHT ? 50 : r >= JACK ? 10 : r + 1;
}

/** A fresh 52-card deck in order. */
export const newDeck = () => Array.from({ length: 52 }, (_, i) => i);
