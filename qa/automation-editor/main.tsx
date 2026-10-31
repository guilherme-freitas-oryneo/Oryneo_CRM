/** Isolated visual fixture: no CRM session, no production credentials and no remote worker. */
import React from 'react';
import {createRoot} from 'react-dom/client';
import {AutomationsWorkspace} from '../../src/automation/AutomationsWorkspace';

const root=document.getElementById('root');
if(!root)throw Error('No editor fixture root');
createRoot(root).render(<React.StrictMode><AutomationsWorkspace userId="qa-visual-editor-no-backend"/></React.StrictMode>);
