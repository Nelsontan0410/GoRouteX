import { randomUUID, createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';

export const DRIVER_LIMITS = Object.freeze({ basic: 1, goplan: 3, proplan: 10 });
export const DRIVER_PIN_PATTERN = /^[0-9]{8}$/;
export const DRIVER_USERNAME_PATTERN = /^[a-z0-9_.]{3,20}$/;
export const DRIVER_BCRYPT_ROUNDS = 12;
export const LOGIN_FAILURE_LIMIT = 5;
export const LOGIN_LOCK_MS = 15 * 60 * 1000;

export function normalizeDriverUsername(value) {
  const username = String(value ?? '').trim().toLowerCase();
  if (!DRIVER_USERNAME_PATTERN.test(username)) throw new DriverError('Invalid username. Use 3–20 letters, numbers, underscores or periods.', 400, 'INVALID_USERNAME');
  return username;
}
export function validateDriverPin(pin, confirmation = pin) {
  if (typeof pin !== 'string' || !DRIVER_PIN_PATTERN.test(pin)) throw new DriverError('Driver PIN must contain exactly 8 digits.', 400, 'INVALID_PIN');
  if (pin !== confirmation) throw new DriverError('Driver PIN confirmation does not match.', 400, 'PIN_MISMATCH');
  return pin;
}
export function normalizeDriverPlan(profile = {}) {
  const normalize = value => {
    const key = String(value || '').trim().toLowerCase();
    if (['proplan', 'pro-plan', 'pro plan', 'pro_plan', 'pro', 'professional', 'professional plan', 'team', 'business', 'enterprise'].includes(key)) return 'proplan';
    if (['goplan', 'go-plan', 'go plan', 'go', 'basic-legacy', 'legacy-basic'].includes(key)) return 'goplan';
    if (['basic', 'free', 'starter', 'trial', 'free-trial', 'free trial'].includes(key)) return 'basic';
    return '';
  };
  const product = [profile.productPlanKey, profile.productPlan, profile.permanentPlanLabel].map(normalize).filter(Boolean);
  const legacyRaw = String(profile.planKey || profile.planName || '').trim().toLowerCase();
  const legacy = [profile.planKey, profile.planName].map(normalize).filter(Boolean);
  const candidates = [...product, ...legacy];
  if (candidates.includes('proplan')) return 'proplan';
  if (candidates.includes('goplan')) return 'goplan';
  if (product.includes('basic') || legacyRaw === 'trial') return 'basic';
  // Legacy planKey=basic was the paid cloud tier before productPlanKey existed.
  if (legacyRaw === 'basic' || (!legacyRaw && String(profile.planStatus || '').toLowerCase() === 'active')) return 'goplan';
  return normalize(legacyRaw || profile.planStatus) || 'basic';
}
export function driverEntitlement(profile = {}) {
  const plan = normalizeDriverPlan(profile);
  const blockedStatuses = ['expired', 'cancelled', 'canceled'];
  const blocked = [profile.planStatus, profile.billingStatus, profile.paymentStatus].some(status => blockedStatuses.includes(String(status || '').trim().toLowerCase()));
  const expiryValue = profile.planExpiresAt || profile.subscriptionExpiresAt || profile.accessExpiresAt || profile.trialEndsAt;
  const expiry = expiryValue?.toDate?.() || (expiryValue ? new Date(expiryValue) : null);
  const effective = !profile.permanentPlan && (blocked || (expiry && Number.isFinite(expiry.getTime()) && expiry < new Date())) ? 'basic' : plan;
  return { plan: effective, maxActiveDrivers: DRIVER_LIMITS[effective] };
}
export function newDriverUid() { return `drv_${randomUUID().replaceAll('-', '')}`; }
export function digest(value) { return createHash('sha256').update(String(value)).digest('hex'); }
export async function hashDriverPin(pin) { return bcrypt.hash(validateDriverPin(pin), DRIVER_BCRYPT_ROUNDS); }
export async function verifyDriverPin(pin, hash) { return typeof pin === 'string' && DRIVER_PIN_PATTERN.test(pin) && typeof hash === 'string' && await bcrypt.compare(pin, hash); }
export class DriverError extends Error { constructor(message, status = 400, code = 'DRIVER_ERROR') { super(message); this.status = status; this.code = code; } }
const OWNER_ROLES = new Set(['admin', 'owner', 'owner/admin']);
const WORKSPACE_ROLES = new Set([...OWNER_ROLES, 'manager', 'dispatcher']);

// The historical Owner workspace is users/{authUid}. Preserve a differing
// tenantId on a proven self-owned legacy Owner; never use it as the Owner path.
export function resolveTrustedWorkspaceIdentity(decoded, profile) {
  const uid = decoded?.uid;
  if (!uid) throw new DriverError('Sign in required.', 401, 'UNAUTHENTICATED');
  if (!profile || typeof profile !== 'object') throw new DriverError('Workspace profile unavailable.', 403, 'WORKSPACE_INVALID');
  const role = String(profile.role || '').trim().toLowerCase();
  if (decoded.role === 'driver' || uid.startsWith('drv_') || profile.driverId || profile.authMethod === 'pin' || profile.sessionVersion != null || !WORKSPACE_ROLES.has(role)) {
    throw new DriverError('Workspace account required.', 403, 'ROLE_INVALID');
  }
  if (profile.active === false) throw new DriverError('Workspace account is inactive.', 403, 'ACCOUNT_INACTIVE');
  if (profile.uid != null && profile.uid !== uid) throw new DriverError('Workspace membership is missing or invalid.', 403, 'WORKSPACE_INVALID');
  if (profile.tenantId != null && typeof profile.tenantId !== 'string') throw new DriverError('Workspace membership is missing or invalid.', 403, 'WORKSPACE_INVALID');
  const tenantId = String(profile.tenantId || '').trim();
  const canonical = tenantId === uid;
  const otherMembership = ['workspaceId', 'ownerUid', 'workspace', 'membership', 'memberships']
    .some(field => profile[field] != null && profile[field] !== '');
  const legacyOwner = OWNER_ROLES.has(role) && !otherMembership && (!tenantId || profile.uid === uid);
  if (!canonical && !legacyOwner) throw new DriverError('Workspace membership is missing or invalid.', 403, 'WORKSPACE_INVALID');
  return Object.freeze({ uid, workspaceId: uid, ownerUid: uid, role, legacyOwnerCompatibility: !canonical });
}
export function requireOwner(decoded, profile) {
  return resolveTrustedWorkspaceIdentity(decoded, profile).ownerUid;
}
export function requireBillingOwner(decoded, profile) {
  let identity;
  try { identity = resolveTrustedWorkspaceIdentity(decoded, profile); }
  catch (error) {
    if (error instanceof DriverError && error.status === 403) throw new DriverError('Billing requires a workspace owner or admin.', 403, error.code);
    throw error;
  }
  if (!OWNER_ROLES.has(identity.role)) throw new DriverError('Billing requires a workspace owner or admin.', 403, 'ROLE_INVALID');
  return identity.ownerUid;
}
export function publicDriver(record) {
  return { uid: record.authUid, id: record.id, name: record.displayName, username: record.username, status: record.status, active: record.status === 'ACTIVE', createdAt: record.createdAt, updatedAt: record.updatedAt, lastLoginAt: record.lastLoginAt || null };
}
