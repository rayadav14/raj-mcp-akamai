/**
 * CP Code Management Tools
 * Implements CRUD operations for Akamai CP Codes (Content Provider Codes)
 * CP Codes are used for reporting, billing, and traffic analysis
 */

import {
  formatContractDisplay,
  formatGroupDisplay,
  formatCPCodeDisplay,
  ensurePrefix,
} from '../utils/formatting';
import {
  getProductFriendlyName,
  formatProductDisplay,
  selectBestProduct,
} from '../utils/product-mapping';
import { validateApiResponse } from '../utils/api-response-validator';

import { type AkamaiClient } from '../akamai-client';
import { type MCPToolResponse } from '../types';

/**
 * List all CP Codes in the account
 */
export async function listCPCodes(
  client: AkamaiClient,
  args: {
    contractId?: string;
    groupId?: string;
    customer?: string;
  },
): Promise<MCPToolResponse> {
  try {
    const queryParams: any = {};

    if (args.contractId) {
      queryParams.contractId = ensurePrefix(args.contractId, 'ctr_');
    }
    if (args.groupId) {
      queryParams.groupId = ensurePrefix(args.groupId, 'grp_');
    }

    const response = await client.request({
      path: '/papi/v1/cpcodes',
      method: 'GET',
      queryParams,
    });

    const validatedResponse = validateApiResponse<{ cpcodes?: { items?: any[] } }>(response);
    if (!validatedResponse.cpcodes?.items || validatedResponse.cpcodes.items.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: 'No CP Codes found in your account.\n\n[INFO] **Tip:** CP Codes are automatically created when you create properties, or you can create them manually for specific reporting needs.',
          },
        ],
      };
    }

    let text = `# CP Codes (${validatedResponse.cpcodes.items.length} found)\n\n`;
    text +=
      'CP Codes are used for traffic reporting, billing analysis, and content categorization.\n\n';

    // Group by contract for better organization
    const byContract = validatedResponse.cpcodes.items.reduce((acc: any, cpcode: any) => {
      const contract = cpcode.contractIds?.[0] || 'Unknown';
      if (!acc[contract]) {
        acc[contract] = [];
      }
      acc[contract].push(cpcode);
      return acc;
    }, {});

    for (const [contractId, cpcodes] of Object.entries(byContract)) {
      text += `## ${formatContractDisplay(contractId)}\n\n`;

      // Sort by CP Code ID
      const sortedCpcodes = (cpcodes as any[]).sort(
        (a, b) =>
          parseInt(a.cpcodeId.replace('cpc_', '')) - parseInt(b.cpcodeId.replace('cpc_', '')),
      );

      text += '| CP Code | Name | Products | Created |\n';
      text += '|---------|------|----------|----------|\n';

      for (const cpcode of sortedCpcodes) {
        const cpcodeNum = formatCPCodeDisplay(cpcode.cpcodeId);
        const name = cpcode.cpcodeName || 'Unnamed';
        const products =
          cpcode.productIds?.map((pid: string) => getProductFriendlyName(pid)).join(', ') || 'None';
        const created = cpcode.createdDate
          ? new Date(cpcode.createdDate).toLocaleDateString()
          : 'Unknown';

        text += `| ${cpcodeNum} | ${name} | ${products} | ${created} |\n`;
      }
      text += '\n';
    }

    // Add usage examples
    text += '## Usage Examples\n\n';
    text += '### View CP Code Details\n';
    text += '`"Get details for CP Code 12345"`\n\n';
    text += '### Create New CP Code\n';
    text +=
      '`"Create CP Code named my-site-content for contract ctr_1-5C13O2 group grp_125952"`\n\n';
    text += '### Use in Property\n';
    text += 'CP Codes are automatically assigned to properties and used for:\n';
    text += '- **Traffic Reporting:** Analyze bandwidth, requests, and cache hit ratios\n';
    text += '- **Billing:** Track usage for cost allocation\n';
    text += '- **Performance Monitoring:** Monitor response times and errors\n';

    return {
      content: [
        {
          type: 'text',
          text,
        },
      ],
    };
  } catch (_error) {
    return formatError('list CP Codes', _error);
  }
}

/**
 * Get details for a specific CP Code
 */
