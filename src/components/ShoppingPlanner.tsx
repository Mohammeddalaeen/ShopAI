import React, { useState, useEffect, useMemo } from 'react';
import { ShoppingBag, ChevronRight, Store, Tag, Filter, Search, Sparkles, Check, ListChecks, ArrowRight, Save, Trash2, TrendingDown, AlertCircle, Zap, RefreshCw, Star, Edit2, X, ShoppingBasket, User, ArrowRightLeft, ShoppingCart } from 'lucide-react';
import { collection, query, getDocs, orderBy, limit, where, addDoc, serverTimestamp, deleteDoc, doc, updateDoc, writeBatch } from 'firebase/firestore';
import { db, auth, clearAllData, checkConnection } from '../lib/firebase';
import { useAuth } from '../context/AuthContext';
import { InvoiceItem, CATEGORIES, Category, ShoppingListItem, BudgetItem } from '../types';
import { cn, formatCurrency, isAdminUser } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';

const IGNORE_WORDS = new Set(['and', 'with', 'the', 'for', 'ml', 'kg', 'pcs', 'l', 'g', 'local', 'fresh', 'premium', 'high', 'quality', 'product', 'brand', 'bag', 'pack', 'size', 'white', 'black', 'red', 'blue', 'large', 'small', 'medium', 'organic', 'pure', 'natural', 'super', 'extra', 'ultra', 'value', 'price', 'whole', 'half', 'skimmed', 'full', 'fat', 'diet', 'light', 'original']);

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
    },
    operationType,
    path
  }
  console.error('Firestore Error details: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

const parseToGramsOrMl = (sizeStr: string): number | null => {
  if (!sizeStr) return null;
  const clean = sizeStr.toLowerCase().replace(/\s/g, '');
  const match = clean.match(/(\d+\.?\d*)(kg|g|l|ml|)/);
  if (!match) return null;
  const value = parseFloat(match[1]);
  const unit = match[2];
  if (unit === 'kg' || unit === 'l') return value * 1000;
  if (!unit && value < 10) return value * 1000; 
  return value;
};

const parseSizeSafe = (s: string) => parseToGramsOrMl(s) || 0;

const isEffectivelySameProduct = (
  v: InvoiceItem, 
  targetKey: string, 
  targetNameWords: string[], 
  targetBrand: string, 
  targetSizeVal: number | null, 
  targetSubcat?: string
): boolean => {
  const vKey = `${v.name.toLowerCase().trim()}|${(v.brand || '').toLowerCase().trim()}|${(v.size || '').toLowerCase().trim()}`;
  if (vKey === targetKey) return true;

  const vBrand = (v.brand || '').toLowerCase().trim();
  const vSizeVal = parseToGramsOrMl(v.size || '');
  const vSubcat = v.subcategory?.toLowerCase().trim();
  const vNameWords = v.name.toLowerCase().split(/[\s,.\-_()/\\|]+/).filter(w => w.length > 2 && !IGNORE_WORDS.has(w));

  // Size must match for "Same Product" (not a swap)
  const sizeMatch = targetSizeVal && vSizeVal && Math.abs(targetSizeVal - vSizeVal) < 2;
  if (!sizeMatch) return false;

  const b1 = targetBrand.replace(/[^a-z0-9]/g, '');
  const b2 = vBrand.replace(/[^a-z0-9]/g, '');
  const brandMatch = b1 && b2 && (b1 === b2 || b1.includes(b2) || b2.includes(b1));
  
  if (brandMatch) return true; // Brand and Size match is usually enough for "Same Product"

  const subcategoryMatch = targetSubcat && vSubcat && targetSubcat === vSubcat;
  const nameOverlap = targetNameWords.some(w => vNameWords.includes(w)) && targetNameWords.length > 0;
  
  // If no brand match, we need both subcat and some name overlap to be sure it's "Same Product"
  return subcategoryMatch && nameOverlap;
};

import { useLanguage } from '../context/LanguageContext';
import { translations } from '../lib/translations';

export const ShoppingPlanner: React.FC = () => {
  const { user, profile } = useAuth();
  const { t, isRTL, language } = useLanguage();
  const [activeCategory, setActiveCategory] = useState<Category>('Groceries');
  const [items, setItems] = useState<Record<string, InvoiceItem[]>>({});
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [userList, setUserList] = useState<ShoppingListItem[]>([]);
  const [categoryBudget, setCategoryBudget] = useState<BudgetItem | null>(null);
  const [allBudgets, setAllBudgets] = useState<BudgetItem[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [sessionSavings, setSessionSavings] = useState(0);
  const [selectedStore, setSelectedStore] = useState<string | null>(null);
  const [allowSwaps, setAllowSwaps] = useState(false);
  const [planningMode, setPlanningMode] = useState<'browse' | 'optimize'>('browse');

  const isAdmin = isAdminUser(user?.email);

  useEffect(() => {
    if (user) {
      console.log("Admin check - Email:", user.email, "Matched:", isAdminUser(user.email));
    }
  }, [user]);

  useEffect(() => {
    if (isAdmin) {
      console.log("Admin mode enabled for", user?.email);
      setIsAdminMode(true);
    } else {
      setIsAdminMode(false);
    }
  }, [isAdmin, user]);

  const handleDeleteItemRecord = async (id: string, nameKey: string) => {
    if (!isAdmin) return;
    try {
      await deleteDoc(doc(db, 'items', id));
      setItems(prev => {
        const next = { ...prev };
        next[nameKey] = next[nameKey].filter(i => i.id !== id);
        if (next[nameKey].length === 0) delete next[nameKey];
        return next;
      });
    } catch (err) {
      console.error(err);
      handleFirestoreError(err, OperationType.DELETE, `items/${id}`);
    }
  };

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleDeleteAllDatabase = async () => {
    if (!isAdminUser(user?.email)) {
      alert("Admin Check Failed.");
      return;
    }
    
    if (!showDeleteConfirm) {
      setShowDeleteConfirm(true);
      return;
    }
    
    setIsSaving(true);
    setShowDeleteConfirm(false);
    
    try {
      const isConnected = await checkConnection();
      if (!isConnected) {
        alert("Firestore backend is unreachable. Please check your internet connection.");
        setIsSaving(false);
        return;
      }
      
      await clearAllData();
      setItems({});
      setSelectedItems(new Set());
      alert("All data cleared successfully! Page will now reload.");
      window.location.reload();
    } catch (err) {
      console.error("Failed to clear database", err);
      alert("Error clearing database: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsSaving(false);
    }
  };

  const [editingItemRecord, setEditingItemRecord] = useState<InvoiceItem | null>(null);
  const [newItem, setNewItem] = useState<Partial<InvoiceItem>>({
    name: '',
    brand: '',
    size: '',
    price: 0,
    storeName: '',
    category: activeCategory,
    quantity: 1
  });
  const [showAddModal, setShowAddModal] = useState(false);

  const handleManualAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !isAdmin) return;

    try {
      if (editingItemRecord?.id) {
        // Update existing
        await updateDoc(doc(db, 'items', editingItemRecord.id), {
          ...newItem,
          price: Number(newItem.price),
          quantity: Number(newItem.quantity || 1)
        });

        const updated = { ...editingItemRecord, ...newItem } as InvoiceItem;
        const oldKey = `${editingItemRecord.name.toLowerCase().trim()}|${(editingItemRecord.brand || '').toLowerCase().trim()}|${(editingItemRecord.size || '').toLowerCase().trim()}`;
        const newKey = `${updated.name.toLowerCase().trim()}|${(updated.brand || '').toLowerCase().trim()}|${(updated.size || '').toLowerCase().trim()}`;

        setItems(prev => {
          const next = { ...prev };
          // Remove from old key array
          next[oldKey] = next[oldKey].filter(i => i.id !== editingItemRecord.id);
          if (next[oldKey].length === 0) delete next[oldKey];
          
          // Add to new key array
          if (!next[newKey]) next[newKey] = [];
          next[newKey] = [updated, ...next[newKey]];
          return next;
        });
      } else {
        // Add new
        const docRef = await addDoc(collection(db, 'items'), {
          ...newItem,
          userId: user.uid,
          date: new Date().toISOString(),
          category: newItem.category || activeCategory,
          price: Number(newItem.price),
          quantity: Number(newItem.quantity || 1)
        });

        const added = { id: docRef.id, ...newItem, date: new Date().toISOString(), userId: user.uid } as InvoiceItem;
        const key = `${added.name.toLowerCase().trim()}|${(added.brand || '').toLowerCase().trim()}|${(added.size || '').toLowerCase().trim()}`;
        
        setItems(prev => {
          const next = { ...prev };
          if (!next[key]) next[key] = [];
          next[key] = [added, ...next[key]];
          return next;
        });
      }

      setShowAddModal(false);
      setEditingItemRecord(null);
      setNewItem({
        name: '',
        brand: '',
        subcategory: '',
        size: '',
        price: 0,
        storeName: '',
        category: activeCategory,
        quantity: 1
      });
    } catch (err) {
      handleFirestoreError(err, editingItemRecord ? OperationType.UPDATE : OperationType.CREATE, 'items');
    }
  };

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const now = new Date();
        const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

        // Fetch price data
        const itemsQuery = query(
          collection(db, 'items'),
          where('category', '==', activeCategory),
          limit(500)
        );
        const snap = await getDocs(itemsQuery);
        const fetchedItems = snap.docs
          .map(doc => ({ id: doc.id, ...doc.data() } as InvoiceItem))
          .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        
        setItems(prev => {
          const next = { ...prev };
          // If we changed category, we don't necessarily want to keep EVERYTHING in memory 
          // but the current logic appends. Let's keep it but ensure we handle the current fetch correctly.
          fetchedItems.forEach(item => {
            const name = item.name.toLowerCase().trim();
            const brand = (item.brand || '').toLowerCase().trim();
            const size = (item.size || '').toLowerCase().trim();
            const key = `${name}|${brand}|${size}`;
            
            if (!next[key]) next[key] = [];
            
            // Avoid duplicates by ID
            if (!next[key].some(i => i.id === item.id)) {
              next[key].push(item);
            }
          });
          return next;
        });

        // Fetch user's saved list and budget
        if (user) {
          // List
          const listQuery = query(
            collection(db, 'shopping_list'),
            where('userId', '==', user.uid)
          );
          
          // Budget
          const budgetQuery = query(
            collection(db, 'budgets'),
            where('userId', '==', user.uid),
            where('month', '==', currentMonth)
          );

          try {
            const [listSnap, budgetSnap] = await Promise.all([
              getDocs(listQuery),
              getDocs(budgetQuery)
            ]);

            const list = listSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as ShoppingListItem));
            setUserList(list);
            
            const budgets = budgetSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as BudgetItem));
            setAllBudgets(budgets);
            const currentCatBudget = budgets.find(b => b.category === activeCategory) || null;
            setCategoryBudget(currentCatBudget);
          } catch (err) {
            console.error("Fetch sub-collections error", err);
          }
        }
      } catch (err) {
        if (err instanceof Error && err.message.includes('shopping_list')) {
          // already handled or rethrown as JSON
          console.error("Planner list fetch failed", err);
        } else {
          console.error("Error fetching data for planner", err);
          handleFirestoreError(err, OperationType.LIST, 'items');
        }
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [activeCategory, user]);

  const syncFavorites = () => {
    setSelectedItems(prev => {
      const next = new Set(prev);
      const favoriteKeys = userList.map(fav => `${fav.name.toLowerCase().trim()}|${(fav.brand || '').toLowerCase().trim()}|${(fav.size || '').toLowerCase().trim()}`);
      
      const allSelected = favoriteKeys.every(k => next.has(k));
      
      if (allSelected) {
        // Deselect all favorites
        favoriteKeys.forEach(k => next.delete(k));
      } else {
        // Select all favorites
        favoriteKeys.forEach(k => {
          // Only add if it exists in current market data to ensure accuracy
          if (items[k]) {
            next.add(k);
          }
        });
      }
      return next;
    });
  };

  const toggleItem = (itemKey: string) => {
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(itemKey)) next.delete(itemKey);
      else next.add(itemKey);
      return next;
    });
  };

  const toggleFavorite = async (e: React.MouseEvent, itemKey: string) => {
    e.stopPropagation(); 
    if (!user) return;
    
    // itemKey is "name|brand|size"
    const [name, brand, size] = itemKey.split('|');
    const existingFav = userList.find(i => 
      i.name.toLowerCase().trim() === name && 
      (i.brand || '').toLowerCase().trim() === brand && 
      (i.size || '').toLowerCase().trim() === size
    );

    try {
      if (existingFav) {
        // Remove from favorites
        try {
          await deleteDoc(doc(db, 'shopping_list', existingFav.id!));
        } catch (delErr) {
          handleFirestoreError(delErr, OperationType.DELETE, `shopping_list/${existingFav.id}`);
        }
        setUserList(prev => prev.filter(i => i.id !== existingFav.id));
      } else {
        // Add to favorites
        const docRef = await addDoc(collection(db, 'shopping_list'), {
          userId: user.uid,
          name,
          brand,
          size,
          category: activeCategory,
          addedAt: new Date().toISOString()
        });

        const newItem: ShoppingListItem = {
          id: docRef.id,
          userId: user.uid,
          name,
          brand,
          size,
          category: activeCategory,
          addedAt: new Date().toISOString()
        };

        setUserList(prev => [...prev, newItem]);
      }
    } catch (err) {
      console.error("Failed to toggle favorite", err);
    }
  };

  const deleteFromList = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'shopping_list', id));
      setUserList(prev => prev.filter(i => i.id !== id));
    } catch (err) {
      console.error(err);
    }
  };

  const basketCategories = useMemo(() => {
    const categories = new Set<string>();
    selectedItems.forEach(key => {
      const item = items[key]?.[0];
      if (item) categories.add(item.category);
    });
    return Array.from(categories);
  }, [selectedItems, items]);

  const allStaplesInBasket = useMemo(() => {
    if (userList.length === 0) return false;
    return userList.every(fav => {
      const key = `${fav.name.toLowerCase().trim()}|${(fav.brand || '').toLowerCase().trim()}|${(fav.size || '').toLowerCase().trim()}`;
      return selectedItems.has(key);
    });
  }, [userList, selectedItems]);

  const totalBasketBudget = useMemo(() => {
    return allBudgets
      .filter(b => basketCategories.includes(b.category))
      .reduce((acc, curr) => acc + curr.limit, 0);
  }, [allBudgets, basketCategories]);

  // Optimization Logic: Find best store for combined basket - considering best available price for item types
  const basketOptimization = useMemo(() => {
    const allItemsList = Object.values(items).flat() as InvoiceItem[];
    const categoryItems = allItemsList.filter(i => i.category === activeCategory);
    
    // CASE 1: NO ITEMS SELECTED - GLOBAL CATEGORY INSIGHT
    if (selectedItems.size === 0) {
      const categoryItems = allItemsList.filter(i => i.category === activeCategory);
      if (categoryItems.length === 0) return null;

      // Identify "Common Items": items that appear in multiple stores
      // Group by Product Identity
      const productGroups: Record<string, InvoiceItem[]> = {};
      
      categoryItems.forEach(item => {
        const brand = (item.brand || 'nobrand').toLowerCase().replace(/[^a-z0-9]/g, '');
        const size = parseToGramsOrMl(item.size || '') || 0;
        const subcat = (item.subcategory || 'nosubcat').toLowerCase().trim();
        // ID: brand + size + subcat (Heuristic for "same product" across stores)
        const id = `${brand}-${size}-${subcat}`;
        if (!productGroups[id]) productGroups[id] = [];
        productGroups[id].push(item);
      });

      // Filter to groups that have items in at least 2 different stores
      const commonProductGroups = Object.values(productGroups).filter(group => {
        const stores = new Set(group.map(i => i.storeName));
        return stores.size >= 2;
      });

      if (commonProductGroups.length === 0) return null;

      const storeAnalysis: Record<string, { total: number, coveredItems: number, items: any[], isGlobal: boolean }> = {};

      commonProductGroups.forEach(group => {
        group.forEach(item => {
          if (!storeAnalysis[item.storeName]) {
            storeAnalysis[item.storeName] = { total: 0, coveredItems: 0, items: [], isGlobal: true };
          }
          
          // Only add the cheapest version of this "common product" in this specific store
          const existing = storeAnalysis[item.storeName].items.find(i => 
            i.brand === item.brand && i.size === item.size && i.subcategory === item.subcategory
          );

          if (!existing) {
            storeAnalysis[item.storeName].total += item.price;
            storeAnalysis[item.storeName].coveredItems += 1;
            storeAnalysis[item.storeName].items.push(item);
          } else if (item.price < existing.price) {
            storeAnalysis[item.storeName].total = storeAnalysis[item.storeName].total - existing.price + item.price;
            const idx = storeAnalysis[item.storeName].items.indexOf(existing);
            storeAnalysis[item.storeName].items[idx] = item;
          }
        });
      });

      return Object.keys(storeAnalysis)
        .map(storeName => ({
          storeName,
          ...storeAnalysis[storeName],
          completionRate: storeAnalysis[storeName].coveredItems / commonProductGroups.length
        }))
        .filter(r => r.coveredItems > 1) // Only show stores that cover more than one common item
        .sort((a, b) => {
          if (Math.abs(b.completionRate - a.completionRate) > 0.1) return b.completionRate - a.completionRate;
          return a.total - b.total;
        });
    }

    // CASE 2: ITEMS SELECTED - SPECIFIC BASKET OPTIMIZATION (Existing logic)
    const storeAnalysis: Record<string, { total: number, coveredItems: number, items: any[], savingApplied: boolean, isGlobal: boolean }> = {};

    const selectedKeys = Array.from(selectedItems);
    
    selectedKeys.forEach((itemKey: string) => {
      const parts = itemKey.split('|');
      const [name, brand, size] = parts;
      const variations = (items[itemKey] || []) as InvoiceItem[];
      const currentBest = variations.length > 0 
        ? variations.reduce((best, cur) => cur.price < best.price ? cur : best)
        : null;
      
      const subcat = currentBest?.subcategory?.toLowerCase().trim();
      const currentSizeVal = parseToGramsOrMl(size);
      const targetBrand = brand.toLowerCase().trim();
      const nameWords = name.toLowerCase().split(/[\s,.\-_()/\\|]+/).filter(w => w.length > 2 && !IGNORE_WORDS.has(w));

      const storesHandled = new Set<string>();

      // 1. Direct variations and identical Brand/Size matches (Product-level matching)
      const allItemsList = Object.values(items).flat() as InvoiceItem[];
      
      allItemsList.forEach(v => {
        if (isEffectivelySameProduct(v, itemKey, nameWords, targetBrand, currentSizeVal, subcat)) {
          if (!storeAnalysis[v.storeName]) {
            storeAnalysis[v.storeName] = { total: 0, coveredItems: 0, items: [], savingApplied: false, isGlobal: false };
          }
          
          const existingStored = storeAnalysis[v.storeName].items.find(i => i.originalTargetKey === itemKey);
          if (!existingStored) {
            storeAnalysis[v.storeName].total += v.price;
            storeAnalysis[v.storeName].coveredItems += 1;
            storeAnalysis[v.storeName].items.push({ ...v, originalTargetKey: itemKey });
          } else if (v.price < existingStored.price) {
            storeAnalysis[v.storeName].total = storeAnalysis[v.storeName].total - existingStored.price + v.price;
            const idx = storeAnalysis[v.storeName].items.indexOf(existingStored);
            storeAnalysis[v.storeName].items[idx] = { ...v, originalTargetKey: itemKey };
          }
          storesHandled.add(v.storeName);
        }
      });

      // 2. Swaps/Alternatives in other stores (ONLY if allowSwaps is enabled)
      if (allowSwaps) {
        const allItemsList = Object.values(items).flat() as InvoiceItem[];
        allItemsList.forEach(alt => {
          // Match logic: subcategory match OR name overlap
          let isMatch = false;
          const altSubcat = alt.subcategory?.toLowerCase().trim();
          if (subcat && altSubcat && subcat === altSubcat) {
            isMatch = true;
          } else if (nameWords.length > 0) {
            const altNameWords = alt.name.toLowerCase().split(/[\s,.\-_()/\\|]+/);
            isMatch = nameWords.some(w => altNameWords.includes(w));
          }

          if (isMatch) {
            // Check size similarity if both known
            const altSizeVal = parseToGramsOrMl(alt.size || '');
            if (currentSizeVal && altSizeVal && Math.abs(altSizeVal - currentSizeVal) > 100) return;

            if (!storeAnalysis[alt.storeName]) {
              storeAnalysis[alt.storeName] = { total: 0, coveredItems: 0, items: [], savingApplied: false, isGlobal: false };
            }

            const existingStored = storeAnalysis[alt.storeName].items.find(i => i.originalTargetKey === itemKey);
            
            if (!existingStored) {
               storeAnalysis[alt.storeName].total += alt.price;
               storeAnalysis[alt.storeName].coveredItems += 1;
               storeAnalysis[alt.storeName].items.push({ ...alt, originalTargetKey: itemKey, isSwap: true });
            } else if (alt.price < existingStored.price) {
               storeAnalysis[alt.storeName].total = storeAnalysis[alt.storeName].total - existingStored.price + alt.price;
               const idx = storeAnalysis[alt.storeName].items.indexOf(existingStored);
               storeAnalysis[alt.storeName].items[idx] = { ...alt, originalTargetKey: itemKey, isSwap: true };
               storeAnalysis[alt.storeName].savingApplied = true;
            }
          }
        });
      }
    });

    const results = Object.keys(storeAnalysis)
      .map(storeName => ({
        storeName,
        ...storeAnalysis[storeName],
        completionRate: storeAnalysis[storeName].coveredItems / selectedItems.size
      }))
      .filter(r => r.coveredItems > 0)
      .sort((a, b) => {
        // Prioritize completeness
        if (Math.abs(b.completionRate - a.completionRate) > 0.01) return b.completionRate - a.completionRate;
        // Then best price
        return a.total - b.total;
      });

    return results;
  }, [selectedItems, items, activeCategory, allowSwaps]);

  // Suggestions logic: Identify cheaper alternatives or better bulk value
  const budgetSuggestions = useMemo(() => {
    if (selectedItems.size === 0) return [];
    
    const recommendations: any[] = [];
    const allKeys = Object.keys(items);

    selectedItems.forEach(itemKey => {
      const parts = itemKey.split('|');
      if (parts.length < 3) return;
      const [name, brand, size] = parts;
      
      const variations = items[itemKey] || [];
      if (variations.length === 0) return;
      const currentBestRec = variations.reduce((best, cur) => cur.price < best.price ? cur : best);
      const currentPrice = currentBestRec.price;
      const currentSizeValue = parseToGramsOrMl(size);
      const currentUnitPrice = currentSizeValue ? currentPrice / currentSizeValue : null;
      const currentSubcategory = currentBestRec.subcategory?.toLowerCase().trim();
      
      const nameWords = name.toLowerCase().split(/[\s,.\-_()/\\|]+/).filter(w => w.length > 2 && !IGNORE_WORDS.has(w));
      if (nameWords.length === 0) return;

      // Find alternatives for this specific item type
      let bestBulkForThisItem: any = null;

      allKeys.forEach(altKey => {
        if (altKey === itemKey) return;
        if (selectedItems.has(altKey)) return; 
        
        const altVariations = items[altKey] || [];
        if (altVariations.length === 0) return;
        const altBest = altVariations.reduce((best, cur) => cur.price < best.price ? cur : best);

        const altName = altBest.name.toLowerCase();
        const altBrand = (altBest.brand || '').toLowerCase().trim();
        const altSize = (altBest.size || '').toLowerCase().trim();
        const altSizeValue = parseToGramsOrMl(altSize);
        const altUnitPrice = altSizeValue ? altBest.price / altSizeValue : null;
        const altSubcategory = altBest.subcategory?.toLowerCase().trim();

        // 1. BULK VALUE CHECK (Same brand, larger size, better unit price)
        if (altBrand === brand.toLowerCase().trim() && altSizeValue && currentSizeValue && altSizeValue > currentSizeValue) {
          // Check if names are basically the same or have meaningful overlap
          const altNameWords = altName.split(/[\s,.\-_()/\\|]+/).filter(w => w.length > 2 && !IGNORE_WORDS.has(w));
          const hasNameMatch = nameWords.some(w => altNameWords.includes(w));
          
          if (hasNameMatch && altUnitPrice && currentUnitPrice && altUnitPrice < currentUnitPrice * 0.95) {
            const savingsPercent = Math.round((1 - (altUnitPrice / currentUnitPrice)) * 100);
            const currentRec = {
              type: 'bulk',
              target: itemKey,
              targetDisplay: `${brand || 'Generic'} ${name} ${size}`,
              currentPrice,
              currentSize: size,
              currentSizeValue,
              currentUnitPrice,
              savingsPercent,
              suggestion: {
                key: altKey,
                name: altBest.name,
                brand: altBest.brand,
                size: altBest.size,
                sizeValue: altSizeValue,
                price: altBest.price,
                unitPrice: altUnitPrice,
                category: altBest.category
              }
            };

            // Keep only the best bulk upgrade (lowest unit price) for this specific item
            if (!bestBulkForThisItem || currentRec.suggestion.unitPrice < bestBulkForThisItem.suggestion.unitPrice) {
              bestBulkForThisItem = currentRec;
            }
          }
        }

        // 2. CHEAPER SWAP CHECK (Same category, similar name, cheaper price)
        if (allowSwaps && altBest.category === currentBestRec.category) {
          // If subcategories are present and different, reject
          if (currentSubcategory && altSubcategory && currentSubcategory !== altSubcategory) return;

          const altNameWords = altName.split(/[\s,.\-_()/\\|]+/).filter(w => w.length > 2 && !IGNORE_WORDS.has(w));
          
          // If subcategories match, it's a strong indicator
          const subcategoriesMatch = currentSubcategory && altSubcategory && currentSubcategory === altSubcategory;
          
          // Require at least one meaningful word to match if no subcategory info
          const hasMeaningfulMatch = subcategoriesMatch || nameWords.some(w => altNameWords.includes(w));
          
          if (hasMeaningfulMatch) {
            let isCheaper = false;
            
            if (currentUnitPrice && altUnitPrice) {
              // Compare by unit price if both have sizes
              isCheaper = altUnitPrice < currentUnitPrice * 0.95; // At least 5% unit price saving
            } else {
              // Fallback to absolute price only if sizes are same or unknown
              isCheaper = altBest.price < currentPrice * 0.9;
            }

            if (isCheaper) {
              if (!recommendations.some(r => r.suggestion.key === altKey)) {
                recommendations.push({
                  type: 'swap',
                  target: itemKey,
                  targetDisplay: `${brand || 'Generic'} ${name} ${size}`,
                  currentPrice,
                  currentSizeValue,
                  currentUnitPrice,
                  suggestion: {
                    key: altKey,
                    name: altBest.name,
                    brand: altBest.brand,
                    size: altBest.size,
                    sizeValue: altSizeValue,
                    price: altBest.price,
                    category: altBest.category,
                    unitPrice: altUnitPrice
                  }
                });
              }
            }
          }
        }
      });

      if (bestBulkForThisItem) {
        recommendations.push(bestBulkForThisItem);
      }
    });

    return recommendations
      .sort((a, b) => {
        if (a.type === 'bulk' && b.type !== 'bulk') return -1;
        if (b.type === 'bulk' && a.type !== 'bulk') return 1;
        return (b.currentPrice - b.suggestion.price) - (a.currentPrice - a.suggestion.price);
      })
      .slice(0, 3);
  }, [selectedItems, items, allowSwaps]);

  // Final Confirmation & Savings Analysis
  const savingsAnalysis = useMemo(() => {
    if (selectedItems.size === 0 || !items) return null;
    
    const analysis: any[] = [];
    let totalMarketValue = 0;
    let totalBasketValue = 0;
    const allItemsList = Object.values(items).flat() as InvoiceItem[];
    
    Array.from(selectedItems).forEach((itemKey: string) => {
      const parts = itemKey.split('|');
      const [name, brand, size] = parts;
      const targetBrand = brand.toLowerCase().trim();
      const targetSizeVal = parseToGramsOrMl(size);
      const nameWords = name.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2 && !IGNORE_WORDS.has(w));

      // Find original item to get subcategory
      const originalVariations = items[itemKey] || [];
      const subcat = originalVariations[0]?.subcategory?.toLowerCase().trim();

      // Find all variations of this product across all stores
      const productVariations = allItemsList.filter(v => 
        isEffectivelySameProduct(v, itemKey, nameWords, targetBrand, targetSizeVal, subcat)
      );

      if (productVariations.length === 0) return;
      
      const avgPrice = productVariations.reduce((sum, v) => sum + (Number(v.price) || 0), 0) / productVariations.length;
      
      // Best price across all shops for this product
      const bestPrice = productVariations.reduce((best, v) => {
        const p = Number(v.price) || 0;
        return p < best ? p : best;
      }, productVariations[0].price);

      // Price at the store we chose in basketOptimization
      let chosenPrice = bestPrice;
      if (basketOptimization && basketOptimization.length > 0) {
        const chosenStoreItem = basketOptimization[0].items.find((i: any) => i.originalTargetKey === itemKey);
        if (chosenStoreItem) {
          chosenPrice = chosenStoreItem.price;
        }
      }
      
      analysis.push({
        itemKey,
        name: productVariations[0].name,
        brand: productVariations[0].brand,
        size: productVariations[0].size,
        avgPrice,
        bestPrice: chosenPrice,
        savings: avgPrice - chosenPrice
      });
      
      totalMarketValue += avgPrice;
      totalBasketValue += chosenPrice;
    });
    
    return { 
      items: analysis, 
      totalMarketValue, 
      totalBasketValue, 
      totalSavings: totalMarketValue - totalBasketValue 
    };
  }, [selectedItems, items, basketOptimization, activeCategory]);

  const recordStoreSelection = async (storeName: string, total: number, itemsCount: number) => {
    if (!user) return;
    try {
      await addDoc(collection(db, 'store_selections'), {
        userId: user.uid,
        userEmail: user.email,
        storeName,
        totalValue: total,
        itemsCount,
        category: activeCategory,
        timestamp: serverTimestamp()
      });
      setSelectedStore(storeName);
    } catch (err) {
      console.error("Failed to record store selection", err);
      handleFirestoreError(err, OperationType.CREATE, 'store_selections');
    }
  };

  const swapItem = (oldName: string, newName: string, potentialSaving: number = 0) => {
    setSelectedItems(prev => {
      const next = new Set(prev);
      next.delete(oldName);
      next.add(newName);
      return next;
    });
    if (potentialSaving > 0) {
      setSessionSavings(prev => prev + potentialSaving);
    }
  };

  const saveSuggestion = async (item: { name: string, brand: string, size: string, category: string }) => {
    if (!user) return;
    
    // Check if already in list
    if (userList.some(i => i.name.toLowerCase() === item.name.toLowerCase())) return;

    try {
      const docRef = await addDoc(collection(db, 'shopping_list'), {
        userId: user.uid,
        name: item.name.toLowerCase(),
        brand: item.brand || '',
        size: item.size || '',
        category: item.category || activeCategory,
        addedAt: new Date().toISOString()
      });

      const newItem: ShoppingListItem = {
        id: docRef.id,
        userId: user.uid,
        name: item.name.toLowerCase(),
        brand: item.brand || '',
        size: item.size || '',
        category: item.category || activeCategory,
        addedAt: new Date().toISOString()
      };

      setUserList(prev => [...prev, newItem]);
    } catch (err) {
      console.error("Failed to save suggestion", err);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC]">
      {/* Top Professional Header */}
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-xl border-b border-gray-100 px-6 py-4">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-4">
            <div className="bg-blue-600 p-2.5 rounded-2xl shadow-lg shadow-blue-100">
              <ShoppingBasket className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-black text-gray-900 tracking-tight leading-none">{t('appName')}</h1>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{t(activeCategory as any)}</span>
                <span className="w-1 h-1 bg-gray-300 rounded-full" />
                <span className="text-[10px] font-black text-blue-600 uppercase tracking-widest">{language === 'ar' ? 'تحسين مباشر' : 'Live Optimization'}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {profile && profile.points > 0 && (
              <div className="bg-yellow-50 border border-yellow-100 px-4 py-2 rounded-2xl flex items-center gap-3">
                <div className="bg-yellow-400 p-1.5 rounded-xl shadow-sm">
                  <Sparkles className="w-4 h-4 text-white" />
                </div>
                <div>
                  <p className="text-[9px] font-black text-yellow-800 uppercase tracking-tighter leading-none mb-0.5">{language === 'ar' ? 'نقاط المجتمع' : 'Community Credits'}</p>
                  <p className="text-sm font-black text-yellow-900 leading-none">{profile.points}</p>
                </div>
              </div>
            )}
            
            <div className="h-10 w-[1px] bg-gray-100 mx-2 hidden md:block" />

            <div className="flex items-center gap-3">
              <div className="text-right hidden sm:block">
                <p className="text-[10px] font-black text-gray-400 uppercase leading-none mb-1">{user?.email}</p>
                <button onClick={() => auth.signOut()} className="text-[10px] font-black text-blue-600 hover:text-blue-800 uppercase tracking-widest transition-colors">{t('logout')}</button>
              </div>
              <div className="w-10 h-10 bg-gray-50 border border-gray-100 rounded-2xl flex items-center justify-center text-gray-400 hover:text-blue-600 transition-colors">
                <User className="w-5 h-5" />
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 md:px-6 py-6 md:py-8">
        {/* Mobile View Toggle */}
        <div className="lg:hidden flex items-center bg-white p-1 rounded-2xl border border-gray-100 shadow-sm mb-6 sticky top-[84px] z-30">
          <button 
            onClick={() => setPlanningMode('browse')}
            className={cn(
              "flex-1 py-3 px-4 rounded-xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all",
              planningMode === 'browse' ? "bg-blue-600 text-white shadow-lg" : "text-gray-400"
            )}
          >
            <Search className="w-4 h-4" />
            {language === 'ar' ? 'البحث' : 'Browse'}
          </button>
          <button 
            onClick={() => setPlanningMode('optimize')}
            disabled={selectedItems.size === 0}
            className={cn(
              "flex-1 py-3 px-4 rounded-xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all",
              planningMode === 'optimize' ? "bg-blue-600 text-white shadow-lg" : "text-gray-400",
              selectedItems.size === 0 && "opacity-50 cursor-not-allowed"
            )}
          >
            <Sparkles className="w-4 h-4" />
            {language === 'ar' ? 'التحليل' : 'Analysis'}
          </button>
        </div>

        {/* Admin Bar */}
        {isAdmin && (
          <motion.div 
            initial={{ y: -20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="mb-8 bg-blue-900 text-white p-4 rounded-3xl flex flex-col md:flex-row items-center justify-between gap-4 shadow-xl shadow-blue-900/10"
          >
            <div className="flex items-center gap-3">
              <div className="bg-white/10 p-2 rounded-xl backdrop-blur-md border border-white/10">
                <Zap className="w-5 h-5 text-blue-300" />
              </div>
              <div>
                <p className="font-black text-xs uppercase tracking-widest">Management Override</p>
                <p className="text-[10px] text-blue-200">Catalog privileges active for this session</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button 
                onClick={() => setShowAddModal(true)}
                className="px-6 py-2.5 bg-white text-blue-900 rounded-xl font-black text-[10px] uppercase hover:bg-blue-50 transition-all shadow-sm"
              >
                + New Global Item
              </button>
              {showDeleteConfirm ? (
                <div className="flex items-center gap-2">
                  <button 
                    onClick={handleDeleteAllDatabase}
                    disabled={isSaving}
                    className="px-6 py-2.5 bg-red-500 text-white rounded-xl font-black text-[10px] uppercase hover:bg-red-600 transition-all shadow-sm border border-red-400 animate-pulse"
                  >
                    CONFIRM PURGE
                  </button>
                  <button 
                    onClick={() => setShowDeleteConfirm(false)}
                    disabled={isSaving}
                    className="px-4 py-2.5 bg-blue-800 text-white rounded-xl font-black text-[10px] uppercase hover:bg-blue-700 transition-all shadow-sm"
                  >
                    CANCEL
                  </button>
                </div>
              ) : (
                <button 
                  onClick={() => setShowDeleteConfirm(true)}
                  disabled={isSaving}
                  className="px-6 py-2.5 bg-blue-800/50 text-blue-100 rounded-xl font-black text-[10px] uppercase hover:bg-red-500 hover:text-white transition-all border border-white/10"
                >
                  {isSaving ? 'Deleting...' : 'FULL SYSTEM RESET'}
                </button>
              )}
            </div>
          </motion.div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-10 items-start">
          {/* Sidebar Area */}
          <aside className={cn(
            "lg:col-span-4 space-y-6 md:space-y-8 h-full",
            planningMode !== 'browse' && "hidden lg:block"
          )}>
            <div className="bg-white p-6 md:p-8 rounded-[32px] md:rounded-[40px] border border-gray-100 shadow-sm">
              <div className="flex items-center gap-3 mb-6 md:mb-8">
                <div className="w-1 h-5 md:w-1.5 md:h-6 bg-blue-600 rounded-full" />
                <h3 className="text-xs md:text-sm font-black text-gray-900 uppercase tracking-[0.2em]">{language === 'ar' ? 'الفئات' : 'Categories'}</h3>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {CATEGORIES.map(cat => (
                  <button
                    key={cat}
                    onClick={() => setActiveCategory(cat)}
                    className={cn(
                      "px-3 py-2.5 md:px-4 md:py-3 rounded-xl md:rounded-2xl text-[9px] md:text-[10px] font-black uppercase transition-all text-left border",
                      activeCategory === cat 
                        ? "bg-blue-600 text-white border-blue-600 shadow-lg shadow-blue-100" 
                        : "bg-gray-50 text-gray-500 border-transparent hover:bg-gray-100",
                      isRTL && "text-right"
                    )}
                  >
                    {t(cat as any)}
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-white p-6 md:p-8 rounded-[32px] md:rounded-[40px] border border-gray-100 shadow-sm flex-1 flex flex-col min-h-[400px] md:min-h-[500px]">
              <div className="flex items-center justify-between gap-4 mb-6 md:mb-8">
                <div className="flex items-center gap-3">
                  <div className="w-1.5 h-6 bg-green-500 rounded-full" />
                  <h3 className="text-sm font-black text-gray-900 uppercase tracking-[0.2em]">{language === 'ar' ? 'سجلات السوق' : 'Market Records'}</h3>
                </div>
                <div className="flex items-center gap-3">
                  <div className="bg-gray-100 px-3 py-1.5 rounded-xl text-[10px] font-black text-gray-400 uppercase">
                    {Object.keys(items).filter(k => items[k][0]?.category === activeCategory).length} {language === 'ar' ? 'أصناف' : 'Items'}
                  </div>
                  {userList.length > 0 && (
                    <button
                      onClick={syncFavorites}
                      className="flex items-center gap-2 group cursor-pointer"
                      title={language === 'ar' ? 'تحديد جميع المفضلات' : 'Select all favorite items'}
                    >
                      <div className={cn(
                        "w-8 h-4 rounded-full transition-all relative flex items-center px-0.5",
                        allStaplesInBasket ? "bg-blue-600" : "bg-gray-300"
                      )}>
                         <div className={cn(
                           "w-3 h-3 bg-white rounded-full transition-transform shadow-sm",
                           allStaplesInBasket ? "translate-x-4" : "translate-x-0"
                         )} />
                      </div>
                      <span className={cn(
                        "text-[9px] font-black uppercase tracking-wider transition-colors",
                        allStaplesInBasket ? "text-blue-600" : "text-gray-400 group-hover:text-gray-600"
                      )}>
                        {language === 'ar' ? 'المفضلات' : 'Staples'}
                      </span>
                    </button>
                  )}
                </div>
              </div>

              <div className="relative mb-6">
                <Search className={cn("absolute top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300", isRTL ? "right-4" : "left-4")} />
                <input
                  type="text"
                  placeholder={language === 'ar' ? 'تصفية السجلات...' : 'Filter local records...'}
                  value={searchTerm || ''}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className={cn(
                    "w-full py-3 bg-gray-50 border-none rounded-2xl text-xs font-bold focus:ring-2 focus:ring-blue-100 outline-none transition-all placeholder:text-gray-300",
                    isRTL ? "pr-11 pl-4" : "pl-11 pr-4"
                  )}
                />
              </div>

              <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
                {loading ? (
                  <div className="space-y-4 py-6">
                    {[1,2,3,4,5].map(i => <div key={i} className="h-20 bg-gray-50/50 animate-pulse rounded-3xl" />)}
                  </div>
                ) : (
                  <React.Fragment>
                    {Object.keys(items).filter(k => items[k][0]?.category === activeCategory).length === 0 ? (
                      <div className="py-20 text-center space-y-6">
                        <div className="w-20 h-20 bg-gray-50 rounded-[32px] flex items-center justify-center mx-auto transform rotate-3">
                          <ShoppingBag className="w-10 h-10 text-gray-200" />
                        </div>
                        <p className="text-gray-400 font-bold text-sm">{language === 'ar' ? 'لم يتم العثور على أصناف.' : 'No available records in this category.'}</p>
                      </div>
                    ) : (
                      Object.keys(items)
                        .filter(key => {
                          const categoryMatch = items[key][0]?.category === activeCategory;
                          if (!categoryMatch) return false;
                          
                          if (!searchTerm) return true;
                          const parts = key.toLowerCase().split('|');
                          const name = parts[0] || '';
                          const brand = parts[1] || '';
                          const s = searchTerm.toLowerCase().trim();
                          return name.includes(s) || brand.includes(s);
                        })
                        .map((nameKey, idx) => {
                          const [name, brand, size] = nameKey.split('|');
                          const isSelected = selectedItems.has(nameKey);
                          const variations = items[nameKey];
                          const best = variations.reduce((b, c) => c.price < b.price ? c : b);
                          const isFavorite = userList.some(f => 
                            f.name.toLowerCase().trim() === name.toLowerCase().trim() && 
                            (f.brand || '').toLowerCase().trim() === (brand || '').toLowerCase().trim() && 
                            (f.size || '').toLowerCase().trim() === (size || '').toLowerCase().trim()
                          );
                          
                          return (
                            <motion.div 
                              key={nameKey}
                              initial={{ opacity: 0, x: -10 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ delay: Math.min(idx * 0.05, 0.5) }}
                              className="group/item relative"
                            >
                              <div
                                onClick={() => toggleItem(nameKey)}
                                className={cn(
                                  "w-full flex items-center justify-between p-5 rounded-[28px] transition-all border text-left cursor-pointer",
                                  isSelected 
                                    ? "bg-blue-600 border-blue-600 text-white shadow-xl shadow-blue-100 ring-2 ring-blue-100 ring-offset-2" 
                                    : "bg-white border-gray-100 hover:border-blue-100 hover:bg-blue-50/10"
                                )}
                              >
                                <div className="flex items-center gap-4 min-w-0 flex-1 text-inherit">
                                  <div className={cn(
                                    "w-6 h-6 rounded-xl border-2 flex items-center justify-center transition-all flex-shrink-0",
                                    isSelected ? "bg-white border-white scale-110" : "border-gray-200 group-hover:border-blue-300"
                                  )}>
                                    {isSelected && <Check className="w-4 h-4 text-blue-600 stroke-[4px]" />}
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2 mb-1">
                                      <p className={cn("font-black capitalize text-base truncate", isSelected ? "text-white" : "text-gray-900")}>
                                        {name || (language === 'ar' ? 'صنف غير معروف' : 'Unnamed Item')}
                                      </p>
                                      {!isSelected && (
                                        <span className="text-[8px] font-black uppercase tracking-tighter text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-lg border border-blue-100">
                                          {t(best.category as any)}
                                        </span>
                                      )}
                                    </div>
                                    <div className={cn("flex flex-wrap items-center gap-2", isRTL && "flex-row-reverse")}>
                                      {best.storeName && (
                                        <>
                                          <p className={cn("text-[10px] font-black uppercase tracking-wider", isSelected ? "text-blue-100" : "text-blue-600")}>
                                            {best.storeName}
                                          </p>
                                          <span className={cn("w-1 h-1 rounded-full", isSelected ? "bg-white/20" : "bg-gray-200")} />
                                        </>
                                      )}
                                      {brand && (
                                        <>
                                          <p className={cn("text-[10px] font-black uppercase tracking-wider", isSelected ? "text-blue-100" : "text-gray-900")}>
                                            {brand}
                                          </p>
                                          <span className={cn("w-1 h-1 rounded-full", isSelected ? "bg-white/20" : "bg-gray-200")} />
                                        </>
                                      )}
                                      <p className={cn("text-[10px] font-black uppercase tracking-wider", isSelected ? "text-blue-100" : "text-gray-500 font-bold")}>
                                        {size}
                                      </p>
                                    </div>
                                  </div>
                                </div>
                                <div className="flex items-center gap-3 ml-4 flex-shrink-0">
                                  {isAdmin && (
                                    <div className="flex items-center gap-1 opacity-0 group-hover/item:opacity-100 transition-opacity">
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setEditingItemRecord(best);
                                          setNewItem(best);
                                          setShowAddModal(true);
                                        }}
                                        className={cn(
                                          "p-2 rounded-xl transition-all",
                                          isSelected ? "text-white hover:bg-white/20" : "text-blue-400 hover:bg-blue-50"
                                        )}
                                        title="Edit Record"
                                      >
                                        <Edit2 className="w-4 h-4" />
                                      </button>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          if (window.confirm("Delete this specific record from the database?")) {
                                            handleDeleteItemRecord(best.id!, nameKey);
                                          }
                                        }}
                                        className={cn(
                                          "p-2 rounded-xl transition-all",
                                          isSelected ? "text-white hover:bg-white/20" : "text-red-400 hover:bg-red-50"
                                        )}
                                        title="Delete Record"
                                      >
                                        <Trash2 className="w-4 h-4" />
                                      </button>
                                      <div className="w-[1px] h-4 bg-gray-200 mx-1" />
                                    </div>
                                  )}
                                  <button
                                    onClick={(e) => toggleFavorite(e, nameKey)}
                                    className={cn(
                                      "p-2 rounded-xl transition-all",
                                      isSelected ? "text-blue-200 hover:text-white" : "text-gray-200 hover:text-yellow-400 hover:bg-yellow-50"
                                    )}
                                  >
                                    <Star className={cn("w-4 h-4", isFavorite && "fill-current text-yellow-400")} />
                                  </button>
                                  <div className="text-right">
                                    <p className={cn("text-sm font-black tabular-nums", isSelected ? "text-white" : "text-blue-600")}>
                                      {formatCurrency(best.price)}
                                    </p>
                                    {variations.length > 1 && (
                                      <span className={cn("text-[8px] font-black uppercase", isSelected ? "text-blue-200" : "text-gray-300")}>
                                        {variations.length} {language === 'ar' ? 'عروض' : 'Sources'}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </motion.div>
                          );
                        })
                    )}
                  </React.Fragment>
                )}
              </div>
            </div>
          </aside>

          {/* Main Planning Desk */}
          <main className={cn(
            "lg:col-span-8 flex flex-col gap-6 md:gap-10",
            planningMode !== 'optimize' && "hidden lg:flex"
          )}>
          <AnimatePresence mode="wait">
            {selectedItems.size === 0 ?
              <motion.div 
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white rounded-[40px] md:rounded-[60px] p-10 md:p-16 text-center border border-gray-100 shadow-sm min-h-[500px] md:min-h-[700px] flex flex-col items-center justify-center"
              >
                <div className="w-32 h-32 md:w-48 md:h-48 bg-gray-50 rounded-[48px] md:rounded-[64px] flex items-center justify-center mb-8 md:mb-10 transform -rotate-3 hover:rotate-0 transition-transform duration-500">
                  <ShoppingBasket className="w-16 h-16 md:w-24 md:h-24 text-blue-200" />
                </div>
                <h2 className="text-3xl md:text-4xl font-black text-gray-900 mb-4 md:mb-6 tracking-tight">{t('buildList')}</h2>
                <p className="text-gray-400 max-w-sm mx-auto mb-8 md:mb-12 font-medium text-base md:text-lg leading-relaxed">
                  {t('selectItemsDesc')}
                </p>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-2xl">
                  <div className="bg-blue-50/50 p-8 rounded-[40px] text-left border border-blue-100 flex flex-col items-start gap-4 group hover:bg-blue-50 transition-colors">
                    <div className="bg-blue-600 p-3 rounded-2xl shadow-lg shadow-blue-200 group-hover:scale-110 transition-transform">
                      <Zap className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <h4 className="font-black text-blue-900 text-xs uppercase tracking-widest mb-2">Quantity Optimization</h4>
                      <p className="text-[10px] text-blue-700 font-bold opacity-60 leading-relaxed uppercase">Automatic analysis of quantity/value clusters for maximum savings.</p>
                    </div>
                  </div>
                  <div className="bg-green-50/50 p-8 rounded-[40px] text-left border border-green-100 flex flex-col items-start gap-4 group hover:bg-green-50 transition-colors">
                    <div className="bg-green-500 p-3 rounded-2xl shadow-lg shadow-green-200 group-hover:scale-110 transition-transform">
                      <ArrowRightLeft className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <h4 className="font-black text-green-900 text-xs uppercase tracking-widest mb-2">Substitute Logic</h4>
                      <p className="text-[10px] text-green-700 font-bold opacity-60 leading-relaxed uppercase">Smart brand-matching for quality parity at significantly lower prices.</p>
                    </div>
                  </div>
                </div>
              </motion.div>
            :
                <div className="space-y-6 md:space-y-10">
                  <AnimatePresence mode="popLayout">
                    {basketOptimization && basketOptimization.length > 0 && (
                      <div className="flex flex-col gap-8 md:gap-10">
                        {/* Analysis Header */}
                        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-3">
                              <h2 className="text-3xl md:text-5xl font-black text-gray-900 tracking-tighter">{t('savingsAnalysis')}</h2>
                              <div className="bg-blue-600 text-white px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest">{language === 'ar' ? 'مباشر' : 'Live'}</div>
                            </div>
                            
                            {/* Summary Stats Overview for Mobile */}
                            <div className="grid grid-cols-2 md:flex md:items-center gap-2 md:gap-4 mb-6">
                              <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex-1 md:flex-none md:min-w-[140px]">
                                <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1">{language === 'ar' ? 'الأصناف' : 'Items'}</p>
                                <p className="text-xl font-black text-gray-900">{selectedItems.size}</p>
                              </div>
                              <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex-1 md:flex-none md:min-w-[140px]">
                                <p className="text-[9px] font-black text-green-500 uppercase tracking-widest mb-1">{language === 'ar' ? 'التوفير المتوقع' : 'Potential Savings'}</p>
                                <p className="text-xl font-black text-green-600">+{formatCurrency((savingsAnalysis?.totalSavings || 0) + sessionSavings)}</p>
                              </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-4">
                              <div className="bg-gray-100 p-1.5 rounded-2xl border border-gray-200/50 flex items-center">
                                <button 
                                  onClick={() => setAllowSwaps(false)}
                                  className={cn(
                                    "px-4 py-2 rounded-xl text-[10px] font-black uppercase transition-all tracking-widest",
                                    !allowSwaps ? "bg-white text-blue-600 shadow-md" : "text-gray-400 hover:text-gray-600"
                                  )}
                                >
                                  {language === 'ar' ? 'نفس العلامة' : 'Fixed Brand'}
                                </button>
                                <button 
                                  onClick={() => setAllowSwaps(true)}
                                  className={cn(
                                    "px-4 py-2 rounded-xl text-[10px] font-black uppercase transition-all tracking-widest",
                                    allowSwaps ? "bg-white text-blue-600 shadow-md" : "text-gray-400 hover:text-gray-600"
                                  )}
                                >
                                  {language === 'ar' ? 'أذكى بديل' : 'Smart Swap'}
                                </button>
                              </div>
                            </div>
                          </div>

                          {totalBasketBudget > 0 && (
                            <div className="bg-orange-50 px-6 md:px-8 py-5 md:py-6 rounded-[24px] md:rounded-[32px] border border-orange-100 min-w-[200px] md:min-w-[240px] shadow-sm">
                              <div className="flex items-center justify-between mb-2 md:mb-3 text-[9px] md:text-[10px] font-black text-orange-400 uppercase tracking-widest">
                                <span>{basketCategories.length > 1 ? 'Total Basket Budget' : 'Budget Goal'}</span>
                              </div>
                              <div className="h-2 md:h-2.5 bg-orange-100 rounded-full overflow-hidden mb-2 md:mb-3">
                                <motion.div 
                                  initial={{ width: 0 }}
                                  animate={{ width: `${Math.min(100, (basketOptimization[0].total / totalBasketBudget) * 100)}%` }}
                                  className={cn(
                                    "h-full transition-all duration-500",
                                    basketOptimization[0].total > totalBasketBudget ? "bg-red-500" : "bg-orange-500"
                                  )}
                                />
                              </div>
                              <p className="text-base md:text-lg font-black text-orange-900">
                                {formatCurrency(basketOptimization[0].total)} <span className="opacity-30">/</span> {formatCurrency(totalBasketBudget)}
                              </p>
                            </div>
                          )}
                        </div>

                        {/* Optimal Market Strategy Console */}
                        <motion.div 
                          layout
                          initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          className={cn(
                            "rounded-[56px] p-8 md:p-14 relative overflow-hidden transition-all duration-500 border shadow-2xl",
                            basketOptimization[0].total > (totalBasketBudget || Infinity)
                              ? "bg-red-900 border-red-800 text-white"
                              : "bg-white border-gray-100 text-gray-900"
                          )}
                        >
                          <div className="relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-10 xl:gap-16 items-start">
                            <div className="lg:col-span-7 space-y-8 md:space-y-10">
                              <div className="flex flex-col md:flex-row md:items-start gap-6 md:gap-8">
                                <motion.div 
                                  animate={{ 
                                    rotate: basketOptimization[0].total > (totalBasketBudget || Infinity) ? [0, -5, 5, 0] : 0 
                                  }}
                                  transition={{ repeat: Infinity, duration: 2 }}
                                  className={cn(
                                    "w-16 h-16 md:w-20 md:h-20 rounded-[28px] md:rounded-[32px] flex items-center justify-center shadow-2xl transform rotate-6 flex-shrink-0",
                                    basketOptimization[0].total > (totalBasketBudget || Infinity)
                                      ? "bg-red-800 text-white shadow-red-950/20"
                                      : "bg-blue-600 text-white shadow-blue-100"
                                  )}
                                >
                                  {totalBasketBudget > 0 && basketOptimization[0].total > totalBasketBudget ? <AlertCircle className="w-10 h-10 md:w-12 md:h-12" /> : <Sparkles className="w-10 h-10 md:w-12 md:h-12" />}
                                </motion.div>
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-3 md:gap-4 mb-3">
                                    <h3 className={cn(
                                      "font-black tracking-tight leading-none break-words",
                                      basketOptimization[0].storeName.length > 12 ? "text-3xl md:text-5xl" : "text-4xl md:text-6xl"
                                    )}>
                                      {basketOptimization[0].storeName}
                                    </h3>
                                    <div className="bg-green-500 text-white px-3 py-1.5 rounded-full text-[9px] font-black uppercase tracking-[0.2em] shadow-lg shadow-green-500/20 h-fit">
                                      {language === 'ar' ? 'أفضل مطابقة' : 'Best Match'}
                                    </div>
                                  </div>
                                  <div className="flex flex-wrap items-center gap-3 text-[10px] md:text-[11px] font-bold text-gray-400 uppercase tracking-[0.15em]">
                                    <div className="flex items-center gap-1.5">
                                      <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" />
                                      <span>{basketOptimization[0].isGlobal ? "Global Survey" : "Verified Market Price"}</span>
                                    </div>
                                    <div className="w-1 h-1 bg-gray-200 rounded-full hidden md:block" />
                                    <span>{basketOptimization[0].coveredItems} Items Optimized</span>
                                  </div>
                                </div>
                              </div>

                              <p className={cn(
                                "text-base md:text-xl font-medium leading-relaxed max-w-2xl",
                                basketOptimization[0].total > (totalBasketBudget || Infinity) ? "text-red-100/80" : "text-gray-500"
                              )}>
                                {totalBasketBudget > 0 && basketOptimization[0].total > totalBasketBudget 
                                  ? (language === 'ar' 
                                      ? "هذا المتجر هو الأفضل سعراً، لكن سلتك تجاوزت الميزانية المحددة." 
                                      : "Top price match found, but your selection currently exceeds your budget limits.")
                                  : (language === 'ar'
                                      ? "تم العثور على أفضل تطابق! هذا المتجر يوفر لك أكبر قدر من التوفير لسلتك الحالية."
                                      : "Optimal match found! This location offers the deepest savings for your specific basket.")
                                }
                              </p>
                              
                              <div className="flex flex-wrap gap-4 md:gap-5 pt-2 md:pt-4">
                                <button 
                                  onClick={() => {
                                    setIsSaving(true);
                                    recordStoreSelection(basketOptimization[0].storeName, basketOptimization[0].total, basketOptimization[0].coveredItems)
                                      .finally(() => setIsSaving(false));
                                  }}
                                  disabled={isSaving || selectedStore === basketOptimization[0].storeName}
                                  className={cn(
                                    "px-8 md:px-12 py-4 md:py-6 rounded-[28px] md:rounded-[32px] font-black text-xs md:text-sm uppercase tracking-[0.2em] transition-all shadow-2xl active:scale-95 flex items-center justify-center gap-3 md:gap-4 disabled:opacity-50 min-w-full md:min-w-[280px]",
                                    basketOptimization[0].total > (totalBasketBudget || Infinity)
                                      ? "bg-white text-red-900 shadow-red-950/20 hover:bg-red-50"
                                      : "bg-blue-600 text-white shadow-blue-200 hover:bg-blue-700"
                                  )}
                                >
                                  {isSaving ? (
                                    <RefreshCw className="w-5 h-5 md:w-6 md:h-6 animate-spin" />
                                  ) : selectedStore === basketOptimization[0].storeName ? (
                                      <>
                                        <Check className="w-5 h-5 md:w-6 md:h-6 stroke-[4px]" />
                                        {language === 'ar' ? 'تم الاختيار' : 'Confirmed'}
                                      </>
                                  ) : (
                                      <>
                                        <ShoppingCart className="w-5 h-5 md:w-6 md:h-6 flex-shrink-0" />
                                        {language === 'ar' ? 'تأكيد الخطة' : 'Confirm Strategy'}
                                      </>
                                  )}
                                </button>
                                
                                {totalBasketBudget > 0 && basketOptimization[0].total > totalBasketBudget && (
                                  <div className="flex items-center gap-3 md:gap-4 px-6 md:px-8 py-3 md:py-4 bg-red-950/20 rounded-[28px] md:rounded-[32px] border border-red-800/50">
                                    <AlertCircle className="w-4 h-4 md:w-5 md:h-5 text-red-400" />
                                    <span className="text-[9px] md:text-[10px] font-black uppercase tracking-[0.2em]">Budget Overlimit</span>
                                  </div>
                                )}
                              </div>
                            </div>

                            <div className="lg:col-span-5 w-full">
                              <div className={cn(
                                "bg-gray-50/50 backdrop-blur-xl p-6 md:p-10 rounded-[40px] md:rounded-[56px] border border-gray-100 shadow-inner group transition-all",
                                basketOptimization[0].total > (totalBasketBudget || Infinity) && "bg-red-950/20 border-red-800/30"
                              )}>
                                <div className="flex justify-between items-center mb-8 md:mb-10">
                                  <div className="flex items-center gap-3">
                                    <div className="w-1 h-5 md:w-1.5 md:h-6 bg-green-500 rounded-full" />
                                    <p className="text-[10px] md:text-[11px] font-black text-gray-400 uppercase tracking-[0.2em]">Savings Analysis</p>
                                  </div>
                                  <TrendingDown className="w-4 h-4 md:w-5 md:h-5 text-green-500" />
                                </div>
                                
                                <div className="space-y-6 md:space-y-8">
                                  {savingsAnalysis?.items.slice(0, 3).map((item: any, idx: number) => (
                                    <motion.div 
                                      key={idx}
                                      initial={{ opacity: 0, x: 20 }}
                                      animate={{ opacity: 1, x: 0 }}
                                      transition={{ delay: idx * 0.1 }}
                                      className="flex flex-col gap-1.5 md:gap-2 border-b border-gray-100/50 pb-5 md:pb-6 last:border-0 last:pb-0"
                                    >
                                      <div className="flex justify-between items-start gap-4">
                                        <div className="min-w-0 flex-1">
                                          <p className="text-sm md:text-base font-black text-gray-900 capitalize truncate mb-0.5 md:mb-1">{item.name}</p>
                                          <p className="text-[9px] md:text-[10px] font-black text-gray-400 uppercase tracking-widest truncate">{item.brand} • {item.size}</p>
                                        </div>
                                        <div className="text-right flex-shrink-0">
                                          <p className="text-sm md:text-base font-black text-blue-600 tabular-nums mb-0.5 md:mb-1">{formatCurrency(item.bestPrice)}</p>
                                          <div className="flex flex-col items-end gap-0.5 md:gap-1">
                                            <span className="text-[9px] md:text-[10px] font-bold text-gray-400 line-through tabular-nums opacity-60">Avg {formatCurrency(item.avgPrice)}</span>
                                            {item.savings > 0 && <span className="text-[9px] md:text-[10px] font-black text-green-600 uppercase tracking-tighter">Save {formatCurrency(item.savings)}</span>}
                                          </div>
                                        </div>
                                      </div>
                                    </motion.div>
                                  ))}
                                  {savingsAnalysis?.items.length > 3 && (
                                      <div className="pt-2 flex items-center gap-2 md:gap-3">
                                        <div className="h-[1px] flex-1 bg-gray-100" />
                                        <p className="text-[9px] md:text-[10px] font-black text-blue-400 uppercase tracking-widest px-2 md:px-4">
                                          +{savingsAnalysis.items.length - 3} More
                                        </p>
                                        <div className="h-[1px] flex-1 bg-gray-100" />
                                      </div>
                                  )}
                                </div>

                                <div className="pt-8 md:pt-10 mt-6 md:mt-8 border-t border-gray-100 flex items-end justify-between gap-4">
                                  <div className="min-w-0">
                                    <span className="text-[9px] md:text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1 truncate">Trip Subtotal</span>
                                    <span className={cn(
                                        "text-3xl md:text-5xl font-black tabular-nums tracking-tighter block truncate",
                                        basketOptimization[0].total > (totalBasketBudget || Infinity) ? "text-white" : "text-gray-900"
                                    )}>{formatCurrency(basketOptimization[0].total)}</span>
                                  </div>
                                  <div className="text-right flex-shrink-0">
                                    <div className="bg-green-100 text-green-700 px-3 md:px-4 py-1.5 md:py-2 rounded-xl md:rounded-2xl mb-2 inline-block">
                                      <span className="text-[9px] md:text-[10px] font-black uppercase tracking-widest block mb-0.5">Market Gain</span>
                                      <span className="text-lg md:text-xl font-black tabular-nums">-{formatCurrency(savingsAnalysis?.totalSavings || 0)}</span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                          
                          {/* Subtler Background Glow */}
                          <div className={cn(
                            "absolute bottom-[-150px] left-[-150px] w-[600px] h-[600px] rounded-full blur-[150px] opacity-[0.04] pointer-events-none",
                            basketOptimization[0].total > (totalBasketBudget || Infinity) ? "bg-red-500" : "bg-blue-500"
                          )} />
                        </motion.div>

                      </div>
                    )}
                  </AnimatePresence>
                
                {/* Suggestions Section */}
                {budgetSuggestions.length > 0 && (
                  <motion.div 
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-orange-50/70 rounded-[56px] p-10 md:p-14 border border-orange-100/50 backdrop-blur-sm"
                  >
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-10">
                      <div className="flex items-center gap-4">
                        <div className="bg-orange-600 p-3.5 rounded-2xl shadow-xl shadow-orange-200">
                          <Zap className="w-8 h-8 text-white" />
                        </div>
                        <div>
                          <h4 className="text-2xl font-black text-orange-950 leading-none mb-1">{t('cheaperAlternatives')}</h4>
                          <p className="text-sm font-bold text-orange-700/60 uppercase tracking-widest">{language === 'ar' ? 'اقتراحات ذكية بناءً على سلتك' : 'Smart insights based on your selection'}</p>
                        </div>
                      </div>
                      <div className="bg-white/50 px-6 py-3 rounded-2xl border border-orange-200">
                        <p className="text-[10px] font-black text-orange-400 uppercase tracking-widest mb-0.5">Potential Savings</p>
                        <p className="text-xl font-black text-orange-900 line-clamp-1">
                          {formatCurrency(budgetSuggestions.reduce((acc, curr) => acc + (curr.currentPrice - curr.suggestion.price), 0))}
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      {budgetSuggestions.map((rec, i) => {
                        const isAlreadyFavorite = userList.some(fav => 
                          `${fav.name.toLowerCase()}|${fav.brand.toLowerCase()}|${fav.size.toLowerCase()}` === rec.suggestion.key
                        );
                        const savingAmount = rec.currentPrice - rec.suggestion.price;

                        return (
                          <motion.div 
                            key={i}
                            whileHover={{ y: -5 }}
                            className="bg-white p-8 rounded-[40px] border border-orange-100 shadow-sm flex flex-col justify-between group h-full"
                          >
                            <div>
                              <div className="flex items-center justify-between mb-6">
                                <span className={cn(
                                  "px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest",
                                  rec.type === 'bulk' ? "bg-blue-100 text-blue-600" : "bg-orange-100 text-orange-600"
                                )}>
                                  {rec.type === 'bulk' ? 'Best Value Upgrade' : 'Cheaper Swap'}
                                </span>
                                {savingAmount > 0 && (
                                  <span className="text-[10px] font-black text-green-500 flex items-center gap-1">
                                    <TrendingDown className="w-3 h-3" />
                                    Save {formatCurrency(savingAmount)}
                                  </span>
                                )}
                              </div>

                              <h5 className="text-lg font-black text-gray-900 capitalize mb-2 leading-tight">
                                {rec.suggestion.brand} {rec.suggestion.name}
                              </h5>
                              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter mb-6">
                                Size: {rec.suggestion.size} • Replacing {rec.targetDisplay}
                              </p>
                              
                              <div className="flex items-center gap-4 mb-8">
                                <div className="flex-1">
                                  <p className="text-[8px] font-black text-gray-300 uppercase mb-1">Was</p>
                                  <p className="text-lg font-bold text-gray-300 line-through tabular-nums leading-none">
                                    {formatCurrency(rec.currentPrice)}
                                  </p>
                                </div>
                                <div className="w-8 h-8 bg-gray-50 rounded-full flex items-center justify-center">
                                  <ArrowRight className="w-4 h-4 text-gray-200" />
                                </div>
                                <div className="flex-1 text-right">
                                  <p className="text-[8px] font-black text-green-400 uppercase mb-1">Now</p>
                                  <p className="text-2xl font-black text-green-600 tabular-nums leading-none">
                                    {formatCurrency(rec.suggestion.price)}
                                  </p>
                                </div>
                              </div>
                            </div>
                            
                            <div className="space-y-3 mt-auto">
                              <button 
                                onClick={() => {
                                  let saving = 0;
                                  if (rec.type === 'bulk' && rec.currentUnitPrice && rec.suggestion.unitPrice && rec.suggestion.sizeValue) {
                                    saving = (rec.currentUnitPrice - rec.suggestion.unitPrice) * rec.suggestion.sizeValue;
                                  } else if (rec.currentPrice > rec.suggestion.price) {
                                    saving = rec.currentPrice - rec.suggestion.price;
                                  }
                                  swapItem(rec.target, rec.suggestion.key, Math.max(0, saving));
                                }}
                                className={cn(
                                  "w-full py-4 rounded-[20px] text-xs font-black uppercase tracking-widest transition-all shadow-lg active:scale-95 flex items-center justify-center gap-2",
                                  rec.type === 'bulk' ? "bg-blue-600 text-white shadow-blue-100 hover:bg-blue-700" : "bg-orange-600 text-white shadow-orange-100 hover:bg-orange-700"
                                )}
                              >
                                <RefreshCw className="w-4 h-4" />
                                {rec.type === 'bulk' ? 'Select Upgrade' : 'Accept Swap'}
                              </button>
                                
                              <button 
                                onClick={() => !isAlreadyFavorite && saveSuggestion({
                                  name: rec.suggestion.name,
                                  brand: rec.suggestion.brand,
                                  size: rec.suggestion.size,
                                  category: rec.suggestion.category
                                })}
                                disabled={isAlreadyFavorite}
                                className={cn(
                                  "w-full py-4 rounded-[20px] text-xs font-black uppercase tracking-widest transition-all",
                                  isAlreadyFavorite 
                                    ? "bg-green-50 text-green-600 border border-green-100" 
                                    : "bg-white text-gray-400 border border-gray-100 hover:border-orange-200 hover:bg-orange-50 hover:text-orange-600"
                                )}
                              >
                                {isAlreadyFavorite ? (
                                  <><Check className="w-4 h-4" /> {language === 'ar' ? 'محفوظ للمستقبل' : 'Saved to Favorites'}</>
                                ) : (
                                  <><Star className="w-4 h-4" /> {language === 'ar' ? 'حفظ للمستقبل' : 'Save for Next'}</>
                                )}
                              </button>
                            </div>
                          </motion.div>
                        );
                      })}
                    </div>
                  </motion.div>
                )}

                {/* Other Stores Comparison */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {basketOptimization.slice(1, 5).map((result, idx) => (
                    <motion.div
                      key={result.storeName}
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: idx * 0.1 }}
                      className="bg-white p-8 rounded-[40px] border border-gray-100 shadow-sm flex flex-col justify-between"
                    >
                      <div className="flex items-center justify-between mb-8">
                        <div className="flex items-center gap-4">
                          <div className="bg-gray-50 p-4 rounded-2xl">
                            <Store className="w-6 h-6 text-gray-400" />
                          </div>
                          <div>
                            <h4 className="text-2xl font-black text-gray-900">{result.storeName}</h4>
                            <p className="text-xs font-bold text-gray-400">Covers {result.coveredItems}/{selectedItems.size} items</p>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-end justify-between">
                        <div>
                          <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Total Trip Cost</p>
                          <p className="text-3xl font-black text-gray-900">{formatCurrency(result.total)}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] font-black text-red-500 uppercase mb-1">Difference</p>
                          <p className="text-xl font-bold text-red-600">+{formatCurrency(result.total - basketOptimization[0].total)}</p>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            }
            </AnimatePresence>

          {/* User's Saved List Section */}
          <AnimatePresence>
            {userList.length > 0 && (
              <motion.div 
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                className={cn(
                  "bg-white rounded-[40px] md:rounded-[56px] p-8 md:p-14 border border-gray-100 shadow-2xl shadow-blue-100/20",
                  planningMode !== 'browse' && "hidden lg:block"
                )}
              >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-12">
                  <div>
                    <h3 className="text-3xl font-black text-gray-900 mb-1">{language === 'ar' ? 'أصنافك المفضلة' : 'Your Shopping Staples'}</h3>
                    <p className="text-sm font-bold text-gray-400 uppercase tracking-widest">{language === 'ar' ? 'أصناف تم تتبعها لزياراتك القادمة' : 'Items tracked for your future market visits'}</p>
                  </div>
                  <div className="bg-blue-50 px-6 py-3 rounded-2xl border border-blue-100">
                    <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest mb-0.5">Staples Count</p>
                    <p className="text-2xl font-black text-blue-600">{userList.length}</p>
                  </div>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {userList.map((item, idx) => (
                    <motion.div 
                      key={item.id} 
                      whileHover={{ scale: 1.02 }}
                      className="bg-gray-50/50 p-6 rounded-[32px] border border-gray-100 flex items-center justify-between group transition-all hover:bg-white hover:shadow-xl hover:shadow-blue-100/20"
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-white rounded-2xl shadow-sm flex items-center justify-center text-blue-200 group-hover:text-blue-500 transition-colors">
                          <Star className="w-6 h-6 fill-current" />
                        </div>
                        <div>
                          <p className="font-black text-gray-900 capitalize text-sm leading-tight">{item.name}</p>
                          <p className="text-[9px] text-gray-400 font-bold uppercase tracking-wider">{t(item.category as any)} • {item.brand}</p>
                        </div>
                      </div>
                      <button 
                        onClick={() => item.id && deleteFromList(item.id)}
                        className="p-3 text-red-100 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all md:opacity-0 group-hover:opacity-100"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>
    </div>

      {/* Floating Selection Bar for Mobile */}
      {selectedItems.size > 0 && planningMode === 'browse' && (
        <motion.div 
          initial={{ y: 100 }}
          animate={{ y: 0 }}
          className="lg:hidden fixed bottom-18 left-6 right-6 z-50 pointer-events-none"
        >
          <div className="bg-blue-600 p-4 rounded-3xl shadow-2xl shadow-blue-900/20 border border-blue-500 flex items-center justify-between pointer-events-auto">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                <ShoppingBag className="w-5 h-5 text-white" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-black text-white/70 uppercase tracking-widest font-mono line-clamp-1">Basket</p>
                <p className="text-sm font-black text-white truncate">{selectedItems.size} {language === 'ar' ? 'أصناف مختارة' : 'Items Selected'}</p>
              </div>
            </div>
            <button 
              onClick={() => setPlanningMode('optimize')}
              className="bg-white text-blue-600 px-6 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest shadow-xl shadow-blue-900/10 active:scale-95 transition-transform flex-shrink-0"
            >
              {language === 'ar' ? 'المتابعة' : 'Analyze Now'}
            </button>
          </div>
        </motion.div>
      )}

      {showAddModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-[40px] w-full max-w-xl p-8 shadow-2xl"
          >
            <div className="flex items-center justify-between mb-8">
              <h3 className="text-3xl font-black text-gray-900">{editingItemRecord ? 'Edit Record' : 'Add Scanned Item'}</h3>
              <button 
                onClick={() => {
                  setShowAddModal(false);
                  setEditingItemRecord(null);
                  setNewItem({
                    name: '',
                    brand: '',
                    size: '',
                    price: 0,
                    storeName: '',
                    category: activeCategory,
                    quantity: 1
                  });
                }}
                className="p-2 hover:bg-gray-100 rounded-full transition-colors"
              >
                <X className="w-6 h-6 text-gray-400" />
              </button>
            </div>

            <form onSubmit={handleManualAdd} className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-black text-gray-400 uppercase ml-1">Item Name</label>
                  <input 
                    required
                    value={newItem.name || ''}
                    onChange={e => setNewItem({...newItem, name: e.target.value})}
                    placeholder="e.g. Rice" 
                    className="w-full p-4 bg-gray-50 rounded-2xl border-none outline-none focus:ring-2 focus:ring-blue-100"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black text-gray-400 uppercase ml-1">Brand</label>
                  <input 
                    value={newItem.brand || ''}
                    onChange={e => setNewItem({...newItem, brand: e.target.value})}
                    placeholder="e.g. Sunwhite" 
                    className="w-full p-4 bg-gray-50 rounded-2xl border-none outline-none focus:ring-2 focus:ring-blue-100"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black text-gray-400 uppercase ml-1">Subcategory</label>
                  <input 
                    value={newItem.subcategory || ''}
                    onChange={e => setNewItem({...newItem, subcategory: e.target.value})}
                    placeholder="e.g. Bread, Milk" 
                    className="w-full p-4 bg-gray-50 rounded-2xl border-none outline-none focus:ring-2 focus:ring-blue-100"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-black text-gray-400 uppercase ml-1">Size</label>
                  <input 
                    required
                    value={newItem.size || ''}
                    onChange={e => setNewItem({...newItem, size: e.target.value})}
                    placeholder="e.g. 5kg" 
                    className="w-full p-4 bg-gray-50 rounded-2xl border-none outline-none focus:ring-2 focus:ring-blue-100"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black text-gray-400 uppercase ml-1">Price</label>
                  <input 
                    required
                    type="number"
                    step="0.01"
                    value={newItem.price || ''}
                    onChange={e => {
                      const val = e.target.value;
                      setNewItem({...newItem, price: val === '' ? 0 : parseFloat(val)});
                    }}
                    placeholder="0.00" 
                    className="w-full p-4 bg-gray-50 rounded-2xl border-none outline-none focus:ring-2 focus:ring-blue-100"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-black text-gray-400 uppercase ml-1">Store Name</label>
                <input 
                  required
                  value={newItem.storeName || ''}
                  onChange={e => setNewItem({...newItem, storeName: e.target.value})}
                  placeholder="e.g. Khater Market" 
                  className="w-full p-4 bg-gray-50 rounded-2xl border-none outline-none focus:ring-2 focus:ring-blue-100"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-black text-gray-400 uppercase ml-1">Category</label>
                <select 
                  value={newItem.category || activeCategory}
                  onChange={e => setNewItem({...newItem, category: e.target.value as Category})}
                  className="w-full p-4 bg-gray-50 rounded-2xl border-none outline-none focus:ring-2 focus:ring-blue-100 appearance-none"
                >
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              <div className="flex gap-4 pt-4">
                <button 
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 py-4 bg-gray-100 text-gray-500 font-black rounded-2xl hover:bg-gray-200 transition-all"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  className="flex-[2] py-4 bg-blue-600 text-white font-black rounded-2xl shadow-xl shadow-blue-100 hover:bg-blue-700 transition-all"
                >
                  {editingItemRecord ? 'Save Changes' : 'Add Record'}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
};

