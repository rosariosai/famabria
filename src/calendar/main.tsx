import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { CalendarPage } from './CalendarPage';
import './calendar.css';
import './modern.css';

// Web app: save the app for offline use (the extension needs no service worker).
if (__TARGET__ === 'web' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js?v=${__APP_VERSION__}`, { scope: import.meta.env.BASE_URL }).catch(() => undefined); });
}

createRoot(document.getElementById('root')!).render(<StrictMode><CalendarPage /></StrictMode>);
