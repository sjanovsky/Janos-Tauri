# Personal Budgeting App — Implementation Plan

## Goal

A **local-first desktop application** that a user downloads and runs entirely on their own computer. The user uploads bank-exported CSV/XLSX files (checking, savings, credit card, brokerage, etc.), and the app:

- Parses and stores transactions/balances locally (no bank data ever leaves the machine unless the user opts into a sync feature later)
- Lets the user categorize transactions into pre-set (and custom) expense buckets
- Tracks **net worth**, **investment balances**, and **spending** over time
- Renders **monthly-granularity charts** for net worth, investments, and spending
- Supports **month-over-month** and **year-over-year** comparisons of expense buckets

Privacy and "no cloud required" are core to the value proposition — this is why a downloadable desktop app (not a web SaaS product) is the right shape.

## Tech Stack

| Layer | Choice | Why |
|---|---|---|
| App shell | **Tauri** (Rust core + system webview) | Small binary (~10-20MB vs Electron's ~150MB+), lower memory/CPU, sandboxed filesystem access by default — good fit for a finance app handling sensitive local data. Cross-platform (macOS/Windows/Linux) with one codebase. |
| Frontend UI | **React + TypeScript**, Vite bundler | Mature ecosystem, huge talent pool, good component/testing story. |
| UI components/styling | **Tailwind CSS** + **shadcn/ui** | Fast to build clean, consistent UI without a heavy design system. |
| Charting | **Recharts** (or **visx** if more custom control is needed) | Native React charting, good for line/bar/area charts at monthly granularity with minimal boilerplate. |
| Local database | **SQLite**, accessed via Tauri's Rust backend (`rusqlite` or `sqlx`) | Battle-tested embedded DB, handles relational queries (accounts, transactions, categories, monthly rollups) well, trivially backed up as a single file. |
| File parsing | **Rust** for CSV (`csv` crate) and XLSX (`calamine` crate), invoked as Tauri commands | Parsing runs in the backend for performance and to keep raw bank data out of the JS/webview layer. |
| Categorization engine | Rule-based matcher (merchant name / keyword → bucket) implemented in Rust, with a user-editable rules table stored in SQLite | Deterministic, explainable, fast; can be upgraded later with fuzzy matching or ML if needed. |
| State management (frontend) | **TanStack Query** for data fetching from the Rust backend + light React context/Zustand for UI state | Keeps server-like data (DB reads) and UI state cleanly separated. |
| Packaging/distribution | Tauri's built-in bundler (`.dmg`, `.msi`, `.AppImage`) + code signing | Native installers per OS, auto-update via Tauri's updater plugin (optional, off by default for a privacy-first tool). |

**Alternative considered:** Electron + Node.js + `better-sqlite3` + `xlsx`/`papaparse`. This is a valid fallback if the team is more JS/TS-native and wants to avoid Rust entirely — trades a larger bundle size and higher resource usage for a single-language (TypeScript) codebase across both frontend and backend logic.

## High-Level Architecture

```
┌─────────────────────────────┐
│   React/TS Frontend (UI)    │  Import wizard, category manager, dashboards/charts
└───────────────┬─────────────┘
                │ Tauri IPC (commands/events)
┌───────────────▼─────────────┐
│   Rust Backend (Tauri core) │  File parsing, categorization, aggregation, DB access
└───────────────┬─────────────┘
                │
┌───────────────▼─────────────┐
│   SQLite (local file)       │  accounts, transactions, categories, rules, snapshots
└──────────────────────────────┘
```

## Core Data Model (sketch)

- `accounts` — id, name, type (checking/savings/credit/investment), institution
- `transactions` — id, account_id, date, description, amount, category_id, raw_import_hash (for de-duping re-imports)
- `categories` — id, name, parent_bucket (pre-set: Housing, Food, Transport, Entertainment, Subscriptions, Income, Investments, etc.), is_custom
- `categorization_rules` — id, match_pattern, category_id, priority
- `balance_snapshots` — id, account_id, month, ending_balance (drives net worth / investment charts without re-summing all transactions every time)

## Key Features & Implementation Notes

1. **Import wizard** — user selects a CSV/XLSX, app auto-detects columns (date/description/amount) with a mapping step for banks with nonstandard formats; de-dupes against previously imported rows.
2. **Categorization** — auto-apply rules on import; user can bulk-recategorize and the app learns (updates/creates a rule) from manual corrections.
3. **Monthly rollups** — a background job (on import completion) recomputes `balance_snapshots` and per-category monthly totals so chart queries are fast reads, not live aggregations.
4. **Dashboards** — three primary chart views: Net Worth over time (stacked assets vs. liabilities), Investments over time, Spending over time (by bucket, stacked/grouped bar); plus a MoM/YoY comparison table view per bucket.
5. **Data ownership** — explicit "Export my data" (SQLite file or CSV) and "Where is my data stored" affordance in settings, reinforcing the local-first promise.

## Suggested Phases

1. **Foundation** — Tauri + React scaffold, SQLite schema/migrations, basic account CRUD.
2. **Import pipeline** — CSV/XLSX parsing, column mapping UI, de-dupe logic.
3. **Categorization** — pre-set buckets, rules engine, manual recategorization UI.
4. **Aggregation + Charts** — monthly rollup jobs, net worth/investment/spending charts, MoM/YoY comparison views.
5. **Polish** — multi-bank format handling, data export/backup, packaging & installers for macOS/Windows.
