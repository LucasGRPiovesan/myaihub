# Relatório de Deep Research: arquitetura de persuasão e conversão para o Representante Comercial da Easy

## Diagnóstico executivo

A conclusão mais importante da pesquisa é que o caminho para tornar o Representante da Easy excepcionalmente bom em conversão **não é adicionar mais “gatilhos mentais” ao prompt**. O ganho mais provável está em transformar o agente em um sistema de **diagnóstico comercial + redução de incerteza + construção personalizada de valor + condução de decisão**, com persuasão subordinada ao contexto que o próprio prospect revelou.

A arquitetura que você construiu já tem uma qualidade rara: ela impede o modelo de descobrir uma dor e imediatamente explorá-la para vender no mesmo turno. Isso se aproxima muito mais de vendas consultivas baseadas em descoberta do que de copywriting agressivo. O SPIN Selling, por exemplo, estrutura vendas em investigação, implicação e construção do valor antes de demonstrar capacidade, enquanto a própria Huthwaite descreve o princípio como entender necessidades antes de apresentar a solução. citeturn10view2turn9view7

Ao mesmo tempo, há uma oportunidade importante de evolução: **a máquina de estados não pode se transformar em uma prisão conversacional**. O mercado digital está avançando justamente na direção contrária. Em uma pesquisa de 2026 com 646 compradores B2B, 67% disseram preferir uma experiência sem representante, e 45% afirmaram ter usado IA em uma compra recente; a Gartner resume a necessidade como uma jornada autônoma, contextual e de baixo atrito. citeturn11view2

Isso cria um paradoxo muito relevante para a Easy. O comprador quer autonomia, mas ainda precisa de ajuda para chegar à conclusão. Em outro levantamento da Gartner com 645 compradores, representantes humanos foram 28 pontos percentuais mais associados a ajudar o comprador a avançar para a próxima etapa, 32 pontos a gerar confiança na decisão, 39 pontos a demonstrar compreensão das necessidades e 21 pontos a quantificar benefícios, em comparação com GenAI. citeturn11view1

**Esse é exatamente o benchmark comportamental que eu usaria para o agente da Easy.**

Ele não deve parecer um vendedor perseguindo fechamento.

Ele deve parecer um mecanismo que:

> **me entende → organiza meu problema melhor do que eu havia organizado → mostra uma conclusão plausível → explica a Easy somente no contexto dessa conclusão → reduz minha incerteza → facilita minha decisão.**

Essa distinção é muito importante porque estudos recentes de IA aplicada ao comércio mostram que o ganho comercial tende a aparecer quando a IA **reduz incerteza e oferece informação relevante**, e não simplesmente porque “fala de forma persuasiva”. Em um experimento de campo randomizado publicado em *Information Systems Research*, disponibilizar um assistente de IA durante livestream commerce elevou vendas em 3,00% e reduziu devoluções em 12,55%; a interpretação dos autores é que a provisão inteligente de informação reduziu incerteza e aumentou confiança na decisão, embora interrupções do assistente atuassem na direção oposta. citeturn9view2

Portanto, meu diagnóstico central é:

> **O futuro do Representante Comercial da Easy não é ser uma IA mais agressiva. É ser uma IA comercialmente inteligente o bastante para descobrir qual crença impede a compra e mudar somente essa crença com a menor quantidade possível de pressão e fricção.**

Isso muda profundamente a maneira de parametrizar o Gemini.

## O que a evidência realmente sustenta sobre persuasão

O compilado anterior contém várias técnicas úteis, mas elas não possuem o mesmo nível de sustentação científica. Para um agente de produção que receberá tráfego pago real, eu separaria **princípios com evidência experimental**, **metodologias comerciais baseadas em observação de vendas** e **frameworks de copy úteis, porém predominantemente heurísticos**.

| Princípio | Força para a Easy | Como deveria entrar no agente |
|---|---:|---|
| Relevância/personalização contextual | Muito alta | Argumentar usando o que o próprio usuário declarou |
| Reactância/autonomia | Muito alta | Evitar pressão e preservar escolha |
| Social proof específico | Alta | Provas reais de pessoas/situações semelhantes |
| Framing | Alta | Enquadrar valor de acordo com objetivo ou problema |
| SPIN / implicação | Alta | Fazer o usuário perceber consequências do problema |
| Choice architecture | Alta | Simplificar comparação e escolha de planos |
| Scarcity | Média/alta e contextual | Somente quando a limitação for real |
| Loss aversion | Média/alta | Usar perda verdadeira, nunca ameaças inventadas |
| Foot-in-the-door | Média | Microcompromissos naturais, não manipulação |
| Storytelling | Média | Casos reais e curtos, quando relevantes |
| AIDA/PAS | Estrutural | Organização de mensagens, não “lei psicológica” |
| Future pacing | Estrutural | Tornar resultado concreto sem prometer resultado |
| Personality targeting | Não recomendo | Inferência psicográfica é desnecessária e frágil |

### A personalização mais poderosa é contextual, não psicológica

Uma meta-análise de 2025 examinou **53 estudos experimentais** de publicidade personalizada e encontrou, em geral, maior eficácia de anúncios personalizados do que genéricos sobre persuasão, atitudes e intenções comportamentais. O mecanismo que explicou essa vantagem foi principalmente a **relevância percebida**. citeturn12search3

Isso é extremamente importante para o design do agente.

A Easy não precisa decidir:

> “Este usuário é neuroticamente preventivo, extrovertido e responde a status.”

Ela precisa descobrir:

> “Ele depende de indicação, sofre com irregularidade de demanda e quer previsibilidade.”

E então falar sobre **previsibilidade**.

Curiosamente, uma meta-análise publicada em *Psychology & Marketing* em 2026 revisou a ideia de inferir personalidade a partir de rastros digitais e adaptar mensagens a essa personalidade. Quando problemas metodológicos foram controlados, os autores concluíram que a efetividade end-to-end do chamado *psychological targeting* se aproximava de zero. citeturn12search0turn12search2

Portanto, a arquitetura comercial da Easy deveria privilegiar:

**personalização por contexto declarado > personalização por personalidade inferida.**

Isso é simultaneamente mais defensável empiricamente, mais transparente e mais compatível com minimização de risco de privacidade.

### O usuário deve sentir que chegou parcialmente à conclusão

A lógica do SPIN é especialmente interessante para a Easy. A Huthwaite organiza as perguntas em situação, problema, implicação e *need-payoff*: primeiro se compreende o contexto; depois o problema; depois suas consequências; finalmente, ajuda-se o próprio comprador a articular o valor de resolvê-lo. citeturn10view2

Isso valida uma parte importante do seu `raio_x`, mas sugere uma melhoria: hoje você explicitamente precisa de `intent`, `pain` e `goal`. Falta uma variável intermediária que chamarei de:

```text
impact
```

Ela significa:

> **o que aquela dor provoca comercialmente.**

Exemplo:

```text
intent = instalação de ar-condicionado
pain = depende de indicação
goal = ter mais clientes
impact = alguns períodos ficam sem demanda previsível
```

Agora a `estrategia` pode chegar a uma conclusão muito melhor:

> “Então talvez o principal problema não seja conseguir fazer bons serviços. É não ter previsibilidade sobre quando o próximo cliente vai aparecer. É isso?”

A IA não inventou uma dor.

Ela **reorganizou quatro fatos fornecidos pelo próprio usuário**.

Esse é um comportamento muito mais sofisticado do que simplesmente:

