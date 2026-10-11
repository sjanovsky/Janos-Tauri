export type BankRecord = {
  id: string;
  name: string;
  logoDataUrl: string | null;
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
