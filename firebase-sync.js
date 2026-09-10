/* firebase-sync.js — sincronizzazione opzionale dei dati su Firebase (Firestore).
 *
 * Facoltativo: se non configurato, il tool continua a funzionare esattamente
 * come prima, salvando solo nel browser (localStorage). Quando lo configuri
 * (pulsante ⚙ in alto), ogni salvataggio viene anche copiato su Firestore, e
 * all'apertura della pagina viene scaricata l'ultima versione dal cloud — così
 * puoi usare lo stesso "codice stanza" su più dispositivi senza dover fare
 * export/import manuale.
 *
 * Nota: è una sincronizzazione "ultimo salvataggio vince", non realtime — se
 * lavori da due dispositivi contemporaneamente l'ultimo che salva sovrascrive
 * l'altro. Per come si usa il tool (una sessione di chiamate per volta, su un
 * solo dispositivo) va benissimo.
 */

const FB_SETTINGS_KEY = 'chiamateTrackerFirebaseConfig_v1';
const FIREBASE_SDK_VERSION = '10.14.1';
const FIREBASE_CDN_BASE = `https://cdn.jsdelivr.net/npm/firebase@${FIREBASE_SDK_VERSION}`;

let _fsInstance = null;
let _fsDocRef = null;
let _fsInitPromise = null;

async function _loadFirebaseModules() {
  const [{ initializeApp, getApps, getApp }, firestoreMod] = await Promise.all([
    import(`${FIREBASE_CDN_BASE}/firebase-app.js`),
    import(`${FIREBASE_CDN_BASE}/firebase-firestore.js`)
  ]);
  return { initializeApp, getApps, getApp, ...firestoreMod };
}

const FirebaseSync = {
  getSettings() {
    try {
      const raw = localStorage.getItem(FB_SETTINGS_KEY);
      if (!raw) return { enabled: false, config: null, roomCode: '' };
      return Object.assign({ enabled: false, config: null, roomCode: '' }, JSON.parse(raw));
    } catch (e) {
      return { enabled: false, config: null, roomCode: '' };
    }
  },

  saveSettings(settings) {
    localStorage.setItem(FB_SETTINGS_KEY, JSON.stringify(settings));
    // forza una nuova inizializzazione al prossimo utilizzo (config/room possono essere cambiati)
    _fsInstance = null;
    _fsDocRef = null;
    _fsInitPromise = null;
  },

  isConfigured() {
    const s = this.getSettings();
    return !!(s.enabled && s.config && s.roomCode);
  },

  async _ensureDocRef() {
    if (_fsDocRef) return _fsDocRef;
    if (_fsInitPromise) return _fsInitPromise;

    const settings = this.getSettings();
    if (!settings.enabled || !settings.config || !settings.roomCode) return null;

    _fsInitPromise = (async () => {
      const { initializeApp, getFirestore, doc } = await _loadFirebaseModules();
      const app = initializeApp(settings.config);
      _fsInstance = getFirestore(app);
      _fsDocRef = doc(_fsInstance, 'chiamateTracker', settings.roomCode);
      return _fsDocRef;
    })();

    try {
      return await _fsInitPromise;
    } catch (e) {
      _fsInitPromise = null;
      throw e;
    }
  },

  /** Scrive l'intero stato locale su Firestore (sovrascrive il documento della stanza). */
  async push(data) {
    const ref = await this._ensureDocRef();
    if (!ref) return { ok: false, reason: 'not_configured' };
    const { setDoc } = await _loadFirebaseModules();
    await setDoc(ref, { json: JSON.stringify(data), updatedAt: Date.now() });
    return { ok: true };
  },

  /** Legge l'ultimo stato salvato su Firestore per questa stanza (null se non esiste ancora). */
  async pull() {
    const ref = await this._ensureDocRef();
    if (!ref) return { ok: false, reason: 'not_configured' };
    const { getDoc } = await _loadFirebaseModules();
    const snap = await getDoc(ref);
    if (!snap.exists()) return { ok: true, data: null };
    const raw = snap.data();
    try {
      return { ok: true, data: JSON.parse(raw.json), updatedAt: raw.updatedAt };
    } catch (e) {
      return { ok: false, reason: 'bad_data' };
    }
  },

  /** Prova una connessione con una config/roomCode non ancora salvati (per il pulsante "Verifica connessione"). */
  async testConnection(config, roomCode) {
    const { initializeApp, getFirestore, doc, getDoc } = await _loadFirebaseModules();
    const app = initializeApp(config, 'connection-test-' + Date.now());
    const testDb = getFirestore(app);
    const ref = doc(testDb, 'chiamateTracker', roomCode || '__test__');
    await getDoc(ref);
    return true;
  }
};
