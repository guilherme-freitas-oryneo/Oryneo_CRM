import assert from 'node:assert/strict';
import {
  intakeConfirmationStateForError,
  processIntakeConfirmationJobs,
  type IntakeConfirmationDependencies,
  type IntakeConfirmationJob,
} from '../_shared/mail/intake-confirmation.ts';
import { renderRequestReceivedEmail } from '../_shared/mail/request-received-template.ts';
import { renderImplementationStartedEmail } from '../_shared/mail/implementation-started-template.ts';
import { createIntakeMailWorkerHandler } from '../intake-mail-worker/handler.ts';

const job: IntakeConfirmationJob = {
  jobType: 'lead_received_email',
  requestId: '11111111-1111-4111-8111-111111111111',
  dealId: '22222222-2222-4222-8222-222222222222',
  data: {
    contact: 'Marina Souza',
    email: 'marina@example.com',
    company: 'Aurora Clínica',
    form_submission: { intent: 'conversation' },
  },
};

Deno.test('E16 confirma a solicitação sem inventar plano ou pagamento', () => {
  const rendered = renderRequestReceivedEmail({ firstName: 'Marina', company: 'Aurora Clínica' });
  assert.equal(rendered.subject, 'Recebemos sua solicitação · ORYNEO');
  assert.match(rendered.text, /solicitação da Aurora Clínica/);
  assert.match(rendered.html, /Sua solicitação chegou até nós/);
  assert.doesNotMatch(`${rendered.text}\n${rendered.html}`, /pagamento confirmado|plano (Start|Growth|Scale)/i);
});

Deno.test('worker envia uma vez com request_id como chave idempotente', async () => {
  const sent: Array<Record<string, unknown>> = [];
  const finished: Array<Record<string, unknown>> = [];
  const dependencies: IntakeConfirmationDependencies = {
    claimDue: () => Promise.resolve([job]),
    send: (input) => {
      sent.push(input as unknown as Record<string, unknown>);
      return Promise.resolve({ internetMessageId: '<e16@oryneo.com.br>', alreadyAccepted: false });
    },
    markSent: (requestId, internetMessageId) => {
      finished.push({ requestId, internetMessageId });
      return Promise.resolve();
    },
    markFailed: () => Promise.reject(new Error('não deveria falhar')),
  };

  assert.deepEqual(await processIntakeConfirmationJobs(dependencies), { claimed: 1, sent: 1, failed: 0 });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].idempotencyKey, job.requestId);
  assert.deepEqual(sent[0].to, [{ name: 'Marina Souza', address: 'marina@example.com' }]);
  assert.deepEqual(finished, [{ requestId: job.requestId, internetMessageId: '<e16@oryneo.com.br>' }]);
});

Deno.test('retry reconciliado mantém a mesma chave e finaliza sem duplicar conteúdo', async () => {
  let key = '';
  const dependencies: IntakeConfirmationDependencies = {
    claimDue: () => Promise.resolve([job]),
    send: (input) => {
      key = input.idempotencyKey;
      return Promise.resolve({ internetMessageId: '<e16@oryneo.com.br>', alreadyAccepted: true });
    },
    markSent: () => Promise.resolve(),
    markFailed: () => Promise.resolve(),
  };

  const result = await processIntakeConfirmationJobs(dependencies);
  assert.equal(key, job.requestId);
  assert.deepEqual(result, { claimed: 1, sent: 1, failed: 0 });
});

Deno.test('destinatário inválido falha antes do transporte e fica auditável', async () => {
  let transported = false;
  const failures: Array<Record<string, unknown>> = [];
  const dependencies: IntakeConfirmationDependencies = {
    claimDue: () => Promise.resolve([{ ...job, data: { ...job.data, email: 'marina\nBcc:intruso@example.com' } }]),
    send: () => { transported = true; return Promise.reject(new Error('não deveria enviar')); },
    markSent: () => Promise.resolve(),
    markFailed: (requestId, errorCode) => { failures.push({ requestId, errorCode }); return Promise.resolve(); },
  };

  assert.deepEqual(await processIntakeConfirmationJobs(dependencies), { claimed: 1, sent: 0, failed: 1 });
  assert.equal(transported, false);
  assert.deepEqual(failures, [{ requestId: job.requestId, errorCode: 'INTAKE_CONFIRMATION_INVALID' }]);
});

