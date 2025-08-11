/**
 * Advanced DNS Tools for EdgeDNS API
 * Implements additional DNS management functions
 */

import { Spinner, format, icons } from '../utils/progress';
import { validateApiResponse } from '../utils/api-response-validator';

import { type AkamaiClient } from '../akamai-client';
import { type MCPToolResponse } from '../types';

// Advanced DNS Types
export interface DNSSECStatus {
  zone: string;
  dnssecEnabled: boolean;
  algorithm?: string;
  keyRotationInterval?: number;
  dsRecords?: Array<{
    algorithm: number;
    digest: string;
    digestType: number;
    keyTag: number;
  }>;
}

export interface ZoneTransferStatus {
  zone: string;
  lastTransferTime?: string;
  lastTransferResult?: string;
  lastTransferError?: string;
  nextTransferTime?: string;
  masterServers: string[];
}

export interface ZoneContract {
  zone: string;
  contractId: string;
  contractTypeName?: string;
  features?: string[];
}

export interface ZoneVersion {
  zone: string;
  versionId: string;
  activationDate: string;
  author: string;
  comment?: string;
  recordSetCount: number;
}

export interface BulkZoneCreateRequest {
  zones: Array<{
    zone: string;
    type: 'PRIMARY' | 'SECONDARY' | 'ALIAS';
    comment?: string;
    masters?: string[];
    target?: string;
  }>;
  contractId: string;
  groupId: string;
}

export interface BulkZoneCreateResponse {
  requestId: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETE' | 'FAILED';
  zonesCreated?: number;
  zonesFailed?: number;
  errors?: Array<{
    zone: string;
    error: string;
  }>;
}

/**
 * Get DNSSEC status for zones
 */
export async function getZonesDNSSECStatus(
  client: AkamaiClient,
  args: { zones: string[] },
): Promise<MCPToolResponse> {
  const spinner = new Spinner();
  spinner.start('Fetching DNSSEC status...');

  try {
    const results: DNSSECStatus[] = [];

    for (const zone of args.zones) {
      try {
        const response = await client.request({
          path: `/config-dns/v2/zones/${zone}/dnssec`,
          method: 'GET',
          headers: {
            Accept: 'application/json',
          },
        });

        const validatedResponse = validateApiResponse<DNSSECStatus>(response);
        results.push(validatedResponse);
      } catch (_error: any) {
        // If DNSSEC is not enabled, API returns 404
        if (_error.message?.includes('404')) {
          results.push({
            zone,
            dnssecEnabled: false,
          });
        } else {
          throw _error;
        }
      }
    }

    spinner.stop();

    let text = `${icons.shield} DNSSEC Status Report\n\n`;

    for (const status of results) {
      text += `${icons.dns} ${format.cyan(status.zone)}: `;
      if (status.dnssecEnabled) {
        text += `${format.green('ENABLED')}\n`;
        if (status.algorithm) {
          text += `  Algorithm: ${status.algorithm}\n`;
        }
        if (status.keyRotationInterval) {
          text += `  Key Rotation: Every ${status.keyRotationInterval} days\n`;
        }
        if (status.dsRecords && status.dsRecords.length > 0) {
          text += `  DS Records: ${status.dsRecords.length} configured\n`;
        }
      } else {
        text += `${format.red('DISABLED')}\n`;
      }
      text += '\n';
    }

    return {
      content: [
        {
          type: 'text',
          text,
        },
      ],
    };
  } catch (_error) {
    spinner.fail('Failed to fetch DNSSEC status');
    throw _error;
  }
}

/**
 * Get secondary zone transfer status
 */
export async function getSecondaryZoneTransferStatus(
  client: AkamaiClient,
  args: { zones: string[] },
): Promise<MCPToolResponse> {
  const spinner = new Spinner();
  spinner.start('Fetching zone transfer status...');

  try {
    const results: ZoneTransferStatus[] = [];

    for (const zone of args.zones) {
      const response = await client.request({
        path: `/config-dns/v2/zones/${zone}/transfer-status`,
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
      });

      const validatedResponse = validateApiResponse<ZoneTransferStatus>(response);
      results.push(validatedResponse);
    }

    spinner.stop();

    let text = `${icons.sync} Zone Transfer Status Report\n\n`;

    for (const status of results) {
      text += `${icons.dns} ${format.cyan(status.zone)}\n`;
      text += `  Master Servers: ${status.masterServers.join(', ')}\n`;

      if (status.lastTransferTime) {
        text += `  Last Transfer: ${status.lastTransferTime}\n`;
        text += `  Result: ${
          status.lastTransferResult === 'SUCCESS'
            ? format.green(status.lastTransferResult)
            : format.red(status.lastTransferResult || 'UNKNOWN')
        }\n`;
      }

      if (status.lastTransferError) {
        text += `  Error: ${format.red(status.lastTransferError)}\n`;
      }

      if (status.nextTransferTime) {
        text += `  Next Transfer: ${status.nextTransferTime}\n`;
      }

      text += '\n';
    }

    return {
      content: [
        {
          type: 'text',
          text,
        },
      ],
    };
  } catch (_error) {
    spinner.fail('Failed to fetch transfer status');
    throw _error;
  }
}

