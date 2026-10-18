import { describe, expect, it } from 'vitest';
import {
  billingEnvironmentMatchesLivemode,
  getBillingEnvironmentConfig,
} from '../../supabase/functions/_shared/billing/environment';

const env = (values: Record<string, string | undefined>) => (name: string) => values[name];

describe('billing environment', () => {
  it('usa credenciais e chave publicável exclusivas do sandbox', () => {
    const config = getBillingEnvironmentConfig('test', env({
      STRIPE_TEST_SECRET_KEY: 'rk_test_fixture',
      STRIPE_TEST_PUBLISHABLE_KEY: 'pk_test_fixture',
      STRIPE_LIVE_SECRET_KEY: 'rk_live_other',
      STRIPE_LIVE_PUBLISHABLE_KEY: 'pk_live_other',
    }));
    expect(config).toEqual({
      environment: 'test', livemode: false,
      secretKey: 'rk_test_fixture', publishableKey: 'pk_test_fixture',
    });
  });

  it('usa credenciais e chave publicável exclusivas do Live', () => {
    const config = getBillingEnvironmentConfig('live', env({
      STRIPE_TEST_SECRET_KEY: 'rk_test_other',
      STRIPE_TEST_PUBLISHABLE_KEY: 'pk_test_other',
      STRIPE_LIVE_SECRET_KEY: 'rk_live_fixture',
      STRIPE_LIVE_PUBLISHABLE_KEY: 'pk_live_fixture',
    }));
    expect(config).toEqual({
      environment: 'live', livemode: true,
      secretKey: 'rk_live_fixture', publishableKey: 'pk_live_fixture',
    });
  });

  it('falha fechado quando segredo e modo divergem ou a configuração está incompleta', () => {
    expect(() => getBillingEnvironmentConfig('live', env({
      STRIPE_LIVE_SECRET_KEY: 'rk_test_wrong',
      STRIPE_LIVE_PUBLISHABLE_KEY: 'pk_live_fixture',
    }))).toThrow('BILLING_ENVIRONMENT_MISMATCH');
    expect(() => getBillingEnvironmentConfig('test', env({
      STRIPE_TEST_SECRET_KEY: 'rk_test_fixture',
    }))).toThrow('BILLING_ENVIRONMENT_NOT_CONFIGURED');
  });

  it('confere o modo do pedido, sessão e webhook', () => {
    expect(billingEnvironmentMatchesLivemode('test', false)).toBe(true);
    expect(billingEnvironmentMatchesLivemode('test', true)).toBe(false);
    expect(billingEnvironmentMatchesLivemode('live', true)).toBe(true);
    expect(billingEnvironmentMatchesLivemode('live', false)).toBe(false);
  });
});
