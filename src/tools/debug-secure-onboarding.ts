/**
 * Debug version of Secure by Default Property Onboarding
 * This version provides detailed error information and step-by-step feedback
 */

import { selectBestProduct, formatProductDisplay } from '../utils/product-mapping';

import { type AkamaiClient } from '../akamai-client';
import { type MCPToolResponse } from '../types';
import { validateApiResponse } from '../utils/api-response-validator';

import { createProperty } from './property-tools';

/**
 * Debug version of secure property onboarding with detailed error reporting
 */
export async function debugSecurePropertyOnboarding(
  client: AkamaiClient,
  args: {
    propertyName: string;
    hostnames: string[];
    originHostname: string;
    contractId: string;
    groupId: string;
    productId?: string;
    customer?: string;
  },
): Promise<MCPToolResponse> {
  let text = '# [SEARCH] Debug: Secure Property Onboarding\n\n';
  text += `**Target:** ${args.propertyName}\n`;
  text += `**Hostnames:** ${args.hostnames.join(', ')}\n`;
  text += `**Origin:** ${args.originHostname}\n`;
  text += `**Contract:** ${args.contractId}\n`;
  text += `**Group:** ${args.groupId}\n\n`;

  try {
    // Step 1: Validate inputs
    text += '## Step 1: Input Validation\n';
    const validationErrors: string[] = [];

    if (!args.propertyName || args.propertyName.trim().length === 0) {
      validationErrors.push('Property name is required');
    }
    if (!args.hostnames || args.hostnames.length === 0) {
      validationErrors.push('At least one hostname is required');
    }
    if (!args.originHostname || args.originHostname.trim().length === 0) {
      validationErrors.push('Origin hostname is required');
    }
    if (!args.contractId?.startsWith('ctr_')) {
      validationErrors.push('Valid contract ID is required (should start with ctr_)');
    }
    if (!args.groupId?.startsWith('grp_')) {
      validationErrors.push('Valid group ID is required (should start with grp_)');
    }

    if (validationErrors.length > 0) {
      text += '[ERROR] **Validation Failed:**\n';
      validationErrors.forEach((_error) => {
        text += `- ${_error}\n`;
      });
      text += '\n';

      return {
        content: [
          {
            type: 'text',
            text,
          },
        ],
      };
    }

    text += '[DONE] **Input validation passed**\n\n';

    // Step 2: Test API connectivity
    text += '## Step 2: API Connectivity Test\n';
    try {
      const groupsResponse = await client.request({
        path: '/papi/v1/groups',
        method: 'GET',
      });

      const validatedGroupsResponse = validateApiResponse<{ groups?: { items?: any[] } }>(groupsResponse);
      if (validatedGroupsResponse.groups?.items) {
        text += `[DONE] **API connectivity working** (found ${validatedGroupsResponse.groups.items.length} groups)\n`;

        // Verify the specified group exists
        const targetGroup = validatedGroupsResponse.groups.items.find(
          (g: any) => g.groupId === args.groupId,
        );
        if (targetGroup) {
          text += `[DONE] **Target group found:** ${targetGroup.groupName}\n`;
        } else {
          text += `[ERROR] **Target group ${args.groupId} not found**\n`;
          text += 'Available groups:\n';
          validatedGroupsResponse.groups.items.slice(0, 5).forEach((g: any) => {
            text += `- ${g.groupId}: ${g.groupName}\n`;
          });
          text += '\n';
        }
      } else {
        text += '[ERROR] **API connectivity issue** - unexpected response format\n';
      }
    } catch (apiError: any) {
      text += `[ERROR] **API connectivity failed:** ${apiError.message}\n`;
      text += '\n';

      return {
        content: [
          {
            type: 'text',
            text,
          },
        ],
      };
    }
    text += '\n';

    // Step 3: Product selection
    text += '## Step 3: Product Selection\n';
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
            text += `[DONE] **Auto-selected product:** ${formatProductDisplay(bestProduct.productId, bestProduct.productName)}\n`;
          } else {
            productId = 'prd_fresca';
            text += '[WARNING] **Using default product:** Ion (prd_fresca)\n';
          }
        } else {
          productId = 'prd_fresca';
          text += '[WARNING] **No products found, using default:** Ion (prd_fresca)\n';
        }
      } catch (_productError: any) {
        productId = 'prd_fresca';
        text += '[WARNING] **Product lookup failed, using default:** Ion (prd_fresca)\n';
        text += `Error: ${_productError.message}\n`;
      }
    } else {
      text += `[DONE] **Using specified product:** ${formatProductDisplay(productId)}\n`;
    }
    text += '\n';

    // Step 4: Create property
    text += '## Step 4: Property Creation\n';
    let propertyId: string | null = null;

    try {
      const createPropResult = await createProperty(client, {
        propertyName: args.propertyName,
        productId: productId,
        contractId: args.contractId,
        groupId: args.groupId,
      });

      if (createPropResult.content[0]?.text.includes('[DONE]')) {
        // Extract property ID from response
        const propMatch = createPropResult.content[0].text.match(/Property ID:\*\* (\w+)/);
        if (propMatch?.[1]) {
          propertyId = propMatch[1];
          text += `[DONE] **Property created successfully:** ${propertyId}\n`;
        } else {
          text += '[WARNING] **Property created but ID extraction failed**\n';
          text += `Response: ${createPropResult.content[0].text.substring(0, 200)}...\n`;
        }
      } else {
        text += '[ERROR] **Property creation failed**\n';
        text += `Response: ${createPropResult.content[0]?.text || 'No response'}\n`;

        return {
          content: [
            {
              type: 'text',
              text,
            },
          ],
        };
      }
    } catch (propError: any) {
      text += `[ERROR] **Property creation exception:** ${propError.message}\n`;

      return {
        content: [
          {
            type: 'text',
            text,
          },
        ],
      };
    }
    text += '\n';

    // Step 5: Test edge hostname creation (simplified)
    text += '## Step 5: Edge Hostname Creation Test\n';
    if (propertyId) {
      try {
        // First, get property details
        const propertyResponse = await client.request({
          path: `/papi/v1/properties/${propertyId}`,
          method: 'GET',
        });

        const validatedPropertyResponse = validateApiResponse<{ properties?: { items?: any[] } }>(propertyResponse);
        if (!validatedPropertyResponse.properties?.items?.[0]) {
          text += `[ERROR] **Cannot retrieve property details for ${propertyId}**\n`;
        } else {
          const property = validatedPropertyResponse.properties.items[0];
          text += '[DONE] **Property details retrieved**\n';
          text += `- Contract: ${property.contractId}\n`;
          text += `- Group: ${property.groupId}\n`;
          text += `- Product: ${formatProductDisplay(property.productId)}\n`;

          // Generate edge hostname prefix
          const edgeHostnamePrefix = args.propertyName.toLowerCase().replace(/[^a-z0-9-]/g, '-');
          text += `- Edge hostname prefix: ${edgeHostnamePrefix}\n`;

          // Test edge hostname creation with minimal parameters
          try {
            const edgeResponse = await client.request({
              path: `/papi/v1/edgehostnames?contractId=${property.contractId}&groupId=${property.groupId}`,
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: {
                productId: property.productId,
                domainPrefix: edgeHostnamePrefix,
                domainSuffix: '.edgekey.net',
                secure: true,
                ipVersionBehavior: 'IPV4_IPV6',
              },
            });

            const validatedEdgeResponse = validateApiResponse<{ edgeHostnameLink?: string }>(edgeResponse);
            if (validatedEdgeResponse.edgeHostnameLink) {
              const edgeHostnameId = validatedEdgeResponse.edgeHostnameLink.split('/').pop();
              const edgeHostnameDomain = `${edgeHostnamePrefix}.edgekey.net`;
              text += `[DONE] **Edge hostname created:** ${edgeHostnameDomain}\n`;
              text += `- ID: ${edgeHostnameId}\n`;
            } else {
              text += '[ERROR] **Edge hostname creation failed** - no link returned\n';
              text += `Response: ${JSON.stringify(edgeResponse, null, 2)}\n`;
            }
          } catch (edgeError: any) {
            text += `[ERROR] **Edge hostname creation exception:** ${edgeError.message}\n`;
            if (edgeError.response?.data) {
              text += `API Response: ${JSON.stringify(edgeError.response.data, null, 2)}\n`;
            }
          }
        }
      } catch (propDetailError: any) {
        text += `[ERROR] **Property detail retrieval failed:** ${propDetailError.message}\n`;
      }
    } else {
      text += '[EMOJI]️ **Skipped - no property ID available**\n';
    }
    text += '\n';

    // Summary
    text += '## Summary\n';
    if (propertyId) {
      text += '[DONE] **Property creation successful**\n';
      text += '\n';
      text += '**Next steps to complete manually:**\n';
      text += `1. Create edge hostname: \`"Create edge hostname for property ${propertyId} with prefix ${args.propertyName.toLowerCase().replace(/[^a-z0-9-]/g, '-')}"\`\n`;
      text += '2. Configure property rules\n';
      text += '3. Add hostnames to property\n';
      text += '4. Activate to staging\n';
    } else {
      text += '[ERROR] **Property creation failed** - cannot proceed with automation\n';
    }

    return {
      content: [
        {
          type: 'text',
          text,
        },
      ],
    };
  } catch (_error: any) {
    text += '\n## [ERROR] Unexpected Error\n';
    text += `**Message:** ${_error.message}\n`;
    text += `**Stack:** ${_error.stack}\n`;

    return {
      content: [
        {
          type: 'text',
          text,
        },
      ],
    };
  }
}

