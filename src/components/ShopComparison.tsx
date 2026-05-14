import React, { useState, useEffect } from 'react';
import { Store, ShoppingBag, TrendingUp, ChevronRight, Search, BarChart3, Package } from 'lucide-react';
import { collection, query, getDocs, orderBy, limit } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { InvoiceItem } from '../types';
import { cn, formatCurrency } from '../lib/utils';
import { motion } from 'motion/react';

interface ShopPriceStats {
  storeName: string;
  itemCount: number;
  avgItemPrice: number;
  recentItems: InvoiceItem[];
}

export const ShopComparison: React.FC = () => {
  const [shopStats, setShopStats] = useState<ShopPriceStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      try {
        const itemsQuery = query(
          collection(db, 'items'),
          orderBy('date', 'desc'),
          limit(1000)
        );
        const snap = await getDocs(itemsQuery);
        const allItems = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as InvoiceItem));

        // Grouping logic
        const grouped = allItems.reduce((acc: Record<string, InvoiceItem[]>, item) => {
          if (!acc[item.storeName]) acc[item.storeName] = [];
          acc[item.storeName].push(item);
          return acc;
        }, {});

        const stats = Object.keys(grouped).map(storeName => {
          const items = grouped[storeName];
          const total = items.reduce((sum, item) => sum + item.price, 0);
          return {
            storeName,
            itemCount: items.length,
            avgItemPrice: total / items.length,
            recentItems: items.slice(0, 5)
          };
        });

        setShopStats(stats.sort((a, b) => b.itemCount - a.itemCount));
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const filteredShops = shopStats.filter(shop => 
    shop.storeName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
    </div>
  );

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <div>
        <h2 className="text-3xl font-bold text-gray-900 mb-2">Shop Insights</h2>
        <p className="text-gray-500">Analyze retailers based on community data and price performance.</p>
      </div>

      {/* Filter */}
      <div className="relative max-w-md">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
        <input 
          type="text" 
          placeholder="Filter by shop name..."
          value={searchTerm || ''}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full pl-12 pr-4 py-4 bg-white border border-gray-100 rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-50 focus:border-blue-200 transition-all font-medium"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {filteredShops.map((shop, idx) => (
          <motion.div
            key={shop.storeName}
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: idx * 0.05 }}
            className="bg-white rounded-[32px] border border-gray-100 shadow-sm overflow-hidden flex flex-col"
          >
            <div className="p-8 border-b border-gray-50 bg-gray-50/30 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="bg-white p-4 rounded-2xl shadow-sm">
                  <Store className="w-6 h-6 text-blue-600" />
                </div>
                <div>
                  <h3 className="text-2xl font-black text-gray-900">{shop.storeName}</h3>
                  <p className="text-sm font-bold text-blue-500 uppercase tracking-wider">{shop.itemCount} Community Records</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-xs font-bold text-gray-400 uppercase mb-1">Price Index</p>
                <p className="text-3xl font-black text-gray-900">{formatCurrency(shop.avgItemPrice)}</p>
                <p className="text-[10px] text-gray-400 font-bold">avg. per item</p>
              </div>
            </div>

            <div className="p-8 flex-1">
              <h4 className="text-sm font-black text-gray-400 uppercase tracking-widest mb-6 flex items-center gap-2">
                <Package className="w-4 h-4" />
                Competitive Samples
              </h4>
              <div className="space-y-3">
                {shop.recentItems.map((item, i) => (
                  <div key={i} className="flex items-center justify-between p-4 bg-gray-50/50 rounded-2xl hover:bg-gray-50 transition-colors">
                    <div>
                      <p className="font-bold text-gray-900">{item.name}</p>
                      <p className="text-xs font-medium text-gray-500">{item.category}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-black text-gray-900">{formatCurrency(item.price)}</p>
                      <p className="text-[10px] font-bold text-gray-400 uppercase">{new Date(item.date).toLocaleDateString()}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="p-4 bg-gray-50 border-t border-gray-50 text-center">
              <button className="text-sm font-bold text-blue-600 hover:text-blue-700 flex items-center gap-2 mx-auto py-2">
                Analyze Inventory Trends
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        ))}
        {filteredShops.length === 0 && (
          <div className="lg:col-span-2 py-20 text-center">
            <ShoppingBag className="w-16 h-16 text-gray-200 mx-auto mb-4" />
            <p className="text-gray-500 font-bold">No shops found matching your search.</p>
          </div>
        )}
      </div>
    </div>
  );
};
