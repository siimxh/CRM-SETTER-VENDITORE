/* utils.js — helper per date, timeframe, formattazione e aggregazione statistiche */

function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function endOfDay(d) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }

const TIMEFRAME_LABELS = {
  oggi: 'Oggi',
  ieri: 'Ieri',
  '7g': '7 giorni',
  '30g': '30 giorni',
  '90g': '90 giorni',
  mese_corrente: 'Mese corrente',
  mese_scorso: 'Mese scorso',
  custom: 'Periodo personalizzato'
};

function getTimeframeRange(preset, customFrom, customTo) {
  const now = new Date();
  switch (preset) {
    case 'oggi':
      return { start: startOfDay(now), end: endOfDay(now) };
    case 'ieri': {
      const y = new Date(now); y.setDate(y.getDate() - 1);
      return { start: startOfDay(y), end: endOfDay(y) };
    }
    case '7g': {
      const s = new Date(now); s.setDate(s.getDate() - 6);
      return { start: startOfDay(s), end: endOfDay(now) };
    }
    case '30g': {
      const s = new Date(now); s.setDate(s.getDate() - 29);
      return { start: startOfDay(s), end: endOfDay(now) };
    }
    case '90g': {
      const s = new Date(now); s.setDate(s.getDate() - 89);
      return { start: startOfDay(s), end: endOfDay(now) };
    }
    case 'mese_corrente': {
      const s = new Date(now.getFullYear(), now.getMonth(), 1);
      return { start: startOfDay(s), end: endOfDay(now) };
    }
    case 'mese_scorso': {
      const s = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const e = new Date(now.getFullYear(), now.getMonth(), 0);
      return { start: startOfDay(s), end: endOfDay(e) };
    }
    case 'custom': {
      if (!customFrom || !customTo) return { start: startOfDay(now), end: endOfDay(now) };
      return { start: startOfDay(new Date(customFrom)), end: endOfDay(new Date(customTo)) };
    }
    default:
      return { start: startOfDay(now), end: endOfDay(now) };
  }
}

/** Periodo immediatamente precedente, della stessa durata, usato per l'andamento. */
function previousPeriod(range) {
  const durationMs = range.end.getTime() - range.start.getTime();
  const prevEnd = new Date(range.start.getTime() - 1);
  const prevStart = new Date(prevEnd.getTime() - durationMs);
  return { start: prevStart, end: prevEnd };
}

