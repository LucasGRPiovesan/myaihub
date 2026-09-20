import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getOperation } from './operation.js';
import { SYSTEM_ACTIONS } from './system-action.js';

/**
 * A FRONTEIRA DO S.O É A FRONTEIRA DO SISTEMA — e isto a mantém.
 *
 * Toda rota que ESCREVE precisa dizer como o S.O faz a mesma coisa: por uma
 * ação, por uma operação, ou por que não se aplica. Sem isto, a próxima tela
 * nova nasceria com um botão que o S.O não alcança, e o usuário descobriria
 * pedindo — ele responderia explicando onde clicar, que foi exatamente o caso
 * que motivou as ações do sistema.
 */

type Cobertura = { action: string } | { operation: string } | { exempt: string };

const COBERTURA: Record<string, Cobertura> = {
  // Conta e sessão: é o usuário entrando, não o sistema sendo operado.
  'POST /auth/register': { exempt: 'cadastro acontece antes de existir S.O' },
  'POST /auth/login': { exempt: 'sessão' },
  'POST /auth/refresh': { exempt: 'sessão' },
  'POST /auth/logout': { exempt: 'sessão' },

  // O próprio painel e o chat público são o CANAL, não uma ação sobre algo.
  'POST /hub/conversations': { exempt: 'é o painel do S.O' },
  'POST /hub/conversations/:id/messages': { exempt: 'é o painel do S.O' },
  'POST /public/:publicId/opening': { exempt: 'canal do visitante' },
  'POST /public/:publicId/messages': { exempt: 'canal do visitante' },
  'POST /media': { exempt: 'anexo colado no painel — o S.O já recebe a imagem' },

  // O Lab é a conversa de TESTE do usuário com o agente; o S.O lê o transcrito dela.
  'POST /agents/:id/test': { exempt: 'Lab: conversa do usuário com o agente' },
  'POST /agents/:id/opening': { exempt: 'Lab: abertura da conversa de teste' },
  'POST /agents/briefing': { operation: 'agent.create' },

  'PUT /campaigns/:id/agent': { action: 'campaign.bind_agent' },
  'POST /campaigns/:id/deployments': { action: 'campaign.publish' },
  'DELETE /agents/:id': { action: 'agent.delete' },
  'POST /agents/:id/sync-craft': { action: 'agent.sync_craft' },

  'POST /projects/:id/brand/mutations': { operation: 'project.refine_brand' },
  'POST /projects/:id/knowledge': { action: 'knowledge.add_url' },
  'POST /projects/:id/knowledge/:sourceId/reindex': { action: 'knowledge.reindex' },
  'PUT /projects/:id/knowledge/:sourceId': { action: 'knowledge.replace_text' },
  'DELETE /projects/:id/knowledge/:sourceId': { action: 'knowledge.remove' },

  'PUT /admin/models/:role': { action: 'model.set_route' },
  'PUT /admin/playbooks/:key': { operation: 'playbook.refine' },
  'POST /admin/playbooks/:key/revise': { operation: 'playbook.refine' },
  'POST /admin/playbooks/distill': { operation: 'playbook.create' },
  // A pauta é sobre o PRÓPRIO S.O: quem a resolve é quem corrige o MyAIHub.
  'POST /admin/support/limitations/:id/resolve': { exempt: 'pauta sobre o próprio S.O' },

  // Chave de API não deve trafegar pelo canal do S.O de jeito nenhum — é
  // segredo, e o chat é lido por um modelo e persistido no transcrito. Ligar
  // ou desligar um provider fica pela mesma tela, por simetria com a chave —
  // não é o mesmo caso de `model.set_route`, que não expõe segredo nenhum.
  'PATCH /admin/providers/:provider': { exempt: 'gestão de provedor é tela do admin, não S.O' },
  'PATCH /admin/providers/gemini/force-paid': {
    exempt: 'gestão de provedor é tela do admin, não S.O',
  },
  'PUT /admin/providers/:provider/keys/:kind': { exempt: 'chave de API não passa pelo chat' },
  'POST /admin/providers/:provider/keys/:kind/test': {
    exempt: 'chave de API não passa pelo chat',
  },

  // A edição manual do canônico: as mesmas mutações que as operações escrevem.
  'POST /${route.path}/:id/mutations': { operation: 'agent.configure' },
};

function arquivosDeRota(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) return arquivosDeRota(caminho);
    return nome.endsWith('.routes.ts') ? [caminho] : [];
  });
}

function rotasDeEscrita(): string[] {
  const raiz = join(import.meta.dirname, '..', '..');
  const padrao = /router\.(post|put|patch|delete)\(\s*[`'"]([^`'"]+)[`'"]/g;

  return arquivosDeRota(raiz).flatMap((arquivo) =>
    [...readFileSync(arquivo, 'utf8').matchAll(padrao)].map(
      (match) => `${match[1]!.toUpperCase()} ${match[2]}`,
    ),
  );
}

describe('fronteira do S.O', () => {
  it('toda rota que escreve diz como o S.O faz a mesma coisa', () => {
    const rotas = rotasDeEscrita();
    // Varredura que não acha nada passa verde sem proteger coisa nenhuma.
    expect(rotas.length).toBeGreaterThanOrEqual(Object.keys(COBERTURA).length);
    expect(rotas.filter((rota) => !(rota in COBERTURA))).toEqual([]);
  });

  it('o que a cobertura cita existe', () => {
    for (const [rota, cobertura] of Object.entries(COBERTURA)) {
      if ('action' in cobertura) {
        expect(
          SYSTEM_ACTIONS.some((action) => action.name === cobertura.action),
          rota,
        ).toBe(true);
      }
      if ('operation' in cobertura) {
        expect(getOperation(cobertura.operation), rota).toBeDefined();
      }
    }
  });

  it('toda ação tem rótulo e propósito — sem propósito o roteador nunca a escolhe', () => {
    for (const action of SYSTEM_ACTIONS) {
      expect(action.label.length, action.name).toBeGreaterThan(3);
      expect(action.purpose.length, action.name).toBeGreaterThan(20);
    }
  });

  it('nome de ação não colide com nome de operação — o roteador usa o mesmo campo', () => {
    for (const action of SYSTEM_ACTIONS) {
      expect(getOperation(action.name), action.name).toBeUndefined();
    }
  });
});
