# O painel do MyAIHub — escopo, proposta e decisões de uso

> Complementa `ARCHITECTURE.md` §28–§32. Aqui está **por que o painel é assim**;
> lá está como o sistema em volta funciona.

---

## 1. O que o painel é

O MyAIHub tem uma tese: **o usuário administra intenção; o sistema administra a
implementação técnica da IA.** O painel é onde essa troca acontece. Ele não é um
assistente lateral que responde perguntas — é o **console de operação** do
produto. Tudo que altera configuração passa por ele ou pelo caminho manual que
ele mesmo expõe.

Disso decorrem três recusas:

| Não é | Por quê |
|---|---|
| Um chat genérico | Chat aceita qualquer pedido e não garante nada. Aqui só existem operações tipadas, com escopo de mutação declarado. |
| Um wizard de etapas | Wizard assume uma ordem única. O usuário chega com o que tem: um site, uma ideia solta, um print. |
| Um formulário com IA no canto | Formulário exige que o usuário conheça o modelo de dados — exatamente o que ele delegou. |

---

## 2. As seis obrigações

O painel só cumpre a tese se fizer as seis coisas. Estado de hoje:

| # | Obrigação | Estado |
|---|---|---|
| 1 | **Saber onde você está** — qual entidade, qual versão, o que já existe | ✅ `WorkspaceHeader` |
| 2 | **Saber o que falta** e propor o próximo passo | ✅ `workspace.ts` |
| 3 | **Fazer o trabalho técnico** — interpretar, estruturar, versionar | ✅ operações do OS |
| 4 | **Mostrar o que fez e por quê** — checklist ao vivo, ajustes, lacunas | ✅ transcrito |
| 5 | **Deixar corrigir** — manual e desfazer | ⚠️ manual sim, desfazer **não** |
| 6 | **Não surpreender com a conta** | ✅ custo por turno |

A 5 incompleta é a dívida mais relevante do painel hoje: as versões existem e são
imutáveis, mas não há caminho de rollback na interface.

---

## 3. Anatomia

```
┌──────────────────────────────────────┐
│ ✨ MyAIHub                    [⤢][×] │
├──────────────────────────────────────┤
│ Sankar                               │  ① contexto: quem é
│ perfil v2                            │
│ 0 públicos · 3 ofertas · 1 campanha  │  ② fatos: o que existe
│                                      │
│ ⚠ O projeto ainda não descreve para  │  ③ lacuna, na ordem de resolver
│   quem o negócio fala.               │
│   Definir o público →                │     com a ação que resolve
├──────────────────────────────────────┤
│ » Crie um projeto pra esse site...   │  ④ transcrito por turno
│   Estruturando seu projeto           │
│   ✓ Interpretando o briefing         │     checklist ao vivo
│   ✓ Estruturando o perfil            │
│   ✓ Salvando e versionando           │
│   ⓘ Li SANKAR | ESTAMPADOS…          │     avisos por tom
│   Identifiquei o projeto como…       │     resposta
│   Abrir Sankar →                     │     caminho para o resultado
│   ? Quais os segmentos atendidos?     │     lacunas clicáveis
│   1.240 tokens · US$ 0,0004          │  ⑤ custo do turno
├──────────────────────────────────────┤
│ [Definir público] [Criar campanha]   │  ⑥ ações priorizadas por estado
├──────────────────────────────────────┤
│ (refinar perfil) trocar              │  ⑦ operação que vai rodar
│ ┌──────────────────────────────────┐ │
│ │ O que você quer fazer?           │ │
│ └──────────────────────────────────┘ │
│ Enter envia            [Enviar]      │
└──────────────────────────────────────┘
```

---

## 4. As decisões que sustentam isso

### 4.1 Estado e lacuna são derivados em CÓDIGO, nunca pelo modelo

`workspace.ts` é uma função pura sobre o documento canônico. Perguntar ao modelo
"o que falta neste projeto?" custaria tokens e latência para responder algo que
um `if` responde — e responderia **diferente a cada vez**, o que é intolerável
num painel de operação. O LLM só entra quando existe interpretação de verdade.

### 4.2 A ordem das lacunas é a ordem de resolver

