export type MailAddress = { name?: string | null; address: string };

export type MailFolderUse = 'inbox' | 'sent' | 'drafts' | 'archive' | 'junk' | 'trash' | 'other';

export type MailFolder = {
  id: string;
  mailbox_id: string;
  name: string;
  remote_name: string;
  special_use: MailFolderUse;
  total_count: number;
  unread_count: number;
};

export type MailDealLink = { deal_id: string; deal_title: string; automatic: boolean };

export type MailThreadSummary = {
  id: string;
  subject: string;
  participants: MailAddress[];
  preview: string;
  last_message_at: string;
  unread: boolean;
  starred: boolean;
  has_attachments: boolean;
  message_count: number;
  deal_links: MailDealLink[];
};

export type MailAttachment = {
  id: string;
  message_id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  content_id?: string | null;
  inline: boolean;
};

export type MailMessage = {
  id: string;
  thread_id: string;
  internet_message_id: string;
  in_reply_to?: string | null;
  references: string[];
  subject: string;
  from: MailAddress;
  to: MailAddress[];
  cc: MailAddress[];
  bcc: MailAddress[];
  sent_at: string;
  received_at: string;
  body_text: string;
  body_html?: string | null;
  direction: 'inbound' | 'outbound';
  unread: boolean;
  starred: boolean;
  attachments: MailAttachment[];
};

export type MailDraft = {
  id: string;
  mailbox_id: string;
  thread_id?: string | null;
  reply_to_message_id?: string | null;
  to: MailAddress[];
  cc: MailAddress[];
  bcc: MailAddress[];
  subject: string;
  body_text: string;
  body_html: string;
  revision: number;
  updated_at: string;
};

export type MailSyncStatus = {
  state: 'idle' | 'syncing' | 'degraded' | 'error';
  last_success_at?: string | null;
  last_error_code?: string | null;
  backlog: number;
};
