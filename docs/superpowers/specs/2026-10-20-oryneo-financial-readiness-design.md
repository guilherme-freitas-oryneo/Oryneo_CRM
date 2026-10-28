# ORYNEO — prontidão financeira e jornada comercial

**Status:** proposta aprovada em conversa; aguardando revisão desta especificação antes do plano de implementação.  
**Ambiente atual:** Supabase existente, sem branches pagos; Stripe TEST para homologação; Stripe LIVE preservado.

## Objetivo

Deixar a jornada comercial e financeira pronta para testes controlados, cobrindo os planos e adicionais já cadastrados, os meios de pagamento que podem ser oferecidos com segurança e os e-mails disparados por mudanças de etapa. Só declarar uma combinação disponível quando o fluxo completo tiver evidência: catálogo validado no servidor, pedido persistido, pagamento confirmado por webhook, CRM atualizado e mensagens coerentes com o estado financeiro.

## Entendimento e limites aprovados

- O usuário quer testar Start, Growth e Scale, nos ciclos mensal e anual, com os adicionais já cadastrados (landing page e gestão de tráfego) e as formas de pagamento oferecidas pela ORYNEO.
- TEST e LIVE permanecem estritamente separados. Homologação não usa clientes, pedidos, mensagens nem gatilhos comerciais LIVE.
- Não criar Supabase branches pagos. Usar o schema privado de QA existente, mantendo as tabelas/RPCs de QA isoladas e sem triggers comerciais.
- Não expor chaves, tokens, dados de cartão ou client secrets em código público, logs, documentação ou commits.
- Não declarar pagamento com base na página de retorno, em sessão criada, fatura aberta ou assinatura ativa. Somente confirmação Stripe válida e reconciliada pode liberar provisionamento e e-mail de boas-vindas.
- Pix é pagamento avulso/pré-pago do período claramente indicado na tela; não cria renovação automática. A renovação futura exige uma nova cobrança explicitamente apresentada e aceita.
- Boleto pode iniciar uma assinatura com fatura e liquidação assíncrona, mas nenhuma etapa é considerada homologada até confirmação via webhook assinado.
- A solicitação de lead continua sem cobrança automática. O checkout começa somente após o fluxo comercial aprovar e registrar os termos do pedido.
- Não realizar cobrança LIVE como parte da homologação. O LIVE atual de checkout/cartão e seu webhook devem permanecer operacionais e sem alterações até a homologação TEST estar concluída e revisada.

## Estado observado que orienta o trabalho

- O PR #46 está aberto e em draft; não está mesclado.
- Supabase contém as Edge Functions de checkout LIVE, webhook LIVE e QA separadas. A função QA de não-cartão está na versão 6; o CORS local testado no PR ainda não foi implantado.
- O schema `oryneo_financial_qa` tem isolamento e política de identidade. Nenhum branch pago será necessário.
- O catálogo de aplicação contém 3 planos × 2 ciclos, implantação para cada plano, adicional landing page avulso, e adicional de tráfego com valor inicial de 3 meses e preço de renovação trimestral.
- O código QA de boleto recusa tráfego; portanto, não existe hoje suporte integral a todas as combinações solicitadas.
- Pix é construído como Checkout de pagamento único. Não há renovação automática Pix implementada.
- O banco CRM já possui automações de e-mail para lead recebido e início de implantação, mas os fluxos devem ser verificados contra pagamento confirmado, idempotência, consentimento, retry e destinatário antes da liberação.
- O conector Stripe não forneceu o contexto de conta apesar de indicar autenticação aceita. O acesso à API Stripe e a inspeção de configuração devem ser restabelecidos antes de qualquer mutação Stripe ou teste de transação.
- O deploy QA anterior foi negado pela revisão automática por limite de uso; não será contornado. Um novo deploy só será tentado quando o caminho oficial permitir.

## Arquitetura proposta

### 1. Catálogo e cotação

Manter os valores canônicos em centavos e validar no servidor os Price IDs, moeda, valor, intervalo, estado ativo e modo (`livemode`). O browser envia apenas a seleção lógica (plano, ciclo e adicionais), nunca preços ou IDs Stripe confiáveis. A interface deve mostrar separadamente o total inicial, componentes avulsos, recorrências subsequentes, período contratado e qualquer compromisso mínimo.

Cobrir os seis pares de plano/ciclo e suas combinações permitidas com landing page e tráfego. Uma matriz de testes deve conferir as cotações sem criar sessões ou pedidos externos. Qualquer preço ausente ou divergente falha fechado e não tenta cobrança.

### 2. Fluxo por meio de pagamento

- **Cartão:** preservar o checkout e webhook LIVE atuais. Em TEST, verificar primeira cobrança, recorrências, pagamento recusado, renovação, falha e cancelamento. Métodos elegíveis devem seguir configuração dinâmica do Stripe; não fixar `payment_method_types` fora da exceção de Terminal.
- **Boleto:** manter criação de invoice/subscription em TEST. A fatura aberta/hosted não libera serviço. Implementar os adicionais apenas com modelo de recorrência que Stripe suporte e que a tela explique. Validar documentalmente e por chamada TEST se itens de recorrências distintas podem compartilhar assinatura; se não, usar cobranças trimestrais explicitamente conciliadas e idempotentes, sem fingir que são parte da renovação mensal/anual do plano.
- **Pix:** pagamento único para o prazo especificado no resumo comercial; confirmação assíncrona por webhook. Não representar mensal/anual como assinatura automática. O CRM deverá oferecer renovação manual em nova cobrança depois da expiração/aviso, sem cobrança silenciosa.

Não oferecer combinações não implementadas. O checkout deve comunicar indisponibilidade e conservar a seleção em vez de degradar silenciosamente para outro método.

