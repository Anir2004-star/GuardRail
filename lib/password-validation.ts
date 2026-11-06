export function validateAccountPassword(value: string): true | string {
  if (Array.from(value).length < 15) return "Use at least 15 characters.";
  if (new TextEncoder().encode(value).length > 72) return "Use no more than 72 UTF-8 bytes.";
  if (!/[A-Z]/.test(value)) return "Include at least one uppercase letter.";
  if (!/[a-z]/.test(value)) return "Include at least one lowercase letter.";
  if (!/[0-9]/.test(value)) return "Include at least one number.";
  if (!/[^\p{L}\p{N}\s]/u.test(value)) return "Include at least one special character, such as ! or @.";
  return true;
}