/**
 * Get zone's contract information
 */
export async function getZoneContract(
  client: AkamaiClient,
  args: { zone: string },
): Promise<MCPToolResponse> {
  try {
    const response = await client.request({
      path: `/config-dns/v2/zones/${args.zone}/contract`,
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    });

    const validatedResponse = validateApiResponse<{ 
      contractId?: string; 
      contractTypeName?: string; 
      features?: string[] 
    }>(response);
    
    let text = `${icons.contract} Zone Contract Information\n\n`;
    text += `Zone: ${format.cyan(args.zone)}\n`;
    text += `Contract ID: ${format.yellow(validatedResponse.contractId || 'Unknown')}\n`;

    if (validatedResponse.contractTypeName) {
      text += `Contract Type: ${validatedResponse.contractTypeName}\n`;
    }

    if (validatedResponse.features && validatedResponse.features.length > 0) {
      text += '\nEnabled Features:\n';
      validatedResponse.features.forEach((feature) => {
        text += `  ${icons.check} ${feature}\n`;
      });
    }

    return {
      content: [
        {
          type: 'text',
          text,
        },
      ],
    };
  } catch (_error) {
    console.error('[Error]:', _error);
    throw _error;
  }
}

/**
 * Get a single record set
 */
export async function getRecordSet(
  client: AkamaiClient,
  args: { zone: string; name: string; type: string },
): Promise<MCPToolResponse> {
  try {
    const response = await client.request({
      path: `/config-dns/v2/zones/${args.zone}/recordsets/${args.name}/${args.type}`,
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    });

    const validatedResponse = validateApiResponse<{
      name: string;
      type: string;
      ttl: number;
      rdata: string[];
    }>(response);

    let text = `${icons.dns} Record Set Details\n\n`;
    text += `Zone: ${format.cyan(args.zone)}\n`;
    text += `Name: ${format.yellow(validatedResponse.name)}\n`;
    text += `Type: ${format.green(validatedResponse.type)}\n`;
    text += `TTL: ${validatedResponse.ttl} seconds\n`;
    text += '\nRecord Data:\n';

    validatedResponse.rdata.forEach((data: string) => {
      text += `  ${icons.dot} ${data}\n`;
    });

    return {
      content: [
        {
          type: 'text',
          text,
        },
      ],
    };
  } catch (_error: any) {
    if (_error.message?.includes('404')) {
      return {
        content: [
          {
            type: 'text',
            text: `${icons.error} Record not found: ${args.name} ${args.type} in zone ${args.zone}`,
          },
        ],
      };
    }
    throw _error;
  }
}

/**
 * Update TSIG key for multiple zones
 */
export async function updateTSIGKeyForZones(
  client: AkamaiClient,
  args: {
    zones: string[];
    tsigKey: {
      name: string;
      algorithm: string;
      secret: string;
    };
  },
): Promise<MCPToolResponse> {
  const spinner = new Spinner();
  spinner.start('Updating TSIG keys...');

  try {
    const results: Array<{ zone: string; success: boolean; error?: string }> = [];

    for (const zone of args.zones) {
      try {
        // Get current zone config
        const zoneConfig = await client.request({
          path: `/config-dns/v2/zones/${zone}`,
          method: 'GET',
          headers: {
            Accept: 'application/json',
          },
        });

        const validatedZoneConfig = validateApiResponse<Record<string, any>>(zoneConfig);

        // Update with new TSIG key
        await client.request({
          path: `/config-dns/v2/zones/${zone}`,
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: {
            ...validatedZoneConfig,
            tsigKey: args.tsigKey,
          },
        });

        results.push({ zone, success: true });
      } catch (_error: any) {
        results.push({
          zone,
          success: false,
          error: _error.message || 'Unknown error',
        });
      }
    }

    spinner.stop();

    let text = `${icons.key} TSIG Key Update Results\n\n`;
    text += `Algorithm: ${args.tsigKey.algorithm}\n`;
    text += `Key Name: ${args.tsigKey.name}\n\n`;

    const successful = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);

    if (successful.length > 0) {
      text += `${icons.success} Successfully Updated (${successful.length}):\n`;
      successful.forEach((result) => {
        text += `  ${icons.check} ${result.zone}\n`;
      });
    }

    if (failed.length > 0) {
      text += `\n${icons.error} Failed (${failed.length}):\n`;
      failed.forEach((result) => {
        text += `  ${icons.cross} ${result.zone}: ${result.error}\n`;
      });
    }

    return {
      content: [
        {
          type: 'text',
          text,
        },
      ],
    };
  } catch (_error) {
    spinner.fail('Failed to update TSIG keys');
    throw _error;
  }
}

