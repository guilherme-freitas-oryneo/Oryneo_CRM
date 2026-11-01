# ORYNEO — Checkpoint mestre de conclusão do ZIP

**Linha de base:** 31/10/2026 (fuso São Paulo).  
**Versão da régua:** 1.0 — congelada.  
**Percentual global estimado:** **77.14%** (= 54 de 70 pontos).  
**Fonte:** `ORYNEO_CODEX_AUTOMACOES_SDR_PIPELINE_2026-10-28(5).zip`, especialmente `docs/07_PLANO_DE_EXECUCAO_E_ENTREGA.md` e `qa/matriz_aceite.csv`.

## Regra obrigatória para auditorias futuras

1. As sete fases F0–F6 têm **peso igual**. Cada fase contém **dez verificações fixas**, totalizando 70 pontos. Não redefinir fases, pesos ou itens a cada conversa.
2. Cada verificação recebe `1` (atendida com evidência observável), `0.5` (parcial ou só em ambiente limitado), ou `0` (não atendida/não comprovada).
3. A fórmula é `100 × (soma das 70 verificações ÷ 70)`. Notas parciais são julgamento técnico explícito, NÃO medidas automáticas de porcentagem de código.
4. Em novas conversas, consultar este checkpoint **ANTES** de auditar, validar GitHub/Supabase/CI e alterar **somente os critérios que receberam evidência nova**, descrevendo `antes → depois`, data, SHA e URL/SQL de verificação.
5. **Nunca** substituir este percentual por outro índice (ex.: só código, só deploy ou apenas preparação operacional). Esses indicadores podem ser apresentados **separadamente**, nunca em lugar do percentual global.
6. O progresso não diminui por troca de conversa. Pode diminuir por **regressão comprovada, invalidade de evidência ou erro encontrado**, com justificativa técnica documentada.
7. `100% do ZIP` exige que todos os 70 itens estejam comprovados; NÃO pressupor execução, aprovação ou envio real sem autorização e critérios jurídicos, comerciais e operacionais.

## Evidências técnicas da linha de base

- GitHub `main` SHA: `870d14ae07c0e52e13272721a753a6d1dc653601`.
- PRs #79, #80 e #81 mesclados; QA principal 5/5 jobs verdes; um workflow de homologação CRM v2.1 mostrou falha, separado do Chrome público aprovado.
- 47/47 IDs da matriz com vínculo a evidências isoladas; 0/47 marcados `liveValidated=true`. Vínculo **não** significa teste live independente.
- Frontend publicado e smoke HTTP/Chrome público (390/1440) aprovado, sem autenticação ao editor.
- Supabase: runtime `disabled`, `emergency_stop=true`; 8 fluxos rascunho, 0 habilitados, 0 versões publicadas, 0 execuções, 0 atestações, 0 canais sob `new_engine`.
- Pipeline mantém `Ganha` e `Implantação` com `outcome=won`. Playbook/dicionário da nova engine ainda não publicados.
- SDR WhatsApp legado funciona de forma independente; isso não demonstra que a nova engine opera live.
- Não ativar a nova engine nem realizar contato/cobrança sem os gates e autorizações necessários.

## Pontuação congelada por fase

| Fase | Pontos (máx. 10) | Percentual |
|---|---:|---:|
| F0 — Diagnóstico e reconciliação | 10 | 100% |
| F1 — Continuidade e confiabilidade do SDR WhatsApp | 9 | 90% |
| F2 — Engine e DSL versionada de automações | 7.5 | 75% |
| F3 — Construtores visuais e menu Automações | 9 | 90% |
| F4 — Pipeline e integrações comerciais | 5 | 50% |
| F5 — Playbook, conhecimento, semântica e Meta | 6 | 60% |
| F6 — QA, CI, publicação e homologação | 7.5 | 75% |
| **Total** | **54 / 70** | **77.14%** |

## Registro granular — 70 verificações

### F0 — Diagnóstico e reconciliação

| Nº | Critério fixo | Nota | Evidência e limite |
|---:|---|---:|---|
| 1 | Inventário do ZIP e dos 47 critérios | 1 | ZIP original auditado; matriz com 47 IDs. |
| 2 | HEAD e repositório canônico identificados | 1 | GitHub main 870d14ae07c0e52e13272721a753a6d1dc653601. |
| 3 | PRs e sequência de integração reconciliados | 1 | PRs #79, #80 e #81 mesclados; PRs drafts preservados. |
| 4 | CI/CD e publicação técnica inventariados | 1 | Workflows de QA, Pages e smoke verificados. |
| 5 | Estado atual do Supabase lido | 1 | Projeto Oryneo-CRM e migrações inspecionados. |
| 6 | Edge Functions da nova engine identificadas | 1 | automation-api v9 e workers hospedados. |
| 7 | Operação legada do WhatsApp diferenciada da engine nova | 1 | SDR legado em auto; engine nova disabled. |
| 8 | Catálogo Meta reconciliado | 1 | 44 templates aprovados, conforme auditoria do conector. |
| 9 | Playbook e catálogo comercial identificados | 1 | Fontes versionadas identificadas; aprovação de uso nova continua na F5. |
| 10 | Riscos, backups e gates de release documentados | 1 | RELEASE_ACTUAL_STATE_20261031.md; rollback não ensaiado, avaliado na F6. |

