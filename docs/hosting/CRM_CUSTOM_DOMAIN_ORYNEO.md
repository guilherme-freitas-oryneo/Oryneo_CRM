# ORYNEO CRM — migração controlada para `crm.oryneo.com.br`

> ## CHECKPOINT DE PRONTIDÃO — 27/10/2026 (prevalece sobre os passos históricos abaixo)
>
> **Domínio já ativo:** o usuário confirmou login em `https://crm.oryneo.com.br`; `gh-pages/CNAME` e build `/assets/` corrigidos pelo hotfix #56 (merge `3f458785`, publicação Pages `40572882926`). Não solicitar novo CNAME/DNS nem refazer a migração de frontend.
>
> **Regressões observadas no Supabase:** funções já implantadas ainda não incluem `https://crm.oryneo.com.br` no CORS. Logs da janela de 24h apontaram **3 preflights `OPTIONS /proposal-create` HTTP 403** e **1 `OPTIONS /billing-center` HTTP 403**. `proposal-public`, `billing-public`, `billing-create-order`, `mail-api/handler` e outros componentes inspecionados também estão com origem antiga. As correções no PR #55 **NÃO FORAM IMPLANTADAS**.
>
> **Dados sem efeitos colaterais:** `crm_proposals` possui 5 registros anteriores ao dia 20/10 (1 accepted, 1 sent, 3 superseded); nenhuma nova proposta identificada na tentativa após domínio novo. `crm_mail_outbox` tem 32 registros sent, 22 system e 10 user; nenhum com assunto de proposta. `crm_billing_orders` tem 23 pedidos (22 expired, 1 payment_failed), sem pagamento confirmado. Isso não é prova de falha de pagamentos atuais, mas **não** autoriza declarar E2E de checkout aprovado.
>
> **Preservação prioritária:** CORS cumulativa — antigo + novo; links antigos em `/Oryneo_CRM/` continuam espelhados no Pages; workers SMTP/IMAP, preços, ciclos de cobrança, consentimento, Pix, boleto, cartão e webhooks Stripe sem mudanças não autorizadas. Não executar cobrança real nem disparar e-mail de teste a lead sem aprovação. Não alterar site `oryneo.com.br`.
>
> **PR #55 atualizado nesta revisão:** `ProposalAction.tsx` passou a reconhecer **ambos** domínios oficiais com token validado; testes para domínio novo/legado e domínio falso; teste estrutural do CORS para 15 endpoints; workflow de Pages reconciliado com hotfix #56. HEAD de código `0ed8f052` mostrou CI Build + Edge e Pix **aprovados** (`40577735459`, `40577735344`), Browser QA **reprovado** (`40577735217`): teste Playwright do checkout está desatualizado quanto à seleção inicial de cartão (espera 2 subopções sem escolher cartão). Antes de corrigir o script, confrontar todos os seletores com UI atual (CNPJ, WhatsApp, e-mail, mídia). **Não mudar checkout real só para deixar teste verde.**
>
> **Próximos gates:** 1) QA Browser consistente e verde; 2) snapshot e diff exato das Edge Functions implantadas; 3) publicar somente CORS/URLs aprovados com `ORYNEO_CRM_PUBLIC_BASE` em fallback inicial, preservar comportamento antigo; 4) testar preflight HTTP real dos dois origins, autenticação, visualização de proposta, envio transacional *autorizado*, aceite; 5) testar cada forma de pagamento em Stripe TEST e retornos legados/novos; 6) só então migrar URL canônica de links novos e homologar publicação. **Não merge/deploy do PR inteiro sem gates.**
>
> ---
>
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

## Atualização executiva — mudanças efetivas em 27/10/2026

