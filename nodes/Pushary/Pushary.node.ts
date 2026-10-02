import {
  NodeConnectionTypes,
  NodeOperationError,
  type IDataObject,
  type IExecuteFunctions,
  type INodeExecutionData,
  type INodeType,
  type INodeTypeDescription,
} from 'n8n-workflow'

// Pushary n8n node. Operations over the Pushary REST API:
//   - Send Notification  -> POST /send       (fire-and-forget alert)
//   - Ask for Approval   -> POST /ask        (pause for a human decision)
//   - Get Answer         -> GET /ask/:id     (read the existing decision)
// "Ask" with "Wait for Answer" blocks the workflow until the person answers on
// their phone, the web page, or Slack, then returns { answered, value }. With
// waiting off it returns a correlationId immediately, for callback-driven flows.

export class Pushary implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Pushary',
    name: 'pushary',
    icon: { light: 'file:pushary.svg', dark: 'file:pushary.dark.svg' },
    usableAsTool: true,
    group: ['transform'],
    version: 1,
    subtitle: '={{$parameter["operation"]}}',
    description: 'Send notifications, ask operator questions, and request durable customer decisions',
    defaults: {
      name: 'Pushary',
    },
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    credentials: [
      {
        name: 'pusharyApi',
        required: true,
        displayOptions: { show: { resource: ['notification'] } },
      },
      { name: 'pusharyDecisionApi', required: true, displayOptions: { show: { resource: ['decision'] } } },
    ],
    properties: [
      {
        displayName: 'Resource', name: 'resource', type: 'options', noDataExpression: true,
        options: [{ name: 'Decision', value: 'decision' }, { name: 'Notification', value: 'notification' }],
        default: 'notification',
      },
      { displayName: 'Operation', name: 'operation', type: 'options', noDataExpression: true, displayOptions: { show: { resource: ['decision'] } }, default: 'create', options: [
        { name: 'Cancel', value: 'cancel', action: 'Cancel a decision', description: 'Cancel an existing decision' },
        { name: 'Check Approval', value: 'check', action: 'Check approval', description: 'Verify approval against the original trusted action' },
        { name: 'Create', value: 'create', action: 'Create a decision', description: 'Request customer approval without blocking execution' },
      ] },
      { displayName: 'Decision ID', name: 'decisionId', type: 'string', default: '', required: true, displayOptions: { show: { resource: ['decision'], operation: ['check', 'cancel'] } }, description: 'ID returned by Create; preserve it while waiting' },
      { displayName: 'Operation ID', name: 'operationId', type: 'string', default: '', required: true, displayOptions: { show: { resource: ['decision'], operation: ['create', 'check'] } }, description: 'Trusted unique business operation and version. Reuse on retries; change when the action changes. Do not generate with AI.' },
      { displayName: 'Action', name: 'action', type: 'json', default: '{"name":"publish_draft","draftId":"draft-123","version":1}', required: true, displayOptions: { show: { resource: ['decision'], operation: ['create', 'check'] } }, description: 'Exact trusted action snapshot, with flat string, number or boolean values. Check against the saved original and execute those same values. No secrets.' },
      { displayName: 'Question', name: 'question', type: 'string', default: 'Approve this action?', required: true, displayOptions: { show: { resource: ['decision'], operation: ['create'] } } },
      { displayName: 'Expires In (Seconds)', name: 'expiresInSeconds', type: 'number', default: 3600, typeOptions: { minValue: 60, maxValue: 86400 }, displayOptions: { show: { resource: ['decision'], operation: ['create'] } }, description: 'Decision lifetime; expiration never grants approval' },
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['notification'] } },
        options: [
          { name: 'Get Answer', value: 'getAnswer', description: 'Read an existing approval without asking again', action: 'Get an approval answer' },
          {
            name: 'Ask for Approval',
            value: 'ask',
            description: 'Ask a person a question and optionally wait for the answer',
            action: 'Ask a person for approval',
          },
          {
            name: 'Send Notification',
            value: 'sendNotification',
            description: 'Send a fire-and-forget push notification',
            action: 'Send a push notification',
          },
        ],
        default: 'ask',
      },

      {
        displayName: 'Correlation ID', name: 'correlationId', type: 'string',
        default: '', required: true,
        displayOptions: { show: { resource: ['notification'], operation: ['getAnswer'] } },
        description: 'The correlationId returned by Ask for Approval',
      },
      // ── Send Notification ──
      {
        displayName: 'Title',
        name: 'title',
        type: 'string',
        default: '',
        required: true,
        displayOptions: { show: { resource: ['notification'], operation: ['sendNotification'] } },
        description: 'Notification title',
      },
      {
        displayName: 'Body',
        name: 'body',
        type: 'string',
        default: '',
        required: true,
        displayOptions: { show: { resource: ['notification'], operation: ['sendNotification'] } },
        description: 'Notification body text',
      },
      {
        displayName: 'Link URL',
        name: 'url',
        type: 'string',
        default: '',
        displayOptions: { show: { resource: ['notification'], operation: ['sendNotification'] } },
        description: 'Optional URL opened when the notification is tapped',
      },

      // ── Ask for Approval ──
      {
        displayName: 'Question',
        name: 'question',
        type: 'string',
        default: '',
        required: true,
        typeOptions: { rows: 2 },
        displayOptions: { show: { resource: ['notification'], operation: ['ask'] } },
        description: 'What to ask the person',
      },
      {
        displayName: 'Question Type',
        name: 'questionType',
        type: 'options',
        options: [
          { name: 'Confirm (Yes / No)', value: 'confirm' },
          { name: 'Select (Pick an Option)', value: 'select' },
          { name: 'Input (Free Text)', value: 'input' },
        ],
        default: 'confirm',
        displayOptions: { show: { resource: ['notification'], operation: ['ask'] } },
      },
      {
        displayName: 'Options',
        name: 'options',
        type: 'string',
        default: '',
        placeholder: 'main, develop, staging',
        displayOptions: { show: { resource: ['notification'], operation: ['ask'], questionType: ['select'] } },
        description: 'Comma-separated choices (2 to 6) for a select question',
      },
      {
        displayName: 'Agent Name',
        name: 'agentName',
        type: 'string',
        default: '',
        placeholder: 'Marketing workflow',
        displayOptions: { show: { resource: ['notification'], operation: ['ask'] } },
        description: 'Shown in the notification and the dashboard so you know which workflow is asking',
      },
      {
        displayName: 'Wait for Answer',
        name: 'waitForAnswer',
        type: 'boolean',
        default: true,
        displayOptions: { show: { resource: ['notification'], operation: ['ask'] } },
        description: 'Whether to block this node until the person answers, then output their decision',
      },
      {
        displayName: 'Timeout (Seconds)',
        name: 'timeoutSeconds',
        type: 'number',
        default: 50,
        typeOptions: { minValue: 1, maxValue: 55 },
        displayOptions: { show: { resource: ['notification'], operation: ['ask'], waitForAnswer: [true] } },
        description: 'How long to wait for an answer (max 55). Use Get Answer with the returned correlation ID to keep waiting without asking again.',
      },
      {
        displayName: 'Callback URL',
        name: 'callbackUrl',
        type: 'string',
        default: '',
        displayOptions: { show: { resource: ['notification'], operation: ['ask'], waitForAnswer: [false] } },
        description: 'Optional HTTPS webhook Pushary POSTs the answer to when the person responds (signed with X-Pushary-Signature). Point an n8n Wait-for-webhook node here.',
      },
    ],
  }

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const resource = this.getNodeParameter('resource', 0, 'notification')
    if (resource === 'decision') return executeDecision.call(this)
    if (resource !== 'notification') throw new NodeOperationError(this.getNode(), 'Unknown resource')
    const items = this.getInputData()
    const returnData: INodeExecutionData[] = []

    const credentials = await this.getCredentials('pusharyApi')
    const baseUrl = String(credentials.baseUrl || 'https://pushary.com/api/v1/server').replace(/\/$/, '')

    for (let i = 0; i < items.length; i++) {
      try {
        const operation = this.getNodeParameter('operation', i) as string

        if (operation === 'getAnswer') {
          const id = this.getNodeParameter('correlationId', i) as string
          const response = await this.helpers.httpRequestWithAuthentication.call(this, 'pusharyApi', {
            method: 'GET', url: `${baseUrl}/ask/${encodeURIComponent(id)}`, json: true, timeout: 30_000,
          })
          returnData.push({ json: response as IDataObject, pairedItem: { item: i } })
          continue
        }

        if (operation === 'sendNotification') {
          const body: IDataObject = {
            title: this.getNodeParameter('title', i) as string,
            body: this.getNodeParameter('body', i) as string,
          }
          const url = this.getNodeParameter('url', i, '') as string
          if (url) body.url = url

          const response = await this.helpers.httpRequestWithAuthentication.call(this, 'pusharyApi', {
            method: 'POST',
            url: `${baseUrl}/send`,
            body,
            json: true,
          })
          returnData.push({ json: response as IDataObject, pairedItem: { item: i } })
          continue
        }

        if (operation !== 'ask') throw new NodeOperationError(this.getNode(), 'Unknown operation')
        const questionType = this.getNodeParameter('questionType', i) as string
        const waitForAnswer = this.getNodeParameter('waitForAnswer', i) as boolean

        const body: IDataObject = {
          question: this.getNodeParameter('question', i) as string,
          type: questionType,
          wait: waitForAnswer,
        }

        const agentName = this.getNodeParameter('agentName', i, '') as string
        if (agentName) body.agentName = agentName

        if (questionType === 'select') {
          const raw = this.getNodeParameter('options', i, '') as string
          const options = raw
            .split(',')
            .map((o) => o.trim())
            .filter((o) => o.length > 0)
          body.options = options
        }

        let timeoutMs = 30_000
        if (waitForAnswer) {
          const timeoutSeconds = this.getNodeParameter('timeoutSeconds', i, 50) as number
          body.timeoutSeconds = timeoutSeconds
          // Give the HTTP call headroom past the server-side wait so it does not
          // cut off the response.
          timeoutMs = Math.min(timeoutSeconds, 55) * 1000 + 5_000
        } else {
          const callbackUrl = this.getNodeParameter('callbackUrl', i, '') as string
          if (callbackUrl) body.callbackUrl = callbackUrl
        }

        const response = await this.helpers.httpRequestWithAuthentication.call(this, 'pusharyApi', {
          method: 'POST',
          url: `${baseUrl}/ask`,
          body,
          json: true,
          timeout: timeoutMs,
        })
        returnData.push({ json: response as IDataObject, pairedItem: { item: i } })
      } catch (error) {
        if (this.continueOnFail()) {
          returnData.push({
            json: { error: (error as Error).message },
            pairedItem: { item: i },
          })
          continue
        }
        throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i })
      }
    }

    return [returnData]
  }
}

export async function executeDecision(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
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