> “Entendi. A Easy pode trazer mais clientes.”

### Persuasão perde força quando parece persuasão

Essa talvez seja a descoberta científica mais importante para o prompt.

Uma meta-análise publicada em 2026 reuniu 33 estudos e 146 efeitos sobre reactância psicológica. Linguagem que ameaça a liberdade aumentou raiva, pensamentos negativos e reactância; tanto raiva quanto pensamentos negativos apresentaram associação negativa com os resultados persuasivos. citeturn9view4

Isso é particularmente relevante porque o representante é **text-only**, e o próprio estudo identificou a modalidade da comunicação como um moderador dos efeitos. citeturn9view4

Portanto:

> “Você precisa aparecer mais.”

é inferior, em princípio, a:

> “Pelo que você contou, aparecer para mais gente poderia atacar justamente essa dependência de indicação.”

E:

> “A melhor escolha para você é o Pro.”

é inferior a:

> “Pelo que você me disse até aqui, o Pro parece fazer mais sentido por X. Mas são esses dois pontos que eu compararia.”

A segunda linguagem preserva agência.

Isso não torna a IA menos comercial.

Torna-a **menos detectavelmente coercitiva**.

### Prova social deve ser próxima, verificável e específica

O clássico experimento de campo de Goldstein, Cialdini e Griskevicius mostrou que mensagens baseadas em normas sociais descritivas superaram mensagens tradicionais focadas apenas no benefício ambiental e que a norma ficou especialmente efetiva quando descrevia pessoas na situação mais próxima à do indivíduo. citeturn11view4

A aplicação para a Easy é bastante clara.

É melhor, desde que verdadeiro, dizer algo parecido com:

> “Prestadores de elétrica da sua região também usam a plataforma para ampliar como são encontrados.”

do que:

> “Milhares de profissionais usam a Easy.”

E melhor ainda seria prova quantitativa real:

> “Nos últimos 30 dias, X profissionais da sua categoria receberam Y contatos.”

Mas isso cria uma regra crítica:

**nenhum número, depoimento, ranking, popularidade ou resultado pode ser gerado pelo LLM.**

O modelo só pode usar prova social proveniente de uma fonte estruturada e confiável.

### Escassez funciona; escassez falsa deve ser proibida

Uma meta-análise sobre escassez em marketing reuniu **416 efeitos de 131 estudos** e encontrou efeitos sobre intenção de compra, mas também variação importante conforme o tipo de escassez e o produto; escassez baseada em demanda, oferta limitada e tempo limitado não são equivalentes. citeturn1search35

Isso significa que a regra para o Gemini não deveria ser:

```text
use urgency
```

Deveria ser:

```text
use urgency only when an externally verified temporal,
capacity, promotional or availability constraint exists.
```

Sem limitação real, não existe escassez.

### Framing deve adaptar o ângulo, não alterar a verdade

Tversky e Kahneman demonstraram que escolhas podem mudar significativamente quando resultados equivalentes são apresentados em enquadramentos diferentes. citeturn1search1turn1search5

Para a Easy, isso permite apresentar o mesmo valor de maneiras distintas conforme aquilo que a pessoa disse que importa.

Um prospect orientado a crescimento pode receber:

> “A ideia é criar mais uma porta de entrada para novos clientes.”

Um prospect preocupado com dependência de indicação pode receber:

> “A ideia é reduzir o quanto seu volume depende de uma única fonte.”

Um prospect preocupado com custo pode receber:

> “Aqui o ponto não é só quanto custa o plano; é quanto de previsibilidade comercial ele precisa gerar para fazer sentido para você.”

A **proposição factual é a mesma**.

O ângulo muda.

Isso é personalização legítima.

### Choice architecture deve reduzir decisão, não enganar

Meta-análises de defaults mostram que opções pré-selecionadas podem exercer influência considerável, inclusive em contextos de consumo, e que mecanismos de recomendação, facilidade e status quo ajudam a explicar esse efeito. Os autores também enfatizam que a eficácia é altamente variável e depende de contexto e confiança no arquiteto da escolha. citeturn11view5

Isso cria uma excelente possibilidade para os cartões da Easy:

> **“Mais indicado para o que você me contou.”**

em vez de:

> **“MELHOR PLANO.”**

Mas a indicação precisa ser calculada por critérios reais.

Por exemplo:

```text
goal = máxima exposição
need = recorrência
price_sensitivity = baixa/não declarada
=> recommendedPlan = Pro
recommendationReason = "você disse que o principal objetivo é aumentar a frequência de oportunidades"
```

Não se deveria marcar automaticamente o plano que gera maior receita para a Easy como “recomendado”.

### O efeito de pequenas confirmações existe, mas não deve virar truque

O trabalho clássico de Freedman e Fraser sobre *foot-in-the-door* encontrou que aceitar uma solicitação pequena pode aumentar a propensão a aceitar outra maior posteriormente. citeturn1search10

Isso sustenta os seus microcompromissos, mas o agente não precisa manipular artificialmente “sins”.

A melhor versão é:

> “Então sua prioridade hoje é previsibilidade, certo?”

Depois:

> “Se esse for realmente o ponto, faz sentido eu te mostrar como a Easy ataca justamente essa parte?”

Depois:

> “Quer comparar os planos?”

São compromissos **semanticamente relevantes à decisão**, e não pequenos truques comportamentais arbitrários.

## O que o mercado de IA comercial está ensinando

Há dois resultados recentes aparentemente contraditórios que, juntos, fornecem uma direção muito clara.

Primeiro: compradores querem mais autonomia digital. A Gartner reportou em março de 2026 que 67% dos compradores B2B pesquisados preferiam uma experiência sem representante e descreveu a tendência como uma jornada cada vez mais auto-dirigida. citeturn11view2

Segundo: quando vendedores humanos entram no processo, compradores ainda os consideram superiores à GenAI em compreensão das necessidades, confiança, avanço da decisão e quantificação do valor. citeturn11view1

A oportunidade estratégica para a Easy, portanto, é **combinar essas duas experiências**:

> autonomia de self-service + capacidade de sensemaking de um grande vendedor.

Isso significa que o chat não deve operar como um SDR tradicional tentando “segurar o lead”.

Ele deve funcionar como:

**um comprador self-service que ganhou um excelente consultor embutido na interface.**

A Gartner também encontrou uma associação entre organizações que fornecem *next best actions* via IA aos vendedores e maior probabilidade de crescimento comercial, embora seja importante ressaltar que esse resultado provém de survey organizacional e não demonstra causalidade por si só. citeturn11view1

Para a Easy, isso sugere a criação explícita de uma variável interna:

```text
nextBestAction
```

O modelo não deveria simplesmente perguntar:

> “O que eu respondo agora?”

Ele deveria decidir:

```text
Qual é a menor mudança cognitiva necessária para
o usuário avançar uma etapa na decisão?
```

Exemplos:

```text
unknown_problem
→ discovery

misdiagnosed_problem
→ reframe

low_relevance
→ connect pain to Easy mechanism

low_trust
→ proof

unclear_value
→ quantify / contrast

price_objection
→ economics

decision_overload
→ recommend best fit

ready_to_buy
→ remove friction and signup
```

### A IA precisa parecer competente e empática, não humana

Um conhecido experimento de campo com mais de 6.200 consumidores verificou que revelar antes da interação que o interlocutor comercial era um chatbot reduziu fortemente compras; a interpretação dos pesquisadores foi que os compradores passaram a perceber o bot como menos competente e menos empático. citeturn9view3turn4search0

