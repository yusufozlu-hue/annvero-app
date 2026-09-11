/**
 * Minimal IndexedDB stand-in for Node transfer race tests.
 * No npm dependency. Serializes readwrite txs per DB name (IDB-like).
 * Loaded before handoff security tests via --import.
 */
function createFakeIndexedDB() {
  const databases = new Map(); // name -> { store: Map, rwChain: Promise }

  function ensureDb(name) {
    if (!databases.has(name)) {
      databases.set(name, { store: new Map(), rwChain: Promise.resolve() });
    }
    return databases.get(name);
  }

  class FakeRequest {
    constructor() {
      this.result = undefined;
      this.error = null;
      this.onsuccess = null;
      this.onerror = null;
    }
    _succeed(result) {
      this.result = result;
      queueMicrotask(() => this.onsuccess?.({ target: this }));
    }
    _fail(error) {
      this.error = error;
      queueMicrotask(() => this.onerror?.({ target: this }));
    }
  }

  class FakeObjectStore {
    constructor(dbState) {
      this._dbState = dbState;
      this._ops = [];
    }
    get(key) {
      const req = new FakeRequest();
      this._ops.push(() => {
        req._succeed(this._dbState.store.has(key) ? this._dbState.store.get(key) : undefined);
      });
      return req;
    }
    put(value) {
      const req = new FakeRequest();
      const key = value?.key;
      this._ops.push(() => {
        this._dbState.store.set(key, value);
        req._succeed(key);
      });
      return req;
    }
    delete(key) {
      const req = new FakeRequest();
      this._ops.push(() => {
        this._dbState.store.delete(key);
        req._succeed(undefined);
      });
      return req;
    }
    getAll() {
      const req = new FakeRequest();
      this._ops.push(() => {
        req._succeed([...this._dbState.store.values()]);
      });
      return req;
    }
    clear() {
      const req = new FakeRequest();
      this._ops.push(() => {
        this._dbState.store.clear();
        req._succeed(undefined);
      });
      return req;
    }
    _runOps() {
      for (const op of this._ops) op();
      this._ops = [];
    }
  }

  class FakeTransaction {
    constructor(dbState, mode) {
      this._dbState = dbState;
      this._mode = mode;
      this._store = new FakeObjectStore(dbState);
      this.oncomplete = null;
      this.onerror = null;
      this.onabort = null;
      this._aborted = false;
      this._started = false;
      queueMicrotask(() => this._start());
    }
    objectStore() {
      return this._store;
    }
    abort() {
      this._aborted = true;
    }
    async _start() {
      if (this._started) return;
      this._started = true;
      const run = async () => {
        if (this._aborted) {
          queueMicrotask(() => this.onabort?.({ target: this }));
          return;
        }
        try {
          // Drain ops across nested request microtasks (get → validate → delete)
          for (let i = 0; i < 32; i += 1) {
            this._store._runOps();
            await Promise.resolve();
            if (this._store._ops.length === 0) break;
          }
          this._store._runOps();
          if (this._aborted) {
            queueMicrotask(() => this.onabort?.({ target: this }));
            return;
          }
          queueMicrotask(() => this.oncomplete?.({ target: this }));
        } catch (error) {
          this.error = error;
          queueMicrotask(() => this.onerror?.({ target: this }));
        }
      };
      if (this._mode === "readwrite") {
        const prev = this._dbState.rwChain;
        let release;
        const gate = new Promise((r) => {
          release = r;
        });
        this._dbState.rwChain = prev.then(() => gate);
        await prev;
        try {
          await run();
        } finally {
          release();
        }
      } else {
        await run();
      }
    }
  }

  class FakeDB {
    constructor(name) {
      this.name = name;
      this._state = ensureDb(name);
      this.objectStoreNames = {
        contains: (n) => n === "datasets",
      };
    }
    transaction(_storeNames, mode = "readonly") {
      return new FakeTransaction(this._state, mode);
    }
    close() {}
  }

  return {
    open(name, _version) {
      const req = new FakeRequest();
      queueMicrotask(() => {
        req.result = new FakeDB(name);
        req.onsuccess?.({ target: req });
      });
      req.onupgradeneeded = null;
      return req;
    },
    __resetAll() {
      databases.clear();
    },
    __getStore(name) {
      return ensureDb(name).store;
    },
  };
}

const fake = createFakeIndexedDB();
globalThis.indexedDB = fake;
globalThis.__ANNVERO_FAKE_IDB__ = fake;