Deno.test('falha ambígua de transporte permanece em conciliação', async () => {
  const failures: Array<Record<string, unknown>> = [];
  const dependencies: IntakeConfirmationDependencies = {
    claimDue: () => Promise.resolve([job]),
    send: () => Promise.reject(new Error('MAIL_IN_PROGRESS')),
    markSent: () => Promise.resolve(),
    markFailed: (requestId, errorCode) => { failures.push({ requestId, errorCode }); return Promise.resolve(); },
  };

  assert.deepEqual(await processIntakeConfirmationJobs(dependencies), { claimed: 1, sent: 0, failed: 1 });
  assert.deepEqual(failures, [{ requestId: job.requestId, errorCode: 'MAIL_IN_PROGRESS' }]);
});

Deno.test('classifica somente falhas recuperáveis para retry', () => {
  assert.equal(intakeConfirmationStateForError('INTAKE_CONFIRMATION_INVALID'), 'suppressed');
  assert.equal(intakeConfirmationStateForError('MAIL_IN_PROGRESS'), 'reconciliation');
  assert.equal(intakeConfirmationStateForError('INTAKE_CONFIRMATION_SEND'), 'failed');
});

Deno.test('worker exige token cron e não revela detalhes internos', async () => {
  let processed = 0;
  const handler = createIntakeMailWorkerHandler({
    verifyToken: (token) => Promise.resolve(token === 'segredo-correto'),
    process: () => { processed += 1; return Promise.resolve({ claimed: 1, sent: 1, failed: 0 }); },
  });
  const unauthorized = await handler(new Request('https://example.test/intake-mail-worker', { method: 'POST' }));
  assert.equal(unauthorized.status, 401);
  assert.equal(processed, 0);
  const accepted = await handler(new Request('https://example.test/intake-mail-worker', {
    method: 'POST', headers: { 'x-oryneo-cron': 'segredo-correto' },
  }));
  assert.equal(accepted.status, 200);
  assert.deepEqual(await accepted.json(), { ok: true, claimed: 1, sent: 1, failed: 0 });
});

Deno.test('início de implantação: template oficial não afirma pagamento nem acesso liberado', () => {
  const input = {firstName:'Marina',company:'Aurora & Cia'};
  const rendered = renderImplementationStartedEmail(input);
  assert.equal(rendered.subject, 'Implantação iniciada · ORYNEO');
  assert.match(rendered.text,/Aurora & Cia/);
  assert.match(rendered.html,/Aurora &amp; Cia/);
  assert.doesNotMatch(rendered.text + rendered.html,/pagamento confirmado|acesso liberado|senha temporária/i);
});
Deno.test('worker distingue automações na mesma fila sem alterar destinatário',async()=>{
 const captured: Array<{subject:string;to:unknown}>=[];
 const deps: IntakeConfirmationDependencies = {
   claimDue:()=>Promise.resolve([{...job,jobType:'implementation_started_email'}]),
   send:(input)=>{captured.push({subject:input.subject,to:input.to});return Promise.resolve({internetMessageId:'<impl@oryneo.com.br>',alreadyAccepted:false})},
   markSent:()=>Promise.resolve(),
   markFailed:()=>Promise.reject(new Error('should not fail')),
 };
 assert.deepEqual(await processIntakeConfirmationJobs(deps),{claimed:1,sent:1,failed:0});
 assert.equal(captured[0].subject,'Implantação iniciada · ORYNEO');
 assert.deepEqual(captured[0].to,[{name:'Marina Souza',address:'marina@example.com'}]);
});
