/**
 * Base application error
 */
export class AppError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppError";
  }
}

/**
 * Validation error for invalid input
 */
export class ValidationError extends AppError {
  field?: string;

  constructor(message?: string) {
    super(message ?? "Validation error");
    this.name = "ValidationError";
  }

  static throw(message: string, field?: string): never {
    const error = new ValidationError(message);
    if (field) error.field = field;
    throw error;
  }

  static create(message: string, field?: string): ValidationError {
    const error = new ValidationError(message);
    if (field) error.field = field;
    return error;
  }
}

/**
 * Network error for HTTP failures
 */
export class NetworkError extends AppError {
  statusCode?: number;

  constructor(message?: string) {
    super(message ?? "Network error");
    this.name = "NetworkError";
  }

  static throw(message: string, statusCode: number): never {
    const error = new NetworkError(message);
    error.statusCode = statusCode;
    throw error;
  }

  static create(message: string, statusCode: number): NetworkError {
    const error = new NetworkError(message);
    error.statusCode = statusCode;
    return error;
  }
}

/**
 * Database error for DB operations
 */
export class DatabaseError extends AppError {
  query?: string;

  constructor(message?: string) {
    super(message ?? "Database error");
    this.name = "DatabaseError";
  }

  static throw(message: string, query?: string): never {
    const error = new DatabaseError(message);
    if (query) error.query = query;
    throw error;
  }

  static create(message: string, query?: string): DatabaseError {
    const error = new DatabaseError(message);
    if (query) error.query = query;
    return error;
  }
}

/**
 * File system error
 */
export class FileSystemError extends AppError {
  path?: string;

  constructor(message?: string) {
    super(message ?? "File system error");
    this.name = "FileSystemError";
  }

  static throw(message: string, path?: string): never {
    const error = new FileSystemError(message);
    if (path) error.path = path;
    throw error;
  }

  static create(message: string, path?: string): FileSystemError {
    const error = new FileSystemError(message);
    if (path) error.path = path;
    return error;
  }
}

/**
 * Service error for external service failures
 */
export class ServiceError extends AppError {
  service?: string;

  constructor(message?: string) {
    super(message ?? "Service error");
    this.name = "ServiceError";
  }

  static throw(message: string, service?: string): never {
    const error = new ServiceError(message);
    if (service) error.service = service;
    throw error;
  }

  static create(message: string, service?: string): ServiceError {
    const error = new ServiceError(message);
    if (service) error.service = service;
    return error;
  }
}

/**
 * Not found error
 */
export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(`${resource} not found`);
    this.name = "NotFoundError";
  }

  static throw(resource: string): never {
    throw new NotFoundError(resource);
  }

  static create(resource: string): NotFoundError {
    return new NotFoundError(resource);
  }
}