export async function getCPCode(
  client: AkamaiClient,
  args: {
    cpcodeId: string;
    customer?: string;
  },
): Promise<MCPToolResponse> {
  try {
    // Ensure CP Code ID has the right format
    const cpcodeId = args.cpcodeId.startsWith('cpc_') ? args.cpcodeId : `cpc_${args.cpcodeId}`;

    // First get all CP Codes to find the one we want (since the direct GET seems to need query params)
    const response = await client.request({
      path: '/papi/v1/cpcodes',
      method: 'GET',
    });

    const validatedResponse = validateApiResponse<{ cpcodes?: { items?: any[] } }>(response);
    if (!validatedResponse.cpcodes?.items) {
      throw new Error('No CP Codes available');
    }

    // Find the specific CP Code
    const targetCpcode = validatedResponse.cpcodes.items.find(
      (cpcode: any) =>
        cpcode.cpcodeId === cpcodeId ||
        cpcode.cpcodeId === `cpc_${args.cpcodeId}` ||
        cpcode.cpcodeId.replace('cpc_', '') === args.cpcodeId,
    );

    if (!targetCpcode) {
      return {
        content: [
          {
            type: 'text',
            text: `[ERROR] CP Code ${args.cpcodeId} not found.\n\n[INFO] **Tip:** Use \`"List CP Codes"\` to see all available CP Codes in your account.`,
          },
        ],
      };
    }

    const cpcode = targetCpcode;

    let text = `# CP Code Details: ${formatCPCodeDisplay(cpcode.cpcodeId, cpcode.cpcodeName)}\n\n`;

    // Basic Information
    text += '## Basic Information\n';
    text += `- **CP Code ID:** ${formatCPCodeDisplay(cpcode.cpcodeId)}\n`;
    text += `- **Raw ID:** ${cpcode.cpcodeId}\n`;
    text += `- **Name:** ${cpcode.cpcodeName || 'Unnamed'}\n`;
    text += `- **Created:** ${cpcode.createdDate ? new Date(cpcode.createdDate).toLocaleDateString() : 'Unknown'}\n`;
    text += `- **Time Zone:** ${cpcode.timeZone || 'Not specified'}\n\n`;

    // Contract and Group Information
    text += '## Contract & Group Information\n';
    if (cpcode.contractIds?.length > 0) {
      const contractDisplays = cpcode.contractIds.map((cid: string) => formatContractDisplay(cid));
      text += `- **Contracts:** ${contractDisplays.join(', ')}\n`;
    }
    if (cpcode.groupIds?.length > 0) {
      const groupDisplays = cpcode.groupIds.map((gid: string) => formatGroupDisplay(gid));
      text += `- **Groups:** ${groupDisplays.join(', ')}\n`;
    }
    if (cpcode.productIds?.length > 0) {
      text += `- **Products:** ${cpcode.productIds.map((pid: string) => formatProductDisplay(pid)).join(', ')}\n`;
    }
    text += '\n';

    // Usage Information
    text += '## Usage & Applications\n';
    text += 'This CP Code can be used for:\n';
    text += '- **Property Configuration:** Assign to properties for traffic categorization\n';
    text += '- **Reporting:** Track bandwidth, requests, and performance metrics\n';
    text += '- **Billing Analysis:** Monitor usage for cost allocation\n';
    text += '- **Performance Monitoring:** Analyze cache hit ratios and response times\n\n';

    // Integration Examples
    text += '## Integration Examples\n\n';
    text += '### Assign to Property Rule\n';
    text += '```json\n';
    text += '{\n';
    text += '  "name": "cpCode",\n';
    text += '  "options": {\n';
    text += '    "value": {\n';
    text += `      "id": ${cpcode.cpcodeId.replace('cpc_', '')},\n`;
    text += `      "name": "${cpcode.cpcodeName || 'CP Code'}"\n`;
    text += '    }\n';
    text += '  }\n';
    text += '}\n';
    text += '```\n\n';

    text += '### Use in Property Creation\n';
    text += `\`"Create property with CP Code ${cpcode.cpcodeId.replace('cpc_', '')}"\`\n\n`;

    text += '### Reporting APIs\n';
    text += 'Use this CP Code in Akamai reporting APIs for:\n';
    text += '- Traffic Analytics\n';
    text += '- Bandwidth Reports\n';
    text += '- Cache Performance Analysis\n';

    return {
      content: [
        {
          type: 'text',
          text,
        },
      ],
    };
  } catch (_error) {
    return formatError('get CP Code details', _error);
  }
}

/**
 * Create a new CP Code
 */
