# ORYNEO — Checkpoint técnico da engine/editor isolados — 30/10/2026

## Base e limites

- Repo: guilherme-freitas-oryneo/Oryneo_CRM
- Base da branch: 9fb514e7e3f831dee8861176ba7435ba23ba91d4
- PR: #72 (draft). Nenhum merge/deploy/publicação.
- Intocados: App.tsx, pipeline, templates, worker SDR, webhook WhatsApp, outboxes, jobs, triggers e billing.
- Fluxos de exemplo do ZIP são conceituais; não foram nem serão publicados diretamente.

## Entregas deste incremento

- flowDefinition.ts: modelo preliminar, pré-validação de arestas e simulação sem efeitos.
- conditionRules.ts: DSL JSON-only com AND/OR aninhados, comparação, pertencimento e presença. Consulta apenas campos explícitos da allowlist. Usa lógica de três estados: true, false, unknown. Dados ausentes não são interpretados como condições satisfeitas.
- graphEditing.ts: operações imutáveis de rascunho, movimento de nó mantendo edges, conexão com rejeição de ciclos, inserção atômica entre dois nós e undo/redo com limite de histórico. Sem persistência e sem execução externa.
- Testes Vitest específicos para essas regras e operações.

## Verificação do Supabase read-only

Consultas somente leitura confirmaram:
- crm_members contém apenas user_id (sem papel editor/publicador).
- crm_records mantém estrutura genérica id/kind/data/revision/deleted.
- crm_wa_ai_jobs, crm_wa_ai_outbox, crm_automation_jobs e cron do worker existem e devem continuar ativos.
- Ainda não há tabelas de automação versionada/execução propostas pelo ZIP.
- Há divergência entre timestamps das migrações com mesmos nomes lógicos em GitHub e no histórico Supabase.

**Gate de banco:** não emitir DDL nem aplicar migration até definir governança dos papéis viewer/editor/publisher/admin, origem canônica do workspace/tenant e reconciliar histórico de migrações. Nunca abrir tabelas apenas para papel authenticated.

## Próximas etapas obrigatórias para fazer o ZIP funcionar

1. Registry tipado de nós, configurações e portas, incluindo condições compostas e fluxos de intenção; formalizar schema runtime distinto de 0.1-concept e exigir validação server-side.
2. Publicação de versões imutáveis, OCC e auditoria; RLS por membro/workspace/papel.
3. Event adapters em modo espelho não emissor e executor durável com inbox/outbox idempotentes, isolamento e recovery.
4. Interface nativa com React Flow, salvamento, contextual menus, zoom, edge reconnect, undo/redo, inspector, tablet/touch e QA visual.
5. Integrações a Playbook e catálogo comercial aprovados, Meta templates aprovados revalidados no momento do envio, handoff e políticas inalteráveis.
6. Homologação dos 47 cenários da matriz original, incluindo concorrência, suporte mobile e rollback.

## Não homologado

A engine ainda **não tem runtime no Supabase**, nenhum fluxo está publicável, não existe editor visível e os 47 testes de aceite não foram executados. CI dos componentes isolados não comprova a homologação final.

## Regra de preservação

Manter SDR IA e disparos existentes funcionando. Qualquer migração de execução requer comparação em shadow mode e um único dono por efeito; nunca criar segundo executor paralelo para a mesma mensagem, e-mail, pagamento ou atualização de etapa.
