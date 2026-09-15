import type { ICredentialType } from 'n8n-workflow'
import { PusharyApi } from './PusharyApi.credentials'

export class PusharyDecisionApi extends PusharyApi implements ICredentialType {
  icon = new PusharyApi().icon
  documentationUrl = 'https://github.com/Pushary/n8n-nodes-pushary#credentials'
  test = new PusharyApi().test
  name = 'pusharyDecisionApi'
  displayName = 'Pushary Decision API'
  properties = [...new PusharyApi().properties, {
    displayName: 'Customer External ID',
    name: 'externalId',
    type: 'string' as const,
    default: '',
    required: true,
    description: 'Trusted customer identifier. Use a Partner API key bound to this recipient. Never let the model choose the recipient.',
  }]
}
