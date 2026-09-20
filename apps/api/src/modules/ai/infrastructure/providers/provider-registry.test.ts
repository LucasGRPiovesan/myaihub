import { describe, expect, it } from 'vitest';
import type { ProviderKeyKind, ProviderName } from '@myaihub/shared';
import { GeminiProvider } from './gemini-provider.js';
import { UnavailableProvider } from './unavailable-provider.js';
import { ProviderRegistry } from './provider-registry.js';
import type {
  ProviderCredentialRecord,
  ProviderCredentialRepository,
  ProviderSettingRecord,
} from '../../application/provider-credentials.js';

/** Dublê fiel ao contrato: mesmo formato de dado, sem banco por trás. */
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

/** Cifra de mentira: reversível e visível, só para o teste conferir o que foi guardado. */
const cipherFake = {
  encrypt: (texto: string) => `cifrado:${texto}`,
  decrypt: (payload: string) => payload.replace(/^cifrado:/, ''),
};

function registry(repository: FakeCredentialRepository) {
  return new ProviderRegistry({
    repository,
    cipher: cipherFake,
    envDefaults: {},
    logger: { info: () => undefined, warn: () => undefined } as never,
    onGeminiRetry: () => undefined,
    onGeminiKeySwitch: () => undefined,
    isTestEnvironment: false,
  });
}