export async function createCPCode(
  client: AkamaiClient,
  args: {
    cpcodeName: string;
    contractId: string;
    groupId: string;
    productId?: string;
    timeZone?: string;
    customer?: string;
  },
): Promise<MCPToolResponse> {
  try {
    // Ensure prefixes are added if missing
    if (args.contractId) {
      args.contractId = ensurePrefix(args.contractId, 'ctr_');
    }
    if (args.groupId) {
      args.groupId = ensurePrefix(args.groupId, 'grp_');
    }

    // Validate required parameters
    const validationErrors: string[] = [];

    if (!args.cpcodeName || args.cpcodeName.trim().length === 0) {
      validationErrors.push('CP Code name is required');
    } else if (args.cpcodeName.length > 100) {
      validationErrors.push('CP Code name must be 100 characters or less');
    }

    if (!args.contractId) {
      validationErrors.push('Contract ID is required');
    }

    if (!args.groupId) {
      validationErrors.push('Group ID is required');
    }

    if (validationErrors.length > 0) {
      return {
        content: [
          {
            type: 'text',
            text: `[ERROR] Cannot create CP Code - validation errors:\n\n${validationErrors.map((e) => `- ${e}`).join('\n')}\n\n[INFO] **Tip:** Use \`"List groups"\` to find valid contract and group IDs.`,
          },
        ],
      };
    }

    // Auto-select product if not provided
    let productId = args.productId;
    if (!productId) {
      try {
        const productsResponse = await client.request({
          path: '/papi/v1/products',
          method: 'GET',
          queryParams: {
            contractId: args.contractId,
          },
        });

        const validatedProductsResponse = validateApiResponse<{ products?: { items?: any[] } }>(productsResponse);
        if (validatedProductsResponse.products?.items?.length && validatedProductsResponse.products.items.length > 0) {
          const bestProduct = selectBestProduct(validatedProductsResponse.products.items);
          if (bestProduct) {
            productId = bestProduct.productId;
          }
        }
      } catch (_productError) {
        // Ignore error and use default
      }

      // Fallback to Ion if no product could be selected
      if (!productId) {
        productId = 'prd_fresca';
      }
    }

    // Create the CP Code
    const response = await client.request({
      path: '/papi/v1/cpcodes',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'PAPI-Use-Prefixes': 'true',
      },
      queryParams: {
        contractId: args.contractId,
        groupId: args.groupId,
      },
      body: {
        cpcodeName: args.cpcodeName.trim(),
        productId: productId,
        timeZone: args.timeZone || 'GMT',
      },
    });

    const validatedResponse = validateApiResponse<{ cpcodeLink?: string }>(response);
    if (!validatedResponse.cpcodeLink) {
      throw new Error('CP Code creation failed - no CP Code link returned');
    }

    // Extract CP Code ID from the link
    const cpcodeId = validatedResponse.cpcodeLink.split('/').pop()?.split('?')[0];
    const numericId = cpcodeId?.replace('cpc_', '');

    // Format success response
    let text = '[DONE] **CP Code Created Successfully!**\n\n';

    text += '## CP Code Details\n';
    text += `- **Name:** ${args.cpcodeName}\n`;
    text += `- **CP Code ID:** ${formatCPCodeDisplay(cpcodeId, args.cpcodeName)}\n`;
    text += `- **Raw ID:** ${cpcodeId}\n`;
    text += `- **Product:** ${formatProductDisplay(productId)}\n`;
    text += `- **Contract:** ${formatContractDisplay(args.contractId)}\n`;
    text += `- **Group:** ${formatGroupDisplay(args.groupId)}\n`;
    text += `- **Time Zone:** ${args.timeZone || 'GMT'}\n`;
    text += '- **Status:** [EMOJI] NEW (Ready for use)\n\n';

    text += '## Next Steps\n\n';
    text += '### 1. Assign to Property\n';
    text += "Add this CP Code to a property's rule tree:\n";
    text += `\`"Update property rules to use CP Code ${numericId}"\`\n\n`;

    text += '### 2. Use in New Property\n';
    text += 'Create a new property with this CP Code:\n';
    text += `\`"Create property with CP Code ${numericId}"\`\n\n`;

    text += '### 3. Monitor Usage\n';
    text += 'Check CP Code details and usage:\n';
    text += `\`"Get details for CP Code ${numericId}"\`\n\n`;

    text += '## Rule Tree Configuration\n';
    text += 'Use this configuration in property rules:\n';
    text += '```json\n';
    text += '{\n';
    text += '  "name": "cpCode",\n';
    text += '  "options": {\n';
    text += '    "value": {\n';
    text += `      "id": ${numericId},\n`;
    text += `      "name": "${args.cpcodeName}"\n`;
    text += '    }\n';
    text += '  }\n';
    text += '}\n';
    text += '```\n\n';

    text += '## Reporting Benefits\n';
    text += 'With this CP Code, you can now:\n';
    text += '- **Track Traffic:** Monitor bandwidth and request volumes\n';
    text += '- **Analyze Performance:** Measure cache hit ratios and response times\n';
    text += '- **Cost Management:** Allocate usage costs to specific content or applications\n';
    text += '- **Troubleshooting:** Isolate issues to specific content categories\n';

    return {
      content: [
        {
          type: 'text',
          text,
        },
      ],
    };
  } catch (_error) {
    return formatError('create CP Code', _error);
  }
}