Esse resultado **não deve ser interpretado como autorização para a Easy fingir que a IA é humana**.

O ensinamento estratégico é outro:

> a penalidade estava associada principalmente às expectativas de menor competência e empatia.

Pesquisas posteriores sobre confiança em chatbots também encontram associações positivas de empatia, cordialidade e usabilidade com confiança. citeturn11view6

Portanto, o design ideal é:

**não mentir sobre ser humano; não transformar “sou uma IA” no assunto central; demonstrar competência através da conversa.**

Se a interface já deixa evidente que se trata do assistente da Easy, o Gemini não precisa se reapresentar roboticamente a cada momento.

### Perguntar mais não significa vender melhor

A análise proprietária da Gong publicada em 2025 relata que vendedores que ganharam negócios fizeram em média 15–16 perguntas nas ligações analisadas, enquanto vendedores que perderam fizeram aproximadamente 20; a própria Gong resume o resultado como “mais perguntas não necessariamente significam melhores conversas”. Esses dados são observacionais e sobre chamadas comerciais, portanto devem ser usados como sinal direcional, não como causalidade aplicável diretamente ao chat da Easy. citeturn9view6

Essa é uma crítica importante ao seu piso de turnos.

**Eu gosto do propósito do piso. Não gosto de ele ser a principal medida de entendimento.**

Quatro respostas não garantem compreensão.

Três respostas excelentes podem produzir compreensão suficiente.

Seis respostas monossilábicas talvez não produzam nenhuma.

Portanto, eu manteria inicialmente os limites atuais como guardrails, mas começaria a migrar de:

```text
turn-count-driven
```

para:

```text
evidence-sufficiency-driven
```

com turn count atuando apenas como fallback.

## Auditoria da arquitetura atual da Easy

### O `raio_x` está conceitualmente correto

A regra mais valiosa da arquitetura atual é:

> **não descobrir e vender no mesmo fôlego.**

Eu preservaria isso.

Ela reduz um erro frequente de LLMs comerciais: transformar qualquer detalhe em oportunidade de pitch.

A lógica atual:

```text
intent
pain
goal
```

deveria evoluir para:

```text
intent
channel
pain
goal
impact
```

Onde `channel` pode estar embutido no `pain`, se necessário, mas conceitualmente representa:

> como o negócio chega hoje.

E `impact`:

> qual consequência da situação atual realmente importa.

Não transformaria os cinco campos em checklist obrigatório. O modelo pode deduzir dois deles da mesma resposta, desde que registre claramente a evidência.

Exemplo:

> “Faço elétrica e praticamente tudo chega por indicação. Queria ter serviço mais constante.”

Uma única resposta já contém:

```json
{
  "intent": "serviços elétricos",
  "channel": "indicação",
  "pain": "dependência de indicação",
  "goal": "maior constância de serviços",
  "impact": "irregularidade de demanda"
}
```

O erro seria fazer mais três perguntas simplesmente porque faltam turnos.

### O maior problema potencial é a tirania da fase

Imagine alguém chegando de campanha e escrevendo:

> “Quanto custa?”

A configuração atual pode obrigar o agente a responder algo como:

> “Antes, me conta como seus clientes chegam hoje?”

Comercialmente, isso é perigoso.

O usuário não pediu consultoria.

Ele pediu preço.

Outro exemplo:

> “Gostei, quero assinar.”

Se o sistema ainda estiver em `raio_x`, obrigá-lo a concluir descoberta antes de permitir compra seria o equivalente digital de um vendedor bloqueando o caixa.

A solução arquitetural mais importante que encontrei para você é separar:

```text
phase
```

de:

```text
interruptIntent
```

A fase continua descrevendo **onde estamos na construção comercial**.

O interrupt descreve:

> **o que precisa ser atendido imediatamente para não quebrar a conversa.**

Eu criaria algo conceitualmente assim:

```text
interruptIntent =
  none
  | direct_product_question
  | pricing_question
  | explicit_plan_request
  | explicit_buy_intent
  | objection
  | privacy_question
  | human_request
  | stop
```

Então:

```text
phase = raio_x
interruptIntent = pricing_question
```

permite responder brevemente o preço **sem considerar o raio-X encerrado**.

Depois:

> “Os planos são X. Para eu não te indicar algo à toa: hoje seus serviços chegam mais por indicação ou você já anuncia?”

Você respondeu.

Não vendeu agressivamente.

E preservou a descoberta.

### Compra explícita deveria vencer o funil

Eu criaria uma regra de precedência:

```text
explicit_buy_intent > phase progression
```

Se alguém escreve:

> “Quero criar meu perfil.”

ou:

> “Pode me mandar o plano.”

ou:

> “Onde assino?”

o sistema deve reduzir drasticamente o atrito.

Isso não viola sua regra de não vender cedo.

**O próprio comprador acabou de avançar.**

A arquitetura precisa impedir venda prematura, não compra prematura.

### `estrategia` deveria continuar existindo exatamente como conceito

Eu não eliminaria essa fase.

Na verdade, acho que ela é a maior vantagem competitiva do fluxo.

Mas refinaria sua estrutura interna.

Em vez de apenas:

```text
strategy: "aumentar visibilidade"
```

eu guardaria algo próximo de:

```json
{
  "diagnosis": "dependência de uma única fonte de aquisição",
  "evidence": [
    "maior parte dos clientes chega por indicação",
    "quer mais constância"
  ],
  "desiredOutcome": "demanda mais previsível",
  "primaryValueAngle": "previsibilidade",
  "secondaryValueAngle": "diversificação de aquisição",
  "confidence": 0.91
}
```

Somente `diagnosis` precisa necessariamente aparecer para o usuário.

A bolha ficaria simples:

> “Pelo que você me contou, eu não acho que o principal problema seja falta de qualidade no seu serviço. Parece mais uma dependência grande de indicação: quando ela desacelera, sua entrada de novos trabalhos desacelera junto. É isso?”

Observe o que aconteceu.

**Echo de evidência → interpretação → consequência → confirmação.**

Nenhuma Easy.

Nenhum plano.

Nenhum pitch.

Mas a percepção do usuário sobre o próprio problema mudou.

Isso é persuasão de alto nível.

### A `conducao` precisa virar um motor de crenças

Hoje ela “argumenta com os fatos da Easy contra a dor”.

Eu tornaria isso mais preciso.

Antes de gerar a resposta, o modelo deveria decidir:

```text
currentBelief
requiredBelief
beliefGap
bestEvidence
nextBestAction
```

Exemplo:

```json
{
  "currentBelief": "dependo de indicação porque é assim que meu mercado funciona",
  "requiredBelief": "posso adicionar outra fonte de descoberta sem abandonar indicação",
  "beliefGap": "não enxerga aquisição como algo diversificável",
  "bestEvidence": "mecanismo real da Easy relacionado à descoberta",
  "nextBestAction": "mostrar como a Easy complementa indicação"
}
```

A resposta então não precisa empilhar benefícios.

Ela precisa resolver **uma objeção cognitiva de cada vez**.

### A `aquisicao` deve simplificar, não intensificar

Depois do cartão, eu retiraria quase completamente a lógica clássica de “persuasão”.

O trabalho passa a ser:

> resolver última incerteza → recomendar quando apropriado → dar uma ação óbvia.

O usuário que chegou ao cartão não precisa de um novo PAS, uma nova história e três gatilhos.

