// ═══════════════════════════════════════════════════════════════════════════
// DB — IndexedDB persistence layer for Loom
// ═══════════════════════════════════════════════════════════════════════════
// Two object stores:
//   agents — { id, config, messages, color } keyed by id
//   meta   — { key, value } keyed by key (ringBuffer, pipelines, sandboxes, customTools)

const DB_NAME = 'loom';
const DB_VERSION = 1;

let _db = null;

function req(idbReq) {
    return new Promise((resolve, reject) => {
        idbReq.onsuccess = () => resolve(idbReq.result);
        idbReq.onerror = () => reject(idbReq.error);
    });
}

function tx(idbTx) {
    return new Promise((resolve, reject) => {
        idbTx.oncomplete = () => resolve();
        idbTx.onerror = () => reject(idbTx.error);
        idbTx.onabort = () => reject(idbTx.error || new Error('Transaction aborted'));
    });
}

export async function openDB() {
    if (_db) return _db;
    _db = await new Promise((resolve, reject) => {
        const r = indexedDB.open(DB_NAME, DB_VERSION);
        r.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('agents'))
                db.createObjectStore('agents', { keyPath: 'id' });
            if (!db.objectStoreNames.contains('meta'))
                db.createObjectStore('meta', { keyPath: 'key' });
        };
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
    });
    return _db;
}

export async function getAllAgents() {
    const db = await openDB();
    return req(db.transaction('agents').objectStore('agents').getAll());
}

export async function getMeta(key) {
    const db = await openDB();
    const record = await req(db.transaction('meta').objectStore('meta').get(key));
    return record?.value;
}

export async function putMeta(key, value) {
    const db = await openDB();
    const t = db.transaction('meta', 'readwrite');
    t.objectStore('meta').put({ key, value });
    return tx(t);
}

export async function deleteMeta(key) {
    const db = await openDB();
    const t = db.transaction('meta', 'readwrite');
    t.objectStore('meta').delete(key);
    return tx(t);
}

// Batch-write all agents + meta entries in a single transaction
export async function saveAll(agents, meta) {
    const db = await openDB();
    const t = db.transaction(['agents', 'meta'], 'readwrite');
    const agentStore = t.objectStore('agents');
    const metaStore = t.objectStore('meta');

    agentStore.clear();
    for (const agent of agents) agentStore.put(agent);

    for (const [k, v] of Object.entries(meta))
        metaStore.put({ key: k, value: v });

    return tx(t);
}

export async function clearAll() {
    const db = await openDB();
    const t = db.transaction(['agents', 'meta'], 'readwrite');
    t.objectStore('agents').clear();
    t.objectStore('meta').clear();
    return tx(t);
}