Público antes de campanha; oferta antes de diferencial; o que descobrir antes de
CTA. Um painel que sugere o acabamento antes da fundação é pior que um painel
mudo: ele dá confiança no caminho errado.

Por isso `prioritizeActions` reordena as quick actions pelo estado real, em vez
de mostrar sempre a mesma lista.

### 4.3 A quick action preenche, não envia

Clicar em "Definir o público" escreve `Nosso público é ` no campo e devolve o
cursor. Enviar sozinha produziria configuração que o usuário não escreveu — e o
princípio é que ele administre a intenção, não que confirme a nossa.

### 4.4 O painel pertence a um escopo

Navegar para outra entidade troca o assunto: transcrito limpo, conversa própria
daquele escopo no backend. Antes o painel mantinha o turno da criação do projeto
na tela do agente até o logout, e a pessoa lia uma resposta que não era sobre o
que estava vendo.

Uma operação em curso **não** é cancelada por navegar — ela termina no servidor.

### 4.5 Aviso não é erro

`VALUE_ADJUSTED` ("corrigi a chave") é transparência sobre uma correção
bem-sucedida. Pintar isso de vermelho ensina o usuário a ignorar vermelho, e aí
o erro de verdade passa batido.

| Tom | Quando | Cor |
|---|---|---|
| info | ajuste aplicado, fonte lida | neutra |
| warning | conflito, mutação recusada | âmbar |
| danger | operação falhou | vermelha |

### 4.6 Lacuna do modelo vira pergunta clicável

A policy manda registrar em `gaps` o que falta em vez de inventar. Isso só tem
valor se alguém **ler** — o evento `operation.gaps` leva as perguntas à tela, e
clicar leva o texto para o composer.

### 4.7 Custo à vista, no turno

Quem decide o próximo passo precisa do preço do anterior. `costMicros` e
`totalTokens` viajam no `operation.completed` e aparecem discretos sob a
resposta. Custo que só aparece na fatura não é informação, é surpresa.

### 4.8 A operação é visível antes de enviar

Um chip mostra o que vai rodar (`refinar perfil`, `criar campanha`). O mesmo
texto produz resultado diferente conforme a operação — esconder isso é esconder
metade do comando.

### 4.9 Imagem é DADO da fala, nunca instrução

Colar um print sobe o arquivo na hora (`POST /api/media`) e o preview aparece com
o `blob:` local — esperar o servidor para mostrar o que a pessoa acabou de colar
faria a interface parecer que perdeu a imagem. O envio leva só os **ids**.

No provider, a imagem entra como parte da mensagem do USUÁRIO, depois do texto:
o texto é o pedido, a imagem é o material. Invertido, o modelo tende a descrever
a imagem em vez de usá-la para o que foi pedido. E ela jamais toca a instrução
de sistema — um print pode conter texto que tenta se passar por comando (§9.1).

O que o servidor recusa: allowlist de tipo (nada de SVG, que é imagem com
script), teto de 8 MB, e **validação pelo cabeçalho do arquivo** — o
`Content-Type` vem do cliente e pode mentir. Servir de volta exige sessão e sai
com `nosniff`.

Anexo que sumiu não derruba a operação: o texto continua valendo e o usuário é
avisado. Falhar tudo por um arquivo perdido seria perder também o que ele
escreveu.

### 4.10 Relato de falha não é pedido de remoção

Uma palavra separa dois pedidos opostos:

```
não peça o nome            →  tire esse comportamento
NEM está pedindo o nome    →  esse comportamento falhou; conserte
```

O OS leu o segundo como o primeiro: apagou exatamente o que o usuário queria,
e respondeu confiante que tinha ajustado. Confiança sobre o oposto do pedido é
pior que erro visível — o usuário só descobre testando de novo.

Diante de um relato de falha o OS DIAGNOSTICA antes de mexer: o item existe?
Existe e não pega — então é força ou clareza, não presença. Há outra regra
competindo? E diz o que encontrou, citando o código do item. "Ajustei" não
informa nada.

### 4.11 Testar exige saber onde a conversa acontece

