export function popupLoginAction(errorCode) {
  if (['auth/popup-closed-by-user', 'auth/cancelled-popup-request'].includes(errorCode)) return 'cancel';
  if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment'].includes(errorCode)) return 'redirect';
  return 'error';
}
