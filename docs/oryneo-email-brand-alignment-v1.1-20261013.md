# ORYNEO · Email Brand Alignment v1.1
Data: 13/10/2026 · Release visual segura.

## Fonte de verdade da marca
- Drive ORYNEO / 01_BRANDING / 02_Brand_Kit / README.md e 00_LEIA_PRIMEIRO.md.
- Wordmark: `01_Logos/PNG/oryneo_wordmark_mono_reverse_800w.png` (SHA Git blob `b9e27c8b1adb0d79790310b982af08f75139a133`).
- Arquivo publicado no repositório é bit a bit idêntico ao oficial, conforme comparação de SHA Git blob.
- URL pública de imagem empregada no HTML: https://guilherme-freitas-oryneo.github.io/Oryneo_CRM/oryneo-wordmark-mono-reverse.png
- Não criar lettering por fonte: wordmark/lockup em PNG oficial; SVG de símbolo/Y separado apenas quando aprovado.
- Tokens oficiais: Graphite `#0F1115`, Indigo `#4F6BFF`, Off-white `#F8F7F4`, White `#FFFFFF`, CTA de superfície clara `#4357E8`, tipografia Inter/Arial fallback.
- Parâmetros: cabeçalho com wordmark oficial em altura visual próxima de 32px; CTA HTML 15px com área útil e texto legível; largura de e-mail 600px, padding responsivo.

## Arquivos efetivamente modificados nesta entrega
- `src/emailPreview/transactionalTemplates.ts`: 12 layouts transacionais, wordmark oficial e cores de Brand Kit.
- `supabase/templates/confirmation.html`: e-mail Auth de confirmação; link nativo `{{ .ConfirmationURL }}`.
- `supabase/templates/recovery.html`: e-mail Auth de recuperação; link nativo.
- `supabase/templates/invite.html`: convite; link nativo.
- `src/emailPreview/transactionalTemplates.test.ts`: testes de consistência de marca e preservação do placeholder nativo.

## O que NÃO foi alterado
- Supabase Auth settings/SMTP: templates do repositório não são automaticamente ativados na plataforma.
- Webhooks Stripe, pedidos, provisionamento, RLS e e-mails enviados em produção.
- `supabase/functions/_shared/billing/fulfillment.ts` (boas-vindas já existente em modo de teste).
- `supabase/functions/_shared/mail/first-contact-template.ts` (primeiro contato atualmente operacional).
- Nenhum link de autenticação foi gerado no Canva; CTAs lá são representações.
- Não criar acesso de clientes antes de isolamento por tenant e validação do fluxo pago.

## Canva · verificação
- Biblioteca: https://www.canva.com/folder/FAHX7rTr69E
- Estudos Auth: https://www.canva.com/folder/FAHX7zbrm7I
- Candidato E01 com logo oficial: https://www.canva.com/d/HliBWqQ_geVQlya
- O Canva recusou a geração de novos designs: `Generation failed. Do not retry unless the user explicitly asks you to.`
- A edição de e-mail responsivo via API recusa `resize_element`; a prévia da edição E02 mostrou duas imagens. A transação E02 foi cancelada. Não promover nenhum dos estudos a master aprovado sem inspeção visual no editor.
- Canvabook: modelos restantes **não** foram criados/editados como masters finais.

## Testes e gates de deploy
1. Verificar `src/emailPreview/transactionalTemplates.test.ts` e compilação no CI.
2. Publicar SOMENTE a galeria estática `?email-preview` após merge, sem ativação de envios.
3. Conferir GitHub Pages com a imagem oficial (arquivo idêntico ao Brand Kit).
4. Revisão manual de desktop/mobile; nenhum layout Canva passa automaticamente.
5. Fase futura: homologar primeiro contato e boas-vindas e envio real dos templates Auth/financeiros com SMTP, idempotência, auth token e RLS.
