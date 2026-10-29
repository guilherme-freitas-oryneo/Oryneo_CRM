# SDR WhatsApp — recuperação durável

## Decisão

Separar o recebimento do webhook, a geração por IA e o envio pela Meta. O webhook termina depois de persistir a mensagem e a intenção de processamento. Chamadas externas ocorrem em worker recuperável, com estados consultáveis e tentativas limitadas.

O desenho usa somente Postgres, Edge Functions e o agendamento HTTP já disponíveis no projeto. A implementação e os testes desta branch não ativam cron, não publicam função, não enviam mensagem e não chamam provedor de IA real.

## Fluxo

1. O webhook valida assinatura e conta, normaliza o evento e persiste a mensagem com deduplicação pelo identificador da Meta.
2. Para texto recebido, uma RPC cria no máximo um job por mensagem. O evento bruto somente passa para `processed` depois desse registro durável.
3. O worker reivindica jobs com lease e exclusão concorrente. Antes de gerar, confere novamente canal, modo global, modo da conversa, opt-out e se existe mensagem mais nova.
4. A geração registra resultado ou erro classificado. Uma resposta válida cria uma ação única na outbox; ela ainda não representa mensagem enviada.
5. O dispatcher reivindica a ação, repete os guards e chama a Meta uma vez. Sucesso persiste o identificador do provedor e a mensagem do CRM. Timeout depois do despacho entra em estado incerto para conciliação, sem reenvio cego.
6. Tentativas esgotadas, configuração inválida e casos sem resposta segura movem a conversa para revisão operacional, preservando o histórico.

## Estados

### Job de IA

`queued → leased → generated | retry_wait | superseded | cancelled | human_review`

### Outbox de envio

`pending → leased → sent | retry_wait | uncertain | cancelled | human_review`

Leases vencidas podem ser reclamadas. `sent`, `cancelled`, `superseded` e `human_review` são terminais. O número de tentativas e o próximo horário ficam persistidos.

## Idempotência e concorrência

- Um job por `inbound_message_id`.
- Uma ação de envio por job.
- Claim com `FOR UPDATE SKIP LOCKED` e lease.
- Somente um job ativo por conversa.
- Mensagem mais nova pode tornar uma geração antiga obsoleta antes do envio.
- Takeover humano e opt-out cancelam jobs e ações ainda não enviados.

## Falhas de provedor

- OpenAI `incomplete`, resposta vazia, HTTP 429, HTTP 5xx e timeout antes de resposta são recuperáveis com backoff limitado.
- Chave inválida, modelo inválido e configuração ausente exigem revisão humana.
- Resposta da Meta com erro conhecido pode repetir conforme classe.
- Timeout após iniciar envio é resultado incerto; exige conciliação e nunca repetição automática imediata.
- Logs registram códigos, tentativas, correlação e duração. Não registram chave, prompt integral, mensagem integral ou telefone.

## Controles comerciais

Este fluxo não movimenta pipeline, não declara pagamento, não cria proposta e não dispara e-mail. Ações financeiras continuam nos webhooks e funções canônicas existentes. Templates Meta pendentes não são utilizados.

## Diagnóstico no CRM

Os ajustes do SDR mostram somente totais operacionais: aguardando, repetindo, incertos e em revisão. Conteúdo de mensagens e identificadores de clientes permanecem fora desse resumo.

## Implantação futura

Aplicar a migração aditiva, publicar o worker sem agendamento, executar smoke isolado, publicar o webhook compatível, ativar o agendamento e observar métricas. O rollback desativa o agendamento e restaura a versão anterior do webhook; tabelas aditivas permanecem para auditoria até encerramento seguro.
