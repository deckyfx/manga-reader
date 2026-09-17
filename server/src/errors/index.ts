export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: number = 500,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class NotFoundError extends AppError {
  constructor(resource = "Resource") {
    super(`${resource} not found`, 404);
  }
  static throw(resource?: string): never {
    throw new NotFoundError(resource);
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400);
  }
  static throw(message: string): never {
    throw new ValidationError(message);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(service: string) {
    super(`${service} not ready`, 503);
  }
  static throw(service: string): never {
    throw new ServiceUnavailableError(service);
  }
}

export class NotImplementedError extends AppError {
  constructor(feature: string) {
    super(`${feature} not yet implemented`, 501);
  }
  static throw(feature: string): never {
    throw new NotImplementedError(feature);
  }
}
