import {describe,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {SdrIntelligencePanel} from './SdrIntelligencePanel';
const get=vi.fn(async()=>({
 knowledge:[{id:'k',release_version:1,status:'draft',approved_by:null,content_sha256:null}],
 dictionaries:[{id:'d',version:1,status:'draft',approved:false,
  contentHash:null,dictionary:null}],
 selected:{knowledge_release_id:null,dictionary_release_id:null,revision:1,enabled:false},
 role:'publisher' as const,
}));
vi.mock('./api.ts',()=>({
 listRemoteSemanticReleases:()=>get(),
 createRemoteSemanticDraft:vi.fn(),freezeRemoteSemanticPair:vi.fn(),
}));
describe('SDR versioned semantic workbench safe interactions',()=>{
 it('shows 18 intents, creates no dispatch affordance for viewer and previews cancellation negation',()=>{
  render(<SdrIntelligencePanel workspaceId={null} role="viewer"/>);
  expect(screen.getByRole('region',{name:'Inteligência e intenções do SDR'})).toBeInTheDocument();
  expect(screen.getByText('Intenções e linguagem do SDR')).toBeInTheDocument();
  expect(screen.getByRole('button',{name:/Salvar nova versão/})).toBeDisabled();
  expect(screen.getByRole('button',{name:/Congelar inativo/})).toBeDisabled();
  fireEvent.change(screen.getByRole('textbox',{name:'Mensagem de teste'}),{
   target:{value:'não quero cancelar'}});
  expect(screen.getByRole('status')).toHaveTextContent(/Ambígua ou ausente/);
  expect(screen.queryByRole('button',{name:/Enviar WhatsApp|Enviar mensagem|Cobrar agora/i})).not.toBeInTheDocument();
 });
 it('supports editing negative examples without publishing, retaining the other 17 intents',async()=>{
  const user=userEvent.setup();
  render(<SdrIntelligencePanel workspaceId={null} role="publisher"/>);
  await user.click(screen.getByRole('button',{name:/Cancelamento/}));
  const textarea=screen.getByRole('textbox',{name:'Exemplos negativos'});
  expect(textarea).toHaveValue(expect.stringContaining('não quero cancelar'));
  fireEvent.change(textarea,{target:{value:'não vou cancelar\nnunca cancelei'}});
  expect(textarea).toHaveValue('não vou cancelar\nnunca cancelei');
  expect(screen.getAllByRole('button',{pressed:false}).length).toBeGreaterThan(10);
  expect(screen.getByRole('button',{name:/Salvar nova versão/})).toBeDisabled();
 });
 it('remote read-only inventory does not silently enable stage4 release',async()=>{
  render(<SdrIntelligencePanel workspaceId="11111111-1111-4111-8111-111111111111" role="viewer"/>);
  await waitFor(()=>expect(get).toHaveBeenCalled());
  expect(screen.getByText('v1.0.0')).toBeInTheDocument();
  expect(screen.getByRole('button',{name:/Congelar inativo/})).toBeDisabled();
 });
});
