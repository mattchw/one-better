import { z } from "zod";
const configSchema = z.object({
  DATABASE_URL: z.url().refine((url) => {
    try { return ["postgres:", "postgresql:"].includes(new URL(url).protocol); } catch { return false; }
  }),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url().refine((url) => {
    try {
      const u = new URL(url);
      return u.protocol === "https:" || (u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname));
    } catch { return false; }
  }),
});
export function readConfiguration(env: Record<string, string | undefined>) {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) throw new Error("Configure DATABASE_URL, BETTER_AUTH_SECRET (32+ characters), and BETTER_AUTH_URL. See .env.example.");
  return parsed.data;
}
