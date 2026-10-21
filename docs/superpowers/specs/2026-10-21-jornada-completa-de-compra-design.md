# ORYNEO — Jornada completa de compra e assinatura

**Status:** desenho consolidado a partir da auditoria do código; aguardando revisão antes dos planos de implementação.

## Objetivo

Completar a jornada entre entrada do lead, proposta, cobrança, confirmação financeira, implantação e renovação. A entrega combina um checkout com identidade ORYNEO, cartão e boleto funcionando no fluxo atual, Pix recorrente assistido, e-mails transacionais e cronômetros de automação visíveis no CRM.

O sistema deve ser claro para o cliente, idempotente para a operação e incapaz de liberar serviço por retorno de navegador. TEST e LIVE permanecem separados; nenhuma cobrança real é criada durante a homologação automatizada.

## Estado verificado

Já existem:

- Checkout Sessions com `ui_mode=elements`, Payment Element e endereço de cobrança.
- Correções para confirmação sem `returnUrl` duplicada e coleta de endereço exigida.
- Pedidos financeiros, consentimento comercial versionado e tokens públicos opacos.
- Webhook assinado para eventos de Checkout, faturas e assinaturas.
- Conciliação de renovação principal e da assinatura trimestral de tráfego no cartão.
- E-mail de boas-vindas disparado após pagamento confirmado.
- Fila de automações com retry, reconciliação, Realtime e cronômetro no CRM.
- Dois gatilhos na fila: confirmação de lead e início da implantação.

Ainda faltam:

- Direção visual consistente e responsiva para o checkout.
- Perfil explícito de cobrança por cartão, Pix assistido ou boleto assistido.
- Cobranças Pix avulsas geradas por competência para clientes recorrentes.
- Fila completa para envio da cobrança, lembretes, vencimento e falha de renovação.
- Cronômetros e nomes das novas automações no CRM.
- Estados de revisão operacional para atrasos sem suspensão automática prematura.
- Homologação ponta a ponta de todas as combinações comerciais e métodos elegíveis.

## Princípios

- Eventos financeiros confirmados pela Stripe governam acesso e status; páginas de retorno não governam.
- Preparar uma cobrança e enviá-la são ações diferentes. O CRM exige uma confirmação humana antes do primeiro envio ao cliente.
- Depois do primeiro envio, lembretes e renovações seguem regras automáticas e idempotentes.
- Um trabalho agendado é uma intenção persistida, não um temporizador no navegador.
- O cronômetro apenas apresenta o prazo do servidor; não simula execução.
- Nenhum e-mail de TEST é enviado a destinatário externo não autorizado.
- Não fixar `payment_method_types`; métodos compatíveis são controlados por configuração e elegibilidade Stripe.

## Direção visual do checkout

O checkout adota precisão editorial em vez de estética de template:

- fundo `#F8F7F4`, texto `#0F1115` e ação `#4357E8`;
- sem glow, gradiente, shimmer ou sombra decorativa;
- tipografia Inter com fallback de sistema e corpo mínimo de 14 px;
- divisores e espaçamento substituem o excesso de cartões;
- resumo branco e leve, dividido em `Hoje`, `Próximas cobranças` e `Serviços`;
- método e valor aparecem no CTA: “Pagar … com cartão”, “Gerar Pix …” ou “Gerar boleto …”;
- no celular, pagamento vem antes do resumo detalhado, que pode ser expandido;
- estados de erro ficam próximos ao componente responsável e preservam os dados preenchidos;
- confiança vem de informações verificáveis: valores, vencimentos, recorrência, suporte e processamento Stripe.

Stripe Elements continua responsável pelos campos financeiros. Radix é usado apenas onde seus controles acessíveis já fazem parte do projeto; não será adicionada uma biblioteca visual genérica.

## Métodos de pagamento

### Cartão

Mantém assinatura automática para plano mensal ou anual e assinatura trimestral separada para tráfego. Implantação e landing são itens únicos da primeira cobrança. Carteiras elegíveis continuam sendo apresentadas dinamicamente pela Stripe.

