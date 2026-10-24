// The message for a check-out / check-in / cancel result of a shared tool
// set (stores/toolSetLibrary.js), shared by Manage Tool Sets and the Tool
// Chest panel. `tt(key, params)` translates toolSetSharing.<key>.
// kind: 'checkOut' | 'checkIn' | 'cancel'.
export function shareMessage(tt, name, result, kind) {
  if (!result) return null;
  if (result.ok || (kind === 'cancel' && result.status && result.status !== 'error')) {
    if (result.local || kind === 'cancel') return null;
    return { text: tt(kind === 'checkIn' ? 'checkedIn' : 'checkedOut', { name }) };
  }
  switch (result.reason) {
    case 'locked': return { text: tt('locked', { name, user: result.lockedBy || '?' }), error: true };
    case 'stale': return { text: tt('staleLock', { user: result.lockedBy || '?' }), error: true };
    case 'offline': return { text: tt('offline'), error: true };
    case 'conflict': return { text: tt('conflict'), error: true };
    case 'lockLost': return { text: tt('lockLost', { name }), error: true };
    default: return { text: result.error || tt('offline'), error: true };
  }
}
