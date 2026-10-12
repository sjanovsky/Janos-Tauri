export const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

// Whole-dollar currency (no cents) for the chart's bar totals and the spending totals table.
export const wholeCurrencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

// Compact currency for the net-worth bar totals, so large totals stay short above each bar. Under
// $1,000 it shows the full whole-dollar amount; thousands round to a whole "K" ($26,700 → "$27K");
// millions and billions keep one decimal ($10,909,122 → "$10.9M"). Negatives are preserved (a
// negative net worth), and rounding never spills a unit — $999,900 reads "$1.0M", not "$1000K".
export function abbreviateCurrency(value: number): string {
  const abs = Math.abs(value);
  if (abs < 1000) {
    return wholeCurrencyFormatter.format(value);
  }
  const sign = value < 0 ? "-" : "";
  if (abs < 1_000_000) {
    const thousands = Math.round(abs / 1_000);
    if (thousands < 1000) {
      return `${sign}$${thousands}K`;
    }
    // Rounded up to a whole million — fall through so it reads "$1.0M" rather than "$1000K".
  }
  if (abs < 1_000_000_000) {
    return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  }
  return `${sign}$${(abs / 1_000_000_000).toFixed(1)}B`;
}
