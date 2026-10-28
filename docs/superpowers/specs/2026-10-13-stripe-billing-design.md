# ORYNEO — Cobrança Stripe personalizada

**Status:** desenho proposto; ainda não implementado nem implantado.

## Objetivo e limites

Adicionar ao CRM uma forma segura de preparar cobranças e sincronizar pagamentos, faturas e assinaturas pelo Stripe, com uma página de pagamento própria da ORYNEO. A página pública de captação continua sendo apenas uma solicitação de interesse: enviar o formulário não cria cliente pagante, assinatura ou cobrança. A cobrança só pode ser preparada após confirmação humana de escopo e condições comerciais no CRM.

O trabalho cobre o catálogo de produtos/preços no ambiente de teste, funções Supabase para preparar a cobrança e tratar eventos, interface de cobrança ORYNEO, visualização do estado financeiro no CRM, testes e homologação em test mode. Não inclui cobrança real, ativação de live mode, emissão de NFS-e, cálculo fiscal automático, descontos ad hoc, parcelamento, portal de autoatendimento ou alteração do funil comercial.

## Evidência do estado atual

- A landing page define três planos, ciclo mensal/anual, implantação e complementos em `Oryneo_Landing_Page-worktrees/progressive-intake/assets/commercial.js`.
- A página explica que a contratação é formalizada após confirmar escopo, valores e condições; o formulário não cobra.
- O formulário/contrato do CRM revalida plano e complementos no servidor em `supabase/functions/_shared/intake/contract.ts`.
- O projeto Supabase do CRM está ativo em `sa-east-1`; suas funções atuais incluem `lead-intake`, `mail-api`, `mail-sync`, `company-enrich` e `crm-bootstrap`.
- Não foi encontrada função, tabela ou dependência de integração Stripe no código atual do CRM.
- Os preços devem continuar sendo valores inteiros em centavos e recalculados no servidor. Valores enviados pelo navegador não são confiáveis.

## Catálogo existente a preservar

| Item | Preço e recorrência atuais |
|---|---|
| Start | R$ 749,90/mês; implantação de R$ 989,90, uma vez |
| Growth | R$ 1.099,90/mês; implantação de R$ 1.389,90, uma vez |
| Scale | R$ 1.479,90/mês; implantação de R$ 1.849,90, uma vez |
| Ciclo anual | 12 meses antecipados com 10% de desconto sobre a assinatura; implantação sem desconto |
| Landing page de conversão | R$ 889,90, uma vez |
| Gestão de tráfego pago | R$ 989,90/mês, compromisso mínimo de 3 meses e cobrança trimestral antecipada de R$ 2.969,70; verba de mídia separada |

O serviço de tráfego precisa ter preço Stripe recorrente de três meses, não uma mensalidade cobrada por engano a cada mês. Os itens de implantação e landing page são cobranças únicas. O ciclo anual permanece antecipado, conforme o texto comercial atual.

## Experiência e fluxo

1. A pessoa escolhe plano/ciclo/complementos e envia o formulário como interesse, sem pagamento.
2. No CRM, após negociação e confirmação humana dos termos, uma ação “Preparar cobrança” cria um pedido em rascunho usando os valores do catálogo confiável do servidor e o negócio existente.
3. A revisão do pedido mostra plano, período, implantação, complementos, primeiro total, recorrências subsequentes, compromisso mínimo, vencimento e condições aprovadas. O usuário do CRM confirma antes de gerar o link.
4. O cliente recebe uma URL de pagamento própria da ORYNEO, com identidade visual existente, resumo claro do pedido e componente de pagamento incorporado. A URL usa token opaco, expiração e vínculo a um pedido específico; não aceita valores, preço Stripe ou `deal_id` livremente manipuláveis pelo cliente.
5. O Stripe Checkout Sessions com UI customizada e Payment Element coleta o pagamento sem levar o cliente a uma página genérica do Stripe. A configuração deve seguir o comportamento dinâmico de meios elegíveis; não fixar `payment_method_types` no código.
6. O CRM atualiza o estado exclusivamente após eventos Stripe validados e persistidos. A tela de retorno é informativa, não prova de pagamento.

O checkout customizado continua usando os componentes seguros do Stripe. Isso atende ao requisito visual sem armazenar dados de cartão no CRM.

## Arquitetura proposta