describe('ProviderRegistry', () => {
  it('semeia da .env só quando o banco está VAZIO', async () => {
    const repo = new FakeCredentialRepository();
    const reg = new ProviderRegistry({
      repository: repo,
      cipher: cipherFake,
      envDefaults: { gemini: { FREE: 'chave-da-env' } },
      logger: { info: () => undefined, warn: () => undefined } as never,
      onGeminiRetry: () => undefined,
      onGeminiKeySwitch: () => undefined,
      isTestEnvironment: false,
    });

    await reg.load();

    expect(repo.credentials).toEqual([
      {
        provider: 'gemini',
        kind: 'FREE',
        apiKeyCipher: 'cifrado:chave-da-env',
        updatedAt: expect.any(Date),
      },
    ]);
  });

  it('NÃO semeia de novo quando já existe QUALQUER credencial — o banco manda', async () => {
    const repo = new FakeCredentialRepository();
    repo.credentials.push({
      provider: 'gemini',
      kind: 'FREE',
      apiKeyCipher: 'cifrado:chave-que-o-admin-trocou',
      updatedAt: new Date(),
    });

    const reg = new ProviderRegistry({
      repository: repo,
      cipher: cipherFake,
      envDefaults: { gemini: { FREE: 'chave-da-env-antiga' } },
      logger: { info: () => undefined, warn: () => undefined } as never,
      onGeminiRetry: () => undefined,
      onGeminiKeySwitch: () => undefined,
      isTestEnvironment: false,
    });

    await reg.load();

    expect(repo.credentials).toHaveLength(1);
    expect(repo.credentials[0]?.apiKeyCipher).toBe('cifrado:chave-que-o-admin-trocou');
  });

  it('gemini com chave gratuita cadastrada vira GeminiProvider disponível', async () => {
    const repo = new FakeCredentialRepository();
    repo.credentials.push({
      provider: 'gemini',
      kind: 'FREE',
      apiKeyCipher: 'cifrado:AIza-teste',
      updatedAt: new Date(),
    });

    const reg = registry(repo);
    await reg.load();

    const provider = reg.providers.get('gemini');
    expect(provider).toBeInstanceOf(GeminiProvider);
    expect(provider?.available).toBe(true);
  });

  /*
   * INVARIANTE 8: nenhum teste consome API paga. Com `isTestEnvironment: true`
   * — o que `container.ts` passa quando `NODE_ENV=test` —, o Gemini NUNCA vira
   * uma instância real, mesmo com chave gratuita válida no banco.
   */
  it('em AMBIENTE DE TESTE, gemini nunca vira instância real — mesmo com chave válida', async () => {
    const repo = new FakeCredentialRepository();
    repo.credentials.push({
      provider: 'gemini',
      kind: 'FREE',
      apiKeyCipher: 'cifrado:AIza-teste',
      updatedAt: new Date(),
    });

    const reg = new ProviderRegistry({
      repository: repo,
      cipher: cipherFake,
      envDefaults: {},
      logger: { info: () => undefined, warn: () => undefined } as never,
      onGeminiRetry: () => undefined,
      onGeminiKeySwitch: () => undefined,
      isTestEnvironment: true,
    });
    await reg.load();

    expect(reg.providers.get('gemini')).toBeInstanceOf(UnavailableProvider);
  });

  it('gemini SEM chave cadastrada fica indisponível, com motivo claro', async () => {
    const reg = registry(new FakeCredentialRepository());
    await reg.load();

    const provider = reg.providers.get('gemini');
    expect(provider).toBeInstanceOf(UnavailableProvider);
    expect(provider?.available).toBe(false);
  });

  it('provider DESLIGADO pelo admin fica indisponível mesmo com chave válida', async () => {
    const repo = new FakeCredentialRepository();
    repo.credentials.push({
      provider: 'gemini',
      kind: 'FREE',
      apiKeyCipher: 'cifrado:AIza-teste',
      updatedAt: new Date(),
    });
    repo.settings.push({ provider: 'gemini', enabled: false });

    const reg = registry(repo);
    await reg.load();

    expect(reg.providers.get('gemini')).toBeInstanceOf(UnavailableProvider);
  });

  /*
   * OpenAI e Anthropic: a chave pode ser cadastrada e testada de verdade, mas
   * o adaptador de geração não existe ainda — continuam indisponíveis, e a
   * mensagem tem que dizer QUAL dos dois motivos é.
   */
  it('openai com chave cadastrada continua indisponível — falta o adaptador, não a chave', async () => {
    const repo = new FakeCredentialRepository();
    repo.credentials.push({
      provider: 'openai',
      kind: 'DEFAULT',
      apiKeyCipher: 'cifrado:sk-teste',
      updatedAt: new Date(),
    });

    const reg = registry(repo);
    await reg.load();

    const provider = reg.providers.get('openai');
    expect(provider?.available).toBe(false);
    await expect(provider?.generate({} as never)).rejects.toThrow(/adaptador/);
  });

  it('reload() troca só o provider pedido, na MESMA instância de Map', async () => {
    const repo = new FakeCredentialRepository();
    const reg = registry(repo);
    await reg.load();

    const mapaOriginal = reg.providers;
    const openaiAntes = reg.providers.get('openai');

    repo.credentials.push({
      provider: 'gemini',
      kind: 'FREE',
      apiKeyCipher: 'cifrado:nova-chave',
      updatedAt: new Date(),
    });
    await reg.reload('gemini');

    expect(reg.providers).toBe(mapaOriginal);
    expect(reg.providers.get('gemini')).toBeInstanceOf(GeminiProvider);
    // openai não foi tocado pelo reload de 'gemini'.
    expect(reg.providers.get('openai')).toBe(openaiAntes);
  });

  it('setGeminiForcedPaid() aplica na instância JÁ VIVA, sem tocar o repositório', async () => {
    const repo = new FakeCredentialRepository();
    repo.credentials.push(
      { provider: 'gemini', kind: 'FREE', apiKeyCipher: 'cifrado:livre', updatedAt: new Date() },
      { provider: 'gemini', kind: 'PAID', apiKeyCipher: 'cifrado:paga', updatedAt: new Date() },
    );
    const reg = registry(repo);
    await reg.load();
    const chamadasAoBanco = repo.listCredentials;
    let contagem = 0;
    repo.listCredentials = async () => {
      contagem += 1;
      return chamadasAoBanco.call(repo);
    };

    reg.setGeminiForcedPaid(true);

    const provider = reg.providers.get('gemini');
    expect(provider).toBeInstanceOf(GeminiProvider);
    expect((provider as GeminiProvider).keyStatus().forcedPaid).toBe(true);
    expect(contagem).toBe(0);
  });

  it('setGeminiForcedPaid() SOBREVIVE a um reload disparado por troca de chave', async () => {
    const repo = new FakeCredentialRepository();
    repo.credentials.push(
      { provider: 'gemini', kind: 'FREE', apiKeyCipher: 'cifrado:livre', updatedAt: new Date() },
      { provider: 'gemini', kind: 'PAID', apiKeyCipher: 'cifrado:paga', updatedAt: new Date() },
    );
    const reg = registry(repo);
    await reg.load();
    reg.setGeminiForcedPaid(true);

    // Troca a chave gratuita — o GeminiProvider é RECONSTRUÍDO do zero aqui,
    // e a preferência não vive dentro dele: se ela se perdesse, a força
    // desligaria em silêncio por um ajuste que não tem nada a ver com ela.
    repo.credentials = repo.credentials.filter((linha) => linha.kind !== 'FREE');
    repo.credentials.push({
      provider: 'gemini',
      kind: 'FREE',
      apiKeyCipher: 'cifrado:livre-nova',
      updatedAt: new Date(),
    });
    await reg.reload('gemini');

    const provider = reg.providers.get('gemini');
    expect((provider as GeminiProvider).keyStatus().forcedPaid).toBe(true);
  });
});
