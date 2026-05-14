/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import { AuthProvider } from './context/AuthContext';
import { Layout } from './components/Layout';
import { Dashboard } from './components/Dashboard';
import { ReceiptScanner } from './components/ReceiptScanner';
import { PriceComparison } from './components/PriceComparison';
import { ShoppingPlanner } from './components/ShoppingPlanner';
import { ShopComparison } from './components/ShopComparison';
import { BudgetManager } from './components/BudgetManager';

import { LanguageProvider } from './context/LanguageContext';

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return <Dashboard />;
      case 'scanner':
        return <ReceiptScanner />;
      case 'comparison':
        return <PriceComparison />;
      case 'planner':
        return <ShoppingPlanner />;
      case 'shops':
        return <ShopComparison />;
      case 'budgets':
        return <BudgetManager />;
      default:
        return <Dashboard />;
    }
  };

  return (
    <LanguageProvider>
      <AuthProvider>
        <Layout activeTab={activeTab} setActiveTab={setActiveTab}>
          {renderContent()}
        </Layout>
      </AuthProvider>
    </LanguageProvider>
  );
}
