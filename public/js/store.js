// Artwork storage in the browser (IndexedDB): the Gallery's artworks and their layers.
// A record holds the document's settings, its layers (each one a PNG blob) and a small thumbnail.
// Everything stays on this device.

const DB = 'promove';
const STORE = 'artworks';
let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

const run = async (mode, fn) => {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const out = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(out?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
};

export const store = {
  available: typeof indexedDB !== 'undefined',
  put: (record) => run('readwrite', (s) => s.put(record)),
  get: (id) => run('readonly', (s) => s.get(id)),
  remove: (id) => run('readwrite', (s) => s.delete(id)),
  // Every record without its layer pictures, newest first, for the Gallery grid.
  async list() {
    const all = await run('readonly', (s) => s.getAll());
    return (all || [])
      .map(({ layers, ...meta }) => ({ ...meta, layerCount: layers?.length || 0 }))
      .sort((a, b) => b.modified - a.modified);
  },
};

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export const canvasToBlob = (canvas, type = 'image/png', quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));

export async function blobToCanvas(blob, w, h) {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = w || bmp.width;
  c.height = h || bmp.height;
  c.getContext('2d').drawImage(bmp, 0, 0);
  bmp.close?.();
  return c;
}
