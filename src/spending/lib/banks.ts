export type BankRecord = {
  id: string;
  name: string;
  logoDataUrl: string | null;
  // True when this bank's statements list money going out as a positive amount (credit cards);
  // false when deposits are the positive side (many checking exports).
  spendingPositive: boolean;
};

export function normalizeBankName(bankName: string): string {
  return bankName.trim().toLowerCase().replace(/\s+/g, " ");
}

export function buildBankLogoMap(banks: BankRecord[]): Record<string, string> {
  return banks.reduce<Record<string, string>>((lookup, bank) => {
    const normalized = normalizeBankName(bank.name);
    if (bank.logoDataUrl && normalized) {
      lookup[normalized] = bank.logoDataUrl;
    }
    return lookup;
  }, {});
}
