import {describe,it,expect} from 'vitest';
import {readGoogleAuthConfiguration} from '../../src/server/google-auth-config';
import {googleAuthMessage,safeGoogleAuthError} from '../../src/components/google-auth-messages';
describe('Google identity configuration and readable errors',()=>{
 it('needs its own complete credentials and never uses Calendar credentials',()=>{
  expect(readGoogleAuthConfiguration({GOOGLE_CALENDAR_CLIENT_ID:'calendar',GOOGLE_CALENDAR_CLIENT_SECRET:'secret'})).toBeNull();
  expect(readGoogleAuthConfiguration({GOOGLE_AUTH_CLIENT_ID:'google'})).toBeNull();
  expect(readGoogleAuthConfiguration({GOOGLE_AUTH_CLIENT_ID:'REPLACE_WITH_ID',GOOGLE_AUTH_CLIENT_SECRET:'secret'})).toBeNull();
  expect(readGoogleAuthConfiguration({GOOGLE_AUTH_CLIENT_ID:' google ',GOOGLE_AUTH_CLIENT_SECRET:' secret '})).toEqual({clientId:'google',clientSecret:'secret'});
 });
 it('maps signup/cancelled callbacks without displaying arbitrary provider descriptions',()=>{
  expect(googleAuthMessage('signup_disabled')).toBe('Google account creation could not be completed. Please try again.');
  expect(googleAuthMessage('access_denied')).toContain('cancelled');expect(safeGoogleAuthError('PRIVATE_PROVIDER_INTERNAL')).toBe('oauth_callback_failed');expect(googleAuthMessage('__proto__')).not.toContain('proto');
 });
});
