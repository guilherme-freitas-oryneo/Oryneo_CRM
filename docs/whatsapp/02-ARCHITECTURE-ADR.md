# ADR 001 — preparar WhatsApp oficial sem alterar o canal atual

Data: 2026-10-24. Estado: **provisório, sem ativação**.

## Contexto comprovado

O CRM usa React/Vite no GitHub Pages e Supabase para autenticação, dados e Edge Functions. A única ação WhatsApp atual no CRM abre `wa.me`; não há provider de mensagens integrado no Supabase ORYNEO. O MCP Meta foi registrado neste ambiente, mas não autenticado. Portanto, WABA, número, coexistência e permissões ainda não foram examinados.

## Decisão

1. Manter o `wa.me` existente e os fluxos do CRM até haver um canal oficial testado. Não inferir que Evolution/Polaris seja o provider deste CRM; os repositórios Polaris pertencem a outro produto.
2. Preparar contratos de domínio independentes do transporte, usados **no servidor** antes da emissão: autorização por operador/escopo, estado humano/SDR, consentimento, janela de atendimento, template e idempotência. A UI não decide sozinha se uma mensagem pode sair.
3. Fazer Cloud API em Edge Functions com tokens somente em secrets; GET challenge e POST HMAC com corpo bruto, validação antes de persistir, ACK rápido e processamento durável posterior. Introduzir tabelas somente após revisão do esquema real e da identidade de `crm_members`/`crm_records`.
4. Não conectar a automação comercial atual ao WhatsApp até que o lock humano persistente e o bloqueio de opt-out sejam transacionais e testados antes do envio. A origem e os retries devem conservar a mesma chave de idempotência.
5. Adotar Cloud API para o número comercial somente se a leitura de ativos Meta confirmar titularidade, elegibilidade e plano operacional. Coexistência é hipótese, não capacidade comprovada. Fallback mantém o canal atual sem dois emissores simultâneos para o mesmo número.

## Alternativas avaliadas

- Trocar imediatamente o número/provider: rejeitada porque não há OAuth, inventário Meta, staging nem plano de rollback validado.
- Reutilizar serviço `Polaris_Whatsapp_CRM`: rejeitada porque o README o identifica como `wa.polaris`, produto diferente, e não há evidência de isolamento/autorização para ORYNEO.
- Criar nova WABA e novo esquema completo agora: adiada para evitar duplicação de ativo e migration conflitante com material possivelmente local do escritório.

## Contrato de dados a validar antes de migrar

Canal com provider/account/phone ID; conversa vinculada de modo explícito a `crm_records` sem supor que todo telefone é único; mensagem com direção, ID do provedor e chave de idempotência com escopo de canal; eventos de status e inbox/outbox duráveis; consentimento e lock persistentes; policies RLS alinhadas ao modelo real de `crm_members`. Constraints e índices devem ser verificados em staging antes de aplicar ao projeto ativo.

## Critérios para ativação

OAuth e inventário Meta; testes HMAC e replay; permissões por persona; migrations com RLS; envio e recebimento autorizados em staging; SDR bloqueado em `review`, `human_locked` e opt-out; status fora de ordem sem regressão; CI, revisão e smoke test no release. Nenhum destes critérios está declarado concluído por esta ADR.
