import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestResources, getTestApp, resetDatabase } from './helpers/test-context.js';

/**
 * Correção no seed PRECISA chegar ao banco.
 *
 * A semeadura só acrescentava seção nova e nunca corrigia o texto de uma
 * existente — "porque ela pode ter sido editada em produção". Só que não existe
 * caminho nenhum para editá-la: nem rota, nem método de repositório. A proteção
 * guardava algo que não existe e bloqueava tudo o que existe, com o pior
 * sintoma possível: a correção ficava no código, o sistema seguia com o texto
 * velho, e nada acusava. A mesma regra foi "corrigida" duas vezes sem nunca
 * chegar ao modelo.
 */
describe('semeadura da Master Policy', () => {
  beforeEach(resetDatabase);
  afterAll(closeTestResources);

  // O MESMO repositório que o boot usa. Instanciar um cliente próprio aqui
  // testaria outra coisa: o que interessa é o caminho real da semeadura.
  const repo = getTestApp().container.hub.policies;

  it('acrescenta seção nova numa versão nova', async () => {
    const nome = `teste-${Date.now()}`;

    const primeira = await repo.syncSections(nome, { core: 'texto original' });
    const segunda = await repo.syncSections(nome, { core: 'texto original', extra: 'nova' });

    expect(segunda.added).toEqual(['extra']);
    expect(segunda.updated).toEqual([]);
    expect(segunda.version.versionNumber).toBe(primeira.version.versionNumber + 1);
  });

  it('CORRIGE seção existente cujo texto mudou', async () => {
    const nome = `teste-${Date.now()}-b`;

    await repo.syncSections(nome, { core: 'a regra antiga' });
    const depois = await repo.syncSections(nome, { core: 'a regra corrigida' });

    expect(depois.updated).toEqual(['core']);
    expect(depois.version.sections['core']).toBe('a regra corrigida');

    // O que o OS vai LER precisa ser o texto novo — é esse o ponto inteiro.
    const vigente = await repo.getCurrent(nome);
    expect(vigente?.sections['core']).toBe('a regra corrigida');
  });

  it('não cria versão quando nada mudou', async () => {
    const nome = `teste-${Date.now()}-c`;

    const primeira = await repo.syncSections(nome, { core: 'igual' });
    const segunda = await repo.syncSections(nome, { core: 'igual' });

    // Versão por boot vazio encheria o histórico de ruído e faria o rollback
    // deixar de contar uma história.
    expect(segunda.version.versionNumber).toBe(primeira.version.versionNumber);
    expect(segunda.added).toEqual([]);
    expect(segunda.updated).toEqual([]);
  });

  it('preserva seção que existe só no banco', async () => {
    const nome = `teste-${Date.now()}-d`;

    await repo.syncSections(nome, { core: 'a', legado: 'b' });
    const depois = await repo.syncSections(nome, { core: 'a2' });

    // Apagar orientação por omissão do arquivo é pior que manter texto velho:
    // uma operação pode declarar a seção, e o runner a pula em silêncio.
    expect(depois.version.sections['legado']).toBe('b');
    expect(depois.version.sections['core']).toBe('a2');
  });
});
