import test from 'node:test';
import assert from 'node:assert/strict';
import { popupLoginAction } from '../auth-utils.js';

test('cancelled popup is silent and does not redirect', () => {
  assert.equal(popupLoginAction('auth/popup-closed-by-user'), 'cancel');
  assert.equal(popupLoginAction('auth/cancelled-popup-request'), 'cancel');
});

test('only blocked or unsupported popup uses redirect fallback', () => {
  assert.equal(popupLoginAction('auth/popup-blocked'), 'redirect');
  assert.equal(popupLoginAction('auth/operation-not-supported-in-this-environment'), 'redirect');
  assert.equal(popupLoginAction('auth/network-request-failed'), 'error');
});
