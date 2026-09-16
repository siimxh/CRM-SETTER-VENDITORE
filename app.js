/* app.js — routing, rendering e interazioni */

let db = Storage.load();
let uiState = {
  timeframe: 'oggi',
  customFrom: null,
  customTo: null,
  pipelineFilter: 'all',
  sessioniPipelineFilter: 'all',
  crmSetterFilter: 'all',      // 'all' | 'no_show' — tabella Appuntamenti Setter
  crmVenditoreFilter: 'all',   // 'all' | 'trattativa' | 'no_show' | 'perso' — tabella Appuntamenti Venditore
  vndStatsTimeframe: 'mese_corrente', // timeframe attivo per la pagina Statistiche Venditore
  vndStatsCustomFrom: null,
  vndStatsCustomTo: null,
  calMonthOffset: 0,           // scostamento in mesi dal mese corrente, per la navigazione del calendario
  editingGoal: null,           // { role, timeframe, step } quando un target obiettivo è in modifica inline
  goalsTimeframe: 'month',     // timeframe attivo (day|week|month) per le card Obiettivi (stile Hero + Sparkline)
  settingTab: 'appuntamenti',  // sotto-tab attiva dentro la sezione Setting: 'appuntamenti' | 'sessioni'
  venditoreTab: 'appuntamenti',// sotto-tab attiva dentro la sezione Venditore: 'appuntamenti' | 'statistiche'
  andamentoTimeframe: 'mese_corrente', // timeframe dei grafici a linea "Andamento generale" in dashboard
  andamentoCustomFrom: null,
  andamentoCustomTo: null,
  andamentoCommRole: 'all'     // 'all' | 'setter' | 'venditore' — filtro ruolo solo per il grafico Commissioni
};
let sessionTimerInterval = null;

const appRoot = document.getElementById('app');
const modalRoot = document.getElementById('modalRoot');

function persist() {
  Storage.save(db);
  queueFirebasePush();
}

/* ---------- Sincronizzazione Firebase (facoltativa) ---------- */

let fbPushTimer = null;

function queueFirebasePush() {
  if (!FirebaseSync.isConfigured()) return;
  clearTimeout(fbPushTimer);
  // piccolo debounce: durante una sessione si salva ad ogni click, non serve scrivere
  // su Firestore ad ogni singolo tocco.
  fbPushTimer = setTimeout(async () => {
    setSyncStatus('syncing');
    try {
      await FirebaseSync.push(db);
      setSyncStatus('synced');
    } catch (e) {
      console.error('Sincronizzazione Firebase (push) non riuscita', e);
      setSyncStatus('error');
    }
  }, 800);
}

function setSyncStatus(status) {
  const el = document.getElementById('syncStatus');
  if (!el) return;
  const map = {
    syncing: '☁ sincronizzazione…',
    synced: '☁ sincronizzato',
    error: '⚠ sync non riuscita'
  };
  el.textContent = map[status] || '';
  el.title = status === 'error' ? 'La sincronizzazione con Firebase non è riuscita. I dati restano salvati in locale.' : '';
}

/** Al primo caricamento, se configurato, scarica l'ultima versione salvata su Firestore. */
async function initFirebaseSyncOnLoad() {
  if (!FirebaseSync.isConfigured()) return;
  // Se c'è già una sessione in corso salvata localmente, non sovrascriverla con il cloud:
  // meglio non rischiare di perdere chiamate già registrate in questa sessione.
  if (db.activeSession) return;
  setSyncStatus('syncing');
  try {
    const result = await FirebaseSync.pull();
    if (result.ok && result.data) {
      db = mergeWithDefaults(result.data);
      Storage.save(db);
      renderRoute();
    }
    setSyncStatus('synced');
  } catch (e) {
    console.error('Sincronizzazione Firebase (pull) non riuscita', e);
    setSyncStatus('error');
  }
}

/* ============================================================================
 * Builder / Tema — preset, colori custom, radius, font, glow, saturazione/contrasto
 * ==========================================================================*/

const THEME_PRESETS = {
  'graphite-lime': {
    label: 'Graphite Lime',
    colors: { bg: '#17181a', bgElev: '#1e2022', accent: '#c6ff3d', text: '#f5f6f2', setterColor: '#c6ff3d', venditoreColor: '#7fd9ff', success: '#c6ff3d', danger: '#ff5c5c' }
  },
  'slate-amber': {
    label: 'Slate Amber',
    colors: { bg: '#12141a', bgElev: '#1a1d24', accent: '#f5a524', text: '#f2f3f6', setterColor: '#f5a524', venditoreColor: '#7fd9ff', success: '#4ade80', danger: '#ff5c5c' }
  },
  'paper-emerald': {
    label: 'Paper Emerald',
    colors: { bg: '#f7f7f5', bgElev: '#ffffff', accent: '#0f7a5c', text: '#111813', setterColor: '#0f7a5c', venditoreColor: '#1985ab', success: '#0f7a5c', danger: '#c23b3b' }
  },
  'navy-gold': {
    label: 'Navy Gold',
    colors: { bg: '#0b1220', bgElev: '#131c30', accent: '#d4a94a', text: '#f2f4f8', setterColor: '#d4a94a', venditoreColor: '#7fd9ff', success: '#4ade80', danger: '#ff5c5c' }
  },
  'cobalt-light': {
    label: 'Cobalt Light',
    colors: { bg: '#f4f6fb', bgElev: '#ffffff', accent: '#3355ff', text: '#0e1220', setterColor: '#3355ff', venditoreColor: '#0f7a5c', success: '#0f7a5c', danger: '#c23b3b' }
  }
};

const RADIUS_STYLES = ['none', 'sharp', 'soft', 'round', 'pill', 'cut', 'bracket', 'mixed'];
const FONT_STYLES = [
  { id: 'archivo', label: 'Archivo', cls: '' },
  { id: 'mono', label: 'JetBrains Mono', cls: 'font-mono' },
  { id: 'bebas', label: 'Bebas Neue', cls: 'font-bebas' },
  { id: 'playfair', label: 'Playfair Display', cls: 'font-playfair' },
  { id: 'spacemono', label: 'Space Mono', cls: 'font-spacemono' },
  { id: 'orbitron', label: 'Orbitron', cls: 'font-orbitron' },
  { id: 'vt323', label: 'VT323', cls: 'font-vt323' },
  { id: 'unbounded', label: 'Unbounded', cls: 'font-unbounded' }
];

/** Schiarisce/scurisce un colore hex di una percentuale (positiva = verso il bianco). Usata per derivare --bg-elev2/--border/--accent-hover dai colori custom. */
function shadeHex(hex, pct) {
  const c = hex.replace('#', '');
  const num = parseInt(c.length === 3 ? c.split('').map(x => x + x).join('') : c, 16);
  let r = (num >> 16) & 0xff, g = (num >> 8) & 0xff, b = num & 0xff;
  const mix = (ch) => Math.max(0, Math.min(255, Math.round(ch + (pct >= 0 ? (255 - ch) : ch) * pct)));
  r = mix(r); g = mix(g); b = mix(b);
  return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
}

function hexToRgba(hex, alpha) {
  const c = hex.replace('#', '');
  const num = parseInt(c.length === 3 ? c.split('').map(x => x + x).join('') : c, 16);
  const r = (num >> 16) & 0xff, g = (num >> 8) & 0xff, b = num & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Applica data.settings al DOM: custom properties colore, classi body per
 * radius/font/glow, filtro saturazione/contrasto, tema auto giorno/notte,
 * modalità Grind e Boss Mode. Chiamata all'avvio e ad ogni renderRoute()/modifica
 * impostazioni, così resta sempre sincronizzata.
 */
function applyTheme(settings) {
  if (!settings) return;
  const root = document.documentElement;
  const c = settings.colors || {};

  if (c.bg) root.style.setProperty('--bg', c.bg);
  if (c.bgElev) {
    root.style.setProperty('--bg-elev', c.bgElev);
    root.style.setProperty('--bg-elev2', shadeHex(c.bgElev, c.bg && isDarkColor(c.bg) ? 0.06 : -0.04));
    root.style.setProperty('--border', shadeHex(c.bgElev, c.bg && isDarkColor(c.bg) ? 0.14 : -0.14));
  }
  if (c.accent) {
    root.style.setProperty('--accent', c.accent);
    root.style.setProperty('--accent-hover', shadeHex(c.accent, -0.15));
    root.style.setProperty('--accent-dim', hexToRgba(c.accent, 0.16));
  }
  if (c.text) root.style.setProperty('--text', c.text);
  if (c.setterColor) root.style.setProperty('--setter-color', c.setterColor);
  if (c.venditoreColor) root.style.setProperty('--venditore-color', c.venditoreColor);
  if (c.success) root.style.setProperty('--success', c.success);
  if (c.danger) {
    root.style.setProperty('--danger', c.danger);
    root.style.setProperty('--tag-x2-bg', hexToRgba(c.danger, 0.14));
    root.style.setProperty('--tag-x2-text', c.danger);
  }
  if (c.success) {
    root.style.setProperty('--tag-conv-bg', hexToRgba(c.success, 0.14));
    root.style.setProperty('--tag-conv-text', c.success);
  }

  // Saturazione accento (slider 0-100): approssimata con un filtro CSS sull'elemento che
  // consuma --accent-filter — applicato dove serve un effetto visibile senza un algoritmo
  // sofisticato di conversione colore (richiesto esplicitamente "approssimato ma visibile").
  const sat = settings.accentSaturation != null ? settings.accentSaturation : 86;
  root.style.setProperty('--accent-filter', `saturate(${Math.round((sat / 86) * 100)}%)`);

  // Contrasto card/sfondo (slider 0-100): più alto = bordo più marcato tra bg e bg-elev.
  // Effetto approssimato (non serve un algoritmo sofisticato, va bene un risultato visibile):
  // ricalcola --border come uno shade di bg-elev con un delta proporzionale al contrasto.
  if (c.bgElev) {
    const contrast = settings.cardContrast != null ? settings.cardContrast : 70;
    const delta = 0.04 + (contrast / 100) * 0.28; // 0.04 (basso contrasto) .. 0.32 (alto contrasto)
    const dark = isDarkColor(c.bg || c.bgElev);
    root.style.setProperty('--border', shadeHex(c.bgElev, dark ? delta : -delta));
  }

  // radius
  const body = document.body;
  body.className = body.className.replace(/\bradius-\S+/g, '').trim();
  const radiusClassMap = { sharp: '', none: '', soft: 'radius-soft', round: 'radius-round', pill: 'radius-pill', cut: 'radius-cut-corner', bracket: 'radius-bracket', mixed: 'radius-mixed' };
  const rc = radiusClassMap[settings.radiusStyle];
  if (rc) body.classList.add(rc);

  // font
  body.className = body.className.replace(/\bfont-\S+/g, '').trim();
  const fontDef = FONT_STYLES.find(f => f.id === settings.fontStyle);
  if (fontDef && fontDef.cls) body.classList.add(fontDef.cls);

  // glow
  body.classList.remove('glow-border', 'glow-full');
  if (settings.glowLevel === 'border') body.classList.add('glow-border');
  if (settings.glowLevel === 'full') body.classList.add('glow-full');

  // Tema auto giorno/notte (toggle 6): 7-19 chiaro, resto scuro — sovrascrive la preferenza di sistema.
  if (settings.toggles && settings.toggles.autoTheme) {
    const h = new Date().getHours();
    root.setAttribute('data-theme', (h >= 7 && h < 19) ? 'light' : 'dark');
  } else if (root.getAttribute('data-theme') && !window._userForcedTheme) {
    root.removeAttribute('data-theme');
  }

  // Modalità Grind (toggle 1): confronta chiusure mese corrente coi due target mensili "chiusi".
  document.body.classList.remove('grind-under', 'grind-over');
  if (settings.toggles && settings.toggles.grindMode) {
    const ranges = currentPeriodRanges();
    const setterVals = computeFunnelValues(db, 'setter', ranges.month);
    const targetSetter = (db.goals.setter.month.chiusi || 0);
    const under = targetSetter > 0 && setterVals.chiusi < targetSetter;
    document.body.classList.add(under ? 'grind-under' : 'grind-over');
  }

  // Boss Mode (toggle 13): ultimi 3 giorni del mese E sotto obiettivo mensile "chiusi" (setter).
  document.body.classList.remove('boss-mode');
  if (settings.toggles && settings.toggles.bossMode) {
    const now = new Date();
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const daysLeft = lastDay - now.getDate();
    const ranges = currentPeriodRanges();
    const setterVals = computeFunnelValues(db, 'setter', ranges.month);
    const targetSetter = (db.goals.setter.month.chiusi || 0);
    if (daysLeft <= 3 && targetSetter > 0 && setterVals.chiusi < targetSetter) {
      document.body.classList.add('boss-mode');
    }
  }
}

function isDarkColor(hex) {
  const c = hex.replace('#', '');
  const num = parseInt(c.length === 3 ? c.split('').map(x => x + x).join('') : c, 16);
  const r = (num >> 16) & 0xff, g = (num >> 8) & 0xff, b = num & 0xff;
  return (0.299 * r + 0.587 * g + 0.114 * b) < 128;
}

/* ---------- Suoni (Web Audio API, niente file esterni) ---------- */

let _audioCtx = null;
function getAudioCtx() {
  if (!_audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    _audioCtx = new Ctx();
  }
  return _audioCtx;
}

/** Due note rapide in sequenza — usata sia dal beep "chiusura" (toggle 3) che dal "level up" (toggle 14), con frequenze diverse. */
function playChime(freq1, freq2) {
  const ctx = getAudioCtx();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    [{ f: freq1, t: now }, { f: freq2, t: now + 0.11 }].forEach(({ f, t }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, t);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.18, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.12);
    });
  } catch (e) { console.error('Audio non disponibile', e); }
}

function playCloseSound() { playChime(660, 880); }
function playLevelUpSound() { playChime(523, 1046); }

/* ---------- Confetti (toggle 5) ---------- */

function fireConfetti() {
  const colors = [getCssVar('--accent'), getCssVar('--setter-color'), getCssVar('--venditore-color'), getCssVar('--success')];
  for (let i = 0; i < 26; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    const left = Math.random() * 100;
    const dur = 1.4 + Math.random() * 1.2;
    const delay = Math.random() * 0.3;
    piece.style.left = left + 'vw';
    piece.style.background = colors[i % colors.length];
    piece.style.animationDuration = dur + 's';
    piece.style.animationDelay = delay + 's';
    document.body.appendChild(piece);
    setTimeout(() => piece.remove(), (dur + delay) * 1000 + 100);
  }
}

function getCssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#c6ff3d';
}

/* ---------- Ticker commissioni live (toggle 12) ---------- */

function showCommissionTicker(amount) {
  if (!db.settings.toggles.liveTicker) return;
  const anchor = document.querySelector('.kpi-card.accented[data-ticker-anchor]');
  if (!anchor) return;
  let ticker = anchor.querySelector('.commission-ticker');
  if (!ticker) {
    ticker = document.createElement('div');
    ticker.className = 'commission-ticker';
    anchor.appendChild(ticker);
  }
  ticker.textContent = `+€${round2(amount)}`;
  ticker.classList.remove('show');
  void ticker.offsetWidth;
  ticker.classList.add('show');
}

/* ---------- Numeri animati: countUp (toggle 2) e slot-machine (toggle 16) ----------
 * Se entrambi i toggle sono attivi, la priorità va allo slot-machine (più vistoso e
 * pensato apposta per "quando un KPI cambia") mentre countUp resta l'animazione di
 * default per il primo render. Scelta documentata anche nel brief del builder. */
function animateKpiValues(root) {
  if (!db.settings.toggles) return;
  const useSlot = db.settings.toggles.slotMachineNumbers;
  const useCount = db.settings.toggles.animatedNumbers;
  if (!useSlot && !useCount) return;
  root.querySelectorAll('[data-kpi-num]').forEach(el => {
    const target = parseFloat(el.dataset.kpiNum);
    if (isNaN(target)) return;
    if (useSlot) {
      el.classList.remove('slot-anim');
      void el.offsetWidth;
      el.classList.add('slot-anim');
      el.textContent = el.dataset.kpiDisplay || String(target);
    } else if (useCount) {
      const isMoney = el.dataset.kpiMoney === '1';
      const suffix = el.dataset.kpiSuffix || '';
      const duration = 600;
      const start = performance.now();
      function step(now) {
        const p = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - p, 3);
        const val = target * eased;
        el.textContent = (isMoney ? '€' : '') + (Number.isInteger(target) ? Math.round(val) : round1(val)) + suffix;
        if (p < 1) requestAnimationFrame(step);
        else el.textContent = el.dataset.kpiDisplay || String(target);
      }
      requestAnimationFrame(step);
    }
  });
}

/* ---------- Milestone pulse (toggle 11): applica una classe quando una barra supera 50%/75% ---------- */
function applyMilestonePulses(root) {
  if (!db.settings.toggles || !db.settings.toggles.midMilestone) return;
  root.querySelectorAll('[data-goal-pct]').forEach(bar => {
    const p = parseFloat(bar.dataset.goalPct);
    if (p >= 50) {
      bar.classList.remove('milestone-pulse');
      void bar.offsetWidth;
      bar.classList.add('milestone-pulse');
    }
  });
}

/* ---------- Cash Day badge (toggle 15) ---------- */
function isCashDay(dayTotal) {
  if (!db.settings.toggles.cashDayBadge) return false;
  const threshold = db.settings.cashDayThreshold || 0;
  return threshold > 0 && dayTotal >= threshold;
}

/* ---------- Router ---------- */

// Route "macro" che raggruppano più sotto-schermate sotto un solo bottone di nav
// (richiesto esplicitamente dall'utente: un solo "Setting" e un solo "Venditore" in nav,
// con la scelta Appuntamenti/Sessioni (Setting) o Appuntamenti/Statistiche (Venditore)
// fatta DENTRO la schermata tramite sotto-tab, non con più voci di nav separate).
const SETTING_SUBROUTES = { appuntamenti: 'setting-appuntamenti', sessioni: 'sessioni' };
const VENDITORE_SUBROUTES = { appuntamenti: 'venditore-appuntamenti', statistiche: 'venditore-statistiche' };

function renderRoute() {
  if (db.activeSession) {
    renderSessioneAttiva();
    return;
  }
  document.body.classList.remove('in-session');
  clearInterval(sessionTimerInterval);

  const hash = location.hash || '#/dashboard';
  const parts = hash.replace('#/', '').split('/');
  const route = parts[0] || 'dashboard';

  // Le due macro-voci di nav "Setting"/"Venditore" sono attive quando la route corrente
  // è una qualunque delle loro sotto-schermate, non solo quando l'hash è esattamente
  // 'setting' o 'venditore' — altrimenti il bottone si spegnerebbe entrando in una tab.
  const isSettingRoute = route === 'setting' || Object.values(SETTING_SUBROUTES).includes(route);
  const isVenditoreRoute = route === 'venditore' || Object.values(VENDITORE_SUBROUTES).includes(route);
  document.querySelectorAll('.navlink').forEach(l => {
    const r = l.dataset.route;
    const active = (r === 'setting' && isSettingRoute) || (r === 'venditore' && isVenditoreRoute) || r === route;
    l.classList.toggle('active', active);
  });

  applyTheme(db.settings);

  if (route === 'sessioni' && parts[1]) { uiState.settingTab = 'sessioni'; renderSessioneDetail(parts[1]); }
  else if (route === 'sessioni') { uiState.settingTab = 'sessioni'; renderSettingPage(); }
  else if (route === 'setting-appuntamenti') { uiState.settingTab = 'appuntamenti'; renderSettingPage(); }
  else if (route === 'setting') renderSettingPage();
  else if (route === 'venditore-appuntamenti') { uiState.venditoreTab = 'appuntamenti'; renderVenditorePage(); }
  else if (route === 'venditore-statistiche') { uiState.venditoreTab = 'statistiche'; renderVenditorePage(); }
  else if (route === 'venditore') renderVenditorePage();
  else if (route === 'impostazioni') renderBuilderPage();
  else renderDashboard();
}

/**
 * Barra sotto-tab condivisa da renderSettingPage/renderVenditorePage: HTML da anteporre
 * al contenuto della schermata scelta (Appuntamenti/Sessioni o Appuntamenti/Statistiche).
 * Le funzioni di rendering delle sotto-schermate restano quelle esistenti (renderAppuntamenti,
 * renderSessioniList, renderVenditoreAppuntamenti, renderVenditoreStatistiche): accettano un
 * parametro opzionale subTabBarHtml da anteporre al proprio markup, così tutto il resto del
 * loro wiring interno (appRoot.querySelectorAll/getElementById) resta invariato.
 */
function renderSubTabsBar(kind, active) {
  if (kind === 'setting') {
    return `
      <section class="card sub-tabs-bar">
        <div class="sub-tabs">
          <button class="tf-tab ${active === 'appuntamenti' ? 'active' : ''}" data-setting-tab="appuntamenti">Appuntamenti</button>
          <button class="tf-tab ${active === 'sessioni' ? 'active' : ''}" data-setting-tab="sessioni">Sessioni</button>
        </div>
      </section>`;
  }
  return `
    <section class="card sub-tabs-bar">
      <div class="sub-tabs">
        <button class="tf-tab ${active === 'appuntamenti' ? 'active' : ''}" data-venditore-tab="appuntamenti">Appuntamenti</button>
        <button class="tf-tab ${active === 'statistiche' ? 'active' : ''}" data-venditore-tab="statistiche">Statistiche</button>
      </div>
    </section>`;
}

