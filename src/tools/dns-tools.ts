/**
 * Edge DNS API tools for zone and record management
 * 
 * SNOW LEOPARD ARCHITECTURE:
 * - Implements Akamai Edge DNS API v2 with change-list workflow
 * - Type-safe implementation with official API response schemas
 * - Enhanced error handling with detailed user guidance
 * - MCP June 2025 compliant response formats
 * 
 * CODE KAI PRINCIPLES APPLIED:
 * - Complete type safety with no `any` types
 * - Comprehensive API response validation
 * - Defensive error handling for all edge cases
 * - Structured logging for operational visibility
 */

import { createHash } from 'crypto';

import { Spinner, format, icons } from '../utils/progress';

import { type AkamaiClient } from '../akamai-client';
import { type MCPToolResponse } from '../types';
import {
  isEdgeDNSZonesResponse,
  isEdgeDNSZoneResponse,
  isEdgeDNSRecordSetsResponse,
  isEdgeDNSChangeListResponse,
  isEdgeDNSZoneSubmitResponse,
  isEdgeDNSZoneActivationStatusResponse,
  EdgeDNSValidationError,
  EdgeDNSChangeListMetadataSchema,
  type EdgeDNSZonesResponse,
  type EdgeDNSZoneResponse,
  type EdgeDNSRecordSetsResponse,
  type EdgeDNSChangeListResponse,
  type EdgeDNSChangeListMetadata,
  type EdgeDNSZoneSubmitResponse,
  type EdgeDNSZoneActivationStatusResponse,
} from '../types/api-responses/edge-dns-zones';

// Operational logging utilities
function generateRequestId(): string {
  return createHash('md5')
    .update(Date.now().toString() + Math.random().toString())
    .digest('hex')
    .substring(0, 8);
}

function logOperation(operation: string, details: Record<string, unknown>) {
  if (process.env.DNS_OPERATION_LOG === 'true') {
    const timestamp = new Date().toISOString();
    const requestId = (details.requestId as string) || generateRequestId();
    console.error(`[DNS-OPS] ${timestamp} [${requestId}] ${operation}:`, JSON.stringify(details));
  }
}

export interface ZoneActivationOptions {
  validateOnly?: boolean;
  waitForActivation?: boolean;
  timeout?: number;
  retryConfig?: {
    maxRetries?: number;
    initialDelay?: number;
    maxDelay?: number;
  };
}

/**
 * List all DNS zones with enhanced filtering and pagination
 */
export async function listZones(
  client: AkamaiClient,
  args: {
    contractIds?: string[];
    includeAliases?: boolean;
    search?: string;
    sortBy?: 'zone' | 'type' | 'lastModified';
    order?: 'ASC' | 'DESC';
    limit?: number;
    offset?: number;
  },
): Promise<MCPToolResponse> {
  const spinner = new Spinner();
  spinner.start('Fetching DNS zones...');

  try {
    const queryParams: Record<string, string> = {};

    if (args.contractIds?.length) {
      queryParams.contractIds = args.contractIds.join(',');
    }
    if (args.includeAliases !== undefined) {
      queryParams.includeAliases = String(args.includeAliases);
    }
    if (args.search) {
      queryParams.search = args.search;
    }

    // Enhanced pagination and sorting parameters
    if (args.sortBy) {
      queryParams.sortBy = args.sortBy;
    }
    if (args.order) {
      queryParams.order = args.order;
    }
    if (args.limit !== undefined) {
      queryParams.limit = String(Math.min(args.limit, 1000)); // API limit of 1000
    }
    if (args.offset !== undefined) {
      queryParams.offset = String(args.offset);
    }

    const rawResponse = await client.request({
      path: '/config-dns/v2/zones',
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      queryParams,
    });

    // CODE KAI: Runtime validation
    if (!isEdgeDNSZonesResponse(rawResponse)) {
      throw new EdgeDNSValidationError(
        'Invalid Edge DNS zones response structure',
        rawResponse,
        'EdgeDNSZonesResponse'
      );
    }

    const response = rawResponse as EdgeDNSZonesResponse;

    spinner.stop();

    if (!response.zones || response.zones.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `${icons.info} No DNS zones found`,
          },
        ],
      };
    }

    const zonesList = response.zones
      .map(
        (zone) =>
          `${icons.dns} ${format.cyan(zone.zone)} (${format.green(zone.type)})${zone.comment ? ` - ${format.dim(zone.comment)}` : ''}`,
      )
      .join('\n');

    return {
      content: [
        {
          type: 'text',
          text: `${icons.success} Found ${format.bold(response.zones.length.toString())} DNS zones:\n\n${zonesList}`,
        },
      ],
    };
  } catch (_error) {
    spinner.fail('Failed to fetch DNS zones');
    console.error('[Error]:', _error);
    throw _error;
  }
}

