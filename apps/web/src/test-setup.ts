import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Rodamos com `globals: false`, então o Testing Library não consegue registrar
// o cleanup automático sozinho — sem isto, o DOM de um teste vaza para o próximo.
afterEach(cleanup);

// jsdom não implementa matchMedia, que o ThemeProvider e o script de tema usam.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
