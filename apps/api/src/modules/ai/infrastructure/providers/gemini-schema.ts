/**
 * Adapta um JSON Schema (produzido pelo Zod) ao subconjunto que o Gemini aceita
 * em `responseJsonSchema`.
 *
 * O Gemini suporta um subconjunto restrito de JSON Schema. Palavras-chave que
 * ele não conhece fazem a API responder 400 INVALID_ARGUMENT — sem dizer qual
 * delas, o que torna o erro caro de diagnosticar.
 *
 * Traduzimos o que dá e DESCARTAMOS o resto. Descartar é seguro porque este
 * schema é apenas a DICA dada ao modelo: a resposta continua sendo validada
 * pelo Zod original, com todas as restrições intactas. Perdemos poder de
 * indução, nunca poder de validação.
 */

/** Aceitas pelo Gemini. Qualquer outra é removida. */
const SUPPORTED_KEYWORDS = new Set([
  'type',
  'format',
  'description',
  'nullable',
  'enum',
  'items',
  'properties',
  'required',
  'anyOf',
  'minItems',
  'maxItems',
  'propertyOrdering',
]);

/**
 * Acima disto, a união de objetos é achatada.
 *
 * Limite empírico: 4 membros passam, 6 recusam. Ficamos abaixo da borda medida
 * em vez de encostar nela — o limite é do serviço e pode apertar sem aviso.
 */
const MAX_ANY_OF_MEMBERS = 3;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Achata uma união de objetos num único objeto com a união das propriedades.
 *
 * Motivo medido, não suposto: o Gemini aceita `anyOf` com poucos membros, mas
 * recusa a união completa de mutações canônicas (6 membros) com
 * INVALID_ARGUMENT — e o número de tipos de mutação só cresce conforme novos
 * agregados versionados chegam.
 *
 * O que se perde: o schema deixa de EXIGIR o conjunto de campos certo para cada
 * `kind`. O que NÃO se perde: a validação real, que continua sendo a união
 * discriminada do Zod, do nosso lado. Para compensar a perda de indução,
 * geramos uma `description` que documenta quais campos pertencem a cada `kind` —
 * o modelo recebe a mesma informação, por outro canal.
 */
function flattenObjectUnion(members: Array<Record<string, unknown>>): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const requiredSets: Array<Set<string>> = [];
  const perKind: string[] = [];

  for (const member of members) {
    const memberProperties = isRecord(member['properties']) ? member['properties'] : {};
    const memberRequired = Array.isArray(member['required'])
      ? (member['required'] as string[])
      : [];

    requiredSets.push(new Set(memberRequired));

    for (const [name, propertySchema] of Object.entries(memberProperties)) {
      const existing = properties[name];

      // O discriminador aparece em todos os membros com um valor diferente:
      // unimos os valores num enum só, senão só o primeiro sobreviveria.
      if (isRecord(existing) && Array.isArray(existing['enum']) && isRecord(propertySchema)) {
        const incoming = Array.isArray(propertySchema['enum']) ? propertySchema['enum'] : [];
        existing['enum'] = [...new Set([...(existing['enum'] as unknown[]), ...incoming])];
        continue;
      }

      properties[name] ??= propertySchema;
    }

    const discriminator = isRecord(memberProperties['kind'])
      ? ((memberProperties['kind']['enum'] as unknown[] | undefined)?.[0] ?? '?')
      : '?';
    const fields = Object.keys(memberProperties).filter((name) => name !== 'kind');
    perKind.push(`${String(discriminator)}: ${fields.join(', ') || '(sem campos)'}`);
  }

  // Só o que TODO membro exige pode ser exigido do objeto achatado.
  const required = [...(requiredSets[0] ?? [])].filter((name) =>
    requiredSets.every((set) => set.has(name)),
  );

  const { flat, nested } = simplifyForUnion(properties);

  return {
    type: 'object',
    description: [
      `Campos válidos por "kind" — use apenas os do kind escolhido. ${perKind.join(' | ')}`,
      nested.length > 0
        ? `Campos estruturados, omitidos do schema mas ACEITOS: ${nested.join('; ')}.`
        : '',
    ]
      .filter(Boolean)
      .join(' '),
    properties: flat,
    required,
  };
}

/**
 * Tira estrutura ANINHADA de dentro da união achatada.
 *
 * Medido contra a API real, com o schema de criação de agente: um objeto
 * achatado com 18 propriedades planas é ACEITO; o mesmo objeto com 20, sendo
 * uma delas um objeto aninhado e outra um array, é recusado com
 * INVALID_ARGUMENT. Não é a contagem que pesa — é a profundidade dentro de um
 * item de array.
 *
 * O que se ganha é grande: com o schema aceito, a decodificação passa a ser
 * RESTRITA, e o modelo fisicamente não consegue omitir campo obrigatório. Sem
 * isso toda operação caía em JSON mode, onde omitir `identity` é possível — e
 * era o que acontecia, custando 118s de geração recusada por turno.
 *
 * O que se perde é pequeno e recuperável: o campo aninhado sai do schema, mas
 * continua descrito na `description` e continua ACEITO pelo Zod. Perdemos
 * indução sobre um campo acessório, nunca validação.
 */
