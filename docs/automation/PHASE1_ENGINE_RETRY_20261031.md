# ORYNEO — Macroetapa 1 | motor de automações — checkpoint técnico (31/10/2026)

## Escopo e limites
- Origem: ZIP `ORYNEO_CODEX_AUTOMACOES_SDR_PIPELINE_2026-10-28(3).zip`.
- PR #72: fundação da engine, versão de base `b30f9aea970c3332f57b2e2660038a77ad1f0a23`.
- PR #74: implementação complementar isolada sobre a branch do PR #72, **não sobre main**.
- Preservados: SDR IA e WhatsApp existentes, mail, checkout, Stripe, pipeline, site, Playbook.
- Sem merge para main, migração de produção, cron novo, envio de WhatsApp/e-mail, cobrança ou ativação do runtime.

## Componentes que já existiam no PR #72
- Esquema com isolamento por workspace e RLS, drafts com CAS e versões imutáveis congeladas.
- Event inbox com deduplicação e leases, worker espelho, event adapters CRM e WhatsApp, prevenção de side effects.
- Outbox bloqueada, fences e reconhecimento de recibo externo preparado, sem dispatcher live.
- Timers persistentes e cancelamento por mensagem canônica ou takeover humano.
- Guard de tipos/portas e regras do grafo, catálogo de referências e simulação não emissora.

## Trabalho concluído neste PR #74
1. **Recuperação com causa:** RPC `automation_shadow_fail` com token de lease, falha codificada/sem PII, backoff 30s/2min/5min/15min, quarentena na quinta tentativa. Worker registra a falha sem reconhecer trabalho quando o RPC não responde.
2. **Compilador determinístico:** `executionKernel.ts` valida somente snapshots publicados e referências do backend, cria representação de portas/arestas com hash estável e percorre condições com lógica trivalente. Nenhum plano autoriza dispatch.
3. **Executor por segmentos:** retoma a partir do nó/porta de suspensão, percorre o caminho congelado, suporta `waiting`, `completed`, resultado pendente e bloqueios. Rejeita eventos falsificados, regras desconhecidas, opt-out e atendimento humano.
4. **Worker integrado:** processamento não emissor passa pelo compilador compartilhado; as rotas antigas têm teste de equivalência de trace/hash de ativação.
5. **Continuação de timers:** `automation_wait_shadow_resume` em SQL de QA, com verificação da aresta do grafo, conclusão atômica da rastreabilidade e persistência de efeitos apenas como `blocked`. `automation_wait_shadow_resume_fail` registra backoff e quarentena; worker lê timers `due` não retomados e usa contexto canônico.
6. **Rollback:** `automation_rollback_disabled` troca apenas o ponteiro de versão publicada, sem mutar snapshots, com CAS, papel publicador/admin, audit log e exigência de runtime desativado com parada de emergência.
7. **API:** `publish-disabled` exige compilação server-side; `rollback-disabled` exige papel adequado e validação de revisão; observabilidade expõe apenas contagens sanitizadas por workspace.

## Evidências e gates
- CI do commit `67d0e6f28d121424e38c02a8346bcb9d3ddcc912`: https://github.com/guilherme-freitas-oryneo/Oryneo_CRM/actions/runs/41226627608 — **2/2 jobs aprovados**.
- `schema-isolation`: PostgreSQL 17 descartável, verificações de RLS, publicação, queues, wait atomic, timer continuation, retry, quarantina, rollback e ausência de envio.
- `failure-policy`: Deno typecheck API e worker; testes do compilador, paridade das rotas, erros sanitizados.
- Supabase de produção verificado em leitura: `mode=disabled`, `emergency_stop=true`, workspace inativo; zero fluxos publicados/ativos e zero novas ações.

## Limite objetivo da macroetapa
O motor de cálculo, persistência e recuperação **em modo não emissor** está implementado e seus contratos isolados foram testados. Não existe autorização para declarar o runtime live ou os action adapters de produção homologados. Ações reais via Meta, e-mail, CRM, Stripe e cutover do executor antigo pertencem à Macroetapa 3 e à homologação/deploy posteriores. Os 47 casos de aceite integral do ZIP ainda pertencem à Macroetapa 5.

## Auditoria de segurança / integração futura
- Aplicar SQL novo somente via migração controlada, jamais executar arquivos *.preview.sql diretamente em produção.
- Para deploy do worker, publicar primeiro as RPCs e colunas correspondentes, validar grants, depois verificar funções e smoke sob `disabled`; manter `emergency_stop=true`.
- Nunca ligar `mode=live` antes dos action adapters, controle de único executor, consentimento, templates em tempo real e teste end-to-end autenticado.
- Em caso de conflito, revalidar o head do PR #72 e usar merge normal; sem force push e sem sobrescrever a branch aprovada.
- Rollback antes de deploy: abandonar/reverter o PR #74; produção permanece intacta.
