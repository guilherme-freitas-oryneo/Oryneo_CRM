# ORYNEO CRM — migração controlada para `crm.oryneo.com.br`

**Estado: preparação em PR draft; NÃO é um deploy nem uma alteração DNS.**

## Arquitetura confirmada

- Landing pública: `oryneo.com.br` (repositório diferente; preservar).
- CRM atual: `https://guilherme-freitas-oryneo.github.io/Oryneo_CRM/`.
- CRM futuro: `https://crm.oryneo.com.br/` (mesmo repositório e GitHub Pages).
- Publicação atual: workflow `.github/workflows/publicar-crm-pages.yml`, build Vite `--base=/Oryneo_CRM/`, push forçado da pasta `dist` para `gh-pages`.
- Como o workflow recria `gh-pages`, arquivo `CNAME` precisa ser preservado a cada publicação.
- O workflow deste PR mantém o build antigo se `gh-pages/CNAME` ainda não estiver configurado; depois alterna a base Vite para `/` automaticamente.

## GATE 0 — proteção e aprovação

1. Conferir que este PR parte de `main`, sem incluir o PR #53 de WhatsApp ou código comercial.
2. Verificar GitHub Settings > Pages: origem atual de publicação, custom domain e HTTPS (não inventar status).
3. Confirmar que não há `crm` existente na zona DNS autoritativa.
4. Fazer inventário das URLs antigas e de sessões Stripe com retorno pendente, para preservar compatibilidade de transição.
5. Registrar commit, workflow anterior e plano de reversão.

## GATE 1 — configuração de domínio (nos painéis autorizados)

1. No repositório do CRM: Settings > Pages > Custom domain = `crm.oryneo.com.br`. Salvar. Em publicação pela branch, o GitHub normalmente cria `CNAME` na origem do Pages.
2. Na zona DNS autoritativa de `oryneo.com.br` (Hostinger se Nameservers apontarem para ela), criar SOMENTE:
   - tipo: **CNAME**
   - host/nome: **crm**
   - aponta para: **guilherme-freitas-oryneo.github.io**
   - TTL: padrão (ou 300 se permitido)
   - nunca incluir `/Oryneo_CRM/` no alvo do CNAME.
3. Não editar os registros do domínio raiz (`@`), `www`, MX, SPF, DKIM ou DMARC.
4. Verificar propagação e domínio no GitHub. HTTPS deve ser imposto somente quando certificado estiver provisionado.
5. Não criar redirecionamento de hospedagem que exiba o hostname `github.io` ao visitante.

## GATE 2 — adaptar dependências além do frontend (antes do rollout final)

**BLOQUEADORES JÁ ENCONTRADOS NO CÓDIGO:**

- `supabase/functions/checkout-intake/index.ts`:
  `origins` não contém `https://crm.oryneo.com.br`; `publicOrigin` e links retornados usam `/Oryneo_CRM/pagar/`.
- `supabase/functions/billing-create-order/index.ts`:
  `origin` e `return_url` de Stripe usam o endereço antigo.
- Workflows de smoke test e diagnóstico público usam o endereço antigo fixo:
  `.github/workflows/live-smoke.yml`,
  `.github/workflows/public-smoke-v21.yml`,
  `.github/workflows/diagnostico-login-pages.yml`.
- Outras funções que montem links, e-mails transacionais, retorno de proposta, implantação e encerramento devem ser descobertas por busca completa antes do rollout.
- Auditar `Supabase Auth > URL Configuration` e `Redirect URLs` (o login atual é `signInWithPassword`, mas recuperar senhas, convites e futuras rotas podem depender da lista de destinos).
- Auditar `Stripe` success/cancel/return URLs e fluxos de pedidos já emitidos; não modificar cobranças nem perder retornos pendentes.
- Atualizar URLs nos links da landing **somente se existirem**; a landing tem repositório independente e está fora deste PR.
- Ajustar CORS/origin validations para o novo host, preservando temporariamente a origem antiga enquanto existirem callbacks válidos.

**Não considerar pronto** enquanto houver uma única jornada crítica apontando a um endereço inválido.

## GATE 3 — deploy, prova e rollback

1. Revisar o PR e CI antes de merge.
2. Após configuração de Pages/DNS, mesclar o PR de domínio de forma coordenada com correções de URLs de backend e testes.
3. Acionar workflow de publicação; conferir `gh-pages/CNAME` preservado após o force-push e `dist/index.html` com caminhos `/assets/`.
4. Conferir HTTPS, favicon, CSS, JS, login, pipeline, e-mail e todas as rotas de pagamento, inclusive `/pagar/`, `/contratar/`, `/proposta/`, `/implantacao/`, `/revisao-lp/`, `/encerramento/`.
5. Validar via navegador Chromium/WebKit mobile e desktop, rede sem cache, e links enviados por e-mail.
6. Validar callback/pagamento em ambiente de teste e fluxo real autorizado se necessário. Não gerar cobranças reais como teste sem autorização específica.
7. Monitorar erros Edge, links 404 e JS, e registrar evidências. Reverter para `--base=/Oryneo_CRM/` se o novo domínio não estiver pronto, **mas sem destruir nem reinicializar sessões de pagamento**.

## Fontes

- GitHub: https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site
- HTTPS: https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https
- Hostinger DNS: https://www.hostinger.com/br/support/4738777-como-gerenciar-registros-cname-na-hostinger/

**Este PR prepara somente o workflow de publicação. A migração de ponta a ponta depende dos ajustes restantes descritos acima.**
