export type RegistrationFields = {
  firstName: string;
  middleName: string;
  lastName: string;
  email: string;
  password: string;
};

export type RegistrationResult =
  | { ok: true }
  | { ok: false; message: string; fields?: Partial<Record<keyof RegistrationFields, string>> };

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export async function registerAccount(input: RegistrationFields): Promise<RegistrationResult> {
  const apiUrl = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/$/, "");
  try {
    const response = await fetch(`${apiUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Registration creates an account, not a login session.
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({
        firstName: input.firstName.trim(),
        middleName: input.middleName.trim(),
        lastName: input.lastName.trim(),
        email: input.email.trim().toLowerCase(),
        password: input.password,
      }),
    });
    const body: unknown = await response.json().catch(() => undefined);
    if (response.status === 201) {
      const user = record(record(body)?.user);
      return typeof user?.id === "string" && user.id.length > 0
        ? { ok: true }
        : { ok: false, message: "The signup service returned an unexpected response. Please try again later." };
    }
    if (response.status === 409) {
      return { ok: false, message: "An account with this email already exists.", fields: { email: "An account with this email already exists." } };
    }
    if (response.status === 400) {
      const submittedFields = record(record(record(body)?.error)?.fields);
      const fields: Partial<Record<keyof RegistrationFields, string>> = {};
      for (const field of ["firstName", "middleName", "lastName", "email", "password"] as const) {
        const messages = submittedFields?.[field];
        if (Array.isArray(messages) && typeof messages[0] === "string") fields[field] = messages[0];
      }
      return { ok: false, message: "Check your signup details and try again.", fields };
    }
    if (response.status === 429) return { ok: false, message: "Too many signup attempts. Please try again later." };
    if (response.status === 403) return { ok: false, message: "Signup is unavailable from this website address." };
    return { ok: false, message: "We couldn't create your account. Please try again later." };
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      return { ok: false, message: "The signup request timed out. Check your connection before retrying." };
    }
    return { ok: false, message: "Could not reach the signup service. Check your connection and try again." };
  }
}
