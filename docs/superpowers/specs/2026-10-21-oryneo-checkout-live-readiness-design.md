# ORYNEO — checkout, recorrência e prontidão LIVE

**Status:** implementação publicada na branch draft da PR #46, funções Supabase e preview isolado; nenhum pagamento real foi iniciado. A PR permanece sem merge.
**Base:** `2026-10-20-oryneo-financial-readiness-design.md` e `2026-10-20-oryneo-financial-readiness.md`.

## Resultado desejado

Preparar um percurso comercial coerente, desde plano/adicionais e seleção de pagamento até liquidação, reconciliação, CRM e e-mail, para que o proprietário consiga testar os fluxos antes de abrir a cobrança aos primeiros clientes. A tela deve parecer parte da marca ORYNEO, clara e confiável, não um template genérico de checkout. Cobranças LIVE não fazem parte dos testes automatizados.

## Limites de segurança e operação

- Preservar checkout e webhook LIVE existentes até todos os gates TEST passarem; mudança LIVE deve ser mínima, revisada, retrocompatível e reversível por versão anterior.
- Não criar checkout/session/invoice nem cobrar em LIVE durante QA. Testes externos de pagamento usam TEST e dados controlados; qualquer teste manual pago LIVE será iniciado pelo proprietário depois do release gate.
- Continuar sem Supabase branch paga; manter QA em `oryneo_financial_qa`, com RLS e RPCs de QA sem efeitos em CRM, e-mail ou provisionamento comercial.
- Teste/Live têm credenciais, produtos, pedidos, eventos e webhooks separados. Sem fallback para chave genérica em LIVE; segredo nunca sai do Supabase nem aparece em logs, commits, UI ou relatório.
- Segredos Stripe já compartilhados em conversa são tratados como expostos: não reutilizar valores copiados; usar credenciais substitutas e de menor privilégio antes de atestar segurança de QA. Não desativar chave existente sem confirmar que a substituição está efetiva.
- O cliente envia seleção lógica, nunca preço, total ou Price ID autoritativo. Servidor resolve catálogo, método elegível, moeda, intervalo, modo Stripe e total antes de persistir ou abrir pagamento.
- Confirmação de pagamento vem de webhook Stripe assinado e estado Stripe reconciliado. Retorno ao browser, boleto emitido, Pix pendente, invoice aberta ou subscription ativa não liberam implantação.
- Eventos são registrados/reconciliados de forma idempotente e monotônica; eventos duplicados ou fora de ordem não repetem e-mail/provisionamento nem rebaixam estado pago.
- Pix é cobrança avulsa criada manualmente no CRM por competência; não há Pix Automático. Boleto é recorrente: uma assinatura Stripe `send_invoice` gera uma fatura/boleto a cada competência e a fatura é enviada por e-mail. A central do CRM também pode emitir uma obrigação avulsa assistida quando necessário. Cartão de crédito/débito segue assinatura Stripe; o tipo escolhido é aplicado como restrição server-side e a compatibilidade do emissor é informada.
- Tráfego tem três meses iniciais e recorrência trimestral separada do plano mensal/anual; nenhum total, data ou intervalo será anunciado até confirmar no TEST a assinatura de intervalo misto e as faturas geradas.
- Não habilitar cálculo automático de impostos sem verificar o cadastro fiscal aplicável. Confirmar obrigações de nota/ISS e tributação com contador; Stripe Tax só coleta em jurisdição com registro ativo.
- Emails de QA ficam em caixa de teste/transport fake. Email comercial só pode sair por outbox idempotente, com consentimento aplicável e transição válida.

## Arquitetura escolhida

### UI e checkout

Manter React/Vite, página pública tokenizada e Stripe Checkout Sessions + Checkout Elements já usados. Não coletar dados de cartão fora do Stripe. Seleção lógica de método aparece antes de criar o pedido; o servidor retorna a disponibilidade para aquele ambiente, plano, ciclo, adicionais e endereço. Não renderizar ou aceitar opções indisponíveis.

Layout responsivo de duas colunas no desktop (dados/método à esquerda, resumo de pedido à direita) e uma coluna no mobile, com CTA de valor explícito e resumo sempre visível antes da confirmação. O resumo distingue total de hoje, implantação, serviços avulsos, cobertura pré-paga, ciclo e próxima renovação de cada item, incluindo tráfego e verba de mídia excluída. Avisos de Pix, boleto, falhas e estado pendente ficam próximos da ação. Sem urgência artificial, countdown, gradientes/glow, glassmorphism ou badges decorativos genéricos.

Preservar logo, nomenclatura, tons e linguagem existentes da ORYNEO; revisar marca local antes de introduzir fonte/cor nova. Ícones e rótulos acessíveis para cartão, Pix e boleto; o elemento Stripe permanece responsável por dados seguros e disponibilidade real. CTA assertiva sem dark pattern. Radios nativos, `fieldset/legend`, `aria-live` pontual para total e foco/teclado visíveis. 21st.dev será referência de composição e comportamento: selecionar exemplos com preview, auditar acessibilidade e dependências, adaptar ao projeto local; não instalar/copiar uma coleção sem necessidade.

