/**
 * IndexedDB-backed `HeldSendStore` for the held-send core (see
 * `held-sends.ts`). Its own database, like the v2, backup and catch-up
 * stores, so opening it never waits on another tab's connection to a
 * different database.
 */
import type {
  HeldSendRecord,
  HeldSendState,
  HeldSendStore,
} from "./held-sends";

const DB_NAME = "npic-e2e-held-sends";
const DB_VERSION = 1;
const ITEMS = "items"; // keyPath: clientMessageId
const RECIPIENT_INDEX = "byRecipient";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(ITEMS)) {
        const store = req.result.createObjectStore(ITEMS, {
          keyPath: "clientMessageId",
        });
        store.createIndex(RECIPIENT_INDEX, "recipientId");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function createIndexedDbHeldSendStore<P>(): HeldSendStore<P> {
  return {
    async put(record) {
      const db = await openDb();
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(ITEMS, "readwrite");
          tx.objectStore(ITEMS).put(record);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        });
      } finally {
        db.close();
      }
    },

    async get(clientMessageId) {
      const db = await openDb();
      try {
        const row = await new Promise<HeldSendRecord<P> | undefined>(
          (resolve, reject) => {
            const req = db
              .transaction(ITEMS, "readonly")
              .objectStore(ITEMS)
              .get(clientMessageId);
            req.onsuccess = () =>
              resolve(req.result as HeldSendRecord<P> | undefined);
            req.onerror = () => reject(req.error);
          },
        );
        return row ?? null;
      } finally {
        db.close();
      }
    },

    async delete(clientMessageId) {
      const db = await openDb();
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(ITEMS, "readwrite");
          tx.objectStore(ITEMS).delete(clientMessageId);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        });
      } finally {
        db.close();
      }
    },

    async list(recipientId) {
      const db = await openDb();
      try {
        return await new Promise<HeldSendRecord<P>[]>((resolve, reject) => {
          const store = db.transaction(ITEMS, "readonly").objectStore(ITEMS);
          const req =
            recipientId === undefined
              ? store.getAll()
              : store.index(RECIPIENT_INDEX).getAll(recipientId);
          req.onsuccess = () => resolve(req.result as HeldSendRecord<P>[]);
          req.onerror = () => reject(req.error);
        });
      } finally {
        db.close();
      }
    },

    async setState(clientMessageId, state: HeldSendState) {
      const db = await openDb();
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(ITEMS, "readwrite");
          const store = tx.objectStore(ITEMS);
          const req = store.get(clientMessageId);
          req.onsuccess = () => {
            const row = req.result as HeldSendRecord<P> | undefined;
            if (row) store.put({ ...row, state });
          };
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        });
      } finally {
        db.close();
      }
    },
  };
}
