import { describe, expect, it } from 'vitest';
import { entityPath, layerOf } from './HubTranscript';

describe('camada do resultado', () => {
  it('diz onde a mudança vale — base, campanha ou projeto', () => {
    expect(layerOf('AGENT', 'Alex')).toEqual({
      title: 'Base do agente Alex',
      scope: 'vale em todas as campanhas dele',
    });
    expect(layerOf('CAMPAIGN', 'Linha')?.scope).toBe('vale só nesta campanha');
    expect(layerOf('PROJECT_PROFILE', 'Sankar')?.title).toBe('Projeto Sankar');
  });

  it('campanha sem o projeto da rota não tem caminho — melhor sem link que link quebrado', () => {
    expect(entityPath('CAMPAIGN', '01C', undefined)).toBeNull();
    expect(entityPath('CAMPAIGN', '01C', '01P')).toBe('/projetos/01P/campanhas/01C');
  });
});