function fmtDate(d) { return new Date(d).toLocaleDateString('it-IT'); }
function fmtDateTime(d) {
  return new Date(d).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function fmtTime(d) {
  return new Date(d).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

function fmtDuration(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function pct(n, d) { return d > 0 ? Math.round((n / d) * 1000) / 10 : 0; }
function round1(n) { return Math.round(n * 10) / 10; }

/**
 * "Domani alle 9:00" / "Oggi alle 15:00" / "07/10 alle 9:00" — usato nel Round Conferme
 * per mostrare l'orario dell'appuntamento in modo immediato durante la chiamata (vedi
 * renderConfirmRoundScreen in app.js), evitando di dover fare il calcolo a mente.
 */
function fmtRelativeDayTime(d) {
  const target = new Date(d);
  const targetKey = dateInputValue(target);
  const todayKey = dateInputValue(new Date());
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowKey = dateInputValue(tomorrow);
  const timeStr = fmtTime(target);
  if (targetKey === todayKey) return `Oggi alle ${timeStr}`;
  if (targetKey === tomorrowKey) return `Domani alle ${timeStr}`;
  return `${fmtDate(target)} alle ${timeStr}`;
}

function dateInputValue(d) {
  const x = new Date(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, '0');
  const day = String(x.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Ritorna le sessioni (concluse) che ricadono nel range e, se richiesto, in una pipeline specifica. */
function getFilteredSessions(db, range, pipelineId) {
  return db.sessions.filter(s => {
    const started = new Date(s.startedAt);
    if (started < range.start || started > range.end) return false;
    if (pipelineId && pipelineId !== 'all' && s.pipelineId !== pipelineId) return false;
    return true;
  });
}

/**
 * Calcola le statistiche aggregate per un insieme di sessioni.
 *
 * Ogni voce in session.calls è UNA telefonata reale (un dial). Una voce con
 * isSecondAttempt=true è il richiamo dello stesso lead subito dopo un esito
 * "nessuna risposta" (vedi logCallAction in app.js) e va raggruppata con la
 * chiamata precedente: conta come chiamata in più, ma non come nuovo lead.
 *
 * CORREZIONE (segnalata dall'utente): "Esiti nel periodo" deve contare LEAD UNICI, non
 * singole chiamate — un lead richiamato 2-3 volte (max MAX_CALL_ATTEMPTS) perché non
 * risponde va contato UNA volta sola come "Non risp", non una volta per ogni tentativo
 * (altrimenti il numero di "Non risp" può superare il numero di lead contattati). Per
 * ogni lead si usa l'esito dell'ULTIMO tentativo (quello "definitivo" per quel lead).
 *
 * Raggruppamento per groupId: ogni chiamata "di apertura" su un lead riceve un groupId
 * univoco (vedi logCallAction/logCallbackCall in app.js); i tentativi immediati di
 * richiamo (isSecondAttempt) riusano lo stesso groupId. Per i lead "Da richiamare"
 * richiamati più tardi (anche in un'altra sessione, es. la sessione automatica
 * "Richiami" del giorno — vedi appendCallbackCallToSession), la chiamata di richiamo
 * riusa lo STESSO groupId del lead originale se il richiamo avviene lo stesso giorno in
 * cui è diventato "da richiamare" (così non si conta un lead in più), oppure riceve un
 * groupId NUOVO se avviene un giorno diverso (conta giustamente come lead del giorno in
 * cui lo richiami). Le chiamate più vecchie senza groupId (dati salvati prima di questa
 * modifica) usano il vecchio raggruppamento posizionale isSecondAttempt come fallback.
 */
function computeStats(sessions) {
  let totalCalls = 0, totalDurationMs = 0, totalSkips = 0;
  const leads = []; // ogni elemento raggruppa le chiamate (1 o più) fatte allo stesso lead
  const groupIndexByGroupId = {}; // groupId -> indice in leads[], valido su TUTTE le sessioni passate

  sessions.forEach(s => {
    const end = s.endedAt ? new Date(s.endedAt) : new Date();
    totalDurationMs += Math.max(0, end.getTime() - new Date(s.startedAt).getTime());
    totalSkips += s.skips || 0;
    totalCalls += s.calls.length;

    let currentLead = null;
    s.calls.forEach(c => {
      if (c.groupId) {
        if (Object.prototype.hasOwnProperty.call(groupIndexByGroupId, c.groupId)) {
          leads[groupIndexByGroupId[c.groupId]].push(c);
        } else {
          groupIndexByGroupId[c.groupId] = leads.length;
          leads.push([c]);
        }
      } else if (c.isSecondAttempt && currentLead) {
        currentLead.push(c);
      } else {
        currentLead = [c];
        leads.push(currentLead);
      }
    });
  });

  // Esiti per LEAD UNICO (non per chiamata): ogni lead conta una volta, con l'esito
  // del suo ultimo tentativo (ordinato per timestamp: le chiamate di un lead possono
  // arrivare da sessioni diverse processate fuori ordine cronologico).
  const outcomeCounts = {};
  leads.forEach(calls => {
    const sorted = calls.length > 1 ? [...calls].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)) : calls;
    const last = sorted[sorted.length - 1];
    outcomeCounts[last.outcomeLabel] = (outcomeCounts[last.outcomeLabel] || 0) + 1;
  });

  const totalLeads = leads.length;
  // Un lead conta come "senza risposta" solo se NESSUNO dei tentativi ha avuto risposta.
  const noAnswer = leads.filter(calls => calls.every(c => c.isNoAnswer)).length;
  const conversion = leads.filter(calls => calls.some(c => c.isConversion)).length;

  const sortedOutcomes = Object.entries(outcomeCounts).sort((a, b) => b[1] - a[1]);
  const mostFrequent = sortedOutcomes[0] ? { label: sortedOutcomes[0][0], count: sortedOutcomes[0][1] } : null;
  const durationHours = totalDurationMs / 3600000;

  return {
    totalCalls,
    totalLeads,
    noAnswer,
    conversion,
    totalSkips,
    responseRate: pct(totalLeads - noAnswer, totalLeads),
    conversionRate: pct(conversion, totalLeads),
    outcomeCounts,
    sortedOutcomes,
    mostFrequent,
    sessionsCount: sessions.length,
    avgCallsPerSession: sessions.length ? round1(totalCalls / sessions.length) : 0,
    avgLeadsPerSession: sessions.length ? round1(totalLeads / sessions.length) : 0,
    totalDurationMs,
    callsPerHour: durationHours > 0.0166 ? round1(totalCalls / durationHours) : 0
  };
}

/** Variazione percentuale tra due valori, per le card di andamento. */
function trendDelta(current, previous) {
  if (previous === 0) {
    if (current === 0) return { diff: 0, dir: 'flat' };
    return { diff: 100, dir: 'up' };
  }
  const diff = round1(((current - previous) / previous) * 100);
  return { diff: Math.abs(diff), dir: diff > 0 ? 'up' : (diff < 0 ? 'down' : 'flat') };
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ============================================================================
 * Mini-CRM appuntamenti (Setter/Venditore) — funnel, goals, commissioni
 * ==========================================================================*/

/** Giorno dell'anno (1-366), usato per far ruotare deterministicamente la frase del giorno. */
function dayOfYear(d) {
  const date = new Date(d);
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date - start;
  return Math.floor(diff / 86400000);
}

/** Lunedì 00:00:00 della settimana che contiene d (settimana ISO, inizia di lunedì). */
function startOfWeek(d) {
  const x = startOfDay(d);
  const day = x.getDay(); // 0=domenica..6=sabato
  const diffToMonday = day === 0 ? 6 : day - 1;
  x.setDate(x.getDate() - diffToMonday);
  return x;
}
function endOfWeek(d) {
  const s = startOfWeek(d);
  const e = new Date(s);
  e.setDate(e.getDate() + 6);
  return endOfDay(e);
}

function startOfMonth(d) { const x = new Date(d); return startOfDay(new Date(x.getFullYear(), x.getMonth(), 1)); }
function endOfMonth(d) { const x = new Date(d); return endOfDay(new Date(x.getFullYear(), x.getMonth() + 1, 0)); }

/** Range correnti (non storici/filtrabili) per le 3 card Giorno/Settimana/Mese dei funnel. */
function currentPeriodRanges() {
  const now = new Date();
  return {
    day: { start: startOfDay(now), end: endOfDay(now) },
    week: { start: startOfWeek(now), end: endOfWeek(now) },
    month: { start: startOfMonth(now), end: endOfMonth(now) }
  };
}

function inRange(dateVal, range) {
  if (!dateVal) return false;
  const d = new Date(dateVal);
  return d >= range.start && d <= range.end;
}

/**
 * Trova il giorno/settimana/mese con le commissioni totali più alte in assoluto su
 * tutto lo storico registrato — usato dal toggle "Migliore di sempre" delle card
 * Obiettivi in dashboard (vedi renderGoalsPeriodModeToggle/getGoalsPeriodRange in
 * app.js). Raggruppa ogni evento di commissione (allCommissionEvents) nel periodo a cui
 * appartiene (giorno esatto / settimana lun-dom / mese) e ritorna il range con il
 * totale più alto. Ritorna null se non ci sono ancora commissioni registrate (es. tool
 * appena iniziato) — chi chiama questa funzione deve gestire il fallback al periodo
 * corrente in quel caso.
 */
function findBestPeriod(db, granularity) {
  const events = allCommissionEvents(db);
  if (!events.length) return null;

  const buckets = {}; // key -> { range, total }
  events.forEach(ev => {
    const d = new Date(ev.date);
    if (isNaN(d)) return;
    let key, range;
    if (granularity === 'day') {
      key = dateInputValue(d);
      range = { start: startOfDay(d), end: endOfDay(d) };
    } else if (granularity === 'week') {
      const s = startOfWeek(d);
      key = dateInputValue(s);
      range = { start: s, end: endOfWeek(d) };
    } else {
      key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      range = { start: startOfMonth(d), end: endOfMonth(d) };
    }
    if (!buckets[key]) buckets[key] = { range, total: 0 };
    buckets[key].total += ev.amount;
  });

  let best = null;
  Object.values(buckets).forEach(entry => {
    if (!best || entry.total > best.total) best = entry;
  });
  return best ? { range: best.range, total: round2(best.total) } : null;
}

/**
 * Data di incasso "effettiva" del cashCollected iniziale di un appuntamento.
 *
 * CORREZIONE (segnalata dall'utente): la commissione sul cash collected iniziale va
 * segnata nel calendario alla data dell'appuntamento presentato/incassato, NON al
 * giorno in cui l'utente marca la riga come "chiuso" nel CRM (closedAt) — quel giorno
 * può essere molto dopo la data reale dell'appuntamento (es. appuntamento del 6, marcato
 * chiuso il 10: la commissione va sul 6, non sul 10). Usiamo quindi presentedAt se
 * presente (il giorno in cui il cliente si è presentato/l'incasso è avvenuto),
 * altrimenti scheduledAt come fallback (appuntamenti senza presentedAt, es. legacy o
 * chiusi senza passare per "presentato").
 */
function appointmentCashDate(apt) {
  return apt.presentedAt || apt.scheduledAt;
}

/**
 * Elenco di "eventi di commissione" generati da un singolo appuntamento, ciascuno
 * con: data, importo, fonte ('showup' | 'setting' | 'vendita'), e riferimento al
 * cliente. Un evento per ogni rata pagata (l'"Acconto" sintetico dal cash collected
 * incluso — vedi getEffectiveInstallments in app.js), più uno "showup" da 40€ per i
 * setter quando presentedStatus === 'presented'.
 *
 * Regole di business (vedi brief):
 * - setter: 3% di ogni importo incassato (acconto + rate paid), + 40€ fissi
 *   al momento del "presentato".
 * - venditore: 10% di ogni importo incassato (acconto + rate paid).
 *
 * CORREZIONE (segnalata dall'utente): prima l'acconto (cashCollected) generava un
 * evento di commissione indipendente dalle rate ("_cash0") — se l'utente inseriva poi
 * il totale pacchetto reale (es. 5100€) come rate, il cash collected (200€) veniva
 * contato due volte nelle commissioni. Ora l'acconto è semplicemente la prima "rata"
 * (vedi getEffectiveInstallments), quindi qui basta scorrere le rate effettive: niente
 * più doppio conteggio, e resta comunque richiesto closed=true perché un appuntamento
 * generi commissioni sull'incassato (coerente col comportamento precedente).
 */
function commissionEventsForAppointment(apt) {
  const events = [];
  const isSetter = apt.role === 'setter';
  const rate = isSetter ? 0.03 : 0.10;
  const source = isSetter ? 'setting' : 'vendita';

  if (apt.presentedStatus === 'presented' && isSetter) {
    events.push({
      id: apt.id + '_showup',
      appointmentId: apt.id,
      clientName: apt.clientName,
      role: apt.role,
      date: apt.presentedAt || apt.scheduledAt,
      amount: 40,
      source: 'showup'
    });
  }

  if (apt.closed) {
    getEffectiveInstallments(apt).forEach(inst => {
      if (inst.paid && inst.amount > 0) {
        events.push({
          id: apt.id + '_' + inst.id,
          appointmentId: apt.id,
          clientName: apt.clientName,
          role: apt.role,
          date: inst.paidDate || inst.dueDate,
          amount: round2(inst.amount * rate),
          source
        });
      }
    });
  }

  return events;
}

function round2(n) { return Math.round(n * 100) / 100; }

/** Tutti gli eventi di commissione dell'intero dataset (usato dal calendario Commissioni). */
function allCommissionEvents(db) {
  const out = [];
  (db.appointments || []).forEach(apt => { out.push(...commissionEventsForAppointment(apt)); });
  return out;
}

/** Eventi di commissione in un range, opzionalmente filtrati per ruolo. */
function commissionEventsInRange(db, range, role) {
  return allCommissionEvents(db).filter(ev => {
    if (role && ev.role !== role) return false;
    return inRange(ev.date, range);
  });
}

function sumEvents(events) { return round2(events.reduce((s, e) => s + e.amount, 0)); }

/**
 * Calcola i valori attuali del funnel per un ruolo in un range.
 * Setter: appuntamentiFissati, presentati, chiusi, commissioniShowUp, commissioniChiusure, commissioniTot.
 * Venditore: assegnati (auto-calcolato dal CRM), presentati, chiusi (+ commissioni chiusure).
 *
 * CORREZIONE (segnalata dall'utente): "Appuntamenti Fissati/Assegnati" per un timeframe
 * (es. Giornaliero) deve contare quanti appuntamenti sono stati REGISTRATI nel sistema
 * in quel periodo (createdAt — l'attività di fissaggio fatta oggi/questa settimana), NON
 * quanti appuntamenti sono IN AGENDA per quel periodo (scheduledAt). Prima, fissando oggi
 * un appuntamento per il 16 mentre l'obiettivo giornaliero guardava "oggi 16", il tool
 * mostrava 0 fissati oggi ma 1 (quello fissato ieri, per oggi) — comportamento invertito.
 * "Presentati" e "Chiusi" invece restano filtrati su scheduledAt: l'esito di un
 * appuntamento appartiene al giorno in cui si è effettivamente svolto, non a quando è
 * stato creato nel sistema — quindi qui servono DUE sottoinsiemi distinti.
 */
/**
 * Appuntamento spostato (vedi app.js, rescheduleAppointment): il nuovo appuntamento nato
 * da uno spostamento NON è un appuntamento in più — il fissaggio è già stato contato sul
 * vecchio. Usato da tutti i conteggi "fissati/assegnati".
 */
function isCountedAsNewBooking(a) { return !a.rescheduledFromId; }

/** true se l'appuntamento è stato spostato (esito "Spostato" in Setter o Venditore). */
function isMovedAppointment(a) {
  return a.role === 'venditore' ? a.dealStage === 'spostato' : a.presentedStatus === 'spostato';
}

function computeFunnelValues(db, role, range) {
  const roleAppts = (db.appointments || []).filter(a => a.role === role);
  // Setter: fissati = registrati nel periodo (createdAt). Venditore: assegnati = con DATA
  // APPUNTAMENTO nel periodo (scheduledAt) — Simone, 2026-10-08: gli appuntamenti di fine
  // settembre inseriti a ottobre finivano negli assegnati di ottobre.
  const bookingField = role === 'venditore' ? 'scheduledAt' : 'createdAt';
  const fissatiAppts = roleAppts.filter(a => isCountedAsNewBooking(a) && inRange(a[bookingField], range));
  const appts = roleAppts.filter(a => inRange(a.scheduledAt, range));
  // "Presentati": per il Setter segue presentedStatus (invariato); per il Venditore
  // segue il nuovo dealStage — presentato = isPresented (vedi
  // DEAL_STAGES.isPresented in app.js): esclusi No Show, Annullato e Spostato;
  const presentati = role === 'venditore'
    ? appts.filter(a => a.dealStage && dealStageDef(a.dealStage) && dealStageDef(a.dealStage).isPresented).length
    : appts.filter(a => a.presentedStatus === 'presented').length;
  const chiusi = appts.filter(a => a.closed).length;

  const events = commissionEventsInRange(db, range, role);
  const showUpEvents = events.filter(e => e.source === 'showup');
  const chiusureEvents = events.filter(e => e.source === 'setting' || e.source === 'vendita');

  // "Fatturato" (solo Venditore): il TOTALE VENDUTO (non le commissioni) sugli appuntamenti
  // chiusi nel periodo — richiesto esplicitamente dall'utente come 4a tappa della card
  // Obiettivi Venditore, accanto a Presentati/Chiusi. Stesso criterio di "chiusi" sopra
  // (scheduledAt nel range, closed=true), sommando apptTotalSold() invece di contare le righe.
  const fatturato = round2(appts.filter(a => a.closed).reduce((sum, a) => sum + apptTotalSold(a), 0));

  return {
    commissioniVendita: round2(fatturato * 0.10),
    appuntamentiFissati: fissatiAppts.length,
    presentati,
    chiusi,
    fatturato,
    commissioniShowUp: sumEvents(showUpEvents),
    commissioniChiusure: sumEvents(chiusureEvents),
    commissioniTot: sumEvents(events)
  };
}

/**
 * Serie storica (fino a 7 punti) per lo sparkline di una singola tappa del funnel,
 * usata dallo stile "Hero + Sparkline" della sezione Obiettivi. Divide il range della
 * card (giorno/settimana/mese) in sotto-bucket temporali e ricalcola il valore reale
 * della tappa in ciascuno con computeFunnelValues — non sono dati finti, è lo storico
 * reale ricampionato. Per timeframe "day" (un solo giorno) i bucket sono le ultime 7
 * ore-non-vuote non sono tracciate, quindi si usano gli ultimi 7 giorni fino al giorno
 * mostrato incluso (range.end — normalmente oggi, ma può essere un altro giorno quando è
 * selezionata la modalità "Migliore di sempre", vedi findBestPeriod), cosi la card
 * "Giorno" mostra comunque un trend utile invece di un solo punto.
 */
function computeFunnelSparkline(db, role, stepKey, timeframe, range) {
  const buckets = [];
  if (timeframe === 'day') {
    const anchor = range ? range.end : new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(anchor); d.setDate(d.getDate() - i);
      buckets.push({ start: startOfDay(d), end: endOfDay(d) });
    }
  } else if (timeframe === 'week') {
    const start = new Date(range.start);
    for (let i = 0; i < 7; i++) {
      const d = new Date(start); d.setDate(d.getDate() + i);
      buckets.push({ start: startOfDay(d), end: endOfDay(d) });
    }
  } else {
    // month: 7 bucket quasi uguali che coprono l'intero mese dall'1 a oggi/fine mese.
    const start = new Date(range.start);
    const end = new Date(range.end);
    const totalMs = end.getTime() - start.getTime();
    const stepMs = totalMs / 7;
    for (let i = 0; i < 7; i++) {
      const bStart = new Date(start.getTime() + stepMs * i);
      const bEnd = i === 6 ? end : new Date(start.getTime() + stepMs * (i + 1) - 1);
      buckets.push({ start: bStart, end: bEnd });
    }
  }
  return buckets.map(b => computeFunnelValues(db, role, b)[stepKey] || 0);
}

/** Riassunto commissioni complessive (tutti i ruoli) in un range, diviso per fonte. */
function computeCommissionSummary(db, range) {
  const events = commissionEventsInRange(db, range);
  const bySource = { showup: 0, setting: 0, vendita: 0 };
  events.forEach(e => { bySource[e.source] = round2(bySource[e.source] + e.amount); });
  return {
    total: sumEvents(events),
    showup: bySource.showup,
    setting: bySource.setting,
    vendita: bySource.vendita,
    events
  };
}

/**
 * Statistiche aggregate Venditore per un range (o "all time" se range è null) — analoghe
 * a quelle già mostrate per le sessioni Setter (conversion rate, ecc.), richieste
 * esplicitamente dall'utente per capire il proprio rendimento sui vari timeframe.
 *
 * - assegnati: appuntamenti Venditore con data appuntamento nel periodo (scheduledAt,
 *   stesso criterio di "Appuntamenti Assegnati" nel funnel — vedi computeFunnelValues).
 * - presentati/chiusi/persi/noShow: filtrati su scheduledAt (quando si è svolto
 *   l'appuntamento), stesso criterio del funnel, ma qui contati sull'intero dataset
 *   Venditore (non solo sul periodo di "assegnazione") così lo show rate/conversion
 *   rate riflettono gli ESITI avvenuti nel periodo scelto, a prescindere da quando il
 *   lead era stato assegnato.
 * - showRate: presentati / (presentati + noShow) — quanti dei lead che dovevano
 *   presentarsi si sono davvero presentati.
 * - conversionRate: chiusi (contratto_firmato + chiuso) / presentati in target (esclusi
 *   i "Non in target") — quanti dei
 *   presentati si chiudono.
 * - scontrinoMedio: totale venduto (su appuntamenti chiusi) / numero di chiusi.
 */
function computeVenditoreStats(db, range) {
  const all = (db.appointments || []).filter(a => a.role === 'venditore');
  const inR = (a, field) => !range || inRange(a[field], range);

  const assegnati = all.filter(a => isCountedAsNewBooking(a) && inR(a, 'scheduledAt')).length; // data appuntamento, vedi computeFunnelValues
  const scoped = all.filter(a => inR(a, 'scheduledAt'));

  const noShow = scoped.filter(a => a.dealStage === 'no_show').length;
  const persi = scoped.filter(a => a.dealStage === 'perso').length;
  const annullati = scoped.filter(a => a.dealStage === 'annullato').length;
  const nonInTarget = scoped.filter(a => a.dealStage === 'non_in_target').length;
  const presentati = scoped.filter(a => a.dealStage && dealStageDef(a.dealStage) && dealStageDef(a.dealStage).isPresented).length;
  const chiusiAppts = scoped.filter(a => a.closed);
  const chiusi = chiusiAppts.length;

  const showRateBase = presentati + noShow;
  const showRate = showRateBase > 0 ? pct(presentati, showRateBase) : 0;
  // "Non in target" conta come presentato (show rate) ma NON entra nel closing rate.
  const presentatiInTarget = scoped.filter(a => a.dealStage && dealStageDef(a.dealStage) && dealStageDef(a.dealStage).isPresented && !dealStageDef(a.dealStage).excludeFromClosing).length;
  const conversionRate = presentatiInTarget > 0 ? pct(chiusi, presentatiInTarget) : 0;

  const totalVenduto = chiusiAppts.reduce((s, a) => s + apptTotalSold(a), 0);
  const scontrinoMedio = chiusi > 0 ? round2(totalVenduto / chiusi) : 0;

  const commEvents = range ? commissionEventsInRange(db, range, 'venditore') : allCommissionEvents(db).filter(e => e.role === 'venditore');
  const commissioniTot = sumEvents(commEvents);

  return {
    assegnati, presentati, chiusi, persi, noShow, annullati, nonInTarget,
    showRate, conversionRate, totalVenduto, scontrinoMedio, commissioniTot
  };
}

/**
 * Pace del mese (richiesto 2026-10-08): commissioni del mese corrente fatte finora,
 * proiettate su tutto il mese in base ai giorni lavorativi (lun-ven) passati, oggi incluso.
 * Setter: commissioni totali (show up + chiusure). Venditore: 10% del fatturato del mese.
 */
function computeMonthPace(db, role) {
  const now = new Date();
  const month = currentPeriodRanges().month;
  const v = computeFunnelValues(db, role, month);
  const soFar = role === 'venditore' ? v.commissioniVendita : v.commissioniTot;
  const total = countWeekdays(month.start, month.end);
  const elapsed = countWeekdays(month.start, now);
  const pace = elapsed > 0 ? Math.round(soFar / elapsed * total) : Math.round(soFar);
  return { soFar: Math.round(soFar), pace, elapsed, total };
}

/** Numero di giorni feriali (lun-ven) tra due date, incluso entrambi gli estremi — usato
 * per la media "appuntamenti fissati/giorno" del Setter (weekend escluso su richiesta
 * esplicita dell'utente: nessun lavoro atteso sab/dom, non va a diluire la media). */
function countWeekdays(start, end) {
  let count = 0;
  const d = startOfDay(start);
  const last = startOfDay(end);
  while (d <= last) {
    const dow = d.getDay(); // 0=domenica, 6=sabato
    if (dow !== 0 && dow !== 6) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

/**
 * Statistiche aggregate Setter per un range (o "all time" se range è null) — sezione
 * "Statistiche" dentro Setting, richiesta esplicitamente dall'utente sullo stile di
 * computeVenditoreStats ma con metriche specifiche del ruolo Setter:
 * - fissati: appuntamenti Setter REGISTRATI nel periodo (createdAt), stesso criterio di
 *   computeFunnelValues ("l'attività di fissaggio fatta in quel periodo").
 * - presentati: tra gli appuntamenti IN AGENDA nel periodo (scheduledAt), quelli con
 *   presentedStatus === 'presented'.
 * - showUpRate: CORREZIONE esplicita dell'utente — non va calcolato sui fissati totali,
 *   ma solo sugli appuntamenti GIÀ SVOLTI (scheduledAt <= adesso): quelli ancora futuri
 *   non possono avere un esito e abbasserebbero artificialmente il tasso.
 * - mediaFissatiGiorno: fissati / giorni feriali (lun-ven) nel range.
 * - closingRate: quota di "presentati" (SOLO quelli, non tutti gli scoped) che risultano
 *   chiusi — "quanti apt presentati (solamente i presentati) vengono chiusi".
 */
function computeSetterStats(db, range) {
  const all = (db.appointments || []).filter(a => a.role === 'setter');
  const now = new Date();
  const inR = (a, field) => !range || inRange(a[field], range);

  const fissatiAppts = all.filter(a => isCountedAsNewBooking(a) && inR(a, 'createdAt'));
  const scoped = all.filter(a => inR(a, 'scheduledAt'));

  // Un appuntamento spostato non si è svolto in quella data: non entra negli "svolti"
  // (altrimenti abbasserebbe lo show-up rate). Conta il nuovo, quando si svolge.
  // Stesso discorso per l'annullato: né show né no-show, fuori dallo show-up rate.
  const svolti = scoped.filter(a => !isMovedAppointment(a) && a.presentedStatus !== 'annullato' && a.scheduledAt && new Date(a.scheduledAt) <= now);
  const presentati = scoped.filter(a => a.presentedStatus === 'presented');
  const presentatiSvolti = svolti.filter(a => a.presentedStatus === 'presented');

  const showUpRate = svolti.length > 0 ? pct(presentatiSvolti.length, svolti.length) : 0;
  const closingRate = presentati.length > 0 ? pct(presentati.filter(a => a.closed).length, presentati.length) : 0;

  // Range effettivo per la media/giorno: se "all time" (range=null) usa dal primo
  // appuntamento fissato ad oggi, altrimenti il range del timeframe scelto.
  let spanStart = range ? range.start : null;
  const spanEnd = range ? range.end : now;
  if (!range) {
    const earliest = all.filter(isCountedAsNewBooking).reduce((min, a) => {
      const d = new Date(a.createdAt);
      return (!min || d < min) ? d : min;
    }, null);
    spanStart = earliest || now;
  }
  const weekdays = countWeekdays(spanStart, spanEnd);
  const mediaFissatiGiorno = weekdays > 0 ? round1(fissatiAppts.length / weekdays) : 0;

  return {
    fissati: fissatiAppts.length,
    presentati: presentati.length,
    svolti: svolti.length,
    showUpRate,
    closingRate,
    mediaFissatiGiorno,
    weekdays
  };
}

/** Raggruppa gli eventi di commissione per giorno (YYYY-MM-DD) per il calendario. */
function groupEventsByDay(events) {
  const map = {};
  events.forEach(ev => {
    const key = dateInputValue(ev.date);
    if (!map[key]) map[key] = [];
    map[key].push(ev);
  });
  return map;
}

