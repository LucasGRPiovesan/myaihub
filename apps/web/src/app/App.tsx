import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { Spinner } from '../design-system/feedback';
import { ThemeProvider } from '../design-system/theme';
import { LoginPage } from '../features/auth/LoginPage';
import { PublicChatPage } from '../features/public/PublicChatPage';
import { useCurrentUser } from '../features/auth/auth.api';
import { AgentFacetPage } from '../features/agents/AgentFacetPage';
import { PlaybookLayout } from '../features/admin/PlaybookLayout';
import { PlaybookNewPage } from '../features/admin/PlaybookNewPage';
import {
  PlaybookLimitsPage,
  PlaybookOverviewPage,
  PlaybookPrinciplesPage,
  PlaybookQuestionsPage,
  PlaybookRecognitionPage,
  PlaybookSourcesPage,
} from '../features/admin/PlaybookSections';
import { PlaybooksPage } from '../features/admin/PlaybooksPage';
import { SupportPage } from '../features/admin/SupportPage';
import { ProvidersPage } from '../features/models/ProvidersPage';
import { AgentPage } from '../features/agents/AgentPage';
import { AgentsPage } from '../features/agents/AgentsPage';
import { CampaignLabPage } from '../features/campaigns/CampaignLabPage';
import { CampaignPage } from '../features/campaigns/CampaignPage';
import { CampaignPublicPage } from '../features/campaigns/CampaignPublicPage';
import { CampaignsPage } from '../features/campaigns/CampaignsPage';
import { HubProvider } from '../features/hub/HubProvider';
import { PlaceholderPage } from './PlaceholderPage';
import { ProjectBrandPage } from '../features/projects/ProjectBrandPage';
import { ProjectFacetPage } from '../features/projects/ProjectFacetPage';
import { ProjectKnowledgePage } from '../features/projects/ProjectKnowledgePage';
import {
  AccountMetricsPage,
  CampaignMetricsPage,
  ProjectMetricsPage,
} from '../features/metrics/MetricsPage';
import { ProjectLabPage } from '../features/projects/ProjectLabPage';
import { ProjectPage } from '../features/projects/ProjectPage';
import { ProjectsPage } from '../features/projects/ProjectsPage';
import { AppShell } from './AppShell';
import { OverviewPage } from './OverviewPage';

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        // 401, 403 e 404 não melhoram com repetição.
        retry: (failureCount, error) => {
          const status = (error as { status?: number }).status;
          if (status === 401 || status === 403 || status === 404) return false;
          return failureCount < 2;
        },
      },
    },
  });
}

function AuthenticatedApp() {
  const { data: user, isPending } = useCurrentUser();

  if (isPending) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-6" />
      </div>
    );
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/entrar" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/entrar" replace />} />
      </Routes>
    );
  }

  return (
    // O HubProvider precisa do QueryClient e do Router, por isso fica aqui
    // dentro e não na raiz.
    <HubProvider>
      <Routes>
        <Route path="/entrar" element={<Navigate to="/" replace />} />
        <Route element={<AppShell user={user} />}>
          <Route index element={<OverviewPage user={user} />} />
          <Route path="projetos" element={<ProjectsPage />} />
          {/* O mesmo dashboard, sem filtro: a conta inteira. Três telas
              diferentes dariam três definições de "conversa engajada". */}
          <Route path="resultados" element={<AccountMetricsPage />} />
          <Route path="projetos/:projectId" element={<ProjectPage />} />
          <Route path="projetos/:projectId/campanhas" element={<CampaignsPage />} />
          <Route path="projetos/:projectId/campanhas/:campaignId" element={<CampaignPage />} />
          <Route
            path="projetos/:projectId/campanhas/:campaignId/testar"
            element={<CampaignLabPage />}
          />
          <Route
            path="projetos/:projectId/campanhas/:campaignId/chat-publico"
            element={<CampaignPublicPage />}
          />
          <Route
            path="projetos/:projectId/campanhas/:campaignId/resultados"
            element={<CampaignMetricsPage />}
          />

          {/*
            A sidebar já oferece estas seções desde a Fase 2. Sem as rotas, cada
            clique caía no catch-all e voltava para a Visão Geral — o usuário
            clicava e "não acontecia nada". Placeholder honesto é melhor: diz o
            que a seção será e em que fase ela chega.
          */}
          {/*
            O teste com o negócio inteiro por trás — o meio-termo entre o Lab do
            agente (sem negócio nenhum) e o da campanha (recorte estreito).
          */}
          <Route path="projetos/:projectId/testar" element={<ProjectLabPage />} />

          <Route path="projetos/:projectId/conhecimento" element={<ProjectKnowledgePage />} />
          <Route path="projetos/:projectId/identidade" element={<ProjectBrandPage />} />
          <Route path="projetos/:projectId/metricas" element={<ProjectMetricsPage />} />
          <Route
            path="projetos/:projectId/configuracoes"
            element={
              <PlaceholderPage
                title="Configurações do projeto"
                description="Capabilities do projeto, limites de custo e preferências de provider. Chega na Fase 11."
              />
            }
          />

          {/*
            As seções do perfil, uma rota cada. Vem DEPOIS das rotas literais
            acima de propósito: mesmo que o React Router ranqueie segmento
            estático acima de dinâmico, a ordem do arquivo é a documentação de
            que `conhecimento` não é uma faceta.
          */}
          <Route path="projetos/:projectId/:facet" element={<ProjectFacetPage />} />

          <Route path="agentes" element={<AgentsPage />} />
          <Route path="agentes/:agentId" element={<AgentPage />} />
          <Route path="agentes/:agentId/:facet" element={<AgentFacetPage />} />

          {/* Administração da PLATAFORMA. O guard real está na API, que exige
              UserRole.ADMIN; esconder a rota aqui é conveniência, não segurança. */}
          {user.role === 'ADMIN' && (
            <>
              <Route path="admin/playbooks" element={<PlaybooksPage />} />
              <Route path="admin/suporte" element={<SupportPage />} />
              <Route path="admin/provedores" element={<ProvidersPage />} />
              <Route path="admin/playbooks/novo" element={<PlaybookNewPage />} />
              {/* Seção longa vira ROTA, não rolagem: é o que faz a sidebar
                  empilhada saber onde você está, igual às facetas do agente. */}
              <Route path="admin/playbooks/:key" element={<PlaybookLayout />}>
                <Route index element={<PlaybookOverviewPage />} />
                <Route path="principios" element={<PlaybookPrinciplesPage />} />
                <Route path="limites" element={<PlaybookLimitsPage />} />
                <Route path="perguntas" element={<PlaybookQuestionsPage />} />
                <Route path="reconhecimento" element={<PlaybookRecognitionPage />} />
                <Route path="fontes" element={<PlaybookSourcesPage />} />
              </Route>
            </>
          )}
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HubProvider>
  );
}

export function App() {
  const [queryClient] = useState(createQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <BrowserRouter>
          <Routes>
            {/*
              O chat do público fica FORA do portão de autenticação, e antes
              dele. Quem chega aqui veio de um anúncio e não tem conta — cair na
              tela de login seria o produto pedindo cadastro para conversar.
            */}
            <Route path="/c/:publicId" element={<PublicChatPage />} />
            <Route path="*" element={<AuthenticatedApp />} />
          </Routes>
        </BrowserRouter>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
