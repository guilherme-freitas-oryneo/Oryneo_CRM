# Meta MCP — auditoria de acesso

Data: 2026-10-24 UTC. Ambiente: Codex CLI em workspace cloud desta sessão.

| Etapa | Observação |
| --- | --- |
| Registro inicial | `codex mcp list`: nenhum servidor configurado. |
| Servidor registrado | `whatsapp_business_tools`, Streamable HTTP, `https://mcp.facebook.com/whatsapp_business_tools`; `codex mcp get` confirma nome, URL e transporte. |
| Alcance HTTP | GET sem autenticação recebeu HTTP 405; isso não demonstra OAuth nem acesso a negócio. |
| OAuth | `codex mcp list`: `Not logged in`. O fluxo CLI exibiu autorização interativa Meta, sem conclusão nesta sessão. Nenhuma credencial foi copiada para repositório. |
| Ferramentas e ativos | Nenhuma ferramenta `whatsapp_biz_*` exposta aqui; businesses, apps, WABA, contas, números, templates e webhooks **não verificáveis**. |
| Número comercial | Elegibilidade, `phone_number_id`, registro e coexistência **não verificáveis**. Nenhuma ação de vinculação foi executada. |

Próxima ação com intervenção indispensável: o titular autenticar o servidor `whatsapp_business_tools` pelo fluxo OAuth legítimo no cliente Codex que operará a integração, sem enviar senha, OTP ou token em chat. Depois, listar ferramentas e ler `whatsapp_biz_businesses`, contas e números; comparar o ativo retornado com a titularidade ORYNEO antes de criar ou migrar qualquer recurso.

O MCP é administrativo. Mesmo autenticado, não comprovará envio/recebimento da Cloud API nem saúde do CRM.