Pela CAMPANHA o contexto já está resolvido: ela e o projeto dizem o negócio, o
público e o objetivo. Direto no agente não existe nada disso — e sem cenário o
teste media a imaginação do modelo, que o usuário lia como comportamento
configurado.

Por isso o laboratório do agente não abre conversando. O fluxo é: **Testar →
cenário → conversa**. Só depois do cenário o agente dispara a primeira fala,
quando a iniciativa é dele.

A tela não abre já no formulário: a Visão Geral é a capa do agente, e quem só
veio conferir o estado não deveria encontrar trabalho no meio dela. Montar já
chamando o modelo também gastaria token por uma visita.

O cenário fica à vista durante a conversa inteira — sem isso o usuário volta,
lê a resposta e não lembra sob que premissa ela foi dada. E "Reiniciar" vira
"Trocar cenário", porque é a razão mais comum para recomeçar.

### 4.12 O Lab tem cara de chat, não de formulário

A resposta chega inteira do backend — não há streaming de token. Mesmo assim
ela é REVELADA aos poucos no cliente, palavra por palavra, porque uma parede
de texto aparecendo de uma vez lê como formulário processado, não como
alguém respondendo. É honesto: não finge ser streaming, só evita a
transição abrupta que denuncia "isto é uma tela", não uma conversa.

Os metadados — tokens, violação de regra, o selo "regras cumpridas" — só
aparecem depois que a revelação termina. Mostrá-los junto com o texto
crescendo poluiria exatamente o momento em que o usuário está lendo a
resposta.

A rolagem é forçada para o fim a cada quadro da revelação, não só quando um
turno novo chega — senão o balão cresce por baixo da borda visível e o
usuário lê a resposta cortada até ela terminar de aparecer.

A animação de entrada de um balão só toca UMA vez: a lista usa o id do
turno como chave, então React nunca remonta uma resposta antiga, e a
revelação de uma mensagem já lida nunca reinicia sozinha por causa de um
re-render em outra parte da tela.

A FALHA também acontece dentro da conversa. Antes ela era uma linha vermelha
ao pé da tela dizendo "não foi possível testar" — que não diz se o problema
foi do agente, da rede ou do modelo, e deixava como única saída redigitar a
mensagem. Agora o erro entra como um balão, com a mensagem que a API deu (e a
API sabe a diferença: sobrecarga do provider tem código e texto próprios), e
com "Tentar de novo", que reenvia o último turno guardado. Falha de provider é
transitória por definição — a saída certa para ela é uma tecla, não um F5.
### 4.13 Exemplo é ilustração, não texto final

Quando o usuário escreve "ex:" e cola uma frase, ele está mostrando uma
PROPRIEDADE — o tom, o nível de formalidade, o tipo de pergunta. Gravar o
texto no lugar da propriedade congela a frase, e o agente passa a dizer a
mesma coisa para todo mundo.

Quando ele reclama disso, a correção NÃO é trocar a frase fixa por outra
frase fixa — nem escrever a diretriz dentro do campo que guarda a fala. Um
agente que abre a conversa dizendo "Inicia a interação de forma cordial e
adaptada ao contexto" está recitando a própria instrução.

Por isso a abertura tem MODO. `SCRIPTED` é roteiro literal e é a exceção;
`ADAPTIVE` é o default, formula na hora seguindo uma diretriz, e trata o
exemplo do usuário como referência de tom.

FALA é primeira pessoa, pronta para sair da boca do agente. DIRETRIZ é
terceira pessoa, descrevendo como ele age. Campos diferentes.

### 4.14 A pergunta vem ANTES de criar

Criar um agente é um fluxo, não uma frase. O usuário escolhe o papel, o OS
devolve de 2 a 4 perguntas sobre FATO DO NEGÓCIO, ele responde, e só então o
agente nasce — já sabendo.

Perguntar depois é criar sem saber e depois pagar um segundo turno para o
modelo refazer metade da configuração. Pior: o usuário lê um agente pronto e
assume que aquilo é a resposta final; a pergunta que vem em seguida parece
remendo, e ele a ignora.

Só FATO se pergunta. OFÍCIO — como um comercial conduz uma objeção — o OS
deriva. Devolver ofício ao usuário é devolver o trabalho que ele delegou.

