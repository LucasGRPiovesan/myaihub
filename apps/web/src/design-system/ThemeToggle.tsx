import { Moon, Sun } from 'lucide-react';
import { Button } from './primitives';
import { useTheme } from './theme';

export function ThemeToggle({ large = false }: { large?: boolean }) {
  const { theme, toggle } = useTheme();
  const next = theme === 'dark' ? 'claro' : 'escuro';

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={toggle}
      aria-label={`Mudar para o tema ${next}`}
      title={`Mudar para o tema ${next}`}
      className={large ? 'size-10 px-0' : 'size-8 px-0'}
    >
      {theme === 'dark' ? (
        <Sun aria-hidden className={large ? 'size-5' : 'size-4'} />
      ) : (
        <Moon aria-hidden className={large ? 'size-5' : 'size-4'} />
      )}
    </Button>
  );
}