function wireSubTabsBar(kind) {
  if (kind === 'setting') {
    appRoot.querySelectorAll('[data-setting-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        uiState.settingTab = btn.dataset.settingTab;
        location.hash = uiState.settingTab === 'sessioni' ? '#/sessioni' : '#/setting-appuntamenti';
      });
    });
  } else {
    appRoot.querySelectorAll('[data-venditore-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        uiState.venditoreTab = btn.dataset.venditoreTab;
        location.hash = uiState.venditoreTab === 'statistiche' ? '#/venditore-statistiche' : '#/venditore-appuntamenti';
      });
    });
  }
}

/** Wrapper "Setting": sotto-tab Appuntamenti/Sessioni, scelta dentro la schermata. */
function renderSettingPage() {
  const tab = uiState.settingTab || 'appuntamenti';
  if (tab === 'sessioni') renderSessioniList();
  else renderAppuntamenti();
}

/** Wrapper "Venditore": sotto-tab Appuntamenti/Statistiche, scelta dentro la schermata. */
function renderVenditorePage() {
  const tab = uiState.venditoreTab || 'appuntamenti';
  if (tab === 'statistiche') renderVenditoreStatistiche();
  else renderVenditoreAppuntamenti();
}

/* ---------- Dashboard ---------- */

/**
 * Dashboard — SOLO: Obiettivi Setter, Obiettivi Venditore, Andamento generale (KPI
 * commissioni + grafici a linea Commissioni/Totale Venduto), calendario Commissioni in
 * fondo. La vecchia sezione "Attività di chiamata" (chiamate/lead/esiti/pipeline/
 * produttività) è stata spostata in Setting > Sessioni su richiesta esplicita
 * dell'utente — vedi renderCallActivitySection.
 */
function renderDashboard() {
  const topSectionsHtml = renderDashboardTopSections();
  const commissioniCalHtml = renderCommissioniCalendarSection();

  appRoot.innerHTML = `
    ${topSectionsHtml}
    ${commissioniCalHtml}
  `;

  wireDashboardTopSectionEvents();
  wireCommissioniCalendarSection();
  animateKpiValues(appRoot);
  applyMilestonePulses(appRoot);
}

/**
 * Costruisce il markup delle nuove sezioni in cima alla dashboard:
 * countdown/frase motivazionale, funnel Setter, funnel Venditore, KPI commissioni.
 * La logica di eventi (wiring) è in wireDashboardTopSectionEvents().
 */
function renderDashboardTopSections() {
  const eyebrowsHtml = renderEyebrows();
  const tabsHtml = renderGoalsTimeframeTabs();
  const setterFunnel = renderFunnelSection('setter', 'Obiettivi Setter', FUNNEL_STEPS_SETTER);
  const venditoreFunnel = renderFunnelSection('venditore', 'Obiettivi Venditore', FUNNEL_STEPS_VENDITORE);
  const commKpi = renderCommissionKpiSection();

  return `
    ${eyebrowsHtml}
    ${tabsHtml}
    <section class="card goals-section">
      <h2><span class="role-dot setter"></span>Obiettivi Setter</h2>
      ${setterFunnel}
    </section>
    <section class="card goals-section">
      <h2><span class="role-dot venditore"></span>Obiettivi Venditore</h2>
      ${venditoreFunnel}
    </section>
    ${commKpi}
  `;
}

function renderEyebrows() {
  const t = db.settings.toggles || {};
  const parts = [];
  if (t.monthCountdown) {
    const now = new Date();
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const daysLeft = lastDay - now.getDate();
    parts.push(`<div class="eyebrow">⏳ ${daysLeft} giorni al termine del mese</div>`);
  }
  if (t.dailyQuote) {
    const quotes = motivationalQuotes();
    const idx = dayOfYear(new Date()) % quotes.length;
    parts.push(`<div class="eyebrow">"${escapeHtml(quotes[idx])}"</div>`);
  }
  if (t.dailyStreak) {
    parts.push(`<div class="eyebrow streak-eyebrow">🔥 ${computeStreak()} giorni di fila</div>`);
  }
  if (!parts.length) return '';
  return `<section class="card" style="display:flex; flex-direction:column; gap:6px;">${parts.join('')}</section>`;
}

function trendItem(label, t) {
  const arrow = t.dir === 'up' ? '▲' : (t.dir === 'down' ? '▼' : '—');
  const cls = t.dir === 'up' ? 'trend-up' : (t.dir === 'down' ? 'trend-down' : 'trend-flat');
  return `
    <div class="trend-item">
      <div class="trend-label">${label}</div>
      <div class="trend-value ${cls}">${arrow} ${t.diff}%</div>
    </div>`;
}

/* ============================================================================
 * Obiettivi (goals) — funnel Setter (6 tappe) e Venditore (3 tappe)
 * ==========================================================================*/

const FUNNEL_STEPS_SETTER = [
  { key: 'appuntamentiFissati', label: 'Appuntamenti Fissati', money: false },
  { key: 'presentati', label: 'Presentati', money: false },
  { key: 'chiusi', label: 'Chiusi', money: false },
  { key: 'commissioniShowUp', label: 'Commissioni Show Up', money: true },
  { key: 'commissioniChiusure', label: 'Commissioni Chiusure', money: true },
  { key: 'commissioniTot', label: 'Commissioni Tot.', money: true }
];

// Per il venditore, "appuntamentiFissati" è in realtà "Appuntamenti Assegnati": conteggio
// AUTOMATICO delle righe CRM create con ruolo Venditore nel periodo selezionato (stesso
// meccanismo con cui il Setter conta "Appuntamenti Fissati" — vedi computeFunnelValues).
// CORREZIONE (segnalata dall'utente): prima era un campo inserito a mano, ma il numero
// giusto è quello che risulta da "quando selezioni il ruolo venditore" nel CRM, non un
// valore digitato separatamente — vedi isAutoAssignedField in renderFunnelHero.
const FUNNEL_STEPS_VENDITORE = [
  { key: 'appuntamentiFissati', label: 'Appuntamenti Assegnati', money: false, isAutoAssignedField: true },
  { key: 'presentati', label: 'Presentati', money: false },
  { key: 'chiusi', label: 'Chiusi', money: false }
];

const TIMEFRAME_KEYS = ['day', 'week', 'month'];
const TIMEFRAME_CARD_LABELS = { day: 'Giorno', week: 'Settimana', month: 'Mese' };

function renderFunnelSection(role, title, steps) {
  const ranges = currentPeriodRanges();
  const tf = uiState.goalsTimeframe;
  return renderFunnelCard(role, tf, steps, ranges[tf]);
}

/** Tab Giorno/Settimana/Mese condivisi da entrambi i funnel (Setter e Venditore
 * cambiano vista insieme) — resi una sola volta sopra le due sezioni Obiettivi. */
function renderGoalsTimeframeTabs() {
  const tabsHtml = TIMEFRAME_KEYS.map(tf => `
    <button class="tf-tab ${uiState.goalsTimeframe === tf ? 'active' : ''}" data-goals-tf="${tf}">${TIMEFRAME_CARD_LABELS[tf]}</button>
  `).join('');
  return `<div class="tf-tabs">${tabsHtml}</div>`;
}

function renderFunnelCard(role, timeframe, steps, range) {
  const values = computeFunnelValues(db, role, range);
  const goalSet = db.goals[role][timeframe];
  const heroStep = steps[0];
  const miniSteps = steps.slice(1);
  const heroHtml = renderFunnelHero(role, timeframe, heroStep, values, goalSet);
  const miniHtml = miniSteps.map(step => renderFunnelMini(role, timeframe, step, values, goalSet, range)).join('');
  return `
    <div class="card funnel-card ${role}">
      <div class="hero-row ${miniSteps.length <= 2 ? 'v3' : ''}">
        ${heroHtml}
        ${miniHtml}
      </div>
    </div>`;
}

/** Prima tappa del funnel, resa in grande ("hero") — sempre la tappa "di ingresso"
 * (Appuntamenti Fissati per il setter, Appuntamenti Assegnati — manuale — per il venditore). */
function renderFunnelHero(role, timeframe, step, values, goalSet) {
  const current = values[step.key] || 0;
  const isMoney = step.money;
  const fmtVal = (n) => isMoney ? `€${round2(n)}` : String(n);

  if (step.isAutoAssignedField) {
    // Conteggio automatico dal CRM (righe con ruolo Venditore nel periodo) — non più un
    // campo manuale: "current" arriva già da computeFunnelValues come le altre tappe.
    const assigned = current;
    const presentedPct = assigned > 0 ? pct(values.presentati, assigned) : 0;
    const closedPct = assigned > 0 ? pct(values.chiusi, assigned) : 0;
    return `
      <div class="hero-main ${role}">
        <div class="hero-label">${escapeHtml(step.label)}</div>
        <div class="hero-num" data-kpi-num="${assigned}" data-kpi-money="0" data-kpi-display="${assigned}">${assigned}</div>
        <div class="hero-of">${presentedPct}% presentati · ${closedPct}% chiusi (su assegnati)</div>
      </div>`;
  }

  const target = goalSet[step.key] || 0;
  const progressPct = target > 0 ? Math.min(100, pct(current, target)) : 0;
  const complete = target > 0 && current >= target;
  const editing = uiState.editingGoal && uiState.editingGoal.role === role && uiState.editingGoal.timeframe === timeframe && uiState.editingGoal.step === step.key;

  const editRow = editing
    ? `<input type="number" min="0" class="funnel-target-input" id="goalEditInput" value="${target}">`
    : `<span class="hero-of">obiettivo ${fmtVal(target)}${target > 0 ? (complete ? ' — superato' : '') : ''}</span><button class="funnel-target-edit" data-edit-goal="1" data-role="${role}" data-tf="${timeframe}" data-step="${step.key}" title="Modifica obiettivo">✎</button>`;

  return `
    <div class="hero-main ${role}">
      <div class="hero-label">${escapeHtml(step.label)}</div>
      <div class="hero-num" data-kpi-num="${current}" data-kpi-money="${isMoney ? '1' : '0'}" data-kpi-display="${fmtVal(current)}">${fmtVal(current)}</div>
      <div class="hero-edit-row">${editRow}</div>
      <div class="goal-bar-track hero-bar" data-goal-pct="${progressPct}"><div class="goal-bar-fill ${complete ? 'complete' : ''}" style="width:${progressPct}%"></div></div>
    </div>`;
}

/** Tappe successive del funnel, rese come tile compatte con mini-storico a barre (sparkline). */
function renderFunnelMini(role, timeframe, step, values, goalSet, range) {
  const current = values[step.key] || 0;
  const isMoney = step.money;
  const fmtVal = (n) => isMoney ? `€${round2(n)}` : String(n);
  const target = goalSet[step.key] || 0;
  const progressPct = target > 0 ? Math.min(100, pct(current, target)) : 0;
  const complete = target > 0 && current >= target;
  const editing = uiState.editingGoal && uiState.editingGoal.role === role && uiState.editingGoal.timeframe === timeframe && uiState.editingGoal.step === step.key;

  const targetHtml = editing
    ? `<input type="number" min="0" class="funnel-target-input" id="goalEditInput" value="${target}">`
    : `<span>${fmtVal(target)}</span><button class="funnel-target-edit" data-edit-goal="1" data-role="${role}" data-tf="${timeframe}" data-step="${step.key}" title="Modifica obiettivo">✎</button>`;

  const series = computeFunnelSparkline(db, role, step.key, timeframe, range);
  const maxVal = Math.max(1, ...series);
  const barsHtml = series.map(v => {
    const h = Math.max(6, Math.round((v / maxVal) * 100));
    const on = v > 0 ? 'on' : '';
    return `<i class="${on}" style="height:${h}%"></i>`;
  }).join('');

  return `
    <div class="mini ${role}">
      <div class="mini-label">${escapeHtml(step.label)}</div>
      <div class="mini-num" data-kpi-num="${current}" data-kpi-money="${isMoney ? '1' : '0'}" data-kpi-display="${fmtVal(current)}">${fmtVal(current)}</div>
      <div class="mini-target">/ ${targetHtml}</div>
      <div class="spark" data-goal-pct="${progressPct}">${barsHtml}</div>
    </div>`;
}

function wireDashboardTopSectionEvents() {
  appRoot.querySelectorAll('[data-goals-tf]').forEach(btn => {
    btn.addEventListener('click', () => {
      uiState.goalsTimeframe = btn.dataset.goalsTf;
      renderDashboard();
    });
  });
  appRoot.querySelectorAll('[data-edit-goal]').forEach(btn => {
    btn.addEventListener('click', () => {
      uiState.editingGoal = { role: btn.dataset.role, timeframe: btn.dataset.tf, step: btn.dataset.step };
      renderDashboard();
      const input = document.getElementById('goalEditInput');
      if (input) { input.focus(); input.select(); }
    });
  });
  const goalInput = document.getElementById('goalEditInput');
  if (goalInput) {
    const commit = () => {
      const g = uiState.editingGoal;
      if (!g) return;
      const val = Math.max(0, parseFloat(goalInput.value) || 0);
      db.goals[g.role][g.timeframe][g.step] = val;
      uiState.editingGoal = null;
      persist();
      renderDashboard();
    };
    goalInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') commit();
      if (e.key === 'Escape') { uiState.editingGoal = null; renderDashboard(); }
    });
    goalInput.addEventListener('blur', commit);
  }

  appRoot.querySelectorAll('[data-andamento-tf]').forEach(btn => {
    btn.addEventListener('click', () => {
      uiState.andamentoTimeframe = btn.dataset.andamentoTf;
      if (btn.dataset.andamentoTf !== 'custom') { uiState.andamentoCustomFrom = null; uiState.andamentoCustomTo = null; }
      renderDashboard();
    });
  });
  const btnAndamentoApply = document.getElementById('btnAndamentoApplyRange');
  if (btnAndamentoApply) {
    btnAndamentoApply.addEventListener('click', () => {
      const from = document.getElementById('andamentoDateFrom').value;
      const to = document.getElementById('andamentoDateTo').value;
      if (!from || !to) return;
      uiState.andamentoCustomFrom = from;
      uiState.andamentoCustomTo = to;
      renderDashboard();
    });
  }
  appRoot.querySelectorAll('[data-andamento-comm-role]').forEach(btn => {
    btn.addEventListener('click', () => {
      uiState.andamentoCommRole = btn.dataset.andamentoCommRole;
      renderDashboard();
    });
  });

  wireLineCharts(appRoot);
}

/* ============================================================================
 * Andamento generale (dashboard) — KPI commissioni timeframe-aware + due grafici a
 * linea (Commissioni, Totale Venduto). Prima era fissa sul mese corrente; su richiesta
 * esplicita dell'utente ora ha gli stessi timeframe delle sessioni (incluso un periodo
 * personalizzato), e il grafico Commissioni ha in più un filtro Tutti/Setter/Venditore
 * per vedere come sono cresciute le due parti separatamente nel tempo.
 * ==========================================================================*/

function renderCommissionKpiSection() {
  const tf = uiState.andamentoTimeframe || 'mese_corrente';
  const range = getTimeframeRange(tf, uiState.andamentoCustomFrom, uiState.andamentoCustomTo);
  const summary = computeCommissionSummary(db, range);
  const pace = db.settings.toggles.closingPace ? renderClosingPaceNote() : '';
  const personalBest = db.settings.toggles.personalBest ? renderPersonalBestBadge() : '';

  const commRole = uiState.andamentoCommRole || 'all';
  const commSeries = buildAndamentoSeries(range, tf, 'commissioni', commRole);
  const venditoSeries = buildAndamentoSeries(range, tf, 'venduto', 'all');

  const commChart = renderLineChart(commSeries.values, commSeries.labels, { color: commRole === 'setter' ? 'var(--setter-color)' : (commRole === 'venditore' ? 'var(--venditore-color)' : 'var(--accent)'), money: true });
  const vendutoChart = renderLineChart(venditoSeries.values, venditoSeries.labels, { color: 'var(--accent)', money: true });

  return `
    <div class="section-separator"><span class="eyebrow">Andamento generale</span></div>

    <section class="card filters-bar">
      <div class="timeframe-pills">
        ${Object.keys(TIMEFRAME_LABELS).filter(k => k !== 'custom').map(k =>
          `<button class="pill ${tf === k ? 'active' : ''}" data-andamento-tf="${k}">${TIMEFRAME_LABELS[k]}</button>`
        ).join('')}
        <button class="pill ${tf === 'custom' ? 'active' : ''}" data-andamento-tf="custom">Personalizzato</button>
      </div>
      ${tf === 'custom' ? `
      <div class="custom-range">
        <label>dal <input type="date" id="andamentoDateFrom" value="${uiState.andamentoCustomFrom ? uiState.andamentoCustomFrom : dateInputValue(range.start)}"></label>
        <label>al <input type="date" id="andamentoDateTo" value="${uiState.andamentoCustomTo ? uiState.andamentoCustomTo : dateInputValue(range.end)}"></label>
        <button class="btn-ghost" id="btnAndamentoApplyRange">Applica</button>
      </div>` : ''}
    </section>

    <section class="kpi-grid">
      <div class="card kpi-card accented" data-ticker-anchor="1">
        <div class="kpi-value" data-kpi-num="${summary.total}" data-kpi-money="1" data-kpi-display="€${summary.total}">€${summary.total}</div>
        <div class="kpi-label">Commissioni Tot.</div>
      </div>
      <div class="card kpi-card">
        <div class="kpi-value" data-kpi-num="${summary.setting}" data-kpi-money="1" data-kpi-display="€${summary.setting}">€${summary.setting}</div>
        <div class="kpi-label">Da Setting (chiusure)</div>
      </div>
      <div class="card kpi-card">
        <div class="kpi-value" data-kpi-num="${summary.vendita}" data-kpi-money="1" data-kpi-display="€${summary.vendita}">€${summary.vendita}</div>
        <div class="kpi-label">Da Vendita</div>
      </div>
      <div class="card kpi-card">
        <div class="kpi-value" data-kpi-num="${summary.showup}" data-kpi-money="1" data-kpi-display="€${summary.showup}">€${summary.showup}</div>
        <div class="kpi-label">Show Up (setter)</div>
      </div>
    </section>
    ${pace}${personalBest}

    <section class="two-col">
      <div class="card chart-card">
        <div class="chart-card-header">
          <h3>Commissioni nel tempo</h3>
          <div class="chip-select-row" style="gap:4px;">
            <button class="chip-select ${commRole === 'all' ? 'active' : ''}" data-andamento-comm-role="all">Tutti</button>
            <button class="chip-select ${commRole === 'setter' ? 'active' : ''}" data-andamento-comm-role="setter">Setter</button>
            <button class="chip-select ${commRole === 'venditore' ? 'active' : ''}" data-andamento-comm-role="venditore">Venditore</button>
          </div>
        </div>
        ${commChart}
      </div>
      <div class="card chart-card">
        <h3>Totale Venduto nel tempo</h3>
        ${vendutoChart}
      </div>
    </section>
  `;
}

/**
 * Serie storica per i grafici a linea "Andamento generale" — divide il range scelto in
 * bucket temporali (stesso principio di computeFunnelSparkline, ma con più punti quando il
 * range è ampio, per dare un vero andamento "a linea che sale" invece di pochi punti) e
 * somma commissioni o totale venduto in ciascun bucket.
 * - metric 'commissioni': somma commissionEventsInRange (opzionalmente filtrata per ruolo).
 * - metric 'venduto': somma apptTotalSold() degli appuntamenti CHIUSI con scheduledAt nel
 *   bucket (coerente con come viene calcolato "Totale Venduto" altrove — vedi
 *   computeVenditoreStats.totalVenduto — ma qui su entrambi i ruoli).
 */
function buildAndamentoSeries(range, timeframe, metric, role) {
  const totalMs = range.end.getTime() - range.start.getTime();
  const totalDays = Math.max(1, Math.round(totalMs / 86400000));
  // Un punto per giorno fino a 31gg, altrimenti ~30 bucket per non affollare il grafico
  // su range molto ampi (90gg, mese scorso vs mese corrente ravvicinati, personalizzati lunghi).
  const numBuckets = Math.min(totalDays, totalDays <= 31 ? totalDays : 30);
  const stepMs = totalMs / numBuckets;

  const buckets = [];
  for (let i = 0; i < numBuckets; i++) {
    const bStart = new Date(range.start.getTime() + stepMs * i);
    const bEnd = i === numBuckets - 1 ? range.end : new Date(range.start.getTime() + stepMs * (i + 1) - 1);
    buckets.push({ start: bStart, end: bEnd });
  }

  const values = buckets.map(b => {
    if (metric === 'commissioni') {
      const events = commissionEventsInRange(db, b, role === 'all' ? undefined : role);
      return sumEvents(events);
    }
    const closedAppts = (db.appointments || []).filter(a => a.closed && a.scheduledAt && inRange(a.scheduledAt, b));
    return round2(closedAppts.reduce((s, a) => s + apptTotalSold(a), 0));
  });
  const labels = buckets.map(formatBucketLabel);

  return { values, labels };
}

