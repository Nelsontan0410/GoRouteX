/**
 * Password recovery for GoRouteX: reset request (login page) and the custom email action handler
 * (auth-action.html). Works with a Firebase Auth instance exposing the compat methods
 * sendPasswordResetEmail(email, actionCodeSettings), verifyPasswordResetCode(code),
 * confirmPasswordReset(code, password) and applyActionCode(code).
 *
 * The reset request never reveals whether an account exists (same message for unknown addresses),
 * while real failures (network, rate limit, configuration) are reported honestly and logged with their code.
 */
(function (root) {
  const RESET_SENT_MESSAGE = 'If an account exists for this email, a password reset link has been sent. Please check your inbox and spam folder.';
  const MIN_PASSWORD_LENGTH = 6; // Firebase Auth minimum
  const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const CONTINUE_URL_ERRORS = new Set(['auth/unauthorized-continue-uri', 'auth/invalid-continue-uri', 'auth/missing-continue-uri']);

  function validateEmail(value) {
    const email = String(value || '').trim();
    if (!email) return 'Enter the email address you use to sign in.';
    if (!EMAIL_PATTERN.test(email)) return 'Enter a valid email address.';
    return null;
  }

  function requestErrorMessage(code) {
    switch (code) {
      case 'auth/invalid-email': return 'Enter a valid email address.';
      case 'auth/too-many-requests': return 'Too many reset requests. Please wait a few minutes and try again.';
      case 'auth/network-request-failed': return 'Network error. Check your connection and try again.';
      case 'auth/operation-not-allowed': return 'Password sign-in is not enabled for GoRouteX right now. Please contact support.';
      default: return 'We could not send the reset email right now. Please try again in a moment.';
    }
  }

  /** Returns { ok: true, message } or { ok: false, message, code }. */
  async function requestPasswordReset(auth, rawEmail, { continueUrl } = {}) {
    const invalid = validateEmail(rawEmail);
    if (invalid) return { ok: false, message: invalid, code: 'validation' };
    const email = String(rawEmail).trim();
    const settings = continueUrl ? { url: continueUrl, handleCodeInApp: false } : undefined;
    try {
      try {
        await auth.sendPasswordResetEmail(email, settings);
      } catch (error) {
        // A continue URL the project does not allow must not stop the reset email itself.
        if (!settings || !CONTINUE_URL_ERRORS.has(error?.code)) throw error;
        console.warn('Password reset continue URL rejected; sending without it.', error.code);
        await auth.sendPasswordResetEmail(email);
      }
      return { ok: true, message: RESET_SENT_MESSAGE };
    } catch (error) {
      // Unknown accounts get the same response as known ones (no account enumeration).
      if (error?.code === 'auth/user-not-found') return { ok: true, message: RESET_SENT_MESSAGE };
      console.error('Password reset request failed:', error?.code || error);
      return { ok: false, message: requestErrorMessage(error?.code), code: error?.code || 'unknown' };
    }
  }

  function actionErrorState(code) {
    switch (code) {
      case 'auth/expired-action-code':
        return { state: 'expired', message: 'This link has expired. Request a new password reset link.' };
      case 'auth/invalid-action-code':
        return { state: 'invalid', message: 'This link is invalid or has already been used. Request a new password reset link.' };
      case 'auth/user-disabled':
        return { state: 'disabled', message: 'This account has been disabled. Please contact support.' };
      case 'auth/user-not-found':
        return { state: 'invalid', message: 'This link is no longer valid. Request a new password reset link.' };
      case 'auth/network-request-failed':
        return { state: 'error', message: 'Network error. Check your connection and try again.' };
      default:
        return { state: 'error', message: 'We could not check this link right now. Please try again.' };
    }
  }

  /** Returns { ok: true, email } or { ok: false, state, message }. */
  async function verifyResetLink(auth, code) {
    if (!code) return { ok: false, state: 'invalid', message: 'This link is incomplete. Open the link from your email again or request a new one.' };
    try {
      const email = await auth.verifyPasswordResetCode(code);
      return { ok: true, email };
    } catch (error) {
      console.warn('Password reset link check failed:', error?.code || error);
      return { ok: false, code: error?.code, ...actionErrorState(error?.code) };
    }
  }

  function validateNewPassword(password, confirmation) {
    if (String(password || '').length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
    if (password !== confirmation) return 'The two passwords do not match.';
    return null;
  }

  /** Returns { ok: true } or { ok: false, state, message }. */
  async function confirmNewPassword(auth, code, password, confirmation) {
    const invalid = validateNewPassword(password, confirmation);
    if (invalid) return { ok: false, state: 'validation', message: invalid };
    try {
      await auth.confirmPasswordReset(code, password);
      return { ok: true };
    } catch (error) {
      console.warn('Password reset failed:', error?.code || error);
      if (error?.code === 'auth/weak-password') return { ok: false, state: 'validation', message: `Choose a stronger password (at least ${MIN_PASSWORD_LENGTH} characters).` };
      return { ok: false, code: error?.code, ...actionErrorState(error?.code) };
    }
  }

  root.GoRouteXAuthRecovery = {
    RESET_SENT_MESSAGE,
    MIN_PASSWORD_LENGTH,
    validateEmail,
    validateNewPassword,
    requestPasswordReset,
    verifyResetLink,
    confirmNewPassword,
    actionErrorState
  };
})(typeof window !== 'undefined' ? window : globalThis);