/**
 * Submit bulk zone creation request
 */
export async function submitBulkZoneCreateRequest(
  client: AkamaiClient,
  args: BulkZoneCreateRequest,
): Promise<MCPToolResponse> {
  const spinner = new Spinner();
  spinner.start('Submitting bulk zone creation request...');

  try {
    const response = await client.request({
      path: '/config-dns/v2/zones/bulk-create',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      queryParams: {
        contractId: args.contractId,
        gid: args.groupId,
      },
      body: {
        zones: args.zones,
      },
    });

    const validatedResponse = validateApiResponse<BulkZoneCreateResponse>(response);

    spinner.stop();

    let text = `${icons.bulk} Bulk Zone Creation Request Submitted\n\n`;
    text += `Request ID: ${format.yellow(validatedResponse.requestId)}\n`;
    text += `Status: ${format.cyan(validatedResponse.status)}\n`;
    text += `Total Zones: ${args.zones.length}\n\n`;

    text += 'Zones to be created:\n';
    args.zones.forEach((zone) => {
      text += `  ${icons.dns} ${zone.zone} (${zone.type})\n`;
    });

    text += `\n${icons.info} Use "Get bulk creation status ${validatedResponse.requestId}" to check progress`;

    return {
      content: [
        {
          type: 'text',
          text,
        },
      ],
    };
  } catch (_error) {
    spinner.fail('Failed to submit bulk creation request');
    throw _error;
  }
}

/**
 * Get zone version details
 */
export async function getZoneVersion(
  client: AkamaiClient,
  args: { zone: string; versionId: string },
): Promise<MCPToolResponse> {
  try {
    const response = await client.request({
      path: `/config-dns/v2/zones/${args.zone}/versions/${args.versionId}`,
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    });

    const validatedResponse = validateApiResponse<ZoneVersion>(response);

    let text = `${icons.version} Zone Version Details\n\n`;
    text += `Zone: ${format.cyan(args.zone)}\n`;
    text += `Version ID: ${format.yellow(validatedResponse.versionId)}\n`;
    text += `Activation Date: ${validatedResponse.activationDate}\n`;
    text += `Author: ${validatedResponse.author}\n`;
    text += `Record Sets: ${validatedResponse.recordSetCount}\n`;

    if (validatedResponse.comment) {
      text += `Comment: ${validatedResponse.comment}\n`;
    }

    return {
      content: [
        {
          type: 'text',
          text,
        },
      ],
    };
  } catch (_error) {
    console.error('[Error]:', _error);
    throw _error;
  }
}

/**
 * Get version's record sets
 */
export async function getVersionRecordSets(
  client: AkamaiClient,
  args: { zone: string; versionId: string; offset?: number; limit?: number },
): Promise<MCPToolResponse> {
  try {
    const queryParams: any = {};
    if (args.offset !== undefined) {
      queryParams.offset = args.offset;
    }
    if (args.limit !== undefined) {
      queryParams.limit = args.limit;
    }

    const response = await client.request({
      path: `/config-dns/v2/zones/${args.zone}/versions/${args.versionId}/recordsets`,
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      queryParams,
    });

    const validatedResponse = validateApiResponse<{
      recordsets: Array<{
        name: string;
        ttl: number;
        type: string;
        rdata: string[];
      }>;
    }>(response);

    let text = `${icons.list} Record Sets for Version ${args.versionId}\n\n`;
    text += `Zone: ${format.cyan(args.zone)}\n`;
    text += `Total Records: ${validatedResponse.recordsets.length}\n\n`;

    validatedResponse.recordsets.forEach((record) => {
      text += `${icons.dns} ${record.name} ${record.ttl} ${record.type} ${record.rdata.join(' ')}\n`;
    });

    return {
      content: [
        {
          type: 'text',
          text,
        },
      ],
    };
  } catch (_error) {
    console.error('[Error]:', _error);
    throw _error;
  }
}

