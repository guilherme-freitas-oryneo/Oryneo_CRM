# ORYNEO CRM: marca e acesso

## Objetivo

Atualizar a entrada do CRM para que a marca oficial apareça sem o quadrado preto no login e na navegação compacta, com formulário claro, legível e adaptado a desktop e celular. Preservar o fluxo de autenticação Supabase e o restante do CRM.

## Evidência inicial

- Base `ddf9f1e08c7fb1ea58c36be940500b34a72c8458`: `src/components.tsx` usa `oryneo-wordmark.svg` reconstruído e `oryneo-symbol.svg` no login. `src/App.tsx` usa o símbolo quadrado na sidebar compacta.
- A tela publicada em 11/10/2026 tem metade grafite em desktop; no celular o painel desaparece, mas o quadrado preto permanece.
- Brand Kit v1.1 no Drive, `BRAND_LOCK.md` e `DEV_HANDOFF.md`: PNG oficial para wordmark e SVG oficial para Y isolado. Não reconstruir a geometria.
- O SVG do Y do diretório homologado tem metadados internos de uma fase anterior (`candidate-not-brand-locked`). O inventário, o `README.md`, `VECTOR_QA.txt` e o manifesto atual o classificam como aprovado; usar os bytes e o hash do pacote vigente e registrar a inconsistência para correção no Brand Kit, sem alterar o master.
- Referências públicas observadas na mesma data: Attio e Pipedrive priorizam o formulário claro; HubSpot usa entrada por e-mail; Salesforce separa autenticação de conteúdo editorial. São referências de hierarquia, sem cópia visual ou novos métodos de login.

## Design

Usar uma superfície clara com formulário principal em coluna única. No desktop, uma área editorial leve pode contextualizar o produto sem competir com os campos. No celular, mostrar marca e formulário imediatamente. Usar o wordmark master sobre fundo claro e o Y isolado aprovado, ambos conferidos pelo manifesto SHA-256. Os tokens do Brand Kit orientam cor e tipografia; o gradiente do Y fica restrito ao asset. Remover o gráfico de progressão decorativo e o painel preto dominante.

O formulário mantém e-mail, senha, botão para mostrar senha, submit e erro genérico. Não criar recuperação, MFA ou SSO sem fluxo real. Preservar `signInWithPassword`, autocomplete e proteção contra enumeração. Garantir foco visível, labels, estado ocupado, leitura de erros, largura de 320 px sem rolagem lateral, zoom de 200% e CTA acessível com teclado virtual.

## Verificação

Testar assets por hash e o layout em Chromium e WebKit com Supabase simulado. Medir ausência de overflow horizontal, visibilidade dos campos e CTA, ordem de foco e uso do Y transparente. Capturar desktop e celular antes/depois. Rodar build e QA funcional existente para evitar regressão no Pipeline e em Atividades.

