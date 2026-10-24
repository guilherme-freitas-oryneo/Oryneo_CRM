# ORYNEO Assina — auditoria final de prontidão

**Data:** 24 de outubro de 2026  
**Escopo:** proposta comercial, aceite atual e evolução para assinatura eletrônica própria  
**Decisão:** implementação pode avançar em TEST; ativação como assinatura em LIVE permanece bloqueada.

## Evidência verificada

- O e-mail leva a uma proposta individual por token opaco.
- O token é armazenado como SHA-256; a seleção comercial fica em snapshot versionado e possui hash.
- Versões novas substituem as anteriores e propostas expiradas não recebem novo aceite.
- O aceite atual exige nome, o mesmo e-mail da proposta e checkbox não pré-selecionado.
- O banco registra apenas `accepted_at`, `accepted_name` e `accepted_email` como evidência do aceitante.
- A página mostra ao visitante o e-mail exato que a API exige. Quem possui o link consegue copiar esse e-mail e informar qualquer nome.
- O documento vinculado ao hash é o snapshot da proposta. A minuta de termos não faz parte desse hash.
- A única versão de termos publicada no projeto é `v0.9-homologacao`, marcada no próprio texto e na interface como minuta sem efeito contratual.
- O link atual carrega o token na query string de uma página no GitHub Pages. O token chega à infraestrutura de hospedagem no primeiro request e pode permanecer em histórico.
- Depois do vencimento, a leitura pública continua retornando o conteúdo da proposta; o vencimento hoje bloqueia somente um novo aceite.
- Produção contém cinco propostas: uma aceita, uma enviada e três substituídas. O registro aceito deve permanecer classificado como aceite comercial legado, sem promoção retroativa para assinatura eletrônica.

## O que já está bem resolvido

- Integridade e versionamento da seleção comercial.
- Separação clara entre aceite, pagamento e implantação.
- Valores, recorrências e adicionais apresentados antes do aceite.
- Estado substituído/expirado tratado no servidor.
- RLS e escrita restrita ao `service_role` na tabela de propostas.
- Layout responsivo: 1440 px e 375 px sem overflow horizontal.
- Operação por teclado, rótulos de campos e restauração de foco do modal de termos.
- Modal de termos em tela cheia no celular.
- Nenhum erro de console ou request no fluxo simulado de leitura e aceite.

## Bloqueios para LIVE

### P0 — instrumento contratual ainda é uma minuta

O texto disponível declara “NÃO PUBLICAR”, contém dados cadastrais e operacionais a confirmar e deixa em aberto retenção, subprocessadores, suporte, responsabilidade, foro e condições técnicas. Ele não pode compor uma assinatura definitiva.

**Correção obrigatória:** aprovar `v1.0`, completar a identificação da ORYNEO, validar condições comerciais e anexos, publicar PDF/HTML reproduzíveis e registrar versão e hash no envelope.

### P0 — identidade do signatário não é autenticada

O e-mail exibido na própria proposta satisfaz a única comparação de identidade. O nome é livre. A prova atual demonstra posse do link, não controle da caixa postal nem poderes de representação.

**Correção obrigatória:** código de uso único enviado ao e-mail cadastrado, nome e cargo/função do representante, declaração de poderes e reemissão quando o signatário precisar ser alterado.

### P0 — proposta e termos não formam um pacote único

O hash atual protege somente o JSON comercial. A minuta é carregada separadamente e pode falhar sem impedir o aceite. O PDF produzido pelo navegador varia conforme ambiente e não é um artefato canônico pré-assinatura.

**Correção obrigatória:** formar pacote imutável com proposta, termos, anexos e metadados; gerar o documento canônico no servidor; armazenar os hashes antes da assinatura; bloquear assinatura quando qualquer peça não estiver disponível.

### P0 — segredo de acesso na URL da hospedagem

O token está em `?token=`. A requisição inicial à hospedagem contém esse segredo, e o endereço pode ser salvo em histórico, logs e compartilhamentos.

