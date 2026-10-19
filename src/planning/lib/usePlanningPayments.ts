import { useMemo } from "react";
import type { AccountRecord } from "../../networth/lib/networth";
import { paymentMapping, paymentSources, paymentsByAccount } from "./planning";
import { usePlanning } from "./usePlanning";

// The yearly payment Planning maps into each Net Worth account, for the forecast to add.
export function usePlanningPayments(accounts: AccountRecord[]): Record<string, number> {
  const { plans, sections, totals, settings } = usePlanning();
  return useMemo(() => {
    const sources = paymentSources(plans, sections, totals);
    const mapping = paymentMapping(sources, settings, new Set(accounts.map((account) => account.id)));
    return paymentsByAccount(sources, mapping);
  }, [plans, sections, totals, settings, accounts]);
}
