import React, { useState, useRef } from 'react';
import { Camera, Upload, Check, AlertCircle, FileText, Loader2 } from 'lucide-react';
import { extractReceiptData } from '../lib/shoppingAI';
import { db } from '../lib/firebase';
import { collection, addDoc, serverTimestamp, query, where, getDocs, updateDoc, doc, increment } from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { motion, AnimatePresence } from 'motion/react';
import { useLanguage } from '../context/LanguageContext';
import { Invoice, InvoiceItem } from '../types';
import { Sparkles } from 'lucide-react';

const POINTS_PER_ITEM = 10;

export const ReceiptScanner: React.FC = () => {
  const { user, profile, refreshProfile } = useAuth();
  const { t, language } = useLanguage();
  const [isScanning, setIsScanning] = useState(false);
  const [pipelineState, setPipelineState] = useState<'IDLE' | 'PRE_PROCESSING' | 'OCR' | 'BRAIN' | 'VALIDATION'>('IDLE');
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<any>(null);
  const [pointsEarned, setPointsEarned] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    if (!file.type.startsWith('image/')) {
      setError("Please upload an image file.");
      return;
    }

    setIsScanning(true);
    setPipelineState('PRE_PROCESSING');
    setProgress(5);
    setError(null);
    setResult(null);
    setPointsEarned(0);

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const base64 = reader.result as string;
        
        setPipelineState('BRAIN');
        setProgress(30);

        const data = await extractReceiptData(base64);
        
        if (!data || !data.items || data.items.length === 0) {
          throw new Error("No items could be identified. Please ensure the receipt is clear and well-lit.");
        }

        setPipelineState('VALIDATION');
        setProgress(90);
        
        await new Promise(resolve => setTimeout(resolve, 500));
        
        const earned = (data.items || []).length * POINTS_PER_ITEM;
        setPointsEarned(earned);
        setResult(data);
        
        try {
          const invoiceRef = await addDoc(collection(db, 'invoices'), {
            userId: user.uid,
            storeName: data.storeName,
            storeAddress: data.storeAddress || '',
            date: data.date || new Date().toISOString(),
            visitTime: data.time || '',
            total: data.total,
            itemsCount: (data.items || []).length,
            pointsEarned: earned,
            processed: true,
            createdAt: new Date().toISOString()
          });

          await updateDoc(doc(db, 'users', user.uid), {
            points: increment(earned)
          });
          
          await refreshProfile();

          const newItemDate = data.date || new Date().toISOString();
          const visitTime = data.time || '';
          
          for (const item of data.items) {
            const category = item.category || 'Groceries';
            
            const itemQuery = query(
              collection(db, 'items'),
              where('userId', '==', user.uid),
              where('storeName', '==', data.storeName),
              where('name', '==', item.name)
            );
            
            const querySnapshot = await getDocs(itemQuery);

            if (!querySnapshot.empty) {
              const existingDoc = querySnapshot.docs[0];
              const existingData = existingDoc.data();
              
              if (new Date(newItemDate) >= new Date(existingData.date)) {
                await updateDoc(doc(db, 'items', existingDoc.id), {
                  invoiceId: invoiceRef.id,
                  price: item.price,
                  quantity: item.quantity || 1,
                  date: newItemDate,
                  visitTime: visitTime,
                  category: category,
                  brand: item.brand || '',
                  size: item.size || ''
                });
              }
            } else {
              await addDoc(collection(db, 'items'), {
                invoiceId: invoiceRef.id,
                userId: user.uid,
                storeName: data.storeName,
                name: item.name,
                category: category,
                price: item.price,
                quantity: item.quantity || 1,
                date: newItemDate,
                visitTime: visitTime,
                brand: item.brand || '',
                size: item.size || ''
              });
            }
          }
          setProgress(100);
        } catch (dbErr) {
          console.error("Database Error:", dbErr);
          setError("Receipt processed, but saving failed. Please check your connection.");
        }
      } catch (err: any) {
        console.error(err);
        setError(err.message || "Failed to process receipt. Please try another image.");
      } finally {
        setIsScanning(false);
        setPipelineState('IDLE');
      }
    };

    reader.readAsDataURL(file);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="text-center">
        <h2 className="text-3xl font-bold text-gray-900 mb-2">{language === 'ar' ? 'مسح الفواتير' : 'Scan Receipt'}</h2>
        <p className="text-gray-500">{language === 'ar' ? 'التقط أو ارفع إيصال التسوق الخاص بك للتحليل الفوري.' : 'Capture or upload your shopping receipt for instant analysis.'}</p>
      </div>

      {!isScanning && !result && (
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white border-2 border-dashed border-gray-200 rounded-[32px] p-12 text-center"
        >
          <div className="bg-blue-50 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6">
            <Upload className="w-10 h-10 text-blue-600" />
          </div>
          <h3 className="text-xl font-bold text-gray-900 mb-4">{language === 'ar' ? 'رفع من الجهاز' : 'Upload from device'}</h3>
          <p className="text-gray-500 mb-8 max-w-sm mx-auto">
            {language === 'ar' ? 'اسحب وأفلت صورة الإيصال هنا، أو استخدم الكاميرا لالتقاط صورة.' : 'Drag and drop your receipt image here, or use your camera to take a photo.'}
          </p>
          <div className="flex gap-4 justify-center">
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleFileUpload} 
              accept="image/*" 
              className="hidden" 
            />
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  className="px-8 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold transition-all shadow-lg shadow-blue-200 flex items-center gap-2"
                >
                  <Camera className="w-5 h-5" />
                  {language === 'ar' ? 'التقاط صورة' : 'Capture Photo'}
                </button>
          </div>
        </motion.div>
      )}

      {isScanning && (
        <div className="bg-white rounded-[32px] p-12 text-center shadow-lg border border-gray-100">
          <div className="relative w-32 h-32 mx-auto mb-8">
            <div className="absolute inset-0 border-4 border-gray-100 rounded-full"></div>
            <motion.div 
              className="absolute inset-0 border-4 border-blue-600 rounded-full"
              style={{ borderTopColor: 'transparent', borderLeftColor: 'transparent' }}
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
            />
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="w-10 h-10 text-blue-600 animate-spin" />
            </div>
          </div>
          <h3 className="text-2xl font-bold text-gray-900 mb-2">
            {pipelineState === 'PRE_PROCESSING' && (language === 'ar' ? 'معالجة الصورة...' : 'Stage 1: Pre-processing Image...')}
            {pipelineState === 'OCR' && (language === 'ar' ? 'استخراج النصوص (عربي/إنجليزي)...' : 'Stage 2: OCR (Auto-Language)...')}
            {pipelineState === 'BRAIN' && (language === 'ar' ? 'تحليل البيانات والمخطط...' : 'Stage 3: Layout Transformer Brain...')}
            {pipelineState === 'VALIDATION' && (language === 'ar' ? 'التحقق من البيانات...' : 'Stage 4: Precision Validation...')}
          </h3>
          <p className="text-gray-500 max-w-sm mx-auto">
            {pipelineState === 'PRE_PROCESSING' && (language === 'ar' ? 'تحسين جودة الصورة لزيادة دقة القراءة.' : 'Enhancing document quality and contrast (Private & Local).')}
            {pipelineState === 'OCR' && (language === 'ar' ? 'تحويل البكسلات إلى نصوص عربية وإنجليزية.' : 'Using Hybrid OCR to identify multilingual characters.')}
            {pipelineState === 'BRAIN' && (language === 'ar' ? 'تحديد مجالات الأسعار والكميات والأصناف.' : 'Mapping layout coordinates to identify products and unit prices.')}
            {pipelineState === 'VALIDATION' && (language === 'ar' ? 'مطابقة المجاميع والتأكد من الدقة الحسابية.' : 'Running logic checks (Summation & Precision cross-check).')}
          </p>
          <div className="mt-8 w-full max-w-xs mx-auto bg-gray-100 h-2 rounded-full overflow-hidden">
            <motion.div 
              className="bg-blue-600 h-full"
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-100 text-red-600 p-4 rounded-2xl flex items-center gap-3">
          <AlertCircle className="w-5 h-5" />
          <p className="text-sm font-medium">{error}</p>
        </div>
      )}

      <AnimatePresence>
        {result && !isScanning && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-[32px] overflow-hidden shadow-sm border border-gray-100"
          >
            <div className="bg-blue-600 p-8 text-white">
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h3 className="text-2xl font-bold">{result.storeName}</h3>
                  <p className="text-blue-100 text-sm">{result.storeAddress}</p>
                </div>
                <div className="bg-white/20 p-3 rounded-2xl backdrop-blur-sm">
                  <Check className="w-6 h-6" />
                </div>
              </div>
              <div className="flex justify-between items-end">
                <div>
                  <p className="text-blue-100 text-xs uppercase font-bold tracking-widest mb-1">Total Amount</p>
                  <p className="text-4xl font-bold">${result.total.toFixed(2)}</p>
                  {result._usage && (
                    <p className="text-[10px] text-blue-200 mt-2 flex items-center gap-1.5 opacity-80">
                      <Sparkles className="w-3 h-3" />
                      {language === 'ar' ? 'تكلفة الذكاء الاصطناعي:' : 'AI Effort cost:'} 
                      <span className="font-bold underline">${(result._usage.estimatedPriceUSD || 0).toFixed(4)} USD</span>
                    </p>
                  )}
                </div>
                <div className="text-right">
                  <div className="flex items-center gap-2 justify-end mb-2">
                    <div className="bg-yellow-400 text-yellow-950 px-3 py-1 rounded-full text-xs font-black flex items-center gap-1 shadow-lg shadow-yellow-400/20 animate-bounce">
                      <Sparkles className="w-3 h-3" />
                      +{pointsEarned} POINTS
                    </div>
                  </div>
                  <p className="text-blue-100 text-xs uppercase font-bold tracking-widest mb-1">Purchase Info</p>
                  <p className="text-lg font-semibold">{new Date(result.date).toLocaleDateString()}</p>
                  {result.time && <p className="text-sm font-medium opacity-80">at {result.time}</p>}
                </div>
              </div>
            </div>

            <div className="p-8">
              <h4 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
                <FileText className="w-5 h-5 text-gray-400" />
                {language === 'ar' ? 'الأصناف المسجلة' : 'Items Recorded'}
              </h4>
              <div className="space-y-3">
                {result.items.map((item: any, idx: number) => (
                  <div key={idx} className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-900 line-clamp-1">{item.name}</p>
                      <div className="flex flex-wrap gap-2 mt-1">
                        <span className="text-[10px] font-black uppercase tracking-tighter text-blue-600 bg-blue-50 px-2 py-0.5 rounded-lg border border-blue-100">
                          {item.category}
                        </span>
                        {item.brand && (
                          <span className="text-[10px] font-black uppercase tracking-tighter text-gray-500 bg-white px-2 py-0.5 rounded-lg border border-gray-100">
                            {item.brand}
                          </span>
                        )}
                        {item.size && (
                          <span className="text-[10px] font-black uppercase tracking-tighter text-gray-400 bg-white px-2 py-0.5 rounded-lg border border-gray-100">
                            {item.size}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right ml-4">
                      <p className="font-bold text-gray-900 tabular-nums">${item.price.toFixed(2)}</p>
                      <p className="text-xs text-gray-400">{language === 'ar' ? 'الكمية' : 'Qty'}: {item.quantity}</p>
                    </div>
                  </div>
                ))}
              </div>
              <button 
                onClick={() => setResult(null)}
                className="mt-8 w-full py-4 bg-gray-900 hover:bg-black text-white rounded-2xl font-bold transition-all"
              >
                {language === 'ar' ? 'تم' : 'Done'}
              </button>
              
              {result._usage && (
                <div className="mt-4 pt-4 border-t border-gray-100 flex justify-between items-center text-[9px] text-gray-400 font-medium uppercase tracking-tighter">
                  <div className="flex gap-3">
                    <span>{language === 'ar' ? 'المدخلات:' : 'Input:'} {result._usage.promptTokens} tkn</span>
                    <span>{language === 'ar' ? 'المخرجات:' : 'Output:'} {result._usage.completionTokens} tkn</span>
                  </div>
                  <div className="text-gray-300 italic">
                    {language === 'ar' ? '* تقدير مبني على أسعار جوجل لغير الباقة المجانية' : '* Estimate based on Google non-free tier pricing'}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
