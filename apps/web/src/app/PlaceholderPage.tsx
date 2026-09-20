import { Card } from '../design-system/primitives';

/**
 * Estado vazio honesto: diz o que ainda não existe e em que fase chega, em vez
 * de encher a tela de cards falsos para "parecer completo" (§77, §82).
 */
export function PlaceholderPage({ title, description }: { title: string; description: string }) {
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <Card className="mt-5 p-6">
        <p className="text-sm leading-relaxed text-text-muted">{description}</p>
      </Card>
    </div>
  );
}
