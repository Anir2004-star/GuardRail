import { z } from "zod";

function hasNoControlCharacters(value: string): boolean {
  return Array.from(value).every((character) => {
    const code = character.charCodeAt(0);
    return code > 0x1f && code !== 0x7f;
  });
}

function requiredName(label: string) {
  return z.string({ error: `Enter your ${label}.` })
    .trim()
    .min(1, `Enter your ${label}.`)
    .max(60, `Use no more than 60 characters for your ${label}.`)
    .refine(hasNoControlCharacters, "Names must not contain control characters.");
}

export const emailSchema = z.string({ error: "Enter a valid email address." })
  .trim()
  .toLowerCase()
  .max(254, "Use no more than 254 characters for your email address.")
  .pipe(z.email({ error: "Enter a valid email address." }));

// Passwords are deliberately never trimmed, lowercased or Unicode-normalized.
export const registrationPasswordSchema = z.string({ error: "Enter a password." })
  .superRefine((password, context) => {
    const reject = (message: string) => context.addIssue({ code: "custom", message });
    if (Array.from(password).length < 15) reject("Use at least 15 characters.");
    if (Buffer.byteLength(password, "utf8") > 72) reject("Use no more than 72 UTF-8 bytes.");
    if (!/[A-Z]/.test(password)) reject("Include at least one uppercase letter.");
    if (!/[a-z]/.test(password)) reject("Include at least one lowercase letter.");
    if (!/[0-9]/.test(password)) reject("Include at least one number.");
    if (!/[^\p{L}\p{N}\s]/u.test(password)) reject("Include at least one special character, such as ! or @.");
  });

export const registrationSchema = z.strictObject({
  firstName: requiredName("first name"),
  middleName: z.string({ error: "Middle name must be text." })
    .trim()
    .max(60, "Use no more than 60 characters for your middle name.")
    .refine(hasNoControlCharacters, "Names must not contain control characters.")
    .optional(),
  lastName: requiredName("last name"),
  email: emailSchema,
  password: registrationPasswordSchema,
});

export type RegistrationInput = z.infer<typeof registrationSchema>;
export type ValidationFields = Record<string, string[]>;

// Only sanitized messages and known field names are retained, never input values
// or a raw ZodError (which may retain the input or unknown property names).
export class InputValidationError extends Error {
  constructor(public readonly fields: ValidationFields) {
    super("Check the submitted fields.");
    this.name = "InputValidationError";
  }
}

export function parseRegistrationInput(input: unknown): RegistrationInput {
  const result = registrationSchema.safeParse(input);
  if (result.success) return result.data;

  const fields: ValidationFields = {};
  const allowedFields = new Set(["firstName", "middleName", "lastName", "email", "password"]);
  for (const issue of result.error.issues) {
    const field = issue.path[0];
    const key = typeof field === "string" && allowedFields.has(field) ? field : "body";
    const message = key === "body"
      ? "Send a JSON object containing only firstName, optional middleName, lastName, email, and password."
      : issue.message;
    const messages = fields[key] ?? (fields[key] = []);
    if (!messages.includes(message)) messages.push(message);
  }
  throw new InputValidationError(fields);
}
