// Company rule for Completed & Next (Settings › Driver App): recipient name, note and photo are all required, or none is.
// The last known rule is kept on the phone, so a weak connection does not change what the driver is asked for.
const cacheKey = uid => `grxPodRule:${uid}`;
export function cachedPodRule(uid) { try { return localStorage.getItem(cacheKey(uid)) === 'all'; } catch { return false; } }
export async function loadPodRule(user) {
  const remember = value => { try { localStorage.setItem(cacheKey(user.uid), value ? 'all' : 'none'); } catch { /* Cache is optional. */ } return value; };
  if (String(user.uid).startsWith('drv_')) {
    const token = await firebase.auth().currentUser.getIdToken();
    const response = await fetch('/.netlify/functions/dispatch?action=driver-settings', { headers: { Authorization: `Bearer ${token}` } });
    const result = await response.json();
    if (!response.ok || !result.success) throw Error(result.error || 'Company rules are unavailable.');
    return remember(result.podRequireAll === true);
  }
  const doc = await firebase.firestore().collection('users').doc(user.uid).collection('settings').doc('operationsV1').get();
  return remember(doc.exists && doc.data()?.driverApp?.pod?.requireAll === true);
}
