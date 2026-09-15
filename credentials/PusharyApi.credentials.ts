import type {
  IAuthenticateGeneric,
  ICredentialTestRequest,
  ICredentialType,
  INodeProperties,
  Icon,
} from 'n8n-workflow'

export class PusharyApi implements ICredentialType {
  name = 'pusharyApi'

  displayName = 'Pushary API'

  icon: Icon = { light: 'file:../nodes/Pushary/pushary.svg', dark: 'file:../nodes/Pushary/pushary.dark.svg' }

  documentationUrl = 'https://pushary.com/docs/agents/connect-any-agent'

  properties: INodeProperties[] = [
    {
      displayName: 'API Key',
      name: 'apiKey',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      required: true,
      description: 'Your Pushary API key. Create one under Agent → Settings → API keys. Looks like pk_xxx.sk_xxx.',
    },
    {
      displayName: 'Base URL',
      name: 'baseUrl',
      type: 'string',
      default: 'https://pushary.com/api/v1/server',
      description: 'Only change this when testing against a trusted development endpoint.',
    },
  ]

  // Inject the bearer token on every request the node makes.
  authenticate: IAuthenticateGeneric = {
    type: 'generic',
    properties: {
      headers: {
        Authorization: '=Bearer {{$credentials.apiKey}}',
      },
    },
  }

  // "Test" button: a cheap authenticated GET that 200s only with a valid key.
  test: ICredentialTestRequest = {
    request: {
      baseURL: '={{$credentials.baseUrl}}',
      url: '/site',
    },
  }
}
