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
