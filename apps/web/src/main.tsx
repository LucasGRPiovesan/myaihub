import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import './styles.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Elemento #root não encontrado no index.html.');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
