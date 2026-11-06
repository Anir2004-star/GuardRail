import { z } from "zod";

export const userSchema = z.object({
  id: z.string().uuid(),
  name: z.string().nullable(),
  firstName: z.string().nullable(),
  middleName: z.string().nullable(),
  lastName: z.string().nullable(),
  email: z.string().email(),
  createdAt: z.string().datetime({ offset: true }),
});
export const loginResponseSchema = z.object({
  user: userSchema,
  accessToken: z.string().min(1).max(4096),
  tokenType: z.literal("Bearer"),
  expiresIn: z.number().int().min(60).max(3600),
});

export type LoginUser = z.infer<typeof userSchema>;
export type LoginSession = z.infer<typeof loginResponseSchema> & { expiresAt: number };
export type LoginInput = { email: string; password: string };
export type LoginResult =
  | { ok: true; session: LoginSession }
  | { ok: false; message: string; fields?: Partial<Record<keyof LoginInput, string>> };

export async function loginAccount(input: LoginInput): Promise<LoginResult> {
  const apiUrl = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/$/, "");
  const startedAt = Date.now();
  try {
    const response = await fetch(`${apiUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({ email: input.email.trim().toLowerCase(), password: input.password }),
    });
    if (response.status === 200) {
      const parsed = loginResponseSchema.safeParse(await response.json().catch(() => undefined));
      if (!parsed.success) return { ok: false, message: "The sign-in service returned an unexpected response. Please try again later." };
      return { ok: true, session: { ...parsed.data, expiresAt: startedAt + parsed.data.expiresIn * 1000 } };
    }
    // Use local messages, never raw server errors or submitted credentials.
    if (response.status === 400) {
      return { ok: false, message: "Check your email and password and try again." };
    }
    if (response.status === 401) return { ok: false, message: "Email or password is incorrect." };
    if (response.status === 403) return { ok: false, message: "Sign-in is unavailable from this website address." };
    if (response.status === 429) return { ok: false, message: "Too many login attempts. Please try again later." };
    return { ok: false, message: "We couldn't sign you in. Please try again later." };
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      return { ok: false, message: "The sign-in request timed out. Check your connection before retrying." };
    }
    return { ok: false, message: "Could not reach the sign-in service. Check your connection and try again." };
  }
}