### Catálogo e forma de cobrança

Validar as 24 combinações existentes (3 planos × 2 ciclos × quatro estados de adicionais) com valores inteiros em centavos e catálogo TEST/LIVE separado. Para cada método, definir cobertura e faturamento no contrato:

- Cartão: plano com cobrança mensal/anual via assinatura; adicionais únicos; tráfego com período inicial e linha trimestral separada, com invoices por item/ciclo conforme comportamento Stripe verificado.
- Boleto: assinatura recorrente Stripe com `collection_method=send_invoice`, boleto em cada ciclo e aviso por e-mail; confirmar cada competência somente após webhook assinado e prova de liquidação Stripe. Uma fatura/boleto aberto nunca libera serviço.
- Pix: cobrança avulsa criada pelo CRM para a competência escolhida, com link compartilhável e gatilho de e-mail; não há débito ou geração automática.

Cartão usa billing mode `flexible` e mantém a cobrança do plano e o período trimestral de tráfego separados. Boleto recorrente gera invoices por assinatura; Pix permanece uma obrigação avulsa reconciliada por evento assinado.

### Webhooks, estados e gatilhos

Separar endpoints QA e comerciais. Verificar HMAC sobre corpo bruto, timestamp, `livemode`, conta/cliente, pedido, subscription, invoice, método, moeda e valor antes de efeitos. Usar idempotência de evento e leitura de prova de liquidação em métodos assíncronos. Persistir estado/invoice cycle atomicamente; side effects ficam em outbox.

Gatilhos a provar: lead recebido (recibo sem promessa de pagamento), primeiro contato e proposta (somente conforme transição comercial/consentimento), pedido/invoice emitido (instruções corretas), pagamento confirmado (recibo e início de implantação), renovação paga, falha/vencimento (recuperação), cancelamento/reembolso/disputa (bloqueio/escalonamento). Mensagens automáticas de QA nunca vão a leads/clientes. Reverso: eventos Stripe simulados/injetados começam no webhook e precisam produzir estado e email corretos, sem duplicação.

### Divergência de deploy

Na leitura de 21/10, o Supabase tinha versões ativas de checkout, cobrança e webhook, mas o source remoto de `checkout-intake`/`billing-create-order` não continha a mesma checagem explícita de método encontrada no branch local. Antes de qualquer release, comparar hashes/source/versões, verificar eventos e variáveis sem revelar valores, e reconciliar a diferença por deploy isolado e validado. Não confiar em source local como prova do comportamento atual.

## Referências visuais e técnicas

- Componentes de checkout/pricing 21st.dev: usar previews e inspecionar markup/código, sem copiar aparência genérica; checkout deve expor total e regra anual sem ambiguidade.
- Stripe: Checkout Sessions + Elements, Billing flexível para intervalos mistos, métodos dinâmicos onde elegíveis, webhook obrigatório para assinatura e método assíncrono.
- Supabase: funções QA isoladas, `verify_jwt`/auth não relaxados, RLS e advisors após qualquer migration.

## Critérios de aceite

1. UI aprovada por testes de componente para estados desktop/mobile, acessibilidade, seleção/indisponibilidade por método, total e regras de recorrência, erro/retry e estados pendentes.
2. Valores de servidor e UI concordam nas 24 combinações; nenhum método aparece sem elegibilidade de servidor/Stripe e nenhum Price ID/valor do cliente é aceito.
3. TEST cobre, para cada combinação habilitada, criação, pagamento aprovado/pendente/falhou/expirou, webhook assinado, reconciliação, ciclo/renovação, cancelamento e e-mail esperado; inclui eventos duplicados, inválidos, atrasados e fora de ordem.
4. QA não toca em dados/tabelas/outbox comerciais; email fica no sink; nenhuma operação gera cobrança LIVE.
5. Diff remoto/local é explicado, CI, testes, build, revisão de segurança e advisors estão verdes. Versão anterior e plano de rollback ficam registrados.
6. Matriz final marca cada plano × ciclo × adicionais × meio como `homologado`, `bloqueado` ou `não suportado`, com evidência. Métodos LIVE são habilitados com validação server-side e permanecem sob teste manual do proprietário.
7. O usuário inicia qualquer pagamento real manualmente depois de ver preço/período/método e aceitar os termos; nenhuma automação de teste paga por ele.

## Sequência de entrega

1. Resolver a divergência de deploy e confirmar credenciais/conta sem expor segredos.
2. Criar/ajustar matriz de cotação e elegibilidade; provar intervalos mistos e ciclo de tráfego em TEST.
3. Polir e implementar checkout público e ferramenta interna de QA, mantendo método live não homologado fechado.
4. Fechar liquidação Pix/boleto, recorrência/falha/cancelamento, reconciliação webhook e outbox/gatilhos.
5. Executar E2E direto e reverso em TEST; registrar matriz e zero efeitos comerciais.
6. Aplicar apenas depois o release gate LIVE: deploy mínimo, smoke read-only/zero-charge e checkout liberado somente para métodos provados. Sem cobrança real automatizada.