**Subtotal F0: 10/10.**

### F1 — Continuidade e confiabilidade do SDR WhatsApp

| Nº | Critério fixo | Nota | Evidência e limite |
|---:|---|---:|---|
| 1 | Webhook e inbound persistidos | 1 | Implementação legada com testes de persistência. |
| 2 | Jobs de IA duráveis | 1 | crm_wa_ai_jobs e testes de regressão. |
| 3 | Outbox separada e rastreável | 1 | crm_wa_ai_outbox; um envio legado confirmado no banco. |
| 4 | Tratamento AI_EMPTY_RESPONSE | 1 | Regressão automatizada do cenário S05. |
| 5 | Tratamento incomplete, 429, 5xx e timeout | 1 | Regressão automatizada S04/S06. |
| 6 | Idempotência de mensagens repetidas | 1 | PersistEvent e deduplicação testados. |
| 7 | Ordenação e supersession de jobs | 1 | aiJobProcessor e S08 testados. |
| 8 | Takeover humano cancela automação incompatível | 1 | Políticas S09 e handoff testados isoladamente. |
| 9 | Modos review, resolved e opt-out protegidos | 1 | Políticas S10/S11 com testes. |
| 10 | Homologação prolongada do comportamento real e recuperação de incidentes | 0 | Um envio legado não comprova toda a matriz operacional. |

**Subtotal F1: 9/10.**

### F2 — Engine e DSL versionada de automações

| Nº | Critério fixo | Nota | Evidência e limite |
|---:|---|---:|---|
| 1 | Modelo persistido e versionado | 1 | Migrações e automations schemas hospedados. |
| 2 | Validação e compilação do grafo | 1 | executionKernel.ts e graphGuard.ts testados. |
| 3 | Snapshots e semântica de publicação | 1 | Preflight/publication e testes SQL isolados. |
| 4 | Fila e processamento idempotente | 1 | Ingest/claim e isolamento de entrega testados. |
| 5 | Lease, retry e recovery com fencing | 1 | PR #80 e QA descartável. |
| 6 | Kill switch e controle de acesso | 1 | Runtime disabled, emergency_stop e grants restritivos. |
| 7 | Simulador sem efeitos externos | 1 | Bridge Deno/PostgreSQL e traces isolados. |
| 8 | Adaptadores de todos os eventos e ações efetivas | 0.5 | Planejador CRM e Meta preparatório; canais de e-mail/SDR/wait incompletos. |
| 9 | Execução de fluxo novo publicado completo | 0 | 0 versões published, 0 execuções. |
| 10 | Execução multicanal da nova engine em operação | 0 | 0 canais new_engine, runtime disabled. |

**Subtotal F2: 7.5/10.**

### F3 — Construtores visuais e menu Automações

| Nº | Critério fixo | Nota | Evidência e limite |
|---:|---|---:|---|
| 1 | Menu e ambiente de Automações integrados | 1 | AutomationsWorkspace no main e publicado. |
| 2 | Canvas independentes de Pipeline e SDR | 1 | Dois ambientes e controles em src/automation. |
| 3 | Nós, handles e conexões editáveis | 1 | Testes de componentes/graphEditing. |
| 4 | Menu contextual e inserção de condições | 1 | QA do editor. |
| 5 | Inserção/reconexão em arestas com validação | 1 | Testes do editor em Chromium isolado. |
| 6 | Inspetor e parâmetros tipados | 1 | TypedNodeConfigEditor e testes. |
| 7 | Undo/redo, reposicionamento e reordenação | 1 | editorCommands e testes. |
| 8 | Persistência/abertura de grafos no ambiente de QA | 1 | Testes de API/CAS do editor. |
| 9 | Mobile, teclado e responsividade em QA isolado | 1 | Playwright e smoke Chrome público 390/1440. |
| 10 | Homologação autenticada de edição/publicação completa no ambiente publicado | 0 | Smoke público observou login, não jornada autenticada no editor. |

**Subtotal F3: 9/10.**

### F4 — Pipeline e integrações comerciais

