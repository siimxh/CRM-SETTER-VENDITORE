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
    { id: uid('esito'), label: 'Non in target',         isNoAnswer: false, isConversion: false, isDefault: true },
    { id: uid('esito'), label: 'Già con noi',           isNoAnswer: false, isConversion: false, isDefault: true },
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
    settings: defaultSettings(),

    // Registro link registrazioni call (solo sezione Venditore) — vedi renderCallRecordings
    // in app.js. Elenco semplice di { id, label, url, createdAt }, nessun'altra struttura.
    callRecordings: [],

    // --- Round Recupero No Show — sessione fissa/non eliminabile (vedi app.js,
    // renderRecoveryRoundScreen e dintorni) per richiamare i lead che hanno fatto no-show
    // sia in Setting (presentedStatus) sia in Venditore (dealStage). Ogni entry è agganciata
    // a un preciso appuntamento sorgente (sourceAppointmentId), non alla "persona" in
    // astratto: così rimuovere un lead dal round o risolverlo con un nuovo appuntamento non
    // blocca un futuro no-show sullo stesso nominativo, che genera una entry NUOVA da zero.
    recoveryRound: [],          // [{ id, sourceAppointmentId, sourceRole, clientName, phone,
                                 //    status: 'active'|'resolved'|'removed', callCount,
                                 //    lastInteractionAt, createdAt, notes: [], resolvedAppointmentId }]
    recoveryRoundActive: false, // true mentre l'utente è dentro la schermata a schermo intero del round
    recoveryRoundCurrentLeadId: null, // lead attualmente mostrato a schermo (stabile tra i re-render)

    // --- "Da richiamare" — lead da ririchiamare creati premendo l'esito "Da richiamare"
    // durante una sessione (vedi app.js, openCallbackModal/logCallAction/logCallbackCall).
    // Indipendente dal Round Recupero No Show: qui l'orario è scelto dall'utente (quick
    // button o personalizzato), non una rotazione automatica. Ogni entry:
    // { id, leadName, phone, scheduledAt, createdAt, createdDateKey, leadGroupId,
    //   sourcePipelineId, sourcePipelineName, sourceSessionId, status: 'pending'|'done',
    //   callCount, lastCalledAt, resolvedOutcomeLabel, resolvedAt,
    //   inCallAttempts, inCallRetryPending, inCallGroupId } — i campi inCall* sono stato
    // transitorio della singola chiamata in corso (vedi renderCallbackCallScreen).
    callbacks: [],
    callbackCallActiveId: null, // id del callback attualmente aperto a schermo intero (o null)

    // --- Round Conferme — richiama sistematicamente gli appuntamenti Setter di DOMANI
    // non ancora confermati/annullati (vedi app.js, renderConfirmRoundScreen e dintorni).
    // Due punti d'ingresso: "standalone" dal tasto in Appuntamenti (si chiude e basta alla
    // fine) oppure "pre-sessione", proposto con un Sì/No appena si avvia una sessione
    // normale (alla fine prosegue automaticamente nella sessione scelta — vedi
    // startSessionAction/beginPipelineSession).
    confirmRoundActive: false,           // true mentre si è nella schermata a schermo intero del round
    confirmRoundCurrentApptId: null,     // appuntamento attualmente mostrato (stabile tra i re-render)
    confirmRoundReturnMode: null,        // 'standalone' | 'session' — cosa fare quando il round finisce
    confirmRoundPendingPipelineId: null  // solo con returnMode 'session': pipeline da avviare a fine round
  };
}

/**
 * Riempie i campi nuovi (dealStage/notes/nextFollowUpDate, split Setter/Venditore) su
 * un appuntamento salvato con la vecchia struttura, senza perdere dati. Per righe
 * Venditore preesistenti, deriva un dealStage ragionevole dal vecchio
 * presentedStatus/closed così lo storico resta coerente col nuovo funnel invece di
 * apparire "vuoto": chiuso -> "chiuso", presentato ma non chiuso -> "trattativa",
 * mai presentato -> nessuno stato (l'utente lo classificherà quando riprende in mano
 * la riga — non possiamo distinguere in automatico un vecchio "no" da un no-show reale).
 */
