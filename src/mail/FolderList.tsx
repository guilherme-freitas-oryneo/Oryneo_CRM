import { Archive, FileText, Inbox, Mail, Send, ShieldAlert, Trash2 } from 'lucide-react';
import type { MailFolder } from './types';

const icon = { inbox: Inbox, sent: Send, drafts: FileText, archive: Archive, junk: ShieldAlert, trash: Trash2, other: Mail };

export function FolderList({ folders, selected, onSelect }: { folders: MailFolder[]; selected: string | null; onSelect(id: string): void }) {
  return <nav className="mail-folders" aria-label="Pastas de e-mail">
    {folders.map(folder => { const Icon = icon[folder.special_use]; return <button key={folder.id} className={selected === folder.id ? 'active' : ''} onClick={() => onSelect(folder.id)}>
      <Icon size={17}/><span>{folder.name}</span>{folder.unread_count > 0 && <strong>{folder.unread_count}</strong>}
    </button>; })}
  </nav>;
}