### Boleto

É apresentado como método assíncrono. A interface informa que a compensação não é imediata. O pedido fica `processing` até evento confirmado; não é permitido criar uma segunda cobrança enquanto houver uma obrigação equivalente aberta.

### Pix

Segue `2026-10-21-pix-recorrente-assistido-design.md`. Para conta brasileira, cada competência gera um Pix avulso em BRL. O cliente confirma cada pagamento no banco. A arquitetura guarda o perfil para futura migração a Pix Automático quando a Stripe o disponibilizar à conta.

## Máquina da jornada

### 1. Lead recebido

- Persistir o lead e criar `lead_received_email` para cinco minutos depois.
- Exibir contagem regressiva no CRM.
- Retry exponencial já existente permanece.
- O e-mail confirma recebimento; não promete diagnóstico concluído nem cria cobrança.

### 2. Proposta aceita

- A aceitação registra versão, identidade e snapshot comercial.
- Preparar cobrança cria o pedido, mas não envia mensagem automaticamente.
- O CRM oferece uma ação explícita “Enviar cobrança”.
- A confirmação dessa ação cria `payment_link_email` uma única vez por pedido.

### 3. Cobrança enviada

- O e-mail contém resumo curto, valor de hoje, recorrências futuras e URL opaca.
- Criar `payment_reminder_email` para 24 horas depois somente se o pedido continuar `awaiting_payment`.
- Criar segundo lembrete para 72 horas depois somente se ainda estiver aberto e dentro da validade.
- Pagamento, cancelamento ou expiração cancela lembretes pendentes transacionalmente.

### 4. Pagamento iniciado

- Cartão pode concluir imediatamente ou exigir ação adicional.
- Boleto e Pix entram em `processing` quando a Stripe confirmar a criação do meio assíncrono.
- A interface mostra instruções e permite verificar o estado, sem marcar `paid` localmente.
- O CRM mostra `payment_processing` sem disparar boas-vindas.

### 5. Pagamento confirmado

- Webhook assinado grava `paid` de forma monotônica.
- Enfileirar `payment_confirmed_email`; o envio de boas-vindas existente será migrado para essa fila sem duplicar mensagens.
- Criar ou liberar portal de implantação.
- Próxima ação do negócio passa a “Iniciar implantação”.
- Ao entrar na etapa de implantação, manter o gatilho `implementation_started_email` de cinco minutos.

### 6. Renovação automática por cartão

- `invoice.paid` mantém a assinatura regular e registra competência.
- `invoice.payment_failed` cria `renewal_failed_email` imediato.
- Se continuar pendente, novos trabalhos são criados para 24 e 72 horas.
- Após o último lembrete, criar `financial_review_required`; a primeira versão não suspende automaticamente.

### 7. Renovação Pix assistida

- Criar a obrigação e o Pix sete dias antes do vencimento.
- Enfileirar `pix_due_email` quando a cobrança for criada.
- Se não pago, lembretes em três dias antes e no dia do vencimento.
- Após o vencimento, avisos em um e três dias.
- No quinto dia, criar `financial_review_required`; sem suspensão automática inicial.
- `paid` cancela todas as comunicações futuras da mesma competência.

### 8. Renovação por boleto

- Segue a mesma agenda do Pix assistido, respeitando prazo de compensação.
- O texto não promete baixa imediata.
- Boleto compensado após o vencimento ainda pode concluir a obrigação se a Stripe o confirmar.

## Tipos de automação

A fila passa a aceitar:

- `lead_received_email`;
- `payment_link_email`;
- `payment_reminder_email`;
- `payment_confirmed_email`;
- `implementation_started_email`;
- `renewal_failed_email`;
- `pix_due_email`;
- `assisted_payment_reminder_email`;
- `financial_review_required`.

A unicidade deixa de ser apenas `(deal_id, job_type)`, porque lembretes e renovações se repetem. A chave canônica será `(deal_id, job_type, subject_type, subject_id, occurrence_key)`. `subject_type` distingue pedido, obrigação e fatura; `occurrence_key` identifica a etapa da sequência.

