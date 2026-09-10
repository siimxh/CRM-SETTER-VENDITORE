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
 */
function computeStats(sessions) {
  let totalCalls = 0, totalDurationMs = 0, totalSkips = 0;
  const outcomeCounts = {};
  const leads = []; // ogni elemento raggruppa le chiamate (1 o 2) fatte allo stesso lead

  sessions.forEach(s => {
    const end = s.endedAt ? new Date(s.endedAt) : new Date();
    totalDurationMs += Math.max(0, end.getTime() - new Date(s.startedAt).getTime());
    totalSkips += s.skips || 0;

    let currentLead = null;
    s.calls.forEach(c => {
      totalCalls += 1;
      outcomeCounts[c.outcomeLabel] = (outcomeCounts[c.outcomeLabel] || 0) + 1;
      if (c.isSecondAttempt && currentLead) {
        currentLead.push(c);
      } else {
        currentLead = [c];
        leads.push(currentLead);
      }
    });
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
 * cliente. Un evento per il cash collected iniziale (se chiuso), uno per ogni
 * rata pagata, più uno "showup" da 40€ per i setter quando presentedStatus === 'presented'.
 *
 * Regole di business (vedi brief):
 * - setter: 3% di ogni importo incassato (cash iniziale + rate paid), + 40€ fissi
 *   al momento del "presentato".
 * - venditore: 10% di ogni importo incassato (cash iniziale + rate paid).
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

  if (apt.closed && apt.cashCollected > 0) {
    events.push({
      id: apt.id + '_cash0',
      appointmentId: apt.id,
      clientName: apt.clientName,
      role: apt.role,
      date: appointmentCashDate(apt),
      amount: round2(apt.cashCollected * rate),
      source
    });
  }

  (apt.installments || []).forEach(inst => {
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
 * Venditore: assegnati (dato manuale, non calcolato), presentati, chiusi (+ commissioni chiusure).
 */
function computeFunnelValues(db, role, range) {
  const appts = (db.appointments || []).filter(a => a.role === role && inRange(a.scheduledAt, range));
  const presentati = appts.filter(a => a.presentedStatus === 'presented').length;
  const chiusi = appts.filter(a => a.closed).length;

  const events = commissionEventsInRange(db, range, role);
  const showUpEvents = events.filter(e => e.source === 'showup');
  const chiusureEvents = events.filter(e => e.source === 'setting' || e.source === 'vendita');

  return {
    appuntamentiFissati: appts.length,
    presentati,
    chiusi,
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
 * ore-non-vuote non sono tracciate, quindi si usano gli ultimi 7 giorni fino ad oggi
 * incluso, cosi la card "Giorno" mostra comunque un trend utile invece di un solo punto.
 */
function computeFunnelSparkline(db, role, stepKey, timeframe, range) {
  const buckets = [];
  if (timeframe === 'day') {
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now); d.setDate(d.getDate() - i);
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
