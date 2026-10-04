// Loaded only by the isolated browser-test runner; production has no test transport.
export function installGoogleAuthTestTransport(env) {
  if (!env.GOOGLE_AUTH_TEST_ORIGIN) throw new Error('Missing Google test fixture origin');
  const fixture = new URL(env.GOOGLE_AUTH_TEST_ORIGIN), database = new URL(env.DATABASE_URL), app = new URL(env.BETTER_AUTH_URL);
  if (fixture.protocol !== 'http:' || fixture.hostname !== '127.0.0.1' || fixture.pathname !== '/' || fixture.search || fixture.hash || fixture.username || fixture.password || !['localhost','127.0.0.1','[::1]'].includes(database.hostname) || !/^\/execution_test_[a-z0-9]+$/.test(database.pathname) || app.hostname !== '127.0.0.1' || env.GOOGLE_AUTH_CLIENT_ID !== 'google-auth-fixture' || env.GOOGLE_AUTH_CLIENT_SECRET !== 'google-auth-fixture-secret') throw new Error('Google fake transport requires isolated loopback test configuration');
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const destinations = new Map([
      ['https://oauth2.googleapis.com/token', '/token'],
      ['https://www.googleapis.com/oauth2/v3/certs', '/certs'],
    ]);
    const destination = destinations.get(url.toString());
    if (destination) return original(input instanceof Request ? new Request(new URL(destination, fixture), input) : new URL(destination, fixture), init);
    // Fail closed if sign-in unexpectedly contacts any Calendar or other Google API.
    if (url.hostname.endsWith('googleapis.com') || url.hostname === 'accounts.google.com') throw new Error('Unexpected Google endpoint in isolated sign-in test');
    return original(input, init);
  };
  return () => { globalThis.fetch = original; };
}
if (process.env.GOOGLE_AUTH_TEST_ORIGIN) installGoogleAuthTestTransport(process.env);