/** Etichetta leggibile di un bucket temporale per l'asse/tooltip dei grafici a linea:
 * un giorno singolo ("16 set") se il bucket è ~1 giorno, altrimenti un range ("10–13 set")
 * per i bucket aggregati (range molto ampi, dove buildAndamentoSeries usa ~30 bucket
 * invece di uno per giorno). Così l'hover mostra sempre il "giorno/microperiodo" giusto,
 * come richiesto esplicitamente dall'utente. */
function formatBucketLabel(b) {
  const fmtShort = (d) => new Date(d).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
  if (dateInputValue(b.start) === dateInputValue(b.end)) return fmtShort(b.start);
  return `${fmtShort(b.start)} – ${fmtShort(b.end)}`;
}

/**
 * Tick "puliti" per l'asse Y in stile normale-grafico (0 / 500 / 1.000 / ...), invece di
 * dividere il massimo in parti uguali senza senso. tickCount è indicativo: il numero
 * finale di tick dipende da quale step "pulito" (1/2/5 × potenza di 10) copre il range.
 */
function niceTicks(maxVal, tickCount) {
  if (maxVal <= 0) return [0, 1];
  const rawStep = maxVal / tickCount;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const residual = rawStep / magnitude;
  let niceResidual;
  if (residual > 5) niceResidual = 10;
  else if (residual > 2) niceResidual = 5;
  else if (residual > 1) niceResidual = 2;
  else niceResidual = 1;
  const step = niceResidual * magnitude;
  const niceMax = Math.ceil(maxVal / step) * step;
  const ticks = [];
  for (let v = 0; v <= niceMax + 1e-9; v += step) ticks.push(Math.round(v * 100) / 100);
  return ticks;
}

/**
 * Grafico a linea SVG minimale (nessuna libreria esterna): stroke colorato + area
 * riempita con gradiente leggero sotto la linea. Oltre alla linea colorata, il grafico
 * ha (su richiesta esplicita dell'utente):
 * - un asse Y a sinistra con valori in euro puliti (0/500/1.000/...), "come un normale
 *   grafico", invece di lasciare i valori solo nel footer;
 * - un cursore (crosshair) che segue il mouse/tocco e si aggancia al punto più vicino,
 *   con una mini-card che mostra il giorno/microperiodo e la commissione/importo esatti
 *   di quel punto — vedi wireLineCharts per l'interazione.
 * Il rendering usa un viewBox con lo STESSO rapporto d'aspetto del box CSS (via
 * aspect-ratio), quindi niente preserveAspectRatio="none": cerchi e testo non si
 * deformano più con la larghezza del contenitore.
 * opts.color accetta qualunque valore CSS valido (anche var(--...) del tema attivo).
 */
let lineChartIdCounter = 0;
let lineChartRegistry = {};
function renderLineChart(series, labels, opts) {
  opts = opts || {};
  const color = opts.color || 'var(--accent)';
  const money = !!opts.money;
  const w = 640, h = 220, padX = 10, padY = 14, axisW = 64;
  const plotX0 = axisW, plotW = w - axisW - padX;
  const gradId = 'lcGrad' + (lineChartIdCounter++);
  const chartId = 'lc' + lineChartIdCounter;

  if (!series.length || series.every(v => v === 0)) {
    return `<div class="chart-empty text-dim">Nessun dato nel periodo selezionato.</div>`;
  }

  const ticks = niceTicks(Math.max(...series), 4);
  const domainMax = ticks[ticks.length - 1] || 1;
  const n = series.length;
  const xStep = n > 1 ? plotW / (n - 1) : 0;
  const yFor = (v) => padY + (1 - v / domainMax) * (h - padY * 2);
  const points = series.map((v, i) => [plotX0 + xStep * i, yFor(v)]);

  const linePath = points.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
  const areaPath = linePath + ` L${points[n - 1][0].toFixed(1)},${(h - padY).toFixed(1)} L${points[0][0].toFixed(1)},${(h - padY).toFixed(1)} Z`;

  const lastVal = series[series.length - 1];
  const firstVal = series[0];
  const fmtVal = (v) => money ? `€${round2(v)}` : String(v);

  const gridlinesHtml = ticks.map(t => {
    const y = yFor(t).toFixed(1);
    return `<line class="line-chart-grid" x1="${plotX0}" y1="${y}" x2="${(w - padX).toFixed(1)}" y2="${y}"/>`;
  }).join('');
  const axisLabelsHtml = ticks.map(t => {
    const topPct = ((yFor(t) / h) * 100).toFixed(2);
    return `<div class="line-chart-yaxis-tick" style="top:${topPct}%;">${fmtVal(t)}</div>`;
  }).join('');

  lineChartRegistry[chartId] = { points, values: series, labels: labels || [], color, money, w, h, padY };

  return `
    <div class="line-chart-wrap" data-chart-id="${chartId}">
      <div class="line-chart-body">
        <div class="line-chart-yaxis" style="width:${axisW}px;">${axisLabelsHtml}</div>
        <div class="line-chart-plot-wrap" style="aspect-ratio:${(w - axisW)} / ${h};">
          <svg class="line-chart-svg" viewBox="${plotX0} 0 ${w - plotX0} ${h}" preserveAspectRatio="none">
            <defs>
              <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="${color}" stop-opacity="0.35"/>
                <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
              </linearGradient>
            </defs>
            ${gridlinesHtml}
            <path d="${areaPath}" fill="url(#${gradId})" stroke="none"/>
            <path d="${linePath}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
            ${points.map(p => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2.4" fill="${color}"/>`).join('')}
            <line class="line-chart-crosshair" x1="0" y1="${padY}" x2="0" y2="${h - padY}" hidden/>
            <circle class="line-chart-hoverdot" cx="0" cy="0" r="4.5" fill="${color}" hidden/>
            <rect class="line-chart-hit" x="${plotX0}" y="0" width="${w - plotX0}" height="${h}" fill="transparent"/>
          </svg>
          <div class="line-chart-tooltip" hidden>
            <div class="line-chart-tooltip-value"></div>
            <div class="line-chart-tooltip-label"></div>
          </div>
        </div>
      </div>
      <div class="line-chart-footer">
        <span class="text-dim">Inizio: ${fmtVal(firstVal)}</span>
        <span class="line-chart-last" style="color:${color};">Ultimo: ${fmtVal(lastVal)}</span>
      </div>
    </div>`;
}

/**
 * Wiring del cursore/tooltip per ogni grafico a linea renderizzato in root (chiamare
 * dopo aver inserito l'HTML nel DOM). Legge i dati dal registry popolato da
 * renderLineChart (punti in coordinate SVG, valori e etichette periodo) invece di
 * ricalcolarli o di serializzarli nell'HTML, più semplice ed evita problemi di escaping.
 */
function wireLineCharts(root) {
  (root || appRoot).querySelectorAll('[data-chart-id]').forEach(wrap => {
    const chart = lineChartRegistry[wrap.dataset.chartId];
    if (!chart) return;
    const svg = wrap.querySelector('.line-chart-svg');
    const hit = wrap.querySelector('.line-chart-hit');
    const crosshair = wrap.querySelector('.line-chart-crosshair');
    const hoverDot = wrap.querySelector('.line-chart-hoverdot');
    const tooltip = wrap.querySelector('.line-chart-tooltip');
    const tooltipValue = tooltip ? tooltip.querySelector('.line-chart-tooltip-value') : null;
    const tooltipLabel = tooltip ? tooltip.querySelector('.line-chart-tooltip-label') : null;
    if (!svg || !hit || !crosshair || !hoverDot || !tooltip) return;

    const fmtVal = (v) => chart.money ? `€${round2(v)}` : String(v);

    function showAt(index) {
      const p = chart.points[index];
      if (!p) return;
      crosshair.setAttribute('x1', p[0]); crosshair.setAttribute('x2', p[0]);
      crosshair.removeAttribute('hidden');
      hoverDot.setAttribute('cx', p[0]); hoverDot.setAttribute('cy', p[1]);
      hoverDot.removeAttribute('hidden');

      if (tooltipValue) tooltipValue.textContent = fmtVal(chart.values[index]);
      if (tooltipLabel) tooltipLabel.textContent = chart.labels[index] || '';
      const leftPct = (p[0] / chart.w) * 100;
      const topPct = (p[1] / chart.h) * 100;
      tooltip.style.top = topPct + '%';
      if (leftPct < 20) { tooltip.style.left = leftPct + '%'; tooltip.style.transform = 'translate(0, -100%)'; }
      else if (leftPct > 80) { tooltip.style.left = leftPct + '%'; tooltip.style.transform = 'translate(-100%, -100%)'; }
      else { tooltip.style.left = leftPct + '%'; tooltip.style.transform = 'translate(-50%, -100%)'; }
      tooltip.hidden = false;
    }

    function hide() {
      crosshair.setAttribute('hidden', '');
      hoverDot.setAttribute('hidden', '');
      tooltip.hidden = true;
    }

    function handleMove(clientX) {
      const rect = svg.getBoundingClientRect();
      if (!rect.width) return;
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      const viewBoxParts = svg.getAttribute('viewBox').split(' ').map(Number);
      const xUser = viewBoxParts[0] + ratio * viewBoxParts[2];
      let nearest = 0, best = Infinity;
      chart.points.forEach((p, i) => { const d = Math.abs(p[0] - xUser); if (d < best) { best = d; nearest = i; } });
      showAt(nearest);
    }

    hit.addEventListener('pointermove', (e) => handleMove(e.clientX));
    hit.addEventListener('pointerdown', (e) => handleMove(e.clientX));
    hit.addEventListener('pointerleave', hide);
    hit.addEventListener('mouseleave', hide);
  });
}

/* ---------- Ritmo di chiusura (toggle 9) ---------- */
function renderClosingPaceNote() {
  const now = new Date();
  const monthRange = currentPeriodRanges().month;
  const daysSoFar = now.getDate();
  const closedSoFar = db.appointments.filter(a => a.closed && inRange(a.scheduledAt, monthRange)).length;
  const avgPerDay = daysSoFar > 0 ? closedSoFar / daysSoFar : 0;
  const targetClosures = (db.goals.setter.month.chiusi || 0) + (db.goals.venditore.month.chiusi || 0);

  if (targetClosures <= 0) return '';
  if (closedSoFar >= targetClosures) return `<p class="pace-note pace-ok">Ritmo di chiusura: obiettivo mensile già raggiunto (${closedSoFar}/${targetClosures}).</p>`;
  if (avgPerDay <= 0) return `<p class="pace-note pace-bad">Ritmo di chiusura: ancora nessuna chiusura questo mese, ritmo insufficiente per raggiungere ${targetClosures}.</p>`;

  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysLeft = lastDay - daysSoFar;
  const remaining = targetClosures - closedSoFar;
  const neededPerDay = daysLeft > 0 ? remaining / daysLeft : Infinity;

  if (neededPerDay > avgPerDay) {
    const deficit = round1(neededPerDay - avgPerDay);
    return `<p class="pace-note pace-bad">Ritmo insufficiente: mancano circa ${deficit} chiusure/giorno in più rispetto al ritmo attuale (${round1(avgPerDay)}/giorno) per raggiungere l'obiettivo entro fine mese.</p>`;
  }
  const daysToTarget = Math.ceil(remaining / avgPerDay);
  const eta = new Date(now); eta.setDate(eta.getDate() + daysToTarget);
  return `<p class="pace-note pace-ok">Al ritmo attuale (${round1(avgPerDay)} chiusure/giorno), raggiungerai l'obiettivo mensile entro il ${fmtDate(eta)}.</p>`;
}

/* ---------- Personal best (toggle 10) ---------- */
function renderPersonalBestBadge() {
  const now = new Date();
  const thisWeekRange = { start: startOfWeek(now), end: endOfWeek(now) };
  const thisWeekEvents = commissionEventsInRange(db, thisWeekRange);
  const thisWeekTotal = sumEvents(thisWeekEvents);
  const thisWeekClosures = db.appointments.filter(a => a.closed && inRange(a.scheduledAt, thisWeekRange)).length;

  // Confronta con tutte le settimane passate presenti nei dati (appuntamenti + eventi).
  const allDates = db.appointments.map(a => new Date(a.scheduledAt)).filter(d => !isNaN(d));
  if (!allDates.length) return '';
  let bestPastTotal = 0, bestPastClosures = 0;
  const seenWeeks = new Set();
  allDates.forEach(d => {
    const s = startOfWeek(d);
    const key = s.toISOString();
    if (seenWeeks.has(key)) return;
    seenWeeks.add(key);
    if (s.getTime() === startOfWeek(now).getTime()) return; // esclude la settimana corrente
    const wRange = { start: s, end: endOfWeek(d) };
    const wTotal = sumEvents(commissionEventsInRange(db, wRange));
    const wClosures = db.appointments.filter(a => a.closed && inRange(a.scheduledAt, wRange)).length;
    if (wTotal > bestPastTotal) bestPastTotal = wTotal;
    if (wClosures > bestPastClosures) bestPastClosures = wClosures;
  });

  if (thisWeekTotal > bestPastTotal || thisWeekClosures > bestPastClosures) {
    return `<div class="personalbest-badge">🏆 Nuovo record della settimana (${thisWeekClosures} chiusure, €${round2(thisWeekTotal)})</div>`;
  }
  return '';
}

/* ---------- Streak giornaliero (toggle 4) ---------- */
function computeStreak() {
  const daysWithAppt = new Set(db.appointments.map(a => dateInputValue(a.createdAt)));
  let streak = 0;
  let cursor = new Date();
  while (daysWithAppt.has(dateInputValue(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/* ---------- Report Sessione (testo pronto da incollare, es. per il direttore commerciale) ---------- */

function buildSessionReportText(stats, periodLabel, pipelineLabel) {
  const lines = [];
  lines.push(`Report chiamate — ${periodLabel}`);
  lines.push(`Pipeline: ${pipelineLabel}`);
  lines.push('');
  lines.push(`Chiamate svolte: ${stats.totalCalls}`);
  lines.push(`Lead unici: ${stats.totalLeads}`);
  lines.push('');
  if (stats.sortedOutcomes.length) {
    stats.sortedOutcomes.forEach(([label, count]) => lines.push(`${label}: ${count}`));
  } else {
    lines.push('Nessuna chiamata registrata in questo periodo.');
  }
  return lines.join('\n');
}

async function generateSessionReport() {
  const range = getTimeframeRange(uiState.timeframe, uiState.customFrom, uiState.customTo);
  const filteredSessions = getFilteredSessions(db, range, uiState.pipelineFilter);
  const stats = computeStats(filteredSessions);

  const periodLabel = uiState.timeframe === 'custom'
    ? `dal ${fmtDate(range.start)} al ${fmtDate(range.end)}`
    : TIMEFRAME_LABELS[uiState.timeframe];
  const pipeline = uiState.pipelineFilter !== 'all' ? db.pipelines.find(p => p.id === uiState.pipelineFilter) : null;
  const pipelineLabel = pipeline ? pipeline.name : 'Tutte le pipeline';

  const text = buildSessionReportText(stats, periodLabel, pipelineLabel);
  const copied = await copyToClipboard(text);
  showReportModal(text, copied);
}

/**
 * Report copia-incolla della schermata Appuntamenti Setter — una riga per appuntamento
 * con le stesse voci della tabella (nome, data/ora, presentato, chiuso) più cash
 * collected, totale venduto e la commissione che spetta su quella riga, così può essere
 * condiviso col direttore commerciale a fine mese per verificare chi si è presentato e
 * quanto spetta. Vive nella sezione Setting (split Setter/Venditore): sempre e solo
 * righe role:'setter' — vedi generateAppointmentsReport.
 */
function buildAppointmentsReportText(rows, filterLabel) {
  const lines = [];
  lines.push(`Report Appuntamenti — ${filterLabel}`);
  lines.push(`Generato il ${fmtDate(new Date())}`);
  lines.push('');

  if (!rows.length) {
    lines.push('Nessun appuntamento in questo elenco.');
    return lines.join('\n');
  }

  const presentedLabel = (a) => {
    if (a.presentedStatus === 'presented') return 'Presentato';
    if (a.presentedStatus === 'confirmed24h') return 'Confermato24h';
    if (a.presentedStatus === 'no_show') return 'No Show';
    return 'No';
  };

  let totalCash = 0, totalSold = 0, totalCommission = 0;

  rows.forEach(a => {
    const roleLabel = 'Setter';
    const cash = a.cashCollected || 0;
    const sold = apptTotalSold(a);
    const commission = sumEvents(commissionEventsForAppointment(a));
    totalCash += cash;
    totalSold += sold;
    totalCommission += commission;

    lines.push(`${a.clientName || '(senza nome)'} — ${roleLabel}`);
    lines.push(`  Data/ora: ${a.scheduledAt ? fmtDateTime(a.scheduledAt) : '—'}`);
    lines.push(`  Presentato: ${presentedLabel(a)} · Chiuso: ${a.closed ? 'Sì' : 'No'}`);
    lines.push(`  Cash collected: €${round2(cash)} · Totale venduto: €${round2(sold)}`);
    lines.push(`  Commissione: €${round2(commission)}`);
    lines.push('');
  });

  lines.push('---');
  lines.push(`Totale appuntamenti: ${rows.length}`);
  lines.push(`Totale cash collected: €${round2(totalCash)}`);
  lines.push(`Totale venduto: €${round2(totalSold)}`);
  lines.push(`Totale commissioni: €${round2(totalCommission)}`);

  return lines.join('\n');
}

// Report per il direttore commerciale — vive nella sezione Setting (split Setter/
// Venditore), quindi copre sempre e solo gli appuntamenti Setter, rispettando l'eventuale
// filtro "Solo No Show" attivo sulla tabella così il report riflette quello che si vede.
async function generateAppointmentsReport() {
  const filter = uiState.crmSetterFilter || 'all';
  let rows = db.appointments.filter(a => a.role === 'setter');
  if (filter === 'no_show') rows = rows.filter(a => a.presentedStatus === 'no_show');
  rows = [...rows].sort((a, b) => new Date(b.scheduledAt) - new Date(a.scheduledAt));
  const filterLabel = filter === 'no_show' ? 'Setter — solo No Show' : 'Setter';

  const text = buildAppointmentsReportText(rows, filterLabel);
  const copied = await copyToClipboard(text);
  showReportModal(text, copied, 'Report Appuntamenti');
}

/**
 * Report copia-incolla della schermata Appuntamenti Venditore — stessa idea del report
 * Setter, ma con le voci proprie del funnel Venditore: stato trattativa (dealStage) al
 * posto di presentato/chiuso booleani, e nota sull'eventuale prossimo follow-up così chi
 * legge il report vede anche cosa è ancora aperto, non solo i chiusi. Rispetta il filtro
 * attivo sulla tabella (Tutti/Trattativa/No Show/Perso) come già fa quello Setter.
 */
function buildVenditoreAppointmentsReportText(rows, filterLabel) {
  const lines = [];
  lines.push(`Report Appuntamenti — ${filterLabel}`);
  lines.push(`Generato il ${fmtDate(new Date())}`);
  lines.push('');

  if (!rows.length) {
    lines.push('Nessun appuntamento in questo elenco.');
    return lines.join('\n');
  }

  let totalCash = 0, totalSold = 0, totalCommission = 0, totalChiusi = 0;

  rows.forEach(a => {
    const stageLabel = a.dealStage && dealStageDef(a.dealStage) ? dealStageDef(a.dealStage).label : 'Da impostare';
    const cash = a.cashCollected || 0;
    const sold = apptTotalSold(a);
    const commission = sumEvents(commissionEventsForAppointment(a));
    totalCash += cash;
    totalSold += sold;
    totalCommission += commission;
    if (a.closed) totalChiusi += 1;

    const lastNote = (a.notes || []).length ? a.notes[a.notes.length - 1].text : null;

    lines.push(`${a.clientName || '(senza nome)'} — Venditore`);
    lines.push(`  Data/ora: ${a.scheduledAt ? fmtDateTime(a.scheduledAt) : '—'}`);
    lines.push(`  Stato trattativa: ${stageLabel}`);
    lines.push(`  Cash collected: €${round2(cash)} · Totale venduto: €${round2(sold)}`);
    lines.push(`  Commissione: €${round2(commission)}`);
    if (a.nextFollowUpDate) lines.push(`  Prossimo follow-up: ${fmtDate(a.nextFollowUpDate)}`);
    if (lastNote) lines.push(`  Ultima nota: ${lastNote}`);
    lines.push('');
  });

  lines.push('---');
  lines.push(`Totale appuntamenti: ${rows.length}`);
  lines.push(`Chiusi: ${totalChiusi}`);
  lines.push(`Totale cash collected: €${round2(totalCash)}`);
  lines.push(`Totale venduto: €${round2(totalSold)}`);
  lines.push(`Totale commissioni: €${round2(totalCommission)}`);

  return lines.join('\n');
}

// Report per il direttore commerciale — sezione Venditore, rispetta l'eventuale filtro
// (Tutti/Trattativa/No Show/Perso) attivo sulla tabella, come il report Setter.
async function generateVenditoreAppointmentsReport() {
  const filter = uiState.crmVenditoreFilter || 'all';
  let rows = db.appointments.filter(a => a.role === 'venditore');
  if (filter !== 'all') rows = rows.filter(a => a.dealStage === filter);
  rows = [...rows].sort((a, b) => new Date(b.scheduledAt) - new Date(a.scheduledAt));
  const filterLabels = { all: 'Venditore', trattativa: 'Venditore — solo Trattativa', no_show: 'Venditore — solo No Show', perso: 'Venditore — solo Perso' };
  const filterLabel = filterLabels[filter] || 'Venditore';

  const text = buildVenditoreAppointmentsReportText(rows, filterLabel);
  const copied = await copyToClipboard(text);
  showReportModal(text, copied, 'Report Appuntamenti');
}

/** Copia negli appunti con fallback per contesti (es. iframe sandbox) dove l'API moderna non è concessa. */
async function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      console.error('Clipboard API non riuscita, provo il fallback', e);
    }
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    ta.style.top = '0';
    ta.style.left = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch (e) {
    console.error('Fallback copia non riuscito', e);
    return false;
  }
}

function showReportModal(text, copied, title) {
  openModal(`
    <h3>${escapeHtml(title || 'Report sessione')}</h3>
    <p class="text-dim" style="font-size:0.85rem;">
      ${copied
        ? 'Copiato negli appunti — incollalo dove preferisci.'
        : 'Non sono riuscito a copiarlo automaticamente: seleziona il testo qui sotto e copialo (Ctrl/Cmd+C), oppure riprova col pulsante.'}
    </p>
    <textarea id="reportText" class="fb-config-textarea" style="min-height:220px;" readonly>${escapeHtml(text)}</textarea>
    <div class="modal-actions">
      <button class="btn-ghost" data-close-modal="1">Chiudi</button>
      <button class="btn-primary" id="btnCopyReportAgain">Copia</button>
    </div>
  `);
  modalRoot.querySelectorAll('[data-close-modal]').forEach(b => b.addEventListener('click', closeModal));

  const ta = document.getElementById('reportText');
  ta.focus();
  ta.select();

  document.getElementById('btnCopyReportAgain').addEventListener('click', async () => {
    ta.focus();
    ta.select();
    const ok = await copyToClipboard(text);
    showToast(ok ? 'Copiato negli appunti.' : 'Seleziona il testo e copia manualmente.', !ok);
  });
}

/* ---------- Sessioni (elenco + dettaglio) ---------- */

function renderSessioniList() {
  uiState.settingTab = 'sessioni';
  const filterId = uiState.sessioniPipelineFilter || 'all';
  const sessions = [...db.sessions]
    .filter(s => filterId === 'all' || s.pipelineId === filterId)
    .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));

  const pipelineOptions = db.pipelines.map(p =>
    `<option value="${p.id}" ${filterId === p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`
  ).join('');

  const rows = sessions.length ? sessions.map(s => {
    const totalCalls = s.calls.length;
    const totalLeads = s.calls.filter(c => !c.isSecondAttempt).length;
    const duration = s.endedAt ? (new Date(s.endedAt) - new Date(s.startedAt)) : (Date.now() - new Date(s.startedAt));
    return `
      <div class="session-card" data-sid="${s.id}">
        <div class="session-card-main">
          <div class="session-card-title">Sessione ${s.number} - ${fmtDate(s.startedAt)}</div>
          <div class="session-card-sub">${escapeHtml(s.pipelineName)} · ${fmtTime(s.startedAt)}</div>
        </div>
        <div class="session-card-stats">
          <span>${fmtDuration(duration)}</span>
          <span>${totalCalls} chiamate</span>
          <span>${totalLeads} lead</span>
        </div>
      </div>`;
  }).join('') : '<p class="text-dim">Nessuna sessione registrata ancora. Inizia la prima!</p>';

  const activityHtml = renderCallActivitySection();

  appRoot.innerHTML = `
    ${renderSubTabsBar('setting', 'sessioni')}
    ${activityHtml}
    <div class="section-separator"><span class="eyebrow">Elenco sessioni</span></div>
    <section class="card filters-bar">
      <select id="sessioniPipelineFilter">
        <option value="all" ${filterId === 'all' ? 'selected' : ''}>Tutte le pipeline</option>
        ${pipelineOptions}
      </select>
    </section>
    <section class="session-list">${rows}</section>
  `;

  wireSubTabsBar('setting');
  wireCallActivitySection();
  document.getElementById('sessioniPipelineFilter').addEventListener('change', (e) => {
    uiState.sessioniPipelineFilter = e.target.value;
    renderSessioniList();
  });
  appRoot.querySelectorAll('.session-card').forEach(card => {
    card.addEventListener('click', () => { location.hash = '#/sessioni/' + card.dataset.sid; });
  });
  animateKpiValues(appRoot);
}

