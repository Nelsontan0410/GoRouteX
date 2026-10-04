import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const context = vm.createContext({ console: { warn() {}, error() {} } });
vm.runInContext(readFileSync(new URL('../auth-recovery.js', import.meta.url), 'utf8'), context);
const R = context.GoRouteXAuthRecovery;
const fail = (code) => Object.assign(new Error(code), { code });
const plain = (v) => JSON.parse(JSON.stringify(v));

test('the success copy is the non-enumerating message from the plan', () => {
  assert.equal(R.RESET_SENT_MESSAGE, 'If an account exists for this email, a password reset link has been sent. Please check your inbox and spam folder.');
});

test('known and unknown addresses get the same response', async () => {
  const known = await R.requestPasswordReset({ sendPasswordResetEmail: async () => {} }, 'a@b.co');
  const unknown = await R.requestPasswordReset({ sendPasswordResetEmail: async () => { throw fail('auth/user-not-found'); } }, 'x@b.co');
  assert.deepEqual(plain(known), plain(unknown));
  assert.equal(known.ok, true);
});

test('real failures are reported honestly, never as success', async () => {
  for (const [code, pattern] of [['auth/network-request-failed', /Network error/], ['auth/too-many-requests', /Too many/], ['auth/operation-not-allowed', /not enabled/], ['auth/internal-error', /could not send/]]) {
    const result = await R.requestPasswordReset({ sendPasswordResetEmail: async () => { throw fail(code); } }, 'a@b.co');
    assert.equal(result.ok, false, code);
    assert.match(result.message, pattern);
    assert.equal(result.code, code);
  }
});

test('the address is validated before any request', async () => {
  let calls = 0;
  const auth = { sendPasswordResetEmail: async () => { calls++; } };
  assert.equal((await R.requestPasswordReset(auth, '')).ok, false);
  assert.equal((await R.requestPasswordReset(auth, 'not-an-email')).ok, false);
  assert.equal(calls, 0);
});

test('a rejected continue URL does not stop the reset email', async () => {
  const calls = [];
  const auth = { async sendPasswordResetEmail(email, settings) { calls.push(settings); if (settings) throw fail('auth/unauthorized-continue-uri'); } };
  const result = await R.requestPasswordReset(auth, 'a@b.co', { continueUrl: 'https://goroutex.netlify.app/login.html?reset=done' });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[1], undefined, 'retried without the continue URL');
});

test('reset links: expired, used/invalid and missing codes get clear states', async () => {
  assert.equal((await R.verifyResetLink({ verifyPasswordResetCode: async () => { throw fail('auth/expired-action-code'); } }, 'c')).state, 'expired');
  assert.equal((await R.verifyResetLink({ verifyPasswordResetCode: async () => { throw fail('auth/invalid-action-code'); } }, 'c')).state, 'invalid');
  assert.equal((await R.verifyResetLink({}, '')).state, 'invalid');
  const ok = await R.verifyResetLink({ verifyPasswordResetCode: async () => 'a@b.co' }, 'c');
  assert.equal(ok.ok, true);
  assert.equal(ok.email, 'a@b.co');
});

test('new password must be confirmed and long enough before it is sent', async () => {
  let sent = 0;
  const auth = { confirmPasswordReset: async () => { sent++; } };
  assert.match((await R.confirmNewPassword(auth, 'c', 'abc', 'abc')).message, /at least 6/);
  assert.match((await R.confirmNewPassword(auth, 'c', 'abcdefg', 'abcdefh')).message, /do not match/);
  assert.equal(sent, 0);
  assert.equal((await R.confirmNewPassword(auth, 'c', 'abcdefg', 'abcdefg')).ok, true);
});

test('login page offers Forgot password? with a dedicated reset form wired to the shared module', () => {
  const login = readFileSync(new URL('../login.html', import.meta.url), 'utf8');
  assert.match(login, /id="forgotPasswordBtn"[^>]*>Forgot password\?</);
  assert.match(login, /<form id="resetForm"[^>]*>[\s\S]*?id="resetEmail"[\s\S]*?id="resetBtn"[^>]*>Send reset link<[\s\S]*?Back to Sign In/);
  assert.match(login, /GoRouteXAuthRecovery\.requestPasswordReset\(firebaseAuthInstance, email/);
  assert.match(login, /showMessage\(result\.message, !result\.ok\)/);
  assert.doesNotMatch(login, /No account found with this email/);
});

test('the branded action page validates the link, confirms the password and links back to Sign In', () => {
  const page = readFileSync(new URL('../auth-action.html', import.meta.url), 'utf8');
  assert.match(page, /<title>Reset password \| GoRouteX<\/title>/);
  assert.match(page, /recovery\.verifyResetLink\(auth, code\)/);
  assert.match(page, /recovery\.confirmNewPassword\(auth, code, \$\('newPassword'\)\.value, \$\('confirmNewPassword'\)\.value\)/);
  assert.match(page, /<h1>Password updated<\/h1>[\s\S]*?href="login\.html\?reset=done">Back to Sign In</);
  assert.match(page, /href="login\.html\?mode=reset">Request a new link</);
});

test('Google sign-in branding is staged behind a switch with the proxy in place', () => {
  const config = readFileSync(new URL('../firebase-config.js', import.meta.url), 'utf8');
  const redirects = readFileSync(new URL('../_redirects', import.meta.url), 'utf8');
  assert.match(redirects, /^\/__\/auth\/\* https:\/\/delivery-app-cd18e\.firebaseapp\.com\/__\/auth\/:splat 200$/m);
  assert.match(redirects, /^\/__\/firebase\/\* https:\/\/delivery-app-cd18e\.firebaseapp\.com\/__\/firebase\/:splat 200$/m);
  assert.match(config, /const GOROUTEX_AUTH_DOMAIN_ENABLED = false;/, 'off until the OAuth redirect URI is registered');
  assert.match(config, /authDomain: resolveAuthDomain\(\),/);
  const resolve = config.slice(config.indexOf('const FIREBASE_DEFAULT_AUTH_DOMAIN'), config.indexOf('const firebaseConfig'));
  const run = (hostname, flag) => vm.runInNewContext(`${resolve}; resolveAuthDomain()`, { window: { location: { hostname }, localStorage: { getItem: () => flag } } });
  assert.equal(run('goroutex.netlify.app', null), 'delivery-app-cd18e.firebaseapp.com');
  assert.equal(run('goroutex.netlify.app', 'on'), 'goroutex.netlify.app', 'staged in one browser');
  assert.equal(run('deploy-preview-1--goroutex.netlify.app', 'on'), 'delivery-app-cd18e.firebaseapp.com', 'previews keep the default');
});

test('sign-in errors do not reveal whether an email has an account', () => {
  const login = readFileSync(new URL('../login.html', import.meta.url), 'utf8');
  assert.match(login, /case 'auth\/user-not-found':\s*case 'auth\/wrong-password':\s*case 'auth\/invalid-credential':\s*case 'auth\/invalid-login-credentials':\s*errorMessage = 'Incorrect email or password\.';/);
  assert.doesNotMatch(login, /'Incorrect password\.'/);
});
