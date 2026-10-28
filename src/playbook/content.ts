export type Visual = 'plain'|'flow'|'matrix'|'pricing'|'funnel'|'spin'|'timeline'|'dialogue';
export type PlaybookSlide = {id:string;part:string;chapter:string;title:string;lead:string;points:string[];decision:string;visual:Visual;source:string};
export const CONTENT_VERSION = '1.0.0';
export const slides: PlaybookSlide[] = [
  {
    "id": "01",
    "part": "Estratégia",
    "chapter": "Identidade",
    "title": "Venda com direção",
    "lead": "O trabalho comercial da ORYNEO começa com clareza sobre o problema que a empresa precisa resolver.",
    "points": [
      "Não vendemos uma ferramenta isolada: conectamos aquisição, atendimento e acompanhamento.",
      "Cada pergunta deve reduzir incerteza sobre aderência, prioridade ou próximo passo.",
      "Condução ativa não é pressão: é tornar a decisão concreta e verificável."
    ],
    "decision": "Antes de apresentar funções, entenda a operação atual.",
    "visual": "flow",
    "source": ""
  },
  {
    "id": "02",
    "part": "Estratégia",
    "chapter": "Identidade",
    "title": "A proposta de valor",
    "lead": "Crescimento em sistema: marketing, vendas e tecnologia trabalhando com continuidade.",
    "points": [
      "Contato gerado não equivale a oportunidade trabalhada.",
      "O histórico, o responsável e a próxima ação devem permanecer rastreáveis.",
      "O resultado econômico deve ser apurado; não se promete aumento de receita."
    ],
    "decision": "Fale de processo e capacidade, nunca de ganho garantido.",
    "visual": "flow",
    "source": ""
  },
  {
    "id": "03",
    "part": "Estratégia",
    "chapter": "Identidade",
    "title": "A postura ORYNEO",
    "lead": "Precisão, naturalidade e decisão. Atendimento sem teatralização de tecnologia.",
    "points": [
      "Evite slogans vazios, explicações excessivas e a sensação de interrogatório.",
      "Reconheça escolhas já registradas; não faça o lead preencher o mesmo formulário por chat.",
      "Não finja ser uma pessoa específica; esclareça o uso de automação quando perguntarem."
    ],
    "decision": "Uma mensagem, uma intenção comercial.",
    "visual": "plain",
    "source": ""
  },
  {
    "id": "04",
    "part": "Estratégia",
    "chapter": "Cliente ideal",
    "title": "Quem tem fit",
    "lead": "PMEs brasileiras com venda consultiva, fluxo de leads e responsáveis definidos ou em estruturação.",
    "points": [
      "Há oportunidades em múltiplas etapas e necessidade de acompanhamento.",
      "A liderança participa da decisão e designa alguém para implantação.",
      "A empresa consegue participar do diagnóstico, testes e treinamento."
    ],
    "decision": "ICP é hipótese operacional de fit, não um corte arbitrário de faturamento.",
    "visual": "matrix",
    "source": ""
  },
  {
    "id": "05",
    "part": "Estratégia",
    "chapter": "Cliente ideal",
    "title": "Sinais de baixa aderência",
    "lead": "Nem todo cadastro deve virar reunião, proposta ou cliente.",
    "points": [
      "Sem responsável interno ou disposição para implantar: risco de adoção.",
      "Integrações específicas ou exigências regulatórias complexas: avaliar escopo.",
      "Busca por garantia de resultado ou funcionalidade não homologada: não prometer."
    ],
    "decision": "Desqualificar com fundamento preserva tempo e reputação.",
    "visual": "matrix",
    "source": ""
  },
  {
    "id": "06",
    "part": "Estratégia",
    "chapter": "Pessoas",
    "title": "Quem participa da decisão",
    "lead": "O usuário do CRM nem sempre aprova orçamento, contratação e implantação.",
    "points": [
      "Mapeie quem sente o problema e quem responde pela operação.",
      "Identifique quem aprova investimento e quem influenciará a adoção.",
      "Traga pessoas certas à reunião somente quando isso acelerar a decisão."
    ],
    "decision": "Pergunta útil: 'Além de você, quem deve participar dessa avaliação?'",
    "visual": "flow",
    "source": ""
  },
  {
    "id": "07",
    "part": "Estratégia",
    "chapter": "Oferta",
    "title": "Três planos, uma lógica",
    "lead": "Start, Growth e Scale são configurações da operação central de CRM.",
    "points": [
      "Start: até 5 usuários, 3 pipelines, 20 GB; mensalidade de referência R$ 749,90.",
      "Growth: até 10 usuários, 7 pipelines, 50 GB; mensalidade de referência R$ 1.099,90.",
      "Scale: até 20 usuários, 10 pipelines, 100 GB; mensalidade de referência R$ 1.479,90."
    ],
    "decision": "Valores de referência: validar no catálogo e na proposta atual antes de cotar.",
    "visual": "pricing",
    "source": ""
  },
  {
    "id": "08",
    "part": "Estratégia",
    "chapter": "Oferta",
    "title": "Implantação e franquias",
    "lead": "A mensalidade não é a única dimensão da contratação.",
    "points": [
      "Implantação de referência: Start R$ 989,90; Growth R$ 1.389,90; Scale R$ 1.849,90.",
      "Franquias de IA/mês: 1.500, 5.000 e 10.000 respostas, respectivamente.",
      "Minutos de áudio/mês: 300, 700 e 1.200, respectivamente."
    ],
    "decision": "Não afirmar franquia, excedente ou recurso sem confronto com escopo vigente.",
    "visual": "pricing",
    "source": ""
  },
  {
    "id": "09",
    "part": "Estratégia",
    "chapter": "Oferta",
    "title": "Mensal ou anual",
    "lead": "O ciclo altera a condição comercial, não a essência da oferta.",
    "points": [
      "O plano pode ser escolhido na modalidade mensal ou anual.",
      "Referência comercial: 10% de desconto nas mensalidades do ciclo anual pago antecipadamente.",
      "Implantação, complementos e franquias não recebem desconto por inferência."
    ],
    "decision": "Jamais calcular uma cotação final a partir de regra não validada.",
    "visual": "plain",
    "source": ""
  },
  {
    "id": "10",
    "part": "Estratégia",
    "chapter": "Oferta",
    "title": "Complementos vinculados",
    "lead": "Landing page e gestão de tráfego nunca chegam como produtos isolados no funil atual.",
    "points": [
      "O formulário exige plano Start, Growth ou Scale quando há contratação com complementos.",
      "Pode haver landing page, tráfego pago, ambos ou nenhum complemento.",
      "A conversa deve reconhecer o conjunto plano + ciclo + complementos."
    ],
    "decision": "Não tratar landing page e tráfego como serviços avulsos na qualificação.",
    "visual": "flow",
    "source": ""
  },
  {
    "id": "11",
    "part": "Estratégia",
    "chapter": "Jornada",
    "title": "De cadastro a contrato",
    "lead": "O objetivo não é apenas aumentar atividades; é avançar o estado verificável da oportunidade.",
    "points": [
      "Cadastro → contexto → descoberta → qualificação → compromisso síncrono.",
      "Reunião → validação do escopo → proposta → contratação → implantação.",
      "Cada transição exige evidência mínima e próximo responsável."
    ],
    "decision": "Status não é progresso sem ação concreta.",
    "visual": "funnel",
    "source": ""
  },
  {
    "id": "12",
    "part": "Estratégia",
    "chapter": "Jornada",
    "title": "O que o lead já informou",
    "lead": "Informação registrada no formulário reduz perguntas e aumenta precisão.",
    "points": [
      "Nome, WhatsApp, CNPJ, tamanho de equipe, canais de aquisição e prioridades.",
      "Intenção de conversar ou contratar; plano e ciclo quando selecionados.",
      "Complementos e origem da solicitação devem acompanhar o registro no CRM."
    ],
    "decision": "Uma abertura relevante começa onde o formulário terminou.",
    "visual": "matrix",
    "source": ""
  },
  {
    "id": "13",
    "part": "Diagnóstico",
    "chapter": "Entrada",
    "title": "Escolheu contratar",
    "lead": "Alta intenção pede validação objetiva, sem recomeçar a venda do zero.",
    "points": [
      "Confirme o pacote selecionado em linguagem natural.",
      "Identifique só os requisitos indispensáveis para implantação e alinhamento.",
      "Se o processo estiver pronto, avance para próximo compromisso ou contratação assistida."
    ],
    "decision": "Não forçar uma reunião desnecessária para quem já decidiu contratar.",
    "visual": "flow",
    "source": ""
  },
  {
    "id": "14",
    "part": "Diagnóstico",
    "chapter": "Entrada",
    "title": "Escolheu conversar",
    "lead": "Interesse exploratório pede descoberta antes de recomendação.",
    "points": [
      "Reconheça a prioridade declarada no formulário.",
      "Investigue processo atual, gargalo e efeito nas negociações.",
      "Só indique plano ou reunião quando houver vínculo claro com a necessidade."
    ],
    "decision": "O motivo da reunião deve nascer da conversa.",
    "visual": "flow",
    "source": ""
  },
  {
    "id": "15",
    "part": "Diagnóstico",
    "chapter": "Entrada",
    "title": "Abertura contextual",
    "lead": "Toda primeira mensagem deve provar que a ORYNEO leu a solicitação.",
    "points": [
      "Use primeiro nome sem repetir a empresa em excesso.",
      "Reconheça plano, ciclo e complementos apenas quando registrados.",
      "Conclua com uma pergunta que descubra como o trabalho ocorre hoje."
    ],
    "decision": "Evite 'podemos conversar rapidamente?' — conduza pelo contexto.",
    "visual": "dialogue",
    "source": ""
  },
  {
    "id": "16",
    "part": "Diagnóstico",
    "chapter": "SPIN",
    "title": "Situação: diagnóstico enxuto",
    "lead": "As perguntas de situação servem para localizar o contexto, não consumir o tempo do comprador.",
    "points": [
      "Como chegam os contatos? Quem os atende? Onde ficam os registros?",
      "O que já veio do formulário não deve ser perguntado novamente.",
      "Duas perguntas úteis valem mais do que oito perguntas genéricas."
    ],
    "decision": "Pare de investigar a situação assim que houver contexto suficiente.",
    "visual": "spin",
    "source": "Huthwaite — SPIN Selling"
  },
  {
    "id": "17",
    "part": "Diagnóstico",
    "chapter": "SPIN",
    "title": "Problema: a falha operacional",
    "lead": "Descubra o que impede a operação de avançar de forma consistente.",
    "points": [
      "Quando o lead não responde, como o retorno é controlado?",
      "O que acontece quando um vendedor muda de responsável?",
      "Existe dificuldade para enxergar oportunidades sem próxima ação?"
    ],
    "decision": "A descrição do problema precisa ser do comprador.",
    "visual": "spin",
    "source": "Huthwaite — SPIN Selling"
  },
  {
    "id": "18",
    "part": "Diagnóstico",
    "chapter": "SPIN",
    "title": "Implicação: por que importa",
    "lead": "Aprofundar o efeito do problema evita vender uma funcionalidade sem valor claro.",
    "points": [
      "O que acontece quando ninguém percebe uma negociação parada?",
      "Como essa falta de visibilidade afeta a gestão da equipe?",
      "Que retrabalho ocorre quando o histórico se perde?"
    ],
    "decision": "Não invente taxas de perda nem induza números.",
    "visual": "spin",
    "source": "Huthwaite — SPIN Selling"
  },
  {
    "id": "19",
    "part": "Diagnóstico",
    "chapter": "SPIN",
    "title": "Necessidade: valor percebido",
    "lead": "Depois de entender as consequências, ajude a pessoa a definir a condição desejada.",
    "points": [
      "O que mudaria se cada oportunidade tivesse responsável e próxima ação?",
      "Que informação seria essencial para acompanhar a equipe?",
      "Como vocês definiriam que o novo fluxo funcionou?"
    ],
    "decision": "A solução é valiosa quando responde ao problema declarado.",
    "visual": "spin",
    "source": "Huthwaite — SPIN Selling"
  },
  {
    "id": "20",
    "part": "Diagnóstico",
    "chapter": "SPIN",
    "title": "SPIN não é checklist",
    "lead": "A sequência é uma estrutura de raciocínio, não quatro blocos obrigatórios em toda conversa.",
    "points": [
      "Se o lead revelou o problema, avance sem repetir perguntas de situação.",
      "Se a urgência está explícita, investigue impacto e critérios de decisão.",
      "Se o comprador quer avançar, não prolongue artificialmente a descoberta."
    ],
    "decision": "Personalização inclui saber quando parar de perguntar.",
    "visual": "spin",
    "source": ""
  },
  {
    "id": "21",
    "part": "Diagnóstico",
    "chapter": "SPICED",
    "title": "Situação e dor",
    "lead": "SPICED complementa SPIN ao conectar o problema ao momento comercial.",
    "points": [
      "Situation: como a operação funciona hoje?",
      "Pain: onde existe fricção verificável?",
      "Impact: o que muda na operação se o problema continuar?"
    ],
    "decision": "Evite linguagem de certificação; aplique a ideia em perguntas naturais.",
    "visual": "flow",
    "source": "Winning by Design — SPICED"
  },
  {
    "id": "22",
    "part": "Diagnóstico",
    "chapter": "SPICED",
    "title": "Evento crítico e decisão",
    "lead": "A urgência precisa nascer do calendário e das prioridades reais do cliente.",
    "points": [
      "Critical Event: existe contratação, expansão, campanha ou mudança com data definida?",
      "Decision: quem decide, em que prazo e segundo quais critérios?",
      "O prazo dito pelo lead vale mais do que uma escassez inventada."
    ],
    "decision": "Urgência inventada enfraquece a confiança.",
    "visual": "flow",
    "source": "Winning by Design — SPICED"
  },
  {
    "id": "23",
    "part": "Diagnóstico",
    "chapter": "Qualificação",
    "title": "Qualificação proporcional",
    "lead": "Start e Scale podem exigir profundidades diferentes de avaliação.",
    "points": [
      "Start: processo, responsável, aderência e condições comerciais.",
      "Growth: distribuição, gestão de negociações e rotina de acompanhamento.",
      "Scale: requisitos, permissões, integração e envolvidos na decisão."
    ],
    "decision": "O grau de qualificação segue a complexidade, não um formulário único.",
    "visual": "matrix",
    "source": ""
  },
  {
    "id": "24",
    "part": "Diagnóstico",
    "chapter": "Qualificação",
    "title": "MEDDICC simplificado",
    "lead": "Não transformar um método empresarial complexo em burocracia para pequenas empresas.",
    "points": [
      "Dor identificada: qual problema justifica a mudança?",
      "Decisor e processo: quem aprova, avalia e implanta?",
      "Critérios e valor: o que precisa funcionar para justificar a escolha?"
    ],
    "decision": "Registrar o suficiente para tomar a próxima decisão.",
    "visual": "matrix",
    "source": "MEDDICC — recursos públicos"
  },
  {
    "id": "25",
    "part": "Diagnóstico",
    "chapter": "Qualificação",
    "title": "Matriz de aderência",
    "lead": "A prioridade comercial combina fit, intensidade da dor e capacidade de avançar.",
    "points": [
      "Alta aderência + necessidade clara: conduzir com prioridade.",
      "Boa aderência + momento indefinido: acompanhar sem pressão.",
      "Baixa aderência ou escopo inviável: avaliação humana ou encerramento."
    ],
    "decision": "Não usar pontuação matemática sem dados e validação operacional.",
    "visual": "matrix",
    "source": ""
  },
  {
    "id": "26",
    "part": "Diagnóstico",
    "chapter": "Qualificação",
    "title": "O decisor não é obstáculo",
    "lead": "Identifique participantes sem constranger o interlocutor.",
    "points": [
      "Pergunte quem conhece o processo e quem aprova a decisão.",
      "Quando houver múltiplos envolvidos, articule reunião útil para todos.",
      "Não exija sócio ou diretor por princípio para um plano simples."
    ],
    "decision": "A pergunta certa evita reuniões improdutivas.",
    "visual": "dialogue",
    "source": ""
  },
  {
    "id": "27",
    "part": "Diagnóstico",
    "chapter": "Escuta",
    "title": "Uma pergunta por vez",
    "lead": "Mensagens curtas podem carregar raciocínio sofisticado.",
    "points": [
      "Reconheça a resposta antes de avançar para outro tema.",
      "Faça uma pergunta com intenção diagnóstica explícita.",
      "Nunca envie três perguntas empilhadas só para aparentar produtividade."
    ],
    "decision": "A condução é medida pelo aprendizado, não por volume.",
    "visual": "dialogue",
    "source": ""
  },
  {
    "id": "28",
    "part": "Diagnóstico",
    "chapter": "Escuta",
    "title": "Espelhamento sem teatro",
    "lead": "Sintetize para validar entendimento, não para imitar emoções humanas.",
    "points": [
      "'Pelo que você descreveu, o retorno depende de cada vendedor.'",
      "'Então a questão principal é visibilidade do acompanhamento, certo?'",
      "Corrija a hipótese se o comprador discordar."
    ],
    "decision": "Uma boa síntese é o início da proposta de valor.",
    "visual": "dialogue",
    "source": ""
  },
  {
    "id": "29",
    "part": "Diagnóstico",
    "chapter": "Escuta",
    "title": "Quando interromper a descoberta",
    "lead": "Há um ponto em que mais perguntas deixam de ajudar.",
    "points": [
      "Problema, impacto e objetivo já estão claros.",
      "Participantes e próxima decisão estão identificados.",
      "Há motivo concreto para avançar à reunião ou proposta."
    ],
    "decision": "O bom SDR ganha compromisso, não apenas respostas.",
    "visual": "flow",
    "source": ""
  },
  {
    "id": "30",
    "part": "Conversão",
    "chapter": "Valor",
    "title": "Conectar problema à capacidade",
    "lead": "Apresente apenas o que se relaciona à dor explicitamente identificada.",
    "points": [
      "Problema: retornos esquecidos → necessidade de próxima ação rastreável.",
      "Problema: histórico disperso → necessidade de centralização e contexto.",
      "Problema: gestão reativa → necessidade de visibilidade por etapa e responsável."
    ],
    "decision": "Distinguir função disponível, função planejada e serviço adicional.",
    "visual": "flow",
    "source": ""
  },
  {
    "id": "31",
    "part": "Conversão",
    "chapter": "Valor",
    "title": "Venda baseada em valor",
    "lead": "Não use preço baixo ou desconto como substitutos de diagnóstico.",
    "points": [
      "Relacione a oferta à rotina que será reorganizada.",
      "Esclareça esforço de implantação e responsabilidade do cliente.",
      "Não quantifique ROI, faturamento ou melhoria sem evidência."
    ],
    "decision": "Valor é uma hipótese validada em conjunto, não promessa.",
    "visual": "pricing",
    "source": ""
  },
  {
    "id": "32",
    "part": "Conversão",
    "chapter": "Valor",
    "title": "Escolha do plano",
    "lead": "A proposta deve corresponder ao porte e ao modo de operação, não ao desejo de vender mais caro.",
    "points": [
      "Start: equipe menor e necessidade de organização essencial.",
      "Growth: maior número de responsáveis e acompanhamento mais estruturado.",
      "Scale: operação mais abrangente e necessidades superiores de gestão."
    ],
    "decision": "Confirmar limites oficiais no catálogo antes de fechar escopo.",
    "visual": "pricing",
    "source": ""
  },
  {
    "id": "33",
    "part": "Conversão",
    "chapter": "Reunião",
    "title": "Por que uma reunião?",
    "lead": "O encontro síncrono precisa produzir uma decisão ou reduzir uma incerteza relevante.",
    "points": [
      "Pauta: processo atual, requisitos, riscos e próximos passos.",
      "Participantes: quem entende a operação e quem decide, quando necessário.",
      "Saída: diagnóstico concluído, proposta direcionada ou decisão de não avançar."
    ],
    "decision": "Não marcar reunião por marcar reunião.",
    "visual": "flow",
    "source": ""
  },
  {
    "id": "34",
    "part": "Conversão",
    "chapter": "Reunião",
    "title": "Convite com direção",
    "lead": "A proposta de reunião deve refletir o que foi descoberto.",
    "points": [
      "'O problema central é acompanhar negociações sem depender de cada vendedor.'",
      "'Vamos mapear o fluxo e verificar quais requisitos precisam entrar na implantação.'",
      "'Vou conferir dois horários válidos com nossa equipe.'"
    ],
    "decision": "Não oferecer horários não verificados.",
    "visual": "dialogue",
    "source": ""
  },
  {
    "id": "35",
    "part": "Conversão",
    "chapter": "Reunião",
    "title": "Compromisso confirmado",
    "lead": "Pedir um período não é agendar. Agendar exige validação real.",
    "points": [
      "Confirmar disponibilidade em agenda autorizada.",
      "Validar data, horário, fuso, formato e participantes.",
      "Registrar aceite e enviar confirmação conforme regras do canal."
    ],
    "decision": "Sem aceite e agenda, manter status pendente.",
    "visual": "timeline",
    "source": ""
  },
  {
    "id": "36",
    "part": "Conversão",
    "chapter": "Reunião",
    "title": "Estrutura do encontro",
    "lead": "Uma reunião executiva objetiva combina descoberta e decisão.",
    "points": [
      "Abertura: confirmar objetivo e cenário já conhecido.",
      "Diagnóstico: mapear fluxo, responsáveis e pontos de perda de contexto.",
      "Síntese: validar requisitos, responsáveis e próximo compromisso."
    ],
    "decision": "Encerrar com dono, prazo e ação.",
    "visual": "flow",
    "source": ""
  },
  {
    "id": "37",
    "part": "Conversão",
    "chapter": "Demonstração",
    "title": "Mostrar o que importa",
    "lead": "A demonstração não é passeio por todas as telas.",
    "points": [
      "Use um cenário parecido com o funcionamento relatado pelo lead.",
      "Mostre a jornada desde a entrada do contato à próxima ação.",
      "Explique limitações e validações técnicas ainda necessárias."
    ],
    "decision": "Evitar funcionalidades simuladas apresentadas como produção.",
    "visual": "flow",
    "source": ""
  },
  {
    "id": "38",
    "part": "Conversão",
    "chapter": "Objeções",
    "title": "'Já temos CRM'",
    "lead": "A existência de ferramenta não significa ausência de problema — nem autoriza desqualificá-la.",
    "points": [
      "Pergunte o que funciona e onde a operação encontra limite.",
      "Descubra se o problema é uso, processo ou lacuna funcional.",
      "Compare critérios reais, sem depreciar concorrentes."
    ],
    "decision": "Venda o ajuste de processo, não a troca pela troca.",
    "visual": "dialogue",
    "source": ""
  },
  {
    "id": "39",
    "part": "Conversão",
    "chapter": "Objeções",
    "title": "'Está caro'",
    "lead": "Preço deve ser discutido em relação a escopo, necessidade e alternativa.",
    "points": [
      "Confirme se a objeção é mensalidade, implantação ou incerteza de valor.",
      "Retome o problema e o resultado operacional esperado.",
      "Avalie aderência do pacote, sem criar desconto não autorizado."
    ],
    "decision": "Nunca prometer condição fora do catálogo.",
    "visual": "dialogue",
    "source": ""
  },
  {
    "id": "40",
    "part": "Conversão",
    "chapter": "Objeções",
    "title": "'Agora não'",
    "lead": "Uma objeção de tempo precisa revelar prioridade e processo de decisão.",
    "points": [
      "O que precisa acontecer antes de retomar?",
      "Existe evento real que define o momento?",
      "Registrar data apenas quando houver motivo concreto."
    ],
    "decision": "Suspender contato ativo quando não há justificativa.",
    "visual": "timeline",
    "source": ""
  },
  {
    "id": "41",
    "part": "Conversão",
    "chapter": "Objeções",
    "title": "'Preciso falar com meu sócio'",
    "lead": "O desafio é organizar a decisão, não pressioná-la.",
    "points": [
      "Entenda qual aspecto precisa ser validado pelo outro decisor.",
      "Prepare uma pauta objetiva para ambos.",
      "Agende apenas se houver interesse e agenda confirmada."
    ],
    "decision": "O resultado é clareza, não urgência artificial.",
    "visual": "dialogue",
    "source": ""
  },
  {
    "id": "42",
    "part": "Conversão",
    "chapter": "Proposta",
    "title": "Proposta ancorada no diagnóstico",
    "lead": "A proposta deve traduzir a operação desejada em escopo verificável.",
    "points": [
      "Recapitular cenário, prioridades e composição do pacote.",
      "Registrar mensalidade, implantação, ciclo, complementos e limites reais.",
      "Definir responsabilidades, condições e critérios de aceite."
    ],
    "decision": "Sem escopo claro, não antecipar fechamento.",
    "visual": "pricing",
    "source": ""
  },
  {
    "id": "43",
    "part": "Conversão",
    "chapter": "Contrato",
    "title": "Fechamento sem fricção",
    "lead": "O bom fechamento segue uma decisão suficientemente informada.",
    "points": [
      "Responder dúvidas finais sem reabrir temas resolvidos.",
      "Conduzir ao checkout ou contratação assistida correta.",
      "Confirmar pagamento apenas mediante evento confiável do provedor."
    ],
    "decision": "Nunca declarar compra concluída só porque o lead clicou.",
    "visual": "flow",
    "source": ""
  },
  {
    "id": "44",
    "part": "Operação",
    "chapter": "WhatsApp",
    "title": "O canal é uma conversa",
    "lead": "WhatsApp exige clareza, ritmo e memória de contexto.",
    "points": [
      "Mensagens curtas e específicas, sem apresentação corporativa longa.",
      "Perguntas uma a uma, com reconhecimento da resposta anterior.",
      "O conteúdo não deve fingir ser enviado por pessoa real específica."
    ],
    "decision": "Ser natural é diferente de ocultar a natureza do atendimento quando perguntado.",
    "visual": "dialogue",
    "source": ""
  },
  {
    "id": "45",
    "part": "Operação",
    "chapter": "WhatsApp",
    "title": "Template não é conversa livre",
    "lead": "As mensagens de início e retomada precisam seguir as regras atuais da Meta.",
    "points": [
      "Cadastro no site não abre a janela de atendimento de 24 horas.",
      "Fora da janela, utilizar template aprovado e consentimento pertinente.",
      "A IA não pode modificar texto aprovado no momento do disparo."
    ],
    "decision": "Template é gatilho; resposta recebida vira diálogo contextual.",
    "visual": "flow",
    "source": ""
  },
  {
    "id": "46",
    "part": "Operação",
    "chapter": "WhatsApp",
    "title": "Personalização real",
    "lead": "O CRM deve selecionar a mensagem pelo pacote, intenção e prioridade.",
    "points": [
      "Plano: Start, Growth ou Scale; ciclo: mensal ou anual.",
      "Complementos de landing page e tráfego sempre vinculados ao CRM.",
      "Bloquear envio se variável obrigatória estiver ausente ou inválida."
    ],
    "decision": "Não tratar complementos como oferta isolada.",
    "visual": "matrix",
    "source": ""
  },
  {
    "id": "47",
    "part": "Operação",
    "chapter": "Cadência",
    "title": "Régua de contato",
    "lead": "Um intervalo sem resposta não justifica insistência automática infinita.",
    "points": [
      "T+1h: alerta interno, possível ação supervisionada.",
      "T+6h: alternativa contextual ao toque de 1h, não cumulativa.",
      "T+24h, T+72h, T+7 dias: progressão condicionada ao contexto e à autorização."
    ],
    "decision": "Um disparo por marco e cancelamento imediato ao responder.",
    "visual": "timeline",
    "source": ""
  },
  {
    "id": "48",
    "part": "Operação",
    "chapter": "Cadência",
    "title": "Primeira hora",
    "lead": "O primeiro alerta deve orientar o operador, não produzir um disparo impulsivo.",
    "points": [
      "Revisar prioridade e intenção; distinguir contratar de conversar.",
      "Verificar se houve mensagem recebida após o formulário.",
      "Se houver encaminhamento humano ou resposta, cancelar o alerta."
    ],
    "decision": "Primeira hora é diagnóstico operacional do silêncio.",
    "visual": "timeline",
    "source": ""
  },
  {
    "id": "49",
    "part": "Operação",
    "chapter": "Cadência",
    "title": "Seis horas",
    "lead": "Somente uma tentativa contextual para oportunidades justificadas.",
    "points": [
      "Escolher entre o toque de 1h e o de 6h.",
      "Adicionar pergunta diferente da abertura e relevante à dor.",
      "Verificar consentimento, template aprovado e frequência."
    ],
    "decision": "Não fazer sequência 1h + 6h por padrão.",
    "visual": "timeline",
    "source": ""
  },
  {
    "id": "50",
    "part": "Operação",
    "chapter": "Cadência",
    "title": "Vinte e quatro horas",
    "lead": "O segundo ângulo da conversa precisa trazer uma razão para responder.",
    "points": [
      "Explorar consequência de ausência de próxima ação.",
      "Investigar visibilidade e responsabilidade no atendimento.",
      "Não cobrar 'viu minha mensagem?' ou repetir o texto inicial."
    ],
    "decision": "Follow-up bom acrescenta contexto.",
    "visual": "timeline",
    "source": ""
  },
  {
    "id": "51",
    "part": "Operação",
    "chapter": "Cadência",
    "title": "Setenta e duas horas",
    "lead": "Oportunidade com fit pode receber convite orientado à reunião.",
    "points": [
      "Pauta derivada da dor já conhecida.",
      "Pergunta objetiva de participação ou período preferido.",
      "Não simular horários ou confirmação de agenda."
    ],
    "decision": "O objetivo é compromisso, não clique.",
    "visual": "timeline",
    "source": ""
  },
  {
    "id": "52",
    "part": "Operação",
    "chapter": "Cadência",
    "title": "Sete dias",
    "lead": "A última tentativa serve para decidir continuidade comercial.",
    "points": [
      "Reavaliar fit e momento do projeto.",
      "Uma mensagem final com pergunta relevante, sem pressão.",
      "Sem resposta, suspender disparos e registrar motivo operacional."
    ],
    "decision": "A ORYNEO decide quando encerrar a cadência, respeitando recusas.",
    "visual": "timeline",
    "source": ""
  },
  {
    "id": "53",
    "part": "Operação",
    "chapter": "Governança",
    "title": "Transferência humana",
    "lead": "O SDR precisa reconhecer limites de autonomia e preservar contexto.",
    "points": [
      "Escalonar negociação excepcional, questão jurídica e condição não homologada.",
      "Transferir quando houver solicitação explícita de pessoa ou situação sensível.",
      "Entregar síntese: dor, objetivo, plano, perguntas respondidas e próxima ação."
    ],
    "decision": "Troca de responsável não pode apagar o histórico.",
    "visual": "flow",
    "source": ""
  },
  {
    "id": "54",
    "part": "Operação",
    "chapter": "Governança",
    "title": "Dados e consentimento",
    "lead": "Disciplina comercial inclui segurança, privacidade e direito de não receber.",
    "points": [
      "Respeitar objeções ao contato e solicitações de interrupção.",
      "Não incluir CNPJ, dados pessoais ou financeiros desnecessários nos templates.",
      "Registrar consentimento, autoria e motivo do disparo."
    ],
    "decision": "Conversão sustentável exige governança.",
    "visual": "matrix",
    "source": ""
  },
  {
    "id": "55",
    "part": "Operação",
    "chapter": "Governança",
    "title": "Registro no CRM",
    "lead": "Uma boa conversa precisa gerar um próximo passo rastreável.",
    "points": [
      "Atualizar origem, plano, ciclo, complementos e interesse.",
      "Salvar fato informado separadamente de inferência da IA.",
      "Próximo responsável, data e status devem refletir a situação real."
    ],
    "decision": "Sem próxima ação, a oportunidade está sem condução.",
    "visual": "flow",
    "source": ""
  },
  {
    "id": "56",
    "part": "Performance",
    "chapter": "Métricas",
    "title": "Funil que mede decisões",
    "lead": "Mensure mudanças de estágio, não apenas mensagens enviadas.",
    "points": [
      "Cadastro → primeira resposta → qualificação.",
      "Qualificação → reunião agendada → reunião realizada.",
      "Reunião → proposta → contratação."
    ],
    "decision": "Conversão por etapa e coorte revela gargalos.",
    "visual": "funnel",
    "source": ""
  },
  {
    "id": "57",
    "part": "Performance",
    "chapter": "Métricas",
    "title": "Indicadores do SDR",
    "lead": "O indicador central não é quantidade de mensagens.",
    "points": [
      "Reuniões qualificadas realizadas e taxa de comparecimento.",
      "Tempo de primeira resposta e taxa de resposta por origem.",
      "Taxa de transferência humana, motivos de perda e qualidade."
    ],
    "decision": "Interprete métricas por plano, pacote e canal.",
    "visual": "matrix",
    "source": ""
  },
  {
    "id": "58",
    "part": "Performance",
    "chapter": "Métricas",
    "title": "Eficácia dos follow-ups",
    "lead": "Cada marco deve justificar sua existência pelos resultados.",
    "points": [
      "Acompanhe resposta e reunião gerada por tempo de envio.",
      "Compare variantes com grupos e volumes suficientes.",
      "Observe bloqueios, opt-out e qualidade das mensagens."
    ],
    "decision": "Sem dados confiáveis, não atribuir causalidade.",
    "visual": "timeline",
    "source": ""
  },
  {
    "id": "59",
    "part": "Performance",
    "chapter": "Qualidade",
    "title": "Checklist de uma conversa",
    "lead": "A auditoria deve ser objetiva, não apenas uma avaliação de tom.",
    "points": [
      "Contexto do formulário reconhecido e sem repetição.",
      "Dor validada, nenhuma promessa inventada, um próximo passo claro.",
      "Registros completos, consentimento e transferência corretos."
    ],
    "decision": "Defeitos críticos invalidam a conversa mesmo com resposta.",
    "visual": "matrix",
    "source": ""
  },
  {
    "id": "60",
    "part": "Performance",
    "chapter": "Treinamento",
    "title": "Cenário: lead Growth",
    "lead": "Simulação de entrada com Growth anual e prioridade em retornos comerciais.",
    "points": [
      "Abertura reconhece plano e prioridade sem citar recursos irrelevantes.",
      "SPIN explora quem acompanha os leads parados e consequências.",
      "Proposta de reunião resume o problema e pauta."
    ],
    "decision": "Exercício: redigir três mensagens que não repetem perguntas.",
    "visual": "dialogue",
    "source": ""
  },
  {
    "id": "61",
    "part": "Performance",
    "chapter": "Treinamento",
    "title": "Cenário: Scale com complementos",
    "lead": "Simulação de Scale anual + landing page + tráfego pago.",
    "points": [
      "Reconheça o pacote completo, nunca anuncie complementos independentes.",
      "Investigue como aquisição e atendimento se conectam.",
      "Envolva lideranças relevantes para uma reunião com escopo."
    ],
    "decision": "Exercício: mapear responsáveis e resultado esperado.",
    "visual": "flow",
    "source": ""
  },
  {
    "id": "62",
    "part": "Performance",
    "chapter": "Treinamento",
    "title": "Cenário: objeção de preço",
    "lead": "Simulação de resistência ao valor da implantação.",
    "points": [
      "Distinguir mensalidade, implantação e resultado esperado.",
      "Mapear qual requisito é indispensável e qual é opcional.",
      "Não oferecer desconto ou promessa de ROI sem aprovação."
    ],
    "decision": "Exercício: conduzir sem defender preço por ansiedade.",
    "visual": "dialogue",
    "source": ""
  },
  {
    "id": "63",
    "part": "Performance",
    "chapter": "Treinamento",
    "title": "Ritual de melhoria",
    "lead": "Aprendizagem comercial depende de casos reais e revisão contínua.",
    "points": [
      "Selecionar conversas representativas e anonimizar dados.",
      "Identificar perguntas úteis, perdas e compromissos não cumpridos.",
      "Atualizar playbook por versão, preservando anotações individuais."
    ],
    "decision": "Melhoria de scripts deve nascer de evidência.",
    "visual": "flow",
    "source": ""
  },
  {
    "id": "64",
    "part": "Performance",
    "chapter": "Referências",
    "title": "Fontes e limites de uso",
    "lead": "A base metodológica é pública; os exemplos são originais da ORYNEO.",
    "points": [
      "Huthwaite — SPIN Selling; Winning by Design — SPICED; MEDDICC.",
      "HubSpot Academy — Inbound Sales e Sales Enablement; Salesforce Trailhead.",
      "Gong — discovery; Meta — regras de mensagens comerciais. Links e detalhes no painel de fontes."
    ],
    "decision": "Material educacional; não substituir contratos nem políticas vigentes.",
    "visual": "plain",
    "source": ""
  }
];
export const references = [
{title:'Huthwaite — SPIN Selling',url:'https://www.huthwaiteinternational.com/spin-selling/'},
{title:'Winning by Design — SPICED Framework',url:'https://winningbydesign.com/spiced-framework/'},
{title:'MEDDICC — Recursos oficiais',url:'https://meddicc.com/resources'},
{title:'HubSpot Academy — Inbound Sales',url:'https://academy.hubspot.com/courses/inbound-sales'},
{title:'HubSpot Academy — Sales Enablement',url:'https://academy.hubspot.com/courses/Sales-Enablement'},
{title:'Salesforce Trailhead — Discovery',url:'https://trailhead.salesforce.com/pt-BR/content/learn/modules/customer-centric-discovery-strategies'},
{title:'Gong — Discovery',url:'https://www.gong.io/blog/best-discovery-call-tips'},
{title:'Sebrae — Comunicação no Processo de Vendas',url:'https://go.loja.sebrae.com.br/comunicac-o-no-processo-de-vendas-para-pequenos-negocios-1-372000053300'},
{title:'Meta — WhatsApp Business Messaging Policy',url:'https://business.whatsapp.com/policy'}
];
