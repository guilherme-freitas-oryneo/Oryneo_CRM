# ORYNEO — Pix recorrente assistido

**Status:** desenho aprovado em conversa; aguardando revisão deste documento antes do plano de implementação.

## Objetivo

Permitir que clientes da ORYNEO escolham Pix para planos mensais ou anuais e para a gestão trimestral de tráfego. Enquanto o Pix Automático da Stripe não estiver disponível para contas domiciliadas no Brasil, cada ciclo gera uma cobrança Pix individual e o cliente autoriza o pagamento no aplicativo bancário. O sistema automatiza geração, comunicação, conciliação, lembretes e regras de acesso; não apresenta esse fluxo como débito automático.

## Restrição verificada da Stripe

A Stripe suporta Pix Automático por mandato em mercados elegíveis, mas sua documentação atual declara que esse produto não está disponível para empresas domiciliadas no Brasil. Contas brasileiras podem aceitar Pix avulso em BRL. Portanto, a ORYNEO não tentará salvar ou reutilizar um Pix como se fosse cartão, nem forçará Pix em uma Checkout Session incompatível.

Referências oficiais:

- <https://docs.stripe.com/payments/pix>
- <https://docs.stripe.com/payments/pix/pix-automatico>
- <https://docs.stripe.com/payments/pix/accept-a-payment?payment-ui=checkout>

## Experiência do cliente

1. No checkout, o cliente escolhe entre cartão automático, boleto ou Pix recorrente assistido.
2. Ao escolher Pix, a interface explica antes da confirmação: “A cada vencimento, enviaremos um novo Pix. Você confirma o pagamento no seu banco.”
3. A primeira cobrança reúne apenas os itens devidos naquele momento. O cliente recebe QR Code e Pix copia e cola pela interface segura da Stripe.
4. O pedido permanece em processamento até o webhook assinado confirmar o pagamento. O retorno do navegador nunca libera o serviço.
5. Antes dos ciclos seguintes, a ORYNEO cria uma nova cobrança Pix vinculada à obrigação financeira, envia o link e dispara lembretes idempotentes.
6. Quando a Stripe liberar Pix Automático para contas brasileiras, o mesmo perfil de cobrança poderá migrar para mandato mediante novo consentimento explícito do cliente.

## Modelagem dos ciclos

- **Plano mensal:** uma obrigação mensal. A próxima cobrança é gerada no ciclo contratual, com vencimento e tolerância definidos pela política comercial.
- **Plano anual:** uma obrigação anual antecipada. Não se divide o valor anual em cobranças mensais.
- **Implantação:** cobrança única, somente no primeiro pedido.
- **Landing page:** cobrança única, somente quando contratada.
- **Gestão de tráfego:** obrigação trimestral independente, no valor de três meses antecipados. Não é acoplada ao ciclo mensal ou anual do plano principal.
- **Verba de mídia:** permanece fora das cobranças da ORYNEO, conforme os termos comerciais.

Cada obrigação possui seu próprio identificador, ciclo, data de vencimento, valor canônico em centavos e histórico. Isso evita que uma alteração no plano principal duplique ou apague a renovação trimestral do tráfego.

## Arquitetura

### Perfil de cobrança

O pedido registra um `billing_profile` imutável para o ciclo iniciado: `card_auto`, `pix_assisted` ou `boleto_assisted`. O perfil não é inferido pelo texto da interface e não pode ser alterado pelo navegador.

### Agenda de obrigações

Uma rotina transacional cria a próxima obrigação a partir do último ciclo confirmado. Chaves de idempotência derivadas do contrato, tipo de obrigação e data de competência impedem cobranças duplicadas. A rotina não cria uma nova cobrança se já existir uma obrigação aberta ou paga para a mesma competência.

### Criação do Pix

Para `pix_assisted`, o backend cria uma Checkout Session ou PaymentIntent de pagamento único, em BRL, ligado à obrigação interna. A seleção de meios de pagamento continua dinâmica; a configuração Stripe específica do fluxo pode excluir métodos incompatíveis, mas não usa `payment_method_types` fixo. O token público nunca contém preço, Customer ID, Price ID ou segredo.