Ele precisa de clareza.

É exatamente aqui que choice architecture se torna mais importante do que copy.

Se existem três planos, um eventual selo:

> “Mais adequado para o que você me contou”

é mais coerente do que:

> “MAIS VENDIDO 🔥”

a menos que “mais vendido” seja uma informação factual e atual.

## O sistema comercial que eu implantaria

Eu transformaria o Gemini em um agente com duas camadas distintas.

A primeira é a máquina determinística:

```text
state machine
permissions
phase transitions
cards
exits
truth sources
metrics
```

A segunda é a inteligência probabilística:

```text
interpretation
diagnosis
reframing
language
argument selection
objection response
```

O LLM nunca deveria ser responsável por decidir aquilo que o código consegue determinar com segurança.

E o código nunca deveria tentar escrever aquilo para que o LLM existe.

### Estado comercial recomendado

Além do que vocês já guardam, eu consideraria uma estrutura próxima desta:

```json
{
  "phase": "raio_x",
  "turnMode": "normal",

  "discovery": {
    "intent": null,
    "currentChannel": null,
    "pain": null,
    "goal": null,
    "impact": null
  },

  "strategy": {
    "diagnosis": null,
    "evidence": [],
    "desiredOutcome": null,
    "primaryValueAngle": null,
    "confidence": null,
    "confirmed": false
  },

  "buyer": {
    "declaredUrgency": null,
    "priceConcern": null,
    "trustConcern": null,
    "comparisonConcern": null,
    "decisionReadiness": "unknown"
  },

  "commercial": {
    "beliefGap": null,
    "nextBestAction": null,
    "proofNeeded": null,
    "recommendedPlan": null,
    "recommendationReason": null
  },

  "historyFlags": {
    "askedPrice": false,
    "askedHowItWorks": false,
    "sawPlanCard": false,
    "clickedPlan": false,
    "signupIntent": false
  }
}
```

Não colocaria:

```text
personalityType
MBTI
BigFive
susceptibilityToScarcity
fearLevel
```

A personalização deveria ser construída sobre **necessidades comerciais declaradas**, não sobre psicografia inferida. A evidência recente favorece personalização por relevância, enquanto a literatura de 2026 lança forte dúvida sobre o valor prático de inferência psicológica end-to-end. citeturn12search3turn12search0

### Biblioteca de ângulos comerciais

O `primaryValueAngle` não precisa ser um gatilho. Ele deve representar a lógica econômica ou emocional que o usuário já revelou.

| Sinal declarado | Ângulo predominante |
|---|---|
| “Quero mais clientes” | Crescimento |
| “Tem mês que para” | Previsibilidade |
| “Só vivo de indicação” | Diversificação |
| “Pago muito por lead” | Eficiência econômica |
| “Não quero depender de plataforma X” | Autonomia |
| “Não sei se funciona” | Evidência/confiança |
| “Não tenho tempo” | Simplicidade |
| “Está caro” | Valor/ROI |
| “Já tentei outras coisas” | Diferenciação |
| “Só quero saber como funciona” | Clareza |

Assim, a IA não pergunta:

> “Qual técnica de persuasão devo aplicar?”

Ela pergunta:

> **“Qual dimensão de valor ele explicitamente está tentando maximizar?”**

Essa é uma diferença enorme.

### Matriz de resposta da `conducao`

A estrutura que eu ensinaria ao agente seria:

```text
EVIDÊNCIA DO USUÁRIO
        ↓
DIAGNÓSTICO CONFIRMADO
        ↓
MECANISMO RELEVANTE DA EASY
        ↓
POR QUE ISSO MUDA O PROBLEMA
        ↓
PROVA, SE NECESSÁRIA
        ↓
MICRODECISÃO
```

Um exemplo hipotético:

**Usuário**

> “É, se indicação para, eu fico parado.”

**Agente**

> “Então é justamente aí que faz sentido olhar para uma segunda fonte de descoberta — não para substituir suas indicações, mas para você não depender só delas. A Easy entra nessa parte: [mecanismo factual da Easy]. Quer ver como isso aparece para quem procura um profissional?”

Observe que não há:

> “🔥 oportunidade”  
> “você está perdendo dinheiro”  
> “últimas vagas”  
> “não fique para trás”.

Há causalidade.

### Objeções deveriam ser tratadas pela causa, não pela frase

Eu usaria a taxonomia:

```text
price
trust
need
timing
effort
comparison
risk
understanding
authority
not_interested
```

E uma estrutura comum:

```text
ACKNOWLEDGE
→ DIAGNOSE THE REAL OBJECTION IF UNCLEAR
→ ANSWER DIRECTLY
→ CONNECT TO PREVIOUSLY DECLARED VALUE
→ PROOF IF AVAILABLE
→ ONE NEXT STEP
```

Exemplo:

> “Tá caro.”

Não responder:

> “Entendo, mas pense em quantos clientes você pode conseguir.”

Isso é uma afirmação não demonstrada e parece script.

Melhor:

> “Justo. A pergunta então é se esse custo conseguiria se justificar no seu caso. Como você disse que hoje depende principalmente de indicação, eu compararia o valor do plano com quanto vale para você abrir uma segunda fonte de oportunidades — não com ‘marketing’ de forma genérica.”

Se existir dado real que permita cálculo:

> “Se um único serviço médio seu é R$ X e o plano custa R$ Y, o ponto de equilíbrio seria Z.”

Se não existir, **não inventar ROI**.

### Prova deve funcionar como uma API de verdade

Criaria um catálogo de claims:

```json
{
  "claimId": "contacts_unlimited",
  "text": "...",
  "status": "verified",
  "validFrom": "...",
  "validUntil": null,
  "allowedContexts": ["plans", "comparison"]
}
```

E faria o mesmo para:

```text
prices
features
promotions
testimonials
user counts
contact counts
conversion metrics
availability
guarantees
cancellation
rankings
regional data
```

O LLM não deveria possuir autoridade para produzir um claim comercial sem proveniência.

Isso não é só engenharia de confiança. No Brasil, o Código de Defesa do Consumidor exige que a publicidade seja identificável e proíbe publicidade enganosa, inclusive informações falsas ou omissões capazes de induzir o consumidor em erro sobre características, preço e outros elementos do serviço. citeturn5search0

### Dados e persuasão adaptativa precisam de governança

A LGPD disciplina tratamento de dados pessoais, inclusive em meios digitais, e prevê direitos relacionados a decisões tomadas unicamente com tratamento automatizado que afetem interesses do titular, incluindo decisões destinadas a definir perfil pessoal, profissional ou de consumo; a lei também prevê o fornecimento de informações claras sobre critérios e procedimentos em determinadas situações. citeturn5search1turn6view0

Isso não significa automaticamente que toda seleção de argumento do Gemini constitui uma “decisão automatizada” nos termos do art. 20. Essa conclusão depende da implementação e de seus efeitos. Mas é uma razão adicional para manter a personalização comercial baseada principalmente em informação fornecida na própria conversa, documentar finalidade e base legal apropriada para dados armazenados e submeter a arquitetura a revisão jurídica/LGPD antes de utilizar profiling mais agressivo. A LGPD prevê múltiplas hipóteses legais de tratamento, e não apenas consentimento. citeturn5search5

Meu princípio seria:

> **Conheça o problema comercial do usuário profundamente. Não tente conhecer psicologicamente o usuário mais do que é necessário para resolver esse problema.**

