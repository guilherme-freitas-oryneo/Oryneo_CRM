import { describe, expect, it } from 'vitest';
import { runPaidOrderPostpayment } from '../../supabase/functions/_shared/billing/postpayment';

describe('pós-pagamento', () => {
  it('agenda a boas-vindas antes de propagar falha na recorrência de tráfego', async () => {
    const order: string[] = [];
    let welcomeJob: Promise<unknown> | undefined;

    await expect(runPaidOrderPostpayment({
      sendWelcome: async () => { order.push('boas-vindas'); },
      waitUntil: (job) => { order.push('agendado'); welcomeJob = job; },
      ensureTrafficSubscription: async () => {
        order.push('recorrência');
        throw new Error('TRAFFIC_PAYMENT_METHOD_UNAVAILABLE');
      },
    })).rejects.toThrow('TRAFFIC_PAYMENT_METHOD_UNAVAILABLE');

    await welcomeJob;
    expect(order).toContain('boas-vindas');
    expect(order.indexOf('agendado')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('agendado')).toBeLessThan(order.indexOf('recorrência'));
  });

  it('aguarda boas-vindas no runtime local antes de iniciar a recorrência', async () => {
    const order: string[] = [];

    await runPaidOrderPostpayment({
      sendWelcome: async () => { order.push('boas-vindas'); },
      ensureTrafficSubscription: async () => { order.push('recorrência'); },
    });

    expect(order).toEqual(['boas-vindas', 'recorrência']);
  });
});
