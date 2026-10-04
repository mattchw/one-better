import { expect, test, type Page, type APIResponse } from "@playwright/test";
// The suite deliberately uses real login and the production rate limiter. A
// crowded run waits for its advertised window instead of bypassing authentication.
export async function signInThroughUI(page: Page) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = page.waitForResponse(r => r.url().endsWith("/api/auth/sign-in/email") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    const result = await response;
    if (result.status() !== 429) { expect(result.status()).toBe(200); return; }
    const retry = Number(result.headers()["retry-after"] ?? 60);
    const waitMilliseconds=(Math.max(1, retry)+1)*1000;
    test.setTimeout(test.info().timeout+waitMilliseconds);
    await page.waitForTimeout(waitMilliseconds);
  }
  throw new Error("Login rate limit did not clear after its advertised window.");
}
// In-process fixture sessions use the same enabled authentication limiter.
// Expanded suites can hit its shared window; wait rather than exempting tests.
export async function fixtureSignIn(login:()=>Promise<Response>) {
 let response=await login();
 if(response.status===429){const retry=Number(response.headers.get('retry-after')??60),wait=(Math.max(1,retry)+1)*1000;test.setTimeout(test.info().timeout+wait);await new Promise(resolve=>setTimeout(resolve,wait));response=await login();}
 expect(response.status).toBe(200);
 return response;
}
export async function fixtureAPISignIn(login:()=>Promise<APIResponse>){
 let response=await login();
 if(response.status()===429){const retry=Number(response.headers()['retry-after']??60),wait=(Math.max(1,retry)+1)*1000;test.setTimeout(test.info().timeout+wait);await new Promise(resolve=>setTimeout(resolve,wait));response=await login();}
 expect(response.status()).toBe(200);return response;
}
