# Fluxo de pagamento — auditoria de interface e aceite

**Data:** 24 de outubro de 2026  
**Decisão de produto:** manter um aceite eletrônico simples, registrado no pagamento. Não criar produto de assinatura, campo manuscrito, OTP ou nova confirmação mensal.

## Fluxos verificados

- Contratação direta em `/contratar/`.
- Escolha de cartão de crédito, débito, boleto ou Pix.
- Pagamento por cartão com Stripe Elements.
- Emissão e abertura de boleto.
- Pix com QR Code e Copia e Cola.
- Estados aguardando, processando, pago, expirado e indisponível.
- Termos em modal e links de privacidade/suporte.
- Desktop 1440 × 1000 e celular 390 × 844.

## Defeitos confirmados

### P0 — o aceite não identifica os termos exibidos

Existem 16 pedidos LIVE com `commercial_consent_version = checkout-2026-10-19`. O snapshot guarda pedido, ambiente, moeda, total, seleção e itens. Nenhum desses registros contém versão ou hash dos termos.

O modal exibe `oryneo-termos-v0.9-homologacao.txt`, cujo conteúdo declara “NÃO PUBLICAR” e informa que a confirmação comercial é independente da minuta. A caixa, porém, diz “Li e aceito os termos”. As duas mensagens são incompatíveis.

### P0 — aceite duplicado e inconsistente

Dependendo da entrada, o cliente pode marcar consentimento:

1. na contratação direta;
2. novamente ao escolher o meio de pagamento;
3. novamente antes do cartão ou boleto.

O backend torna os registros seguintes idempotentes, mas a interface induz o cliente a repetir o mesmo ato. No Pix, a segunda caixa não aparece. O tratamento varia por método sem motivo contratual.

### P1 — escolha do meio aceita condições sem mostrar o pedido completo

A tela “Como você prefere pagar?” mostra apenas o total inicial. Ela registra o aceite antes de exibir novamente plano, itens, recorrência principal e renovação trimestral de tráfego.

### P1 — tela paga continua pedindo pagamento

Quando o estado é `paid`, o cabeçalho ainda pode exibir “Pague ... com cartão” e instruir o cliente a preencher os dados, enquanto o corpo informa “Pagamento confirmado”. O resumo também mantém “Total de hoje” em vez de “Total pago”.

### P1 — marcas do cartão invadem o texto

Na escolha intermediária, Visa e Mastercard ocupam uma coluna estreita e sobrepõem “Cartão de crédito/débito” em desktop e celular.

## Aparência artificial confirmada

- Contratação direta contém dez contêineres tratados como cards ou opções em cards.
- Serviços adicionais, meios de pagamento, tipo de cartão, consentimento, resumo e total usam a mesma linguagem de caixa arredondada.
- Seleções usam borda azul, fundo lilás e halo simultaneamente.
- Há repetição de escudo, cadeado e textos “seguro”, “protegido” e “processado com segurança”.
- O progresso com números circulares, os ícones redundantes e as sombras leves lembram um template genérico de SaaS.
- O texto “Revise e conclua” não identifica a tarefa concreta.
- No celular, o resumo completo aparece depois do botão, embora parte dele seja necessária antes do aceite.

## Pontos corretos

- Valores em centavos são recalculados e validados no servidor.
- Itens únicos, assinatura principal e tráfego trimestral aparecem separados.
- A verba de mídia é informada como separada.
- Pix informa ausência de débito automático.
- Boleto informa pagamento manual por período e compensação assíncrona.
- Cartão informa recorrência conforme o ciclo.
- Nenhum estado assíncrono é tratado como pagamento confirmado pelo navegador.
- As telas auditadas não apresentaram overflow horizontal.

## Fluxo aprovado para a correção

### 1. Revisão da contratação

- Mostrar plano, adicionais e dados do cliente.
- Permitir alteração dos adicionais e correção cadastral.
- Não pedir aceite nesta etapa.
- Encaminhar para a página de pagamento com pedido versionado.

### 2. Pagamento e aceite único

- Mostrar composição do valor inicial e todas as recorrências.
- Escolher meio de pagamento.
- Disponibilizar Termos Gerais completos e política de privacidade.
- Exibir uma única caixa, desmarcada:

> Li e aceito os Termos Gerais v1.0 e as condições deste pedido, incluindo o valor inicial e as cobranças recorrentes apresentadas.

- Registrar servidor, data UTC, versão/hash dos termos, versão/hash do pedido, método e texto da declaração.
- Bloquear alteração de método ou condições depois do aceite; qualquer mudança material exige novo pedido/aceite.

### 3. Execução do pagamento

- Exibir somente os controles do método escolhido.
- Não repetir checkbox.
- Mostrar “Condições aceitas” e o identificador do registro.
- Confirmar pagamento apenas após evento financeiro verificado.

## Direção visual aprovada

- Cabeçalho: ORYNEO e título curto “Pagamento”.
- Uma coluna principal e um resumo; no celular, o resumo vem antes do aceite.
- Opções como linhas editoriais com divisores, raio discreto e sem halo.
- Adicionais como linhas de checkbox, sem cards individuais.
- Uma única superfície branca principal; remover card dentro de card.
- Um único indicador de segurança junto à Stripe.
- Botões sem cadeado decorativo.
- Status por texto e cor, sem selo ou pílula.
- Rótulos contextuais: “Valor inicial”, “Próximas cobranças” e “Total pago”.
- Estado pago com título “Pagamento confirmado” e sem instrução de pagamento.

## Tratamento dos registros existentes

- Preservar os 16 registros atuais como `checkout-2026-10-19`.
- Não acrescentar retroativamente versão/hash de termos.
- Rotulá-los internamente como aceite comercial legado.
- Novos registros usam um novo identificador somente depois da publicação dos Termos v1.0.

## Gate de publicação

- Termos v1.0 sem avisos de homologação.
- Um checkbox em toda a jornada.
- Snapshot com hashes verificáveis.
- Resumo completo antes do aceite em todos os métodos.
- Sem sobreposição de marcas ou textos.
- Estados pago, processando, expirado e falha com títulos próprios.
- Teclado, foco, zoom de 200%, 320/390/768/1440 px e leitores de tela básicos.
- Testes de repetição, concorrência, alteração de método e divergência de hash.

