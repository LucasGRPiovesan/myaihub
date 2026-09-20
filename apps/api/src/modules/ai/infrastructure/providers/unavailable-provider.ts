import type { ProviderName } from '@myaihub/shared';
import type { ZodType } from 'zod';
import { AppError } from '../../../../shared/domain/errors.js';
import type {
  LlmChunk,
  LlmProvider,
  LlmRequest,
  LlmResult,
  ProviderCapabilities,
} from '../../domain/provider.js';

/**
 * Provider registrado porém sem chave.
 *
 * Existe para que a ausência de credencial seja um erro CLARO no ponto de uso,
 * e não um provider faltando no mapa (que viraria "provider desconhecido") nem
 * uma exceção no boot. O sistema sobe com Gemini configurado e OpenAI/Anthropic
 * vazios — que é exatamente o estado atual do projeto (§10).
 */
export class UnavailableProvider implements LlmProvider {
  readonly available = false;

  /**
   * O MOTIVO virou parâmetro livre, e não mais "a variável que falta".
   *
   * A chave deixou de vir só da env — agora pode faltar, ter sido DESLIGADA
   * pelo admin, ou (caso de OpenAI/Anthropic) estar cadastrada e testada e
   * ainda assim indisponível porque o adaptador de geração não existe. Três
   * motivos diferentes, uma mensagem genérica "defina a variável" mentiria nos
   * outros dois.
   */
  constructor(
    readonly name: ProviderName,
    private readonly reason: string,
  ) {}

  capabilities(): ProviderCapabilities {
    return {
      caching: false,
      structuredOutput: false,
      reasoning: false,
      vision: false,
      streaming: false,
    };
  }

  private fail(): never {
    throw new AppError(
      'PROVIDER_NOT_CONFIGURED',
      `O provider "${this.name}" não está disponível: ${this.reason}`,
      { httpStatus: 503 },
    );
  }

  async generate(_request: LlmRequest): Promise<LlmResult<string>> {
    this.fail();
  }

  // eslint-disable-next-line require-yield
  async *stream(_request: LlmRequest): AsyncIterable<LlmChunk> {
    this.fail();
  }

  async generateStructured<T>(_request: LlmRequest, _schema: ZodType<T>): Promise<LlmResult<T>> {
    this.fail();
  }
}
