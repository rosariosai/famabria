import type { CalEvent } from '../core/events';

/** Small horn-speaker icon shown on notes that have a reminder. */
export function RemindIcon({ e }: { e: Pick<CalEvent, 'remind'> }) {
  if (!e.remind || e.remind === 'none') return null;
  return (
    <svg className="remind-ico" viewBox="0 0 24 24" width="14" height="14" role="img" aria-label="Promemoria attivo">
      <title>Promemoria attivo</title>
      <rect x="1.5" y="9" width="4.5" height="6" rx="1.2" fill="currentColor" />
      <path d="M6 9 15 4.2v15.6L6 15z" fill="currentColor" />
      <rect x="15" y="3" width="3.2" height="18" rx="1.6" fill="currentColor" />
      <path d="M20.2 8.5c1.2 1.9 1.2 5.1 0 7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
