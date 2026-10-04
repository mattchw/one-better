const messages: Record<string, string> = {
  access_denied: "Google sign-in was cancelled. You can try again or use your password.",
  signup_disabled: "Google account creation could not be completed. Please try again.",
  user_not_registered: "Google sign-in could not find your account. Please try again.",
  account_not_linked: "Sign in with your password, then link Google under Settings → Account.",
  email_does_not_match: "This Google account’s email does not match your One Better account. Choose the matching Google account.",
  email_not_verified: "Google could not verify this account’s email. Please use your password.",
  account_already_linked_to_different_user: "This Google account is already linked to another One Better account.",
  provider_not_configured: "Google sign-in is not configured yet. Please use your password.",
};
export function safeGoogleAuthError(code: unknown): string {
  return typeof code === "string" && Object.hasOwn(messages, code) ? code : "oauth_callback_failed";
}
export function googleAuthMessage(code: unknown): string {
  return messages[safeGoogleAuthError(code)] ?? "Google sign-in could not be completed. Please try again or use your password.";
}
