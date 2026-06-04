import type {
  IAuthenticateGeneric,
  ICredentialTestRequest,
  ICredentialType,
  INodeProperties,
} from 'n8n-workflow';

/**
 * Credentials for the self-hosted Automation Backend.
 *
 * - baseUrl:       root URL of the backend (e.g. https://automation.example.com)
 * - apiKey:        sent as the `x-api-key` header on every request
 * - webhookSecret: OPTIONAL — the same value as the backend's WEBHOOK_SECRET.
 *                  Used by the Trigger node to verify the HMAC `X-Signature`
 *                  header on incoming webhooks. Leave empty to skip verification.
 */
export class AutomationBackendApi implements ICredentialType {
  name = 'automationBackendApi';

  displayName = 'Automation Backend API';

  documentationUrl = 'https://github.com/Saeedkhoshafsar/plyr';

  properties: INodeProperties[] = [
    {
      displayName: 'Base URL',
      name: 'baseUrl',
      type: 'string',
      default: 'http://localhost:3000',
      placeholder: 'https://automation.example.com',
      description: 'Root URL of your Automation Backend instance (no trailing slash needed)',
      required: true,
    },
    {
      displayName: 'API Key',
      name: 'apiKey',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      description: 'API key sent as the x-api-key header',
      required: true,
    },
    {
      displayName: 'Webhook Secret',
      name: 'webhookSecret',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      description:
        'Optional. Same value as the backend WEBHOOK_SECRET. When set, the Trigger node verifies the X-Signature (HMAC-SHA256) header on incoming webhooks.',
    },
  ];

  // Inject the API key header into every authenticated request the nodes make.
  authenticate: IAuthenticateGeneric = {
    type: 'generic',
    properties: {
      headers: {
        'x-api-key': '={{$credentials.apiKey}}',
      },
    },
  };

  // "Test" button in the n8n credential UI -> GET /me must return 200.
  test: ICredentialTestRequest = {
    request: {
      baseURL: '={{$credentials.baseUrl}}',
      url: '/me',
      method: 'GET',
    },
  };
}
