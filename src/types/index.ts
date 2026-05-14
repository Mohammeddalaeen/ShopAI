export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  budgetLimit?: number;
  currency: string;
  points: number;
  createdAt: string;
  role?: 'admin' | 'user';
}

export interface Invoice {
  id?: string;
  userId: string;
  storeName: string;
  storeAddress?: string;
  date: string;
  visitTime?: string; // HH:mm format
  total: number;
  itemsCount: number;
  processed: boolean;
  createdAt: string;
}

export interface InvoiceItem {
  id?: string;
  invoiceId: string;
  userId: string;
  storeName: string;
  name: string;
  brand?: string;
  size?: string; // e.g. 500ml, 1kg
  category: string;
  price: number;
  quantity: number;
  unit: string;
  date: string;
  visitTime?: string;
  subcategory?: string;
}

export interface BudgetItem {
  id?: string;
  userId: string;
  category: string;
  limit: number;
  month: string; // YYYY-MM
  subcategory?: string;
}

export interface ShoppingListItem {
  id?: string;
  userId: string;
  name: string;
  brand?: string;
  size?: string;
  category: string;
  addedAt: string;
}

export type Category = 
  | 'Groceries' 
  | 'Vegetables'
  | 'Fruits'
  | 'Cleaning Products'
  | 'Electronics' 
  | 'Clothing' 
  | 'Home & Garden' 
  | 'Health & Beauty' 
  | 'Stationery'
  | 'Dining'
  | 'Transportation'
  | 'Entertainment'
  | 'Other';

export const CATEGORIES: Category[] = [
  'Groceries',
  'Vegetables',
  'Fruits',
  'Cleaning Products',
  'Electronics', 
  'Clothing', 
  'Home & Garden', 
  'Health & Beauty', 
  'Stationery',
  'Dining',
  'Transportation',
  'Entertainment',
  'Other'
];
