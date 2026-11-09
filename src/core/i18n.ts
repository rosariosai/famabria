// Interface language. Italian is the original; English was added in 2.10.0.
// The language is read once when the page loads (a change in Settings reloads the page), so plain constants are enough.
export type Lang = 'it' | 'en';
export type LangChoice = 'auto' | Lang;

const KEY = 'famabria-lang';

export function getLangChoice(): LangChoice {
  try { const v = localStorage.getItem(KEY); if (v === 'it' || v === 'en' || v === 'auto') return v; } catch { /* private window */ }
  return 'auto';
}
function detect(): Lang {
  const c = getLangChoice();
  if (c !== 'auto') return c;
  if (typeof window === 'undefined') return 'it'; // tests and Node tools keep Italian
  const nav = typeof navigator !== 'undefined' ? (navigator.languages?.[0] ?? navigator.language ?? '') : '';
  return /^it\b/i.test(nav) ? 'it' : 'en';
}
export const LANG: Lang = detect();
export const isEn = LANG === 'en';
/** Saves the choice; the caller reloads the page. */
export function setLangChoice(c: LangChoice): void { try { localStorage.setItem(KEY, c); } catch { /* no memory */ } }

/** Picks the text for the current language: tr('Impostazioni', 'Settings'). */
export const tr = (it: string, en: string): string => (isEn ? en : it);
/** BCP-47 tag for Intl / toLocale* calls. */
export const LOCALE = isEn ? 'en-GB' : 'it-IT';

// ---- Messages thrown by the sync / crypto code are written in Italian; the UI translates them for display with tm().
const EN_MSG: Record<string, string> = {
  'Dropbox non risponde: controlla la connessione.': 'Dropbox is not responding: check your connection.',
  "Dropbox non ha accettato l'accesso. Riprova dall'inizio.": 'Dropbox did not accept the sign-in. Start again.',
  'Dropbox non risponde: controlla la connessione. Le note restano sul telefono e si sincronizzeranno dopo.': 'Dropbox is not responding: check your connection. Your notes stay on the device and will sync later.',
  'Dropbox non accetta più questo invito: chiedi un nuovo link.': 'Dropbox no longer accepts this invite: ask for a new link.',
  'Dropbox non ha accettato il file (spazio esaurito?).': 'Dropbox did not accept the file (out of space?).',
  "L'indirizzo del relay non è valido.": 'The relay address is not valid.',
  'Fuori dalla rete di casa serve un indirizzo https://.': 'Outside your home network you need an https:// address.',
  'Invito danneggiato o incompleto.': 'The invite is damaged or incomplete.',
  'Invito non valido.': 'Invalid invite.',
  'Invito non valido (servizio sconosciuto).': 'Invalid invite (unknown service).',
  'Il relay non risponde: controlla la connessione. Le note restano sul telefono e si sincronizzeranno dopo.': 'The relay is not responding: check your connection. Your notes stay on the device and will sync later.',
  'Il relay non risponde: controlla la connessione.': 'The relay is not responding: check your connection.',
  'Il relay non accetta più questo invito.': 'The relay no longer accepts this invite.',
  'Il relay non accetta più questo dispositivo (rimosso o scaduto).': 'The relay no longer accepts this device (removed or expired).',
  'Il relay non accetta più questo dispositivo.': 'The relay no longer accepts this device.',
  'Troppe richieste: riprovo tra poco.': 'Too many requests: trying again shortly.',
  'Risposta del relay non valida.': 'Invalid answer from the relay.',
  'Questa famiglia usa ancora il vecchio tipo di invito.': 'This family still uses the old kind of invite.',
  'Solo chi ha creato la famiglia può invitare.': 'Only the person who created the family can invite.',
  'Ci sono già 3 inviti aperti: aspetta che scadano (15 minuti) o usa uno già creato.': 'There are already 3 open invites: wait for them to expire (15 minutes) or use one you already made.',
  'Invito scaduto, già usato o non valido. Chiedi un nuovo link a chi ti ha invitato.': 'The invite has expired, was already used, or is not valid. Ask the person who invited you for a new link.',
  'Solo chi ha creato la famiglia può rimuovere dispositivi.': 'Only the person who created the family can remove devices.',
  "Questo browser non permette la crittografia qui: usa l'indirizzo HTTPS o l'estensione.": 'This browser does not allow encryption here: use the HTTPS address or the extension.',
  'Codice non valido.': 'Invalid code.',
  'Codice danneggiato o incompleto.': 'The code is damaged or incomplete.',
  'Questo non è un invito Famcal': 'This is not a Famabria invite',
  'Qualcosa è andato storto.': 'Something went wrong.',
  'Qualcosa è andato storto durante la sincronizzazione.': 'Something went wrong while syncing.',
  'Non riesco a raggiungere il servizio scelto: controlla indirizzo e connessione.': 'Cannot reach the chosen service: check the address and your connection.',
  'Questa famiglia è già della nuova versione.': 'This family is already on the new version.',
  'Il relay non supporta ancora la nuova versione: pubblica prima il relay aggiornato.': 'The relay does not support the new version yet: deploy the updated relay first.',
};
const EN_RX: [RegExp, (m: RegExpExecArray) => string][] = [
  [/^Dropbox ha risposto con un errore \((\d+)\)\.$/, (m) => `Dropbox answered with an error (${m[1]}).`],
  [/^Il relay ha risposto con un errore \((\d+)\)\.$/, (m) => `The relay answered with an error (${m[1]}).`],
  [/^Ricevute (\d+) modifiche\.$/, (m) => `Received ${m[1]} changes.`],
];
/** Translates a message thrown by the sync code (identity in Italian or when unknown). */
export function tm(msg: string): string {
  if (!isEn) return msg;
  const hit = EN_MSG[msg]; if (hit) return hit;
  for (const [rx, f] of EN_RX) { const m = rx.exec(msg); if (m) return f(m); }
  return msg;
}