/**
 * Blocco "Attività di chiamata" (timeframe/pipeline, KPI chiamate/lead/risposta/conversione,
 * andamento vs periodo precedente, esiti nel periodo, confronto pipeline, produttività) —
 * SPOSTATO dalla Dashboard qui in Setting > Sessioni su richiesta esplicita dell'utente
 * ("non deve esserci la sezione attività di chiamata [in dashboard], quella và nella parte
 * setting"). Logica invariata, solo la posizione è cambiata; usa sempre uiState.timeframe/
 * uiState.pipelineFilter (stesso stato di prima, non duplicato).
 */
function renderCallActivitySection() {
  const range = getTimeframeRange(uiState.timeframe, uiState.customFrom, uiState.customTo);
  const filteredSessions = getFilteredSessions(db, range, uiState.pipelineFilter);
  const stats = computeStats(filteredSessions);

  const prevRange = previousPeriod(range);
  const prevSessions = getFilteredSessions(db, prevRange, uiState.pipelineFilter);
  const prevStats = computeStats(prevSessions);

  const callsTrend = trendDelta(stats.totalCalls, prevStats.totalCalls);
  const leadsTrend = trendDelta(stats.totalLeads, prevStats.totalLeads);
  const convTrend = trendDelta(stats.conversionRate, prevStats.conversionRate);

  const allInRange = getFilteredSessions(db, range, 'all');
  const byPipeline = {};
  allInRange.forEach(s => {
    if (!byPipeline[s.pipelineId]) byPipeline[s.pipelineId] = { name: s.pipelineName, sessions: [] };
    byPipeline[s.pipelineId].sessions.push(s);
  });
  const pipelineRows = Object.values(byPipeline)
    .map(p => ({ name: p.name, ...computeStats(p.sessions) }))
    .sort((a, b) => b.conversionRate - a.conversionRate);

  const pipelineOptions = db.pipelines.map(p =>
    `<option value="${p.id}" ${uiState.pipelineFilter === p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`
  ).join('');

  const outcomeBars = stats.sortedOutcomes.length ? stats.sortedOutcomes.map(([label, count]) => {
    const width = pct(count, stats.totalLeads);
    return `
      <div class="bar-row">
        <div class="bar-label">${escapeHtml(label)}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${width}%"></div></div>
        <div class="bar-value">${count}</div>
      </div>`;
  }).join('') : '<p class="text-dim">Nessuna chiamata registrata in questo periodo.</p>';

  const pipelineTableRows = pipelineRows.length ? pipelineRows.map(p => `
    <tr>
      <td>${escapeHtml(p.name)}</td>
      <td>${p.totalLeads}</td>
      <td>${p.responseRate}%</td>
      <td>${p.conversionRate}%</td>
    </tr>`).join('') : `<tr><td colspan="4" class="text-dim">Nessun dato</td></tr>`;

  return `
    <div class="section-separator"><span class="eyebrow">Attività di chiamata</span></div>

    <section class="card filters-bar">
      <div class="timeframe-pills">
        ${Object.keys(TIMEFRAME_LABELS).filter(k => k !== 'custom').map(k =>
          `<button class="pill ${uiState.timeframe === k ? 'active' : ''}" data-tf="${k}">${TIMEFRAME_LABELS[k]}</button>`
        ).join('')}
      </div>
      <div class="custom-range">
        <label>dal <input type="date" id="dateFrom" value="${uiState.customFrom ? uiState.customFrom : dateInputValue(range.start)}"></label>
        <label>al <input type="date" id="dateTo" value="${uiState.customTo ? uiState.customTo : dateInputValue(range.end)}"></label>
        <button class="btn-ghost" id="btnApplyRange">Applica</button>
      </div>
      <div class="pipeline-filter">
        <select id="pipelineFilter">
          <option value="all" ${uiState.pipelineFilter === 'all' ? 'selected' : ''}>Tutte le pipeline</option>
          ${pipelineOptions}
        </select>
      </div>
      <div class="filters-bar-actions">
        <button class="btn-ghost" id="btnSessionReport">Report Sessione</button>
      </div>
    </section>

    <section class="kpi-grid">
      <div class="card kpi-card"><div class="kpi-value">${stats.totalCalls}</div><div class="kpi-label">Chiamate totali</div></div>
      <div class="card kpi-card"><div class="kpi-value">${stats.totalLeads}</div><div class="kpi-label">Lead contattati</div></div>
      <div class="card kpi-card"><div class="kpi-value">${stats.responseRate}%</div><div class="kpi-label">Tasso di risposta</div></div>
      <div class="card kpi-card"><div class="kpi-value">${stats.conversionRate}%</div><div class="kpi-label">Tasso di conversione</div></div>
    </section>

    <section class="card trend-row">
      <h3>Andamento vs periodo precedente</h3>
      <div class="trend-grid">
        ${trendItem('Chiamate', callsTrend)}
        ${trendItem('Lead', leadsTrend)}
        ${trendItem('Conversione', convTrend)}
      </div>
    </section>

    <section class="two-col">
      <div class="card">
        <h3>Esiti nel periodo</h3>
        <p class="text-dim">Come si chiudono le chiamate.</p>
        <div class="bar-list">${outcomeBars}</div>
      </div>
      <div class="card">
        <h3>Confronto pipeline</h3>
        <table class="simple-table">
          <thead><tr><th>Pipeline</th><th>Lead</th><th>Risposta</th><th>Conversione</th></tr></thead>
          <tbody>${pipelineTableRows}</tbody>
        </table>
      </div>
    </section>

    <section class="card productivity">
      <h3>Produttività</h3>
      <div class="productivity-grid">
        <div><div class="stat-value">${stats.sessionsCount}</div><div class="stat-label">Sessioni</div></div>
        <div><div class="stat-value">${stats.avgCallsPerSession}</div><div class="stat-label">Chiamate/sessione</div></div>
        <div><div class="stat-value">${stats.avgLeadsPerSession}</div><div class="stat-label">Lead/sessione</div></div>
        <div><div class="stat-value">${stats.callsPerHour}</div><div class="stat-label">Chiamate/ora</div></div>
        <div><div class="stat-value stat-value-sm">${stats.mostFrequent ? escapeHtml(stats.mostFrequent.label) : '—'}</div><div class="stat-label">Esito più frequente</div></div>
      </div>
    </section>
  `;
}

function wireCallActivitySection() {
  appRoot.querySelectorAll('[data-tf]').forEach(btn => {
    btn.addEventListener('click', () => {
      uiState.timeframe = btn.dataset.tf;
      uiState.customFrom = null;
      uiState.customTo = null;
      renderSessioniList();
    });
  });
  document.getElementById('btnApplyRange').addEventListener('click', () => {
    const from = document.getElementById('dateFrom').value;
    const to = document.getElementById('dateTo').value;
    if (!from || !to) return;
    uiState.timeframe = 'custom';
    uiState.customFrom = from;
    uiState.customTo = to;
    renderSessioniList();
  });
  document.getElementById('pipelineFilter').addEventListener('change', (e) => {
    uiState.pipelineFilter = e.target.value;
    renderSessioniList();
  });
  document.getElementById('btnSessionReport').addEventListener('click', generateSessionReport);
}

function renderSessioneDetail(id) {
  const s = db.sessions.find(x => x.id === id);
  if (!s) {
    appRoot.innerHTML = `<a href="#/sessioni" class="back-link">← Torna alle sessioni</a><p class="text-dim">Sessione non trovata.</p>`;
    return;
  }
  const totalCalls = s.calls.length;
  const totalLeads = s.calls.filter(c => !c.isSecondAttempt).length;
  const duration = s.endedAt ? (new Date(s.endedAt) - new Date(s.startedAt)) : (Date.now() - new Date(s.startedAt));
  const counts = {};
  s.calls.forEach(c => { counts[c.outcomeLabel] = (counts[c.outcomeLabel] || 0) + 1; });
  const breakdown = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([label, count]) => `
    <div class="bar-row">
      <div class="bar-label">${escapeHtml(label)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct(count, s.calls.length)}%"></div></div>
      <div class="bar-value">${count}</div>
    </div>`).join('') || '<p class="text-dim">Nessuna chiamata registrata.</p>';

  appRoot.innerHTML = `
    <a href="#/sessioni" class="back-link">← Torna alle sessioni</a>
    <section class="card">
      <h2>Sessione ${s.number} - ${fmtDate(s.startedAt)}</h2>
      <p class="text-dim">${escapeHtml(s.pipelineName)} · ${fmtTime(s.startedAt)}${s.endedAt ? ' – ' + fmtTime(s.endedAt) : ' (in corso)'}</p>
      <div class="kpi-grid">
        <div class="card kpi-card"><div class="kpi-value">${fmtDuration(duration)}</div><div class="kpi-label">Durata</div></div>
        <div class="card kpi-card"><div class="kpi-value">${totalCalls}</div><div class="kpi-label">Chiamate</div></div>
        <div class="card kpi-card"><div class="kpi-value">${totalLeads}</div><div class="kpi-label">Lead</div></div>
        <div class="card kpi-card"><div class="kpi-value">${s.skips || 0}</div><div class="kpi-label">Saltati</div></div>
      </div>
      <h3>Esiti</h3>
      <div class="bar-list">${breakdown}</div>
      <button class="btn-danger-ghost" id="btnDeleteSession">Elimina sessione</button>
    </section>
  `;

  document.getElementById('btnDeleteSession').addEventListener('click', () => {
    showConfirm('Eliminare definitivamente questa sessione?', () => {
      db.sessions = db.sessions.filter(x => x.id !== s.id);
      persist();
      location.hash = '#/sessioni';
      renderRoute();
    }, { confirmLabel: 'Elimina' });
  });
}

/* ============================================================================
 * Appuntamenti (mini-CRM) — sistema parallelo alle sessioni/pipeline di chiamata
 * outbound qui sopra. Non condivide dati con esse: solo la stessa app/topbar.
 * ==========================================================================*/

/**
 * Crea una nuova riga appuntamento con i default del modello dati (vedi commento
 * su db.appointments in storage.js). closedAt resta null finché non viene marcato
 * closed=true (vedi setAppointmentClosed) — è il campo che determina il mese di
 * incasso del cashCollected iniziale (vedi utils.js:appointmentCashDate).
 *
 * Split Setter/Venditore: presentedStatus/presentedAt restano il modello del Setter
 * (invariato). Il Venditore usa invece dealStage (vedi DEAL_STAGES) — uno stato
 * trattativa a scelta singola che sostituisce sia "presentato" sia "chiuso" per quel
 * ruolo; note[] e nextFollowUpDate sono campi aggiuntivi usati solo lato Venditore
 * (vedi renderVenditoreApptRow/openNotesModal).
 */
function newAppointment(role) {
  return {
    id: uid('appt'),
    createdAt: new Date().toISOString(),
    role: role || 'setter',
    clientName: '',
    phone: null,
    scheduledAt: new Date().toISOString().slice(0, 16),
    presentedStatus: 'no',
    presentedAt: null,
    closed: false,
    closedAt: null,
    cashCollected: 0,
    totalSold: 0,
    installments: [],
    linkedAppointmentId: null,
    dealStage: null,          // solo Venditore — vedi DEAL_STAGES
    notes: [],                // solo Venditore — { id, text, author, createdAt }
    nextFollowUpDate: null    // solo Venditore — YYYY-MM-DD (solo data, non ora)
  };
}

/**
 * Stati trattativa del Venditore (sostituiscono Presentato/Chiuso per questo ruolo).
 * Scelti dall'utente con schema colori esplicito. "chiusiSet" marca gli stati che
 * contano come chiusura ai fini di commissioni/funnel "Chiusi" (Contratto Firmato e
 * Chiuso — entrambi implicano soldi incassati/da incassare); "presentedSet" marca gli
 * stati che implicano che il lead si sia presentato (tutti tranne No Show, che per
 * definizione è l'assenza del lead — vedi computeFunnelValues per come viene usato).
 */
const DEAL_STAGES = [
  { key: 'no_show',           label: 'No Show',           color: 'mustard',  isClosed: false, isPresented: false },
  { key: 'annullato',         label: 'Annullato',         color: 'slate',    isClosed: false, isPresented: true },
  { key: 'trattativa',        label: 'Trattativa',        color: 'sky',      isClosed: false, isPresented: true },
  { key: 'contratto_firmato', label: 'Contratto Firmato', color: 'mint',     isClosed: true,  isPresented: true },
  { key: 'chiuso',            label: 'Chiuso',            color: 'forest',   isClosed: true,  isPresented: true },
  { key: 'perso',             label: 'Perso',             color: 'crimson',  isClosed: false, isPresented: true }
];
function dealStageDef(key) { return DEAL_STAGES.find(s => s.key === key) || null; }

function apptTotalSold(apt) {
  // Il totale venduto è editabile direttamente, ma se ci sono rate esplicite che
  // superano il valore salvato, mostriamo il massimo tra i due per coerenza visiva
  // (l'utente può comunque editare totalSold a mano in qualunque momento). Le rate
  // esplicite includono la rata sintetica "Acconto" (vedi getEffectiveInstallments),
  // quindi il cash collected è già conteggiato qui una sola volta.
  const instSum = getEffectiveInstallments(apt).reduce((s, i) => s + (i.amount || 0), 0);
  return Math.max(apt.totalSold || 0, instSum);
}

/**
 * CORREZIONE (segnalata dall'utente): prima il cash collected generava un evento di
 * commissione a parte ("_cash0"), indipendente dalle rate — se l'utente inseriva poi
 * il totale pacchetto reale come rate (es. 5100€), il tool sommava commissioni sia sul
 * cash collected (200€) sia sulle rate, contando quei 200€ due volte.
 *
 * Ora il cash collected è semplicemente la PRIMA rata, automatica e già pagata: questa
 * funzione restituisce le rate "effettive" di un appuntamento — una rata sintetica
 * "Acconto" pari a cashCollected (se > 0), seguita dalle rate vere e proprie inserite
 * dall'utente. Usata sia per il calcolo del totale (apptTotalSold) sia per generare gli
 * eventi di commissione (commissionEventsForAppointment) — così l'acconto viene contato
 * una volta sola ovunque, e l'utente nel popup rate deve aggiungere solo l'importo
 * MANCANTE rispetto a quanto già incassato.
 */
function getEffectiveInstallments(apt) {
  const real = apt.installments || [];
  if (!apt.cashCollected || apt.cashCollected <= 0) return real;
  const depositInst = {
    id: 'deposit',
    label: 'Acconto (cash collected)',
    amount: apt.cashCollected,
    dueDate: appointmentCashDate(apt),
    paid: true,
    paidDate: appointmentCashDate(apt),
    isDeposit: true
  };
  return [depositInst, ...real];
}

/**
 * Sezione Appuntamenti — SOLO Setter (split Setter/Venditore): questa tabella e tutte
 * le funzioni sottostanti (renderApptRow/wireAppuntamentiEvents/addBlankAppointmentRow)
 * mostrano/creano sempre e solo righe role:'setter'. La versione Venditore è un sistema
 * di rendering separato (vedi renderVenditoreAppuntamenti più sotto) con un layout e un
 * modello di stato (dealStage) diversi.
 */
function renderAppuntamenti() {
  uiState.settingTab = 'appuntamenti';
  const filter = uiState.crmSetterFilter || 'all'; // 'all' | 'no_show'
  let rows = db.appointments.filter(a => a.role === 'setter');
  if (filter === 'no_show') rows = rows.filter(a => a.presentedStatus === 'no_show');
  rows = [...rows].sort((a, b) => new Date(b.scheduledAt) - new Date(a.scheduledAt));

  const rowsHtml = rows.length ? rows.map(renderApptRow).join('') : '';

  appRoot.innerHTML = `
    ${renderSubTabsBar('setting', 'appuntamenti')}
    <section class="card crm-toolbar">
      <div class="crm-filters">
        <button class="pill ${filter === 'all' ? 'active' : ''}" data-crm-setter-filter="all">Tutti</button>
        <button class="pill ${filter === 'no_show' ? 'active' : ''}" data-crm-setter-filter="no_show">Solo No Show</button>
      </div>
      <div style="display:flex; gap:8px;">
        <button class="btn-ghost" id="btnApptCalendar">📅 Calendario</button>
        <button class="btn-ghost" id="btnApptReport">Report</button>
        <button class="btn-primary" id="btnNewAppt">+ Nuovo Appuntamento</button>
      </div>
    </section>
    <section class="card crm-table-wrap">
      ${rows.length ? `
      <table class="crm-table">
        <thead>
          <tr>
            <th>Nome / Telefono</th><th>Data/Ora</th><th>Presentato</th><th>Chiuso</th>
            <th>Cash Collected</th><th>Totale Venduto</th><th></th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>` : '<p class="text-dim">Nessun appuntamento ancora. Crea il primo con "+ Nuovo Appuntamento".</p>'}
    </section>
  `;

  wireAppuntamentiEvents();
}

