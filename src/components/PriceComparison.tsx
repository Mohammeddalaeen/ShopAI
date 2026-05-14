import React, { useState, useEffect } from 'react';
import { Search, MapPin, TrendingDown, Store, Tag, ArrowRight, ChevronRight, Filter, Edit2, Save, X, Trash2 } from 'lucide-react';
import { collection, query, where, getDocs, orderBy, limit, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { InvoiceItem, CATEGORIES, Category } from '../types';
import { cn, formatCurrency } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../context/AuthContext';

const SUGGESTIONS_BY_CAT: Record<string, string[]> = {
  'Groceries': ['Milk', 'Fresh Eggs', 'Bread', 'Organic Bananas', 'Chicken Breast'],
  'Cleaning Products': ['Laundry Detergent', 'Dish Soap', 'Surface Cleaner', 'Paper Towels'],
  'Electronics': ['AA Batteries', 'USB-C Cable', 'LED Bulb'],
  'Health & Beauty': ['Shampoo', 'Toothpaste', 'Hand Soap'],
};

export const PriceComparison: React.FC = () => {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [searchTerm, setSearchTerm] = useState('');
  const [results, setResults] = useState<InvoiceItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string>('Groceries');
  const [categoryLeader, setCategoryLeader] = useState<{ storeName: string, avgPrice: number, itemsCount: number } | null>(null);
  const [fetchingLeader, setFetchingLeader] = useState(false);

  // Edit states
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Partial<InvoiceItem>>({});
  const [savingEdit, setSavingEdit] = useState(false);

  const handleDeleteItem = async (id: string) => {
    if (!window.confirm("Are you sure you want to delete this community record? This cannot be undone.")) return;
    try {
      await deleteDoc(doc(db, 'items', id));
      setResults(prev => prev.filter(item => item.id !== id));
      setEditingItemId(null);
    } catch (err) {
      console.error("Failed to delete item", err);
    }
  };

  const startEditing = (item: InvoiceItem) => {
    if (!item.id) return;
    setEditingItemId(item.id);
    setEditValues({
      name: item.name,
      price: item.price,
      brand: item.brand,
      size: item.size,
      category: item.category
    });
  };

  const handleSaveEdit = async (id: string) => {
    setSavingEdit(true);
    try {
      await updateDoc(doc(db, 'items', id), editValues);
      setResults(prev => prev.map(item => item.id === id ? { ...item, ...editValues } : item));
      setEditingItemId(null);
    } catch (err) {
      console.error("Failed to update item", err);
    } finally {
      setSavingEdit(false);
    }
  };

  useEffect(() => {
    const fetchCategoryLeader = async () => {
      setFetchingLeader(true);
      try {
        const itemsQuery = query(
          collection(db, 'items'),
          where('category', '==', activeCategory),
          orderBy('date', 'desc'),
          limit(200)
        );
        const snap = await getDocs(itemsQuery);
        const items = snap.docs.map(d => d.data() as InvoiceItem);

        if (items.length === 0) {
          setCategoryLeader(null);
          return;
        }

        const shopStats = items.reduce((acc: any, item) => {
          if (!acc[item.storeName]) acc[item.storeName] = { total: 0, count: 0, uniqueBrands: new Set() };
          acc[item.storeName].total += item.price;
          acc[item.storeName].count += 1;
          if (item.brand) acc[item.storeName].uniqueBrands.add(item.brand);
          return acc;
        }, {});

        const leaders = Object.keys(shopStats).map(storeName => ({
          storeName,
          avgPrice: shopStats[storeName].total / shopStats[storeName].count,
          itemsCount: shopStats[storeName].count,
          variety: shopStats[storeName].uniqueBrands.size
        })).sort((a, b) => a.avgPrice - b.avgPrice);

        setCategoryLeader(leaders[0] || null);
      } catch (err) {
        console.error(err);
      } finally {
        setFetchingLeader(false);
      }
    };

    fetchCategoryLeader();
  }, [activeCategory]);

  const handleSearch = async (term: string) => {
    if (!term.trim()) return;
    setLoading(true);
    setSearchTerm(term);
    
    try {
      const itemsQuery = query(
        collection(db, 'items'),
        orderBy('date', 'desc'),
        limit(500)
      );
      
      const snap = await getDocs(itemsQuery);
      const allItems = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as InvoiceItem));
      
      const filtered = allItems.filter(item => 
        item.name.toLowerCase().includes(term.toLowerCase())
      );
      
      const grouped = filtered.reduce((acc: any, item) => {
        if (!acc[item.storeName] || acc[item.storeName].price > item.price) {
          acc[item.storeName] = item;
        }
        return acc;
      }, {});

      setResults(Object.values(grouped).sort((a: any, b: any) => a.price - b.price));
    } catch (error) {
      console.error("Search failed", error);
    } finally {
      setLoading(false);
    }
  };

  const bestPrice = results.length > 0 ? results[0] : null;

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold text-gray-900 mb-2">Price Intelligence</h2>
          <p className="text-gray-500">Live price comparison from the SmartShop community.</p>
        </div>
      </div>

      {/* Search Section */}
      <div className="bg-white p-6 md:p-10 rounded-[40px] shadow-sm border border-gray-100">
        <div className="relative group mb-8">
          <div className="absolute inset-y-0 left-6 flex items-center pointer-events-none">
            <Search className="w-6 h-6 text-gray-400 group-focus-within:text-blue-600 transition-colors" />
          </div>
          <input
            type="text"
            value={searchTerm || ''}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch(searchTerm)}
            placeholder="Search for an item (e.g. Milk, Bananas)..."
            className="w-full bg-gray-50 border border-transparent pl-16 pr-6 py-6 rounded-[24px] text-xl font-medium focus:outline-none focus:bg-white focus:ring-4 focus:ring-blue-50 focus:border-blue-200 transition-all"
          />
          <button 
            onClick={() => handleSearch(searchTerm)}
            className="absolute right-3 top-3 bottom-3 px-8 bg-blue-600 hover:bg-blue-700 text-white rounded-[18px] font-bold transition-all shadow-md shadow-blue-100"
          >
            Search
          </button>
        </div>

        {/* Categorized Suggestions */}
        <div className="space-y-6">
          <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
            {Object.keys(SUGGESTIONS_BY_CAT).map(cat => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={cn(
                  "px-5 py-2 rounded-full text-sm font-bold whitespace-nowrap transition-all",
                  activeCategory === cat 
                    ? "bg-blue-600 text-white shadow-lg shadow-blue-100" 
                    : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                )}
              >
                {cat}
              </button>
            ))}
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-center">
            <div className="md:col-span-2 flex flex-wrap gap-3">
              {SUGGESTIONS_BY_CAT[activeCategory].map((s) => (
                <button
                  key={s}
                  onClick={() => handleSearch(s)}
                  className="group flex items-center gap-2 px-4 py-2 bg-white border border-gray-100 text-gray-700 text-sm font-semibold rounded-2xl hover:border-blue-200 hover:text-blue-600 hover:bg-blue-50/30 transition-all"
                >
                  {s}
                  <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-blue-400 transition-colors" />
                </button>
              ))}
            </div>

            <AnimatePresence mode="wait">
              {categoryLeader && !fetchingLeader && (
                <motion.div
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="bg-gradient-to-br from-blue-600 to-indigo-700 p-6 rounded-3xl text-white shadow-xl shadow-blue-100 relative overflow-hidden"
                >
                  <div className="relative z-10">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-100 mb-1">Recommended for {activeCategory}</p>
                    <h4 className="text-xl font-black mb-2 truncate">{categoryLeader.storeName}</h4>
                    <p className="text-[10px] text-blue-200 mb-4 font-bold border-l-2 border-blue-400 pl-2">
                      Based on {categoryLeader.itemsCount} scanned items across {categoryLeader.variety || 1} brands.
                    </p>
                    <div className="flex items-end justify-between">
                      <div>
                        <p className="text-[10px] text-blue-200 uppercase font-bold">Category Avg Price</p>
                        <p className="text-lg font-bold">{formatCurrency(categoryLeader.avgPrice)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] text-blue-200 uppercase font-bold text-blue-100">Peak Hours</p>
                        <p className="text-sm font-black whitespace-nowrap shadow-sm">Crowded</p>
                      </div>
                    </div>
                  </div>
                  <div className="absolute -right-4 -bottom-4 opacity-10">
                    <Store size={100} />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="py-20 text-center">
          <motion.div 
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
            className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-6"
          />
          <p className="text-gray-500 font-bold text-lg">Analyzing global receipts...</p>
        </div>
      ) : (
        <AnimatePresence>
          {results.length > 0 ? (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-8"
            >
              {/* Best Dealer Feature */}
              {bestPrice && (
                <div className="bg-white rounded-[40px] p-1 border-2 border-green-500 shadow-xl shadow-green-50 overflow-hidden">
                  <div className="bg-green-500/5 p-8 md:p-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-8 rounded-[38px]">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-4">
                        <div className="bg-green-500 p-2 rounded-xl">
                          <TrendingDown className="w-5 h-5 text-white" />
                        </div>
                        <span className="text-sm font-black text-green-600 uppercase tracking-widest">Market Low</span>
                        {isAdmin && !editingItemId && (
                          <button 
                            onClick={(e) => { e.stopPropagation(); startEditing(bestPrice); }}
                            className="ml-auto p-2 bg-white/20 hover:bg-white/40 rounded-full transition-colors"
                            title="Edit Product Info"
                          >
                            <Edit2 size={16} className="text-gray-900" />
                          </button>
                        )}
                      </div>
                      
                      {editingItemId === bestPrice.id ? (
                        <div className="space-y-3">
                          <div className="flex flex-col gap-1">
                            <label className="text-[10px] font-black text-green-700 uppercase">Product Name</label>
                            <input 
                              type="text"
                              value={editValues.name}
                              onChange={(e) => setEditValues({ ...editValues, name: e.target.value })}
                              className="w-full bg-white border-2 border-green-200 rounded-xl px-4 py-2 font-bold text-gray-900 focus:border-green-500 outline-none"
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="flex flex-col gap-1">
                              <label className="text-[10px] font-black text-green-700 uppercase">Brand</label>
                              <input 
                                type="text"
                                value={editValues.brand || ''}
                                onChange={(e) => setEditValues({ ...editValues, brand: e.target.value })}
                                className="w-full bg-white border-2 border-green-200 rounded-xl px-4 py-2 text-sm font-bold text-gray-900 focus:border-green-500 outline-none"
                                placeholder="e.g. Almarai"
                              />
                            </div>
                            <div className="flex flex-col gap-1">
                              <label className="text-[10px] font-black text-green-700 uppercase">Size/Unit</label>
                              <input 
                                type="text"
                                value={editValues.size || ''}
                                onChange={(e) => setEditValues({ ...editValues, size: e.target.value })}
                                className="w-full bg-white border-2 border-green-200 rounded-xl px-4 py-2 text-sm font-bold text-gray-900 focus:border-green-500 outline-none"
                                placeholder="e.g. 1kg"
                              />
                            </div>
                          </div>
                        </div>
                      ) : (
                        <>
                          <h3 className="text-4xl font-extrabold text-gray-900 mb-2">{bestPrice.name} at {bestPrice.storeName}</h3>
                          <p className="text-gray-500 font-medium flex items-center gap-2">
                            <MapPin className="w-4 h-4" /> Verified at {new Date(bestPrice.date).toLocaleDateString()}
                          </p>
                        </>
                      )}
                    </div>
                    
                    <div className="bg-white p-8 rounded-3xl shadow-sm border border-green-100 text-center min-w-[200px]">
                      <p className="text-gray-400 text-xs font-bold uppercase mb-1">Current Best</p>
                      {editingItemId === bestPrice.id ? (
                        <div className="space-y-4">
                          <div className="flex flex-col gap-1">
                             <label className="text-[10px] font-black text-green-700 uppercase">Price</label>
                             <input 
                              type="number"
                              step="0.001"
                              value={editValues.price}
                              onChange={(e) => setEditValues({ ...editValues, price: parseFloat(e.target.value) })}
                              className="w-full bg-gray-50 border-2 border-green-100 rounded-xl px-4 py-2 text-2xl font-black text-gray-900 text-center focus:border-green-500 outline-none"
                            />
                          </div>
                          <div className="flex gap-2">
                            <button 
                              onClick={() => handleSaveEdit(bestPrice.id!)}
                              disabled={savingEdit}
                              className="flex-1 bg-green-600 hover:bg-green-700 text-white font-bold py-3 rounded-xl transition-all shadow-lg shadow-green-100 flex items-center justify-center gap-2"
                            >
                              <Save size={18} />
                              {savingEdit ? "..." : "Save"}
                            </button>
                            <button 
                              onClick={() => setEditingItemId(null)}
                              className="px-4 py-3 bg-gray-100 hover:bg-gray-200 text-gray-500 rounded-xl transition-all font-bold"
                            >
                              <X size={18} />
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-5xl font-black text-gray-900">{formatCurrency(bestPrice.price)}</p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Other Options */}
              <div className="space-y-4">
                <h4 className="text-xl font-bold text-gray-900 px-2 flex items-center gap-2">
                  <Filter className="w-5 h-5 text-blue-600" />
                  All Available Deals
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {results.slice(1).map((item) => (
                    <motion.div
                      key={item.id}
                      whileHover={editingItemId === item.id ? {} : { y: -4, borderColor: '#3b82f6' }}
                      className={cn(
                        "bg-white p-8 rounded-[32px] border flex items-center justify-between shadow-sm transition-all",
                        editingItemId === item.id ? "border-blue-500 ring-4 ring-blue-50" : "border-gray-100"
                      )}
                    >
                      <div className="flex items-center gap-5 flex-1 min-w-0">
                        <div className="bg-gray-50 p-4 rounded-2xl shrink-0">
                          <Store className="w-6 h-6 text-gray-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          {editingItemId === item.id ? (
                            <div className="space-y-3">
                              <input 
                                type="text"
                                value={editValues.name}
                                onChange={(e) => setEditValues({ ...editValues, name: e.target.value })}
                                className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 font-bold text-gray-900 outline-none focus:border-blue-400"
                              />
                              <div className="flex gap-2">
                                <input 
                                  type="text"
                                  value={editValues.brand || ''}
                                  onChange={(e) => setEditValues({ ...editValues, brand: e.target.value })}
                                  placeholder="Brand"
                                  className="w-1/2 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 text-xs font-bold outline-none focus:border-blue-400"
                                />
                                <input 
                                  type="text"
                                  value={editValues.size || ''}
                                  onChange={(e) => setEditValues({ ...editValues, size: e.target.value })}
                                  placeholder="Size"
                                  className="w-1/2 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 text-xs font-bold outline-none focus:border-blue-400"
                                />
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="flex items-center gap-2">
                                <p className="font-extrabold text-gray-900 text-lg truncate">{item.storeName}</p>
                                {isAdmin && !editingItemId && (
                                  <div className="flex gap-1">
                                    <button 
                                      onClick={() => startEditing(item)}
                                      className="text-gray-300 hover:text-blue-600 transition-colors"
                                      title="Edit Item"
                                    >
                                      <Edit2 size={14} />
                                    </button>
                                    <button 
                                      onClick={() => handleDeleteItem(item.id!)}
                                      className="text-gray-300 hover:text-red-500 transition-colors"
                                      title="Delete Record"
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  </div>
                                )}
                              </div>
                              <p className="text-gray-500 text-sm font-medium truncate">{item.name}</p>
                              <div className="flex flex-wrap gap-2 mt-2">
                                {item.brand && (
                                  <span className="text-[10px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full font-black uppercase">
                                    {item.brand}
                                  </span>
                                )}
                                {item.size && (
                                  <span className="text-[10px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full font-black uppercase">
                                    {item.size}
                                  </span>
                                )}
                              </div>
                            </>
                          )}
                          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter mt-1">Verified {new Date(item.date).toLocaleDateString()}</p>
                        </div>
                      </div>
                      <div className="text-right flex flex-col items-end gap-1 ml-4 shrink-0">
                        {editingItemId === item.id ? (
                          <div className="space-y-2">
                            <input 
                              type="number"
                              step="0.001"
                              value={editValues.price}
                              onChange={(e) => setEditValues({ ...editValues, price: parseFloat(e.target.value) })}
                              className="w-24 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 text-right font-black text-gray-900 outline-none focus:border-blue-400"
                            />
                            <div className="flex gap-1 justify-end">
                              <button 
                                onClick={() => handleSaveEdit(item.id!)}
                                disabled={savingEdit}
                                className="bg-blue-600 text-white p-2 rounded-lg hover:bg-blue-700"
                                title="Save Changes"
                              >
                                <Save size={14} />
                              </button>
                              <button 
                                onClick={() => handleDeleteItem(item.id!)}
                                className="bg-red-50 text-red-500 p-2 rounded-lg hover:bg-red-100 transition-colors"
                                title="Delete Permanently"
                              >
                                <Trash2 size={14} />
                              </button>
                              <button 
                                onClick={() => setEditingItemId(null)}
                                className="bg-gray-100 text-gray-500 p-2 rounded-lg hover:bg-gray-200"
                                title="Cancel"
                              >
                                <X size={14} />
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <p className="text-2xl font-black text-gray-900">{formatCurrency(item.price)}</p>
                            <div className="flex flex-col items-end gap-1">
                              <p className="text-xs text-red-500 font-bold bg-red-50 px-2 py-0.5 rounded-full">
                                +{formatCurrency(item.price - (bestPrice?.price || 0))} 
                              </p>
                              {item.visitTime && (
                                <div className="flex items-center gap-1 text-[9px] text-gray-400 font-black uppercase">
                                  Recent Visit: <span className="text-blue-600">{item.visitTime}</span>
                                </div>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            </motion.div>
          ) : searchTerm && !loading && (
            <div className="py-20 text-center bg-white rounded-[40px] border border-gray-100 shadow-sm">
              <div className="bg-gray-50 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6">
                <Search className="w-8 h-8 text-gray-300" />
              </div>
              <p className="text-xl font-bold text-gray-900">No price data yet</p>
              <p className="text-gray-500 mt-2 max-w-sm mx-auto">We haven't recorded prices for "{searchTerm}" in this region. Try scanning your latest receipt!</p>
            </div>
          )}
        </AnimatePresence>
      )}
    </div>
  );
};
