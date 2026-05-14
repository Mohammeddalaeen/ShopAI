import React from 'react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { signInWithGoogle, logout } from '../lib/firebase';
import { ShoppingCart, LayoutDashboard, Receipt, BarChart3, Search, LogOut, Menu, X, Wallet, Store, ShoppingBag, Globe } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn, isAdminUser } from '../lib/utils';
import { Language } from '../lib/translations';

interface LayoutProps {
  children: React.ReactNode;
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

export const Layout: React.FC<LayoutProps> = ({ children, activeTab, setActiveTab }) => {
  const { user, profile, loading } = useAuth();
  const { language, setLanguage, t, isRTL } = useLanguage();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false);

  const isAdmin = profile?.role === 'admin';

  const navItems = [
    { id: 'dashboard', label: t('dashboard'), icon: LayoutDashboard },
    { id: 'scanner', label: t('scanReceipt'), icon: Receipt },
    { id: 'comparison', label: t('priceCompare'), icon: Search },
    { id: 'planner', label: t('planner'), icon: ShoppingBag },
    { id: 'shops', label: t('shopInsight'), icon: Store },
    { id: 'budgets', label: t('budgets'), icon: Wallet },
  ];

  const LanguageSelector = ({ className }: { className?: string }) => (
    <div className={cn("flex items-center gap-2", className)}>
      <button
        onClick={() => setLanguage('en')}
        className={cn(
          "px-2 py-1 text-xs font-bold rounded-md transition-all",
          language === 'en' ? "bg-blue-600 text-white" : "text-gray-400 hover:text-gray-600"
        )}
      >
        EN
      </button>
      <div className="w-[1px] h-3 bg-gray-200" />
      <button
        onClick={() => setLanguage('ar')}
        className={cn(
          "px-2 py-1 text-xs font-bold rounded-md transition-all",
          language === 'ar' ? "bg-blue-600 text-white" : "text-gray-400 hover:text-gray-600 font-arabic"
        )}
      >
        عربي
      </button>
    </div>
  );

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f5f5f5]">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
          className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full"
        />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#f5f5f5] p-4 text-center">
        <div className="mb-6">
          <LanguageSelector className="bg-white px-4 py-2 rounded-full shadow-sm" />
        </div>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full bg-white p-8 rounded-3xl shadow-sm border border-gray-100"
        >
          <div className="bg-blue-50 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <ShoppingCart className="w-8 h-8 text-blue-600" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">{t('appName')}</h1>
          <p className="text-gray-500 mb-8">{t('tagline')}</p>
          <button
            onClick={signInWithGoogle}
            className="w-full py-3 px-4 bg-gray-900 hover:bg-black text-white rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
          >
            <img src="https://www.google.com/favicon.ico" className="w-4 h-4" alt="Google" />
            {t('signInWithGoogle')}
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className={cn("min-h-screen bg-[#f8f9fb] flex flex-col md:flex-row", isRTL && "font-arabic")}>
      {/* Sidebar - Desktop */}
      <aside className={cn(
        "hidden md:flex flex-col w-64 bg-white border-gray-100 p-6",
        isRTL ? "border-l" : "border-r"
      )}>
        <div className="flex items-center justify-between mb-10 px-2">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 p-2 rounded-xl">
              <ShoppingCart className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-xl text-gray-900 tracking-tight">{t('appName')}</span>
          </div>
        </div>

        <nav className="flex-1 space-y-1">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all text-start",
                activeTab === item.id 
                  ? "bg-blue-50 text-blue-600" 
                  : "text-gray-500 hover:bg-gray-50 hover:text-gray-900"
              )}
            >
              <item.icon className="w-5 h-5 flex-shrink-0" />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="pt-6 mt-6 border-t border-gray-100">
          <div className="mb-6 px-4">
             <LanguageSelector className="justify-center py-2 bg-gray-50 rounded-xl" />
          </div>
          <div className="flex items-center gap-3 px-4 mb-6">
            <div className="w-8 h-8 rounded-full bg-gray-200 overflow-hidden flex-shrink-0">
              <img src={user.photoURL || `https://ui-avatars.com/api/?name=${user.displayName}`} alt={user.displayName || ''} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1">
                <p className="text-sm font-semibold text-gray-900 truncate text-start">{user.displayName}</p>
                {isAdmin && (
                  <span className="text-[8px] bg-red-100 text-red-600 px-1 rounded-sm font-black uppercase">{t('admin')}</span>
                )}
              </div>
              <p className="text-xs text-gray-500 truncate text-start">{user.email}</p>
            </div>
          </div>
          <button
            onClick={logout}
            className="w-full flex items-center gap-3 px-4 py-2 text-sm font-medium text-red-500 hover:bg-red-50 rounded-lg transition-colors text-start"
          >
            <LogOut className="w-4 h-4 flex-shrink-0" />
            <span>{t('logout')}</span>
          </button>
        </div>
      </aside>

      {/* Header - Mobile */}
      <header className="md:hidden bg-white border-b border-gray-100 p-4 sticky top-0 z-50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-blue-600 p-1.5 rounded-lg">
              <ShoppingCart className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-gray-900">{t('appName')}</span>
          </div>
          <div className="flex items-center gap-4">
            <LanguageSelector />
            <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}>
              {isMobileMenuOpen ? <X /> : <Menu />}
            </button>
          </div>
        </div>
        
        <AnimatePresence>
          {isMobileMenuOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-4 space-y-1"
            >
              {navItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    setActiveTab(item.id);
                    setIsMobileMenuOpen(false);
                  }}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium",
                    activeTab === item.id 
                      ? "bg-blue-50 text-blue-600" 
                      : "text-gray-500"
                  )}
                >
                  <item.icon className="w-5 h-5" />
                  {item.label}
                </button>
              ))}
              <button
                onClick={logout}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm font-medium text-red-500"
              >
                <LogOut className="w-5 h-5" />
                Logout
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      {/* Main Content */}
      <main className="flex-1 p-4 md:p-8 overflow-y-auto max-w-7xl mx-auto w-full">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
};