### 3. Pedido, conciliação e provisionamento

Continuar separando `checkout-intake-noncard-test` e `stripe-webhook-financial-qa` das funções comerciais. Criar/vincular pedidos com idempotência estável e dados mínimos. Validar assinatura do webhook sobre o corpo bruto, ambiente TEST, associação entre pedido/cliente/sessão/fatura/assinatura, moeda, total e prova de pagamento. Registrar o evento antes de efeitos posteriores; evento duplicado não repete provisionamento nem e-mail. Evento fora de ordem não rebaixa pedido pago.

Fatura `open`, `paid_out_of_band`, sessão `unpaid` ou assinatura `active` sem transação liquidada não contam como pagamento. Divergências vão para `requires_review` e não disparam provisionamento. Reembolsos, chargebacks, inadimplência e cancelamento não serão apagados nem tratados como pagamento novo; cada transição será auditável.

### 4. Gatilhos e e-mails

Preservar a automação de recebimento de lead e verificar sua associação ao consentimento e ao outbox. O e-mail de implantação somente pode ser agendado após confirmação de pagamento e transição válida de etapa. Mensagens de boleto, lembretes de vencimento, pagamento confirmado, falha/renovação e cancelamento precisam refletir estados reais e possuir chave idempotente por pedido/fatura/evento. Retentativas respeitam limites e estado; erros não convertem pedido não pago em pago. Testes usam destinatário controlado e opt-in interno, sem e-mails reais a clientes.

### 5. Interfaces e ambiente

O formulário de captação segue como lead; a tela autenticada de cobrança continua restrita ao CRM. A tela pública de pagamento usa token delimitado a um pedido, sem expor `deal_id` ou dados gerais do CRM. Resumo de preço/recorrência e aceite comercial são registrados antes de criar a sessão. A UI não pode afirmar sucesso antes do webhook confirmado.

No QA, permitir localhost apenas em origins exatas necessárias ao desenvolvimento. Não usar wildcard com credenciais. Preservar `verify_jwt` e autenticação interna existentes; não relaxar autenticação para resolver CORS.

## Entrega em trilhas

1. **Fechar a homologação TEST isolada:** corrigir e verificar CORS da função QA; testar catálogo, identidade, idempotência, criação, liquidação Pix, boleto, assinatura de webhook e isolamento; sem alteração de schema comercial LIVE.
2. **Completar combinações e ciclo de vida:** decidir e implementar o tratamento trimestral de tráfego para cartão/boleto, esclarecer a compra pré-paga Pix e verificar o catálogo integral. Testar sucesso, falha, renovação, cancelamento, duplicidade e fora de ordem.
3. **Automação comercial e e-mails:** validar cada transição e outbox; provar que lead não pago não recebe boas-vindas/implantação e que eventos repetidos não enviam duplicatas.
4. **Prontidão LIVE:** revisar diff, CI, segurança, termos e rollback. Primeiro habilitar somente combinações cuja homologação esteja comprovada. Checkout/cartão e webhook LIVE existentes permanecem intactos. Adicionar meios LIVE somente após checklist por meio/matriz e reconfirmação de estado Stripe; nenhum débito LIVE é necessário para declarar código pronto para o proprietário testar.

## Critérios de aceite

- Todas as cotações das combinações suportadas batem com o catálogo ativo do ambiente correto e com o resumo exibido.
- Cada combinação liberada tem teste de jornada no ambiente de teste que cubra criação, evento assinado, confirmação, atualização CRM e automação esperada.
- Nenhum teste altera modo LIVE, gera cobrança LIVE, cria branch paga, dispara e-mail a cliente ou insere registro QA em tabelas comerciais.
- Eventos inválidos, duplicados, fora de ordem, com valor/identidade/ambiente incompatível e pagamento pendente não concedem acesso nem disparam e-mail de implantação.
- Lead, pedido, fatura e assinatura têm estados consistentes e rastreáveis; retries não duplicam pedido, cobrança, provisionamento ou mensagens.
- Todos os testes unitários/integrados relevantes, build, CI e revisão do diff ficam verdes; verificações remotas comprovam versões implantadas e ausência de regressão no checkout/cartão LIVE.
- Uma matriz final informa, por plano/ciclo/adicional/método, `homologado`, `bloqueado` ou `não suportado`, com evidência e limitações; não usar a expressão “100%” sem todos os critérios atendidos.

## Falhas, segurança e rollback

- A indisponibilidade de API, secret TEST, conta Stripe, migrations necessárias ou revisão de deploy bloqueia apenas a etapa dependente; nunca trocar para LIVE como fallback.
- Mudança em Edge Function usa versão anterior como rollback; migrations são aditivas e mantêm dados financeiros. Nunca apagar pedidos/faturas reais para limpar teste.
- Não registrar segredos, links de pagamento privados, tokens, emails completos, client secrets ou dados de cartão. IDs de eventos podem ser redigidos em relatórios.
- Antes de cada implantação, capturar versões, SHA e configuração relevante sem valores secretos. Depois, testar health/smoke e os fluxos que essa função serve.

## Decisões ainda a verificar tecnicamente antes do plano final

- Suporte Stripe vigente para preço recorrente trimestral junto a assinatura mensal/anual (ou necessidade de fluxo separado).
- Configuração efetiva de TEST e disponibilidade de Pix/boleto, e recebimento de eventos assinados, assim que o conector Stripe recuperar contexto.
- Regra exata de período pré-pago Pix no resumo/termos de cobrança, preservando o compromisso comercial já cadastrado.
- Capacidade de executar a correção CORS isolada pelo caminho oficial de deploy e teste no browser autenticado.

