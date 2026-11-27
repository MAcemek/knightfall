import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App.tsx';
import { getPlayerName } from './shared/profile.ts';
import { requestPersistentStorage } from './shared/storage/persist.ts';
import { registerServiceWorker } from './shared/pwa/register.ts';
import { hydrateSettings } from './shared/settings.ts';
import './index.css';

void getPlayerName();
void hydrateSettings();
void requestPersistentStorage();
registerServiceWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
