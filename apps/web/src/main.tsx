import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { traktLocalCallbackTarget } from './traktRedirectUri';

const root = document.getElementById('root');
if (!root) throw new Error('Application root element is missing');

const callbackTarget = traktLocalCallbackTarget(window.location, window.name);
if (callbackTarget) {
  window.name = '';
  window.location.replace(callbackTarget);
} else {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}
