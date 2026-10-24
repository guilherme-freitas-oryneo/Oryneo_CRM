# ORYNEO Assina — plano substituído

> **Não executar.** O escopo foi simplificado por decisão comercial em 24 de outubro de 2026. A implementação vigente preserva somente um aceite eletrônico rastreável dentro do fluxo de pagamento. Consulte [2026-10-24-payment-acceptance-polish.md](./2026-10-24-payment-acceptance-polish.md).

**Objetivo:** substituir o aceite comercial básico por assinatura eletrônica com identidade por OTP, pacote contratual imutável, trilha de auditoria, comprovante e verificação.

**Estratégia de rollout:** mudanças expansivas, feature flag desativada em LIVE, homologação integral em TEST e ativação controlada somente após aprovação jurídica.

## 1. Fixar contratos e casos de teste

- Criar fixtures do pacote contratual `v1` e do manifesto de evidências.
- Definir a máquina de estados e transições permitidas.
- Escrever testes negativos para versão substituída, expirada, documento ausente, hash divergente, OTP inválido, replay, concorrência e destinatário alterado.
- Manter propostas históricas legíveis e rotuladas como aceite legado.

## 2. Proteger o link público

- Emitir capacidade no fragmento da URL ou realizar troca por sessão curta em domínio próprio.
- Remover o segredo da barra após a troca.
- Adicionar `no-referrer`, CSP, proteção contra framing e política de recursos locais.
- Revogar sessões na expiração, substituição ou conclusão.
- Testar histórico, referrer, refresh, compartilhamento e link revogado.

## 3. Persistir envelope e trilha

- Criar `crm_signature_envelopes` ligado à proposta.
- Guardar versão/hash dos termos, hash do documento canônico, signatário esperado e estado.
- Criar `crm_signature_events` append-only com sequência e encadeamento de hashes.
- Criar storage privado para documento pré-assinatura, documento final e certificado.
- Separar permissões comerciais das permissões sobre evidências técnicas.

## 4. Gerar pacote canônico

- Gerar no servidor o PDF de proposta com termos e anexos identificados.
- Calcular hash dos bytes finais antes do envio para assinatura.
- Manter e-mail, HTML e PDF derivados do mesmo snapshot.
- Bloquear assinatura se qualquer artefato ou hash estiver ausente.
- Testar determinismo, caracteres especiais, paginação e A4.

## 5. Implementar desafio OTP

- Criar endpoint de solicitação com resposta não enumerável.
- Gerar OTP por CSPRNG e armazenar apenas verificador forte.
- Aplicar TTL, tentativas, cooldown, limite por período e invalidação no reenvio.
- Enviar template transacional específico com texto simples equivalente.
- Impedir que OTP, token e dados completos apareçam em logs.

## 6. Concluir assinatura atomicamente

- Validar envelope, versão atual, expiração, hashes, declarações e OTP em uma transação.
- Consumir o desafio e marcar o envelope como assinado uma única vez.
- Persistir nome, função, e-mail autenticado, data UTC e evidência técnica mínima.
- Produzir manifesto e selo criptográfico por chave gerenciada.
- Tornar retries idempotentes e replays inofensivos.

## 7. Construir a experiência do signatário

- Atualizar o e-mail para **Revisar e assinar proposta**.
- Adicionar resumo de identidade contratual e navegação interna.
- Adicionar **Solicitar correção** e reemissão de versão.
- Implementar etapas Revisão → Identidade → Código → Conclusão.
- Usar e-mail mascarado, campos com autocomplete e OTP com `inputmode` adequado.
- Vincular erros aos controles, gerenciar foco e anunciar estados assíncronos.
- Validar 320, 375, 390, 768 e 1440 px, zoom de 200% e teclado.

## 8. Emitir comprovante e verificação

- Gerar certificado de evidências com identificador e QR Code.
- Enviar comprovante ao cliente e à ORYNEO por idempotency key.
- Criar verificador público com resultado, data, versão e hash, sem expor o contrato.
- Disponibilizar downloads autenticados por URL curta.
- Testar adulteração, identificador inexistente e artefato indisponível.

## 9. Integrar CRM e cobrança

- Exibir estado do envelope, eventos principais e ação de reenvio controlada.
- Permitir revogação/substituição por usuário autorizado com motivo auditado.
- Fazer `prepare billing` exigir envelope `completed` e hashes válidos.
- Exibir aceite legado separadamente.
- Impedir que assinatura pendente dispare cobrança ou implantação.

## 10. Homologar e liberar

- Executar matriz de happy path e falhas em TEST.
- Confirmar e-mail OTP, assinatura, PDF, certificado e verificador ponta a ponta.
- Revisar RLS, logs, storage, rate limits, backup e restauração.
- Obter aprovação jurídica dos termos `v1.0`, privacidade e retenção.
- Ativar para um envelope interno controlado.
- Liberar LIVE por feature flag, com rollback que preserva envelopes concluídos.

## Gate final

- Todos os P0 da auditoria encerrados.
- Testes frontend, Deno, banco e browser aprovados.
- Nenhum segredo ou dado excessivo em URL, log ou verificador público.
- Documento e evidência reproduzíveis a partir do registro preservado.
- Uma alteração posterior sempre produz nova versão e nova assinatura.

