import { describe, expect, it } from 'vitest';
import { firstContactScenarios } from './fixtures';

describe('firstContactScenarios', () => {
  it('cobre os oito cenários representativos aprovados para o lote 1', () => {
    expect(firstContactScenarios).toHaveLength(8);
    expect(new Set(firstContactScenarios.map((scenario) => scenario.input.acquisitionChannels?.length))).toEqual(
      new Set([1, 2, 3, 4]),
    );
    for (const scenario of firstContactScenarios) {
      expect(scenario.input.acquisitionChannels).toContain(scenario.input.primaryAcquisitionChannel);
    }
    expect(new Set(firstContactScenarios.map((scenario) => scenario.input.intent))).toEqual(
      new Set(['conversation', 'contract']),
    );
    expect(new Set(firstContactScenarios.map((scenario) => scenario.input.plan))).toEqual(
      new Set(['Start', 'Growth', 'Scale']),
    );
    expect(new Set(firstContactScenarios.map((scenario) => scenario.input.cycle))).toEqual(
      new Set(['monthly', 'annual']),
    );
    expect(new Set(firstContactScenarios.map((scenario) => scenario.input.addOns.join('+')))).toEqual(
      new Set(['', 'landing-page', 'traffic', 'landing-page+traffic']),
    );
  });

  it('usa somente o wordmark monocromático nos cenários', () => {
    for (const scenario of firstContactScenarios) {
      expect(scenario.input.logoUrl).toBe('/oryneo-wordmark-mono.png');
    }
  });
});
