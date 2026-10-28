import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { BillingAction } from './BillingAction';

describe('BillingAction', () => {
 it('prepara e apresenta o link de cobrança para cópia',async()=>{
  const user=userEvent.setup();const prepare=vi.fn().mockResolvedValue({reference:'ORY-1',url:'https://example.com/pagar/?token=seguro'});
  render(<BillingAction canPrepare onPrepare={prepare}/>);
  await user.click(screen.getByRole('button',{name:'Preparar cobrança'}));
  expect(prepare).toHaveBeenCalledOnce();
  expect(await screen.findByText('ORY-1')).toBeInTheDocument();
  expect(screen.getByRole('textbox')).toHaveValue('https://example.com/pagar/?token=seguro');
  expect(screen.getByRole('link',{name:'Abrir checkout em nova aba'})).toHaveAttribute('href','https://example.com/pagar/?token=seguro');
  expect(screen.getByRole('link',{name:'Abrir checkout em nova aba'})).toHaveAttribute('target','_blank');
  expect(screen.queryByText('COBRANÇA EM MODO DE TESTE')).not.toBeInTheDocument();
 });
});