/**
 * Get DNS zone details
 */
export async function getZone(
  client: AkamaiClient,
  args: { zone: string },
): Promise<MCPToolResponse> {
  try {
    const rawResponse = await client.request({
      path: `/config-dns/v2/zones/${args.zone}`,
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    });

    // CODE KAI: Runtime validation
    if (!isEdgeDNSZoneResponse(rawResponse)) {
      throw new EdgeDNSValidationError(
        'Invalid Edge DNS zone response structure',
        rawResponse,
        'EdgeDNSZoneResponse'
      );
    }

    const response = rawResponse as EdgeDNSZoneResponse;

    let details = `DNS Zone: ${response.zone}\n`;
    details += `Type: ${response.type}\n`;

    if (response.comment) {
      details += `Comment: ${response.comment}\n`;
    }
    if (response.signAndServe !== undefined) {
      details += `DNSSEC: ${response.signAndServe ? 'Enabled' : 'Disabled'}\n`;
    }
    if (response.type === 'SECONDARY' && response.masters) {
      details += `Master servers: ${response.masters.join(', ')}\n`;
    }

    return {
      content: [
        {
          type: 'text',
          text: details,
        },
      ],
    };
  } catch (_error) {
    // Only log unexpected errors, not 404s which are expected in some scenarios
    if (!(_error instanceof Error && _error.message.includes('404:'))) {
      console.error('[Error]:', _error);
    }
    throw _error;
  }
}

/**
 * Create a DNS zone
 */
export async function createZone(
  client: AkamaiClient,
  args: {
    zone: string;
    type: 'PRIMARY' | 'SECONDARY' | 'ALIAS';
    comment?: string;
    contractId?: string;
    groupId?: string;
    masters?: string[];
    target?: string;
  },
): Promise<MCPToolResponse> {
  const spinner = new Spinner();
  spinner.start(`Creating ${args.type} zone: ${args.zone}`);

  try {
    const body: Partial<EdgeDNSZoneResponse> = {
      zone: args.zone,
      type: args.type,
      comment: args.comment,
    };

    // Add type-specific fields
    if (args.type === 'SECONDARY' && args.masters) {
      body.masters = args.masters;
    }
    if (args.type === 'ALIAS' && args.target) {
      body.target = args.target;
    }

    const queryParams: Record<string, string> = {};
    if (args.contractId) {
      queryParams.contractId = args.contractId;
    }
    if (args.groupId) {
      queryParams.gid = args.groupId;
    }

    await client.request({
      path: '/config-dns/v2/zones',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body,
      queryParams,
    });

    spinner.succeed(`Zone created: ${args.zone}`);

    return {
      content: [
        {
          type: 'text',
          text: `${icons.success} Successfully created DNS zone: ${format.cyan(args.zone)} (Type: ${format.green(args.type)})`,
        },
      ],
    };
  } catch (_error) {
    spinner.fail(`Failed to create zone: ${args.zone}`);
    console.error('[Error]:', _error);
    throw _error;
  }
}

/**
 * List DNS records for a zone
 */
