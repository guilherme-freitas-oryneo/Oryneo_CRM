# ORYNEO — Etapa 6: evidência final de release

**Captura:** 02/11/2026 18:35:43 UTC

**Commit de produção no início da etapa:** `4601b875a70174b6e1ab3419bb7fee98b9e0faf6`

**Decisão:** publicação de código com motor desativado permitida; ativação live e troca de executor bloqueadas.

## Estado hospedado confirmado

A consulta somente leitura `supabase/automation/stage6_hosted_readiness.readonly.sql`
confirmou no projeto `ucikrafwfzamxvweuvgk`:

- workspace `oryneo-crm` inativo;
- runtime `disabled`, com parada de emergência ligada;
- `billing`, `crm`, `email`, `onboarding` e `whatsapp` sob o executor legado;
- zero fluxos habilitados, versões publicadas, execuções, ações live e esperas ativas;
- zero atestações vigentes.

Também faltam, por canal, comprovação atual do provedor, política de
consentimento e executor único. E-mail ainda exige comprovação da caixa postal;
faturamento exige webhook financeiro e termos aceitos.

Não foram lidos conteúdo de mensagem, dados de cliente, tokens ou payloads de provedor.

## Critérios ainda ausentes

1. aprovação jurídica independente e vigente;
2. aprovação do playbook e textos comerciais;
3. ensaio operacional de rollback com responsável e tempo registrados;
4. revisão de segurança independente;
5. sessão E2E autenticada e canários controlados dos provedores.

O interlock do banco recusa `mode=live`, transferência de ownership e lease de
ação enquanto esses critérios e os critérios específicos de cada canal não
estiverem atestados. Revogar ou expirar uma atestação válida aciona parada de
emergência e desativa o workspace.

## Evidência automatizada

`node qa/acceptance/verify-stage5.mjs` confere a rastreabilidade 47/47 do ZIP,
sem convertê-la em homologação live. Em seguida,
`node qa/release/verify-stage6.mjs` exige o estado seguro hospedado, ownership
legado, contagens zeradas, cinco gates ausentes e presença dos testes de
interlock/rollback. O relatório gerado é artefato de CI e não é fonte de
aprovação.

## Critério para mudar a decisão

Cada gate precisa de evidência HTTPS imutável, hash SHA-256, revisor admin,
validade e escopo. Depois disso, executar uma sessão autenticada em 390, 768 e
1440 px e um canário por canal com destinatário/conta controlados. Registrar
recibo do provedor, latência, custo quando comprovado, ausência de duplicidade e
tempo de reversão. Somente então a decisão pode ser reavaliada canal a canal.

Nenhuma aprovação foi presumida e nenhum canário, mensagem, e-mail, mudança de
pipeline ou cobrança real foi executado nesta etapa.
