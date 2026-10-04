export const googleIdentityScopes = ["openid", "email", "profile"] as const;
export type GoogleAuthConfiguration = { clientId: string; clientSecret: string };

export function readGoogleAuthConfiguration(env: Record<string, string | undefined>): GoogleAuthConfiguration | null {
  const clientId = env.GOOGLE_AUTH_CLIENT_ID?.trim(), clientSecret = env.GOOGLE_AUTH_CLIENT_SECRET?.trim();
  // Never fall back to the independent Calendar connection credentials.
  if (!clientId || !clientSecret || clientId.startsWith("REPLACE_") || clientSecret.startsWith("REPLACE_")) return null;
  return { clientId, clientSecret };
}