/**
 * Simple test for basic API connectivity and property creation
 */
export async function testBasicPropertyCreation(
  client: AkamaiClient,
  args: {
    propertyName: string;
    contractId: string;
    groupId: string;
    customer?: string;
  },
): Promise<MCPToolResponse> {
  try {
    let text = '# [TEST] Basic Property Creation Test\n\n';

    // Test 1: API connectivity
    text += '## Test 1: API Connectivity\n';
    try {
      const response = await client.request({
        path: '/papi/v1/groups',
        method: 'GET',
      });
      const validatedResponse = validateApiResponse<{ groups?: { items?: any[] } }>(response);
      text += `[DONE] API accessible (found ${validatedResponse.groups?.items?.length || 0} groups)\n\n`;
    } catch (apiError: any) {
      text += `[ERROR] API not accessible: ${apiError.message}\n\n`;
      return {
        content: [
          {
            type: 'text',
            text,
          },
        ],
      };
    }

    // Test 2: Product selection
    text += '## Test 2: Product Selection\n';
    let productId = 'prd_fresca'; // Default to Ion
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
          text += `[DONE] Selected product: ${formatProductDisplay(bestProduct.productId, bestProduct.productName)}\n\n`;
        } else {
          text += '[WARNING] Using default product: Ion (prd_fresca)\n\n';
        }
      }
    } catch (_productError: any) {
      text += '[WARNING] Product lookup failed, using default: Ion (prd_fresca)\n\n';
    }

    // Test 3: Property creation
    text += '## Test 3: Property Creation\n';
    const result = await createProperty(client, {
      propertyName: args.propertyName,
      productId: productId,
      contractId: args.contractId,
      groupId: args.groupId,
    });

    text += '**Result:**\n';
    const validatedResult = validateApiResponse<{ content: any }>(result);
    text += validatedResult.content[0]?.text || 'No response';

    return {
      content: [
        {
          type: 'text',
          text,
        },
      ],
    };
  } catch (_error: any) {
    return {
      content: [
        {
          type: 'text',
          text: `[ERROR] Test failed: ${_error.message}`,
        },
      ],
    };
  }
}
