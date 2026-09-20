import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'myaihub:theme';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readInitialTheme(): Theme {
  if (typeof document === 'undefined') return 'light';
  const applied = document.documentElement.dataset['theme'];
  return applied === 'dark' ? 'dark' : 'light';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // O tema já foi aplicado pelo script inline do index.html, para evitar flash.
  // Aqui apenas assumimos o controle a partir do estado que já está no DOM.
  const [theme, setThemeState] = useState<Theme>(readInitialTheme);

  useEffect(() => {
    document.documentElement.dataset['theme'] = theme;
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Modo privado / storage bloqueado: o tema só não persiste entre sessões.
    }
  }, [theme]);

  const setTheme = useCallback((next: Theme) => setThemeState(next), []);
  const toggle = useCallback(
    () => setThemeState((current) => (current === 'dark' ? 'light' : 'dark')),
    [],
  );

  const value = useMemo(() => ({ theme, setTheme, toggle }), [theme, setTheme, toggle]);

  return <ThemeContext value={value}>{children}</ThemeContext>;
}

export function useTheme(): ThemeContextValue {
  const context = use(ThemeContext);
  if (!context) {
    throw new Error('useTheme precisa estar dentro de <ThemeProvider>.');
  }
  return context;
}
