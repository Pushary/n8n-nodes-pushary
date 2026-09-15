import { NodeConnectionTypes, NodeOperationError, type IDataObject, type IExecuteFunctions, type INodeExecutionData, type INodeType, type INodeTypeDescription } from 'n8n-workflow'

export class PusharyDecision implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Pushary Decision', name: 'pusharyDecision',
    icon: { light: 'file:pushary.svg', dark: 'file:pushary.dark.svg' },
    usableAsTool: true, group: ['transform'], version: 1,
    subtitle: '={{$parameter["operation"]}}',
    description: 'Request and verify durable customer approval for an action',
    defaults: { name: 'Pushary Decision' },
    inputs: [NodeConnectionTypes.Main], outputs: [NodeConnectionTypes.Main],
    credentials: [{ name: 'pusharyDecisionApi', required: true }],
    properties: [
      { displayName: 'Operation', name: 'operation', type: 'options', noDataExpression: true, default: 'create', options: [
        { name: 'Cancel', value: 'cancel', action: 'Cancel a decision', description: 'Cancel an existing decision' },
        { name: 'Check Approval', value: 'check', action: 'Check approval', description: 'Verify approval against the original trusted action' },
        { name: 'Create', value: 'create', action: 'Create a decision', description: 'Request customer approval without blocking execution' },
      ] },
      { displayName: 'Decision ID', name: 'decisionId', type: 'string', default: '', required: true, displayOptions: { show: { operation: ['check', 'cancel'] } }, description: 'ID returned by Create; preserve it while waiting' },
      { displayName: 'Operation ID', name: 'operationId', type: 'string', default: '', required: true, displayOptions: { show: { operation: ['create', 'check'] } }, description: 'Trusted unique business operation and version. Reuse on retries; change when the action changes. Do not generate with AI.' },
      { displayName: 'Action', name: 'action', type: 'json', default: '{"name":"publish_draft","draftId":"draft-123","version":1}', required: true, displayOptions: { show: { operation: ['create', 'check'] } }, description: 'Exact trusted action snapshot, with flat string, number or boolean values. Check against the saved original and execute those same values. No secrets.' },
      { displayName: 'Question', name: 'question', type: 'string', default: 'Approve this action?', required: true, displayOptions: { show: { operation: ['create'] } } },
      { displayName: 'Expires In (Seconds)', name: 'expiresInSeconds', type: 'number', default: 3600, typeOptions: { minValue: 60, maxValue: 86400 }, displayOptions: { show: { operation: ['create'] } }, description: 'Decision lifetime; expiration never grants approval' },
    ],
  }

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const credentials = await this.getCredentials('pusharyDecisionApi')
    const externalId = String(credentials.externalId || '').trim()
    const baseUrl = String(credentials.baseUrl || 'https://pushary.com/api/v1/server').replace(/\/$/, '')
    const output: INodeExecutionData[] = []
    for (let i = 0; i < this.getInputData().length; i++) {
      try {
        if (!externalId) throw new NodeOperationError(this.getNode(), 'Configure a trusted customer external ID in the credential')
        const operation = this.getNodeParameter('operation', i) as string
        if (!['create', 'check', 'cancel'].includes(operation)) throw new NodeOperationError(this.getNode(), 'Unknown operation')
        let context = ''
        let operationId = ''
        let action: IDataObject = {}
        if (operation !== 'cancel') {
          operationId = String(this.getNodeParameter('operationId', i)).trim()
          if (!operationId || operationId.length > 512) throw new NodeOperationError(this.getNode(), 'Operation ID must contain 1–512 characters')
          const raw = this.getNodeParameter('action', i)
          const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
          if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new NodeOperationError(this.getNode(), 'Action must be a flat JSON object')
          const keys = Object.keys(parsed).sort()
          if (!keys.length || keys.length > 32) throw new NodeOperationError(this.getNode(), 'Action must contain 1–32 fields')
          action = Object.fromEntries(keys.map(key => {
            const value = parsed[key]
            if (!key || key.length > 64 || !(
              (typeof value === 'string' && value.length <= 200) ||
              (typeof value === 'number' && Number.isFinite(value)) || typeof value === 'boolean'
            )) throw new NodeOperationError(this.getNode(), 'Action fields must have names up to 64 characters and scalar values; strings up to 200 characters')
            return [key, value]
          }))
          context = JSON.stringify({ operationId, externalId, action })
          if (context.length > 2000) throw new NodeOperationError(this.getNode(), 'Action snapshot exceeds the 2000-character context limit')
        }
        const decisionId = operation === 'create' ? '' : String(this.getNodeParameter('decisionId', i)).trim()
        if (operation !== 'create' && !decisionId) throw new NodeOperationError(this.getNode(), 'Decision ID is required')
        let body: IDataObject | undefined
        if (operation === 'create') {
          const expiresInSeconds = Number(this.getNodeParameter('expiresInSeconds', i))
          if (!Number.isInteger(expiresInSeconds) || expiresInSeconds < 60 || expiresInSeconds > 86400) throw new NodeOperationError(this.getNode(), 'Expiration must be 60–86400 seconds')
          body = { question: this.getNodeParameter('question', i) as string, type: 'confirm', externalId, context,
            parameters: action, idempotencyKey: operationId, expiresInSeconds, wait: false, requireReachable: true }
        }
        const response = await this.helpers.httpRequestWithAuthentication.call(this, 'pusharyDecisionApi', {
          method: operation === 'create' ? 'POST' : operation === 'cancel' ? 'DELETE' : 'GET',
          url: `${baseUrl}/decisions${decisionId ? `/${encodeURIComponent(decisionId)}` : ''}`,
          ...(body ? { body } : {}), json: true, timeout: 30_000,
        }) as IDataObject
        if (!response || typeof response !== 'object' || typeof response.decisionId !== 'string' ||
          !['pending', 'answered', 'expired', 'cancelled'].includes(String(response.status))) throw new NodeOperationError(this.getNode(), 'Invalid decision response')
        if (operation !== 'create' && response.decisionId !== decisionId) throw new NodeOperationError(this.getNode(), 'Decision ID mismatch')
        if (operation === 'check' && (response.context !== context || response.externalId !== externalId)) throw new NodeOperationError(this.getNode(), 'Decision does not match the trusted customer and action snapshot')
        const approved = operation === 'check' && response.status === 'answered' && response.answered === true && response.type === 'confirm' && response.value === 'yes'
        output.push({ json: { ...response, approved, ...(operation !== 'cancel' ? { operationId, action } : {}) }, pairedItem: { item: i } })
      } catch (error) {
        if (!this.continueOnFail()) throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i })
        output.push({ json: { error: (error as Error).message, approved: false }, pairedItem: { item: i } })
      }
    }
    return [output]
  }
}