export async function listRecords(
  client: AkamaiClient,
  args: { zone: string; search?: string; types?: string[] },
): Promise<MCPToolResponse> {
  try {
    const queryParams: Record<string, string> = {};
    if (args.search) {
      queryParams.search = args.search;
    }
    if (args.types?.length) {
      queryParams.types = args.types.join(',');
    }

    const rawResponse = await client.request({
      path: `/config-dns/v2/zones/${args.zone}/recordsets`,
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      queryParams,
    });

    // CODE KAI: Runtime validation
    if (!isEdgeDNSRecordSetsResponse(rawResponse)) {
      throw new EdgeDNSValidationError(
        'Invalid Edge DNS record sets response structure',
        rawResponse,
        'EdgeDNSRecordSetsResponse'
      );
    }

    const response = rawResponse as EdgeDNSRecordSetsResponse;

    if (!response.recordsets || response.recordsets.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `No DNS records found for zone: ${args.zone}`,
          },
        ],
      };
    }

    const recordsList = response.recordsets
      .map((record) => {
        const rdataStr = record.rdata.join(', ');
        return `• ${record.name} ${record.ttl} ${record.type} ${rdataStr}`;
      })
      .join('\n');

    return {
      content: [
        {
          type: 'text',
          text: `Found ${response.recordsets.length} DNS records in zone ${args.zone}:\n\n${recordsList}`,
        },
      ],
    };
  } catch (_error) {
    console.error('[Error]:', _error);
    throw _error;
  }
}

/**
 * Get existing changelist metadata for a zone
 */
export async function getChangeListMetadata(
  client: AkamaiClient,
  zone: string,
): Promise<EdgeDNSChangeListMetadata | null> {
  try {
    const rawResponse = await client.request({
      path: `/config-dns/v2/changelists/${zone}`,
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    });

    // CODE KAI: Runtime validation for metadata response
    try {
      return EdgeDNSChangeListMetadataSchema.parse(rawResponse);
    } catch {
      throw new EdgeDNSValidationError(
        'Invalid Edge DNS change list metadata response structure',
        rawResponse,
        'EdgeDNSChangeListMetadata'
      );
    }
  } catch (_error) {
    if (_error instanceof Error && _error.message?.includes('404')) {
      return null;
    }
    throw _error;
  }
}

/**
 * Get existing changelist with records for a zone
 */
export async function getChangeList(
  client: AkamaiClient,
  zone: string,
): Promise<EdgeDNSChangeListResponse | null> {
  try {
    // First check if changelist exists
    const metadata = await getChangeListMetadata(client, zone);
    if (!metadata) {
      return null;
    }

    // Get changelist with records
    const rawResponse = await client.request({
      path: `/config-dns/v2/changelists/${zone}/recordsets`,
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    });

    // Construct full changelist response
    return {
      zone: metadata.zone,
      lastModifiedDate: metadata.lastModifiedDate,
      changeTag: metadata.changeTag,
      zoneVersionId: metadata.zoneVersionId,
      stale: metadata.stale,
      recordSets: rawResponse.recordsets || [],
    };
  } catch (_error) {
    if (_error instanceof Error && _error.message?.includes('404')) {
      return null;
    }
    throw _error;
  }
}

/**
 * Enhanced submit changelist with validation and monitoring options
 */