**Correção obrigatória:** usar fragmento de URL ou troca imediata por sessão curta em domínio próprio, remover o segredo do endereço visível, aplicar política `no-referrer`, CSP e proibição de framing.

## Riscos altos

### P1 — ausência de trilha de auditoria

Faltam eventos de emissão, abertura, envio e validação do código, assinatura, conclusão, reenvio, expiração, recusa e revogação. Também faltam identificador de assinatura, comprovante e exportação probatória.

### P1 — endpoint público sem controles de tentativa

O token possui boa entropia, mas a API não possui rate limit. O novo fluxo de OTP exigirá limite por envelope, IP e destinatário, expiração curta, cooldown de reenvio, máximo de tentativas e respostas que não revelem estado sensível.

### P1 — contratante incompletamente identificado

A proposta usa um nome de empresa livre. Para contratação empresarial, o pacote deve guardar razão social, CNPJ e identificação do representante. CPF não deve ser coletado na primeira versão sem necessidade e validação jurídica; um CPF digitado sem verificação aumenta exposição sem provar identidade.

### P1 — privacidade da evidência

IP, user agent e histórico de autenticação são dados pessoais. O aviso de privacidade deve explicar finalidade, base legal, compartilhamentos, segurança, retenção e exercício de direitos. O acesso interno à evidência deve ser mais restrito que a leitura comercial comum.

### P1 — ausência de comprovante final

Depois do aceite, a interface mostra apenas data e próximo passo. O assinante precisa receber documento final, certificado de evidências, código de verificação e confirmação por e-mail.

### P1 — cobertura de testes insuficiente no servidor

Os testes atuais cobrem a interface e o modal. Não existe suíte específica para `proposal-public` ou para `crm_accept_proposal`, incluindo link vazado, concorrência, replay, expiração e indisponibilidade dos termos.

## Auditoria jurídica

### Base aplicável

- O Código Civil admite liberdade de forma quando a lei não exige forma especial (arts. 104 e 107).
- O art. 10, § 2º, da MP nº 2.200-2 admite outros meios de comprovação de autoria e integridade quando aceitos pelas partes.
- A classificação da Lei nº 14.063 é uma referência técnica útil, mas o capítulo que define seu uso exclui relações exclusivamente privadas do seu âmbito direto.
- O art. 784, § 4º, do CPC admite assinatura eletrônica em título executivo eletrônico e dispensa testemunhas quando a integridade for conferida por provedor de assinatura. O enquadramento do ORYNEO Assina como provedor e a estratégia de executividade devem ser aprovados juridicamente.
- Quando o CDC incidir, o Decreto nº 7.962/2013 exige informação clara, correção de erros, confirmação e acesso ao contrato; o direito de arrependimento deve ser tratado conforme o caso concreto.
- O tratamento da evidência deve obedecer aos princípios e medidas de segurança da LGPD. Biometria fica fora da primeira versão.

### Terminologia aprovada

- Produto e interface: **assinatura eletrônica ORYNEO**.
- “Assinatura digital qualificada” somente quando houver certificado ICP-Brasil válido.
- O selo técnico da ORYNEO prova integridade do pacote e da trilha; não deve ser apresentado como certificado pessoal ICP-Brasil do cliente.

### Aprovações jurídicas necessárias

1. Termos Gerais `v1.0` e dados cadastrais da ORYNEO.
2. Cláusula expressa de aceitação do mecanismo eletrônico.
3. Identificação e poderes do representante empresarial.
4. Critério de uso de testemunhas ou ICP-Brasil para contratos de maior risco.
5. Política de retenção da prova e procedimento de contestação.
6. Aviso de privacidade da assinatura e lista de subprocessadores.
7. DPA e anexos técnicos finais quando integrarem a contratação.

## Auditoria de UI e UX

### Estado atual aprovado

- Hierarquia e leitura da proposta são claras.
- A tangibilização dos itens funciona em desktop e celular.
- A composição financeira separa pagamento inicial e recorrências.
- O checkbox inicia desmarcado.
- O modal de termos retém e restaura foco corretamente.

