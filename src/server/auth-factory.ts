import { randomUUID } from "node:crypto";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { Database } from "../db/connect";
import * as schema from "../db/schema";
import { ApplicationError } from "../domain/errors";
import { errorResponse } from "./http-errors";
import { eq } from "drizzle-orm";
import { googleIdentityScopes, type GoogleAuthConfiguration } from "./google-auth-config";
import { canUnlinkGoogle } from "./sign-in-methods";
import { safeGoogleAuthError } from "../components/google-auth-messages";

export function createAuthentication(db: Database, config: { secret: string; baseURL: string; google?: GoogleAuthConfiguration | null }) {
  const auth = betterAuth({
    database: drizzleAdapter(db, { provider: "pg", schema, transaction: true }),
    secret: config.secret, baseURL: config.baseURL, trustedOrigins: [config.baseURL],
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 12 },
    socialProviders: config.google ? { google: { ...config.google, disableImplicitSignUp: false, disableSignUp: false, scope: [...googleIdentityScopes], disableDefaultScope: true, includeGrantedScopes: false, accessType: "online", prompt: "select_account", overrideUserInfoOnSignIn: false } } : {},
    account: {
      encryptOAuthTokens: true, storeAccountCookie: false,
      accountLinking: { enabled: true, allowDifferentEmails: false, allowUnlinkingAll: false, trustedProviders: [], updateUserInfoOnLink: false,
        // Existing CLI-provisioned rows initially lack emailVerified. Public
        // account creation is restricted to verified Google identities; password
        // signup stays disabled, so an unverified email cannot be pre-registered.
        requireLocalEmailVerified: false },
    },
    disabledPaths: ["/get-access-token", "/refresh-token"],
    onAPIError: { errorURL: `${new URL(config.baseURL).origin}/sign-in` },
    user: { additionalFields: { timezone: { type: "string", required: true, defaultValue: "Europe/London", input: false } },
      async validateUserInfo({ user, source }) {
        if (source.oauth?.providerId !== "google") return;
        if (user.emailVerified !== true) return { error: "email_not_verified" };
        if (typeof user.email !== "string") return { error: "user_not_registered" };
        if (source.action === "create-user") return;
        if (typeof user.id !== "string") return { error: "user_not_registered" };
        const [existing] = await db.select({ email: schema.user.email }).from(schema.user).where(eq(schema.user.id, user.id)).limit(1);
        if (!existing) return { error: "user_not_registered" };
        if (existing.email.toLowerCase() !== user.email.toLowerCase()) return { error: "email_does_not_match" };
      },
    },
    session: { expiresIn: 60 * 60 * 24 * 7, cookieCache: { enabled: false } },
    advanced: { database: { generateId: () => randomUUID() } },
    rateLimit: { enabled: true, customRules: { "/sign-in/email": { window: 60, max: 10 } } }, logger: { disabled: true },
  });
  return { ...auth, handler: async (request: Request) => {
    // The current browser flow requires a matching Origin even on first login.
    if (request.method === "POST" && request.headers.get("origin") !== new URL(config.baseURL).origin) {
      return errorResponse(new ApplicationError("FORBIDDEN", "This request origin is not allowed."));
    }
    const path = new URL(request.url).pathname;
    if (request.method === "POST" && ["/api/auth/sign-in/social", "/api/auth/link-social", "/api/auth/unlink-account"].includes(path)) {
      const body = await request.clone().json().catch(() => null);
      if (path.endsWith("/unlink-account")) {
        const current = await auth.api.getSession({ headers: request.headers });
        if (!current) return errorResponse(new ApplicationError("UNAUTHENTICATED", "Sign in to manage your sign-in methods."));
        if (!body || typeof body.accountId !== "string" || !await canUnlinkGoogle(db, current.user.id, body.accountId)) return errorResponse(new ApplicationError("FORBIDDEN", "Google cannot be unlinked. Keep a usable password sign-in method."));
      } else if (body?.provider === "google") {
        if (!config.google) return Response.json({ code: "PROVIDER_NOT_CONFIGURED", message: "Google sign-in is not configured yet. Please use your password." }, { status: 503 });
        if (body.scopes && (!Array.isArray(body.scopes) || body.scopes.some((scope: unknown) => !googleIdentityScopes.includes(scope as typeof googleIdentityScopes[number]))) || body.additionalParams && Object.keys(body.additionalParams).length) return errorResponse(new ApplicationError("FORBIDDEN", "Google login supports identity permissions only."));
      }
    }
    const response = await auth.handler(request);
    const location = response.headers.get("Location");
    if (location) {
      const target = new URL(location, config.baseURL);
      if (target.origin === new URL(config.baseURL).origin && target.searchParams.has("error")) {
        // Keep provider descriptions, tokens and unrecognised error text out of
        // browser redirects. Better Auth still owns state, PKCE and sessions.
        const safe = new URL("/sign-in", config.baseURL);
        safe.searchParams.set("error", safeGoogleAuthError(target.searchParams.get("error")));
        response.headers.set("Location", safe.toString());
      }
    }
    return response;
  } };
}
