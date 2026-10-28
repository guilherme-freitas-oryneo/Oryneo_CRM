import { describe, expect, it } from 'vitest';
import { CONTENT_VERSION, slides, references } from './content';
import { blockMatches, splitHighlights, type PlaybookAnnotation } from './api';

const note = (overrides:Partial<PlaybookAnnotation>={}): PlaybookAnnotation=>({
  id:'11111111-1111-4111-8111-111111111111',
  user_id:'22222222-2222-4222-8222-222222222222',
  slide_id:'01',block_key:'lead',start_offset:0,end_offset:4,
  quote:'Lead',note:'Nota privada',color:'yellow',visibility:'private',
  content_version:CONTENT_VERSION,created_at:'2026-10-28T00:00:00Z',updated_at:'2026-10-28T00:00:00Z',
  ...overrides
});
describe('currículo executivo',()=>{
  it('tem 64 slides com IDs imutáveis, únicos e sequenciais',()=>{
    expect(slides).toHaveLength(64);
    expect(slides.map(s=>s.id)).toEqual(Array.from({length:64},(_,i)=>String(i+1).padStart(2,'0')));
    expect(slides.every(s=>s.title&&s.lead&&s.decision&&s.points.length===3)).toBe(true);
  });
  it('cobre as cinco partes e fontes de aprendizagem verificáveis',()=>{
    expect(new Set(slides.map(s=>s.part))).toEqual(new Set(['Estratégia','Diagnóstico','Conversão','Operação','Performance']));
    expect(references.length).toBeGreaterThanOrEqual(7);
    expect(references.every(ref=>ref.url.startsWith('https://'))).toBe(true);
  });
  it('explicita que complementos são vinculados ao CRM',()=>{
    expect(slides.find(s=>s.id==='10')?.decision).toMatch(/avulsos/i);
    expect(slides.find(s=>s.id==='46')?.decision).toMatch(/isolada/i);
  });
});
describe('âncoras estáveis de marcações',()=>{
  it('preserva o texto e destaca apenas a posição exata',()=>{
    const text='Lead qualificado';
    const mark=note();
    expect(blockMatches(text,mark)).toBe(true);
    expect(splitHighlights(text,[mark])).toEqual([
      {text:'Lead',mark},{text:' qualificado',mark:null}
    ]);
  });
  it('não aplica marcação quando o conteúdo mudou',()=>{
    const changed=note({quote:'Outro'});
    expect(blockMatches('Lead qualificado',changed)).toBe(false);
    expect(splitHighlights('Lead qualificado',[changed])).toEqual([{text:'Lead qualificado',mark:null}]);
  });
  it('não aplica marcação de versão diferente',()=>{
    const old=note({content_version:'0.9.0'});
    expect(blockMatches('Lead qualificado',old)).toBe(false);
  });
  it('suporta múltiplos trechos e marcação sobreposta',()=>{
    const left=note({end_offset:4,quote:'Lead'});
    const right=note({id:'33333333-3333-4333-8333-333333333333',start_offset:2,end_offset:9,quote:'ad qual',color:'blue'});
    const pieces=splitHighlights('Lead qualificado',[left,right]);
    expect(pieces.map(p=>p.text).join('')).toBe('Lead qualificado');
    expect(pieces.some(p=>p.mark?.color==='blue')).toBe(true);
  });
});
