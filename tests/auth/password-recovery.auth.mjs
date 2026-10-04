// End-to-end password recovery against the Firebase Auth emulator, using the real auth-recovery.js.
// Run with: pnpm test:auth (needs Java).
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut,
  sendPasswordResetEmail, verifyPasswordResetCode, confirmPasswordReset } from 'firebase/auth';

const PROJECT = 'demo-goroutex';
const EMULATOR = 'http://127.0.0.1:9099';
const context = vm.createContext({ console: { warn() {}, error() {} } });
vm.runInContext(readFileSync('auth-recovery.js', 'utf8'), context);
const R = context.GoRouteXAuthRecovery;

const app = initializeApp({ apiKey: 'demo-key', projectId: PROJECT, authDomain: `${PROJECT}.firebaseapp.com` });
const auth = getAuth(app);
connectAuthEmulator(auth, EMULATOR, { disableWarnings: true });
// The compat-style surface auth-recovery.js expects (login.html and auth-action.html pass firebase.auth()).
const compat = {
  sendPasswordResetEmail: (email, settings) => sendPasswordResetEmail(auth, email, settings),
  verifyPasswordResetCode: (code) => verifyPasswordResetCode(auth, code),
  confirmPasswordReset: (code, password) => confirmPasswordReset(auth, code, password)
};
const KNOWN = 'owner@goroutex.test';

async function resetCodesFor(email) {
  const response = await fetch(`${EMULATOR}/emulator/v1/projects/${PROJECT}/oobCodes`);
  const { oobCodes = [] } = await response.json();
  return oobCodes.filter((entry) => entry.email === email && entry.requestType === 'PASSWORD_RESET').map((entry) => entry.oobCode);
}

before(async () => {
  await fetch(`${EMULATOR}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
  await createUserWithEmailAndPassword(auth, KNOWN, 'old-password-1');
  await signOut(auth);
});

test('a real reset email is issued for a known account, and the same reply is given for an unknown one', async () => {
  const known = await R.requestPasswordReset(compat, KNOWN);
  const unknown = await R.requestPasswordReset(compat, 'nobody@goroutex.test');
  assert.equal(known.ok, true);
  assert.equal(known.message, unknown.message, 'no account enumeration');
  assert.equal(known.message, R.RESET_SENT_MESSAGE);
  assert.equal((await resetCodesFor(KNOWN)).length, 1, 'the known account received a reset link');
  assert.equal((await resetCodesFor('nobody@goroutex.test')).length, 0, 'nothing was sent for the unknown address');
});

test('the link opens for that account; the new password signs in and the old one fails', async () => {
  const [code] = await resetCodesFor(KNOWN);
  const link = await R.verifyResetLink(compat, code);
  assert.equal(link.ok, true);
  assert.equal(link.email, KNOWN);
  assert.equal((await R.confirmNewPassword(compat, code, 'new-password-2', 'different-2')).state, 'validation');
  assert.equal((await R.confirmNewPassword(compat, code, 'new-password-2', 'new-password-2')).ok, true);
  const session = await signInWithEmailAndPassword(auth, KNOWN, 'new-password-2');
  assert.equal(session.user.email, KNOWN);
  await signOut(auth);
  await assert.rejects(() => signInWithEmailAndPassword(auth, KNOWN, 'old-password-1'));
});

test('a used link and a made-up link get a clear invalid state', async () => {
  const [usedCode] = await resetCodesFor(KNOWN);
  const used = await R.verifyResetLink(compat, usedCode);
  assert.equal(used.ok, false);
  assert.equal(used.state, 'invalid');
  const fake = await R.verifyResetLink(compat, 'not-a-real-code');
  assert.equal(fake.ok, false);
  assert.equal(fake.state, 'invalid');
});

test('an invalid address is rejected before contacting Firebase', async () => {
  const result = await R.requestPasswordReset(compat, 'not-an-email');
  assert.equal(result.ok, false);
  assert.equal(result.code, 'validation');
});
