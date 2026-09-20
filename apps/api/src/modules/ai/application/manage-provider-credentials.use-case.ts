import { PROVIDER_KEY_SLOTS, type ProviderKeyKind, type ProviderName } from '@myaihub/shared';
import type { AuditWriter } from '../../../shared/application/ports.js';
import type { TenantContext } from '../../../shared/application/tenant-context.js';
import { AppError } from '../../../shared/domain/errors.js';
import type {
  ConnectionTestResult,
  CredentialCipherPort,
  ProviderCredentialRepository,
  ProviderRegistryPort,
  TestProviderKey,
} from './provider-credentials.js';

/**
 * Gerenciar provider: ligar/desligar, trocar chave, testar — tudo do ADMIN da
 * plataforma, pela mesma razão de `ChangeModelRouteUseCase`: afeta a fatura e
 * o funcionamento de TODAS as contas, nunca uma decisão de conta.
 *
 * Cada escrita termina em `registry.reload(provider)` — é o que faz a tela
 * valer no próximo turno, sem reiniciar nada, do mesmo jeito que
 * `ModelRouteStore` já faz para a escolha de modelo.
 */
export class ManageProviderCredentialsUseCase {
  constructor(
    private readonly deps: {
      repository: ProviderCredentialRepository;
      registry: ProviderRegistryPort;
      cipher: CredentialCipherPort;
      testKey: TestProviderKey;
      audit: AuditWriter;
    },
  ) {}

  private requireAdmin(context: TenantContext): void {
    if (context.role !== 'ADMIN') {
      throw new AppError('FORBIDDEN', 'Só o administrador da plataforma gerencia provedores.', {
        httpStatus: 403,
      });
    }
  }

  private requireKind(provider: ProviderName, kind: string): asserts kind is ProviderKeyKind {
    const aceitos = PROVIDER_KEY_SLOTS[provider].map((slot) => slot.kind);
    if (!aceitos.includes(kind as ProviderKeyKind)) {
      throw new AppError(
        'VALIDATION_ERROR',
        `"${kind}" não é um tipo de chave válido para ${provider}. Aceitos: ${aceitos.join(', ') || 'nenhum'}.`,
        { httpStatus: 422 },
      );
    }
  }

  async setEnabled(
    context: TenantContext,
    input: { provider: ProviderName; enabled: boolean },
  ): Promise<void> {
    this.requireAdmin(context);

    await this.deps.repository.setEnabled(input.provider, input.enabled, context.userId ?? '');
    await this.deps.registry.reload(input.provider);

    await this.deps.audit.write({
      accountId: context.accountId,
      actorUserId: context.userId,
      action: 'ADMIN_PROVIDER_ENABLED_CHANGED',
      entityType: 'AI_PROVIDER',
      entityId: input.provider,
      metadata: { enabled: input.enabled },
    });
  }

  async saveKey(
    context: TenantContext,
    input: { provider: ProviderName; kind: string; apiKey: string },
  ): Promise<void> {
    this.requireAdmin(context);
    this.requireKind(input.provider, input.kind);

    const apiKey = input.apiKey.trim();
    if (!apiKey) {
      throw new AppError('VALIDATION_ERROR', 'A chave não pode ser vazia.', { httpStatus: 422 });
    }

    await this.deps.repository.saveKey(
      input.provider,
      input.kind,
      this.deps.cipher.encrypt(apiKey),
      context.userId ?? '',
    );
    await this.deps.registry.reload(input.provider);

    await this.deps.audit.write({
      accountId: context.accountId,
      actorUserId: context.userId,
      action: 'ADMIN_PROVIDER_KEY_SAVED',
      entityType: 'AI_PROVIDER',
      entityId: input.provider,
      // NUNCA a chave em si — só o que identifica QUAL chave mudou.
      metadata: { kind: input.kind },
    });
  }

  /**
   * A ESCOLHA de usar a chave paga do Gemini mesmo com a gratuita disponível.
   *
   * Não é o mesmo caso de `setEnabled`/`saveKey`: não muda nenhuma chave nem
   * passa pelo repositório — é uma preferência de RUNTIME, aplicada direto na
   * instância viva. Ainda assim é auditada: é a mesma classe de decisão que
   * muda de qual bolso a conta sai, e isso não pode ser silencioso.
   */
  async setGeminiForcedPaid(context: TenantContext, input: { forcedPaid: boolean }): Promise<void> {
    this.requireAdmin(context);

    this.deps.registry.setGeminiForcedPaid(input.forcedPaid);

    await this.deps.audit.write({
      accountId: context.accountId,
      actorUserId: context.userId,
      action: 'ADMIN_GEMINI_FORCED_PAID_CHANGED',
      entityType: 'AI_PROVIDER',
      entityId: 'gemini',
      metadata: { forcedPaid: input.forcedPaid },
    });
  }

  /**
   * Testa uma chave — a que está no formulário, ou a já salva quando o admin
   * não digitou nada novo. Não grava nada: é só "isto funciona?".
   */
  async testKey(
    context: TenantContext,
    input: { provider: ProviderName; kind: string; apiKey?: string },
  ): Promise<ConnectionTestResult> {
    this.requireAdmin(context);
    this.requireKind(input.provider, input.kind);

    let apiKey = input.apiKey?.trim();
    if (!apiKey) {
      const salvas = await this.deps.repository.listCredentials();
      const existente = salvas.find(
        (linha) => linha.provider === input.provider && linha.kind === input.kind,
      );
      if (!existente) {
        return { ok: false, message: 'Nenhuma chave cadastrada para testar.' };
      }
      apiKey = this.deps.cipher.decrypt(existente.apiKeyCipher);
    }

    return this.deps.testKey(input.provider, apiKey);
  }
}
