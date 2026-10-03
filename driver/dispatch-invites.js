const panel = document.getElementById('driverInvites');
const list = document.getElementById('driverInviteList');
async function request(action, ownerUid = '') {
  const user = window.FirebaseApp?.auth?.getCurrentUser?.();
  if (!user) return { invitations: [] };
  const token = await user.getIdToken();
  const response = await fetch(`/.netlify/functions/dispatch${action === 'invitations' ? '?action=invitations' : ''}`, { method: action === 'invitations' ? 'GET' : 'POST', headers: { Authorization: `Bearer ${token}`, ...(action === 'accept' ? { 'Content-Type': 'application/json' } : {}) }, body: action === 'accept' ? JSON.stringify({ action, ownerUid }) : undefined });
  const result = await response.json();
  if (!response.ok || !result.success) throw Error(result.error || 'Invitation request failed.');
  return result;
}
async function render() {
  if (!panel || !list) return;
  if (window.FirebaseApp?.auth?.getCurrentUser?.()?.uid?.startsWith('drv_')) { panel.hidden = true; return; }
  try {
    const result = await request('invitations');
    list.replaceChildren();
    panel.hidden = !result.invitations?.length;
    for (const invitation of result.invitations || []) {
      const item = document.createElement('div');
      const label = document.createElement('span');
      label.textContent = `${invitation.ownerName} invited you to receive dispatched routes.`;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'driver-primary';
      button.textContent = 'Accept workspace';
      button.addEventListener('click', async () => { button.disabled = true; try { await request('accept', invitation.ownerUid); await render(); } catch (error) { label.textContent = error.message; button.disabled = false; } });
      item.append(label, button);
      list.append(item);
    }
  } catch { panel.hidden = true; }
}
window.FirebaseApp?.auth?.onAuthStateChange?.(user => { if (user) render(); else if (panel) panel.hidden = true; });
window.addEventListener('goroutex:tracking-ready', render);
