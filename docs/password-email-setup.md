# E-mails de troca de senha do CRM ORYNEO

Fluxo: pessoa autenticada informa e confirma a nova senha; o Supabase Auth envia um código de reautenticação; a pessoa digita o código e só então a senha é atualizada. A notificação de senha alterada deve ser habilitada no projeto.

Assuntos:

- Reautenticação: `Código para confirmar sua troca de senha | ORYNEO`
- Senha alterada: `Sua senha do CRM ORYNEO foi alterada`

Arquivos HTML: `supabase/templates/reauthentication.html` e `supabase/templates/password_changed.html`. O primeiro usa `{{ .Token }}` do Supabase Auth. Não há senha, link de rastreamento ou anexo no e-mail.

Configuração hospedada pendente de acesso à configuração do Auth e ao SMTP da caixa confirmada:

1. Em Authentication > Emails > SMTP Settings, configurar a caixa remetente, nome `ORYNEO`, servidor SMTP autenticado e TLS.
2. Em Authentication > Emails > Templates, aplicar o assunto e HTML de reautenticação. Habilitar a notificação de senha alterada com o segundo assunto e HTML.
3. Em Authentication > Providers > Email, exigir reautenticação para troca de senha. Confirmar a URL de redirecionamento do CRM para convites e recuperação.
4. Conferir SPF, DKIM e DMARC do domínio remetente, alinhamento do envelope e entrega real em ao menos duas caixas de teste. Classificação como spam não pode ser garantida por texto ou HTML; depende também de DNS, reputação e envio autenticado.

Não registrar senha SMTP em arquivos, commits ou conversa. O conector Hostinger disponível nesta sessão não expõe caixas de e-mail nem credenciais SMTP.
