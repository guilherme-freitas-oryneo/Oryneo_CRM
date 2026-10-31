# ORYNEO — Macroetapa 4 | Inteligência comercial do SDR

**Data:** 31/10/2026  
**Modalidade:** implementação, testes isolados e auditoria técnica. **Sem alteração no CRM publicado, banco hospedado, configurações da Meta ou mensagens.**  
**Repositório:** `guilherme-freitas-oryneo/Oryneo_CRM`.  
**Base preservada:** PR #76 → #75 → #74 → #72.  
**Entrega:** PR #77 em *draft*, base no PR #76.

## 1. Escopo tecnicamente implementado

### 1.1 Conhecimento comercial com fonte vinculada

Os únicos documentos usados como autoridade são o Playbook ORYNEO (`src/playbook/content.ts`, 64 capítulos, versão 1.0.0) e o catálogo de planos/ciclos/complementos (`supabase/functions/_shared/billing/catalog.ts`). A verificação do hash e dos blobs oficiais já existe em `.github/scripts/qa-automation-knowledge-sources.mjs` e continua obrigatória no CI.

- `knowledgePolicy.ts`: seleção por assunto de no máximo três capítulos, com IDs internos `playbook:1.0.0:NN`; consulta ao preço somente pela função canônica `buildBillingQuote`; limites de escopo; instrução expressa de **não vender landing page/tráfego isoladamente**; nenhuma promessa de ganho, prazo, contrato, carência ou cancelamento sem fonte aprovada.
- `runtimeRelease.ts`: vínculo a release publicado e aprovado, hash de fonte conhecido e digest estável do dicionário; sem par ativo ou com qualquer divergência, o contexto fica indisponível e segue para revisão humana.
- Informações de cliente e anexos não passam a ser fonte de verdade: documentos do lead são dados com menor confiança, e somente em modo opt-in são segregados como mensagem de usuário, não como regra de sistema.

### 1.2 Intenção semântica e negativos

- `sdr_intent_candidate.v1.json`: **18 intenções candidatas**, cada uma com exemplos positivos, negativos, sinônimos e nível de risco. O arquivo é **rascunho não aprovado**, não treinamento ativo.
- `intentPolicy.ts`: valida formato estrito, limites e ausência de campos não reconhecidos; identifica negação, pedido, pergunta, referência de terceiro, casos ambíguos e temas sujeitos a revisão.
- Ex.: “quero cancelar”, “posso cancelar”, “não quero cancelar” e “contrato do meu concorrente foi cancelado” não recebem a mesma classificação. Nenhum resultado de classificador autoriza resposta ou efeito externo.
- Temas contratuais ou financeiros sem texto homologado geram revisão humana recuperável; fala do cliente não comprova quitação.

### 1.3 Versionamento, rollback e edição visual

- `sdr_semantic_release.preview.sql`: release de conhecimento + dicionário, revisão otimista (CAS), verificação de papel `publisher/admin`, runtime desligado e parada de emergência; proteção contra alteração de conteúdo publicado.
- O banco possui **CHECK(enabled=false)** e não concede ao serviço permissão de habilitar o par. Publicação é `publishedDisabled`, sem cutover nem disparo. Seleção/rollback de versão mantém o runtime inativo.
- `automation-api`: listagem autenticada, criação de **nova** versão de dicionário e publicação inativa após validação/hashes. Não substitui o dicionário aprovado anterior, não libera mensagens.
- `SdrIntelligencePanel.tsx`: nova aba **Inteligência SDR** no menu Automações, com 18 intenções, edição de exemplos/sinônimos e risco, prévia local sem envio, histórico, criação de nova versão e congelamento inativo com confirmação. Layout mobile, tablet e desktop.

### 1.4 Integração futura com o SDR operacional

- `whatsapp-ai-worker` carrega releases aprovados **somente** se `ORYNEO_SDR_INTELLIGENCE_ENABLED=true`. Default: `false`; o caminho de produção anterior fica intacto.
- Mesmo com a flag, o par selecionado precisa de `enabled=true`, que **não pode** ser concedido por esta etapa. Sem autorização, evita o prompt desatualizado e marca a solicitação como revisão humana.
- `aiJobProcessor`: em modo opt-in, o prompt usa somente o treinamento versionado e os anexos ficam no contexto de usuário; riscos elevados seguem para `SDR_POLICY_HUMAN_REVIEW` sem gerar resposta.
- Modos `review`, `human_locked`, `resolved`, opt-out, consentimento e janela de 24h continuam protegidos pelas rotinas legadas de geração e envio.
- Nenhuma key, número de telefone, mensagem real ou cadastro privado foi lido ou gravado como material de teste.

