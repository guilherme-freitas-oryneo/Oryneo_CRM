# Webhook Meta — estágio de recepção (ainda não ativado)

Data: 2026-10-24. Branch: `feat/whatsapp-forensic-resumption-20261024`.

## Contrato versionado

- `whatsapp-webhook` responde ao `hub.challenge` somente com o token de verificação correto. Em POST, lê no máximo 256 KiB, verifica `X-Hub-Signature-256` sobre os bytes originais e exige um objeto `whatsapp_business_account` com `entry` array.
- Calcula SHA-256 do corpo bruto e grava em `crm_wa_webhook_events` com chave única. Uma repetição idêntica não cria novo evento. Responde 200 apenas após a gravação; falha de banco devolve 503 para permitir retry da Meta.
- A tabela tem RLS ativa e nenhum acesso de `anon`/`authenticated`; apenas `service_role` tem grants. Payloads brutos contêm dados pessoais e não são lidos pelo navegador nem impressos em logs.
- Os eventos ficam em `pending`. Ainda falta consumidor idempotente que normalize mensagens/status, identifique o WABA/número autorizado, aplique política de retenção e exponha conversas ao CRM. **Não configurar o callback no app Meta neste estágio**, pois o receptor sozinho ainda não processa as entregas.

## Configuração quando o fluxo completo estiver pronto

1. Confirmar app e WABA existentes no portfólio do titular; registrar App ID, WABA ID e Phone Number ID em configuração privada. Não criar ativo duplicado.
2. Executar a migração versionada em staging e conferir grants, RLS e deduplicação. Configurar `WHATSAPP_META_APP_SECRET` e `WHATSAPP_WEBHOOK_VERIFY_TOKEN` somente nos secrets da função; não gravar valores no Git, PR ou documentação.
3. Implantar `whatsapp-webhook` com verificação JWT desabilitada **somente para esta função pública de callback**, mantendo verificação de assinatura HMAC obrigatória no POST. A URL será `https://<project-ref>.supabase.co/functions/v1/whatsapp-webhook`.
4. Após consumidor e testes ponta a ponta em staging, registrar a URL e o verify token no app Meta, inscrever `messages` e acompanhar filas, erros, status e duplicatas. Se o processador falhar, suspender o uso do canal e preservar os eventos pendentes para recuperação.

## Evidência local

- `npx vitest run src/whatsapp/webhookHandler.test.ts`: 5 testes aprovados (challenge, assinatura, persistência antes do ACK, falha do banco, limite de corpo).
- `npx deno check --quiet --node-modules-dir=auto supabase/functions/whatsapp-webhook/index.ts`: aprovado.
- Migration aplicada em Postgres 17 descartável: `anon_read=false`, `member_read=false`, `service_insert=true`; segundo insert com o mesmo SHA-256 não criou linha nova. Isso **não** equivale a migração no Supabase ativo.
- Suíte CRM: 278/278; build de produção concluído localmente. Nenhuma mensagem real foi enviada.
