export type PaidOrderPostpaymentDependencies = {
  ensureTrafficSubscription(): Promise<void>;
  sendWelcome(): Promise<unknown>;
  waitUntil?: (job: Promise<unknown>) => void;
  onWelcomeError?: (error: unknown) => void;
};

export async function runPaidOrderPostpayment(dependencies: PaidOrderPostpaymentDependencies): Promise<void> {
  const welcome = dependencies.sendWelcome().catch((error) => {
    dependencies.onWelcomeError?.(error);
  });
  if (dependencies.waitUntil) dependencies.waitUntil(welcome);
  else await welcome;
  await dependencies.ensureTrafficSubscription();
}
