import type {
  IExecuteFunctions,
  IDataObject,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  IHttpRequestMethods,
  IHttpRequestOptions,
} from 'n8n-workflow';
import { NodeOperationError, NodeApiError } from 'n8n-workflow';

// ── Helpers ────────────────────────────────────────────────────────────────

// Strip a trailing slash so we can safely concatenate paths.
function normalizeBase(url: string): string {
  return (url || '').trim().replace(/\/+$/, '');
}

// Parse the `steps` parameter, which may be supplied as JSON text or already an
// array/object (when wired from a previous node). Always returns an array.
function parseSteps(this: IExecuteFunctions, raw: unknown, itemIndex: number): IDataObject[] {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch (err) {
      throw new NodeOperationError(
        this.getNode(),
        `Steps must be valid JSON: ${(err as Error).message}`,
        { itemIndex },
      );
    }
  }
  if (!Array.isArray(value)) {
    throw new NodeOperationError(this.getNode(), 'Steps must be a JSON array', { itemIndex });
  }
  return value as IDataObject[];
}

export class AutomationBackend implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Automation Backend',
    name: 'automationBackend',
    icon: 'file:automationBackend.svg',
    group: ['transform'],
    version: 1,
    subtitle: '={{$parameter["operation"]}}',
    description: 'Run, schedule, and manage browser-automation jobs on a self-hosted Automation Backend',
    defaults: {
      name: 'Automation Backend',
    },
    inputs: ['main'],
    outputs: ['main'],
    credentials: [
      {
        name: 'automationBackendApi',
        required: true,
      },
    ],
    properties: [
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        options: [
          {
            name: 'Run Workflow',
            value: 'run',
            action: 'Run an automation workflow',
            description: 'Submit a steps workflow to POST /run (optionally wait for the result)',
          },
          {
            name: 'Get Job Result',
            value: 'getJob',
            action: 'Get a job result',
            description: 'Fetch a job status / result from GET /job/:userId/:jobId',
          },
          {
            name: 'Create Schedule',
            value: 'schedule',
            action: 'Create a recurring schedule',
            description: 'Create a cron schedule via POST /schedule',
          },
          {
            name: 'Cancel Job',
            value: 'cancel',
            action: 'Cancel a job',
            description: 'Cancel a queued / running job via DELETE /cancel/:userId/:jobId',
          },
        ],
        default: 'run',
      },

      // ── Common: userId ──
      {
        displayName: 'User ID',
        name: 'userId',
        type: 'string',
        default: '',
        required: true,
        description: 'Backend user the job belongs to',
      },

      // ── run / schedule: steps ──
      {
        displayName: 'Steps (JSON)',
        name: 'steps',
        type: 'json',
        default: '[\n  { "action": "goto", "params": { "url": "https://example.com" } }\n]',
        required: true,
        description: 'Array of automation steps ({ action, params }). JSON array.',
        displayOptions: {
          show: { operation: ['run', 'schedule'] },
        },
      },
      {
        displayName: 'Headless',
        name: 'headless',
        type: 'boolean',
        default: true,
        description: 'Whether to run the browser headless',
        displayOptions: {
          show: { operation: ['run', 'schedule'] },
        },
      },
      {
        displayName: 'Webhook URL',
        name: 'webhookUrl',
        type: 'string',
        default: '',
        placeholder: 'https://my-n8n/webhook/automation',
        description: 'Optional URL the backend notifies on completion (e.g. an Automation Backend Trigger node)',
        displayOptions: {
          show: { operation: ['run', 'schedule'] },
        },
      },

      // ── run: sync + idempotency ──
      {
        displayName: 'Wait for Completion',
        name: 'wait',
        type: 'boolean',
        default: false,
        description: 'Whether to block until the job finishes and return its result inline (POST /run?wait=true)',
        displayOptions: {
          show: { operation: ['run'] },
        },
      },
      {
        displayName: 'Idempotency Key',
        name: 'idempotencyKey',
        type: 'string',
        default: '',
        description: 'Optional. Retrying with the same key returns the original job instead of creating a duplicate.',
        displayOptions: {
          show: { operation: ['run'] },
        },
      },

      // ── schedule: cron + name ──
      {
        displayName: 'Cron Expression',
        name: 'cron',
        type: 'string',
        default: '0 9 * * *',
        required: true,
        placeholder: '0 9 * * *',
        description: '5- or 6-field cron expression',
        displayOptions: {
          show: { operation: ['schedule'] },
        },
      },
      {
        displayName: 'Schedule Name',
        name: 'scheduleName',
        type: 'string',
        default: '',
        description: 'Optional human-readable name for the schedule',
        displayOptions: {
          show: { operation: ['schedule'] },
        },
      },

      // ── getJob / cancel: jobId ──
      {
        displayName: 'Job ID',
        name: 'jobId',
        type: 'string',
        default: '',
        required: true,
        description: 'The job identifier returned by Run Workflow',
        displayOptions: {
          show: { operation: ['getJob', 'cancel'] },
        },
      },

      // ── cancel: extra options ──
      {
        displayName: 'Close Browser',
        name: 'closeBrowser',
        type: 'boolean',
        default: false,
        description: 'Whether to force-close the whole browser context',
        displayOptions: {
          show: { operation: ['cancel'] },
        },
      },
      {
        displayName: 'Close Tab',
        name: 'closeTab',
        type: 'boolean',
        default: false,
        description: 'Whether to close only the job tab/page',
        displayOptions: {
          show: { operation: ['cancel'] },
        },
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];

    const credentials = await this.getCredentials('automationBackendApi');
    const baseUrl = normalizeBase(credentials.baseUrl as string);

    for (let i = 0; i < items.length; i++) {
      try {
        const operation = this.getNodeParameter('operation', i) as string;
        const userId = this.getNodeParameter('userId', i) as string;

        let method: IHttpRequestMethods = 'GET';
        let url = baseUrl;
        let body: IDataObject | undefined;
        const headers: IDataObject = {};
        const qs: IDataObject = {};

        if (operation === 'run') {
          method = 'POST';
          url = `${baseUrl}/run`;
          const steps = parseSteps.call(this, this.getNodeParameter('steps', i), i);
          const headless = this.getNodeParameter('headless', i) as boolean;
          const webhookUrl = this.getNodeParameter('webhookUrl', i, '') as string;
          const wait = this.getNodeParameter('wait', i, false) as boolean;
          const idempotencyKey = this.getNodeParameter('idempotencyKey', i, '') as string;

          body = { userId, steps, headless };
          if (webhookUrl) body.webhookUrl = webhookUrl;
          if (wait) qs.wait = 'true';
          if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
        } else if (operation === 'schedule') {
          method = 'POST';
          url = `${baseUrl}/schedule`;
          const steps = parseSteps.call(this, this.getNodeParameter('steps', i), i);
          const headless = this.getNodeParameter('headless', i) as boolean;
          const webhookUrl = this.getNodeParameter('webhookUrl', i, '') as string;
          const cron = this.getNodeParameter('cron', i) as string;
          const scheduleName = this.getNodeParameter('scheduleName', i, '') as string;

          body = { userId, steps, headless, cron };
          if (scheduleName) body.name = scheduleName;
          if (webhookUrl) body.webhookUrl = webhookUrl;
        } else if (operation === 'getJob') {
          method = 'GET';
          const jobId = this.getNodeParameter('jobId', i) as string;
          url = `${baseUrl}/job/${encodeURIComponent(userId)}/${encodeURIComponent(jobId)}`;
        } else if (operation === 'cancel') {
          method = 'DELETE';
          const jobId = this.getNodeParameter('jobId', i) as string;
          url = `${baseUrl}/cancel/${encodeURIComponent(userId)}/${encodeURIComponent(jobId)}`;
          if (this.getNodeParameter('closeBrowser', i, false) as boolean) qs.closeBrowser = 'true';
          if (this.getNodeParameter('closeTab', i, false) as boolean) qs.closeTab = 'true';
        } else {
          throw new NodeOperationError(this.getNode(), `Unknown operation: ${operation}`, {
            itemIndex: i,
          });
        }

        const options: IHttpRequestOptions = {
          method,
          url,
          qs,
          headers,
          json: true,
        };
        if (body !== undefined) options.body = body;

        const response = (await this.helpers.httpRequestWithAuthentication.call(
          this,
          'automationBackendApi',
          options,
        )) as IDataObject;

        returnData.push({
          json: response,
          pairedItem: { item: i },
        });
      } catch (error) {
        if (this.continueOnFail()) {
          returnData.push({
            json: { error: (error as Error).message },
            pairedItem: { item: i },
          });
          continue;
        }
        if (error instanceof NodeOperationError) throw error;
        throw new NodeApiError(this.getNode(), error as IDataObject);
      }
    }

    return [returnData];
  }
}