## 2. Reconciliação oficial Meta (somente leitura)

Em 31/10/2026 foram consultados o **negócio oficial ORYNEO | CRM e Marketing**, sua conta de mensagens oficial, e o registro de modelos pelo conector Meta/WhatsApp Business, e comparados com o `automation_template_registry` do Supabase:

| Evidência | Resultado |
| --- | --- |
| Modelos oficiais consultados | **44** |
| Modelos com estado `APPROVED` | **44** |
| Modelos cadastrados no Supabase | **44** |
| Componentes marcados como verificados | **44** |
| Divergências de nome, ID oficial, status, idioma ou categoria | **0** |
| Disparos ou modificações Meta | **0** |

A observação vale para o **instante da consulta**; não autoriza envios futuros. `metaTemplatePolicy.ts` exige prova **nova** da conta oficial, template ainda `APPROVED`, componentes verificados, variáveis correspondentes e consentimento atual. A flag de simulação `assumeApproved` é **ignorada no preflight live**, por desenho.

## 3. Critérios de aceite

| Matriz | Teste/implementação |
| --- | --- |
| K01 | Complementos nunca são oferecidos sem plano; catálogo canônico |
| K02/B01 | Hash do Playbook e catálogo, versão e ativação explícita; drift bloqueado |
| K03 | Prompt injection e documentos de menor confiança não governam regras |
| S02/S03/S12/S13 | Carência/cancelamento/pagamento, perguntas, negações e contexto de terceiros |
| S09/S10/S11 | Modo humano, consentimento, opt-out e paralisação de IA |
| E07 | Release de dicionário com hash imutável, CAS e rollback |
| B02/E11/E12/C01/C02 | Templates pendentes/pausados, simulação sem envio, prova Meta fresca |
| B03/SDR legado | PR encadeada, origem preservada e treinamento novo default OFF |
| 8 modelos iniciais | Já implantados como **drafts inativos** e cobertos pela regressão herdada |

## 4. Evidência final de CI

O GitHub Actions da branch precisa concluir os quatro jobs `schema-isolation`, `failure-policy`, `crm-regression` e `editor-browser-qa`. A release só é considerada tecnicamente aceita depois da verificação do **HEAD de código**. Os testes Deno cobrem o classificador, recuperação, release, situações de risco e prova Meta; o PostgreSQL 17 é descartável e nenhuma ação sai da sandbox.

**Não confundir:** uma execução com CI verde prova os cenários automatizados; não equivale a conversa real do SDR com cliente, aprovação de termos legais ou ativação de canais no ambiente publicado.

## 5. Limites preservados para as macroetapas 5–6

- **Etapa 5:** 47 cenários da matriz, E2E autenticado, atualização do treinamento e teste de atendimento humano controlado, revisão de latência/custo e cenários de provedores.
- **Etapa 6:** migrações oficiais, confirmação de autoria e aprovação comercial/legal, merge/deploy, eventual pinagem do release, chave opt-in e cutover de execução **com autorização explícita**.
- Na consulta de preparação, o Playbook e o dicionário existentes estavam como **draft**, ambos sem aprovação. Eles **não foram publicados** por este trabalho.
- A Meta pode pausar templates a qualquer momento: somente revalidação online antes do envio pode permitir uma ação real.
- Se algum gate falhar, não habilitar a nova política; o SDR e a mensageria anteriores continuam responsáveis.

## 6. Rollback

Como o trabalho está em branch de desenvolvimento, rollback técnico é não integrar/reverter o PR #77. O banco em produção, a chave de treinamento, o SDR antigo e a conta Meta permanecem sem alteração. Em uma liberação futura, selecionar um snapshot antigo só sob controle de revisão CAS e parada de emergência; a operação **não** altera o conteúdo já publicado.

**Conclusão do desenvolvimento:** o componente da Etapa 4 foi entregue em isolamento e aguarda evidência final de CI e homologação global posterior. Nenhum envio foi autorizado por esta etapa.
