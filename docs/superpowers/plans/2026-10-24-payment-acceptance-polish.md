# Pagamento ORYNEO — plano de aceite e acabamento visual

## Objetivo

Consolidar o aceite em uma única ação no pagamento, vincular o registro aos documentos apresentados e retirar padrões visuais genéricos sem alterar valores ou regras financeiras.

## 1. Fixar o contrato de aceite

- Criar `terms_version`, `terms_sha256`, `order_sha256` e `consent_text_version` no registro de consentimento.
- Versionar o texto exato da caixa.
- Preservar `checkout-2026-10-19` como legado.
- Escrever testes de hash divergente, replay, concorrência e mudança posterior do método.

## 2. Unificar o momento do consentimento

- Remover o checkbox da contratação direta.
- Fazer a página de pagamento abrir a revisão quando não houver consentimento registrado.
- Mostrar itens, valor inicial, recorrências e método na mesma tela.
- Registrar consentimento e método em uma única transação.
- Remover checkboxes das telas de cartão e boleto.

## 3. Corrigir estados e textos

- Estado pago: “Pagamento confirmado” e “Total pago”.
- Estado processando: retirar CTA de nova cobrança.
- Estado expirado/falha: orientar reemissão sem linguagem ambígua.
- Substituir “Total de hoje” por “Valor inicial” antes da liquidação.
- Mostrar o identificador do aceite nas etapas posteriores.

## 4. Simplificar a interface

- Transformar adicionais e meios de pagamento em linhas com divisores.
- Reduzir raios, sombras, halos e fundos coloridos.
- Remover círculos de progresso e ícones decorativos repetidos.
- Corrigir a grade de Visa/Mastercard para impedir sobreposição.
- Manter uma superfície principal e um resumo.
- Posicionar resumo e recorrências antes do aceite no celular.

## 5. Publicar termos definitivos

- Substituir a minuta por Termos v1.0 aprovados.
- Remover mensagens que declaram ausência de efeito contratual.
- Publicar HTML/PDF reproduzíveis e verificar hash no build/deploy.
- Impedir aceite quando o documento não carregar ou o hash divergir.

## 6. Verificar

- Testes Vitest e Deno para todos os métodos e estados.
- Browser em 320, 390, 768 e 1440 px, teclado e zoom de 200%.
- Comparação visual antes/depois.
- Confirmação de que nenhuma cobrança ou e-mail real foi criado durante QA.
- Deploy de Edge Function antes do frontend, com compatibilidade para registros legados.