/**
 * Riga della tabella Appuntamenti Setter — tutti i campi sono editabili INLINE,
 * direttamente nella riga (niente modal "Nuovo Appuntamento": vedi
 * wireAppuntamentiEvents, che crea la riga vuota e la aggiunge subito a
 * db.appointments). Presentato/Chiuso sono chip cliccabili, Nome/Telefono/Data-ora sono
 * input nativi con autosave su change/blur, coerente con Cash Collected già esistente.
 *
 * "No Show" aggiunto come quarta opzione di Presentato (oltre No/Confermato24h/Presentato)
 * su richiesta esplicita dell'utente, per poter filtrare i lead da richiamare per il
 * recupero — vedi il filtro "Solo No Show" in renderAppuntamenti.
 */
function renderApptRow(a) {
  const presentedChips = `
      <div class="crm-chip-group">
        <button class="crm-chip ${a.presentedStatus === 'no' ? 'active' : ''}" data-set-presented="${a.id}" data-val="no">No</button>
        <button class="crm-chip ${a.presentedStatus === 'confirmed24h' ? 'active' : ''}" data-set-presented="${a.id}" data-val="confirmed24h">Confermato24h</button>
        <button class="crm-chip ${a.presentedStatus === 'presented' ? 'active' : ''}" data-set-presented="${a.id}" data-val="presented">Presentato</button>
        <button class="crm-chip danger-chip ${a.presentedStatus === 'no_show' ? 'active' : ''}" data-set-presented="${a.id}" data-val="no_show">No Show</button>
      </div>`;

  const closedChips = `
      <div class="crm-chip-group">
        <button class="crm-chip ${!a.closed ? 'active' : ''}" data-set-closed="${a.id}" data-val="0">No</button>
        <button class="crm-chip ${a.closed ? 'active' : ''}" data-set-closed="${a.id}" data-val="1">Sì</button>
      </div>`;

  const totalSold = apptTotalSold(a);
  const linkNote = a.linkedAppointmentId ? `<div class="crm-link-note">collegato</div>` : '';

  return `
    <tr data-appt-row="${a.id}">
      <td>
        <input type="text" class="crm-inline-input crm-name-input" data-name-input="${a.id}" value="${escapeHtml(a.clientName || '')}" placeholder="Nome e cognome">
        <input type="text" class="crm-inline-input crm-phone-input" data-phone-input="${a.id}" value="${escapeHtml(a.phone || '')}" placeholder="Telefono (facoltativo)">
        ${linkNote}
      </td>
      <td class="crm-cell-center"><input type="datetime-local" class="crm-inline-input crm-datetime-input" data-scheduled-input="${a.id}" value="${(a.scheduledAt || '').slice(0, 16)}"></td>
      <td>${presentedChips}</td>
      <td>${closedChips}</td>
      <td><input type="number" min="0" step="1" class="assigned-edit-input" data-cash-input="${a.id}" value="${a.cashCollected || 0}" style="width:90px;"></td>
      <td class="crm-cell-center"><button class="crm-amount-link" data-open-installments="${a.id}">€${round2(totalSold)}</button></td>
      <td class="crm-row-actions"><button class="crm-row-del" data-del-appt="${a.id}" title="Elimina">×</button></td>
    </tr>`;
}

function wireAppuntamentiEvents() {
  wireSubTabsBar('setting');
  appRoot.querySelectorAll('[data-crm-setter-filter]').forEach(btn => {
    btn.addEventListener('click', () => { uiState.crmSetterFilter = btn.dataset.crmSetterFilter; renderAppuntamenti(); });
  });
  document.getElementById('btnNewAppt').addEventListener('click', () => {
    addBlankAppointmentRow('setter');
  });
  document.getElementById('btnApptReport').addEventListener('click', generateAppointmentsReport);
  document.getElementById('btnApptCalendar').addEventListener('click', () => openAppointmentsCalendarModal('setter'));

  appRoot.querySelectorAll('[data-name-input]').forEach(input => {
    input.addEventListener('change', () => {
      const apt = db.appointments.find(x => x.id === input.dataset.nameInput);
      if (!apt) return;
      apt.clientName = input.value;
      persist();
    });
  });

  appRoot.querySelectorAll('[data-phone-input]').forEach(input => {
    input.addEventListener('change', () => {
      const apt = db.appointments.find(x => x.id === input.dataset.phoneInput);
      if (!apt) return;
      apt.phone = input.value || null;
      persist();
    });
  });

  appRoot.querySelectorAll('[data-scheduled-input]').forEach(input => {
    input.addEventListener('change', () => {
      const apt = db.appointments.find(x => x.id === input.dataset.scheduledInput);
      if (!apt || !input.value) return;
      apt.scheduledAt = input.value;
      persist();
      renderAppuntamenti();
    });
  });

  appRoot.querySelectorAll('[data-set-presented]').forEach(btn => {
    btn.addEventListener('click', () => {
      const apt = db.appointments.find(x => x.id === btn.dataset.setPresented);
      if (!apt) return;
      const val = btn.dataset.val;
      apt.presentedStatus = val;
      // CORREZIONE (segnalata dall'utente): presentedAt deve seguire la data/ora
      // dell'appuntamento stesso (scheduledAt), NON il momento in cui l'utente clicca
      // "Presentato" nell'app — spesso si registra un appuntamento già svolto giorni
      // prima (es. oggi 10, appuntamento del 6): le commissioni derivate (show-up,
      // cash collected) vanno segnate al 6, non al giorno del click.
      apt.presentedAt = val === 'presented' ? apt.scheduledAt : apt.presentedAt;
      persist();
      renderAppuntamenti();
    });
  });

  appRoot.querySelectorAll('[data-set-closed]').forEach(btn => {
    btn.addEventListener('click', () => {
      const apt = db.appointments.find(x => x.id === btn.dataset.setClosed);
      if (!apt) return;
      setAppointmentClosed(apt, btn.dataset.val === '1');
      renderAppuntamenti();
    });
  });

  appRoot.querySelectorAll('[data-cash-input]').forEach(input => {
    input.addEventListener('change', () => {
      const apt = db.appointments.find(x => x.id === input.dataset.cashInput);
      if (!apt) return;
      // L'acconto (cash collected) è ora la rata sintetica "_deposit" (vedi
      // getEffectiveInstallments) — il suo id evento è apt.id + '_deposit'.
      const prevCommission = apt.closed ? commissionEventsForAppointment(apt).filter(e => e.id === apt.id + '_deposit').reduce((s, e) => s + e.amount, 0) : 0;
      apt.cashCollected = Math.max(0, parseFloat(input.value) || 0);
      persist();
      if (apt.closed && db.settings.toggles.liveTicker) {
        const newCommission = commissionEventsForAppointment(apt).filter(e => e.id === apt.id + '_deposit').reduce((s, e) => s + e.amount, 0);
        if (newCommission > prevCommission) showCommissionTicker(newCommission - prevCommission);
      }
      renderAppuntamenti();
    });
  });

  appRoot.querySelectorAll('[data-open-installments]').forEach(btn => {
    btn.addEventListener('click', () => openInstallmentsModal(btn.dataset.openInstallments));
  });

  appRoot.querySelectorAll('[data-del-appt]').forEach(btn => {
    btn.addEventListener('click', () => {
      const apt = db.appointments.find(x => x.id === btn.dataset.delAppt);
      if (!apt) return;
      showConfirm(`Eliminare l'appuntamento di "${apt.clientName || '(senza nome)'}"?`, () => {
        db.appointments = db.appointments.filter(x => x.id !== apt.id);
        persist();
        renderAppuntamenti();
      }, { confirmLabel: 'Elimina' });
    });
  });
}

/**
 * "+ Nuovo Appuntamento": niente modal — crea subito una riga vuota (ruolo = quello del
 * filtro attivo, o Setter se il filtro è "Tutti"; data/ora = adesso) e la mette in cima
 * alla tabella, editabile inline esattamente come le righe esistenti (stesso pattern di
 * autosave su ogni campo). L'utente compila Nome/Ruolo/Data direttamente nella riga; il
 * focus va subito sul campo Nome.
 */
function addBlankAppointmentRow(role) {
  const apt = newAppointment(role || 'setter');
  db.appointments.unshift(apt);
  persist();
  if (role === 'venditore') renderVenditoreAppuntamenti(); else renderAppuntamenti();
  const nameInput = appRoot.querySelector(`[data-name-input="${apt.id}"]`);
  if (nameInput) nameInput.focus();
}

/**
 * Marca closed=true/false su un appuntamento, gestendo closedAt (vedi commento in
 * newAppointment) e i feedback opzionali del builder: suono di chiusura, confetti se
 * una barra obiettivo tocca 100% dopo l'aggiornamento, suono "level up" allo stesso
 * trigger del 100% (stessa logica descritta nel brief per il toggle 14).
 */
function setAppointmentClosed(apt, value) {
  const wasComplete = anyGoalComplete();
  apt.closed = value;
  if (value && !apt.closedAt) apt.closedAt = new Date().toISOString();
  if (!value) apt.closedAt = null;
  persist();

  if (value && db.settings.toggles.closeSound) playCloseSound();

  const nowComplete = anyGoalComplete();
  if (value && !wasComplete && nowComplete) {
    if (db.settings.toggles.confetti) fireConfetti();
    if (db.settings.toggles.levelUpSound) playLevelUpSound();
  }
}

/** true se almeno un obiettivo "chiusi" (mese, per uno qualsiasi dei due ruoli) è al 100% o oltre. */
function anyGoalComplete() {
  const ranges = currentPeriodRanges();
  const setterVals = computeFunnelValues(db, 'setter', ranges.month);
  const venditoreVals = computeFunnelValues(db, 'venditore', ranges.month);
  const targetSetter = db.goals.setter.month.chiusi || 0;
  const targetVenditore = db.goals.venditore.month.chiusi || 0;
  return (targetSetter > 0 && setterVals.chiusi >= targetSetter) || (targetVenditore > 0 && venditoreVals.chiusi >= targetVenditore);
}

/* ============================================================================
 * Appuntamenti — VENDITORE (split Setter/Venditore). Layout e modello di stato
 * completamente separati dalla tabella Setter qui sopra: qui il "Presentato"/"Chiuso"
 * booleani sono sostituiti da un unico stato trattativa a scelta singola (dealStage —
 * vedi DEAL_STAGES), e al posto di Accordi/Touchpoint ci sono Note (cronologia) e Data
 * Prossimo Follow-up.
 * ==========================================================================*/

function applyDealStage(apt, stageKey) {
  const wasComplete = anyGoalComplete();
  apt.dealStage = stageKey || null;
  const def = dealStageDef(stageKey);
  apt.closed = !!(def && def.isClosed);
  if (apt.closed && !apt.closedAt) apt.closedAt = new Date().toISOString();
  if (!apt.closed) apt.closedAt = null;
  persist();

  if (apt.closed && db.settings.toggles.closeSound) playCloseSound();
  const nowComplete = anyGoalComplete();
  if (apt.closed && !wasComplete && nowComplete) {
    if (db.settings.toggles.confetti) fireConfetti();
    if (db.settings.toggles.levelUpSound) playLevelUpSound();
  }
}

function renderVenditoreAppuntamenti() {
  uiState.venditoreTab = 'appuntamenti';
  const filter = uiState.crmVenditoreFilter || 'all'; // 'all' | 'trattativa' | 'no_show' | 'perso'
  let rows = db.appointments.filter(a => a.role === 'venditore');
  if (filter !== 'all') rows = rows.filter(a => a.dealStage === filter);
  rows = [...rows].sort((a, b) => new Date(b.scheduledAt) - new Date(a.scheduledAt));

  const rowsHtml = rows.length ? rows.map(renderVenditoreApptRow).join('') : '';

  appRoot.innerHTML = `
    ${renderSubTabsBar('venditore', 'appuntamenti')}
    <section class="card crm-toolbar">
      <div class="crm-filters">
        <button class="pill ${filter === 'all' ? 'active' : ''}" data-crm-vnd-filter="all">Tutti</button>
        <button class="pill ${filter === 'trattativa' ? 'active' : ''}" data-crm-vnd-filter="trattativa">Trattativa</button>
        <button class="pill ${filter === 'no_show' ? 'active' : ''}" data-crm-vnd-filter="no_show">No Show</button>
        <button class="pill ${filter === 'perso' ? 'active' : ''}" data-crm-vnd-filter="perso">Perso</button>
      </div>
      <div style="display:flex; gap:8px;">
        <button class="btn-ghost" id="btnApptCalendarVnd">📅 Calendario</button>
        <button class="btn-ghost" id="btnApptReportVnd">Report</button>
        <button class="btn-primary" id="btnNewApptVnd">+ Nuovo Appuntamento</button>
      </div>
    </section>
    <div class="two-col">
      <section class="card crm-table-wrap" style="grid-column: 1 / -1;">
        ${rows.length ? `
        <table class="crm-table">
          <thead>
            <tr>
              <th>Nome / Telefono</th><th>Data/Ora</th><th>Stato trattativa</th>
              <th>Cash Collected</th><th>Totale Venduto</th><th>Note / Follow-up</th><th></th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>` : '<p class="text-dim">Nessun appuntamento ancora. Crea il primo con "+ Nuovo Appuntamento".</p>'}
      </section>
    </div>
    ${renderCallRecordingsSection()}
  `;

  wireVenditoreAppuntamentiEvents();
}

function renderVenditoreApptRow(a) {
  const stageOptionsHtml = DEAL_STAGES.map(s =>
    `<option value="${s.key}" ${a.dealStage === s.key ? 'selected' : ''}>${escapeHtml(s.label)}</option>`
  ).join('');
  const currentStage = a.dealStage || '';

  const totalSold = apptTotalSold(a);
  const noteCount = (a.notes || []).length;
  const followUpLabel = a.nextFollowUpDate ? fmtDate(a.nextFollowUpDate) : 'Nessuna';

  return `
    <tr data-appt-row="${a.id}">
      <td>
        <input type="text" class="crm-inline-input crm-name-input" data-name-input="${a.id}" value="${escapeHtml(a.clientName || '')}" placeholder="Nome e cognome">
        <div class="crm-phone-row">
          <input type="text" class="crm-inline-input crm-phone-input" data-phone-input="${a.id}" value="${escapeHtml(a.phone || '')}" placeholder="Telefono (facoltativo)">
          <button class="crm-copy-phone-btn" data-copy-phone="${a.id}" title="Copia numero">⧉</button>
        </div>
      </td>
      <td class="crm-cell-center"><input type="datetime-local" class="crm-inline-input crm-datetime-input" data-scheduled-input="${a.id}" value="${(a.scheduledAt || '').slice(0, 16)}"></td>
      <td class="crm-cell-center">
        <select class="deal-stage-select" data-stage="${currentStage}" data-set-stage="${a.id}">
          <option value="" ${!currentStage ? 'selected' : ''}>— Da impostare —</option>
          ${stageOptionsHtml}
        </select>
      </td>
      <td><input type="number" min="0" step="1" class="assigned-edit-input" data-cash-input="${a.id}" value="${a.cashCollected || 0}" style="width:90px;"></td>
      <td class="crm-cell-center"><button class="crm-amount-link" data-open-installments="${a.id}">€${round2(totalSold)}</button></td>
      <td class="vnd-actions-cell">
        <button class="vnd-note-btn ${noteCount ? 'has-notes' : ''}" data-open-notes="${a.id}">Note ${noteCount ? `(${noteCount})` : ''}</button>
        <button class="vnd-followup-btn ${a.nextFollowUpDate ? 'has-date' : ''}" data-open-followup="${a.id}" title="Data prossimo follow-up">📅 ${followUpLabel}</button>
      </td>
      <td class="crm-row-actions"><button class="crm-row-del" data-del-appt-vnd="${a.id}" title="Elimina">×</button></td>
    </tr>`;
}

function wireVenditoreAppuntamentiEvents() {
  wireSubTabsBar('venditore');
  appRoot.querySelectorAll('[data-crm-vnd-filter]').forEach(btn => {
    btn.addEventListener('click', () => { uiState.crmVenditoreFilter = btn.dataset.crmVndFilter; renderVenditoreAppuntamenti(); });
  });
  document.getElementById('btnNewApptVnd').addEventListener('click', () => addBlankAppointmentRow('venditore'));
  document.getElementById('btnApptReportVnd').addEventListener('click', generateVenditoreAppointmentsReport);
  document.getElementById('btnApptCalendarVnd').addEventListener('click', () => openAppointmentsCalendarModal('venditore'));

  appRoot.querySelectorAll('[data-name-input]').forEach(input => {
    input.addEventListener('change', () => {
      const apt = db.appointments.find(x => x.id === input.dataset.nameInput);
      if (!apt) return;
      apt.clientName = input.value;
      persist();
    });
  });

  appRoot.querySelectorAll('[data-phone-input]').forEach(input => {
    input.addEventListener('change', () => {
      const apt = db.appointments.find(x => x.id === input.dataset.phoneInput);
      if (!apt) return;
      apt.phone = input.value || null;
      persist();
    });
  });

  appRoot.querySelectorAll('[data-copy-phone]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const apt = db.appointments.find(x => x.id === btn.dataset.copyPhone);
      if (!apt || !apt.phone) { showToast('Nessun numero da copiare.', true); return; }
      const ok = await copyToClipboard(apt.phone);
      showToast(ok ? 'Numero copiato.' : 'Seleziona e copia manualmente.', !ok);
    });
  });

  appRoot.querySelectorAll('[data-scheduled-input]').forEach(input => {
    input.addEventListener('change', () => {
      const apt = db.appointments.find(x => x.id === input.dataset.scheduledInput);
      if (!apt || !input.value) return;
      apt.scheduledAt = input.value;
      persist();
      renderVenditoreAppuntamenti();
    });
  });

  appRoot.querySelectorAll('[data-set-stage]').forEach(sel => {
    sel.addEventListener('change', () => {
      const apt = db.appointments.find(x => x.id === sel.dataset.setStage);
      if (!apt) return;
      applyDealStage(apt, sel.value || null);
      renderVenditoreAppuntamenti();
    });
  });

  appRoot.querySelectorAll('[data-cash-input]').forEach(input => {
    input.addEventListener('change', () => {
      const apt = db.appointments.find(x => x.id === input.dataset.cashInput);
      if (!apt) return;
      const prevCommission = apt.closed ? commissionEventsForAppointment(apt).filter(e => e.id === apt.id + '_deposit').reduce((s, e) => s + e.amount, 0) : 0;
      apt.cashCollected = Math.max(0, parseFloat(input.value) || 0);
      persist();
      if (apt.closed && db.settings.toggles.liveTicker) {
        const newCommission = commissionEventsForAppointment(apt).filter(e => e.id === apt.id + '_deposit').reduce((s, e) => s + e.amount, 0);
        if (newCommission > prevCommission) showCommissionTicker(newCommission - prevCommission);
      }
      renderVenditoreAppuntamenti();
    });
  });

  appRoot.querySelectorAll('[data-open-installments]').forEach(btn => {
    btn.addEventListener('click', () => openInstallmentsModal(btn.dataset.openInstallments, 'venditore'));
  });

  appRoot.querySelectorAll('[data-open-notes]').forEach(btn => {
    btn.addEventListener('click', () => openNotesModal(btn.dataset.openNotes));
  });

  appRoot.querySelectorAll('[data-open-followup]').forEach(btn => {
    btn.addEventListener('click', () => openFollowUpModal(btn.dataset.openFollowup));
  });

  appRoot.querySelectorAll('[data-del-appt-vnd]').forEach(btn => {
    btn.addEventListener('click', () => {
      const apt = db.appointments.find(x => x.id === btn.dataset.delApptVnd);
      if (!apt) return;
      showConfirm(`Eliminare l'appuntamento di "${apt.clientName || '(senza nome)'}"?`, () => {
        db.appointments = db.appointments.filter(x => x.id !== apt.id);
        persist();
        renderVenditoreAppuntamenti();
      }, { confirmLabel: 'Elimina' });
    });
  });

  wireCallRecordingsEvents();
}

/* ---------- Note appuntamento (solo Venditore) ---------- */

function openNotesModal(apptId) {
  const apt = db.appointments.find(x => x.id === apptId);
  if (!apt) return;
  renderNotesModal(apt);
}

