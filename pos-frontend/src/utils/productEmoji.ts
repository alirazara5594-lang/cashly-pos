/**
 * Fallback artwork for products that have no uploaded image.
 *
 * Lived as a private copy inside PosTerminal until the waiter tablet needed the same
 * thumbnails; shared from here so the two screens cannot drift apart again.
 */
const productEmojis: Record<string, string> = {
  burger: '🍔',
  pizza: '🍕',
  salad: '🥗',
  fries: '🍟',
  drink: '🥤',
  cake: '🍰',
  chicken: '🍗',
  sandwich: '🥪',
  pasta: '🍝',
  ice: '🍦',
  coffee: '☕',
  juice: '🧃',
  default: '🍽️',
};

export function getEmoji(name: string, category?: string): string {
  const lower = (name + ' ' + (category || '')).toLowerCase();
  for (const [key, emoji] of Object.entries(productEmojis)) {
    if (lower.includes(key)) return emoji;
  }
  return productEmojis.default;
}
