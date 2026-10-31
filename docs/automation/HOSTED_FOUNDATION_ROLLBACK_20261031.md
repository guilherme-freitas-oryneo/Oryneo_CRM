# ORYNEO — Runbook de contenção e rollback da fundação hospedada (31/10/2026)

## Estado seguro confirmado
- `main` e `gh-pages` não foram modificadas pela release de Automações.
- Nova engine: `mode=disabled`, `emergency_stop=true`, workspace inativo e 0 fluxos habilitados/executados.
- Ownership dos cinco canais em `legacy`, sem `release_approved_at`, `automation_action_outbox=0`.
- O SDR original, WhatsApp, cobranças Stripe, e-mail e gatilhos legados não foram desligados.

## Mudanças hospedadas
- SQL `20261031214032`: adaptadores comerciais shadow-only, feed canônico e tabela de proprietário dos canais.
- SQL `20261031214115`: continuação de timer, rollback em modo disabled, release semântico imutável e funções CRM com claim exclusivo.
- SQL `20261031214650`: índices das FKs do release SDR.
- Edge `automation-api` v7 (substituiu v6); `automation-shadow-worker` v4 (substituiu v3); `automation-commercial-crm-worker` v1 (opt-in default off). Dois candidatos protegidos `-rc` v1 não são usados pelo frontend.

## Contenção imediata (se houver incidente)
1. Confirmar em SQL somente-leitura `mode`, `emergency_stop`, `active`, `enabled`, ownership e contagens de inbox/outbox; **não afirmar execução em produção sem recibos canônicos**.
2. Como a engine já está desligada e sem cron de despacho, **não alterar os executores legados por reflexo**. Verificar versão/digest da Edge afetada e logs.
3. Se erro estiver exclusivamente em função nova, desativar seu agendamento/flag (caso existam; não criar novas) e registrar evidência. Não permitir dois donos do mesmo canal.
4. Para rollback de Edge, usar **somente uma cópia exata e comprovada** da implantação anterior obtida do histórico do Supabase ou backup de bundle validado; não usar código semelhante nem reimplantar arquivos históricos sem comparar hashes. Aqui se preservaram as versões anteriores no histórico do fornecedor, mas sua capacidade de restauração via API **não foi testada**.
5. Os objetos SQL adicionados são isolados e não emitem mensagens; **não executar DROP** como primeiro recurso. Se for realmente preciso reverter esquema, exigir inventário de dependências, backup verificado e migração compensatória revisada. Não remover tabela, função ou trigger do CRM operacional sem aceitação de impacto.
6. Se um futuro cutover tiver sido autorizado, restaurar cada canal apenas com protocolo de único executor (pausar novo, reconciliar outbox e resultados incertos, retomar legado com idempotência, auditar propriedade). Não fazer simples UPDATE de ownership sem prova de pausa e recuperação.

## Limites desta evidência
- CI isolado não testa autenticação live, envio Meta/SMTP, custos OpenAI nem pagamento.
- O release jurídico-comercial do serviço não foi homologado no documento oficial de 19/10; não utilizar minuta v0.9 como termos vigentes.
- Proteção de senhas vazadas, quatro RPCs SECURITY DEFINER existentes e homologação autenticada real são gates de segurança anteriores a uma ativação live.
- O próprio rollback de Edge exige teste controlado antes de marcar o gate `ROLLBACK_PROVEN` como concluído.

## Critérios de não regressão
- Nenhuma mensagem extra, cobrança, e-mail ou alteração de etapa deve ser provocada por `dry-run`, validação, salvamento, importação ou reabertura de rascunho.
- Meta requer template ainda aprovado no momento do despacho, provedor/conta correto, parâmetros comprovados, consentimento, janela de 24 horas e opt-out.
- Pagamento confirmado exclusivamente por pedido conciliado e webhook Stripe assinado.
- Handoff humano, cancelamento e parada de emergência bloqueiam qualquer resposta automática tardia.

**Status:** fundação hospedada isolada; rollback destrutivo não executado; liberação live NO-GO enquanto gates não forem comprovados.