### Ajustes para o ORYNEO Assina

1. Trocar o CTA do e-mail para **Revisar e assinar proposta**.
2. Exibir no topo número, versão, validade, razão social e CNPJ.
3. Incluir navegação curta: Escopo, Investimento, Termos e Assinatura.
4. Disponibilizar **Solicitar correção** antes da assinatura; a correção gera nova versão.
5. Colocar termos e política de privacidade antes das declarações de concordância.
6. Exibir versão e hash abreviado dos documentos ao lado do aceite.
7. Usar duas confirmações separadas: poderes de representação e concordância com o pacote.
8. Enviar o OTP somente depois dessas confirmações.
9. Mostrar o destino de OTP mascarado e o prazo do código.
10. Informar, imediatamente antes do último botão, que a ação produz assinatura eletrônica.
11. No sucesso, mostrar código, data/hora, downloads e botão de verificação.
12. Associar mensagens de erro ao campo correspondente e mover foco para o erro.

## Fluxo alvo

1. ORYNEO emite um envelope com proposta, termos e anexos imutáveis.
2. Cliente recebe **Revisar e assinar proposta**.
3. Página troca a capacidade de acesso por uma sessão curta e remove o segredo da URL.
4. Cliente revisa o pacote e solicita correção ou segue para assinatura.
5. Cliente informa nome e função; o e-mail é o destinatário previamente cadastrado.
6. Cliente declara poderes e concordância com versões identificadas.
7. Sistema envia OTP, registra somente seu verificador seguro e aplica limites.
8. OTP válido conclui a assinatura em transação única.
9. Sistema sela o manifesto de evidências e gera PDF/certificado final.
10. Cliente e ORYNEO recebem o comprovante; a página de verificação expõe apenas dados mínimos.
11. A cobrança só pode ser preparada a partir do envelope concluído.

## Máquina de estados

`draft → sent → viewed → challenge_pending → signed → completed`

Saídas controladas: `superseded`, `expired`, `declined`, `revoked` e `failed_review`.

Nenhum estado posterior pode voltar a `sent`; nova condição comercial gera nova versão e novo envelope.

## Controles técnicos obrigatórios

- OTP aleatório, curto, com verificador HMAC/Argon2; nunca SHA-256 simples do código.
- TTL, máximo de tentativas, cooldown, bloqueio e invalidação no reenvio.
- Transação com lock para consumir OTP e assinar uma única vez.
- Eventos append-only com sequência, hash anterior e hash do evento.
- Manifesto final assinado por chave gerenciada e auditável.
- PDF e evidências em storage privado, com URL assinada de curta duração.
- Nenhum token, OTP, e-mail completo ou IP completo em logs operacionais.
- CSP, `no-referrer`, `noindex`, proteção contra framing e ausência de terceiros na página.
- Verificador público com identificador aleatório e exposição mínima.
- Backups, relógio UTC, reconciliação de artefatos e teste de recuperação.

## Critério de liberação

LIVE somente poderá ser habilitado quando:

- não houver P0 aberto;
- o jurídico tiver aprovado os documentos e a política de evidência;
- todos os cenários negativos estiverem automatizados;
- o fluxo passar em TEST por desktop, celular, teclado e zoom;
- OTP, trilha, PDF, comprovante, verificação e e-mail forem reconciliados ponta a ponta;
- nenhum aceite legado tiver sido promovido silenciosamente;
- a preparação da cobrança exigir envelope assinado e íntegro.

## Fontes primárias

- [Código Civil](https://www.planalto.gov.br/ccivil_03/leis/2002/l10406compilada.htm)
- [MP nº 2.200-2/2001](https://www.planalto.gov.br/ccivil_03/mpv/antigas_2001/2200-2.htm)
- [Lei nº 14.063/2020](https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2020/lei/l14063.htm)
- [Código de Processo Civil](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2015/lei/l13105.htm)
- [Decreto nº 7.962/2013](https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2013/decreto/d7962.htm)
- [LGPD](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm)

