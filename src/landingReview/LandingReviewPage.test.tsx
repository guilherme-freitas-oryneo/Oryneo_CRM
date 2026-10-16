import {render,screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe,it,expect,vi} from 'vitest';
import {LandingReviewView,type PublicLandingReview} from './LandingReviewPage';
const review:PublicLandingReview={
 version:2,status:'review',company:'Cliente Fictício',customer_name:'Marina',
 contact_email:'marina@example.com',preview_url:'https://guilherme-freitas-oryneo.github.io/Oryneo_CRM/qa/cliente/index.html',
 preview_html_sha256:'a'.repeat(64),expires_at:'2026-12-01T12:00:00Z',
 accepted_at:null,published_url:null
};
describe('F04 aprovação de landing',()=>{
 it('oferece revisão com link externo seguro e exige aceite individual',async()=>{
  const user=userEvent.setup(),onApprove=vi.fn();
  render(<LandingReviewView review={review} onApprove={onApprove}/>);
  expect(screen.getByRole('link',{name:/Abrir prévia/})).toHaveAttribute('rel','noopener noreferrer');
  const button=screen.getByRole('button',{name:'Aprovar esta versão'});
  expect(button).toBeDisabled();
  await user.type(screen.getByLabelText('Nome completo'),'Marina Costa');
  await user.type(screen.getByLabelText('E-mail do destinatário'),'marina@example.com');
  await user.click(screen.getByRole('checkbox'));
  await user.click(button);
  expect(onApprove).toHaveBeenCalledWith({name:'Marina Costa',email:'marina@example.com'});
 });
 it('não permite que versões vencidas sejam aprovadas',()=>{
  render(<LandingReviewView review={{...review,status:'expired'}} onApprove={vi.fn()}/>);
  expect(screen.queryByRole('button',{name:'Aprovar esta versão'})).not.toBeInTheDocument();
 });
 it('só afirma publicação quando o servidor declarou estado publicado',()=>{
  const {rerender}=render(<LandingReviewView review={{...review,status:'approved'}} onApprove={vi.fn()}/>);
  expect(screen.getByText('Versão aprovada.')).toBeInTheDocument();
  expect(screen.queryByText('Landing page publicada.')).not.toBeInTheDocument();
  rerender(<LandingReviewView review={{...review,status:'published',published_url:review.preview_url}} onApprove={vi.fn()}/>);
  expect(screen.getByText('Landing page publicada.')).toBeInTheDocument();
 });
});
