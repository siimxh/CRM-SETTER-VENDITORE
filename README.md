# Chiamate Tracker

Piccolo tool per tracciare sessioni di chiamate outbound: pipeline da chiamare, esiti, timer di sessione e dashboard con statistiche e insight.

È una pagina statica (HTML/CSS/JS puro, nessuna build, nessuna dipendenza esterna): puoi aprirla direttamente facendo doppio click su `index.html`, oppure pubblicarla gratis su **GitHub Pages**.

## Come funziona

- **Dashboard**: statistiche sulle chiamate con filtro per periodo (Oggi, Ieri, 7/30/90 giorni, Mese corrente, Mese scorso, o intervallo personalizzato) e per pipeline. Include andamento rispetto al periodo precedente, tasso di risposta/conversione, confronto tra pipeline e produttività (chiamate/ora, media per sessione).
- **Sessioni**: elenco di tutte le sessioni svolte ("Sessione 1 - 27/08/2026", ecc.), con dettaglio di ogni sessione.
- **Nuova sessione**: scegli una pipeline esistente o creane una nuova (con il pulsante "+"). Le pipeline nuove partono con gli esiti di default (Non risp, Da richiamare, Fake, Appuntamento Fissato, Non interessato, conferma appuntamento) e puoi aggiungere esiti personalizzati, segnando se contano come appuntamento o come "nessuna risposta" (vedi sotto).
- **Schermata di sessione**: isolata dalla dashboard. Mostra timer, chiamate fatte, lead contattati e la divisione degli esiti in tempo reale, con bottoni grandi per registrare l'esito di ogni chiamata. In alto trovi "Skip" (passa al lead successivo senza contarlo) e "Fine sessione".
- **Seconda chiamata sullo stesso lead**: quando segni un esito "nessuna risposta" (es. "Non risp"), il tool apre un avviso "Seconda chiamata — stesso lead" e i bottoni restano attivi per registrare l'esito del richiamo. Che tu risponda con lo stesso esito o con uno diverso, viene contata una chiamata in più ma **non** un nuovo lead. Se in realtà non richiami quel lead, premi Skip per annullare l'attesa e passare al prossimo.
- **Report Sessione**: dalla dashboard, il pulsante "Report Sessione" copia negli appunti un riepilogo testuale del periodo/pipeline filtrati (chiamate svolte, lead unici, e il conteggio di ogni esito) — pronto da incollare per il direttore commerciale. Se la copia automatica non funziona nel tuo browser, si apre comunque una finestra con il testo pronto da selezionare e copiare a mano.

## Dati, backup e sincronizzazione

Di base i dati sono salvati **solo nel browser** che usi (tecnologia `localStorage`): privati e gratuiti (nessun server, nessun account), ma non si sincronizzano automaticamente tra dispositivi/browser diversi, e se cancelli i dati di navigazione del browser li perdi.

Per questo trovi in alto i pulsanti **Esporta** (scarica un file `.json` di backup) e **Importa** (ripristina un backup) — utili per uno spostamento occasionale o come backup di sicurezza.

**Sincronizzazione Firebase (facoltativa)**: dal pulsante ⚙ in alto puoi collegare un progetto Firebase (Firestore) tuo, per avere automaticamente gli stessi dati su più dispositivi invece di fare export/import a mano. È spenta di default: finché non la configuri il tool si comporta esattamente come descritto sopra. Ne parliamo con calma quando sei pronto a impostarla.

## Pubblicarlo gratis su GitHub Pages

1. Crea un nuovo repository su GitHub (es. `chiamate-tracker`), pubblico.
2. Carica tutti i file di questa cartella (`index.html`, `style.css`, `storage.js`, `utils.js`, `firebase-sync.js`, `app.js`) nella root del repository (puoi trascinarli dall'interfaccia web di GitHub in "Add file → Upload files", oppure con git).
3. Vai su **Settings → Pages** del repository.
4. In "Build and deployment", scegli **Source: Deploy from a branch**, branch **main**, cartella **/(root)**. Salva.
5. Dopo un minuto o due, GitHub ti mostrerà l'indirizzo pubblico (tipo `https://tuonome.github.io/chiamate-tracker/`). Salvalo anche come app sulla home del telefono per aprirlo velocemente.

Nota: essendo i dati salvati solo nel browser, se apri il link da più dispositivi (es. telefono e PC) avrai due archivi separati — usa Esporta/Importa per spostarli.

## Struttura del progetto

```
chiamate-tracker/
├── index.html         # struttura della pagina
├── style.css           # stile (tema chiaro/scuro, minimale)
├── storage.js           # salvataggio dati (localStorage) e valori di default
├── utils.js              # calcolo periodi/statistiche e formattazione
├── firebase-sync.js       # sincronizzazione Firebase facoltativa
└── app.js                  # routing e logica dell'interfaccia
```
