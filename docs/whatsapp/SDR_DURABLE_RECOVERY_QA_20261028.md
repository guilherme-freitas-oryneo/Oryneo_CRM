# SDR WhatsApp — evidência de QA e liberação

Data: 28 de outubro de 2026  
Branch: `feat/whatsapp-sdr-durable-recovery`  
Base auditada: `origin/main` em `2a85d95`

## Escopo concluído na branch

- O webhook assinado persiste a mensagem e cria um job durável antes de confirmar o evento.
- A geração por IA ocorre fora do webhook, com lease, deduplicação, até três tentativas e backoff.
- Resposta vazia, incompleta, limite do provedor, indisponibilidade e timeout recebem códigos operacionais próprios.
- O envio à Meta usa outbox separada e revalida canal, consentimento, janela de 24 horas, modo automático, opt-out, intervenção humana e chegada de mensagem mais nova.
- Timeout depois do despacho vira `uncertain`; o worker não reenvia automaticamente.
- Sucesso grava o ID da Meta e a mensagem do CRM na mesma transação.
- O painel **Saúde da automação**, dentro de **IA e SDR**, mostra apenas totais: aguardando, repetindo, incertos e em revisão.

## Evidência executada

| Verificação | Resultado |
|---|---|
| Testes do contrato OpenAI/Anthropic | aprovado |
| Testes do enfileiramento do webhook | aprovado |
| Worker de geração, 13 cenários | aprovado |
| Dispatcher Meta, 12 cenários | aprovado |
| UI de ajustes e diagnóstico | aprovado |
| Suite Vitest completa | 63 arquivos e 406 testes aprovados |
| Build TypeScript/Vite | aprovado |
| Deno check do worker e dos ajustes | aprovado em Deno 2.5.6 isolado |
| QA SQL em PostgreSQL 17 descartável | aprovado |

O QA SQL cobre mensagem duplicada, supersessão, exclusão entre workers, geração, envio, gravação no histórico, retentativa, takeover humano, cancelamento com lease e bloqueio por RLS.

## Custos

A branch não provisiona serviço, fila ou banco adicional. Ela reutiliza Supabase Postgres, Edge Functions e o segredo de cron já existentes. Os testes não chamaram OpenAI, Anthropic nem Meta e não enviaram mensagens reais.

Quando o modo automático for ativado em produção, cada geração aprovada consumirá a API configurada pelo administrador e poderá gerar cobrança do próprio provedor de IA. Mensagens da Meta seguem a política comercial da conta WhatsApp. O software não consegue transformar essas APIs externas em gratuitas; o modo `off` ou `suggest` impede respostas automáticas.

## Ordem de liberação

1. Aplicar `20261028213000_crm_whatsapp_ai_durable_queue.sql`.
2. Publicar `whatsapp-ai-worker` sem agendamento.
3. Publicar `whatsapp-ai-settings` e `whatsapp-webhook` compatíveis.
4. Confirmar os totais do painel e executar um smoke com conversa de teste.
5. Ativar o cron com o cabeçalho `x-oryneo-cron` já usado pelo projeto.
6. Manter o modo global `off` durante a observação; mudar para `suggest` ou `auto` somente após o smoke.

## Rollback

1. Desativar o cron do worker.
2. Definir o SDR como `off`.
3. Restaurar as versões anteriores das Edge Functions.
4. Preservar as tabelas aditivas para auditoria; não removê-las enquanto houver itens `leased`, `uncertain` ou `human_review`.

## Limites e gates restantes

- Os templates Meta continuam fora do fluxo enquanto estiverem `PENDING`.
- Produção não foi alterada nesta branch.
- Migração, publicação de funções, ativação do cron e mensagens reais pertencem ao checkpoint de release.
- Itens `uncertain` exigem revisão humana porque a Cloud API não oferece idempotência confiável para repetir um POST cujo resultado se perdeu.
