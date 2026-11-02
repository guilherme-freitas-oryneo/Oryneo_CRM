# ORYNEO — Etapa 2: motor durável e adaptadores dormentes

**Data:** 02/11/2026

**Escopo:** contrato publicável, commit transacional, esperas persistentes e executores revisados de e-mail e resposta WhatsApp.
**Estado de release:** preparado e testado de forma isolada; runtime produtivo permanece desligado.

## Entrega

- O validador servidor aceita e-mail e resposta WhatsApp somente quando a referência consta em um registro aprovado.
- O planejador confirma o lote inteiro em uma transação, vinculado à versão publicada e ao lease do evento.
- Esperas live têm registro idempotente, claim com `SKIP LOCKED`, token de fencing, cancelamento por resposta canônica, recuperação de lease vencido e nova checagem de release antes de enfileirar qualquer ação.
- E-mail exige template aprovado, finalidade específica, hash do destinatário consentido, mailbox verificada e preflight imediatamente anterior ao SMTP.
- Resposta WhatsApp exige texto aprovado, consentimento, ausência de opt-out, modo SDR, janela conservadora de 23h55 e preflight imediatamente anterior à Meta.
- Timeout ou perda de resposta após tentativa de provedor vira `uncertain`; nenhum executor faz retry cego.
- O CRM possui endpoints autenticados para ler e revogar consentimentos; as RPCs internas aceitam somente `service_role` e não expõem prova, hash de destinatário ou token.
- O editor consome somente catálogos aprovados e explica que os adaptadores estão dormentes e sujeitos aos gates.

## Evidência isolada

- PostgreSQL 17: `stage2_live_wait_engine.qa.sql`, `stage2_engine_commit.qa.sql` e `stage2_channel_executors.qa.sql` passaram.
- Vitest completo: **83 arquivos, 569 testes**.
- Deno automações: **148 testes**; verificações direcionadas adicionais: **18 testes**.
- Build de produção Vite/TypeScript concluído.
- Rastreabilidade do ZIP preservada em **47/47**, sem converter testes isolados em evidência live.

## Estado de segurança preservado

- Nenhum fluxo foi publicado ou habilitado por esta etapa.
- Nenhum cron foi criado.
- Nenhum owner de canal foi trocado.
- `AUTOMATION_EMAIL_SENDER_ENABLED` e `AUTOMATION_META_REPLY_ENABLED` exigem valor explícito `true`; ausentes, os workers respondem como desabilitados.
- A pontuação congelada permanece **54,5/70 (77,86%)** até existir canário autenticado e evidência live independente.