- **Catálogo:** espelhar produtos/preços Stripe e mapear IDs por configuração server-side. O cálculo de proposta permanece canônico em centavos; não confiar em preço/total vindo do browser. Antes de criar catálogo no Stripe, comparar os objetos existentes no test mode para evitar duplicatas.
- **Função autenticada `billing-create-order`:** exige usuário CRM autorizado, valida deal e estado comercial, recalcula total e cria pedido rascunho com chave de idempotência. Rejeita lead sem aprovação comercial explícita.
- **Função autenticada `billing-create-session`:** valida pedido em estado permitido e cria sessão de Checkout ligada ao Customer, preços e metadados internos. Sessão precisa expirar e não pode ser reutilizada após pagamento/cancelamento.
- **Página `/pagar/`:** UI responsiva, acessível e com marca ORYNEO; obtém apenas dados mínimos do pedido e o client secret necessário para inicializar o componente Stripe. Não carrega chave secreta.
- **Webhook `stripe-webhook`:** rota sem JWT do Supabase, mas com validação obrigatória da assinatura Stripe sobre o corpo bruto via `STRIPE_WEBHOOK_SECRET`. Deduplica `event.id`, tolera repetição e eventos fora de ordem e grava o resultado antes de efeitos posteriores.
- **Banco:** adicionar registro de pedido financeiro associado ao negócio, identificadores Stripe, status de pagamento, valor, moeda, recorrência, datas e trilha de eventos deduplicados. Restringir a leitura/escrita a membros autorizados do CRM; nenhum dado de cartão é persistido.
- **Segredos:** `STRIPE_SECRET_KEY` e `STRIPE_WEBHOOK_SECRET` ficam exclusivamente em Supabase Function Secrets. Nunca em `VITE_*`, HTML, repositório, logs, metadados públicos ou resposta da API. Usar somente test mode até homologação explícita. Para a primeira versão, aceitar a chave secreta de teste indicada pelo proprietário, mantendo a recomendação de migrar para chave restrita (`rk_test_`) antes de qualquer operação live.

## Estados e eventos

Estados mínimos do pedido: `draft`, `awaiting_payment`, `paid`, `payment_failed`, `expired`, `canceled`, `refunded` e `requires_review`. A transição para `paid` não ocorre pela página de sucesso nem pelo estado `active` de assinatura isoladamente.

Eventos iniciais a tratar: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated` e `customer.subscription.deleted`. Eventos não reconhecidos são registrados/ignorados com resposta apropriada; o handler é idempotente.

## Direção visual e benchmarking

- Preservar a marca ORYNEO e a hierarquia visual já existente; página própria, limpa, mobile-first, com resumo do pedido sempre visível e nenhum destaque de marca Stripe além do necessário no componente seguro.
- Do G4: progressão curta, uma decisão de cada vez e contexto antes de solicitar ação.
- Do Pipedrive: comparação simples de planos e ciclo, com complementos explicitamente identificados.
- Do HubSpot: composição de preço clara, explicando limites, itens incluídos e custos variáveis/externos.
- Do Salesforce: permitir negociação humana antes de cobrar quando o escopo ou condições forem excepcionais, sem transformar o checkout num configurador complexo.
- Da V4: apresentar escopo e entregáveis de serviço junto às condições comerciais, sem prometer resultado ou esconder mídia paga.

Inspirar-se nos padrões, sem copiar marca, textos ou layout proprietário.

## Fiscal, privacidade e segurança

- Não habilitar Stripe Tax automaticamente sem confirmar com o responsável fiscal as inscrições e obrigações aplicáveis. Stripe Billing/invoice não deve ser apresentado como substituto de NFS-e.
- Exibir preço, recorrência, valor de implantação, prazo mínimo e regras de renovação antes de pagar; obter aceite explícito dos termos aprovados.
- Validar origem autorizada das chamadas CRM, autenticação, CORS, rate limits, idempotência e autorização por registro. URL pública do pagamento concede acesso apenas ao pedido delimitado e não a dados gerais do CRM.
- Não registrar tokens de pagamento, segredos, dados completos do cartão ou client secrets em logs.

## Plano de verificação e rollout

1. Testes unitários de catálogo/centavos: todos os planos, ciclos, add-ons, totais e recusa de valores adulterados.
2. Testes de autorização e integridade: lead sem aprovação não gera sessão; pedido de outro negócio não pode ser lido; token expirado não paga; chamadas repetidas não duplicam pedidos.
3. Testes de interface responsiva, leitor de tela, foco/erros e identidade visual em celular e desktop.
4. Testes Stripe test mode: pagamento inicial aprovado/recusado, anual, mensal, implantação, landing page, add-on trimestral, pagamento assíncrono se elegível, renovação e falha de fatura.
5. Testes de webhook: assinatura inválida, evento repetido, evento fora de ordem e reentrega.
6. Homologação integrada: confirmar que o CRM reflete valores/IDs/status corretos e que os testes não enviam e-mail de cobrança real nem alteram live mode.
7. Deploy de funções e banco primeiro no projeto CRM de produção, ainda em Stripe test mode; publicar a rota de pagamento após verificar autenticação e CORS. Não habilitar live mode até homologação e aprovação explícitas.

## Decisões deliberadas

- A landing page continua sendo aquisição/interesse, não checkout.
- A página de cobrança é própria da ORYNEO; Stripe processa pagamento por componentes incorporados.
- Nenhum cálculo monetário confiável roda apenas no browser.
- Não há cobrança automática, fiscalidade automática ou operação live nesta entrega inicial.
- O início da implementação permanece condicionado à revisão deste desenho e à disponibilidade do segredo no ambiente Supabase sem expô-lo no código.