function simplifyForUnion(properties: Record<string, unknown>): {
  flat: Record<string, unknown>;
  nested: string[];
} {
  const flat: Record<string, unknown> = {};
  const nested: string[] = [];

  for (const [name, schema] of Object.entries(properties)) {
    if (!isRecord(schema)) {
      flat[name] = schema;
      continue;
    }

    if (schema['type'] === 'object' && isRecord(schema['properties'])) {
      nested.push(`${name} (objeto: ${Object.keys(schema['properties']).join(', ')})`);
      continue;
    }

    if (schema['type'] === 'array') {
      const items = isRecord(schema['items']) ? schema['items'] : null;
      // Array de string sobrevive: é raso e o Gemini aceita. Array de objeto,
      // dentro de um item de array, é a profundidade que ele recusa.
      if (items && items['type'] === 'string') {
        flat[name] = schema;
        continue;
      }
      nested.push(`${name} (lista)`);
      continue;
    }

    flat[name] = schema;
  }

  return { flat, nested };
}

/**
 * Teto de complexidade acima do qual não vale tentar decodificação restrita.
 *
 * RECALIBRADO contra a API real. A medição anterior (10) era conservadora
 * demais por confundir duas coisas: o limite observado era sobre as
 * propriedades de UM objeto achatado, e `schemaComplexity` conta tudo
 * recursivamente. O efeito colateral foi caro — com o teto em 10, NENHUMA
 * operação do OS cabia, e todas rodavam em JSON mode, onde omitir um campo
 * obrigatório é possível.
 *
 * Medido agora, com o schema de criação de agente: 18 propriedades planas num
 * item de array são ACEITAS, mas a união achatada real continua sendo recusada
 * mesmo depois de `simplifyForUnion` — a borda não é só contagem, e medir com
 * precisão exige um provider estável, que não é o caso hoje.
 *
 * Por isso o teto continua conservador. Subi-lo é seguro AGORA que a recusa de
 * schema tem queda para JSON mode (ver `generateStructured`): o custo de errar
 * virou uma requisição perdida, não a operação inteira.
 *
 * A margem continua de propósito: o limite é do serviço e pode apertar sem
 * aviso. Se o schema for recusado mesmo assim, o adapter cai em JSON mode
 * sozinho, sem derrubar a operação.
 */
const MAX_TOTAL_PROPERTIES = 10;

/** Conta propriedades recursivamente, para decidir se o schema cabe. */
export function schemaComplexity(schema: unknown): number {
  if (Array.isArray(schema)) {
    return schema.reduce<number>((total, item) => total + schemaComplexity(item), 0);
  }
  if (!isRecord(schema)) return 0;

  let total = 0;
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'properties' && isRecord(value)) {
      total += Object.keys(value).length;
      for (const property of Object.values(value)) total += schemaComplexity(property);
      continue;
    }
    if (isRecord(value) || Array.isArray(value)) total += schemaComplexity(value);
  }
  return total;
}

/** True quando vale a pena tentar decodificação restrita pelo provider. */
export function fitsGeminiSchemaLimits(schema: unknown): boolean {
  return schemaComplexity(schema) <= MAX_TOTAL_PROPERTIES;
}

export function toGeminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (!isRecord(schema)) return schema;

  const output: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(schema)) {
    // `oneOf` é semanticamente mais estrito que `anyOf` (exatamente um deve
    // casar), mas o Gemini só entende `anyOf`. Para uma união discriminada o
    // efeito prático é o mesmo: o discriminador já garante exclusividade.
    if (key === 'oneOf' || key === 'anyOf') {
      const members = Array.isArray(value) ? value.map(toGeminiSchema) : [];
      const objectMembers = members.filter(
        (member): member is Record<string, unknown> =>
          isRecord(member) && member['type'] === 'object',
      );

      // União grande de objetos: achata. Pequena ou heterogênea: mantém `anyOf`,
      // que o Gemini suporta e induz melhor.
      if (objectMembers.length === members.length && members.length > MAX_ANY_OF_MEMBERS) {
        return flattenObjectUnion(objectMembers);
      }

      output['anyOf'] = members;
      continue;
    }

    // `const: "X"` vira `enum: ["X"]` — é como o Gemini expressa valor fixo, e
    // é o que preserva o discriminador da união.
    if (key === 'const') {
      output['enum'] = [value];
      if (typeof value === 'string') output['type'] = 'string';
      continue;
    }

    if (!SUPPORTED_KEYWORDS.has(key)) continue;

    // `properties` é um MAPA de nome → schema, não um schema. Filtrar suas
    // chaves pela allowlist apagaria os nomes das propriedades — que foi
    // exatamente o bug que este comentário existe para não repetir.
    if (key === 'properties' && isRecord(value)) {
      output[key] = Object.fromEntries(
        Object.entries(value).map(([name, propertySchema]) => [
          name,
          toGeminiSchema(propertySchema),
        ]),
      );
      continue;
    }

    // `required` e `enum` são listas de valores literais, não de schemas.
    if (key === 'required' || key === 'enum') {
      output[key] = value;
      continue;
    }

    output[key] = isRecord(value) || Array.isArray(value) ? toGeminiSchema(value) : value;
  }

  // Um objeto sem `properties` não diz nada ao modelo e o Gemini rejeita;
  // marcá-lo como string livre é degradação honesta.
  if (output['type'] === 'object' && !output['properties']) {
    return { type: 'string' };
  }

  return output;
}