function renderNotesModal(apt) {
  const notes = [...(apt.notes || [])].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const notesHtml = notes.length ? notes.map(n => `
    <div class="note-card">
      <div class="note-card-text">${escapeHtml(n.text)}</div>
      <div class="note-card-meta">${fmtDateTime(n.createdAt)}</div>
    </div>`).join('') : '<p class="text-dim">Nessuna nota ancora.</p>';

  openModal(`
    <h3>Note — ${escapeHtml(apt.clientName || '(senza nome)')}</h3>
    <div class="note-add-row">
      <textarea id="newNoteText" placeholder="Scrivi una nota su questo lead…"></textarea>
      <button class="btn-primary" id="btnAddNote" style="align-self:flex-end;">+ Aggiungi nota</button>
    </div>
    <div class="notes-list">${notesHtml}</div>
    <div class="modal-actions">
      <button class="btn-ghost" data-close-modal="1">Chiudi</button>
    </div>
  `);
  modalRoot.querySelectorAll('[data-close-modal]').forEach(b => b.addEventListener('click', () => { closeModal(); renderVenditoreAppuntamenti(); }));

  document.getElementById('btnAddNote').addEventListener('click', () => {
    const ta = document.getElementById('newNoteText');
    const text = ta.value.trim();
    if (!text) { ta.focus(); return; }
    apt.notes = apt.notes || [];
    apt.notes.push({ id: uid('nota'), text, createdAt: new Date().toISOString() });
    persist();
    renderNotesModal(apt);
  });
}

/* ---------- Data prossimo follow-up (solo Venditore) ---------- */

function openFollowUpModal(apptId) {
  const apt = db.appointments.find(x => x.id === apptId);
  if (!apt) return;
  openModal(`
    <h3>Prossimo follow-up — ${escapeHtml(apt.clientName || '(senza nome)')}</h3>
    <label class="field">
      Data da ricontattare
      <input type="date" id="followUpDateInput" value="${apt.nextFollowUpDate || ''}">
    </label>
    <div class="modal-actions" style="justify-content:space-between;">
      <button class="btn-ghost" id="btnClearFollowUp">Rimuovi data</button>
      <div style="display:flex; gap:8px;">
        <button class="btn-ghost" data-close-modal="1">Annulla</button>
        <button class="btn-primary" id="btnSaveFollowUp">Salva</button>
      </div>
    </div>
  `);
  modalRoot.querySelectorAll('[data-close-modal]').forEach(b => b.addEventListener('click', closeModal));
  document.getElementById('btnClearFollowUp').addEventListener('click', () => {
    apt.nextFollowUpDate = null;
    persist();
    closeModal();
    renderVenditoreAppuntamenti();
  });
  document.getElementById('btnSaveFollowUp').addEventListener('click', () => {
    const val = document.getElementById('followUpDateInput').value;
    apt.nextFollowUpDate = val || null;
    persist();
    closeModal();
    renderVenditoreAppuntamenti();
  });
}

/* ---------- Registrazione Call (link Drive/Fathom/ecc., solo Venditore) ---------- */

/**
 * Widget "Registrazione Call": ancorato in fondo a destra (fixed, sopra il resto del
 * contenuto) invece che come card a piena larghezza, come richiesto esplicitamente
 * dall'utente ("in fondo a destra"). Si apre/chiude con un toggle per non ingombrare
 * la vista sulla tabella appuntamenti; lo stato aperto/chiuso è tenuto in uiState
 * (non persistito: si riapre chiuso ad ogni refresh, comportamento voluto per un widget
 * di utilità secondaria).
 */
function renderCallRecordingsSection() {
  const recs = [...(db.callRecordings || [])].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const rowsHtml = recs.length ? recs.map(r => `
    <div class="call-rec-row">
      <a href="${escapeHtml(r.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(r.label || r.url)}</a>
      <button class="crm-row-del" data-del-rec="${r.id}" title="Elimina">×</button>
    </div>`).join('') : '<p class="text-dim">Nessuna registrazione ancora.</p>';

  const open = !!uiState.callRecOpen;

  return `
    <div class="call-rec-widget ${open ? 'is-open' : ''}">
      <button class="call-rec-toggle" id="btnToggleRec">
        <span>🎙️ Registrazione Call</span>
        <span class="call-rec-count">${recs.length}</span>
      </button>
      <div class="call-rec-panel" ${open ? '' : 'hidden'}>
        <p class="text-dim" style="font-size:0.78rem;">Incolla qui i link alle registrazioni delle call (Drive, Fathom, ecc.).</p>
        <div class="call-rec-list">${rowsHtml}</div>
        <div class="call-rec-add-row">
          <input type="text" id="newRecLabel" placeholder="Etichetta (es. nome cliente)">
          <input type="text" id="newRecUrl" placeholder="https://…">
          <button class="btn-ghost" id="btnAddRec">+ Aggiungi link</button>
        </div>
      </div>
    </div>`;
}

function wireCallRecordingsEvents() {
  const btnToggle = document.getElementById('btnToggleRec');
  if (btnToggle) {
    btnToggle.addEventListener('click', () => {
      uiState.callRecOpen = !uiState.callRecOpen;
      renderVenditoreAppuntamenti();
    });
  }
  const btnAdd = document.getElementById('btnAddRec');
  if (btnAdd) {
    btnAdd.addEventListener('click', () => {
      const labelInput = document.getElementById('newRecLabel');
      const urlInput = document.getElementById('newRecUrl');
      const url = urlInput.value.trim();
      if (!url) { urlInput.focus(); return; }
      db.callRecordings = db.callRecordings || [];
      db.callRecordings.push({ id: uid('rec'), label: labelInput.value.trim(), url, createdAt: new Date().toISOString() });
      persist();
      uiState.callRecOpen = true;
      renderVenditoreAppuntamenti();
    });
  }
  appRoot.querySelectorAll('[data-del-rec]').forEach(btn => {
    btn.addEventListener('click', () => {
      db.callRecordings = (db.callRecordings || []).filter(r => r.id !== btn.dataset.delRec);
      persist();
      uiState.callRecOpen = true;
      renderVenditoreAppuntamenti();
    });
  });
}

/* ---------- Popup rate (installments) ---------- */

function openInstallmentsModal(apptId, role) {
  const apt = db.appointments.find(x => x.id === apptId);
  if (!apt) return;
  renderInstallmentsModal(apt, role);
}

function renderInstallmentsModal(apt, role) {
  const returnToRoleScreen = () => { if (role === 'venditore') renderVenditoreAppuntamenti(); else renderAppuntamenti(); };
  // Rata sintetica "Acconto" (dal cash collected, vedi getEffectiveInstallments):
  // mostrata per prima, bloccata (non cancellabile, importo non editabile qui — si
  // modifica dal campo Cash Collected nella riga della tabella) così l'utente vede
  // subito quanto è già stato incassato e aggiunge solo l'importo MANCANTE come rate.
  const depositRowHtml = (apt.cashCollected && apt.cashCollected > 0) ? `
    <div class="installment-row installment-row-deposit">
      <span class="installment-deposit-label">Acconto (cash collected)</span>
      <span class="installment-deposit-amount">€${round2(apt.cashCollected)}</span>
      <span class="text-dim" style="font-size:0.72rem;">già incassato</span>
      <span class="badge badge-yes">pagata</span>
      <span></span>
      <span class="text-dim" style="font-size:0.72rem;" title="Modifica dal campo Cash Collected nella tabella">🔒</span>
    </div>` : '';

  const rowsHtml = (apt.installments || []).map(inst => `
    <div class="installment-row" data-inst-row="${inst.id}">
      <input type="text" data-inst-field="label" value="${escapeHtml(inst.label || '')}" placeholder="Es. Rata 2">
      <input type="number" min="0" data-inst-field="amount" value="${inst.amount || 0}" placeholder="Importo €">
      <input type="date" data-inst-field="dueDate" value="${inst.dueDate ? dateInputValue(inst.dueDate) : ''}">
      <label class="checkbox-inline"><input type="checkbox" data-inst-field="paid" ${inst.paid ? 'checked' : ''}> pagata</label>
      <input type="date" data-inst-field="paidDate" value="${inst.paidDate ? dateInputValue(inst.paidDate) : ''}" ${inst.paid ? '' : 'disabled'}>
      <button class="crm-row-del" data-del-inst="${inst.id}" title="Elimina rata">×</button>
    </div>`).join('');

  const total = apptTotalSold(apt);

  openModal(`
    <h3>Rate — ${escapeHtml(apt.clientName || '(senza nome)')}</h3>
    <p class="text-dim" style="font-size:0.8rem;">Il cash collected è già conteggiato come acconto (prima riga, bloccata). Aggiungi qui solo l'importo MANCANTE rispetto al totale venduto reale.</p>
    <div class="installments-list" id="instList">${depositRowHtml}${rowsHtml || (depositRowHtml ? '' : '<p class="text-dim">Nessuna rata aggiunta ancora.</p>')}</div>
    <button class="btn-ghost" id="btnAddInstallment">+ Aggiungi rata</button>
    <div class="installment-total-row"><span>Totale (acconto + rate)</span><span>€${round2(total)}</span></div>
    <div class="modal-actions">
      <button class="btn-primary" data-close-modal="1">Chiudi</button>
    </div>
  `);
  modalRoot.querySelectorAll('[data-close-modal]').forEach(b => b.addEventListener('click', () => { closeModal(); returnToRoleScreen(); }));

  document.getElementById('btnAddInstallment').addEventListener('click', () => {
    apt.installments = apt.installments || [];
    apt.installments.push({
      id: uid('rata'),
      label: `Rata ${apt.installments.length + 1}`,
      amount: 0,
      dueDate: new Date().toISOString().slice(0, 10),
      paid: false,
      paidDate: null
    });
    persist();
    renderInstallmentsModal(apt);
  });

  modalRoot.querySelectorAll('[data-del-inst]').forEach(btn => {
    btn.addEventListener('click', () => {
      apt.installments = apt.installments.filter(i => i.id !== btn.dataset.delInst);
      persist();
      renderInstallmentsModal(apt);
    });
  });

  modalRoot.querySelectorAll('[data-inst-row]').forEach(row => {
    const instId = row.dataset.instRow;
    const inst = apt.installments.find(i => i.id === instId);
    row.querySelectorAll('[data-inst-field]').forEach(fieldEl => {
      const field = fieldEl.dataset.instField;
      const evt = (fieldEl.type === 'checkbox') ? 'change' : 'change';
      fieldEl.addEventListener(evt, () => {
        const prevCommission = inst.paid ? commissionEventsForAppointment(apt).find(e => e.id === apt.id + '_' + inst.id) : null;
        const prevAmount = prevCommission ? prevCommission.amount : 0;

        if (field === 'label') inst.label = fieldEl.value;
        else if (field === 'amount') inst.amount = Math.max(0, parseFloat(fieldEl.value) || 0);
        else if (field === 'dueDate') inst.dueDate = fieldEl.value;
        else if (field === 'paid') {
          inst.paid = fieldEl.checked;
          if (inst.paid && !inst.paidDate) inst.paidDate = new Date().toISOString().slice(0, 10);
        } else if (field === 'paidDate') inst.paidDate = fieldEl.value;

        persist();

        if (inst.paid && db.settings.toggles.liveTicker) {
          const newCommission = commissionEventsForAppointment(apt).find(e => e.id === apt.id + '_' + inst.id);
          const newAmount = newCommission ? newCommission.amount : 0;
          if (newAmount > prevAmount) showCommissionTicker(newAmount - prevAmount);
        }

        renderInstallmentsModal(apt);
      });
    });
  });
}

/* ============================================================================
 * Statistiche Venditore — conversion rate, show rate, scontrino medio, su diversi
 * timeframe e all time (richiesto esplicitamente dall'utente, sullo stile delle
 * statistiche già mostrate per le sessioni Setter).
 * ==========================================================================*/

const VND_STATS_TIMEFRAMES = ['oggi', '7g', 'mese_corrente', 'all', 'custom'];
const VND_STATS_TIMEFRAME_LABELS = { oggi: 'Oggi', '7g': '7 giorni', mese_corrente: 'Mese corrente', all: 'All time', custom: 'Personalizzato' };

function renderVenditoreStatistiche() {
  uiState.venditoreTab = 'statistiche';
  const tf = uiState.vndStatsTimeframe || 'mese_corrente';
  const range = tf === 'all' ? null : (tf === 'custom' ? getTimeframeRange('custom', uiState.vndStatsCustomFrom, uiState.vndStatsCustomTo) : getTimeframeRange(tf));
  const stats = computeVenditoreStats(db, range);

  const tabsHtml = VND_STATS_TIMEFRAMES.map(k =>
    `<button class="pill ${tf === k ? 'active' : ''}" data-vnd-stats-tf="${k}">${VND_STATS_TIMEFRAME_LABELS[k]}</button>`
  ).join('');

  appRoot.innerHTML = `
    ${renderSubTabsBar('venditore', 'statistiche')}
    <section class="card">
      <div class="vnd-timeframe-tabs">${tabsHtml}</div>
      ${tf === 'custom' ? `
      <div class="custom-range" style="margin-top:8px;">
        <label>dal <input type="date" id="vndStatsFrom" value="${uiState.vndStatsCustomFrom ? uiState.vndStatsCustomFrom : dateInputValue(range.start)}"></label>
        <label>al <input type="date" id="vndStatsTo" value="${uiState.vndStatsCustomTo ? uiState.vndStatsCustomTo : dateInputValue(range.end)}"></label>
        <button class="btn-ghost" id="btnVndStatsApplyRange">Applica</button>
      </div>` : ''}
      <p class="text-dim" style="font-size:0.82rem;">${tf === 'all' ? 'Tutto lo storico registrato.' : (tf === 'custom' ? `Periodo: dal ${fmtDate(range.start)} al ${fmtDate(range.end)}.` : `Periodo: ${TIMEFRAME_LABELS[tf] || tf}.`)}</p>
    </section>

    <section class="vnd-stats-grid">
      <div class="card kpi-card"><div class="kpi-value">${stats.assegnati}</div><div class="kpi-label">Assegnati</div></div>
      <div class="card kpi-card"><div class="kpi-value">${stats.presentati}</div><div class="kpi-label">Presentati</div></div>
      <div class="card kpi-card"><div class="kpi-value">${stats.chiusi}</div><div class="kpi-label">Chiusi</div></div>
      <div class="card kpi-card accented"><div class="kpi-value">€${round2(stats.commissioniTot)}</div><div class="kpi-label">Commissioni</div></div>
    </section>

    <section class="vnd-stats-grid">
      <div class="card kpi-card"><div class="kpi-value">${stats.showRate}%</div><div class="kpi-label">Show Rate</div></div>
      <div class="card kpi-card"><div class="kpi-value">${stats.conversionRate}%</div><div class="kpi-label">Conversion Rate</div></div>
      <div class="card kpi-card"><div class="kpi-value">€${round2(stats.scontrinoMedio)}</div><div class="kpi-label">Scontrino Medio</div></div>
      <div class="card kpi-card"><div class="kpi-value">€${round2(stats.totalVenduto)}</div><div class="kpi-label">Totale Venduto</div></div>
    </section>

    <section class="card">
      <h3>Esiti nel periodo</h3>
      <div class="bar-list">
        <div class="bar-row"><div class="bar-label">Presentati</div><div class="bar-track"><div class="bar-fill" style="width:${pct(stats.presentati, stats.assegnati || 1)}%"></div></div><div class="bar-value">${stats.presentati}</div></div>
        <div class="bar-row"><div class="bar-label">Chiusi</div><div class="bar-track"><div class="bar-fill" style="width:${pct(stats.chiusi, stats.assegnati || 1)}%"></div></div><div class="bar-value">${stats.chiusi}</div></div>
        <div class="bar-row"><div class="bar-label">Persi</div><div class="bar-track"><div class="bar-fill" style="width:${pct(stats.persi, stats.assegnati || 1)}%"></div></div><div class="bar-value">${stats.persi}</div></div>
        <div class="bar-row"><div class="bar-label">No Show</div><div class="bar-track"><div class="bar-fill" style="width:${pct(stats.noShow, stats.assegnati || 1)}%"></div></div><div class="bar-value">${stats.noShow}</div></div>
        <div class="bar-row"><div class="bar-label">Annullati</div><div class="bar-track"><div class="bar-fill" style="width:${pct(stats.annullati, stats.assegnati || 1)}%"></div></div><div class="bar-value">${stats.annullati}</div></div>
      </div>
    </section>
  `;

  wireSubTabsBar('venditore');
  appRoot.querySelectorAll('[data-vnd-stats-tf]').forEach(btn => {
    btn.addEventListener('click', () => { uiState.vndStatsTimeframe = btn.dataset.vndStatsTf; renderVenditoreStatistiche(); });
  });
  const btnApplyRange = document.getElementById('btnVndStatsApplyRange');
  if (btnApplyRange) {
    btnApplyRange.addEventListener('click', () => {
      const from = document.getElementById('vndStatsFrom').value;
      const to = document.getElementById('vndStatsTo').value;
      if (!from || !to) return;
      uiState.vndStatsCustomFrom = from;
      uiState.vndStatsCustomTo = to;
      renderVenditoreStatistiche();
    });
  }
}

/* ============================================================================
 * Commissioni — calendario mensile
 * ==========================================================================*/

/**
 * Calendario Commissioni — SPOSTATO in fondo alla Dashboard su richiesta esplicita
 * dell'utente (prima era una pagina a sé, route 'commissioni'). Stessa identica logica
 * di prima (riepilogo mese + griglia calendario), solo restituita come HTML da inserire
 * in coda a renderDashboard invece di occupare da sola tutto appRoot.
 */
function renderCommissioniCalendarSection() {
  const now = new Date();
  const viewDate = new Date(now.getFullYear(), now.getMonth() + uiState.calMonthOffset, 1);
  const monthRange = { start: startOfMonth(viewDate), end: endOfMonth(viewDate) };
  const summary = computeCommissionSummary(db, monthRange);
  const byDay = groupEventsByDay(summary.events);

  const firstOfMonth = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
  const firstWeekday = (firstOfMonth.getDay() + 6) % 7; // 0=lunedì
  const daysInMonth = endOfMonth(viewDate).getDate();
  const todayKey = dateInputValue(now);

  const dowLabels = ['LUN', 'MAR', 'MER', 'GIO', 'VEN', 'SAB', 'DOM'];
  let cells = '';
  for (let i = 0; i < firstWeekday; i++) cells += `<div class="cal-cell empty"></div>`;
  for (let day = 1; day <= daysInMonth; day++) {
    const cellDate = new Date(viewDate.getFullYear(), viewDate.getMonth(), day);
    const key = dateInputValue(cellDate);
    const events = byDay[key] || [];
    const dayTotal = sumEvents(events);
    const hasEvents = events.length > 0;
    const detail = summarizeDayEvents(events);
    const classes = ['cal-cell'];
    if (hasEvents) classes.push('has-events');
    if (key === todayKey) classes.push('today');
    if (isCashDay(dayTotal)) classes.push('cash-day');
    cells += `
      <div class="${classes.join(' ')}" ${hasEvents ? `data-cal-day="${key}"` : ''}>
        <div class="cal-daynum">${day}</div>
        ${hasEvents ? `<div class="cal-day-total">€${round2(dayTotal)}</div><div class="cal-day-detail">${escapeHtml(detail)}</div>` : ''}
      </div>`;
  }

  return `
    <div class="section-separator"><span class="eyebrow">Calendario Commissioni</span></div>
    <section class="card">
      <h2>Commissioni — riepilogo mese</h2>
      <div class="comm-summary-grid kpi-grid">
        <div class="kpi-card"><div class="kpi-value">€${round2(summary.total)}</div><div class="kpi-label">Totale mese</div></div>
        <div class="kpi-card"><div class="kpi-value">€${round2(summary.showup)}</div><div class="kpi-label">Show Up (setter)</div></div>
        <div class="kpi-card"><div class="kpi-value">€${round2(summary.setting)}</div><div class="kpi-label">Chiusure Setting</div></div>
        <div class="kpi-card"><div class="kpi-value">€${round2(summary.vendita)}</div><div class="kpi-label">Chiusure Vendita</div></div>
      </div>
    </section>
    <section class="card">
      <div class="cal-nav">
        <button id="calPrev">← Mese prec.</button>
        <div class="cal-month-label">${viewDate.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })}</div>
        <button id="calNext">Mese succ. →</button>
      </div>
      <div class="cal-grid">
        ${dowLabels.map(d => `<div class="cal-dow">${d}</div>`).join('')}
        ${cells}
      </div>
    </section>
  `;
}

function wireCommissioniCalendarSection() {
  const now = new Date();
  const viewDate = new Date(now.getFullYear(), now.getMonth() + uiState.calMonthOffset, 1);
  const monthRange = { start: startOfMonth(viewDate), end: endOfMonth(viewDate) };
  const summary = computeCommissionSummary(db, monthRange);
  const byDay = groupEventsByDay(summary.events);

  document.getElementById('calPrev').addEventListener('click', () => { uiState.calMonthOffset -= 1; renderDashboard(); });
  document.getElementById('calNext').addEventListener('click', () => { uiState.calMonthOffset += 1; renderDashboard(); });
  appRoot.querySelectorAll('[data-cal-day]').forEach(cell => {
    cell.addEventListener('click', () => openCommissionDayModal(cell.dataset.calDay, byDay[cell.dataset.calDay] || []));
  });
}