## Interface do cronômetro

O painel mostra todas as automações relacionadas ao negócio, agrupadas em:

- Comercial;
- Pagamento;
- Implantação;
- Renovação.

Cada item exibe nome, prazo absoluto, contagem regressiva, tentativa e estado. Trabalhos cancelados ficam recolhidos. `financial_review_required` aparece como ação humana, sem contagem enganosa nem envio automático.

## Persistência e consistência

- `crm_billing_obligations` representa cada competência financeira de Pix/boleto assistido.
- Uma obrigação contém pedido, tipo, competência, vencimento, valor em centavos, ambiente, IDs Stripe e estado.
- Constraint única impede duas obrigações equivalentes para a mesma competência.
- Jobs de comunicação referenciam seu objeto financeiro e usam claim com `FOR UPDATE SKIP LOCKED`.
- Webhook, mudança da obrigação e cancelamento de jobs relacionados ocorrem na mesma transação RPC.
- TEST e LIVE fazem parte da chave de lookup e nunca compartilham evento, obrigação ou configuração.

## Conteúdo e identidade dos e-mails

- Reutilizar os templates transacionais ORYNEO existentes.
- Cabeçalho preto, wordmark monocromático, fundo marfim e azul somente para CTA.
- HTML e texto simples equivalentes.
- Assunto identifica a ação, não usa urgência artificial.
- Cada mensagem informa ambiente quando for homologação.
- Pix e boleto incluem vencimento, valor e link; o código Pix completo não é enviado em log.
- E-mails de falha explicam próximo passo sem divulgar motivo bancário sensível.

## Segurança

- Segredos ficam somente no Supabase.
- Webhooks validam assinatura, ambiente, conta, moeda, valor e metadados.
- RLS permanece ativa em tabelas expostas; workers usam funções delimitadas.
- Nenhuma função pública aceita valor, Price ID ou Customer ID fornecido pelo navegador.
- Todos os envios e efeitos financeiros são idempotentes.
- Logs usam códigos internos e identificadores parciais, nunca segredos ou dados bancários completos.

## Homologação

Executar em TEST:

1. Cada plano mensal e anual sem complementos.
2. Cada plano com landing, tráfego e ambos.
3. Cartão aprovado, recusado e renovação falha.
4. Boleto criado, pendente, compensado e expirado.
5. Pix criado, pago, expirado e repetido por competência.
6. Evento duplicado, fora de ordem, assinatura inválida e ambiente divergente.
7. E-mails agendados, cancelados, retry, reconciliação e supressão.
8. Cronômetros em Realtime, offline temporário e prazo vencido.
9. Checkout a 320, 390, 768 e 1440 px, teclado, zoom e contraste.
10. Evidência de que a homologação não criou cobrança, e-mail externo ou mutação LIVE.

Um teste real em LIVE somente ocorre por ação de Guilherme, depois de todos os resultados TEST estarem registrados.

## Rollout

1. Mudanças expansivas de banco e workers sem alterar o checkout atual.
2. Nova fila e leitura do CRM atrás de configuração desativada.
3. Checkout visual publicado sem mudar regras financeiras.
4. Fluxos Pix/boleto ativados em TEST.
5. Homologação completa e revisão de segurança.
6. Ativação controlada por método em LIVE, mantendo rollback por configuração.

## Critérios de conclusão

- Checkout responsivo, acessível e coerente com a identidade ORYNEO.
- Cartão e boleto concluem o caminho TEST sem erros de retorno ou endereço.
- Pix aparece somente no fluxo compatível e gera cobrança por competência.
- Nenhum pagamento assíncrono libera serviço antes do webhook.
- Todas as automações possuem status visível, retry e idempotência.
- Itens únicos não reaparecem em renovações.
- Tráfego permanece trimestral e independente.
- Testes e builds passam; logs não expõem dados sensíveis.
- LIVE permanece inalterado até ativação controlada.
