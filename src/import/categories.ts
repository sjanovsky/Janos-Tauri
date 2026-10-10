export type SpendCategory = "restaurants" | "groceries" | "partying" | "fixed" | "stuff";
export type Category = SpendCategory | "transfers" | "unclassified";

export const SPEND_CATEGORIES: SpendCategory[] = ["restaurants", "groceries", "partying", "fixed", "stuff"];

export const ALL_CATEGORIES: Category[] = ["unclassified", ...SPEND_CATEGORIES, "transfers"];

export const CATEGORY_LABELS: Record<Category, string> = {
  unclassified: "Unclassified",
  restaurants: "Restaurants",
  groceries: "Groceries",
  partying: "Partying",
  fixed: "Fixed",
  stuff: "Stuff",
  transfers: "Transfers",
};

export const CATEGORY_COLORS: Record<SpendCategory, string> = {
  restaurants: "#2a78d6",
  groceries: "#1baf7a",
  partying: "#eda100",
  fixed: "#008300",
  stuff: "#4a3aa7",
};