## Métricas, experimentação e sistema de aprendizagem

O Representante não deveria ser otimizado por:

```text
"essa resposta parece persuasiva?"
```

Nem principalmente por avaliação do Opus, Gemini ou outro LLM.

A variável final é comportamento comercial real.

Eu criaria a árvore:

```text
paid click
   ↓
chat opened
   ↓
first user response
   ↓
qualified discovery
   ↓
strategy delivered
   ↓
strategy confirmed
   ↓
Easy value presented
   ↓
plan card viewed
   ↓
plan selected
   ↓
signup started
   ↓
signup completed
   ↓
paid subscription
```

A métrica norte deveria ser:

```text
Paid subscription / unique qualified paid-traffic sessions
```

E, dependendo do modelo financeiro:

```text
Revenue per paid session
```

ou:

```text
Gross-margin LTV / CAC
```

Mas o primeiro estágio de otimização do agente deveria ser **conversão de assinante**, exatamente como você definiu.

### Métricas intermediárias que eu armazenaria

| Métrica | O que revela |
|---|---|
| First-response rate | Qualidade do início |
| Turn-two retention | Se o raio-X assusta |
| Raio-X completion | Capacidade de descoberta |
| Average turns to strategy | Fricção da descoberta |
| Strategy confirmation rate | Qualidade do diagnóstico |
| Strategy rejection rate | IA está inferindo demais |
| Condução → plan-card rate | Força da construção de valor |
| Plan-card → click rate | Qualidade da escolha |
| Signup-start rate | Intenção |
| Signup-completion rate | Fricção fora do chat |
| Paid conversion | Resultado real |
| Direct-question ignored rate | Rigidez da máquina |
| Repeated-question rate | Memória ruim |
| Unsupported-claim rate | Segurança comercial |
| Stop/negative sentiment rate | Reactância |
| Turns after buying intent | Fricção de fechamento |

Eu considero particularmente importante:

```text
turns_after_explicit_buy_intent
```

A meta ideal é quase zero.

Quando alguém decide comprar, o agente deve sair do caminho.

### O primeiro A/B test que eu faria

Não começaria testando “escassez vs prova social”.

Testaria arquitetura.

**Controle:** implementação atual.

**Variante:** mesma arquitetura + `interruptIntent`.

A hipótese seria:

> responder diretamente perguntas comerciais explícitas e permitir bypass por intenção forte reduz abandono sem prejudicar a qualidade de descoberta.

Depois testaria:

**Controle:** transição baseada nos pisos atuais de quatro/seis respostas.

**Variante:** piso reduzido + `discoverySufficiency`.

Só depois começaria a experimentar persuasão.

### Os testes de mensagem mais valiosos

Depois que a arquitetura estiver estável, eu testaria isoladamente:

```text
generic value
vs
context-personalized value
```

Depois:

```text
feature-first
vs
diagnosis → mechanism → outcome
```

Depois:

```text
hard CTA
vs
autonomy-supportive CTA
```

Depois:

```text
generic social proof
vs
segment-matched verified social proof
```

Depois:

```text
all-plan presentation
vs
reasoned recommended-plan presentation
```

A personalização deveria partir de contexto declarado, porque a meta-análise recente de publicidade personalizada aponta relevância como mecanismo central da vantagem persuasiva. citeturn12search3

### Toda conversa deveria gerar inteligência de mercado

Existe um ativo potencialmente tão valioso quanto as vendas:

```text
por que prestadores compram
por que não compram
como conseguem clientes
qual dor aparece por categoria
qual concorrente citam
qual objeção antecede abandono
qual promessa gera avanço
```

Eu estruturaria isso anonimamente/agregadamente em eventos.

Exemplo:

```json
{
  "profession": "eletricista",
  "currentChannel": "referral",
  "primaryPain": "unpredictability",
  "goal": "more_consistent_jobs",
  "diagnosis": "single_channel_dependency",
  "mainObjection": "price",
  "planViewed": "pro",
  "converted": true
}
```

Depois de volume suficiente, vocês deixarão de perguntar:

> “Qual copy achamos que converte?”

E poderão responder:

> “Para eletricistas provenientes da campanha X que dependem de indicação e citam irregularidade, qual diagnóstico e qual argumento historicamente elevam a passagem para o cartão?”

Aí vocês começam a construir um verdadeiro **motor comercial baseado em evidência própria**.

## Prompt mestre para o Opus aprimorar o Representante

O texto abaixo foi escrito para funcionar como um briefing de arquitetura e implementação para o Opus. Ele pressupõe que o Opus terá acesso ao código atual; propositalmente manda inspecionar o repositório antes de alterar qualquer coisa e preserva os nomes e invariantes que você informou.

