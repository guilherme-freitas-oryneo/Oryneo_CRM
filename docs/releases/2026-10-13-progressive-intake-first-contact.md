# Release — captação progressiva e primeiro contato

Data operacional: 2026-10-13 (UTC)

## Escopo aprovado

- Formulário progressivo ORYNEO em `/comecar/`, com seis etapas, contexto comercial, múltiplos canais, prioridade e atribuição.
- Primeiro e-mail em dois modelos mestres (`conversation` e `contract`), multipart HTML/texto, wordmark monocromático e conteúdo derivado do lead.
- Pipeline com SLA em horário de São Paulo, envio idempotente, registro de auditoria, ação rápida de WhatsApp e reenvio controlado.

## Gate pré-deploy

| Componente | SHA aprovado | Verificação | Resultado |
| --- | --- | --- | --- |
| CRM | `0980f73` + correção `b3dc256` | 90 Vitest; 45 Deno; typecheck das quatro Edge Functions; build Vite | aprovado |
| Banco | migrations `20261013054651` e `20261013060434` | teste SQL transacional no projeto de produção, inclusive privilégios mínimos | aprovado |
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
| Banco e advisors pós-migration | `20261013054651` + `20261013060434` | Teste SQL transacional passou. `service_role` pode ler o contexto do lead, mas não possui escrita direta em `crm_records`; mutação segue pela RPC. Advisors sem regressão em relação ao baseline. | aprovado |
| `lead-intake` e CORS | Edge v5 | Preflight público retornou 204 para a origem do GitHub Pages. Payload legado, payload progressivo e submissão da página publicada retornaram 200. | aprovado |
| `mail-api` e autenticação | Edge v9, JWT obrigatório | Versão final sem rota temporária; três chaves de homologação removidas e contagem confirmada em zero. Reuso do antigo cabeçalho retornou 401. | aprovado |
| CRM público e sessão autenticada | Pages `0980f73`, run `38353480904` | Página pública retornou 200; autorização de membro e ações da interface cobertas pela suíte automatizada. Nenhuma senha do usuário foi alterada ou reutilizada. | aprovado |
| SMTP + Enviados + IMAP + vínculo | SMTP/IMAP Hostinger, 2026-10-13 | Os dois modelos foram aceitos pelo SMTP com uma tentativa cada e sincronizados em `INBOX.Sent`. Retry da mesma chave retornou `alreadyAccepted=true`, mantendo um outbox e um evento. Loop de recebimento importou uma mensagem e a deduplicou entre `INBOX` e `INBOX.Sent`. Etapas permaneceram inalteradas e o próximo passo foi atualizado. | aprovado |
| Landing `/comecar/` e submissões | Pages `6f9b939`, run `38355455083` | `/`, `/comecar/`, privacidade e wordmark retornaram 200. Submissão pública controlada criou o lead `b5a8c33a-c96e-429e-9fb7-e52817449bf5` com cotação, múltiplos canais, prioridades, atribuição e SLA íntegros. | aprovado |
| CTAs e smoke conjunto | `6f9b939` + Edge v5/v9 | CTAs comerciais apontam para `/comecar/`; formulário exibe seis etapas, consentimento, marca d'água monocromática e transporte resiliente. | aprovado |

## Homologação operacional

- Conversa: assunto `Sua solicitação na ORYNEO`, enviada para endereço controlado, outbox `sent`, uma tentativa, um evento.
- Contratação: assunto `Próximo passo da sua solicitação — ORYNEO`, enviada para endereço controlado, outbox `sent`, uma tentativa, um evento.
- Recebimento: mensagem controlada presente em uma única entidade de mensagem, localizada tanto em `INBOX` quanto em `INBOX.Sent`.
- Sincronização: 33 execuções bem-sucedidas e nenhuma falha nos 30 minutos finais da homologação; backlog zero nas execuções manuais.
- Segurança: a janela de homologação existiu apenas nas versões intermediárias 6–8; a versão ativa 9 contém exclusivamente a autenticação normal por usuário/membro.

## Limites explícitos

- Nenhuma alteração de DNS ou integração Evolution API faz parte desta release.
- A regra de dia útil não inclui calendário de feriados.
- O WhatsApp abre `wa.me`; a conversa integrada ao CRM permanece evolução futura.