function migrateAppointment(a) {
  const out = Object.assign({
    dealStage: null,
    notes: [],
    nextFollowUpDate: null,
    recoveredFromNoShow: false, // true se creato dal Round Recupero No Show (vedi app.js)
    recoveredFromRole: null,    // 'setter' | 'venditore' — dove è avvenuto il no-show originale

    // --- Appuntamento spostato (vedi app.js, openRescheduleModal) — il vecchio
    // appuntamento resta con esito "Spostato" e punta al nuovo (rescheduledToId); il
    // nuovo punta al vecchio (rescheduledFromId) e NON conta come appuntamento in più.
    rescheduledFromId: null,
    rescheduledToId: null,

    // --- Round Conferme (solo Setter, vedi app.js) — stato di rotazione/chiamata per
    // questo specifico appuntamento. confirmGroupId identifica "questa chiamata di
    // conferma" ai fini di computeStats (tutte le chiamate fatte per confermare QUESTO
    // appuntamento contano come 1 lead, anche se fatte in momenti diversi della giornata);
    // viene azzerato quando l'appuntamento viene spostato (è di fatto un nuovo slot).
    confirmGroupId: null,
    confirmCallAttempts: 0,      // tentativi consecutivi di "Non risposto" nel round (doppio squillo)
    confirmRetryPending: false,  // true mentre si mostra il banner "richiama subito" nel round
    confirmLastInteractionAt: null // usato per la rotazione "meno recentemente mostrato" nel round
  }, a);
  if (out.role === 'venditore' && !out.dealStage) {
    if (out.closed) out.dealStage = 'chiuso';
    else if (out.presentedStatus === 'presented') out.dealStage = 'trattativa';
  }
  if (!Array.isArray(out.notes)) out.notes = [];
  return out;
}

/**
 * Aggiunge alle pipeline già esistenti (salvate prima dell'introduzione di un nuovo
 * esito di default) gli esiti mancanti, così l'utente li vede subito senza dover
 * creare una nuova pipeline da zero. Il confronto è per label (case-insensitive,
 * trim) per non duplicare un esito che l'utente ha già, magari rinominato a mano.
 */
function ensureDefaultOutcomesOnPipelines(pipelines) {
  const mustHave = [
    { label: 'Non in target', isNoAnswer: false, isConversion: false },
    { label: 'Già con noi',   isNoAnswer: false, isConversion: false }
  ];
  return (pipelines || []).map(p => {
    const outcomes = Array.isArray(p.outcomes) ? p.outcomes.slice() : [];
    const existingLabels = outcomes.map(o => (o.label || '').trim().toLowerCase());
    mustHave.forEach(def => {
      if (!existingLabels.includes(def.label.toLowerCase())) {
        outcomes.push({
          id: uid('esito'),
          label: def.label,
          isNoAnswer: def.isNoAnswer,
          isConversion: def.isConversion,
          isDefault: true
        });
      }
    });
    return Object.assign({}, p, { outcomes });
  });
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

  out.pipelines = ensureDefaultOutcomesOnPipelines(out.pipelines);
  out.appointments = (parsed.appointments || []).map(migrateAppointment);
  out.callRecordings = Array.isArray(parsed.callRecordings) ? parsed.callRecordings : [];
  out.recoveryRound = Array.isArray(parsed.recoveryRound) ? parsed.recoveryRound : [];
  out.recoveryRoundActive = !!parsed.recoveryRoundActive;
  out.recoveryRoundCurrentLeadId = parsed.recoveryRoundCurrentLeadId || null;
  out.callbacks = Array.isArray(parsed.callbacks) ? parsed.callbacks : [];
  out.callbackCallActiveId = parsed.callbackCallActiveId || null;

  out.confirmRoundActive = !!parsed.confirmRoundActive;
  out.confirmRoundCurrentApptId = parsed.confirmRoundCurrentApptId || null;
  out.confirmRoundReturnMode = parsed.confirmRoundReturnMode || null;
  out.confirmRoundPendingPipelineId = parsed.confirmRoundPendingPipelineId || null;

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