```text
Você vai atuar como arquiteto principal de Conversational Commerce,
Sales AI, behavioral design e software engineering da Easy.

OBJETIVO CENTRAL

Audite e aprimore o Representante Comercial da Easy, um agente
conversacional baseado em Gemini que recebe usuários provenientes
principalmente de campanhas de tráfego pago e tem como objetivo final
converter usuários adequados em assinantes da plataforma Easy.

O objetivo NÃO é tornar o agente agressivamente persuasivo.

O objetivo é construir o melhor sistema possível de:

1. compreensão comercial;
2. diagnóstico;
3. personalização contextual;
4. construção de valor;
5. redução de incerteza;
6. tratamento de objeções;
7. condução da decisão;
8. fechamento de baixa fricção.

O agente deve funcionar como a combinação de:

SELF-SERVICE DIGITAL
+
EXCELENTE REPRESENTANTE COMERCIAL CONSULTIVO.

A conversão é a métrica final, porém otimizada sob as restrições de:
verdade factual, autonomia do usuário, boa experiência, ausência de
manipulação enganosa, ausência de claims inventados e respeito às
regras do produto.

==================================================
PRIMEIRO: AUDITE O SISTEMA ATUAL
==================================================

Antes de propor código:

- localize todos os arquivos que participam do chat de aquisição;
- localize resolvePhase();
- localize keepStrategy;
- localize resolveExits;
- localize a persistência de AcquisitionChatTurn.phase;
- localize o schema de saída do Gemini;
- localize construção do prompt;
- localize cards, buttons e exits;
- localize armazenamento de intent, pain, goal e strategy;
- localize parsing/normalização das respostas estruturadas;
- localize qualquer mecanismo de analytics;
- localize a fonte de verdade de planos, preços, features e claims.

Não suponha como o código funciona.

Leia e trace o fluxo real.

Crie primeiro um mapa:

USER MESSAGE
→ STATE
→ resolvePhase()
→ PROMPT/PERMISSIONS
→ GEMINI
→ STRUCTURED OUTPUT
→ VALIDATION
→ STATE MUTATION
→ UI
→ PERSISTENCE

Identifique onde cada decisão é determinística e onde depende do LLM.

REGRA ABSOLUTA:

AcquisitionChatTurn.phase é a fonte de verdade da fase real.

Nunca utilize o "Fase:" auto-reportado pelo thought do modelo
para auditoria, transição ou decisão de negócio.

Se ainda existir dependência dele, remova-a.

==================================================
ARQUITETURA ATUAL QUE DEVE SER PRESERVADA
==================================================

A arquitetura atual tem quatro fases:

raio_x
estrategia
conducao
aquisicao

RAIO_X

Serve somente para compreender a pessoa.

Os elementos centrais atuais são:

intent = o que ele vende/faz
pain = como o trabalho chega hoje / dificuldade relevante
goal = o que ele quer conseguir

Não apresentar pitch da Easy nesta fase.

Não afirmar como é a vida do usuário.

Não inventar dores.

Não introduzir recurso da Easy disfarçado dentro da pergunta.

A exceção atual de how_it_works deve ser preservada e reavaliada
dentro do novo sistema de interrupts descrito abaixo.

ESTRATEGIA

É um único turno.

Obrigatoriamente bodyKind = leitura.

O agente devolve sua leitura da situação.

Nomeia UMA causa, gargalo ou oportunidade principal.

Pede confirmação.

Não menciona Easy.

Não mostra plano.

Não mostra cartão.

Não oferece múltiplas saídas.

É o único momento normal em que strategy pode ser gravado pelo
keepStrategy.

CONDUCAO

Somente após existir strategy.

O agente usa fatos verificados da Easy para responder ao problema
que O USUÁRIO descreveu e ao diagnóstico que foi confirmado.

A pergunta não tem mais função primária de discovery.

Sua função agora é mover a decisão.

AQUISICAO

O cartão de plano já foi mostrado.

O objetivo passa a ser:

resolver dúvida final
→ reduzir incerteza
→ recomendar quando justificável
→ signup.

Preservar o fallback de exits do sistema quando apropriado.

==================================================
PRIMEIRA GRANDE MELHORIA:
SEPARAR PHASE DE INTERRUPT INTENT
==================================================

A máquina atual evita venda prematura.

Isso é bom.

Mas uma fase nunca pode impedir a resposta à intenção explícita
do usuário.

Implemente, no nível adequado da arquitetura, um conceito de
interrupt/turn mode separado de phase.

Algo semanticamente equivalente a:

interruptIntent =
  none
  direct_product_question
  how_it_works
  pricing_question
  explicit_plan_request
  explicit_buy_intent
  objection
  privacy_question
  human_request
  stop

NÃO é obrigatório usar exatamente esses nomes caso o domínio atual
tenha um padrão melhor.

O princípio é obrigatório.

A fase descreve onde estamos no processo comercial.

O interrupt descreve qual necessidade explícita do usuário precisa
ser atendida AGORA.

Exemplo:

phase = raio_x
interruptIntent = pricing_question

O sistema deve poder responder corretamente à pergunta de preço
sem considerar automaticamente o raio-X concluído.

Depois da resposta factual, pode retomar a atividade apropriada da fase.

Exemplo comportamental:

Usuário:
"Quanto custa?"

RUIM:
"Antes, como seus clientes chegam hoje?"

MELHOR:
"[resposta factual concisa sobre preço].
Para eu não te indicar algo à toa: hoje seus clientes chegam
mais por indicação ou você já usa outro canal?"

IMPORTANTE:

Não invente preço.
Não copie preço para o prompt se já existe uma fonte canônica.
A resposta deve vir da fonte de verdade do produto.

==================================================
INTENÇÃO EXPLÍCITA DE COMPRA TEM PRECEDÊNCIA
==================================================

Adicione uma regra forte:

explicit_buy_intent deve permitir avanço imediato para o caminho
de aquisição adequado.

Exemplos:

"quero assinar"
"quero criar meu perfil"
"onde eu pago?"
"manda o plano"
"vou fechar"
"como faço para contratar?"

Não force quatro, cinco ou seis turnos de discovery em alguém
que explicitamente decidiu comprar.

A máquina deve impedir VENDA prematura.

Ela não deve impedir COMPRA prematura.

Projete isso cuidadosamente para não disparar em falsos positivos.

Escreva testes.

==================================================
MELHORIA DO RAIO-X:
DESCOBRIR VERDADE COMERCIAL, NÃO PERSONALIDADE
==================================================

Não tente inferir:

MBTI
Big Five
vulnerabilidades psicológicas
nível de ansiedade
susceptibilidade a gatilhos
perfil emocional secreto

Não precisamos disso.

Personalize com base em contexto comercial declarado.

Considere expandir o modelo conceitual para:

intent
currentChannel
pain
goal
impact

IMPACT significa:

qual consequência comercial relevante decorre da situação atual.

Exemplos:

"dependo de indicação"
→ pain

"quando indicação cai, fico sem serviço"
→ impact

"quero clientes toda semana"
→ goal

Não transforme esses campos em checklist rígido.

Uma única resposta pode preencher vários campos.

Nunca faça uma pergunta cujo dado já está suficientemente claro
na conversa.

Evite interrogatório.

Faça no máximo uma pergunta principal por bolha, salvo necessidade
muito excepcional.

Quando útil, faça reflexão curta antes da pergunta.

Exemplo:

"Então hoje indicação funciona, mas deixa o volume bem irregular.
Quando isso acontece, o que pesa mais para você: ficar sem trabalho
ou não conseguir planejar o mês?"

Mas nunca sugira uma dor que não tenha base na conversa.

==================================================
DISCOVERY SUFFICIENCY
==================================================

Hoje há regras baseadas em quantidade de respostas.

Não remova os pisos atuais cegamente.

Primeiro preserve comportamento e instrumente.

Depois crie uma representação explícita de suficiência da descoberta.

Algo semanticamente equivalente a:

discoverySufficiency = {
  intentKnown,
  acquisitionContextKnown,
  painKnown,
  goalKnown,
  impactKnownOrUnnecessary,
  enoughEvidenceForDiagnosis
}

O número de turnos pode continuar funcionando como:

guardrail
fallback
anti-premature-selling constraint

Mas não deve ser tratado conceitualmente como sinônimo de
"entendimento da pessoa".

Prepare a arquitetura para A/B testing posterior entre:

CURRENT TURN-COUNT POLICY

e

EVIDENCE-SUFFICIENCY POLICY.

Não mude produção sem capacidade de comparar resultados.

==================================================
ESTRATEGIA:
TRANSFORMAR DADOS EM UM DIAGNÓSTICO ÚNICO
==================================================

A estratégia não é um resumo.

É uma interpretação comercial falsificável.

Estrutura desejada:

EVIDÊNCIA
→ PADRÃO
→ UM GARGALO
→ CONFIRMAÇÃO

Exemplo:

"Você disse que quase tudo chega por indicação e que queria ter
mais constância. Então o ponto principal talvez não seja conseguir
fazer bons serviços; parece ser depender de uma única fonte para
o próximo trabalho aparecer. É isso?"

A estratégia:

- não menciona Easy;
- não oferece solução;
- não força concordância;
- não usa medo;
- não afirma algo sem evidência;
- nomeia somente UMA coisa principal.

Considere tornar strategy internamente mais estruturado.

Exemplo conceitual:

strategy = {
  diagnosis,
  evidence[],
  desiredOutcome,
  primaryValueAngle,
  secondaryValueAngle,
  confidence
}

CONFIRMED deve ser estado separado.

Não exponha toda essa estrutura ao usuário.

==================================================
PRIMARY VALUE ANGLE
==================================================

Depois da estratégia, classifique somente a dimensão de valor
que o próprio usuário revelou.

Exemplos permitidos:

growth
predictability
acquisition_diversification
economic_efficiency
control
simplicity
trust
visibility
time_saving
risk_reduction

Isso NÃO é um perfil psicológico.

É uma representação do objetivo comercial explicitamente manifestado.

Exemplo:

Usuário:
"Quero parar de depender só de indicação."

primaryValueAngle:
acquisition_diversification

Não responda com argumentos sobre status, exclusividade ou medo
se isso não tem relação com o que ele disse.

==================================================
CONDUCAO:
UM MOTOR DE BELIEF GAP
==================================================

A principal evolução conceitual da condução deve ser:

não perguntar
"como vendo a Easy?"

perguntar
"o que este comprador ainda precisa entender ou acreditar para
tomar uma decisão informada?"

Antes da resposta, represente conceitualmente:

currentBelief
requiredBelief
beliefGap
bestVerifiedEvidence
nextBestAction

Não é obrigatório persistir tudo se não fizer sentido arquiteturalmente.

Mas a lógica deve existir.

Exemplo:

currentBelief:
"indicação é a única maneira confiável de conseguir clientes"

requiredBelief:
"posso complementar indicação com uma segunda fonte"

beliefGap:
"não vê aquisição como diversificável"

nextBestAction:
"explicar o mecanismo relevante da Easy sem atacar indicação"

A resposta deve atacar SOMENTE o beliefGap mais importante.

==================================================
REGRA DE ARGUMENTAÇÃO
==================================================

Estruture preferencialmente a condução como:

1. retome algo que ele realmente disse;
2. conecte ao diagnóstico confirmado;
3. apresente somente o mecanismo da Easy relevante;
4. explique por que esse mecanismo importa naquela situação;
5. use prova apenas se necessária e disponível;
6. avance uma microdecisão.

Nunca faça feature dumping.

Nunca liste cinco benefícios se um resolve a questão.

Nunca apresente uma característica só porque existe no produto.

A relevância deve vir antes da quantidade de informação.

==================================================
PERSUASÃO PERMITIDA
==================================================

O agente pode utilizar de forma ética e factual:

contextual personalization
framing
contrast
verified social proof
truthful scarcity
loss framing when appropriate
gain framing
commitment/consistency
choice architecture
risk reversal IF REAL
anchoring IF FACTUAL
storytelling based on real cases
future-state visualization without guaranteeing results

Mas essas técnicas são ferramentas subordinadas ao diagnóstico.

O modelo nunca deve "empilhar gatilhos".

==================================================
PERSUASÃO PROIBIDA
==================================================

Nunca:

inventar urgência;
inventar escassez;
inventar número de usuários;
inventar contatos;
inventar depoimento;
inventar case;
inventar economia;
inventar ROI;
inventar popularidade;
inventar ranking;
inventar comparação;
inventar garantia;
inventar disponibilidade;
inventar preço anterior;
inventar desconto;
inventar prazo;
inventar resultado provável;
fingir que o agente é uma pessoa humana;
usar ameaça;
culpabilizar;
humilhar;
inferir vulnerabilidades;
explorar medo sem base;
pressionar depois de recusa explícita.

"Persuasivo" nunca pode significar "enganoso".

==================================================
SOCIAL PROOF
==================================================

Prova social deve vir exclusivamente de dado verificado.

Quanto mais próxima da situação do usuário, melhor.

Preferência:

mesma profissão
> mesma região
> mesmo contexto
> plataforma inteira.

Mas somente se houver dado real.

Crie ou reutilize uma camada de verified claims.

O LLM não deve escrever números livres.

==================================================
CLAIM REGISTRY / PRODUCT TRUTH
==================================================

Audite como o sistema atual fornece:

pricing
plans
features
limits
contacts
promotions
guarantees
cancellation rules
testimonials
statistics
regional availability
signup requirements

Projete uma fonte canônica.

Ideal conceitual:

claim = {
  id,
  value,
  status,
  source,
  validFrom,
  validUntil,
  allowedContexts
}

Não precisa ter exatamente esse schema.

O requisito é:

qualquer claim comercial relevante deve ser verificável e atualizado
fora do LLM.

O prompt nunca deve ser a fonte primária de fatos comerciais que
mudam.

==================================================
LINGUAGEM E REACTANCE
==================================================

A linguagem deve preservar autonomia.

Evite:

"você precisa"
"você tem que"
"a única escolha"
"você não pode perder"
"faça isso agora"
"é óbvio que"
"esse é o plano para você"

Prefira, quando natural:

"pelo que você me contou..."
"nesse cenário..."
"o ponto que eu olharia é..."
"parece fazer mais sentido porque..."
"faz sentido?"
"quer comparar?"
"se o objetivo é X, então Y ganha importância"

Não transforme todas as frases em linguagem tímida.

O agente deve ser confiante quando os fatos permitem.

AUTONOMIA não significa falta de direção.

==================================================
ESTILO
==================================================

O agente é comercial, direto e humano na linguagem.

Não é professor.
Não é coach.
Não é terapeuta.
Não é copywriter de Instagram.
Não é suporte burocrático.

Evite textos longos.

Use a quantidade mínima de texto capaz de:

entender
reformular
provar
avançar.

Uma bolha normalmente deve possuir uma ideia dominante.

Evite dois ou três CTAs diferentes no mesmo turno.

Não elogie genericamente.

Evite:

"Excelente!"
"Perfeito!"
"Maravilha!"
"Entendo perfeitamente!"

quando não acrescentam nada.

Prefira reconhecer informação concretamente.

==================================================
OBJECTION ENGINE
==================================================

Crie ou normalize uma taxonomia de objeções.

Sugestão:

price
trust
need
timing
effort
comparison
risk
understanding
not_interested

O tratamento deve seguir aproximadamente:

ACKNOWLEDGE
→ CLARIFY IF NEEDED
→ DIRECT ANSWER
→ CONNECT TO USER'S OWN VALUE
→ VERIFIED PROOF IF NEEDED
→ ONE NEXT STEP

Exemplo:

"Está caro."

Não presumir automaticamente pobreza ou preço como objeção absoluta.

Pode responder:

"Justo. Então a questão é se o custo consegue se justificar no seu
caso. Como você comentou que hoje depende principalmente de
indicação, eu compararia o plano com o valor de abrir uma segunda
fonte de oportunidades — e não com marketing de forma genérica."

Se houver dados REAIS fornecidos pelo usuário para calcular
break-even, pode calcular.

Não inventar receita média.

==================================================
AQUISICAO
==================================================

Quando o usuário chegou à aquisição, reduza argumentação.

Prioridades:

1. responder dúvida;
2. reduzir risco;
3. simplificar comparação;
4. apresentar melhor encaixe quando houver evidência;
5. signup.

Depois de intenção explícita de compra:

não reabrir discovery;
não contar história;
não criar nova urgência;
não fazer novo pitch longo.

GET OUT OF THE WAY.

==================================================
RECOMMENDED PLAN
==================================================

Se houver mais de um plano, considere recomendação contextual.

Nunca marque um plano como recomendado apenas porque maximiza receita.

A justificativa deve derivar de critérios objetivos relacionados
ao que o usuário declarou.

Armazene:

recommendedPlan
recommendationReason

Exemplo:

"Mais indicado para o que você me contou"

é aceitável se o motivo for demonstrável.

"Mais vendido"

somente se for literalmente verdadeiro e vier da fonte de dados.

==================================================
NEXT BEST ACTION
==================================================

Adicione um conceito central de nextBestAction.

Exemplos:

ask_context
surface_pain
explore_impact
confirm_goal
deliver_diagnosis
clarify_diagnosis
answer_question
explain_relevant_mechanism
show_proof
handle_price
handle_trust
compare_plans
show_plan_card
recommend_plan
signup
respect_exit

O Gemini pode ajudar a escolher entre ações permitidas.

Mas ações críticas e permissões de fase devem continuar protegidas
pelo código.

==================================================
QUESTION POLICY
==================================================

Perguntas servem funções diferentes por fase.

RAIO_X:
descoberta.

ESTRATEGIA:
confirmação do diagnóstico.

CONDUCAO:
avanço da decisão.

AQUISICAO:
remoção da última incerteza ou confirmação da ação.

O prompt deve deixar essa mudança de função extremamente explícita.

==================================================
DIRECT ANSWER FIRST
==================================================

Quando o usuário fizer pergunta factual explícita, responda primeiro.

Não utilize a pergunta dele apenas como ponte para seu script.

Exemplos:

"tem mensalidade?"
"posso cancelar?"
"quanto custa?"
"como funciona?"
"tem plano grátis?"
"vocês cobram comissão?"

Primeiro:
resposta factual.

Depois:
continuação comercial relevante, se necessária.

A IA deve dar ao usuário a sensação de que está conversando com alguém
que escuta, e não com um funil que ignora perguntas.

==================================================
STOP SIGNALS
==================================================

Se o usuário explicitamente disser:

"não quero"
"pare"
"só estava olhando"
"não tenho interesse"
"não quero assinar"

não intensifique pressão.

Pode fazer no máximo o comportamento de saída permitido pelo produto,
sem tentar criar culpa ou medo.

Respeite o encerramento.

==================================================
AI IDENTITY
==================================================

Não finja ser humano.

Não invente cargo, nome humano, experiência pessoal ou história.

Ao mesmo tempo, se a interface já deixa claro que é um assistente
digital da Easy, não é necessário repetir roboticamente a identidade
em todas as respostas.

Se perguntado diretamente, responda com transparência.

==================================================
OBSERVABILITY
==================================================

Instrumente eventos suficientes para reconstruir o funil.

No mínimo, considere:

chat_opened
first_user_response
phase_entered
discovery_field_captured
strategy_generated
strategy_confirmed
strategy_rejected
easy_first_mentioned
plan_card_shown
plan_clicked
signup_clicked
signup_started
signup_completed
subscription_completed
objection_detected
interrupt_triggered
direct_question_answered
conversation_abandoned

Inclua IDs necessários para ligar eventos de uma mesma sessão sem
armazenar dados desnecessários.

==================================================
COMMERCIAL METRICS
==================================================

Métrica final:

paid subscription / eligible paid-traffic session

ou a definição equivalente já utilizada no negócio.

Acompanhe também:

first response rate
raio-x completion
strategy confirmation
strategy rejection
strategy → card
card → click
click → signup
signup → paid
average turns by phase
turns to card
turns after explicit buy intent
dropoff by phase
objection by phase
unsupported claim rate
repeated question rate
direct question ignored rate

Não otimize somente CTR do botão.

Uma resposta que aumenta clique e reduz assinatura não é melhor.

==================================================
EXPERIMENTATION
==================================================

Projete mudanças de forma A/B-testable.

PRIMEIRO TESTE RECOMENDADO:

Control:
fluxo atual.

Variant:
fluxo atual + interruptIntent/direct-answer behavior.

SEGUNDO:

Control:
turn-count phase progression atual.

Variant:
discovery sufficiency + guardrails.

TERCEIRO:

generic Easy argument

vs

diagnosis → relevant mechanism → outcome.

QUARTO:

generic plan card

vs

reasoned contextual recommendation.

Não misture dez mudanças comportamentais em um único experimento
se isso impedir atribuir o resultado.

==================================================
OFFLINE EVALUATION
==================================================

Crie uma suíte de diálogos de regressão.

No mínimo cubra:

lead muito interessado;
lead frio;
respostas monossilábicas;
usuário que pergunta preço imediatamente;
usuário que quer comprar imediatamente;
usuário que pergunta "o que é Easy?";
usuário que rejeita a estratégia;
usuário com dor já muito clara;
usuário sem dor;
usuário que muda de assunto;
objeção preço;
objeção confiança;
objeção concorrente;
objeção "vou pensar";
usuário irritado;
pedido para falar com humano;
pedido para parar;
pergunta de privacidade;
pergunta sobre feature inexistente;
tentativa de induzir o agente a inventar resultados;
usuário que fornece vários discovery fields na mesma mensagem.

Para cada cenário, valide:

phase real;
interrupt;
permissões;
claims;
bodyKind;
cards;
exits;
strategy persistence;
absence of hallucination;
next best action.

==================================================
IMPORTANTÍSSIMO:
NÃO DEIXE O LLM AUDITAR A SI MESMO
==================================================

A fase verdadeira vem do sistema.

Claims verdadeiros vêm da fonte de produto.

Plan eligibility vem do sistema.

Cards permitidos vêm do sistema.

Histórico vem da persistência.

O Gemini interpreta linguagem.

Ele não deve reinventar estado.

==================================================
RESULTADO ESPERADO DA SUA AUDITORIA
==================================================

Depois de ler o código, entregue:

A. mapa do sistema atual;

B. problemas encontrados, classificados em:
   conversion
   state integrity
   prompt behavior
   hallucination risk
   UX friction
   observability
   maintainability;

C. diferenças entre o comportamento atual e esta especificação;

D. arquitetura proposta;

E. mudanças de schema necessárias;

F. mudanças em resolvePhase();

G. proposta para interruptIntent;

H. mudanças de prompt;

I. mudanças de output schema;

J. mudanças de validators;

K. mudanças de analytics;

L. testes unitários;

M. testes de integração;

N. casos conversacionais de regressão;

O. plano de rollout/A-B test;

P. somente depois disso, implemente.

==================================================
PRINCÍPIO FINAL
==================================================

O representante excelente não é aquele que aplica mais técnicas
de persuasão.

É aquele que sabe:

o que perguntar,
quando parar de perguntar,
qual problema o comprador realmente descreveu,
qual conclusão pode legitimamente tirar,
qual parte da Easy é relevante,
qual prova é necessária,
qual objeção está bloqueando a decisão,
qual é a próxima menor decisão,
e quando simplesmente deixar o usuário comprar.

Construa o sistema inteiro em torno disso.
```

