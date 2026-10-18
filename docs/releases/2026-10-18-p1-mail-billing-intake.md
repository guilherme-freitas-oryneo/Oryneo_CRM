# Evidências P1 — MIME, checkout público e confirmação de entrada

Data: 2026-10-18

## Escopo integrado

- PR #28 — leitura pública do checkout sem mutação de estado financeiro (`c49f814`).
- PR #30 — MIME RFC 2045/2046 e primeiro contato sem plano (`160f66f`).
- PR #31 — fila idempotente para confirmação automática de formulário (`56a4dd1`).

## Evidências de integração

- GitHub Actions: CI verde nas três entregas; PR #31 rebaseada e validada no workflow `39169116615` antes do merge.
- Suite local integrada antes da publicação: 27 arquivos, 172 testes aprovados, seguida de build aprovado.
- `billing-public` publicada na Supabase como versão 4, `verify_jwt=false`, mantendo autenticação por token público de alta entropia. A versão publicada contém somente leitura do pedido e consulta de sessão; o webhook continua sendo o único escritor de estado financeiro.
- `mail-api` publicada como versão 16 com o gerador MIME corrigido.
- `intake-mail-worker` publicada como versão 1; chamada sem o segredo interno retorna HTTP 401.
- Migração `20261018174548_crm_intake_confirmation_outbox.sql` aplicada.
- Agendamento `crm-intake-confirmation-every-minute` deliberadamente desativado durante a homologação: nenhum envio externo é permitido antes do teste em caixa controlada.
- Estado posterior à implantação: 0 cron jobs ativos para a confirmação, 0 itens no outbox do sistema e 11 entradas históricas marcadas como `suppressed`.

## Gates preservados

- A apresentação do checkout pode mostrar `processing` após a Stripe informar pagamento, mas não grava `paid`; apenas webhook autenticado confirma estados financeiros.
- Confirmações usam chave idempotente derivada da solicitação e o outbox existente, evitando duplicidade em retries.
- O primeiro contato consultivo aceita lead sem plano selecionado.
- A ativação do cron depende de renderização real em Apple Mail, Gmail e Outlook usando destinatários controlados.

## Estado do lote

Código integrado e serviços publicados. A automação de envio permanece intencionalmente pausada até o gate de renderização controlada; não houve cobrança real nem envio para terceiros neste lote.
