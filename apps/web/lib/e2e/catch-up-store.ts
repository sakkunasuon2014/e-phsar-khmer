/**
 * Progress marks for the background catch-up decrypt (see catch-up.ts): per
 * conversation, the newest message id such that it and everything older has
 * been handled. Its own IndexedDB (like the v2 and backup stores) so opening
 * it never waits on another tab's connection to a different database.
 *
 * A mark is only a hint to skip re-reading history. Losing it (cleared data,
 * a new device) costs a re-walk; decrypting is idempotent, so it never costs
 * correctness.
 */
const DB_NAME = "npic-e2e-catchup";
const DB_VERSION = 1;
const MARKS = "marks"; // keyPath: conversationId

interface MarkRow {
  conversationId: string;
  messageId: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(MARKS))
        req.result.createObjectStore(MARKS, { keyPath: "conversationId" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getCatchUpMark(
  conversationId: string,
): Promise<string | null> {
  const db = await openDb();
  try {
    const row = await new Promise<MarkRow | undefined>((resolve, reject) => {
      const req = db
        .transaction(MARKS, "readonly")
        .objectStore(MARKS)
        .get(conversationId);
      req.onsuccess = () => resolve(req.result as MarkRow | undefined);
      req.onerror = () => reject(req.error);
    });
    return row?.messageId ?? null;
  } finally {
    db.close();
  }
}

export async function setCatchUpMark(
  conversationId: string,
  messageId: string,
): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(MARKS, "readwrite");
      tx.objectStore(MARKS).put({
        conversationId,
        messageId,
      } satisfies MarkRow);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
