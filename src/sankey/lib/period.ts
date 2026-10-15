// The time window the diagram covers: a month, a year, a custom date range or everything.

export type PeriodMode = "month" | "year" | "range" | "all";

export type PeriodSelection = {
  mode: PeriodMode;
  year: number;
  // 0-11
  month: number;
  // Inclusive ends of a custom range, as <input type="date"> values ("YYYY-MM-DD", or "").
  from: string;
  to: string;
};

export type PeriodBounds = {
  // Inclusive start and exclusive end timestamps (local time); null = unbounded.
  start: number | null;
  end: number | null;
};

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export const monthName = (month: number) => MONTH_NAMES[month] ?? "";

export function defaultPeriod(today: Date = new Date()): PeriodSelection {
  return { mode: "year", year: today.getFullYear(), month: today.getMonth(), from: "", to: "" };
}

function parseInputDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

export function periodBounds(selection: PeriodSelection): PeriodBounds {
  switch (selection.mode) {
    case "month":
      return {
        start: new Date(selection.year, selection.month, 1).getTime(),
        end: new Date(selection.year, selection.month + 1, 1).getTime(),
      };
    case "year":
      return {
        start: new Date(selection.year, 0, 1).getTime(),
        end: new Date(selection.year + 1, 0, 1).getTime(),
      };
    case "range": {
      const from = parseInputDate(selection.from);
      const to = parseInputDate(selection.to);
      return {
        start: from ? from.getTime() : null,
        end: to ? new Date(to.getFullYear(), to.getMonth(), to.getDate() + 1).getTime() : null,
      };
    }
    default:
      return { start: null, end: null };
  }
}

export function inPeriod(timestamp: number, bounds: PeriodBounds): boolean {
  return (bounds.start === null || timestamp >= bounds.start) && (bounds.end === null || timestamp < bounds.end);
}

export function periodLabel(selection: PeriodSelection): string {
  switch (selection.mode) {
    case "month":
      return `${monthName(selection.month)} ${selection.year}`;
    case "year":
      return `${selection.year}`;
    case "range":
      if (selection.from && selection.to) {
        return `${selection.from} to ${selection.to}`;
      }
      return selection.from ? `Since ${selection.from}` : selection.to ? `Through ${selection.to}` : "All time";
    default:
      return "All time";
  }
}