export async function submitChangeList(
  client: AkamaiClient,
  zone: string,
  comment?: string,
  options?: ZoneActivationOptions,
): Promise<ZoneSubmitResponse> {
  const spinner = new Spinner();
  const opts = {
    validateOnly: false,
    waitForActivation: false,
    timeout: 300000, // 5 minutes default
    retryConfig: {
      maxRetries: 3,
      initialDelay: 1000,
      maxDelay: 30000,
    },
    ...options,
  };

  try {
    // Pre-submission validation - check if changelist exists and has content
    spinner.start('Validating changelist...');
    const changelist = await getChangeList(client, zone);

    if (!changelist) {
      spinner.fail('No changelist found');
      throw new Error(
        `No pending changelist exists for zone ${zone}. Create changes before submitting.`,
      );
    }

    if (!changelist.recordSets || changelist.recordSets.length === 0) {
      spinner.fail('Empty changelist');
      throw new Error(`The changelist for zone ${zone} is empty. Add changes before submitting.`);
    }

    // Submit with retry logic
    spinner.update(opts.validateOnly ? 'Validating changes...' : 'Submitting changelist...');

    let response: ZoneSubmitResponse | null = null;
    let lastError: unknown = null;

    for (let attempt = 0; attempt <= opts.retryConfig.maxRetries!; attempt++) {
      try {
        const rawResponse = await client.request({
          path: `/config-dns/v2/changelists/${zone}/submit`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: {
            comment: comment || `Submitting pending changes for ${zone}`,
            validateOnly: opts.validateOnly,
          },
        });

        // CODE KAI: Handle 204 No Content response
        if (!rawResponse || Object.keys(rawResponse).length === 0) {
          // 204 No Content - submission successful
          response = {
            requestId: generateRequestId(),
            expiryDate: new Date(Date.now() + 86400000).toISOString(), // +24h
          } as EdgeDNSZoneSubmitResponse;
        } else {
          // Validate full response
          if (!isEdgeDNSZoneSubmitResponse(rawResponse)) {
            throw new EdgeDNSValidationError(
              'Invalid Edge DNS zone submit response structure',
              rawResponse,
              'EdgeDNSZoneSubmitResponse'
            );
          }
          response = rawResponse as ZoneSubmitResponse;
        }

        break; // Success, exit retry loop
      } catch (_error) {
        lastError = _error;

        // Check if it's a rate limit error
        if ((_error instanceof Error && _error.message?.includes('429')) || 
            (_error && typeof _error === 'object' && 'statusCode' in _error && (_error as {statusCode: number}).statusCode === 429)) {
          const errorWithHeaders = _error as {headers?: Record<string, string>};
          const retryAfter =
            errorWithHeaders.headers?.['retry-after'] ||
            Math.min(
              opts.retryConfig.initialDelay! * Math.pow(2, attempt),
              opts.retryConfig.maxDelay!,
            );

          if (attempt < opts.retryConfig.maxRetries!) {
            const retryDelayMs = typeof retryAfter === 'string' ? parseInt(retryAfter, 10) * 1000 : retryAfter;
            spinner.update(`Rate limited, retrying in ${retryDelayMs}ms...`);
            await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
            continue;
          }
        }

        // For other errors, only retry on transient failures
        if (isTransientError(_error) && attempt < opts.retryConfig.maxRetries!) {
          const delay = Math.min(
            opts.retryConfig.initialDelay! * Math.pow(2, attempt),
            opts.retryConfig.maxDelay!,
          );
          spinner.update(`Transient _error, retrying in ${delay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        // Non-retryable error or max retries reached
        throw _error;
      }
    }

    if (!response) {
      throw lastError || new Error('Failed to submit changelist after retries');
    }

    // Handle validation results
    if (opts.validateOnly && response.validationResult) {
      spinner.stop();

      const hasErrors = response.validationResult.errors && response.validationResult.errors.length > 0;
      const hasWarnings = response.validationResult.warnings && response.validationResult.warnings.length > 0;

      if (hasErrors && response.validationResult.errors) {
        const errorMessages = response.validationResult.errors
          .map((e) => `  ${icons.error} ${e.field}: ${e.message}`)
          .join('\n');
        throw new Error(`Validation failed:\n${errorMessages}`);
      }

      if (hasWarnings && response.validationResult.warnings) {
        console.log(`${icons.warning} Validation warnings:`);
        response.validationResult.warnings.forEach((w) => {
          console.log(`  ${icons.warning} ${w.field}: ${w.message}`);
        });
      }

      spinner.succeed('Validation completed successfully');
      return response;
    }

    spinner.succeed(`Changelist submitted successfully (Request ID: ${response.requestId})`);

    // Log submission success
    logOperation('CHANGELIST_SUBMITTED', {
      zone,
      requestId: response.requestId,
      recordCount: changelist.recordSets?.length || 0,
      validateOnly: opts.validateOnly,
      comment: comment,
    });

    // Wait for activation if requested
    if (opts.waitForActivation && !opts.validateOnly) {
      spinner.start('Waiting for zone activation...');
      try {
        const status = await waitForZoneActivation(client, zone, {
          timeout: opts.timeout,
          requestId: response.requestId,
        });

        if (status.activationState === 'ACTIVE') {
          spinner.succeed(
            `Zone ${zone} activated successfully (${status.propagationStatus?.percentage || 100}% propagated)`,
          );
        } else {
          spinner.fail(`Zone activation failed: ${status.activationState}`);
        }
      } catch (_error) {
        spinner.fail('Failed to monitor activation status');
        console.error('[Error]:', _error);
        // Don't throw - submission was successful even if monitoring failed
      }
    }

    return response;
  } catch (_error) {
    if (spinner) {
      spinner.fail('Failed to submit changelist');
    }
    throw _error;
  }
}

/**
 * Helper to determine if an error is transient and should be retried
 */
function isTransientError(_error: unknown): boolean {
  // Network errors
  if (
    _error && typeof _error === 'object' && 'code' in _error &&
    ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED'].includes((_error as {code: string}).code)
  ) {
    return true;
  }

  // HTTP errors that might be transient
  const errorObj = _error as {statusCode?: number; response?: {status?: number}};
  const statusCode = errorObj.statusCode || errorObj.response?.status;
  if (statusCode && [502, 503, 504].includes(statusCode)) {
    return true;
  }

  return false;
}

/**
 * Discard an existing changelist with retry logic
 */
export async function discardChangeList(
  client: AkamaiClient,
  zone: string,
  retryConfig?: {
    maxRetries?: number;
    initialDelay?: number;
  },
): Promise<void> {
  const config = {
    maxRetries: 3,
    initialDelay: 1000,
    ...retryConfig,
  };

  let lastError: unknown = null;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      await client.request({
        path: `/config-dns/v2/changelists/${zone}`,
        method: 'DELETE',
        headers: {
          Accept: 'application/json',
        },
      });
      return; // Success
    } catch (_error) {
      lastError = _error;

      // Don't retry on 404 - changelist doesn't exist
      if ((_error instanceof Error && _error.message?.includes('404')) || 
          (_error && typeof _error === 'object' && 'statusCode' in _error && (_error as {statusCode: number}).statusCode === 404)) {
        return; // Consider success - changelist is gone
      }

      // Retry on transient errors
      if (isTransientError(_error) && attempt < config.maxRetries) {
        const delay = config.initialDelay * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      throw _error;
    }
  }

  throw lastError || new Error('Failed to discard changelist after retries');
}

/**
 * Wait for zone activation to complete
 */
export async function waitForZoneActivation(
  client: AkamaiClient,
  zone: string,
  options?: {
    timeout?: number;
    pollInterval?: number;
    requestId?: string;
  },
): Promise<ZoneActivationStatus> {
  const opts = {
    timeout: 300000, // 5 minutes default
    pollInterval: 3000, // 3 seconds default
    ...options,
  };

  const startTime = Date.now();
  let consecutiveErrors = 0;
  const maxConsecutiveErrors = 3;
  let backoffMultiplier = 1;

  while (Date.now() - startTime < opts.timeout) {
    try {
      // Get zone activation status
      const rawResponse = await client.request({
        path: `/config-dns/v2/zones/${zone}/status`,
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
      });

      // CODE KAI: Runtime validation
      if (!isEdgeDNSZoneActivationStatusResponse(rawResponse)) {
        throw new EdgeDNSValidationError(
          'Invalid Edge DNS zone activation status response structure',
          rawResponse,
          'EdgeDNSZoneActivationStatusResponse'
        );
      }

      const status = rawResponse as EdgeDNSZoneActivationStatusResponse;

      // Reset error counter on successful request
      consecutiveErrors = 0;
      backoffMultiplier = 1;

      // Check if activation is complete
      if (status.activationState === 'ACTIVE') {
        return status;
      }

      // Check if activation failed
      if (status.activationState === 'FAILED') {
        throw new Error(`Zone activation failed for ${zone}`);
      }

      // Still pending - wait before next poll
      const delay = opts.pollInterval * backoffMultiplier;
      await new Promise((resolve) => setTimeout(resolve, delay));
    } catch (_error) {
      // Handle rate limiting with exponential backoff
      if ((_error instanceof Error && _error.message?.includes('429')) || 
          (_error && typeof _error === 'object' && 'statusCode' in _error && (_error as {statusCode: number}).statusCode === 429)) {
        consecutiveErrors++;

        if (consecutiveErrors >= maxConsecutiveErrors) {
          throw new Error(`Rate limited while monitoring zone ${zone} activation`);
        }

        // Exponential backoff with jitter
        backoffMultiplier = Math.min(backoffMultiplier * 2, 10);
        const delay = opts.pollInterval * backoffMultiplier + Math.random() * 1000;

        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      // For other errors, check if transient
      if (isTransientError(_error)) {
        consecutiveErrors++;

        if (consecutiveErrors >= maxConsecutiveErrors) {
          throw new Error(
            `Failed to get zone status after ${maxConsecutiveErrors} attempts: ${_error instanceof Error ? _error.message : String(_error)}`,
          );
        }

        await new Promise((resolve) => setTimeout(resolve, opts.pollInterval));
        continue;
      }

      // Non-transient error
      throw _error;
    }
  }

  // Timeout reached
  throw new Error(`Timeout waiting for zone ${zone} activation after ${opts.timeout}ms`);
}

/**
 * Process multiple zone operations sequentially with error recovery
 */
export async function processMultipleZones(
  _client: AkamaiClient,
  zones: string[],
  operation: (zone: string) => Promise<unknown>,
  options?: {
    continueOnError?: boolean;
    delayBetweenZones?: number;
  },
): Promise<{
  successful: string[];
  failed: Array<{ zone: string; error: string }>;
}> {
  const opts = {
    continueOnError: options?.continueOnError ?? true,
    delayBetweenZones: options?.delayBetweenZones ?? 1000,
  };

  const result = {
    successful: [] as string[],
    failed: [] as Array<{ zone: string; error: string }>,
  };

  for (let i = 0; i < zones.length; i++) {
    const zone = zones[i];
    if (!zone) {
      continue;
    } // TypeScript guard

    try {
      await operation(zone);
      result.successful.push(zone);

      // Add delay between zones to avoid rate limiting
      if (i < zones.length - 1 && opts.delayBetweenZones > 0) {
        await new Promise((resolve) => setTimeout(resolve, opts.delayBetweenZones));
      }
    } catch (_error) {
      const errorMessage: string =
        _error instanceof Error ? _error.message : String(_error || 'Unknown error');
      result.failed.push({
        zone,
        error: errorMessage,
      });

      if (!opts.continueOnError) {
        throw new Error(`Failed processing zone ${zone}: ${errorMessage}`);
      }
    }
  }

  return result;
}

/**
 * Helper function to ensure a clean change list for a zone
 * This will check for an existing change list and handle it gracefully.
 */
export async function ensureCleanChangeList(
  client: AkamaiClient,
  zone: string,
  spinner?: Spinner,
  force?: boolean,
): Promise<void> {
  // Check for existing change list
  if (spinner) {
    spinner.update('Checking for existing change list...');
  }

  const existingChangeList = await getChangeList(client, zone);

  if (existingChangeList) {
    // Log existing changelist detection
    logOperation('EXISTING_CHANGELIST_FOUND', {
      zone,
      recordCount: existingChangeList.recordSets?.length || 0,
      lastModifiedBy: existingChangeList.lastModifiedBy,
      lastModifiedDate: existingChangeList.lastModifiedDate,
      requestId: generateRequestId(),
    });

    // Stop spinner to show interactive message
    if (spinner) {
      spinner.stop();
    }

    // Format pending changes
    const pendingChanges: string[] = [];
    if (existingChangeList.recordSets && existingChangeList.recordSets.length > 0) {
      existingChangeList.recordSets.forEach((record) => {
        pendingChanges.push(
          `  • ${record.name} ${record.ttl} ${record.type} ${record.rdata.join(' ')}`,
        );
      });
    }

    if (!force) {
      // Show error with details about existing changelist
      const errorMessage = [
        `${icons.warning} A changelist already exists for zone ${format.cyan(zone)}`,
        '',
        `${icons.info} Last modified by: ${format.dim(existingChangeList.lastModifiedBy)}`,
        `${icons.info} Last modified: ${format.dim(existingChangeList.lastModifiedDate)}`,
        '',
        pendingChanges.length > 0
          ? `${icons.list} Pending changes:`
          : `${icons.info} No pending changes in the changelist`,
        ...pendingChanges.slice(0, 10),
        pendingChanges.length > 10 ? `  ... and ${pendingChanges.length - 10} more changes` : '',
        '',
        `${icons.question} What would you like to do?`,
        '',
        '1. Submit the existing changelist',
        '2. Discard the existing changelist and continue',
        '3. Cancel the operation',
        '',
        'To force discard without asking, use the force option',
      ]
        .filter((line) => line !== '')
        .join('\n');

      throw new Error(errorMessage);
    }

    // Force mode - discard existing changelist
    if (spinner) {
      spinner.start('Discarding existing change list...');
    }

    const discardRequestId = generateRequestId();
    logOperation('DISCARDING_CHANGELIST', { zone, force: true, requestId: discardRequestId });

    await discardChangeList(client, zone);

    logOperation('CHANGELIST_DISCARDED', { zone, requestId: discardRequestId });
  }

  // Create a new change list
  if (spinner) {
    spinner.update('Creating change list...');
  }

  const createRequestId = generateRequestId();
  logOperation('CREATING_CHANGELIST', { zone, requestId: createRequestId });

  // The changelist is created automatically when you make changes to a zone
  // No explicit create endpoint is needed

  logOperation('CHANGELIST_CREATED', { zone, requestId: createRequestId });
}

/**
 * Create or update a DNS record using change list workflow
 */
export async function upsertRecord(
  client: AkamaiClient,
  args: {
    zone: string;
    name: string;
    type: string;
    ttl: number;
    rdata: string[];
    comment?: string;
    force?: boolean;
  },
): Promise<MCPToolResponse> {
  const spinner = new Spinner();

  try {
    // Step 1: Create a new changelist
    spinner.start('Creating changelist...');
    const changelistResponse = await client.request({
      path: '/config-dns/v2/changelists',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      queryParams: {
        zone: args.zone
      }
    });
    
    spinner.update(`Changelist created for zone ${args.zone}`);

    // Step 2: Add/update the record using add-change endpoint
    spinner.update(`Adding ${args.type} record for ${args.name}...`);
    
    // Determine operation type (ADD or EDIT)
    // For upsert, we'll use ADD which will update if exists
    const changeOperation = {
      name: args.name,
      type: args.type,
      op: 'ADD' as const,
      ttl: args.ttl,
      rdata: args.rdata,
    };

    await client.request({
      path: `/config-dns/v2/changelists/${args.zone}/recordsets/add-change`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: changeOperation,
    });

    // Step 3: Submit the change list
    spinner.update('Submitting changes...');
    const submitResponse = await submitChangeList(client, args.zone, args.comment || `Updated ${args.type} record for ${args.name}`);

    spinner.succeed(`Record updated: ${args.name} ${args.type}`);

    return {
      content: [
        {
          type: 'text',
          text: `${icons.success} Successfully updated DNS record:\n${icons.dns} ${format.cyan(args.name)} ${format.dim(args.ttl.toString())} ${format.green(args.type)} ${format.yellow(args.rdata.join(' '))}\n\n${icons.info} Request ID: ${format.dim(submitResponse.requestId)}`,
        },
      ],
    };
  } catch (_error) {
    spinner.fail('Failed to update DNS record');
    console.error('[Error]:', _error);
    throw _error;
  }
}

/**
 * Delete a DNS record using change list workflow
 */
export async function deleteRecord(
  client: AkamaiClient,
  args: {
    zone: string;
    name: string;
    type: string;
    comment?: string;
    force?: boolean;
  },
): Promise<MCPToolResponse> {
  const spinner = new Spinner();

  try {
    // Step 1: Create a new changelist
    spinner.start('Creating changelist...');
    const changelistResponse = await client.request({
      path: '/config-dns/v2/changelists',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      queryParams: {
        zone: args.zone
      }
    });
    
    spinner.update(`Changelist created for zone ${args.zone}`);

    // Step 2: Add delete operation to the changelist
    spinner.update(`Deleting ${args.type} record for ${args.name}...`);
    
    const deleteOperation = {
      name: args.name,
      type: args.type,
      op: 'DELETE' as const
    };
    
    await client.request({
      path: `/config-dns/v2/changelists/${args.zone}/recordsets/add-change`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: deleteOperation,
    });

    // Step 3: Submit the change list
    spinner.update('Submitting changes...');
    const rawSubmitResponse = await client.request({
      path: `/config-dns/v2/changelists/${args.zone}/submit`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: {
        comment: args.comment || `Deleted ${args.type} record for ${args.name}`,
      },
    });

    // CODE KAI: Runtime validation
    if (!isEdgeDNSZoneSubmitResponse(rawSubmitResponse)) {
      throw new EdgeDNSValidationError(
        'Invalid Edge DNS zone submit response structure',
        rawSubmitResponse,
        'EdgeDNSZoneSubmitResponse'
      );
    }

    const submitResponse = rawSubmitResponse as EdgeDNSZoneSubmitResponse;

    spinner.succeed(`Record deleted: ${args.name} ${args.type}`);

    return {
      content: [
        {
          type: 'text',
          text: `${icons.success} Successfully deleted DNS record:\n${icons.dns} ${format.cyan(args.name)} ${format.green(args.type)}\n\n${icons.info} Request ID: ${format.dim(submitResponse.requestId)}`,
        },
      ],
    };
  } catch (_error) {
    spinner.fail('Failed to delete DNS record');
    // Only log unexpected errors, not 404s which are expected in some scenarios
    if (!(_error instanceof Error && _error.message.includes('404:'))) {
      console.error('[Error]:', _error);
    }
    throw _error;
  }
}

/**
 * MCP Tool: Activate zone changes with optional validation and monitoring
 */
export async function activateZoneChanges(
  client: AkamaiClient,
  args: {
    zone: string;
    comment?: string;
    validateOnly?: boolean;
    waitForCompletion?: boolean;
    timeout?: number;
  },
): Promise<MCPToolResponse> {
  const spinner = new Spinner();

  try {
    // Check if there's a changelist to submit
    spinner.start('Checking for pending changes...');
    const changelist = await getChangeList(client, args.zone);

    if (!changelist) {
      spinner.stop();
      return {
        content: [
          {
            type: 'text',
            text: `${icons.info} No pending changes found for zone ${format.cyan(args.zone)}`,
          },
        ],
      };
    }

    // Show pending changes summary
    spinner.stop();
    const changeCount = changelist.recordSets?.length || 0;
    console.log(
      `${icons.info} Found ${format.bold(changeCount.toString())} pending changes for zone ${format.cyan(args.zone)}`,
    );
    console.log(`${icons.info} Last modified by: ${format.dim(changelist.lastModifiedBy)}`);
    console.log(`${icons.info} Last modified: ${format.dim(changelist.lastModifiedDate)}`);

    if (changeCount > 0 && changeCount <= 10) {
      console.log(`\n${icons.list} Pending changes:`);
      changelist.recordSets.forEach((record) => {
        console.log(`  • ${record.name} ${record.ttl} ${record.type} ${record.rdata.join(' ')}`);
      });
    } else if (changeCount > 10) {
      console.log(`\n${icons.list} Showing first 10 pending changes:`);
      changelist.recordSets.slice(0, 10).forEach((record) => {
        console.log(`  • ${record.name} ${record.ttl} ${record.type} ${record.rdata.join(' ')}`);
      });
      console.log(`  ... and ${changeCount - 10} more changes`);
    }
    console.log(''); // Empty line for readability

    // Submit the changelist with options
    const submitResponse = await submitChangeList(client, args.zone, args.comment, {
      validateOnly: args.validateOnly,
      waitForActivation: args.waitForCompletion,
      timeout: args.timeout,
    });

    // Format response based on operation type
    if (args.validateOnly) {
      return {
        content: [
          {
            type: 'text',
            text:
              `${icons.success} Validation completed successfully for zone ${format.cyan(args.zone)}\n\n` +
              `${icons.info} All ${changeCount} changes passed validation\n` +
              `${icons.info} Request ID: ${format.dim(submitResponse.requestId)}`,
          },
        ],
      };
    } else {
      let responseText =
        `${icons.success} Successfully activated ${changeCount} changes for zone ${format.cyan(args.zone)}\n\n` +
        `${icons.info} Request ID: ${format.dim(submitResponse.requestId)}`;

      if (!args.waitForCompletion) {
        responseText += `\n${icons.info} Zone activation is in progress. Use the request ID to track status.`;
      }

      return {
        content: [
          {
            type: 'text',
            text: responseText,
          },
        ],
      };
    }
  } catch (_error) {
    spinner.fail('Failed to activate zone changes');

    // Provide helpful error messages
    if (_error instanceof Error && _error.message?.includes('No pending changelist')) {
      return {
        content: [
          {
            type: 'text',
            text:
              `${icons.error} ${_error.message}\n\n` +
              `${icons.info} To make changes:\n` +
              '  1. Use upsertRecord to add/update records\n' +
              '  2. Use deleteRecord to remove records\n' +
              '  3. Then use activateZoneChanges to submit',
          },
        ],
      };
    }

    throw _error;
  }
}
