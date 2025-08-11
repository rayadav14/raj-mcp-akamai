/**
 * CPS and EdgeDNS Integration
 * Automatically creates ACME validation records in EdgeDNS
 */

import { ProgressBar, Spinner } from '../utils/progress';
import { validateApiResponse } from '../utils/api-response-validator';

import { type AkamaiClient } from '../akamai-client';
import { type MCPToolResponse } from '../types';

import { getDVValidationChallenges } from './cps-tools';
import { upsertRecord } from './dns-tools';

interface ACMERecord {
  domain: string;
  zone: string;
  recordName: string;
  recordValue: string;
}

/**
 * Automatically create ACME validation records in EdgeDNS
 */
export async function createACMEValidationRecords(
  client: AkamaiClient,
  args: {
    enrollmentId: number;
    customer?: string;
    autoDetectZones?: boolean;
  },
): Promise<MCPToolResponse> {
  const spinner = new Spinner();
  spinner.start('Fetching certificate validation requirements...');

  try {
    // Get validation challenges
    const challengesResponse = await getDVValidationChallenges(client, {
      enrollmentId: args.enrollmentId,
    });

    spinner.stop();

    // Check if there's an error in the response
    const responseText = Array.isArray(challengesResponse.content)
      ? challengesResponse.content[0]?.text || ''
      : '';

    if (responseText.includes('[ERROR]') || responseText.includes('Error')) {
      return challengesResponse;
    }

    // Parse DNS records from the response
    const content = Array.isArray(challengesResponse.content)
      ? challengesResponse.content[0]?.text || ''
      : challengesResponse.content || '';

    const records = parseACMERecords(content);

    if (records.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: '[DONE] No DNS validation records needed - certificate may already be validated!',
          },
        ],
      };
    }

    console.log(`\n[EMOJI] Found ${records.length} ACME validation records to create`);

    // Create records
    const progressBar = new ProgressBar({ total: records.length });
    progressBar.update({ current: 0, message: 'Creating ACME validation records' });

    const results = {
      successful: 0,
      failed: 0,
      errors: [] as Array<{ record: string; error: string }>,
    };

    for (const record of records) {
      try {
        // Try to create the record
        await upsertRecord(client, {
          zone: record.zone,
          name: record.recordName,
          type: 'TXT',
          ttl: 300,
          rdata: [record.recordValue],
          comment: `ACME validation for certificate enrollment ${args.enrollmentId}`,
        });

        results.successful++;
      } catch (_error) {
        // Try with the parent domain if subdomain fails
        if (args.autoDetectZones && record.zone.includes('.')) {
          try {
            const parentZone = record.zone.split('.').slice(1).join('.');
            await upsertRecord(client, {
              zone: parentZone,
              name: record.recordName,
              type: 'TXT',
              ttl: 300,
              rdata: [record.recordValue],
              comment: `ACME validation for certificate enrollment ${args.enrollmentId}`,
            });
            results.successful++;
          } catch (retryError) {
            results.failed++;
            results.errors.push({
              record: record.recordName,
              error: retryError instanceof Error ? retryError.message : 'Unknown _error',
            });
          }
        } else {
          results.failed++;
          results.errors.push({
            record: record.recordName,
            error: _error instanceof Error ? _error.message : 'Unknown error',
          });
        }
      }

      progressBar.increment();
    }

    progressBar.finish('ACME validation records processed');

    // Generate report
    let report = '# [EMOJI] ACME DNS Validation Records Created\n\n';
    report += '## Summary\n';
    report += `- **Enrollment ID**: ${args.enrollmentId}\n`;
    report += `- **Total Records**: ${records.length}\n`;
    report += `- **Successfully Created**: ${results.successful}\n`;
    report += `- **Failed**: ${results.failed}\n\n`;

    if (results.successful > 0) {
      report += '## [DONE] Created Records\n\n';
      report += 'The following ACME validation records were created:\n\n';

      for (const record of records) {
        if (!results.errors.find((e) => e.record === record.recordName)) {
          report += `- **${record.recordName}** in zone ${record.zone}\n`;
        }
      }
      report += '\n';
    }

    if (results.errors.length > 0) {
      report += '## [ERROR] Failed Records\n\n';
      results.errors.forEach((err) => {
        report += `- **${err.record}**: ${err.error}\n`;
      });
      report += '\n';
    }

    report += '## [EMOJI] Next Steps\n\n';
    report += '1. **Wait for DNS propagation** (usually 5-15 minutes)\n';
    report += `2. **Check validation status**: "Check DV enrollment status ${args.enrollmentId}"\n`;
    report += '3. **Certificate deployment** will begin automatically after validation\n\n';

    report += '## [EMOJI] Cleanup\n\n';
    report += 'After the certificate is issued, you can safely remove these TXT records.\n';
    report += 'They are only needed for initial validation.\n';

    return {
      content: [
        {
          type: 'text',
          text: report,
        },
      ],
    };
  } catch (_error) {
    spinner.stop();
    return {
      content: [
        {
          type: 'text',
          text: `[ERROR] Failed to create ACME validation records: ${_error instanceof Error ? _error.message : 'Unknown _error'}`,
        },
      ],
    };
  }
}

/**
 * Parse ACME records from validation challenges response
 */