Preparação em PR #55 (draft), sem merge/deploy/DNS. Além do workflow Pages:
- Criado `supabase/functions/_shared/hosting/crm-urls.ts`: `crmPublicUrl(path, Deno.env.get('ORYNEO_CRM_PUBLIC_BASE'))`. Na AUSÊNCIA da variável o destino é `https://guilherme-freitas-oryneo.github.io/Oryneo_CRM`. Somente o valor EXATO `https://crm.oryneo.com.br` ativa links novos. Testado por `src/hosting/crm-domain.test.ts`.
- Checkout `checkout-intake`, `billing-create-order`, `billing-public`, e QA `checkout-intake-noncard-test` passam a usar o helper para links de pagamento e retorno, preservando a origem atual até ativação.
- `proposal-create` e `landing-admin` usam o mesmo helper para propostas e revisão de LP.
- CORS estendida sem retirar origem antiga em todos os endpoints identificados: checkout, billing, proposal, delivery, offboarding, landing, company-enrich e mail-api/handler.
- Guard TypeScript no teste financeiro (não altera valores, métodos ou integração com Stripe) eliminou TS2322 do build da branch.
- CI no HEAD `cdeb0854`: build/Edge e Pix aprovados; browser QA geral em execução ao final da inspeção. Reconsultar antes de merge.

### Ordem de rollout obrigatório
1. Antes do cutover, PR #55 precisa de CI VERDE, review e merge controlado em `main`, enquanto **NÃO há CNAME** na `gh-pages`; assim o workflow permanece compilando `/Oryneo_CRM/`. Verificar que a publicação antiga continua íntegra.
2. Implantar versões das Edge Functions modificadas, em ordem e após QA de integração, com `ORYNEO_CRM_PUBLIC_BASE` **não definida**. Isso libera CORS para ambos os domínios mas conserva retorno/links do CRM antigo. Jamais alterar credenciais Stripe para migrar domínio.
3. No Supabase Auth URL Configuration, adicionar `https://crm.oryneo.com.br/**` à allowlist e preservar redirect URLs antigas. Só mudar a Site URL quando a nova publicação estiver homologada.
4. Conferir nameservers da zona autoritativa. No GitHub Settings/Pages definir `crm.oryneo.com.br` e depois criar apenas o registro `CNAME crm -> guilherme-freitas-oryneo.github.io`. Não mudar `@`, `www`, MX ou SPF/DKIM/DMARC.
5. GitHub Settings/Pages: aguardar DNS check e certificado, habilitar Enforce HTTPS. Verificar `gh-pages/CNAME`. Rodar manualmente workflow `Publicar ORYNEO CRM no GitHub Pages` da `main` preparada, para emitir assets na raiz `/assets/`. Atenção: rodar o workflow ANTIGO sobrescreveria CNAME.
6. Validar HTTPS, login, pipeline, e-mail, caminhos JS/CSS e todas as rotas públicas `/pagar/`, `/contratar/`, `/proposta/`, `/implantacao/`, `/revisao-lp/`, `/encerramento/`, `/qa/pr-46/`. Conferir URLs de checkout e retorno legado/novo com sessão Stripe TEST e navegador real.
7. Configurar `ORYNEO_CRM_PUBLIC_BASE=https://crm.oryneo.com.br` em Supabase Edge Secrets SOMENTE após verificar site novo. Reimplantar as funções de links/retornos; confirmar que clientes com sessões antigas continuam podendo concluir sem alterar seu pedido e que novos links apontam ao domínio novo.
8. Revisar logos absolutos de e-mails antigos e novos, links em template, domínio do portal Stripe se aplicável e links da landing. A criação e o recebimento de webhooks de pagamento Stripe continuam no Supabase, mas precisam de smoke próprio.
9. Somente após testes E2E de checkout/Stripe test, email, Auth, observabilidade, DNS e HTTPS, aceitar e publicar o domínio como endereço oficial. Não usar pagamento REAL como teste sem aprovação.
10. Rollback: `ORYNEO_CRM_PUBLIC_BASE` ausente restaura links legados em novos pedidos; reverter deployment Pages de forma controlada; **não** cancelar sessões de pagamento existentes nem alterar eventos contábeis. Reconfigurações DNS/Pages exigem reversão coordenada, e há risco de cache. 

### Limitações deste agente
Não existem ações autenticadas de escrita para DNS da Hostinger nem Settings > Pages do GitHub nas conexões disponíveis. O proprietário precisa executar essas ações nos respectivos painéis (ou usar Work com navegador conectado). Não afirmar que domínio foi ativado antes do HTTP, TLS e E2E passarem.