/**
 * Search CP Codes by name or ID
 */
export async function searchCPCodes(
  client: AkamaiClient,
  args: {
    searchTerm: string;
    contractId?: string;
    groupId?: string;
    customer?: string;
  },
): Promise<MCPToolResponse> {
  try {
    const queryParams: any = {};

    if (args.contractId) {
      queryParams.contractId = ensurePrefix(args.contractId, 'ctr_');
    }
    if (args.groupId) {
      queryParams.groupId = ensurePrefix(args.groupId, 'grp_');
    }

    const response = await client.request({
      path: '/papi/v1/cpcodes',
      method: 'GET',
      queryParams,
    });

    const validatedResponse = validateApiResponse<{ cpcodes?: { items?: any[] } }>(response);
    if (!validatedResponse.cpcodes?.items || validatedResponse.cpcodes.items.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: 'No CP Codes found to search.\n\n[INFO] **Tip:** Create a CP Code first or check your contract/group permissions.',
          },
        ],
      };
    }

    // Search by name or ID
    const searchTerm = args.searchTerm.toLowerCase();
    const matchingCpcodes = validatedResponse.cpcodes.items.filter((cpcode: any) => {
      const name = (cpcode.cpcodeName || '').toLowerCase();
      const id = cpcode.cpcodeId.replace('cpc_', '');
      return name.includes(searchTerm) || id.includes(searchTerm);
    });

    if (matchingCpcodes.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `No CP Codes found matching "${args.searchTerm}".\n\n**Search Tips:**\n- Try partial names or IDs\n- Search is case-insensitive\n- Use \`"List CP Codes"\` to see all available CP Codes`,
          },
        ],
      };
    }

    let text = '# CP Code Search Results\n\n';
    text += `Found ${matchingCpcodes.length} CP Code(s) matching "${args.searchTerm}":\n\n`;

    text += '| CP Code | Name | Products | Created |\n';
    text += '|---------|------|----------|----------|\n';

    for (const cpcode of matchingCpcodes) {
      const cpcodeNum = cpcode.cpcodeId.replace('cpc_', '');
      const name = cpcode.cpcodeName || 'Unnamed';
      const products = cpcode.productIds?.join(', ') || 'None';
      const created = cpcode.createdDate
        ? new Date(cpcode.createdDate).toLocaleDateString()
        : 'Unknown';

      text += `| ${cpcodeNum} | ${name} | ${products} | ${created} |\n`;
    }
    text += '\n';

    if (matchingCpcodes.length === 1) {
      const cpcode = matchingCpcodes[0];
      const cpcodeNum = cpcode.cpcodeId.replace('cpc_', '');
      text += '## Quick Actions\n';
      text += `- View details: \`"Get details for CP Code ${cpcodeNum}"\`\n`;
      text += `- Use in property: \`"Update property rules to use CP Code ${cpcodeNum}"\`\n`;
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
    return formatError('search CP Codes', _error);
  }
}

/**
 * Format error responses with helpful guidance
 */
function formatError(operation: string, _error: any): MCPToolResponse {
  let errorMessage = `[ERROR] Failed to ${operation}`;
  let solution = '';

  if (_error instanceof Error) {
    errorMessage += `: ${_error.message}`;

    // Provide specific solutions based on error type
    if (_error.message.includes('401') || _error.message.includes('credentials')) {
      solution =
        '**Solution:** Check your ~/.edgerc file has valid credentials for CP Code management.';
    } else if (_error.message.includes('403') || _error.message.includes('Forbidden')) {
      solution =
        '**Solution:** Your API credentials may lack the necessary permissions for CP Code operations.';
    } else if (_error.message.includes('404') || _error.message.includes('not found')) {
      solution =
        '**Solution:** The CP Code was not found. Use "List CP Codes" to see available CP Codes.';
    } else if (_error.message.includes('400') || _error.message.includes('Bad Request')) {
      solution =
        '**Solution:** Invalid request parameters. Check the CP Code name and contract/group IDs.';
    } else if (_error.message.includes('409') || _error.message.includes('Conflict')) {
      solution = '**Solution:** A CP Code with this name may already exist in this contract/group.';
    }
  } else {
    errorMessage += `: ${String(_error)}`;
  }

  let text = errorMessage;
  if (solution) {
    text += `\n\n${solution}`;
  }

  // Add general help
  text += '\n\n**Need Help?**\n';
  text += '- List available CP Codes: `"List CP Codes"`\n';
  text += '- Check groups and contracts: `"List groups"`\n';
  text += '- CP Code documentation: https://techdocs.akamai.com/property-mgr/reference/cp-codes';

  return {
    content: [
      {
        type: 'text',
        text,
      },
    ],
  };
}
