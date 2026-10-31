# ORYNEO — Macroetapa 2 | Construtores visuais Pipeline e SDR
**Auditoria de aceite técnico em 31/10/2026**

## Escopo e histórico preservados
- Fonte de requisitos: `ORYNEO_CODEX_AUTOMACOES_SDR_PIPELINE_2026-10-28(3).zip`, `docs/03_EDITOR_VISUAL_E_IDENTIDADE.md` e `docs/07_PLANO_DE_EXECUCAO_E_ENTREGA.md`.
- Base entregue: PR #72 + PR #74. Esta etapa está isolada no PR #75, branch `feature/oryneo-visual-editors-phase2-20261031`, filha de PR #74.
- O CRM, a sidebar, a linguagem visual, o Playbook e o SDR/WhatsApp existentes não foram sobrescritos. O servidor continua como fonte de verdade de validação e publicação.
- **Sem merge, deploy, alteração de banco, envio WhatsApp/e-mail ou cobrança Stripe**.

## Arquitetura e decisão técnica
O editor já continha um canvas HTML/SVG, registry de nós, regras DSL, CAS remoto e operações imutáveis. Preservar essa base foi preferível a trocar preventivamente todo o canvas por React Flow, o que acrescentaria dependências e riscos de regressão desnecessários neste ciclo. A lógica é mantida em arquivos puros e o editor continua lazy-loaded no CRM.

Arquivos relevantes:
- `src/automation/AutomationsWorkspace.tsx`: biblioteca pesquisável, Palette DnD, handles drag-connect, edições estruturadas, inspetores, trace, histórico, zoom, import/export, painéis.
- `src/automation/editorCommands.ts`: comandos puros para importação isolada, clonagem, seleção múltipla, remoção de aresta e nós, geometria do canvas.
- `src/automation/editorCommands.test.ts`: contratos de importação e idempotência de edição.
- `src/automation/AutomationsWorkspace.test.tsx`: integração de UI em JSDOM.
- `src/automation/api.ts`: leitura autenticada de execução sanitizada, sem PII.
- `src/automation/automations-workspace.css`: ajustes responsivos escopados, handles, labels e painel de diagnóstico.
- `qa/automation-editor/*`: fixture Vite de browser **sem credenciais nem sessão** e testes Playwright em Chromium.

## Definition of Done — Stage 2
| Requisito | Solução | Verificação |
| --- | --- | --- |
| Áreas separadas Pipeline e SDR | Tabs existentes com palettes tipadas, status/drafts isolados | Vitest + Chromium |
| Biblioteca e criação | Botões, clique, drag-and-drop canvas; menu direito na posição escolhida | Chromium |
| Nós e handles | Conexão por clique e arrastar porta para entrada; validador bloqueia inválidas | Unit + Chromium |
| Arestas | Renderização SVG com hit target, rótulo de ramo, click/hover, inserção e reconexão | Unit + Chromium |
| Condições encadeadas | DSL estruturada E/OU e branches yes/no, edição pelo inspetor | Vitest |
| Controle de edição | Histórico undo/redo, remoção atômica, duplicação, enable/disable, multi-select | Unit + Vitest |
| Zoom e navegação | Zoom em controles, scroll/pan, fit real, busca/centralização de nó | Unit + Chromium |
| Import/export | JSON tipado com remapeamento de IDs, limite 250KB e rejeição de keys perigosas | Unit |
| Persistência | LocalStorage por usuário, CAS remoto já existente, reabertura íntegra | Vitest + Chromium |
| Versões | Snapshots imutáveis no servidor, congelamento inativo, runtime live bloqueado | Regressão da Etapa 1 |
| Observabilidade | Lista de execuções e detalhe por nó, ação e espera, apenas campos sanitizados | TypeScript + backend |
| Mobile e acessibilidade | Menu `···` acessível via toque, aria, focus, painéis retráteis, movimento reduzido | Chromium 390/768/1024/1440 |
| Segurança | Zero efeitos remotos em simulação; controle de publicação no backend | Deno/SQL + UI |

## Evidências objetivas
- Suíte completa do CRM: TypeScript+Vite, Vitest e teste de integridade do Playbook, sem dependências de runtime adicionadas.
- Engine preservada: Deno check/test e PostgreSQL 17 descartável (worker, leases, timers, RLS, CAS, rollback) sem efeitos externos.
- Browser Chromium real, 390/768/1024/1440 pixels: Pipeline, SDR, drag-and-drop de palette, handles, inserção em edge, desfazer/refazer, salvar/reabrir, E01/E06; screenshots anexados à execução do GitHub Actions.
- A captura visual foi inspecionada em desktop e mobile; os cards permanecem dentro do viewport quando selecionados, com scroll no canvas em fluxos amplos.
- URL dos jobs e contagem final registrados no PR #75 quando a CI encerrar.

## Limites deliberados
- A etapa entrega o **editor visual completo para preparação, validação e simulação**; a ativação real continua bloqueada.
- Não confundir E07 (publicação de nova semântica de sinônimos no runtime real) com edição visual: depende de release de conhecimento e está na Macroetapa 4. Não simular pagamento real nem template aprovado.
- Não mudar pipelines comerciais, etapas do CRM, Meta, SDR live ou Stripe — pertencem às Macroetapas 3–6.
- Os previews do fixture de testes não são telas publicadas nem simulações geradas artificialmente; são capturas reais do Chromium renderizando o componente do repositório.
- A chave de segurança `emergency_stop` deve permanecer ligada até o cutover autorizado.

## Rollback e release gate
- Como a mudança existe apenas na branch de PR #75, rollback = não integrar ou reverter os commits desse PR; não exige migração SQL e não toca SDR.
- Antes de qualquer deploy, reconciliar HEADs de #72/#74/#75, obter aprovação do release e executar teste autenticado com papéis reais, sem side effects.
- Se qualquer teste final ou revisão visual falhar, não considerar a etapa homologada.

**Conclusão:** Escopo técnico do editor visível e isolado desenvolvido com preservação de produção. Evidências finais ficam nos quatro jobs do CI do PR #75.
