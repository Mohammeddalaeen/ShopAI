import React, { useState, useEffect } from 'react';
import { Wallet, Plus, Trash2, PieChart, Target, AlertTriangle } from 'lucide-react';
import { collection, query, where, getDocs, addDoc, deleteDoc, doc, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../context/AuthContext';
import { BudgetItem, CATEGORIES, Category, InvoiceItem } from '../types';
import { cn, formatCurrency } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { useLanguage } from '../context/LanguageContext';

export const BudgetManager: React.FC = () => {
  const { user } = useAuth();
  const { t, language } = useLanguage();
  const [budgets, setBudgets] = useState<BudgetItem[]>([]);
  const [spending, setSpending] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newBudget, setNewBudget] = useState<{ category: Category; limit: string }>({
    category: 'Groceries',
    limit: ''
  });

  const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM

  const fetchData = async () => {
    if (!user) return;
    setLoading(true);
    try {
      // Fetch budgets
      const budgetsQuery = query(
        collection(db, 'budgets'),
        where('userId', '==', user.uid),
        where('month', '==', currentMonth)
      );
      const budgetsSnap = await getDocs(budgetsQuery);
      setBudgets(budgetsSnap.docs.map(d => ({ id: d.id, ...d.data() } as BudgetItem)));

      // Fetch items for the month
      const itemsQuery = query(
        collection(db, 'items'),
        where('userId', '==', user.uid)
      );
      const itemsSnap = await getDocs(itemsQuery);
      const itemData = itemsSnap.docs
        .map(d => d.data() as InvoiceItem)
        .filter(item => (item.date || '').startsWith(currentMonth));
      
      const spendingMap: Record<string, number> = {};
      itemData.forEach(item => {
        const cat = item.category || 'Other';
        spendingMap[cat] = (spendingMap[cat] || 0) + (item.price * item.quantity);
      });
      setSpending(spendingMap);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [user]);

  const handleCreate = async () => {
    if (!user || !newBudget.limit) return;
    try {
      await addDoc(collection(db, 'budgets'), {
        userId: user.uid,
        category: newBudget.category,
        limit: parseFloat(newBudget.limit),
        month: currentMonth
      });
      setShowAdd(false);
      setNewBudget({ category: 'Groceries', limit: '' });
      fetchData();
    } catch (err) {
      console.error(err);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'budgets', id));
      fetchData();
    } catch (err) {
      console.error(err);
    }
  };

  const totalBudget: number = budgets.reduce((sum: number, b: BudgetItem) => sum + (Number(b.limit) || 0), 0);
  const totalSpending: number = Object.keys(spending).reduce((sum, key) => sum + (Number(spending[key]) || 0), 0);

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold text-gray-900 mb-2">{language === 'ar' ? 'الميزانيات' : 'Budgets'}</h2>
          <p className="text-gray-500">{language === 'ar' ? 'خطط لإنفاقك حسب الفئة لشهر' : 'Plan your spending by category for'} {new Date().toLocaleDateString(language === 'ar' ? 'ar-EG' : 'en-US', { month: 'long', year: 'numeric' })}.</p>
        </div>
          <button 
            onClick={() => setShowAdd(true)}
            className="bg-gray-900 hover:bg-black text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 transition-all"
          >
            <Plus className="w-5 h-5" />
            {language === 'ar' ? 'تحديد ميزانية' : 'Set Budget'}
          </button>
      </div>

      {/* Main Budget Card */}
      <div className="bg-white rounded-[32px] p-8 border border-gray-100 shadow-sm overflow-hidden relative">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 relative z-10">
          <div>
            <p className="text-gray-400 text-xs uppercase font-bold tracking-widest mb-2">{language === 'ar' ? 'نظرة عامة شهرية' : 'Monthly Overview'}</p>
            <h3 className="text-4xl font-bold text-gray-900 mb-4">{formatCurrency(totalSpending)} <span className="text-gray-300 font-medium">/ {formatCurrency(totalBudget)}</span></h3>
            <div className="w-full bg-gray-50 h-3 rounded-full overflow-hidden mb-4">
              <motion.div 
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(totalBudget > 0 ? (Number(totalSpending) / Number(totalBudget)) * 100 : 0, 100)}%` }}
                className={cn(
                  "h-full rounded-full transition-colors",
                  totalSpending > totalBudget ? "bg-red-500" : "bg-blue-600"
                )}
              />
            </div>
            <p className="text-sm font-medium text-gray-500">
              {totalSpending > totalBudget 
                ? (language === 'ar' ? `لقد تجاوزت ميزانيتك بمقدار ${formatCurrency(Number(totalSpending) - Number(totalBudget))}` : `You've exceeded your budget by ${formatCurrency(Number(totalSpending) - Number(totalBudget))}`)
                : (language === 'ar' ? `يتبقى ${formatCurrency(Number(totalBudget) - Number(totalSpending))} لهذا الشهر` : `${formatCurrency(Number(totalBudget) - Number(totalSpending))} remaining for this month`)
              }
            </p>
          </div>
          <div className="flex items-center justify-center md:justify-end">
            <div className="bg-blue-50 p-6 rounded-[24px]">
              <Target className="w-12 h-12 text-blue-600 mb-2" />
              <p className="text-sm font-bold text-blue-900">{language === 'ar' ? 'الهدف المالي' : 'Financial Goal'}</p>
              <p className="text-xs text-blue-700">{language === 'ar' ? `تتبع عبر ${budgets.length} فئات` : `Tracking across ${budgets.length} categories`}</p>
            </div>
          </div>
        </div>
        <div className="absolute right-[-20px] bottom-[-20px] opacity-[0.03]">
          <Wallet size={200} />
        </div>
      </div>

      <AnimatePresence>
        {showAdd && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/20 backdrop-blur-sm"
          >
            <div className="bg-white w-full max-w-md p-8 rounded-[32px] shadow-2xl">
              <h3 className="text-2xl font-bold text-gray-900 mb-6">{language === 'ar' ? 'ميزانية فئة جديدة' : 'New Category Budget'}</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">{language === 'ar' ? 'الفئة' : 'Category'}</label>
                  <select 
                    value={newBudget.category}
                    onChange={(e) => setNewBudget({ ...newBudget, category: e.target.value as Category })}
                    className="w-full bg-gray-50 border border-gray-100 p-4 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-100"
                  >
                    {CATEGORIES.map(cat => (
                      <option key={cat} value={cat}>{t(cat as any)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">{language === 'ar' ? 'الحد الشهري ($)' : 'Monthly Limit ($)'}</label>
                  <input 
                    type="number"
                    value={newBudget.limit || ''}
                    onChange={(e) => setNewBudget({ ...newBudget, limit: e.target.value })}
                    placeholder={language === 'ar' ? 'مثال: 500' : 'e.g. 500'}
                    className="w-full bg-gray-50 border border-gray-100 p-4 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                </div>
                  <div className="flex gap-3 pt-4">
                    <button 
                      onClick={() => setShowAdd(false)}
                      className="flex-1 py-4 text-gray-500 font-bold hover:bg-gray-50 rounded-2xl transition-all"
                    >
                      {language === 'ar' ? 'إلغاء' : 'Cancel'}
                    </button>
                    <button 
                      onClick={handleCreate}
                      className="flex-1 py-4 bg-blue-600 text-white font-bold rounded-2xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-100"
                    >
                      {language === 'ar' ? 'إنشاء' : 'Create'}
                    </button>
                  </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {budgets.map((b) => {
          const spent = spending[b.category] || 0;
          const percent = Math.min((spent / b.limit) * 100, 100);
          return (
            <motion.div 
              key={b.id}
              layout
              className="bg-white p-6 rounded-[24px] border border-gray-100 shadow-sm group"
            >
              <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-3">
                  <div className="bg-gray-50 p-2 rounded-xl">
                    <PieChart className="w-5 h-5 text-gray-400 group-hover:text-blue-500 transition-colors" />
                  </div>
                  <h4 className="font-bold text-gray-900">{t(b.category as any)}</h4>
                </div>
                <button 
                  onClick={() => b.id && handleDelete(b.id)}
                  className="p-2 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              <div className="flex justify-between text-sm mb-2">
                <span className="text-gray-500 font-medium">{language === 'ar' ? 'المصروف' : 'Spent'}: {formatCurrency(spent)}</span>
                <span className="text-gray-900 font-bold">{formatCurrency(b.limit)}</span>
              </div>
              <div className="w-full bg-gray-50 h-2 rounded-full overflow-hidden relative">
                <motion.div 
                  initial={{ width: 0 }}
                  animate={{ width: `${percent}%` }}
                  className={cn(
                    "h-full rounded-full",
                    percent > 90 ? "bg-red-500" : percent > 70 ? "bg-orange-500" : "bg-blue-600"
                  )}
                />
              </div>
              {spent > b.limit && (
                <div className="mt-3 flex items-center gap-2 text-red-500 text-xs font-bold bg-red-50 px-3 py-2 rounded-xl">
                  <AlertTriangle className="w-3 h-3" />
                  {language === 'ar' ? `تجاوز الميزانية بمقدار ${formatCurrency(spent - b.limit)}` : `Over budget by ${formatCurrency(spent - b.limit)}`}
                </div>
              )}
            </motion.div>
          );
        })}
        {budgets.length === 0 && !loading && (
          <div className="md:col-span-2 py-12 text-center bg-gray-50 rounded-[32px] border-2 border-dashed border-gray-200 text-gray-500">
            {language === 'ar' ? 'لا توجد ميزانيات نشطة. حدد واحدة لبدء تتبع أهدافك!' : 'No active budgets. Set one to start tracking your goals!'}
          </div>
        )}
      </div>
    </div>
  );
};