| Nº | Critério fixo | Nota | Evidência e limite |
|---:|---|---:|---|
| 1 | Adaptador de intake e dados canônicos | 1 | Fixtures e stage3 commercial source QA. |
| 2 | Status financeiro proveniente de fonte canônica | 1 | Testes Stripe/order journal e políticas. |
| 3 | Deduplicação e idempotência transacional isoladas | 1 | Stage5 cross-stream journey e QA PostgreSQL. |
| 4 | Interlock de propriedade única por canal | 1 | Fencing e ownership registrados; legado mantém propriedade. |
| 5 | Planner CRM de próxima tarefa com integração efetiva | 0.5 | Planner isolado e hospedado dormant; falta homologação live. |
| 6 | Mudança de etapa e continuação CRM executadas pela nova engine | 0.5 | Código e testes isolados; 0 execuções reais. |
| 7 | Implantação separada do funil comercial | 0 | Implantação e Ganha continuam outcome=won. |
| 8 | Cutover de um executor por canal | 0 | 5/5 canais ainda legacy. |
| 9 | Executor live versionado de e-mail pela nova engine | 0 | Release atual declara caminho incompleto. |
| 10 | Jornada completa de pipeline multicanal homologada | 0 | Sem eventos, ações ou canários novos validados. |

**Subtotal F4: 5/10.**

### F5 — Playbook, conhecimento, semântica e Meta

| Nº | Critério fixo | Nota | Evidência e limite |
|---:|---|---:|---|
| 1 | Playbook oficial versionado disponível em código | 1 | src/playbook/content.ts, 64 capítulos. |
| 2 | Catálogo comercial tratado como fonte canônica | 1 | buildBillingQuote e regras complementos com plano. |
| 3 | Políticas de conhecimento com vínculos e hashes | 1 | knowledgePolicy/runtimeRelease e QA de drift. |
| 4 | Sinônimos, exemplos negativos e guardas de intenção | 1 | 18 intenções candidatas, testes semânticos. |
| 5 | Templates Meta inventariados em registry | 1 | 44 aprovados conforme a auditoria. |
| 6 | Políticas de Meta e prevenção de envio indevido | 1 | Guardas, preview e QA de templates. |
| 7 | Oito jornadas padrão com ações operacionais completas | 0 | 8 drafts; nós limitados a trigger/condition/stop/end e wait. |
| 8 | Playbook e dicionário publicados/ativados na engine nova | 0 | Ambos em draft, 0 published. |
| 9 | Release SDR da nova engine homologada em operação | 0 | automation_sdr_active_release desabilitado. |
| 10 | Consentimento, opt-out e cadência homologados ponta a ponta | 0 | Tabela de consentimento marketing vazia e novos envios off. |

**Subtotal F5: 6/10.**

### F6 — QA, CI, publicação e homologação

| Nº | Critério fixo | Nota | Evidência e limite |
|---:|---|---:|---|
| 1 | Suíte Vitest executada com sucesso | 1 | 532 testes no checkpoint de release. |
| 2 | Playwright isolado executado com sucesso | 1 | 22 testes no checkpoint de release. |
| 3 | PostgreSQL/RLS em ambiente descartável | 1 | QA Automações 5/5 jobs. |
| 4 | Typecheck Deno e contratos de Edge testados | 1 | Registros de CI da release. |
| 5 | Matriz de 47 casos vinculada a evidências existentes | 1 | 47 IDs, todos liveValidated=false; testes podem ser reutilizados. |
| 6 | Frontend publicado e acessível | 1 | GitHub Pages + smoke HTTP. |
| 7 | Edge Functions e migrações implantadas em segurança | 1 | automation-api v9 e banco em NO-GO. |
| 8 | Smoke de navegador completo nas resoluções e sessão autenticada | 0.5 | Chrome público 390/1440 passou; browser não autenticou e workflow CRM v2.1 teve falha. |
| 9 | Teste E2E autenticado e aceite live da nova engine | 0 | 0 execuções e 0 critérios live validados. |
| 10 | Rollback operacional ensaiado de ponta a ponta | 0 | Backups existentes; rollback real ainda não testado. |

**Subtotal F6: 7.5/10.**

## Próximos avanços prioritários

1. Completar os caminhos de execução multicanal, com integração CRM/Meta/e-mail/SDR e espera persistida.
2. Tornar as oito jornadas padrão realmente acionáveis, com validação e publicação segura.
3. Corrigir a distinção entre fechamento Ganha e jornada de Implantação sem perda de histórico.
4. Publicar com aprovação as fontes do conhecimento e condições comerciais/jurídicas; manter opt-in/opt-out.
5. Realizar canário autenticado sem efeitos não autorizados, concorrência, observabilidade, testes de custo e rollback real.

## Referências canônicas

- https://github.com/guilherme-freitas-oryneo/Oryneo_CRM/blob/main/docs/automation/RELEASE_ACTUAL_STATE_20261031.md
- https://github.com/guilherme-freitas-oryneo/Oryneo_CRM/blob/main/qa/acceptance/stage5-evidence-map.json
- https://github.com/guilherme-freitas-oryneo/Oryneo_CRM/actions/runs/41254408854
- https://github.com/guilherme-freitas-oryneo/Oryneo_CRM/actions/runs/41254890926

**Mudanças executadas nesta auditoria:** nenhuma no GitHub, Supabase ou Meta. Este checkpoint foi criado apenas como arquivo local para preservação da metodologia.