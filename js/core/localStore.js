/**
 * Local Storage Utility
 * Persistent client-side storage using IndexedDB with localStorage fallback
 * Handles both simple key-value storage and structured data
 */

const DB_NAME = "LogMateDB";
const DB_VERSION = 1;
const STORE_NAME = "cache";

let db = null;

/**
 * Initialize IndexedDB connection
 */
function initDB() {
  return new Promise((resolve, reject) => {
    if (db) {
      resolve(db);
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = event.target.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };
  });
}

/**
 * Store data in IndexedDB (with localStorage fallback)
 * @param {string} key - Storage key
 * @param {*} value - Value to store (will be JSON serialized)
 */
export async function setLocalStore(key, value) {
  try {
    // Try IndexedDB first
    const database = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction([STORE_NAME], "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(value, key);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        // Also backup to localStorage for quick access
        try {
          localStorage.setItem(`idb_${key}`, JSON.stringify(value));
        } catch (e) {
          console.warn("localStorage fallback failed:", e);
        }
        resolve();
      };
    });
  } catch (err) {
    console.warn("IndexedDB write failed, using localStorage:", err);
    try {
      localStorage.setItem(`idb_${key}`, JSON.stringify(value));
      return Promise.resolve();
    } catch (storageErr) {
      console.error("Both IndexedDB and localStorage failed:", storageErr);
      throw storageErr;
    }
  }
}

/**
 * Retrieve data from IndexedDB (with localStorage fallback)
 * @param {string} key - Storage key
 * @returns {Promise<*>} Stored value or null if not found
 */
export async function getLocalStore(key) {
  try {
    // Try IndexedDB first
    const database = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction([STORE_NAME], "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(key);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result ?? null);
    });
  } catch (err) {
    console.warn("IndexedDB read failed, trying localStorage:", err);
    try {
      const stored = localStorage.getItem(`idb_${key}`);
      return stored ? JSON.parse(stored) : null;
    } catch (parseErr) {
      console.warn("localStorage fallback also failed:", parseErr);
      return null;
    }
  }
}

/**
 * Remove a key from storage
 * @param {string} key - Storage key to remove
 */
export async function removeLocalStore(key) {
  try {
    const database = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction([STORE_NAME], "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(key);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        localStorage.removeItem(`idb_${key}`);
        resolve();
      };
    });
  } catch (err) {
    console.warn("IndexedDB delete failed:", err);
    localStorage.removeItem(`idb_${key}`);
  }
}

/**
 * Clear all storage
 */
export async function clearLocalStore() {
  try {
    const database = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction([STORE_NAME], "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        // Also clear all localStorage idb_* keys
        Object.keys(localStorage)
          .filter((k) => k.startsWith("idb_"))
          .forEach((k) => localStorage.removeItem(k));
        resolve();
      };
    });
  } catch (err) {
    console.warn("IndexedDB clear failed:", err);
    Object.keys(localStorage)
      .filter((k) => k.startsWith("idb_"))
      .forEach((k) => localStorage.removeItem(k));
  }
}

export default {
  setLocalStore,
  getLocalStore,
  removeLocalStore,
  clearLocalStore,
};
