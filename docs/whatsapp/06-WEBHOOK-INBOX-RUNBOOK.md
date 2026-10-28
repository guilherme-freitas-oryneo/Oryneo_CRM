# Webhook Meta — recepção implantada e callback configurado

Data: 2026-10-24. Branch: `feat/whatsapp-forensic-resumption-20261024`.

## Contrato versionado

- `whatsapp-webhook` responde ao `hub.challenge` somente com o token de verificação correto. Em POST, lê no máximo 256 KiB, verifica `X-Hub-Signature-256` sobre os bytes originais e exige um objeto `whatsapp_business_account` com `entry` array.
- Calcula SHA-256 do corpo bruto e grava em `crm_wa_webhook_events` com chave única. Uma repetição idêntica não cria novo evento. Responde 200 apenas após a gravação; falha de banco devolve 503 para permitir retry da Meta.
- A tabela tem RLS ativa e nenhum acesso de `anon`/`authenticated`; apenas `service_role` tem grants. Payloads brutos contêm dados pessoais e não são lidos pelo navegador nem impressos em logs.
- O receptor agora normaliza eventos da conta e do número configurados, grava conversas/mensagens recebidas em tabelas com RLS e conserva eventos de status para reconciliação com futuros envios. Eventos duplicados são ignorados por chaves únicas; erro de persistência impede o ACK e deixa o evento bruto para retry. O vínculo com oportunidades não é inferido pelo telefone. O canal segue com `enabled=false`, sem rota de envio, tratamento de mídia ou política de retenção automatizada.

## Estado remoto em 2026-10-26

- No projeto Supabase `ucikrafwfzamxvweuvgk`, as migrações aditivas `crm_whatsapp_webhook_inbox` e `crm_whatsapp_inbox_read_model` foram aplicadas. O canal ORYNEO foi cadastrado desabilitado com os IDs Meta lidos no onboarding. RLS e grants foram conferidos remotamente: `anon` não lê nenhuma das cinco tabelas; `authenticated` só lê canal/conversas/mensagens e não escreve; eventos brutos e de entrega permanecem service-only.
- `whatsapp-webhook` v2 está ativo com `verify_jwt=false` apenas nesta função. POST exige assinatura HMAC; GET exige verify token. O titular salvou `WHATSAPP_META_APP_SECRET`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_MESSAGING_ACCOUNT_ID` e `WHATSAPP_PHONE_NUMBER_ID` nos Edge Function Secrets. Uma verificação externa retornou 403 para token incorreto e 200 com o desafio exato para token correto. A Chave secreta do app não deve ser enviada por chat nem entrar no Git.
- A conta do número `+5521974510932` foi verificada, registrada e inscrita no app `Oryneo_01`. Após confirmação do titular, a Meta aceitou o callback HTTPS e o campo `messages`. Consulta posterior confirmou ambos e a assinatura da conta. O app continua em desenvolvimento; nenhum POST real nem leitura de mensagem no CRM foram homologados. Não declarar o canal operacional até o POST assinado e a leitura no CRM passarem.

## Configuração restante

1. O titular deve concluir os itens pedidos pela página [Go Live de `Oryneo_01`](https://developers.facebook.com/apps/2617801045397651/go_live/) e publicar o app. Em desenvolvimento, eventos reais podem não chegar mesmo com callback e conta inscritos.
2. Enviar uma única mensagem de uma conta própria ao número comercial, conferir evento assinado no banco e visualização no CRM. Verificar também duplicatas, erro e recuperação sem imprimir conteúdo pessoal em logs. Eventos anteriores à configuração do callback não são retroativos.
3. Conferir capacidade de cobrança no painel Meta. Habilitar envio, mídia e automação apenas após token de sistema, autenticação de operador, lock humano, opt-out, janela de 24h, template aprovado e idempotência estarem ligados à rota real. Não ativar `enabled` antes disso.

## Evidência local

- `npx vitest run src/whatsapp/webhookHandler.test.ts`: 5 testes aprovados (challenge, assinatura, persistência antes do ACK, falha do banco, limite de corpo).
- `npx deno check --quiet --node-modules-dir=auto supabase/functions/whatsapp-webhook/index.ts`: aprovado.
- Migration aplicada em Postgres 17 descartável: `anon_read=false`, `member_read=false`, `service_insert=true`; segundo insert com o mesmo SHA-256 não criou linha nova. Isso **não** equivale a migração no Supabase ativo.
- Suíte CRM: 278/278; build de produção concluído localmente. Nenhuma mensagem real foi enviada.

## Evidência atual (2026-10-26)

- Suíte CRM completa: 49 arquivos, 302 testes aprovados; `npm run build` e `deno check` aprovados.
- Migrações aplicadas no Supabase ativo; grants/RLS consultados no projeto. Canal com `enabled=false`.
- GET de desafio externo validado antes da configuração Meta: 403 com token incorreto e 200 com o desafio exato usando o token correto.
- Meta confirmou callback de `Oryneo_01`, campo `messages` e inscrição da conta ORYNEO. App ainda não publicado; nenhuma entrega POST real foi observada.