/**
 * Reactivate a zone version
 */
export async function reactivateZoneVersion(
  client: AkamaiClient,
  args: { zone: string; versionId: string; comment?: string },
): Promise<MCPToolResponse> {
  const spinner = new Spinner();
  spinner.start(`Reactivating version ${args.versionId}...`);

  try {
    const response = await client.request({
      path: `/config-dns/v2/zones/${args.zone}/versions/${args.versionId}/reactivate`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: {
        comment: args.comment || `Reactivated version ${args.versionId}`,
      },
    });

    const validatedResponse = validateApiResponse<{ versionId: string }>(response);

    spinner.succeed('Version reactivated successfully');

    return {
      content: [
        {
          type: 'text',
          text: `${icons.success} Successfully reactivated zone version\n\nZone: ${format.cyan(args.zone)}\nVersion: ${format.yellow(args.versionId)}\nNew Version ID: ${format.green(validatedResponse.versionId)}\n\n${icons.info} The zone has been updated with the record sets from the selected version.`,
        },
      ],
    };
  } catch (_error) {
    spinner.fail('Failed to reactivate version');
    throw _error;
  }
}

/**
 * Get version's master zone file
 */
export async function getVersionMasterZoneFile(
  client: AkamaiClient,
  args: { zone: string; versionId: string },
): Promise<MCPToolResponse> {
  try {
    const response = await client.request({
      path: `/config-dns/v2/zones/${args.zone}/versions/${args.versionId}/zone-file`,
      method: 'GET',
      headers: {
        Accept: 'text/plain',
      },
    });

    return {
      content: [
        {
          type: 'text',
          text: `${icons.file} Master Zone File - ${args.zone} (Version: ${args.versionId})\n\n\`\`\`\n${response}\n\`\`\``,
        },
      ],
    };
  } catch (_error) {
    console.error('[Error]:', _error);
    throw _error;
  }
}

/**
 * Create multiple record sets in a single operation
 */
export async function createMultipleRecordSets(
  client: AkamaiClient,
  args: {
    zone: string;
    recordSets: Array<{
      name: string;
      type: string;
      ttl: number;
      rdata: string[];
    }>;
    comment?: string;
  },
): Promise<MCPToolResponse> {
  const spinner = new Spinner();
  spinner.start('Creating multiple record sets...');

  try {
    // Create change list
    await client.request({
      path: '/config-dns/v2/changelists',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      queryParams: { zone: args.zone },
    });

    // Add all record sets to change list
    const results: Array<{ record: string; success: boolean; error?: string }> = [];

    for (const recordSet of args.recordSets) {
      try {
        await client.request({
          path: `/config-dns/v2/changelists/${args.zone}/recordsets/${recordSet.name}/${recordSet.type}`,
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: recordSet,
        });

        results.push({
          record: `${recordSet.name} ${recordSet.type}`,
          success: true,
        });
      } catch (_error: any) {
        results.push({
          record: `${recordSet.name} ${recordSet.type}`,
          success: false,
          error: _error.message,
        });
      }
    }

    // Submit change list
    const submitResponse = await client.request({
      path: `/config-dns/v2/changelists/${args.zone}/submit`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: {
        comment: args.comment || `Created ${args.recordSets.length} record sets`,
      },
    });

    const validatedSubmitResponse = validateApiResponse<{ requestId: string }>(submitResponse);

    spinner.stop();

    let text = `${icons.success} Bulk Record Creation Complete\n\n`;
    text += `Zone: ${format.cyan(args.zone)}\n`;
    text += `Request ID: ${format.yellow(validatedSubmitResponse.requestId)}\n\n`;

    const successful = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);

    text += `${icons.check} Successful: ${successful.length}\n`;
    if (failed.length > 0) {
      text += `${icons.cross} Failed: ${failed.length}\n\n`;
      text += 'Failed Records:\n';
      failed.forEach((result) => {
        text += `  ${icons.error} ${result.record}: ${result.error}\n`;
      });
    }

    return {
      content: [
        {
          type: 'text',
          text,
        },
      ],
    };
  } catch (_error) {
    spinner.fail('Failed to create record sets');
    throw _error;
  }
}
