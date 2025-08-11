/**
 * Middleware type definitions for MCP server
 */

import { type McpToolResponse } from './mcp';

/**
 * Middleware function type
 */
export type MiddlewareFunction = (
  _req: MiddlewareRequest,
  _res: MiddlewareResponse,
  _next: NextFunction,
) => Promise<void> | void;

/**
 * Next function type
 */
export type NextFunction = (_error?: Error) => void;

/**
 * Middleware request object
 */
export interface MiddlewareRequest {
  /** Tool name being called */
  toolName: string;
  /** Tool parameters */
  params: unknown;
  /** Request ID for tracking */
  requestId: string;
  /** Customer context */
  customer?: string;
  /** Request timestamp */
  timestamp: number;
  /** Additional context */
  _context: Record<string, unknown>;
}

/**
 * Middleware response object
 */
export interface MiddlewareResponse {
  /** Set response data */
  send: (data: McpToolResponse) => void;
  /** Set _error response */
  error: (_error: Error | string, code?: string) => void;
  /** Response status */
  status?: number;
  /** Response data */
  data?: McpToolResponse;
}

/**
 * Authentication middleware _options
 */
export interface AuthMiddlewareOptions {
  /** Required authentication level */
  requireAuth?: boolean;
  /** Allowed customer roles */
  allowedRoles?: string[];
  /** Skip authentication for these tools */
  skipAuthFor?: string[];
}

/**
 * Logging middleware _options
 */
export interface LoggingMiddlewareOptions {
  /** Log level */
  level?: 'debug' | 'info' | 'warn' | 'error';
  /** Include request body in logs */
  includeBody?: boolean;
  /** Include response in logs */
  includeResponse?: boolean;
  /** Redact sensitive fields */
  redactFields?: string[];
}

/**
 * Rate limiting middleware _options
 */
export interface RateLimitMiddlewareOptions {
  /** Maximum requests per window */
  maxRequests: number;
  /** Time window in milliseconds */
  windowMs: number;
  /** Rate limit by customer */
  byCustomer?: boolean;
  /** Rate limit by tool */
  byTool?: boolean;
  /** Skip rate limiting for these tools */
  skipFor?: string[];
}

/**
 * Validation middleware _options
 */
export interface ValidationMiddlewareOptions {
  /** Strict mode - fail on unknown fields */
  strict?: boolean;
  /** Custom _error formatter */
  errorFormatter?: (errors: ValidationError[]) => string;
}

/**
 * Validation _error
 */
export interface ValidationError {
  /** Field path */
  path: string[];
  /** Error message */
  message: string;
  /** Expected type */
  expected?: string;
  /** Received value */
  received?: unknown;
}

/**
 * Customer context middleware
 */
export interface CustomerContextMiddleware {
  /** Extract customer from request */
  extractCustomer: (_req: MiddlewareRequest) => string | undefined;
  /** Validate customer exists */
  validateCustomer: (customer: string) => Promise<boolean>;
  /** Enrich request with customer data */
  enrichRequest: (_req: MiddlewareRequest, customer: string) => Promise<void>;
}

/**
 * Error handling middleware
 */
export interface ErrorHandlerMiddleware {
  /** Handle specific _error types */
  handlers: Map<string, (_error: Error) => McpToolResponse>;
  /** Default _error handler */
  defaultHandler: (_error: Error) => McpToolResponse;
  /** Log errors */
  logErrors?: boolean;
  /** Include stack traces */
  includeStackTrace?: boolean;
}

/**
 * Middleware stack manager
 */
export class MiddlewareStack {
  private middlewares: MiddlewareFunction[] = [];

  /**
   * Add middleware to stack
   */
  use(middleware: MiddlewareFunction): void {
    this.middlewares.push(middleware);
  }

  /**
   * Execute middleware stack
   */
  async execute(_req: MiddlewareRequest, _res: MiddlewareResponse): Promise<void> {
    let index = 0;

    const _next: NextFunction = async (_error?: Error) => {
      if (_error) {
        throw _error;
      }

      if (index >= this.middlewares.length) {
        return;
      }

      const middleware = this.middlewares[index++];

      if (!middleware) {
        return;
      }

      await middleware(_req, _res, _next);
    };

    await _next();
  }
}

/**
 * Built-in middleware factories
 */
export const Middleware = {
  /**
   * Authentication middleware
   */
  auth(_options: AuthMiddlewareOptions = {}): MiddlewareFunction {
    return async (_req, _res, _next) => {
      const { requireAuth = true, skipAuthFor = [] } = _options;

      if (skipAuthFor.includes(_req.toolName)) {
        return _next();
      }

      if (requireAuth && !_req.customer) {
        return _res.error('Authentication required', 'AUTH_REQUIRED');
      }

      _next();
    };
  },

  /**
   * Logging middleware
   */
  logging(_options: LoggingMiddlewareOptions = {}): MiddlewareFunction {
    return async (_req, _res, _next) => {
      const { level = 'info', includeBody = true } = _options;

      const startTime = Date.now();

      // Log request
      const logData: Record<string, unknown> = {
        requestId: _req.requestId,
        toolName: _req.toolName,
        customer: _req.customer,
      };

      if (includeBody) {
        logData.params = _req.params;
      }

      console.log(`[${level.toUpperCase()}] Request:`, logData);

      // Continue to _next middleware
      _next();

      // Log response (after other middlewares)
      const duration = Date.now() - startTime;
      console.log(`[${level.toUpperCase()}] Response:`, {
        requestId: _req.requestId,
        duration,
        status: _res.status,
      });
    };
  },

  /**
   * Rate limiting middleware
   */
  rateLimit(_options: RateLimitMiddlewareOptions): MiddlewareFunction {
    const requests = new Map<string, number[]>();

    return async (_req, _res, _next) => {
      const { maxRequests, windowMs, byCustomer = true, skipFor = [] } = _options;

      if (skipFor.includes(_req.toolName)) {
        return _next();
      }

      const key = byCustomer ? `${_req.customer}-${_req.toolName}` : _req.toolName;
      const now = Date.now();
      const windowStart = now - windowMs;

      // Get existing requests
      const requestTimes = requests.get(key) || [];

      // Filter out old requests
      const recentRequests = requestTimes.filter((time) => time > windowStart);

      if (recentRequests.length >= maxRequests) {
        return _res.error('Rate limit exceeded', 'RATE_LIMIT_EXCEEDED');
      }

      // Add current request
      recentRequests.push(now);
      requests.set(key, recentRequests);

      _next();
    };
  },

  /**
   * Error handler middleware
   */
  errorHandler(_options: Partial<ErrorHandlerMiddleware> = {}): MiddlewareFunction {
    const { logErrors = true, includeStackTrace = false } = _options;

    return async (_req, _res, _next) => {
      try {
        await _next();
      } catch (_error) {
        if (logErrors) {
          console.error('Middleware error:', {
            requestId: _req.requestId,
            toolName: _req.toolName,
            error: _error instanceof Error ? _error.message : String(_error),
            stack: includeStackTrace && _error instanceof Error ? _error.stack : undefined,
          });
        }

        if (_error instanceof Error) {
          _res.error(_error.message, _error.name);
        } else {
          _res.error(String(_error), 'UNKNOWN_ERROR');
        }
      }
    };
  },
};
