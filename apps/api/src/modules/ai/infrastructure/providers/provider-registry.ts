import type { ProviderKeyKind, ProviderName } from '@myaihub/shared';
import type { Logger } from '../../../../shared/application/ports.js';
import type { LlmProvider } from '../../domain/provider.js';
import type {
  CredentialCipherPort,
  ProviderCredentialRepository,
} from '../../application/provider-credentials.js';
import { FakeProvider } from './fake-provider.js';
import { GeminiProvider, type RetryNotice } from './gemini-provider.js';
import { UnavailableProvider } from './unavailable-provider.js';
import type { KeyTier } from './gemini-keys.js';

const PROVIDERS_COM_CHAVE: ProviderName[] = ['gemini', 'openai', 'anthropic'];

/**
 * O registro de providers, LIGADO À TELA — não mais só ao boot.
 *
 * Substitui `createProviders()`. Antes, o mapa de providers era montado UMA
 * vez, a partir da `.env`, e só mudava reiniciando o processo. Agora o admin
 * troca chave e liga/desliga provider por uma tela, e a MESMA razão que já
 * fez `ModelRouteStore` virar "recarrega a cada escrita" vale aqui: uma tela
 * de gerenciamento que só funciona depois de reiniciar não gerencia nada.
 *
 * ========== A MESMA Map, NUNCA SUBSTITUÍDA — SÓ MUTADA ==========
 *
 * `ModelRouter`, os use cases e as rotas guardam a REFERÊNCIA deste Map, obtida
 * uma vez no boot (`registry.providers`). Se `reload()` criasse um Map novo,
 * essas referências ficariam presas ao mapa velho — o mesmo bug de fechamento
 * que `container.ts` já tinha com `geminiProvider` capturado à parte (corrigido
 * junto com isto: a rota de cota lê o provider por `providers.get('gemini')` a
 * cada chamada, nunca uma referência guardada). `reload()` faz `.set()` na
 * mesma instância — quem já tem a referência enxerga a troca sem fazer nada.
 *
 * ========== OPENAI E ANTHROPIC: CHAVE GERENCIÁVEL, GERAÇÃO AINDA NÃO ========
 *
 * Só o Gemini tem adaptador de geração implementado. Uma chave de OpenAI ou
 * Anthropic pode ser cadastrada e TESTADA de verdade (`test-connection.ts`),
 * mas o provider continua `UnavailableProvider` — a mensagem diz que a chave
 * existe e o que falta é o adaptador, para não confundir "sem chave" com
 * "sem código". Apontar um papel para eles continua recusado em
 * `ChangeModelRouteUseCase`, que já checa `available`.
 */
export class ProviderRegistry {
  readonly providers = new Map<ProviderName, LlmProvider>();

  /**
   * A ESCOLHA do admin de forçar a chave paga do Gemini — sobrevive a um
   * `reload()` por troca de CHAVE, porque o `GeminiProvider` é reconstruído do
   * zero ali e perderia a preferência se ela vivesse só dentro dele. Não
   * sobrevive a um RESTART do processo — a mesma classe de estado efêmero que
   * `freeBlockedUntil` já é, e persistir pediria uma tabela para uma escolha
   * que se refaz num clique.
   */
  private geminiForcedPaid = false;

  constructor(
    private readonly deps: {
      repository: ProviderCredentialRepository;
      cipher: CredentialCipherPort;
      /** O que a `.env` já tinha — usado só para SEMEAR o banco, uma vez. */
      envDefaults: Partial<Record<ProviderName, Partial<Record<ProviderKeyKind, string>>>>;
      logger: Logger;
      onGeminiRetry: (notice: RetryNotice) => void;
      onGeminiKeySwitch: (notice: { tier: KeyTier; until: Date | null; reason: string }) => void;
      /**
       * INVARIANTE 8: nenhum teste consome API paga. `true` faz o Gemini
       * NUNCA ser instanciado de verdade, mesmo com chave válida no banco —
       * a suíte sobe com o `FakeProvider` de propósito. Injetado (não lido
       * direto de `isTest` da env) porque um teste desta própria classe
       * precisa poder afirmar as duas coisas: como ela se comporta em teste,
       * e como se comporta fora dele — e um import de módulo fixo não dá
       * escolha nenhuma a quem testa.
       */
      isTestEnvironment: boolean;
    },
  ) {
    this.providers.set('fake', new FakeProvider());
  }

  /** Semeia o banco a partir da `.env`, SÓ quando ele ainda não tem nenhuma chave — e monta o mapa. */
  async load(): Promise<void> {
    await this.seedFromEnvOnce();
    await this.rebuildAll();
  }