Uma pergunta é fixa em CÓDIGO: **quem começa a conversa**. Vale para todo
agente, muda personalidade, comportamento e estratégia de uma vez, e a
resposta vira `engagement.initiator` por mutação manual — não por confiar que
o modelo lembre de traduzi-la. As demais saem do modelo, nunca de uma tabela
por profissão.

### 4.15 Perguntar não é mandar

O painel responde, compara e opina — não só executa. O modelo declara em cada
turno se aquilo foi `ANSWER` ou `CHANGE`; num turno de resposta a operação
termina antes de aplicar mutação, versionar, auditar ou tocar no workspace.

A decisão é do modelo porque a diferença entre "ele já sabe mudar de abordagem?"
e "faça ele mudar de abordagem" é de SENTIDO — nenhuma lista de palavras separa
as duas. Custa um enum na saída, no mesmo turno, sem chamada extra.

E o painel para de mentir junto: sem o rótulo da operação, sem checklist e sem
link para a entidade. Um usuário que perguntou "ele já se adapta?" lia
"Ajustando o agente ✓✓✓" e um item novo aparecia na configuração — o pior erro
possível, porque ele acreditou.

Na dúvida o OS responde e OFERECE. Aplicar é o passo seguinte, pedido.

### 4.16 Seção longa vira rota, não rolagem

As sete facetas do agente são itens da sidebar, cada uma com rota própria e o
contador de itens ao lado. Numa página só, chegar em "limites" custava metros de
rolagem — e o painel do OS ocupa um quarto da tela.

O contador é o que faz a navegação valer: mostra o que está vazio sem exigir
entrar em cada uma. Aparece apagado quando é zero, porque o que está vazio
precisa parecer vazio, não virar alarme.

O oposto vale para a campanha, e por um motivo: lá estratégia e histórico ficam
na visão geral, porque separá-los obrigaria a navegar para conferir o que se
acabou de ajustar. A régua é o tamanho, não a simetria.

### 4.17 O caminho manual é irmão, não atalho

Conversa é para **intenção**; formulário é para **correção**. Editar um rótulo,
digitar a URL de um CTA e apagar um item vão por `POST /:resource/:id/mutations`,
sem LLM — mas montam as mesmas `CanonicalMutation` tipadas, passam pelo mesmo
aplicador e versionam igual. A diferença é `source: 'USER'`, e a UI mostra isso.

---

## 5. O que falta — em ordem de valor

| # | O que | Por que importa | Tamanho |
|---|---|---|---|
| 1 | **Testar o agente** (Internal Lab) | Configurar sem testar é escrever no escuro. Pela campanha, com o contexto dela. | fase |
| 2 | **Desfazer** | As versões são imutáveis e o histórico existe; falta "voltar para a v2" no painel. Fecha a obrigação 5. | médio |
| 3 | **Rehidratar a conversa** | Recarregar a página perde o transcrito, embora as `HubMessage` (com anexos) estejam no banco. | pequeno |
| 4 | **Confirmação para `AI_SUGGESTED`** | `applyMode` existe no contrato e nenhuma operação o usa ainda. Quando o OS propuser por conta própria, precisa de aceite. | médio |
| 5 | **Orçamento por conta** | Hoje o custo é visível por turno, mas nada impede o mês estourar. | médio |

---

## 6. Regras para quem mexer aqui

1. **Nenhuma decisão de UI custa token.** Saudação, ações, lacunas, ordem: tudo
   determinístico. Se for preciso chamar o modelo para desenhar a tela, o
   desenho está errado.
2. **Nada de estado paralelo.** O painel lê as mesmas queries que a página. Uma
   segunda fonte de verdade diverge no primeiro bug.
3. **Toda ação aponta para operação que existe.** Há teste cobrando isso — botão
   que devolve 4xx é pior que botão ausente.
4. **Estado vazio honesto.** Dizer em que fase a funcionalidade chega é melhor
   que tela falsa.
5. **O reducer é a tradução do protocolo de eventos.** Se o painel mostra algo,
   é porque o servidor disse. Inferir na UI cria discordância silenciosa.
