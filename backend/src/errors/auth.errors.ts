export class InvalidCredentialsError extends Error {
  constructor() {
    super("Email or password is incorrect");
    this.name = "InvalidCredentialsError";
  }
}

export class InvalidAccessTokenError extends Error {
  constructor() {
    super("A valid access token is required");
    this.name = "InvalidAccessTokenError";
  }
}

export class InvalidRefreshTokenError extends Error {
  constructor() {
    super("Refresh session is invalid");
    this.name = "InvalidRefreshTokenError";
  }
}

export class InvalidPasswordResetTokenError extends Error {
  constructor() {
    super("Reset link is invalid or expired. Request a new link.");
    this.name = "InvalidPasswordResetTokenError";
  }
}

export class PasswordResetUnavailableError extends Error {
  constructor() {
    super("Password recovery is temporarily unavailable. Please try again later.");
    this.name = "PasswordResetUnavailableError";
  }
}
