import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { NetWorthBucketRecord } from "./networth";

// An older version kept one amount for every month under this key; it's still the fallback for
// months before the first one that has its own amount.
const LEGACY_AMOUNT_KEY = "networth_reset_amount";
const MONTH_AMOUNT_PREFIX = "networth_reset_amount:";
const BUCKET_KEY = "networth_reset_bucket";
const DEFAULT_BUCKET_NAME = "cash";

type SettingRecord = { key: string; value: string };

const parseAmount = (text: string | undefined): number | null => {
  const cleaned = (text ?? "").replace(/[$,\s]/g, "");
  const parsed = cleaned === "" ? Number.NaN : Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
};

// The month-end reset check: a bucket (Cash by default) that's topped back up to an amount each
// month, with the money moved to do so compared against Net income. The amount is set per month
// and a month with none of its own uses the closest earlier month's. Everything is kept in the
// shared settings table (the one the Planning page uses), under its own keys.
export function useNetWorthReset(buckets: NetWorthBucketRecord[]) {
  // Amounts the user typed, by "YYYY-MM" (the text as entered, so a half-typed value survives).
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [legacyText, setLegacyText] = useState("");
  const [savedBucketId, setSavedBucketId] = useState<string | null>(null);

  useEffect(() => {
    invoke<SettingRecord[]>("get_planning_settings")
      .then((records) => {
        const loaded: Record<string, string> = {};
        records.forEach((record) => {
          if (record.key.startsWith(MONTH_AMOUNT_PREFIX)) {
            loaded[record.key.slice(MONTH_AMOUNT_PREFIX.length)] = record.value;
          }
        });
        setTexts(loaded);
        setLegacyText(records.find((record) => record.key === LEGACY_AMOUNT_KEY)?.value ?? "");
        setSavedBucketId(records.find((record) => record.key === BUCKET_KEY)?.value ?? null);
      })
      .catch((error) => console.error("Failed to load the reset settings", error));
  }, []);

  const save = useCallback((key: string, value: string) => {
    const write =
      value === "" ? invoke("delete_planning_setting", { key }) : invoke("set_planning_setting", { key, value });
    write.catch((error) => console.error(`Failed to save (${key})`, error));
  }, []);

  // The saved bucket, else the one named "Cash", else none.
  const bucketId = useMemo(() => {
    if (savedBucketId && buckets.some((bucket) => bucket.id === savedBucketId)) {
      return savedBucketId;
    }
    return buckets.find((bucket) => bucket.name.trim().toLowerCase() === DEFAULT_BUCKET_NAME)?.id ?? null;
  }, [savedBucketId, buckets]);

  // The amount in force for a month: its own, else the closest earlier month's, else the old
  // single amount. null when none is set.
  const amountFor = useCallback(
    (month: string): number | null => {
      let bestMonth = "";
      let best: number | null = null;
      Object.entries(texts).forEach(([key, text]) => {
        const parsed = parseAmount(text);
        if (parsed !== null && key <= month && key > bestMonth) {
          bestMonth = key;
          best = parsed;
        }
      });
      return best ?? parseAmount(legacyText);
    },
    [texts, legacyText],
  );

  return {
    bucketId,
    setBucketId: (id: string) => {
      setSavedBucketId(id);
      save(BUCKET_KEY, id);
    },
    amountFor,
    // What the user typed for this month itself ("" when it's inheriting).
    textFor: (month: string) => texts[month] ?? "",
    setText: (month: string, text: string) => setTexts((current) => ({ ...current, [month]: text })),
    commit: (month: string) => save(`${MONTH_AMOUNT_PREFIX}${month}`, (texts[month] ?? "").trim()),
  };
}
