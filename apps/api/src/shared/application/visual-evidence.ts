import type { VisualEvidence } from './ports.js';

/**
 * O retrato visual em texto, para entrar no contexto do modelo.
 *
 * Mora na APLICAÇÃO, e não junto do extrator: quem chama isto é o runner, e o
 * runner não pode importar de `infrastructure/` (invariante 2). O extrator lida
 * com HTML e CSS — detalhe de infraestrutura; isto lê o tipo do port e escreve
 * texto, que é trabalho de aplicação.
 *
 * Compacto de propósito: viaja em TODA operação que recebe uma URL, e cada
 * linha aqui disputa espaço com o conteúdo do site — que é o que diz o que o
 * negócio faz. Cor sem frequência e sem papel seria ruído caro.
 */
export function describeVisualIdentity(evidence: VisualEvidence): string {
  const linhas: string[] = [];

  if (evidence.themeColor) {
    linhas.push(`Cor que o site declara como sua (meta theme-color): ${evidence.themeColor}`);
  }

  if (evidence.colors.length > 0) {
    linhas.push(
      'Cores por frequência de uso (a da marca costuma estar entre as mais usadas em fundo/ícone):',
    );
    for (const cor of evidence.colors) {
      const onde = cor.roles.length > 0 ? ` em ${cor.roles.join(', ')}` : '';
      linhas.push(`  ${cor.hex} — ${cor.count}×${onde}`);
    }
  }

  if (evidence.webFonts.length > 0) {
    linhas.push(`Fontes que o site CARREGA de um provedor: ${evidence.webFonts.join(', ')}`);
  }

  if (evidence.fonts.length > 0) {
    linhas.push(
      `Famílias declaradas em CSS: ${evidence.fonts
        .map((fonte) => `${fonte.family} (${fonte.count}×${fonte.heading ? ', em títulos' : ''})`)
        .join(', ')}`,
    );
  }

  if (evidence.radii.length > 0) {
    linhas.push(
      `Raio de borda mais usado: ${evidence.radii
        .map((raio) => `${raio.px}px (${raio.count}×)`)
        .join(', ')}`,
    );
  }

  if (evidence.siteName) linhas.push(`Nome declarado do site: ${evidence.siteName}`);
  if (evidence.description) linhas.push(`Descrição declarada: ${evidence.description}`);

  return linhas.join('\n');
}
