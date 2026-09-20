import { describe, expect, it } from 'vitest';
import type { ProviderKeyKind, ProviderName } from '@myaihub/shared';
import type { AuditWriter } from '../../../shared/application/ports.js';
import type { TenantContext } from '../../../shared/application/tenant-context.js';
import { ManageProviderCredentialsUseCase } from './manage-provider-credentials.use-case.js';
import type {
  ConnectionTestResult,
  ProviderCredentialRecord,
  ProviderCredentialRepository,
  ProviderSettingRecord,
} from './provider-credentials.js';

class FakeCredentialRepository implements ProviderCredentialRepository {
  settings: ProviderSettingRecord[] = [];
  credentials: ProviderCredentialRecord[] = [];

  async listSettings() {
    return this.settings;
  }
  async listCredentials() {
    return this.credentials;
  }
  async setEnabled(provider: ProviderName, enabled: boolean) {
    this.settings = this.settings.filter((linha) => linha.provider !== provider);
    this.settings.push({ provider, enabled });
  }
  async saveKey(provider: ProviderName, kind: ProviderKeyKind, apiKeyCipher: string) {
    this.credentials = this.credentials.filter(
      (linha) => !(linha.provider === provider && linha.kind === kind),
    );
    this.credentials.push({ provider, kind, apiKeyCipher, updatedAt: new Date() });
  }
}

function contexto(role: 'ADMIN' | 'USER' = 'ADMIN'): TenantContext {
  return { accountId: 'acc', userId: 'user', role, membershipRole: 'OWNER', elevated: false };
}

function montar() {
  const repository = new FakeCredentialRepository();
  const reloads: ProviderName[] = [];
  const audits: Array<{ action: string; metadata: unknown }> = [];
  const forcedPaidCalls: boolean[] = [];
  let ultimaChamadaDeTeste: { provider: ProviderName; apiKey: string } | null = null;
  let resultadoDeTeste: ConnectionTestResult = { ok: true, message: 'ok' };

  const useCase = new ManageProviderCredentialsUseCase({
    repository,
    registry: {
      reload: async (provider) => {
        reloads.push(provider);
      },
      setGeminiForcedPaid: (value) => {
        forcedPaidCalls.push(value);
      },
    },
    cipher: {
      encrypt: (texto) => `cifrado:${texto}`,
      decrypt: (payload) => payload.replace(/^cifrado:/, ''),
    },
    testKey: async (provider, apiKey) => {
      ultimaChamadaDeTeste = { provider, apiKey };
      return resultadoDeTeste;
    },
    audit: {
      write: async (entry) => {
        audits.push({ action: entry.action, metadata: entry.metadata });
      },
    } as AuditWriter,
  });

  return {
    useCase,
    repository,
    reloads,
    audits,
    forcedPaidCalls,
    getUltimaChamadaDeTeste: () => ultimaChamadaDeTeste,
    setResultadoDeTeste: (valor: ConnectionTestResult) => {
      resultadoDeTeste = valor;
    },
  };
}

describe('ManageProviderCredentialsUseCase', () => {
  it('recusa quem não é ADMIN da plataforma', async () => {
    const { useCase } = montar();

    await expect(
      useCase.setEnabled(contexto('USER'), { provider: 'gemini', enabled: false }),
    ).rejects.toThrow(/administrador/);
  });

  it('liga/desliga, recarrega o registro e audita', async () => {
    const { useCase, repository, reloads, audits } = montar();

    await useCase.setEnabled(contexto(), { provider: 'anthropic', enabled: false });

    expect(repository.settings).toEqual([{ provider: 'anthropic', enabled: false }]);
    expect(reloads).toEqual(['anthropic']);
    expect(audits).toEqual([
      { action: 'ADMIN_PROVIDER_ENABLED_CHANGED', metadata: { enabled: false } },
    ]);
  });

  it('salva a chave CIFRADA — nunca em texto puro no repositório', async () => {
    const { useCase, repository, audits } = montar();

    await useCase.saveKey(contexto(), { provider: 'gemini', kind: 'FREE', apiKey: 'AIza-segredo' });

    expect(repository.credentials).toEqual([
      {
        provider: 'gemini',
        kind: 'FREE',
        apiKeyCipher: 'cifrado:AIza-segredo',
        updatedAt: expect.any(Date),
      },
    ]);
    // A chave em si NUNCA vai para o log de auditoria — só o que identifica qual mudou.
    expect(audits[0]?.metadata).toEqual({ kind: 'FREE' });
    expect(JSON.stringify(audits)).not.toContain('AIza-segredo');
  });

  it('recusa tipo de chave que o provider não aceita', async () => {
    const { useCase } = montar();

    await expect(
      useCase.saveKey(contexto(), { provider: 'openai', kind: 'PAID', apiKey: 'sk-teste' }),
    ).rejects.toThrow(/não é um tipo de chave válido/);
  });

  it('recusa chave vazia', async () => {
    const { useCase } = montar();

    await expect(
      useCase.saveKey(contexto(), { provider: 'gemini', kind: 'FREE', apiKey: '   ' }),
    ).rejects.toThrow(/vazia/);
  });

  it('testa a chave DO FORMULÁRIO sem gravar nada', async () => {
    const { useCase, repository, getUltimaChamadaDeTeste } = montar();

    const resultado = await useCase.testKey(contexto(), {
      provider: 'gemini',
      kind: 'FREE',
      apiKey: 'chave-do-formulario',
    });

    expect(resultado.ok).toBe(true);
    expect(getUltimaChamadaDeTeste()).toEqual({
      provider: 'gemini',
      apiKey: 'chave-do-formulario',
    });
    expect(repository.credentials).toEqual([]);
  });

  it('sem chave no formulário, testa a JÁ SALVA', async () => {
    const { useCase, repository, getUltimaChamadaDeTeste } = montar();
    repository.credentials.push({
      provider: 'gemini',
      kind: 'FREE',
      apiKeyCipher: 'cifrado:chave-salva',
      updatedAt: new Date(),
    });

    await useCase.testKey(contexto(), { provider: 'gemini', kind: 'FREE' });

    expect(getUltimaChamadaDeTeste()).toEqual({ provider: 'gemini', apiKey: 'chave-salva' });
  });

  it('sem chave no formulário e sem chave salva, avisa em vez de testar', async () => {
    const { useCase, getUltimaChamadaDeTeste } = montar();

    const resultado = await useCase.testKey(contexto(), { provider: 'gemini', kind: 'FREE' });

    expect(resultado).toEqual({ ok: false, message: 'Nenhuma chave cadastrada para testar.' });
    expect(getUltimaChamadaDeTeste()).toBeNull();
  });

  it('recusa forçar a chave paga para quem não é ADMIN', async () => {
    const { useCase } = montar();

    await expect(
      useCase.setGeminiForcedPaid(contexto('USER'), { forcedPaid: true }),
    ).rejects.toThrow(/administrador/);
  });

  it('força a chave paga no registro e audita — sem tocar no repositório', async () => {
    const { useCase, repository, forcedPaidCalls, audits } = montar();

    await useCase.setGeminiForcedPaid(contexto(), { forcedPaid: true });

    expect(forcedPaidCalls).toEqual([true]);
    expect(repository.settings).toEqual([]);
    expect(repository.credentials).toEqual([]);
    expect(audits).toEqual([
      { action: 'ADMIN_GEMINI_FORCED_PAID_CHANGED', metadata: { forcedPaid: true } },
    ]);
  });
});
