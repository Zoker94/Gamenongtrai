// Caches the pre-rendered ground (chunk images) in IndexedDB so returning
// players skip the expensive ground render. The key changes with every build,
// so a new deploy always re-renders once.

const DB = 'gnt-cache', STORE = 'ground';

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export async function loadGround(mapId: string): Promise<ImageBitmap[] | null> {
  try {
    const db = await open();
    const blobs = await new Promise<Blob[] | undefined>((res, rej) => {
      const q = db.transaction(STORE).objectStore(STORE).get(mapId + ':' + __BUILD_ID__);
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    });
    db.close();
    if (!blobs || !blobs.length) return null;
    return await Promise.all(blobs.map((b) => createImageBitmap(b)));
  } catch {
    return null;
  }
}

export async function saveGround(mapId: string, blobs: Blob[]) {
  try {
    const db = await open();
    const tx = db.transaction(STORE, 'readwrite');
    const st = tx.objectStore(STORE);
    st.clear(); // keep only the current build
    st.put(blobs, mapId + ':' + __BUILD_ID__);
    await new Promise((res) => { tx.oncomplete = res; tx.onerror = res; });
    db.close();
  } catch { /* private mode / quota: just skip caching */ }
}