function parseACMERecords(content: string): ACMERecord[] {
  const records: ACMERecord[] = [];
  const lines = content.split('\n');

  let currentDomain = '';
  let inDNSChallenge = false;
  let recordName = '';
  let recordValue = '';

  for (const line of lines) {
    // Detect domain sections
    const domainMatch = line.match(/###\s+\[(DONE|ERROR|EMOJI)\]\s+(.+)/u);
    if (domainMatch && domainMatch[2]) {
      currentDomain = domainMatch[2];
      continue;
    }

    // Detect DNS challenge section
    if (line.includes('DNS Challenge')) {
      inDNSChallenge = true;
      continue;
    }

    // Parse record details
    if (inDNSChallenge) {
      const nameMatch = line.match(/Record Name:\s+`([^`]+)`/);
      if (nameMatch && nameMatch[1]) {
        recordName = nameMatch[1];
      }

      const valueMatch = line.match(/Record Value:\s+`([^`]+)`/);
      if (valueMatch && valueMatch[1]) {
        recordValue = valueMatch[1];

        // We have both name and value, create record
        if (recordName && recordValue && currentDomain) {
          // Determine zone from domain
          const zone = currentDomain.includes('.') ? currentDomain : currentDomain + '.com'; // Fallback

          records.push({
            domain: currentDomain,
            zone,
            recordName: recordName.replace(/\.$/, ''), // Remove trailing dot
            recordValue,
          });

          // Reset for next record
          inDNSChallenge = false;
          recordName = '';
          recordValue = '';
        }
      }
    }

    // Exit DNS challenge section on empty line or new section
    if (inDNSChallenge && (line.trim() === '' || line.startsWith('-'))) {
      inDNSChallenge = false;
    }
  }

  return records;
}

/**
 * Monitor certificate validation progress
 */
export async function monitorCertificateValidation(
  client: AkamaiClient,
  args: {
    enrollmentId: number;
    customer?: string;
    maxWaitMinutes?: number;
    checkIntervalSeconds?: number;
  },
): Promise<MCPToolResponse> {
  const maxWait = (args.maxWaitMinutes || 30) * 60 * 1000; // Convert to milliseconds
  const checkInterval = (args.checkIntervalSeconds || 30) * 1000;
  const startTime = Date.now();

  console.log(`\n[SEARCH] Monitoring certificate validation for enrollment ${args.enrollmentId}`);
  console.log(
    `[EMOJI]️  Will check every ${args.checkIntervalSeconds || 30} seconds for up to ${args.maxWaitMinutes || 30} minutes\n`,
  );

  const spinner = new Spinner();

  while (Date.now() - startTime < maxWait) {
    spinner.start('Checking validation status...');

    try {
      // Check enrollment status
      const response = await client.request({
        method: 'GET',
        path: `/cps/v2/enrollments/${args.enrollmentId}`,
      });

      const validatedResponse = validateApiResponse<{ data: any }>(response);
      const enrollment = validatedResponse.data;
      spinner.stop();

      // Check if all domains are validated
      const allValidated = enrollment.allowedDomains.every(
        (domain: any) => domain.validationStatus === 'VALIDATED',
      );

      const pendingDomains = enrollment.allowedDomains.filter(
        (domain: any) =>
          domain.validationStatus === 'PENDING' || domain.validationStatus === 'IN_PROGRESS',
      );

      const errorDomains = enrollment.allowedDomains.filter(
        (domain: any) => domain.validationStatus === 'ERROR',
      );

      // Display current status
      console.log(`\n[METRICS] Validation Status at ${new Date().toLocaleTimeString()}`);
      console.log(`${'─'.repeat(50)}`);

      enrollment.allowedDomains.forEach((domain: any) => {
        const statusMap: Record<string, string> = {
          VALIDATED: '[DONE]',
          PENDING: '[EMOJI]',
          IN_PROGRESS: '[EMOJI]',
          ERROR: '[ERROR]',
          EXPIRED: '[WARNING]',
        };
        const emoji = statusMap[domain.validationStatus] || '[EMOJI]';

        console.log(`${emoji} ${domain.name}: ${domain.validationStatus}`);
      });

      if (errorDomains.length > 0) {
        console.log(`\n[ERROR] Validation failed for ${errorDomains.length} domain(s)`);
        return {
          content: [
            {
              type: 'text',
              text: 'Certificate validation failed. Please check the validation challenges and try again.',
            },
          ],
        };
      }

      if (allValidated) {
        console.log('\n[DONE] All domains validated successfully!');
        console.log('[DEPLOY] Certificate deployment will begin automatically.');

        return {
          content: [
            {
              type: 'text',
              text: `# [DONE] Certificate Validation Complete!\n\nAll domains have been successfully validated. Certificate deployment is now in progress.\n\n**Next steps:**\n1. Wait for deployment (typically 30-60 minutes)\n2. Check status: "Check DV enrollment status ${args.enrollmentId}"\n3. Link to property once active`,
            },
          ],
        };
      }

      // Show progress
      const elapsedMinutes = Math.floor((Date.now() - startTime) / 60000);
      console.log(`\n[EMOJI] Waiting for validation... (${elapsedMinutes} minutes elapsed)`);
      console.log(`   ${pendingDomains.length} domain(s) still pending validation`);

      // Wait before next check
      await new Promise((resolve) => setTimeout(resolve, checkInterval));
    } catch (_error) {
      spinner.stop();
      console.error(
        `\n[ERROR] Error checking validation status: ${_error instanceof Error ? _error.message : 'Unknown _error'}`,
      );
      await new Promise((resolve) => setTimeout(resolve, checkInterval));
    }
  }

  return {
    content: [
      {
        type: 'text',
        text: `[EMOJI]️ Validation monitoring timed out after ${args.maxWaitMinutes || 30} minutes. Please check the status manually: "Check DV enrollment status ${args.enrollmentId}"`,
      },
    ],
  };
}