  /**
   * A semeadura é ADITIVA e de UMA VEZ, como a Master Policy: se já existe
   * QUALQUER credencial no banco, o admin já abriu a tela e o banco manda —
   * reseedar por cima apagaria uma chave que ele trocou de propósito.
   */
  private async seedFromEnvOnce(): Promise<void> {
    const existentes = await this.deps.repository.listCredentials();
    if (existentes.length > 0) return;

    for (const provider of PROVIDERS_COM_CHAVE) {
      const porTipo = this.deps.envDefaults[provider];
      if (!porTipo) continue;

      for (const [kind, valor] of Object.entries(porTipo) as Array<[ProviderKeyKind, string]>) {
        if (!valor) continue;
        await this.deps.repository.saveKey(provider, kind, this.deps.cipher.encrypt(valor), null);
      }
    }

    this.deps.logger.info({}, 'credenciais de provider semeadas da .env (primeiro boot)');
  }

  /** Reconstrói TODOS os providers a partir do banco — usado no boot. */
  async rebuildAll(): Promise<void> {
    const [settings, credenciais] = await Promise.all([
      this.deps.repository.listSettings(),
      this.deps.repository.listCredentials(),
    ]);

    for (const provider of PROVIDERS_COM_CHAVE) {
      this.montar(provider, settings, credenciais);
    }
  }

  /** Reconstrói só UM provider — chamado depois de cada escrita do admin. */
  async reload(provider: ProviderName): Promise<void> {
    const [settings, credenciais] = await Promise.all([
      this.deps.repository.listSettings(),
      this.deps.repository.listCredentials(),
    ]);
    this.montar(provider, settings, credenciais);
  }

  /**
   * A escolha do admin: usar a chave PAGA do Gemini mesmo com a gratuita de
   * pé. Aplica na instância JÁ VIVA — não passa por `reload()`, que refaria a
   * chamada ao banco à toa para uma preferência que não mexe em chave nenhuma.
   */
  setGeminiForcedPaid(value: boolean): void {
    this.geminiForcedPaid = value;
    const provider = this.providers.get('gemini');
    if (provider instanceof GeminiProvider) provider.setForcedPaid(value);
  }

  private montar(
    provider: ProviderName,
    settings: Array<{ provider: ProviderName; enabled: boolean }>,
    credenciais: Array<{ provider: ProviderName; kind: ProviderKeyKind; apiKeyCipher: string }>,
  ): void {
    const ligado = settings.find((linha) => linha.provider === provider)?.enabled ?? true;
    if (!ligado) {
      this.providers.set(provider, new UnavailableProvider(provider, 'desativado pelo admin.'));
      return;
    }

    const doProvider = credenciais.filter((linha) => linha.provider === provider);

    // INVARIANTE 8: nenhum teste consome API paga. Em `NODE_ENV=test`, o
    // Gemini NUNCA é instanciado de verdade, mesmo com chave válida no banco
    // — a suíte sobe com o `FakeProvider` de propósito, e a suíte de HTTP
    // (`getTestApp()`) usa este MESMO `createContainer()`. A guarda existia em
    // `createProviders()` e precisa sobreviver a esta reescrita inteira.
    if (provider === 'gemini' && this.deps.isTestEnvironment) {
      this.providers.set(provider, new UnavailableProvider(provider, 'ambiente de teste.'));
      return;
    }

    if (provider === 'gemini') {
      const livre = doProvider.find((linha) => linha.kind === 'FREE');
      const paga = doProvider.find((linha) => linha.kind === 'PAID');

      if (!livre) {
        this.providers.set(
          provider,
          new UnavailableProvider(provider, 'nenhuma chave cadastrada. Cadastre em Provedores.'),
        );
        return;
      }

      const instancia = new GeminiProvider(this.deps.cipher.decrypt(livre.apiKeyCipher), {
        onRetry: this.deps.onGeminiRetry,
        ...(paga ? { paidApiKey: this.deps.cipher.decrypt(paga.apiKeyCipher) } : {}),
        onKeySwitch: this.deps.onGeminiKeySwitch,
      });
      // Reaplica a escolha do admin numa instância NOVA — sem isto, trocar a
      // chave gratuita (que não tem nada a ver com a escolha de forçar a paga)
      // desligaria a força em silêncio.
      instancia.setForcedPaid(this.geminiForcedPaid);
      this.providers.set(provider, instancia);
      return;
    }

    // openai / anthropic: chave gerenciável, geração ainda não implementada.
    const chave = doProvider.find((linha) => linha.kind === 'DEFAULT');
    this.providers.set(
      provider,
      new UnavailableProvider(
        provider,
        chave
          ? 'a chave está cadastrada, mas este provider ainda não tem o adaptador de geração implementado.'
          : 'nenhuma chave cadastrada. Cadastre em Provedores.',
      ),
    );
  }
}
