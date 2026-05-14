import React, { useState, useEffect } from 'react';
import { collection, query, where, getDocs, orderBy, limit, writeBatch, doc } from 'firebase/firestore';
import { db, clearAllData, checkConnection } from '../lib/firebase';
import { useAuth } from '../context/AuthContext';
import { Invoice, InvoiceItem, ShoppingListItem } from '../types';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Cell } from 'recharts';
import { TrendingDown, TrendingUp, DollarSign, Receipt, Package, ArrowUpRight, ArrowDownRight, ShoppingCart, Star, Sparkles, Store, Trash2, RefreshCw, AlertCircle } from 'lucide-react';
import { formatCurrency, formatDate, isAdminUser, cn } from '../lib/utils';
import { motion } from 'motion/react';
import { useLanguage } from '../context/LanguageContext';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];

export const Dashboard: React.FC = () => {
  const { user } = useAuth();
  const { t, language, isRTL } = useLanguage();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [items, setItems] = useState<InvoiceItem[]>([]);
  const [marketItems, setMarketItems] = useState<InvoiceItem[]>([]);
  const [favoriteItems, setFavoriteItems] = useState<ShoppingListItem[]>([]);
  const [selections, setSelections] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isWiping, setIsWiping] = useState(false);
  const [offline, setOffline] = useState(false);

  const isAdmin = isAdminUser(user?.email);

  const checkConnectivity = async () => {
    const reachable = await checkConnection();
    setOffline(!reachable);
    return reachable;
  };

  const handleWipeData = async () => {
    if (!window.confirm("CRITICAL ACTION: This will delete ALL data from EVERY user in the database (Invoices, Items, Budgets, Favorites, Store Selections). This cannot be undone. Are you absolutely sure?")) {
      return;
    }

    setIsWiping(true);
    try {
      const isConnected = await checkConnectivity();
      if (!isConnected) {
        alert("Firestore backend is unreachable. Please check your internet connection or try again later.");
        setIsWiping(false);
        return;
      }

      const results = await clearAllData();
      console.log("Wipe results:", results);
      
      const errors = results.filter(r => r.status === 'error');
      if (errors.length > 0) {
        const errorList = errors.map(e => `${e.collection}: ${e.error}`).join('\n');
        alert(`Wipe completed with some errors:\n${errorList}`);
      } else {
        alert("Database wiped successfully. All collections cleared. The page will now reload.");
      }
      
      // Give Firestore a moment to settle
      await new Promise(resolve => setTimeout(resolve, 1000));
      window.location.reload();
    } catch (error) {
      console.error("Failed to wipe database:", error);
      alert("Failed to wipe database. Check console for details.");
    } finally {
      setIsWiping(false);
    }
  };

  const handleDeleteInvoice = async (invoiceId: string) => {
    if (!window.confirm("Are you sure you want to delete this invoice and all its items?")) return;
    
    try {
      // 1. Delete associated items
      const itemsQuery = query(
        collection(db, 'items'),
        where('invoiceId', '==', invoiceId)
      );
      const itemsSnap = await getDocs(itemsQuery);
      const batch = writeBatch(db);
      itemsSnap.docs.forEach(d => batch.delete(d.ref));
      
      // 2. Delete the invoice itself
      batch.delete(doc(db, 'invoices', invoiceId));
      
      await batch.commit();
      
      // Update local state
      setInvoices(prev => prev.filter(inv => inv.id !== invoiceId));
      setItems(prev => prev.filter(item => item.invoiceId !== invoiceId));
      
      alert("Invoice deleted successfully.");
    } catch (error) {
      console.error("Error deleting invoice:", error);
      alert("Failed to delete invoice. Check console for details.");
    }
  };

  useEffect(() => {
    if (!user) return;

    const fetchData = async () => {
      await checkConnectivity();
      try {
        const invoicesQuery = query(
          collection(db, 'invoices'),
          where('userId', '==', user.uid),
          orderBy('date', 'desc'),
          limit(10)
        );
        const invoicesSnap = await getDocs(invoicesQuery);
        const invoicesData = invoicesSnap.docs.map(d => ({ id: d.id, ...d.data() } as Invoice));
        setInvoices(invoicesData);

        const itemsQuery = query(
          collection(db, 'items'),
          where('userId', '==', user.uid),
          orderBy('date', 'desc'),
          limit(50)
        );
        const itemsSnap = await getDocs(itemsQuery);
        const itemsData = itemsSnap.docs.map(d => ({ id: d.id, ...d.data() } as InvoiceItem));
        setItems(itemsData);

        // Fetch market items for savings comparison (last 200 items from any user)
        const marketQuery = query(
          collection(db, 'items'),
          orderBy('date', 'desc'),
          limit(200)
        );
        const marketSnap = await getDocs(marketQuery);
        setMarketItems(marketSnap.docs.map(d => d.data() as InvoiceItem));

        const favsQuery = query(
          collection(db, 'shopping_list'),
          where('userId', '==', user.uid)
        );
        const favsSnap = await getDocs(favsQuery);
        setFavoriteItems(favsSnap.docs.map(d => ({ id: d.id, ...d.data() } as ShoppingListItem)));
        
        if (isAdmin) {
          try {
            const selectionsQuery = query(
              collection(db, 'store_selections'),
              orderBy('timestamp', 'desc'),
              limit(500)
            );
            const selectionsSnap = await getDocs(selectionsQuery);
            setSelections(selectionsSnap.docs.map(d => d.data()));
          } catch (selErr) {
            console.error("Admin selection fetch failed:", selErr);
            // Don't leak too much to non-admins, but for the actual admin it's helpful
          }
        }
      } catch (error) {
        console.error("Error fetching dashboard data", error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [user, isAdmin]);

  const totalSpent = invoices.reduce((sum, inv) => sum + inv.total, 0);
  const avgOrder = invoices.length > 0 ? totalSpent / invoices.length : 0;

  // Calculate Market Savings
  // For each item user bought, compare price with community average for same name + size
  const totalSavings = items.reduce((sum, userItem) => {
    const key = `${userItem.name.toLowerCase().trim()}|${(userItem.size || '').toLowerCase().trim()}`;
    const equivalents = marketItems.filter(mi => 
      `${mi.name.toLowerCase().trim()}|${(mi.size || '').toLowerCase().trim()}` === key
    );

    if (equivalents.length > 1) { // Must have at least one other item to compare
      const avgPrice = equivalents.reduce((s, mi) => s + (Number(mi.price) || 0), 0) / equivalents.length;
      const userPrice = Number(userItem.price) || 0;
      const userQty = Number(userItem.quantity) || 1;
      const savingsPerUnit = Math.max(0, avgPrice - userPrice);
      return sum + (savingsPerUnit * userQty);
    }
    return sum;
  }, 0);

  // Calculate Savings for Favorites specifically
  const favoritesSavings = favoriteItems.reduce((sum, fav) => {
    const key = `${fav.name.toLowerCase().trim()}|${(fav.brand || '').toLowerCase().trim()}|${(fav.size || '').toLowerCase().trim()}`;
    const equivalents = marketItems.filter(mi => 
      `${mi.name.toLowerCase().trim()}|${(mi.brand || '').toLowerCase().trim()}|${(mi.size || '').toLowerCase().trim()}` === key
    );

    if (equivalents.length > 1) {
      const prices = equivalents.map(e => Number(e.price) || 0);
      const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
      const bestPrice = Math.min(...prices);
      const diff = avgPrice - bestPrice;
      return sum + (diff > 0 ? diff : 0);
    }
    return sum;
  }, 0);

  // Prepare chart data
  const spendingByDate = invoices.reduce((acc: any, inv) => {
    const date = inv.date.split('T')[0];
    acc[date] = (acc[date] || 0) + inv.total;
    return acc;
  }, {});

  const chartData = Object.keys(spendingByDate)
    .sort()
    .map(date => ({
      date: formatDate(date),
      amount: spendingByDate[date]
    }));

  const categoryData = items.reduce((acc: any, item) => {
    const price = Number(item.price) || 0;
    const qty = Number(item.quantity) || 0;
    acc[item.category] = (acc[item.category] || 0) + price * qty;
    return acc;
  }, {});

  const barChartData = Object.keys(categoryData).map(cat => ({
    name: cat,
    value: Number(categoryData[cat]) || 0
  })).sort((a, b) => b.value - a.value);

  const selectionData = selections.reduce((acc: any, sel) => {
    acc[sel.storeName] = (acc[sel.storeName] || 0) + 1;
    return acc;
  }, {});

  const selectionsChartData = Object.keys(selectionData).map(store => ({
    name: store,
    value: selectionData[store]
  })).sort((a, b) => b.value - a.value);

  // Peak Hours calculation across all global items
  const hourCounts = marketItems.reduce((acc: any, item: any) => {
    if (item.visitTime) {
      const hour = item.visitTime.split(':')[0];
      const hourLabel = `${hour}:00`;
      acc[hourLabel] = (acc[hourLabel] || 0) + 1;
    }
    return acc;
  }, {});

  const peakHoursData = Object.keys(hourCounts)
    .sort((a, b) => parseInt(a) - parseInt(b))
    .map(hour => ({
      hour,
      count: hourCounts[hour]
    }));

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
    </div>
  );

  return (
    <div className="space-y-8">
      {offline && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 p-4 rounded-2xl flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-amber-500" />
          <div>
            <p className="font-bold text-sm">Connectivity Issue Detected</p>
            <p className="text-xs opacity-80">Firestore is currently unreachable. Your changes may not be saved until the connection is restored.</p>
          </div>
          <button 
            onClick={checkConnectivity}
            className="ml-auto bg-amber-200/50 hover:bg-amber-200 px-3 py-1 rounded-lg text-xs font-bold transition-colors"
          >
            Retry Connection
          </button>
        </div>
      )}

      {isAdmin && (
        <motion.div 
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          className="bg-red-600 text-white p-4 md:p-6 rounded-[24px] md:rounded-[32px] flex flex-col md:flex-row items-center justify-between gap-4 shadow-lg shadow-red-100"
        >
          <div className="flex items-center gap-4 w-full md:w-auto">
            <div className="bg-white/20 p-2 md:p-3 rounded-xl md:rounded-2xl backdrop-blur-md shrink-0">
              <ShoppingCart className="w-5 h-5 md:w-6 md:h-6 text-white" />
            </div>
            <div>
              <p className="font-black text-base md:text-lg uppercase">System Admin Mode</p>
              <p className="text-[10px] md:text-xs opacity-80 break-all">Connected as {user?.email}</p>
            </div>
          </div>
          <div className="flex gap-2 w-full md:w-auto">
            <button 
              onClick={handleWipeData}
              disabled={isWiping}
              className="flex-1 md:flex-none flex items-center justify-center gap-2 px-6 py-3 bg-white text-red-600 rounded-2xl text-[10px] md:text-sm font-black uppercase hover:bg-red-50 transition-colors shadow-lg disabled:opacity-50"
            >
              {isWiping ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4" />
              )}
              {language === 'ar' ? 'مسح كل البيانات' : 'Wipe All Data'}
            </button>
            <div className="hidden md:flex items-center px-4 py-2 bg-white/10 rounded-xl text-[10px] md:text-xs font-bold backdrop-blur-sm uppercase">
              {marketItems.length} Global Items
            </div>
          </div>
        </motion.div>
      )}
      <div>
        <h2 className="text-2xl font-bold text-gray-900">{t('dashboard')}</h2>
        <p className="text-gray-500">{language === 'ar' ? 'تتبع أنماط الإنفاق والنشاط الأخير.' : 'Track your spending patterns and recent activity.'}</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <motion.div 
          whileHover={{ y: -4 }}
          className="bg-blue-600 p-6 rounded-[32px] shadow-xl shadow-blue-100 text-white relative overflow-hidden"
        >
          <div className="absolute -right-4 -bottom-4 opacity-10 rotate-12">
            <TrendingDown className="w-32 h-32" />
          </div>
          <div className="flex items-center justify-between mb-4">
            <div className="bg-white/20 p-2 rounded-xl backdrop-blur-md">
              <TrendingDown className="w-5 h-5 text-white" />
            </div>
          </div>
          <p className="text-sm font-medium text-blue-100 mb-1">{t('savings')}</p>
          <p className="text-3xl font-black">{formatCurrency(totalSavings)}</p>
          <div className="mt-4 text-[10px] bg-white/20 inline-block px-2 py-1 rounded-lg backdrop-blur-md font-bold uppercase">
            {language === 'ar' ? 'اختيار ذكي' : 'Smart Choice'}
          </div>
        </motion.div>

        <motion.div 
          whileHover={{ y: -4 }}
          className="bg-indigo-600 p-6 rounded-[32px] shadow-xl shadow-indigo-100 text-white relative overflow-hidden"
        >
          <div className="absolute -right-4 -bottom-4 opacity-10 rotate-12">
            <Star className="w-32 h-32" />
          </div>
          <div className="flex items-center justify-between mb-4">
            <div className="bg-white/20 p-2 rounded-xl backdrop-blur-md">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            {favoritesSavings > 0 && (
              <span className="text-[10px] font-black bg-white/20 px-2 py-1 rounded-lg backdrop-blur-md uppercase">
                Optimization Found
              </span>
            )}
          </div>
          <p className="text-sm font-medium text-indigo-100 mb-1">{language === 'ar' ? 'توفير المفضلة' : 'Favorites Savings'}</p>
          <p className="text-3xl font-black">{formatCurrency(favoritesSavings)}</p>
          <p className="mt-2 text-[10px] text-indigo-100 opacity-80 uppercase font-black tracking-widest">
            {favoriteItems.length} {language === 'ar' ? 'أصناف تم تحليلها' : 'Saved Items Analysis'}
          </p>
        </motion.div>

        <motion.div 
          whileHover={{ y: -4 }}
          className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="bg-blue-50 p-2 rounded-xl text-blue-600">
              <DollarSign className="w-5 h-5" />
            </div>
            <span className="text-xs font-medium text-green-600 bg-green-50 px-2 py-1 rounded-full flex items-center gap-1">
              <ArrowDownRight className="w-3 h-3" /> 12%
            </span>
          </div>
          <p className="text-sm font-medium text-gray-500 mb-1">{language === 'ar' ? 'إجمالي الإنفاق (مؤخراً)' : 'Total Spending (Recent)'}</p>
          <p className="text-2xl font-bold text-gray-900">{formatCurrency(totalSpent)}</p>
        </motion.div>

        <motion.div 
          whileHover={{ y: -4 }}
          className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="bg-orange-50 p-2 rounded-xl text-orange-600">
              <Receipt className="w-5 h-5" />
            </div>
          </div>
          <p className="text-sm font-medium text-gray-500 mb-1">{t('totalInvoices')}</p>
          <p className="text-2xl font-bold text-gray-900">{invoices.length}</p>
        </motion.div>

        <motion.div 
          whileHover={{ y: -4 }}
          className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="bg-green-50 p-2 rounded-xl text-green-600">
              <TrendingDown className="w-5 h-5" />
            </div>
          </div>
          <p className="text-sm font-medium text-gray-500 mb-1">Average Order Value</p>
          <p className="text-2xl font-bold text-gray-900">{formatCurrency(avgOrder)}</p>
        </motion.div>
      </div>

      {/* Admin Insights Section moved up for prominence */}
      {isAdmin && (
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white p-8 rounded-[40px] shadow-sm border border-gray-100"
        >
          <div className="flex items-center justify-between mb-8">
            <div>
              <h3 className="text-xl font-black text-gray-900 flex items-center gap-2">
                <Store className="w-6 h-6 text-blue-600" />
                Store Popularity Insights
              </h3>
              <p className="text-sm text-gray-500 font-medium">Tracking which supermarkets users selection most often.</p>
            </div>
            <div className="bg-blue-50 px-4 py-2 rounded-2xl text-blue-600 text-xs font-black uppercase">
              Admin Only View
            </div>
          </div>

          {selectionsChartData.length > 0 ? (
            <>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={selectionsChartData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} style={{ fontSize: '12px', fontWeight: 'bold' }} />
                    <YAxis axisLine={false} tickLine={false} style={{ fontSize: '12px' }} />
                    <Tooltip 
                      cursor={{ fill: '#f8fafc', radius: 12 }}
                      contentStyle={{ borderRadius: '24px', border: 'none', boxShadow: '0 10px 25px rgba(0,0,0,0.1)', padding: '16px' }}
                    />
                    <Bar dataKey="value" fill="#3b82f6" radius={[12, 12, 0, 0]}>
                      {selectionsChartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-4">
                {selectionsChartData.slice(0, 4).map((item, i) => (
                  <div key={i} className="bg-gray-50 p-4 rounded-2xl border border-gray-100">
                    <p className="text-[10px] font-black text-gray-400 uppercase mb-1">{item.name}</p>
                    <p className="text-2xl font-black text-blue-600">{item.value} <span className="text-sm text-gray-400 font-bold uppercase">Votes</span></p>
                  </div>
                ))}
              </div>

              {/* Recent Activity List */}
              <div className="mt-12 grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="overflow-hidden border border-gray-100 rounded-3xl">
                  <div className="bg-gray-50/50 px-6 py-3 border-b border-gray-100">
                    <h4 className="text-sm font-black text-gray-900 uppercase">Recent Global Selections</h4>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="bg-gray-50/30">
                          <th className="px-6 py-3 text-[10px] font-black text-gray-400 uppercase">User</th>
                          <th className="px-6 py-3 text-[10px] font-black text-gray-400 uppercase">Store</th>
                          <th className="px-6 py-3 text-[10px] font-black text-gray-400 uppercase">Value</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {selections.slice(0, 5).map((sel, i) => (
                          <tr key={i} className="text-xs">
                            <td className="px-6 py-3 text-gray-500 font-medium truncate max-w-[100px]">{sel.userEmail || sel.userId}</td>
                            <td className="px-6 py-3 font-bold text-gray-900">{sel.storeName}</td>
                            <td className="px-6 py-3 font-black text-blue-600">{formatCurrency(sel.totalValue)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="bg-gray-50 border border-gray-100 rounded-3xl p-6">
                  <h4 className="text-sm font-black text-gray-900 uppercase mb-4">Peak Activity Hours</h4>
                  <div className="h-48">
                    {peakHoursData.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={peakHoursData}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                          <XAxis dataKey="hour" axisLine={false} tickLine={false} style={{ fontSize: '10px' }} />
                          <Tooltip 
                            contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}
                          />
                          <Area 
                            type="monotone" 
                            dataKey="count" 
                            stroke="#3b82f6" 
                            fill="#3b82f6" 
                            fillOpacity={0.1}
                            strokeWidth={3} 
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="h-full flex items-center justify-center text-xs text-gray-400 font-bold uppercase">
                        No Time Data Available
                      </div>
                    )}
                  </div>
                  <p className="mt-4 text-[10px] text-gray-400 font-medium italic">
                    *Based on timestamps extracted from community receipts.
                  </p>
                </div>
              </div>
            </>
          ) : (
            <div className="py-20 text-center bg-gray-50 rounded-[32px] border-2 border-dashed border-gray-100">
              <Package className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500 font-bold">No selection data tracked yet.</p>
              <p className="text-xs text-gray-400">Users need to 'Confirm Selection' in the Planner first.</p>
            </div>
          )}
        </motion.div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Spending Chart */}
        <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
          <h3 className="text-lg font-bold text-gray-900 mb-6">{language === 'ar' ? 'اتجاه الإنفاق' : 'Spending Trend'}</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="colorAmount" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.1}/>
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="date" hide />
                <YAxis hide />
                <Tooltip 
                  contentStyle={{ 
                    borderRadius: '16px', 
                    border: 'none', 
                    boxShadow: '0 4px 12px rgba(0,0,0,0.05)',
                    padding: '12px'
                  }}
                />
                <Area 
                  type="monotone" 
                  dataKey="amount" 
                  stroke="#3b82f6" 
                  strokeWidth={2}
                  fillOpacity={1} 
                  fill="url(#colorAmount)" 
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Categories Chart */}
        <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
          <h3 className="text-lg font-bold text-gray-900 mb-6">{language === 'ar' ? 'الإنفاق حسب الفئة' : 'Spending by Category'}</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barChartData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                <XAxis type="number" hide />
                <YAxis dataKey="name" type="category" width={100} axisLine={false} tickLine={false} style={{ fontSize: '12px' }} />
                <Tooltip 
                  cursor={{ fill: 'transparent' }}
                  contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}
                />
                <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                  {barChartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-50 flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-900">{language === 'ar' ? 'رؤى التوفير (المفضلة)' : 'Savings Insights (Favorites)'}</h3>
          <Sparkles className="w-5 h-5 text-indigo-600" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-gray-50/50">
                <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">{language === 'ar' ? 'الصنف المفضل' : 'Favorite Item'}</th>
                <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">{language === 'ar' ? 'متوسط السوق' : 'Market Avg'}</th>
                <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">{language === 'ar' ? 'أفضل سعر' : 'Best Price'}</th>
                <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">{language === 'ar' ? 'توفير محتمل' : 'Potential Saving'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {favoriteItems.map((fav) => {
                const key = `${fav.name.toLowerCase().trim()}|${(fav.brand || '').toLowerCase().trim()}|${(fav.size || '').toLowerCase().trim()}`;
                const equivalents = marketItems.filter(mi => 
                  `${mi.name.toLowerCase().trim()}|${(mi.brand || '').toLowerCase().trim()}|${(mi.size || '').toLowerCase().trim()}` === key
                );
                
                if (equivalents.length < 1) return null;

                const prices = equivalents.map(e => Number(e.price) || 0);
                const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
                const bestPrice = Math.min(...prices);
                const diff = avgPrice - bestPrice;

                return (
                  <tr key={fav.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex flex-col">
                        <span className="font-medium text-gray-900 capitalize">{fav.name}</span>
                        <span className="text-[10px] text-gray-400 font-bold uppercase">{fav.brand} {fav.size}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">{formatCurrency(avgPrice)}</td>
                    <td className="px-6 py-4 text-sm font-bold text-green-600">{formatCurrency(bestPrice)}</td>
                    <td className="px-6 py-4">
                      <span className="px-2 py-1 bg-green-50 text-green-700 rounded-lg text-xs font-black">
                        +{formatCurrency(diff)}
                      </span>
                    </td>
                  </tr>
                );
              }).filter(Boolean).slice(0, 5)}
              {favoriteItems.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-gray-500">
                    {language === 'ar' ? 'لا توجد رؤى توفير بعد. أضف أصنافاً للمفضلة في المخطط لرؤية المقارنات!' : 'No savings insights yet. Bookmark items in the Planner to see comparisons!'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-50 flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-900">{t('recentInvoices')}</h3>
          <button className="text-sm font-semibold text-blue-600 hover:text-blue-700">{language === 'ar' ? 'عرض الكل' : 'View All'}</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-gray-50/50">
                <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">{language === 'ar' ? 'المتجر' : 'Store'}</th>
                <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">{language === 'ar' ? 'التاريخ' : 'Date'}</th>
                <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">{language === 'ar' ? 'الأصناف' : 'Items'}</th>
                <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">{language === 'ar' ? 'الإجمالي' : 'Total'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {invoices.map((inv) => (
                <tr key={inv.id} className="hover:bg-gray-50/50 transition-colors group/row">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="bg-gray-100 p-2 rounded-lg">
                        <ShoppingCart className="w-4 h-4 text-gray-600" />
                      </div>
                      <span className="font-medium text-gray-900">{inv.storeName}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">{formatDate(inv.date)}</td>
                  <td className="px-6 py-4 text-sm text-gray-500">{inv.itemsCount} {language === 'ar' ? 'أصناف' : 'items'}</td>
                  <td className="px-6 py-4">
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-sm font-bold text-gray-900">{formatCurrency(inv.total)}</span>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          inv.id && handleDeleteInvoice(inv.id);
                        }}
                        className="p-2 text-gray-300 hover:text-red-500 opacity-0 group-hover/row:opacity-100 transition-all"
                        title={language === 'ar' ? 'حذف الفاتورة' : 'Delete Invoice'}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {invoices.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-gray-500">
                    {language === 'ar' ? 'لا توجد فواتير. امسح إيصالاً للبدء!' : 'No invoices found. Scan a receipt to get started!'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