/* ============================================================================
 * Calendario Appuntamenti (Setter e Venditore) — modal con vista mensile, aperta dal
 * bottone "📅 Calendario" nelle rispettive schermate Appuntamenti. Ogni giorno mostra gli
 * appuntamenti con quella scheduledAt come mini-pillole colorate: per il Setter in base a
 * presentedStatus (stessa idea del semaforo No/Confermato24h/Presentato/No Show già usato
 * nei chip della tabella), per il Venditore riusando esattamente i colori DEAL_STAGES già
 * definiti per il menu a tendina "stato trattativa" (var CSS --stage-*), così il colore è
 * coerente in tutto il tool invece di inventarne uno nuovo solo per il calendario.
 */
const SETTER_PRESENTED_COLOR_CLASS = {
  no: 'cal-appt-neutral',
  confirmed24h: 'cal-appt-confirmed',
  presented: 'cal-appt-presented',
  no_show: 'cal-appt-noshow'
};
const SETTER_PRESENTED_LABEL = { no: 'No', confirmed24h: 'Confermato24h', presented: 'Presentato', no_show: 'No Show' };

let calModalRole = 'setter';
let calModalMonthOffset = 0;

function openAppointmentsCalendarModal(role) {
  calModalRole = role;
  calModalMonthOffset = 0;
  openModal(renderAppointmentsCalendarModalBody());
  wireAppointmentsCalendarModal();
}

function renderAppointmentsCalendarModalBody() {
  const now = new Date();
  const viewDate = new Date(now.getFullYear(), now.getMonth() + calModalMonthOffset, 1);
  const monthRange = { start: startOfMonth(viewDate), end: endOfMonth(viewDate) };

  const rows = db.appointments.filter(a => a.role === calModalRole && a.scheduledAt && inRange(a.scheduledAt, monthRange));
  const byDay = {};
  rows.forEach(a => {
    const key = dateInputValue(a.scheduledAt);
    if (!byDay[key]) byDay[key] = [];
    byDay[key].push(a);
  });

  const firstOfMonth = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
  const firstWeekday = (firstOfMonth.getDay() + 6) % 7;
  const daysInMonth = endOfMonth(viewDate).getDate();
  const todayKey = dateInputValue(now);
  const dowLabels = ['LUN', 'MAR', 'MER', 'GIO', 'VEN', 'SAB', 'DOM'];

  let cells = '';
  for (let i = 0; i < firstWeekday; i++) cells += `<div class="cal-cell empty"></div>`;
  for (let day = 1; day <= daysInMonth; day++) {
    const cellDate = new Date(viewDate.getFullYear(), viewDate.getMonth(), day);
    const key = dateInputValue(cellDate);
    const dayAppts = byDay[key] || [];
    const classes = ['cal-cell'];
    if (dayAppts.length) classes.push('has-events');
    if (key === todayKey) classes.push('today');

    const pillsHtml = dayAppts.slice(0, 4).map(a => {
      if (calModalRole === 'venditore') {
        const stage = a.dealStage || '';
        const label = stage && dealStageDef(stage) ? dealStageDef(stage).label : '—';
        return `<div class="cal-appt-pill deal-stage-select" data-stage="${stage}" title="${escapeHtml(a.clientName || '')}">${escapeHtml(a.clientName || '(senza nome)')}</div>`;
      }
      const cls = SETTER_PRESENTED_COLOR_CLASS[a.presentedStatus] || 'cal-appt-neutral';
      return `<div class="cal-appt-pill ${cls}" title="${escapeHtml(a.clientName || '')}">${escapeHtml(a.clientName || '(senza nome)')}</div>`;
    }).join('');
    const moreHtml = dayAppts.length > 4 ? `<div class="cal-appt-more">+${dayAppts.length - 4}</div>` : '';

    cells += `
      <div class="${classes.join(' ')}">
        <div class="cal-daynum">${day}</div>
        <div class="cal-appt-pills">${pillsHtml}${moreHtml}</div>
      </div>`;
  }

  const legendHtml = calModalRole === 'venditore'
    ? DEAL_STAGES.map(s => `<span class="cal-legend-item deal-stage-select" data-stage="${s.key}">${escapeHtml(s.label)}</span>`).join('')
    : Object.entries(SETTER_PRESENTED_LABEL).map(([key, label]) => `<span class="cal-legend-item ${SETTER_PRESENTED_COLOR_CLASS[key]}">${escapeHtml(label)}</span>`).join('');

  return `
    <h3>Calendario Appuntamenti — ${calModalRole === 'venditore' ? 'Venditore' : 'Setter'}</h3>
    <div class="cal-nav">
      <button id="calModalPrev">← Mese prec.</button>
      <div class="cal-month-label">${viewDate.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })}</div>
      <button id="calModalNext">Mese succ. →</button>
    </div>
    <div class="cal-grid">
      ${dowLabels.map(d => `<div class="cal-dow">${d}</div>`).join('')}
      ${cells}
    </div>
    <div class="cal-legend">${legendHtml}</div>
    <div class="modal-actions">
      <button class="btn-primary" data-close-modal="1">Chiudi</button>
    </div>
  `;
}

function wireAppointmentsCalendarModal() {
  document.getElementById('calModalPrev').addEventListener('click', () => {
    calModalMonthOffset -= 1;
    modalRoot.querySelector('.modal-box').innerHTML = renderAppointmentsCalendarModalBody();
    wireAppointmentsCalendarModal();
  });
  document.getElementById('calModalNext').addEventListener('click', () => {
    calModalMonthOffset += 1;
    modalRoot.querySelector('.modal-box').innerHTML = renderAppointmentsCalendarModalBody();
    wireAppointmentsCalendarModal();
  });
  modalRoot.querySelectorAll('[data-close-modal]').forEach(b => b.addEventListener('click', closeModal));
}

const COMMISSION_SOURCE_LABELS = { showup: 'presentati', setting: 'chiusura setting', vendita: 'chiusura closer' };

function summarizeDayEvents(events) {
  const bySource = {};
  events.forEach(e => { bySource[e.source] = (bySource[e.source] || 0) + e.amount; });
  return Object.entries(bySource).map(([src, amt]) => `${round2(amt)}€ ${COMMISSION_SOURCE_LABELS[src] || src}`).join(' · ');
}

function openCommissionDayModal(dayKey, events) {
  const rows = events.map(ev => `
    <div class="cal-detail-row">
      <div>
        <div>${escapeHtml(ev.clientName || '(senza nome)')}</div>
        <div class="cal-detail-source">${COMMISSION_SOURCE_LABELS[ev.source] || ev.source} · ${ev.role === 'setter' ? 'Setter' : 'Venditore'}</div>
      </div>
      <div class="cal-detail-amount">€${round2(ev.amount)}</div>
    </div>`).join('');

  openModal(`
    <h3>Commissioni del ${fmtDate(dayKey)}</h3>
    <div class="cal-detail-list">${rows || '<p class="text-dim">Nessun evento.</p>'}</div>
    <div class="modal-actions">
      <button class="btn-primary" data-close-modal="1">Chiudi</button>
    </div>
  `);
  modalRoot.querySelectorAll('[data-close-modal]').forEach(b => b.addEventListener('click', closeModal));
}

/* ---------- Sessione attiva (schermata isolata) ---------- */

function renderSessioneAttiva() {
  document.body.classList.add('in-session');
  const s = db.activeSession;
  if (!s) { document.body.classList.remove('in-session'); location.hash = '#/dashboard'; renderRoute(); return; }

  const pipeline = db.pipelines.find(p => p.id === s.pipelineId);
  const outcomes = pipeline ? pipeline.outcomes : [];

  const counts = {};
  s.calls.forEach(c => { counts[c.outcomeLabel] = (counts[c.outcomeLabel] || 0) + 1; });
  const totalCalls = s.calls.length;
  const totalLeads = s.calls.filter(c => !c.isSecondAttempt).length;

  const breakdownHtml = Object.keys(counts).length
    ? Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([label, count]) =>
        `<div class="breakdown-chip"><span class="bc-count">${count}</span><span class="bc-label">${escapeHtml(label)}</span></div>`).join('')
    : '<span class="text-dim">Ancora nessuna chiamata registrata</span>';

  const buttonsHtml = outcomes.map(o => `
    <button class="outcome-btn" data-outcome-id="${o.id}">
      ${escapeHtml(o.label)}
      ${o.isNoAnswer && MAX_CALL_ATTEMPTS > 1 ? `<span class="outcome-btn-sub">attiva richiamo (max ${MAX_CALL_ATTEMPTS} tentativi)</span>` : ''}
    </button>
  `).join('');

  const attemptNum = (s.callAttemptsOnLead || 0) + 1;
  const secondCallBannerHtml = s.retryCallsPending ? `
    <div class="second-call-banner">
      <span class="blink-dot"></span>Richiamo ${attemptNum}ª chiamata — stesso lead
      <span class="scb-hint">Segna l'esito di questo tentativo, oppure premi Skip per annullare e passare al prossimo lead.</span>
    </div>
  ` : '';

  appRoot.innerHTML = `
    <div class="session-screen">
      <div class="session-topbar">
        <button id="btnEndSession" class="btn-danger-ghost">■ Fine sessione</button>
        <div class="session-pipeline-name">${escapeHtml(s.pipelineName)}</div>
        <button id="btnSkip" class="btn-skip">Skip →</button>
      </div>

      <div class="session-stats">
        <div class="stat-block">
          <div class="stat-value" id="sessionTimer">00:00</div>
          <div class="stat-label">Durata sessione</div>
        </div>
        <div class="stat-block">
          <div class="stat-value">${totalCalls}</div>
          <div class="stat-label">Chiamate fatte</div>
        </div>
        <div class="stat-block">
          <div class="stat-value">${totalLeads}</div>
          <div class="stat-label">Lead contattati</div>
        </div>
        ${s.skips ? `<div class="stat-block"><div class="stat-value">${s.skips}</div><div class="stat-label">Saltati</div></div>` : ''}
      </div>

      ${secondCallBannerHtml}

      <div class="session-breakdown">${breakdownHtml}</div>

      <div class="outcome-grid">${buttonsHtml}</div>
    </div>
  `;

  appRoot.querySelectorAll('[data-outcome-id]').forEach(btn => {
    btn.addEventListener('click', () => logCallAction(btn.dataset.outcomeId));
  });
  document.getElementById('btnSkip').addEventListener('click', skipLeadAction);
  document.getElementById('btnEndSession').addEventListener('click', endSessionAction);

  clearInterval(sessionTimerInterval);
  updateSessionTimer();
  sessionTimerInterval = setInterval(updateSessionTimer, 1000);
}

function updateSessionTimer() {
  const s = db.activeSession;
  if (!s) { clearInterval(sessionTimerInterval); return; }
  const el = document.getElementById('sessionTimer');
  if (!el) { clearInterval(sessionTimerInterval); return; }
  el.textContent = fmtDuration(Date.now() - new Date(s.startedAt).getTime());
}

// Label esatta (case-sensitive) dell'esito di default che aggancia il popup CRM — vedi
// defaultOutcomesList() in storage.js. Solo questo esito specifico apre il popup: un
// "conferma appuntamento" (altro isConversion:true) o un esito custom non lo attivano mai.
const APPOINTMENT_SET_OUTCOME_LABEL = 'Appuntamento Fissato';

// Numero massimo di tentativi TOTALI sullo stesso lead quando l'esito è "nessuna risposta"
// (es. squilli a vuoto). 1 = nessun richiamo (si passa subito al lead successivo dopo il
// primo "non risponde"), 2 = un richiamo (2 chiamate totali, comportamento storico), 3 = due
// richiami (3 chiamate totali — regola indicata il 14/09/2026). Se le indicazioni cambiano
// di nuovo, basta aggiornare questo numero: tutto il resto del flusso si adatta da solo.
const MAX_CALL_ATTEMPTS = 3;

function logCallAction(outcomeId) {
  const s = db.activeSession;
  const pipeline = db.pipelines.find(p => p.id === s.pipelineId);
  const outcome = pipeline.outcomes.find(o => o.id === outcomeId);
  if (!outcome) return;

  // Se eravamo in attesa di un richiamo, questo click è un ulteriore tentativo sullo
  // STESSO lead (non un lead nuovo), qualunque sia l'esito di questa chiamata.
  const isRetryAttempt = (s.retryCallsPending || 0) > 0;

  s.calls.push({
    id: uid('call'),
    timestamp: new Date().toISOString(),
    outcomeId: outcome.id,
    outcomeLabel: outcome.label,
    isConversion: !!outcome.isConversion,
    isNoAnswer: !!outcome.isNoAnswer,
    isSecondAttempt: isRetryAttempt
  });

  // Quanti tentativi abbiamo già fatto su questo lead in questo giro (1 = solo la chiamata
  // appena fatta, oppure quelli precedenti +1 se eravamo già in un richiamo).
  const attemptsSoFar = isRetryAttempt ? (s.callAttemptsOnLead || 1) + 1 : 1;
  s.callAttemptsOnLead = attemptsSoFar;

  // Un esito "nessuna risposta" apre la finestra per un ulteriore richiamo sullo stesso
  // lead, finché non si raggiunge MAX_CALL_ATTEMPTS tentativi totali su quel lead.
  const canRetry = !!outcome.isNoAnswer && attemptsSoFar < MAX_CALL_ATTEMPTS;
  s.retryCallsPending = canRetry;
  if (!canRetry) s.callAttemptsOnLead = 0;

  // La chiamata è già registrata a prescindere da quel che succede dopo (persist() qui sotto):
  // il popup "Appuntamento Fissato" (se scatta) è un'aggiunta al CRM, non deve mai poter
  // bloccare o alterare il conteggio normale della sessione.
  persist();
  renderSessioneAttiva();

  if (outcome.label === APPOINTMENT_SET_OUTCOME_LABEL) {
    openAppointmentSetModal();
  }
}

/**
 * Popup aperto SOLO quando l'esito cliccato in sessione è esattamente "Appuntamento
 * Fissato" (vedi APPOINTMENT_SET_OUTCOME_LABEL). Chiede solo nome e data/ora
 * dell'appuntamento appena fissato ("da lì poi compilo il resto" — l'utente completa
 * gli altri campi dopo, nella schermata Appuntamenti). Alla conferma crea una riga
 * db.appointments identica in tutto e per tutto a quella creata da "+ Nuovo
 * Appuntamento" (vedi addBlankAppointmentRow/newAppointment), con role:'setter' fisso
 * (il flusso da sessione è sempre lato Setter) e i campi forniti già impostati.
 */
function openAppointmentSetModal() {
  const nowLocal = new Date().toISOString().slice(0, 16);
  openModal(`
    <h3>Appuntamento fissato</h3>
    <p class="text-dim" style="font-size:0.85rem;">Aggiungilo subito al CRM come Setter — completerai gli altri campi dopo, nella schermata Appuntamenti.</p>
    <label class="field">
      Nome appuntamento
      <input type="text" id="apptSetName" placeholder="Nome e cognome" autofocus>
    </label>
    <label class="field">
      Data e ora appuntamento
      <input type="datetime-local" id="apptSetWhen" value="${nowLocal}">
    </label>
    <div class="modal-actions">
      <button class="btn-ghost" id="apptSetCancelBtn">Annulla</button>
      <button class="btn-primary" id="apptSetConfirmBtn">Salva</button>
    </div>
  `);

  const nameInput = document.getElementById('apptSetName');
  nameInput.focus();

  document.getElementById('apptSetCancelBtn').addEventListener('click', closeModal);
  document.getElementById('apptSetConfirmBtn').addEventListener('click', () => {
    const name = nameInput.value.trim();
    const when = document.getElementById('apptSetWhen').value;
    if (!name) { showToast('Inserisci il nome dell\'appuntamento.', true); nameInput.focus(); return; }
    if (!when) { showToast('Inserisci data e ora dell\'appuntamento.', true); return; }

    const apt = newAppointment('setter');
    apt.clientName = name;
    apt.scheduledAt = when;
    db.appointments.unshift(apt);
    persist();
    closeModal();
    showToast('Appuntamento aggiunto al CRM.');
  });
}

function skipLeadAction() {
  const s = db.activeSession;
  // Se era aperta la finestra "richiamo", Skip la annulla (es. non hai richiamato
  // davvero, o è stato un errore) e si passa al prossimo lead senza contare nulla in più.
  s.retryCallsPending = false;
  s.callAttemptsOnLead = 0;
  s.skips = (s.skips || 0) + 1;
  persist();
  renderSessioneAttiva();
}

function endSessionAction() {
  showConfirm('Terminare la sessione? Potrai rivederla nella sezione Sessioni.', () => {
    const s = db.activeSession;
    s.endedAt = new Date().toISOString();
    db.sessions.push(s);
    db.activeSession = null;
    persist();
    clearInterval(sessionTimerInterval);
    document.body.classList.remove('in-session');
    location.hash = '#/sessioni/' + s.id;
    renderRoute();
  }, { confirmLabel: 'Termina sessione' });
}

/* ---------- Modale "Nuova sessione" ---------- */

let npStep = 'pick';
let npSelectedPipelineId = null;
let npDraft = null;

function openModal(html) {
  modalRoot.innerHTML = `<div class="modal-overlay" id="modalOverlay"><div class="modal-box">${html}</div></div>`;
  document.getElementById('modalOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'modalOverlay') closeModal();
  });
}

function closeModal() { modalRoot.innerHTML = ''; }

/**
 * Conferma "sì/no" nello stile della pagina, al posto di window.confirm().
 * Necessario perché i dialog nativi del browser (confirm/alert) non sono
 * affidabili quando la pagina gira dentro un iframe sandbox (es. anteprima
 * Artifact): lì restano bloccati e il bottone sembra "non fare niente".
 */
function showConfirm(message, onConfirm, options) {
  options = options || {};
  const confirmLabel = options.confirmLabel || 'Conferma';
  const cancelLabel = options.cancelLabel || 'Annulla';
  openModal(`
    <p style="margin-bottom:18px;">${escapeHtml(message)}</p>
    <div class="modal-actions">
      <button class="btn-ghost" id="confirmCancelBtn">${escapeHtml(cancelLabel)}</button>
      <button class="btn-danger-ghost" id="confirmOkBtn">${escapeHtml(confirmLabel)}</button>
    </div>
  `);
  document.getElementById('confirmCancelBtn').addEventListener('click', closeModal);
  document.getElementById('confirmOkBtn').addEventListener('click', () => {
    closeModal();
    onConfirm();
  });
}

/** Piccolo messaggio temporaneo, al posto di window.alert() (stesso motivo di showConfirm). */
function showToast(message, isError) {
  let toast = document.getElementById('appToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'appToast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.className = 'toast show' + (isError ? ' toast-error' : '');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => { toast.className = 'toast'; }, 3000);
}

function openNewSessionModal() {
  npStep = 'pick';
  npSelectedPipelineId = null;
  npDraft = null;
  renderModal();
}

function renderModal() {
  const html = npStep === 'pick' ? renderPickStep(npSelectedPipelineId) : renderCreateStep(npDraft);
  openModal(html);
  wireModalEvents();
}

function renderPickStep(selectedId) {
  const tiles = db.pipelines.map(p => `
    <div class="pipeline-tile ${p.id === selectedId ? 'selected' : ''}" data-pid="${p.id}">
      <button class="pipeline-tile-delete" data-del-pid="${p.id}" title="Elimina pipeline">×</button>
      <div class="pipeline-tile-name">${escapeHtml(p.name)}</div>
      <div class="pipeline-tile-meta">${p.outcomes.length} esiti</div>
    </div>`).join('');
  return `
    <h3>Quale pipeline vuoi chiamare?</h3>
    <div class="pipeline-grid">
      ${tiles}
      <div class="pipeline-tile pipeline-tile-add" data-new-pipeline="1">
        <div class="plus">+</div>
        <div>Nuova pipeline</div>
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn-ghost" data-close-modal="1">Annulla</button>
      <button class="btn-primary" id="btnStartSession" ${selectedId ? '' : 'disabled'}>Inizia sessione</button>
    </div>
  `;
}

function renderCreateStep(draft) {
  const chips = draft.outcomes.map(o => `
    <div class="outcome-chip" data-oid="${o.id}">
      <span>${escapeHtml(o.label)}</span>
      ${o.isConversion ? '<span class="tag tag-conv">appuntamento</span>' : ''}
      ${o.isNoAnswer ? '<span class="tag tag-x2">2ª chiamata</span>' : ''}
      <button class="chip-remove" data-remove-oid="${o.id}">×</button>
    </div>`).join('');
  return `
    <h3>Nuova pipeline</h3>
    <label class="field">
      Nome pipeline
      <input type="text" id="npName" placeholder="Es. Lead Instagram Agosto" value="${escapeHtml(draft.name)}">
    </label>
    <div class="field">
      <span>Esiti</span>
      <div class="outcome-chip-list">${chips || '<span class="text-dim">Nessun esito, aggiungine almeno uno</span>'}</div>
    </div>
    <div class="add-outcome-row">
      <input type="text" id="npNewOutcomeLabel" placeholder="Nuovo esito personalizzato">
      <label class="checkbox-inline"><input type="checkbox" id="npNewOutcomeConv"> conta come appuntamento</label>
      <label class="checkbox-inline"><input type="checkbox" id="npNewOutcomeNoAnswer"> nessuna risposta (attiva 2ª chiamata)</label>
      <button class="btn-ghost" id="btnAddOutcome">+ Aggiungi esito</button>
    </div>
    <div class="modal-actions">
      <button class="btn-ghost" id="btnBackToPick">← Indietro</button>
      <button class="btn-primary" id="btnCreatePipeline">Crea pipeline e inizia sessione</button>
    </div>
  `;
}

