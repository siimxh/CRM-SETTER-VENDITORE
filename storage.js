/* storage.js — livello dati: localStorage + strutture di default */

const STORAGE_KEY = 'chiamateTrackerData_v1';

function uid(prefix) {
  prefix = prefix || 'id';
  if (window.crypto && crypto.randomUUID) return prefix + '_' + crypto.randomUUID();
  return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
}

/**
 * Esiti di default per una nuova pipeline (vedi screenshot "esiti").
 * isNoAnswer = "nessuna risposta": selezionare un esito con questo flag apre
 * automaticamente la finestra di "seconda chiamata" sullo stesso lead (vedi app.js).
 */
function defaultOutcomesList() {
  return [
    { id: uid('esito'), label: 'Non risp',            isNoAnswer: true,  isConversion: false, isDefault: true },
    { id: uid('esito'), label: 'Da richiamare',        isNoAnswer: false, isConversion: false, isDefault: true },
    { id: uid('esito'), label: 'Fake',                 isNoAnswer: false, isConversion: false, isDefault: true },
    { id: uid('esito'), label: 'Appuntamento Fissato',  isNoAnswer: false, isConversion: true,  isDefault: true },
    { id: uid('esito'), label: 'Non interessato',       isNoAnswer: false, isConversion: false, isDefault: true },
    { id: uid('esito'), label: 'conferma appuntamento', isNoAnswer: false, isConversion: true,  isDefault: true },
  ];
}

/**
 * Frasi motivazionali per il toggle "Frase motivazionale del giorno" (builder,
 * opzione 8). L'indice mostrato è dayOfYear % lunghezza array, quindi la stessa
 * frase resta stabile per tutto il giorno solare corrente (vedi utils.js:dayOfYear).
 */
function motivationalQuotes() {
  return [
    'Ogni chiamata in più è un appuntamento in più domani.',
    'Il "no" di oggi paga la commissione di domani.',
    'Chi fissa di più, chiude di più.',
    'La costanza batte il talento quando il talento non è costante.',
    'Un appuntamento presentato vale più di dieci pianificati.',
    'Le vendite si fanno con la disciplina, non con la fortuna.',
    'Oggi è un altro giorno per battere il tuo record.',
    'Il cliente compra la tua sicurezza, non solo il prodotto.',
    'Chi molla al decimo "no" perde l\'undicesimo "sì".',
    'La pipeline piena di oggi è il conto in banca di domani.',
    'Non serve motivazione, serve un obiettivo scritto e un telefono in mano.',
    'Ogni show-up è una prova che il metodo funziona.',
    'Le rate pagate valgono quanto le rate chiuse: segui anche gli incassi.',
    'Il ritmo giusto oggi evita lo sprint disperato a fine mese.',
    'Un venditore fullstack setta E chiude: oggi fai entrambe le cose bene.'
  ];
}

/**
 * Nuovo default per una riga di goals (funnel Setter e Venditore), per un singolo
 * timeframe (month/week/day). I target sono impostabili dall'utente in dashboard;
 * partono a 0 (nessun obiettivo impostato) finché l'utente non li edita.
 */
function defaultGoalSet() {
  return {
    appuntamentiFissati: 0, // solo Setter
    presentati: 0,
    chiusi: 0,
    commissioniShowUp: 0,    // solo Setter (EUR)
    commissioniChiusure: 0,  // EUR
    commissioniTot: 0        // EUR
  };
}

function defaultGoals() {
  return {
    setter: { month: defaultGoalSet(), week: defaultGoalSet(), day: defaultGoalSet() },
    venditore: { month: defaultGoalSet(), week: defaultGoalSet(), day: defaultGoalSet() }
  };
}

/** Palette di default "S5 — Graphite & Lime" (vedi anche i preset in app.js). */
function defaultSettings() {
  return {
    preset: 'graphite-lime',
    colors: {
      bg: '#17181a',
      bgElev: '#1e2022',
      accent: '#c6ff3d',
      text: '#f5f6f2',
      setterColor: '#c6ff3d',
      venditoreColor: '#7fd9ff',
      success: '#c6ff3d',
      danger: '#ff5c5c'
    },
    radiusStyle: 'sharp',
    fontStyle: 'archivo',
    accentSaturation: 86,
    cardContrast: 70,
    glowLevel: 'border',
    cashDayThreshold: 500,
    toggles: {
      grindMode: false,
      animatedNumbers: false,
      closeSound: false,
      dailyStreak: false,
      confetti: false,
      autoTheme: false,
      monthCountdown: false,
      dailyQuote: false,
      closingPace: false,
      personalBest: false,
      midMilestone: false,
      liveTicker: false,
      bossMode: false,
      levelUpSound: false,
      cashDayBadge: false,
      slotMachineNumbers: false
    }
  };
}

function defaultData() {
  return {
    pipelines: [],       // { id, name, createdAt, outcomes: [...] }
    sessions: [],         // sessioni concluse
    activeSession: null,  // sessione in corso (o null)
    sessionCounter: 0,

    // --- Mini-CRM appuntamenti (setter/venditore) — sistema parallelo, indipendente
    // dalle sessioni/pipeline di chiamata outbound qui sopra. Vedi struttura riga
    // in app.js (newAppointment) e le regole di calcolo commissioni in utils.js.
    appointments: [],
    goals: defaultGoals(),
    settings: defaultSettings()
  };
}

/**
 * Merge "profondo ma mirato" dei dati salvati sopra i default: necessario perché
 * defaultData() ora contiene oggetti annidati (goals.setter.month, settings.toggles, ...)
 * e un semplice Object.assign(defaultData(), parsed) sovrascriverebbe l'intero ramo
 * annidato con quello salvato, perdendo eventuali chiavi nuove aggiunte in un
 * aggiornamento successivo (es. un nuovo toggle) per chi ha già dati salvati.
 */
function mergeWithDefaults(parsed) {
  const base = defaultData();
  const out = Object.assign({}, base, parsed);

  out.goals = Object.assign({}, base.goals, parsed.goals);
  ['setter', 'venditore'].forEach(role => {
    out.goals[role] = Object.assign({}, base.goals[role], (parsed.goals || {})[role]);
    ['month', 'week', 'day'].forEach(tf => {
      out.goals[role][tf] = Object.assign({}, base.goals[role][tf], ((parsed.goals || {})[role] || {})[tf]);
    });
  });

  out.settings = Object.assign({}, base.settings, parsed.settings);
  out.settings.colors = Object.assign({}, base.settings.colors, (parsed.settings || {}).colors);
  out.settings.toggles = Object.assign({}, base.settings.toggles, (parsed.settings || {}).toggles);

  return out;
}

const Storage = {
  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultData();
      const parsed = JSON.parse(raw);
      return mergeWithDefaults(parsed);
    } catch (e) {
      console.error('Errore lettura dati locali', e);
      return defaultData();
    }
  },
  save(data) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.error('Errore salvataggio dati locali', e);
      if (typeof showToast === 'function') {
        showToast('Impossibile salvare i dati nel browser. Esporta un backup se possibile.', true);
      }
    }
  }
};
