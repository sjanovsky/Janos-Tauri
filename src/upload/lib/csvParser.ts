import type { Category } from "../../spending/lib/categories";

export type ImportedTransaction = {
  id: string;
  date: string;
  description: string;
  cardMember: string;
  accountNumber: string;
  amount: number;
  sourceBank: string;
  sourceFileName: string;
  category: Category;
  // Set by import auto-categorization until the user reviews (confirms or changes) the category.
  autoCategorized?: boolean;
};

export function splitDelimitedLine(line: string, delimiter: string): string[] {
  const values: string[] = [];
  let current = "";
  let insideQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === '"') {
      if (insideQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
      continue;
    }

    if (char === delimiter && !insideQuotes) {
      values.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current);
  return values;
}

export function parseCsvText(csvText: string, bankName: string, fileName: string): ImportedTransaction[] {
  const rows = csvText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (rows.length < 2) {
    return [];
  }

  const headers = splitDelimitedLine(rows[0], ",").map((header) => header.trim());
  const transactions: ImportedTransaction[] = [];

  for (let index = 1; index < rows.length; index += 1) {
    const values = splitDelimitedLine(rows[index], ",");
    const record: Record<string, string> = {};

    headers.forEach((header, headerIndex) => {
      record[header] = values[headerIndex] ?? "";
    });

    const amountValue = Number.parseFloat(record.Amount ?? "0");
    if (Number.isNaN(amountValue)) {
      continue;
    }

    transactions.push({
      id: `${bankName}-${fileName}-${index}`,
      date: record.Date ?? "",
      description: record.Description ?? "",
      cardMember: record["Card Member"] ?? "",
      accountNumber: record["Account #"] ?? "",
      amount: amountValue,
      sourceBank: bankName,
      sourceFileName: fileName,
      category: "unclassified",
    });
  }

  return transactions;
}