A direção estratégica, portanto, é **preservar a separação `raio_x → estrategia → conducao → aquisicao`, mas fazê-la evoluir de um funil rígido para uma máquina de decisão contextual**. A literatura de vendas apoia investigação antes de demonstração de capacidade; pesquisas recentes sobre personalização favorecem relevância contextual; estudos de reactância recomendam linguagem que preserve autonomia; experimentos com IA comercial apontam redução de incerteza como mecanismo de valor; e evidências atuais de comportamento B2B mostram simultaneamente desejo por self-service e superioridade humana em compreensão, confiança e avanço da decisão. citeturn10view2turn12search3turn9view4turn9view2turn11view1turn11view2

Em outras palavras: **a `estrategia` que vocês já criaram é provavelmente mais valiosa do que adicionar dez novos gatilhos mentais**. O salto de qualidade agora está em fazer com que ela produza um diagnóstico baseado em evidência, fazer a `conducao` atacar um único *belief gap* de cada vez e fazer a `aquisicao` desaparecer do caminho assim que o usuário estiver pronto para comprar. Isso transforma o Gemini de “chatbot que sabe vender” em algo muito mais defensável: **um sistema de decisão comercial que aprende com o comprador, constrói valor a partir da realidade dele e otimiza conversão com dados reais**.