function wireModalEvents() {
  modalRoot.querySelectorAll('[data-close-modal]').forEach(b => b.addEventListener('click', closeModal));

  if (npStep === 'pick') {
    modalRoot.querySelectorAll('.pipeline-tile[data-pid]').forEach(tile => {
      tile.addEventListener('click', (e) => {
        if (e.target.closest('[data-del-pid]')) return;
        npSelectedPipelineId = tile.dataset.pid;
        renderModal();
      });
    });
    modalRoot.querySelectorAll('[data-del-pid]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const pid = btn.dataset.delPid;
        const p = db.pipelines.find(x => x.id === pid);
        if (!p) return;
        showConfirm(`Eliminare la pipeline "${p.name}"? Le sessioni già registrate restano salvate.`, () => {
          db.pipelines = db.pipelines.filter(x => x.id !== pid);
          if (npSelectedPipelineId === pid) npSelectedPipelineId = null;
          if (uiState.pipelineFilter === pid) uiState.pipelineFilter = 'all';
          persist();
          renderModal();
        }, { confirmLabel: 'Elimina' });
      });
    });
    const addTile = modalRoot.querySelector('[data-new-pipeline]');
    if (addTile) addTile.addEventListener('click', () => {
      npStep = 'create';
      npDraft = { name: '', outcomes: defaultOutcomesList() };
      renderModal();
    });
    const startBtn = document.getElementById('btnStartSession');
    if (startBtn) startBtn.addEventListener('click', () => {
      if (!npSelectedPipelineId) return;
      startSessionAction(npSelectedPipelineId);
    });
  } else {
    document.getElementById('btnBackToPick').addEventListener('click', () => {
      npDraft.name = document.getElementById('npName').value;
      npStep = 'pick';
      renderModal();
    });
    document.getElementById('btnAddOutcome').addEventListener('click', () => {
      const labelInput = document.getElementById('npNewOutcomeLabel');
      const label = labelInput.value.trim();
      npDraft.name = document.getElementById('npName').value;
      if (!label) { labelInput.focus(); return; }
      const isConv = document.getElementById('npNewOutcomeConv').checked;
      const isNoAnswer = document.getElementById('npNewOutcomeNoAnswer').checked;
      npDraft.outcomes.push({
        id: uid('esito'), label, isNoAnswer, isConversion: isConv, isDefault: false
      });
      renderModal();
      const newInput = document.getElementById('npNewOutcomeLabel');
      if (newInput) newInput.focus();
    });
    modalRoot.querySelectorAll('[data-remove-oid]').forEach(btn => {
      btn.addEventListener('click', () => {
        npDraft.name = document.getElementById('npName').value;
        npDraft.outcomes = npDraft.outcomes.filter(o => o.id !== btn.dataset.removeOid);
        renderModal();
      });
    });
    document.getElementById('btnCreatePipeline').addEventListener('click', () => {
      const name = document.getElementById('npName').value.trim();
      if (!name) { showToast('Dai un nome alla pipeline.', true); document.getElementById('npName').focus(); return; }
      if (npDraft.outcomes.length === 0) { showToast('Aggiungi almeno un esito.', true); return; }
      const pipeline = { id: uid('pipe'), name, createdAt: new Date().toISOString(), outcomes: npDraft.outcomes };
      db.pipelines.push(pipeline);
      persist();
      startSessionAction(pipeline.id);
    });
  }
}

function startSessionAction(pipelineId) {
  const pipeline = db.pipelines.find(p => p.id === pipelineId);
  if (!pipeline) return;
  db.sessionCounter += 1;
  db.activeSession = {
    id: uid('sess'),
    number: db.sessionCounter,
    pipelineId: pipeline.id,
    pipelineName: pipeline.name,
    startedAt: new Date().toISOString(),
    endedAt: null,
    calls: [],
    skips: 0,
    retryCallsPending: false,
    callAttemptsOnLead: 0
  };
  persist();
  closeModal();
  location.hash = '#/sessione-attiva';
  renderRoute();
}

/* ---------- Backup: esporta / importa ---------- */

async function exportData() {
  const filename = `chiamate-tracker-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const jsonStr = JSON.stringify(db, null, 2);

  // Se la pagina gira come Artifact pubblicato, usa la capability "downloads"
  // (il download diretto via link non funziona in quel contesto).
  if (window.claude && typeof window.claude.use === 'function') {
    try {
      const downloads = await window.claude.use('downloads');
      if (downloads) {
        try {
          await downloads.save({ filename, data: jsonStr });
          return;
        } catch (err) {
          if (err && err.code === 'declined') return; // l'utente ha annullato il salvataggio
          console.error('Salvataggio tramite capability non riuscito, uso il metodo standard', err);
        }
      }
    } catch (e) {
      console.error('Capability downloads non disponibile', e);
    }
  }

  // Download standard nel browser (usato quando la pagina è ospitata normalmente, es. GitHub Pages)
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let parsed;
    try {
      parsed = JSON.parse(reader.result);
      if (!parsed || !Array.isArray(parsed.pipelines) || !Array.isArray(parsed.sessions)) {
        throw new Error('formato non valido');
      }
    } catch (e) {
      showToast('File non valido: impossibile importare il backup.', true);
      return;
    }
    showConfirm('Importare questo backup sostituirà tutti i dati attuali. Continuare?', () => {
      db = mergeWithDefaults(parsed);
      persist();
      renderRoute();
      showToast('Backup importato correttamente.');
    }, { confirmLabel: 'Importa e sostituisci' });
  };
  reader.readAsText(file);
}

/* ============================================================================
 * Builder (Impostazioni) — pagina piena, raggiungibile dal pulsante 🎨 in topbar.
 * Scelta di design: pagina piena invece di modal, perché il builder ha molte
 * sezioni (preset, 8 color picker, radius, font, 2 slider, glow, 16 toggle) e
 * un modal sarebbe scomodo da scorrere — la sincronizzazione Firebase (⚙, poche
 * righe) resta invece un modal come prima.
 * ==========================================================================*/

const TOGGLE_DEFS = [
  { key: 'grindMode', title: 'Modalità Grind', desc: 'Sotto obiettivo mese = accenti rossi, sopra = lime/verde.' },
  { key: 'animatedNumbers', title: 'Numeri che contano', desc: 'Count-up animato sui KPI ad ogni render.' },
  { key: 'closeSound', title: 'Suono conferma chiusura', desc: 'Beep sintetizzato quando marchi un appuntamento come chiuso.' },
  { key: 'dailyStreak', title: 'Streak giornaliero', desc: 'Mostra i giorni consecutivi con almeno un appuntamento fissato.' },
  { key: 'confetti', title: 'Confetti', desc: 'Coriandoli animati quando una barra obiettivo tocca il 100%.' },
  { key: 'autoTheme', title: 'Tema auto giorno/notte', desc: 'Chiaro 7-19, scuro il resto del giorno (sovrascrive il tema di sistema).' },
  { key: 'monthCountdown', title: 'Countdown fine mese', desc: 'Giorni rimanenti nel mese corrente, in cima alla dashboard.' },
  { key: 'dailyQuote', title: 'Frase motivazionale', desc: 'Una frase al giorno, stabile per tutto il giorno.' },
  { key: 'closingPace', title: 'Ritmo di chiusura', desc: 'Proietta quando raggiungerai il target mensile di chiusure.' },
  { key: 'personalBest', title: 'Personal best', desc: 'Badge se la settimana corrente batte lo storico.' },
  { key: 'midMilestone', title: 'Milestone a metà', desc: 'Pulse quando una barra supera il 50%/75%.' },
  { key: 'liveTicker', title: 'Ticker commissioni live', desc: '"+€X" che appare e sfuma vicino al KPI commissioni.' },
  { key: 'bossMode', title: 'Boss Mode', desc: 'Ultimi 3 giorni del mese, sotto obiettivo: bordi pulsanti sugli elementi principali.' },
  { key: 'levelUpSound', title: 'Suono level up', desc: 'Come il beep di chiusura, tono diverso, stesso trigger del 100% obiettivo.' },
  { key: 'cashDayBadge', title: 'Cash Day badge', desc: 'Evidenzia nel calendario i giorni sopra una soglia €.', hasThreshold: true },
  { key: 'slotMachineNumbers', title: 'Font slot machine', desc: 'Animazione verticale sui KPI invece del count-up (ha priorità se entrambi attivi).' }
];

function renderBuilderPage() {
  const s = db.settings;

  const presetsHtml = Object.entries(THEME_PRESETS).map(([key, p]) => `
    <div class="preset-swatch ${s.preset === key ? 'active' : ''}" data-preset="${key}">
      <div class="preset-dots">
        <span class="preset-dot" style="background:${p.colors.bg}"></span>
        <span class="preset-dot" style="background:${p.colors.accent}"></span>
        <span class="preset-dot" style="background:${p.colors.bgElev}"></span>
      </div>
      <div class="preset-name">${p.label}</div>
    </div>`).join('');

  const colorFieldDefs = [
    ['bg', 'Sfondo'], ['bgElev', 'Superficie card'], ['accent', 'Accento'], ['text', 'Testo'],
    ['setterColor', 'Colore Setter'], ['venditoreColor', 'Colore Venditore'], ['success', 'Successo'], ['danger', 'Errore']
  ];
  const colorsHtml = colorFieldDefs.map(([key, label]) => `
    <div class="color-field">
      <input type="color" id="color_${key}" value="${s.colors[key]}">
      <label>${label}</label>
      <input type="text" id="colortext_${key}" value="${s.colors[key]}">
    </div>`).join('');

  const radiusLabels = { none: 'Nessuno', sharp: 'Squadrato', soft: 'Morbido', round: 'Arrotondato', pill: 'Pillola', cut: 'Lametta', bracket: 'Bracket', mixed: 'Misto' };
  const radiusHtml = RADIUS_STYLES.map(r => `<button class="chip-select ${s.radiusStyle === r ? 'active' : ''}" data-radius="${r}">${radiusLabels[r]}</button>`).join('');

  const fontsHtml = FONT_STYLES.map(f => `<button class="chip-select font-preview-${f.id} ${s.fontStyle === f.id ? 'active' : ''}" data-font="${f.id}">${f.label}</button>`).join('');

  const glowLabels = { none: 'Nessuno', border: 'Bordo', full: 'Completo' };
  const glowHtml = Object.keys(glowLabels).map(g => `<button class="chip-select ${s.glowLevel === g ? 'active' : ''}" data-glow="${g}">${glowLabels[g]}</button>`).join('');

  const togglesHtml = TOGGLE_DEFS.map(t => `
    <div class="toggle-row">
      <div class="toggle-row-text">
        <div class="toggle-row-title">${t.title}</div>
        <div class="toggle-row-desc">${t.desc}</div>
      </div>
      <div class="toggle-row-extra">
        ${t.hasThreshold ? `<input type="number" min="0" id="cashDayThreshold" value="${s.cashDayThreshold || 0}" title="Soglia €">` : ''}
        <label class="switch">
          <input type="checkbox" data-toggle="${t.key}" ${s.toggles[t.key] ? 'checked' : ''}>
          <span class="switch-track"></span>
        </label>
      </div>
    </div>`).join('');

  appRoot.innerHTML = `
    <div class="page-header"><h2>Impostazioni — Personalizzazione</h2></div>

    <section class="card builder-section">
      <h3>Preset rapidi</h3>
      <div class="preset-row">${presetsHtml}</div>
    </section>

    <section class="card builder-section">
      <h3>Colori custom</h3>
      <div class="color-grid">${colorsHtml}</div>
    </section>

    <section class="card builder-section">
      <h3>Stile angoli</h3>
      <div class="chip-select-row">${radiusHtml}</div>
    </section>

    <section class="card builder-section">
      <h3>Font</h3>
      <div class="chip-select-row">${fontsHtml}</div>
    </section>

    <section class="card builder-section">
      <h3>Saturazione &amp; contrasto</h3>
      <div class="slider-row">
        <label><span>Saturazione accento</span><span>${s.accentSaturation}</span></label>
        <input type="range" min="0" max="100" id="sliderSaturation" value="${s.accentSaturation}">
      </div>
      <div class="slider-row">
        <label><span>Contrasto card/sfondo</span><span>${s.cardContrast}</span></label>
        <input type="range" min="0" max="100" id="sliderContrast" value="${s.cardContrast}">
      </div>
    </section>

    <section class="card builder-section">
      <h3>Livello glow</h3>
      <div class="chip-select-row">${glowHtml}</div>
    </section>

    <section class="card builder-section">
      <h3>Opzioni particolari</h3>
      <div class="toggle-list">${togglesHtml}</div>
    </section>

    <div class="builder-actions">
      <button class="btn-ghost" id="btnResetBuilder">Ripristina default</button>
    </div>
  `;

  wireBuilderEvents();
}

function wireBuilderEvents() {
  appRoot.querySelectorAll('[data-preset]').forEach(el => {
    el.addEventListener('click', () => {
      const preset = THEME_PRESETS[el.dataset.preset];
      if (!preset) return;
      db.settings.preset = el.dataset.preset;
      db.settings.colors = Object.assign({}, preset.colors);
      persist();
      applyTheme(db.settings);
      renderBuilderPage();
    });
  });

  const colorFieldDefs = ['bg', 'bgElev', 'accent', 'text', 'setterColor', 'venditoreColor', 'success', 'danger'];
  colorFieldDefs.forEach(key => {
    const colorInput = document.getElementById('color_' + key);
    const textInput = document.getElementById('colortext_' + key);
    const commit = (val) => {
      if (!/^#[0-9a-fA-F]{6}$/.test(val)) return;
      db.settings.colors[key] = val;
      db.settings.preset = 'custom';
      persist();
      applyTheme(db.settings);
    };
    colorInput.addEventListener('input', () => { textInput.value = colorInput.value; commit(colorInput.value); });
    textInput.addEventListener('change', () => { commit(textInput.value); colorInput.value = textInput.value; });
  });

  appRoot.querySelectorAll('[data-radius]').forEach(btn => {
    btn.addEventListener('click', () => {
      db.settings.radiusStyle = btn.dataset.radius;
      persist();
      applyTheme(db.settings);
      renderBuilderPage();
    });
  });
  appRoot.querySelectorAll('[data-font]').forEach(btn => {
    btn.addEventListener('click', () => {
      db.settings.fontStyle = btn.dataset.font;
      persist();
      applyTheme(db.settings);
      renderBuilderPage();
    });
  });
  appRoot.querySelectorAll('[data-glow]').forEach(btn => {
    btn.addEventListener('click', () => {
      db.settings.glowLevel = btn.dataset.glow;
      persist();
      applyTheme(db.settings);
      renderBuilderPage();
    });
  });

  document.getElementById('sliderSaturation').addEventListener('input', (e) => {
    db.settings.accentSaturation = parseInt(e.target.value, 10);
    persist();
    applyTheme(db.settings);
  });
  document.getElementById('sliderContrast').addEventListener('input', (e) => {
    db.settings.cardContrast = parseInt(e.target.value, 10);
    persist();
    applyTheme(db.settings);
  });

  const cashThreshold = document.getElementById('cashDayThreshold');
  if (cashThreshold) {
    cashThreshold.addEventListener('change', () => {
      db.settings.cashDayThreshold = Math.max(0, parseFloat(cashThreshold.value) || 0);
      persist();
    });
  }

  appRoot.querySelectorAll('[data-toggle]').forEach(input => {
    input.addEventListener('change', () => {
      db.settings.toggles[input.dataset.toggle] = input.checked;
      persist();
      applyTheme(db.settings);
    });
  });

  document.getElementById('btnResetBuilder').addEventListener('click', () => {
    showConfirm('Ripristinare aspetto e opzioni ai valori di default (Graphite Lime)?', () => {
      db.settings = defaultSettings();
      persist();
      applyTheme(db.settings);
      renderBuilderPage();
      showToast('Impostazioni ripristinate.');
    }, { confirmLabel: 'Ripristina' });
  });
}

/* ---------- Impostazioni: sincronizzazione Firebase (facoltativa) ---------- */

function openSettingsModal() {
  const settings = FirebaseSync.getSettings();
  const configStr = settings.config ? JSON.stringify(settings.config, null, 2) : '';

  openModal(`
    <h3>Sincronizzazione Firebase</h3>
    <p class="text-dim" style="font-size:0.85rem;">
      Facoltativa: collega un progetto Firebase (Firestore) per avere gli stessi dati su più dispositivi,
      invece di usare solo Esporta/Importa. Se non la configuri, il tool continua a salvare solo su questo browser.
    </p>
    <label class="checkbox-inline" style="margin-bottom:14px;">
      <input type="checkbox" id="fbEnabled" ${settings.enabled ? 'checked' : ''}> Abilita sincronizzazione
    </label>
    <label class="field">
      Codice stanza (uguale su tutti i dispositivi da sincronizzare)
      <input type="text" id="fbRoomCode" placeholder="es. mario-rossi-2026" value="${escapeHtml(settings.roomCode || '')}">
    </label>
    <label class="field">
      Configurazione Firebase (incolla qui l'oggetto firebaseConfig dalla console Firebase)
      <textarea id="fbConfig" rows="7" class="fb-config-textarea">${escapeHtml(configStr)}</textarea>
    </label>
    <div class="modal-actions" style="justify-content:space-between;">
      <button class="btn-ghost" id="btnTestFbConnection">Verifica connessione</button>
      <div style="display:flex; gap:8px;">
        <button class="btn-ghost" data-close-modal="1">Annulla</button>
        <button class="btn-primary" id="btnSaveFbSettings">Salva</button>
      </div>
    </div>
  `);
  modalRoot.querySelectorAll('[data-close-modal]').forEach(b => b.addEventListener('click', closeModal));

  document.getElementById('btnTestFbConnection').addEventListener('click', async () => {
    const btn = document.getElementById('btnTestFbConnection');
    const roomCode = document.getElementById('fbRoomCode').value.trim();
    let cfg;
    try {
      cfg = JSON.parse(document.getElementById('fbConfig').value);
    } catch (e) {
      showToast('La configurazione Firebase non è un JSON valido.', true);
      return;
    }
    const originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Verifica in corso…';
    try {
      await FirebaseSync.testConnection(cfg, roomCode || '__test__');
      showToast('Connessione a Firebase riuscita.');
    } catch (e) {
      console.error('Test connessione Firebase fallito', e);
      showToast('Connessione a Firebase non riuscita. Controlla configurazione e regole Firestore.', true);
    } finally {
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  });

  document.getElementById('btnSaveFbSettings').addEventListener('click', () => {
    const enabled = document.getElementById('fbEnabled').checked;
    const roomCode = document.getElementById('fbRoomCode').value.trim();
    const configText = document.getElementById('fbConfig').value.trim();
    let cfg = null;
    if (configText) {
      try {
        cfg = JSON.parse(configText);
      } catch (e) {
        showToast('La configurazione Firebase non è un JSON valido.', true);
        return;
      }
    }
    if (enabled && (!cfg || !roomCode)) {
      showToast('Per abilitare la sincronizzazione servono sia la configurazione che il codice stanza.', true);
      return;
    }
    FirebaseSync.saveSettings({ enabled, config: cfg, roomCode });
    closeModal();
    updateSyncStatusVisibility();
    showToast(enabled ? 'Sincronizzazione Firebase attivata.' : 'Impostazioni salvate.');
    if (enabled) {
      initFirebaseSyncOnLoad();
      queueFirebasePush();
    }
  });
}

function updateSyncStatusVisibility() {
  const el = document.getElementById('syncStatus');
  if (!el) return;
  el.style.display = FirebaseSync.isConfigured() ? 'inline' : 'none';
}

/* ---------- Init ---------- */

document.querySelectorAll('.navlink').forEach(l => {
  l.addEventListener('click', () => { location.hash = '#/' + l.dataset.route; });
});
document.getElementById('btnNuovaSessione').addEventListener('click', openNewSessionModal);
document.getElementById('btnExport').addEventListener('click', exportData);
document.getElementById('importFile').addEventListener('change', (e) => {
  if (e.target.files[0]) importData(e.target.files[0]);
  e.target.value = '';
});
document.getElementById('btnSettings').addEventListener('click', openSettingsModal);
document.getElementById('btnBuilder').addEventListener('click', () => { location.hash = '#/impostazioni'; });

updateSyncStatusVisibility();
initFirebaseSyncOnLoad();
applyTheme(db.settings);

window.addEventListener('hashchange', renderRoute);
renderRoute();