### Webhook e conciliação

O webhook valida a assinatura sobre o corpo bruto, deduplica `event.id`, confirma ambiente e conta, compara moeda/valor/metadados e só então altera a obrigação. Eventos esperados incluem conclusão assíncrona, sucesso, falha e expiração. Eventos fora de ordem são tolerados por transições monotônicas e pela consulta do objeto Stripe quando necessária.

### Comunicação

Os envios usam a outbox já existente. A agenda mínima é: aviso de nova cobrança, lembrete antes do vencimento, confirmação de pagamento e aviso de atraso. Cada mensagem possui chave idempotente por obrigação e etapa. Nenhum e-mail afirma que o pagamento foi confirmado antes do webhook.

### Acesso e inadimplência

O primeiro acesso só é liberado após pagamento confirmado. Em renovações, a obrigação entra em `due`, depois `overdue`, e segue uma janela de tolerância configurável antes de `suspended`. A suspensão é uma decisão de domínio registrada; não é executada apenas porque o cliente fechou ou abandonou o checkout.

## Estados

Estados mínimos da obrigação: `scheduled`, `open`, `processing`, `paid`, `expired`, `failed`, `overdue`, `canceled` e `requires_review`.

Transições financeiras exigem evidência Stripe persistida. `paid` é terminal para aquela obrigação; reentregas do mesmo evento não disparam novamente e-mails, provisionamento ou automações.

## Segurança

- Segredos Stripe permanecem apenas nas Edge Function Secrets do Supabase.
- O frontend recebe somente chave publicável e client secret delimitado ao pagamento atual.
- Valores e catálogo são recalculados no servidor.
- Tokens públicos são opacos, expiram e dão acesso somente ao pedido correspondente.
- Logs não contêm segredo, client secret, Pix copia e cola completo, CPF/CNPJ completo ou dados bancários.
- O LIVE atual não é substituído antes da homologação integral em TEST.

## Interface

O método Pix aparece como uma decisão explícita fora de qualquer promessa de débito automático. A interface diferencia:

- “Cartão — renovação automática”; e
- “Pix — você confirma cada vencimento no banco”.

Após gerar o Pix, a tela prioriza QR Code, copia e cola, prazo de expiração, valor exato e estado de confirmação. No celular, oferece copiar o código e abrir o aplicativo bancário quando houver link compatível, sem esconder que a confirmação financeira pode levar alguns instantes.

## Migração futura para Pix Automático

A integração guarda o método como perfil de cobrança e não como regra espalhada pela interface. Quando a Stripe liberar Pix Automático para a conta brasileira, será possível adicionar `pix_auto` como novo perfil, coletar mandato em fluxo novo e preservar histórico, obrigações e webhooks existentes. Nenhum cliente é migrado sem autorizar o mandato no banco.

## Verificação obrigatória

1. Testes unitários de ciclos mensal, anual e trimestral, incluindo virada de mês e ano.
2. Testes de idempotência para criação, webhook, outbox e reprocessamento.
3. Pix TEST aprovado, expirado e falho, com verificação de valor e ambiente.
4. Eventos duplicados e fora de ordem sem efeito financeiro duplicado.
5. Primeira cobrança com implantação e landing; renovação sem esses itens.
6. Tráfego renovado de modo independente do plano.
7. Responsividade, foco, contraste, mensagens de erro e leitor de tela.
8. Evidência de que produção LIVE, checkout principal e webhook principal não mudaram durante a homologação isolada.

## Fora de escopo desta etapa

- Simular Pix Automático em conta brasileira.
- Cobrar automaticamente um Pix sem mandato bancário válido.
- Migrar para outro PSP sem decisão comercial separada.
- Emissão de NFS-e ou definição de tratamento fiscal.
- Enviar cobrança real durante a homologação.
