export interface CurrencyConfig {
  code: string;
  symbol: string;
  decimals: number;
}

export const DEFAULT_CURRENCY: CurrencyConfig = {
  code: 'PKR',
  symbol: '₨',
  decimals: 0,
};

export function formatCurrency(amount: number, symbol: string = DEFAULT_CURRENCY.symbol, decimals: number = DEFAULT_CURRENCY.decimals): string {
  const formatted = amount.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${symbol}${formatted}`;
}

export function formatCurrencyShort(amount: number, symbol: string = DEFAULT_CURRENCY.symbol): string {
  if (amount >= 1000000) return `${symbol}${(amount / 1000000).toFixed(1)}M`;
  if (amount >= 1000) return `${symbol}${(amount / 1000).toFixed(1)}K`;
  return `${symbol}${amount.toLocaleString()}`;
}
