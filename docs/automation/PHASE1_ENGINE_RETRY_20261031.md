# ORYNEO — Etapa 1 / motor de automações: checkpoint auditável — 31/10/2026

## Origem e isolamento
- Especificação: `ORYNEO_CODEX_AUTOMACOES_SDR_PIPELINE_2026-10-28(3).zip`.
- Branch originada do commit `b30f9aea970c3332f57b2e2660038a77ad1f0a23` do PR #72 (draft).
- Este incremento está no PR #74 (draft), com **base no PR #72**, não em `main`.
- Nenhum arquivo do SDR legado, WhatsApp operacional, Stripe, pipeline comercial ou landing page foi modificado.

## Verificado antes de alterar
A base anterior já continha graph guard server-side, snapshots publicados imutáveis porém inativos, inbox com deduplicação e lease, shadow planner, timers, outbox com bloqueio, protocolo de reconciliação e API autenticada de rascunhos.

**Lacuna identificada:** o worker capturava exceções por evento sem registrar a causa; aguardava expiração do lease, reduzindo a observabilidade e atrasando a recuperação.

## Mudanças deste incremento
1. `supabase/automation/shadow_failure.preview.sql`: função `automation_shadow_fail` no **SQL de QA isolado**, estritamente `SECURITY INVOKER` e `service_role`, com verificação de token de lease, estado e tentativa. Recebe apenas códigos fixos não pessoais.
2. Retentativas com backoff 30 s, 2 min, 5 min e 15 min; na quinta falha, quarentena imediata. O próximo `claim` sempre usa a mesma inbox idempotente.
3. `supabase/functions/automation-shadow-worker/failurePolicy.ts`: classificação fail-closed; exceções arbitrárias (incluindo mensagens de provedor ou PII) viram `SHADOW_UNEXPECTED_FAILURE`.
4. `supabase/functions/automation-shadow-worker/index.ts`: notifica o RPC em caso de falha, preservando a recuperação antiga se o próprio RPC não responder.
5. `supabase/functions/automation-api/index.ts`: observabilidade de quantidades de eventos falhos, execuções falhas e ações falhas/dead-letter por workspace autenticado, sem payloads.
6. Testes Deno e PostgreSQL 17 descartável na CI. O teste SQL verifica token falso, tentativa dupla, backoff, limite de tentativas, permissões e ausência de envio.

## Não executado e não autorizado neste incremento
- Nenhuma migração deste PR foi aplicada ao Supabase real.
- Nenhum deploy de Edge Function, cron, webhook, alteração de modo, publicação de fluxo, disparo Meta/e-mail, cobrança ou merge.
- Não houve alteração no runtime do SDR atual.
- O frontend da engine e o executor live continuam fora de produção.

## Resultado para a macroetapa 1
**Incremento de confiabilidade implementado e submetido a QA.** Não equivale a finalizar toda a Etapa 1. Ainda faltam compiler/executor live com policy gates por adaptador, roteamento e continuação de timers, integração total e homologação controlada.

## Regras para eventual integração posterior
- Validar o estado da branch base do PR #72 antes de integrar; proibir force push.
- Aplicar migração versionada apenas após validação isolada do SQL, confirmação do estado de produção e autorização específica.
- Em falha, manter `mode=disabled` e `emergency_stop=true`; nunca compensar erro acionando o worker ou autorizando envios.
- Em rollback antes de deploy, abandonar o PR #74 preserva produção intacta.
