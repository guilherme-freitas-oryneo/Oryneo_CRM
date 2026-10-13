# Release — captação progressiva e primeiro contato

Data operacional: 2026-10-13 (UTC)

## Escopo aprovado

- Formulário progressivo ORYNEO em `/comecar/`, com seis etapas, contexto comercial, múltiplos canais, prioridade e atribuição.
- Primeiro e-mail em dois modelos mestres (`conversation` e `contract`), multipart HTML/texto, wordmark monocromático e conteúdo derivado do lead.
- Pipeline com SLA em horário de São Paulo, envio idempotente, registro de auditoria, ação rápida de WhatsApp e reenvio controlado.

## Gate pré-deploy

| Componente | SHA aprovado | Verificação | Resultado |
| --- | --- | --- | --- |
| CRM | `8503b9b` | 90 Vitest; 45 Deno; typecheck das quatro Edge Functions; build Vite | aprovado |
| Banco | migration `20261013034305_crm_first_contact_sla` | teste SQL transacional em PostgreSQL 17 com IDs reais das etapas | aprovado |
| Landing | `6f9b939` | 23 testes Node; sintaxe dos scripts; ativos, privacidade, watermark e sitemap | aprovado |

Aviso conhecido e não bloqueante: o bundle principal do CRM permanece acima de 500 kB minificado; o build conclui e não houve regressão funcional. Nenhum segredo foi incluído nos artefatos.

## Baseline de produção antes da mudança

- CRM GitHub Pages: `72262bf` (`origin/main`).
- Landing GitHub Pages: `6119edb` (`origin/main`).
- Edge `lead-intake`: versão 4, JWT verificado.
- Edge `mail-api`: versão 4, JWT verificado.
- Pipeline: sete IDs estáveis; 2 oportunidades em `Nova oportunidade` e 0 nas demais etapas.
- Advisors de segurança: 1 informação de RLS sem policy em `crm_intake_requests`; 4 avisos intencionais de funções CRM `security definer` disponíveis a membros autenticados; proteção contra senha vazada desabilitada.
- Advisors de performance: 3 FKs sem índice (`crm_events.actor`, `crm_history.record_id`, `crm_intake_requests.deal_id`) e índices ainda sem uso. Nenhum item crítico.

## Ordem e rollback

1. Banco: aplicar a migration versionada. Em caso de falha posterior, criar migration corretiva que restaure nomes/definições; não apagar leads nem eventos.
2. `lead-intake`: publicar nova versão. Rollback: redeploy da versão 4 capturada antes da mudança.
3. `mail-api`: publicar nova versão. Rollback: redeploy da versão 4 capturada antes da mudança.
4. CRM: promover o SHA aprovado. Rollback: promover `72262bf` sem reverter dados.
5. Homologar SMTP, Enviados, IMAP, resposta e vínculo com destinatário autorizado.
6. Landing: promover o SHA aprovado somente após homologação. Rollback: promover `6119edb`.

## Evidências de rollout

Esta seção deve ser preenchida somente após cada verificação real; ausência de evidência não equivale a aprovação.

| Etapa | Versão/SHA ativo | Evidência redigida | Estado |
| --- | --- | --- | --- |
| Banco e advisors pós-migration | pendente | pendente | pendente |
| `lead-intake` e CORS | pendente | pendente | pendente |
| `mail-api` e autenticação | pendente | pendente | pendente |
| CRM público e sessão autenticada | pendente | pendente | pendente |
| SMTP + Enviados + IMAP + vínculo | pendente | pendente | pendente |
| Landing `/comecar/` e submissões | pendente | pendente | pendente |
| CTAs e smoke conjunto | pendente | pendente | pendente |

## Limites explícitos

- Nenhuma alteração de DNS ou integração Evolution API faz parte desta release.
- A regra de dia útil não inclui calendário de feriados.
- O WhatsApp abre `wa.me`; a conversa integrada ao CRM permanece evolução futura.
