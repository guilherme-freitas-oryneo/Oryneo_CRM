import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { EmailPreviewGallery } from './emailPreview/EmailPreviewGallery';
import './styles.css';
import './login.css';

const isEmailPreview = new URLSearchParams(window.location.search).has('email-preview');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{isEmailPreview ? <EmailPreviewGallery /> : <App />}</React.StrictMode>,
);
