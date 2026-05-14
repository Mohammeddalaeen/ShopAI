import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { 
  initializeFirestore, 
  doc, 
  getDocFromServer, 
  collection, 
  getDocs, 
  deleteDoc, 
  writeBatch,
  getFirestore
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Use initializeFirestore for forced long polling (crucial for iframe stability)
// Added more connectivity options to fix "unavailable" errors in restricted networks
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
}, firebaseConfig.firestoreDatabaseId || '(default)');

// Add a connection health checker that the UI can use
export const checkConnection = async () => {
  try {
    await getDocFromServer(doc(db, '_health', 'check'));
    return true;
  } catch (error: any) {
    console.error("Firestore Health Check Failed:", error?.code, error?.message);
    return false;
  }
};

const googleProvider = new GoogleAuthProvider();

export const signInWithGoogle = async () => {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  } catch (error) {
    console.error("Error signing in with Google", error);
    throw error;
  }
};

export const logout = () => signOut(auth);

export const clearAllData = async () => {
  const collections = ['users', 'invoices', 'items', 'budgets', 'shopping_list', 'store_selections'];
  const results = [];
  
  console.log("Starting full database wipe...");
  
  for (const colName of collections) {
    try {
      // Use getDocs with a shorter timeout if we can, but getDocs doesn't support timeout directly
      // instead we rely on the client state
      const querySnapshot = await getDocs(collection(db, colName));
      const docs = querySnapshot.docs;
      
      if (docs.length === 0) {
        results.push({ collection: colName, status: 'already_empty', count: 0 });
        continue;
      }

      console.log(`Deleting ${docs.length} docs from ${colName}...`);

      // Delete in batches of 500 (Firestore limit)
      const batchSize = 500;
      for (let i = 0; i < docs.length; i += batchSize) {
        const batch = writeBatch(db);
        const chunk = docs.slice(i, i + batchSize);
        chunk.forEach(d => {
          batch.delete(d.ref);
        });
        await batch.commit();
      }
      
      results.push({ collection: colName, status: 'cleared', count: docs.length });
    } catch (error: any) {
      console.error(`Error clearing collection ${colName}:`, error);
      results.push({ 
        collection: colName, 
        status: 'error', 
        error: error?.message || String(error),
        code: error?.code
      });
      // If we get an "unavailable" error, we might want to stop the loop
      if (error?.code === 'unavailable') {
        console.error("Firestore is unavailable. Aborting wipe.");
        break;
      }
    }
  }
  return results;
};
