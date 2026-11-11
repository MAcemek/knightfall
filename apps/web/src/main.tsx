import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App.tsx';
import { getPlayerName } from './shared/profile.ts';
import { hydrateSettings } from './shared/settings.ts';
import './index.css';

void getPlayerName();
void hydrateSettings();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
