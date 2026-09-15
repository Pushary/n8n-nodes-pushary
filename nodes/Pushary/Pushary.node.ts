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
    description: 'Send push notifications and pause for human approval from your phone or Slack',
    defaults: {
      name: 'Pushary',
    },
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    credentials: [
      {
        name: 'pusharyApi',
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
        displayOptions: { show: { operation: ['getAnswer'] } },
        description: 'The correlationId returned by Ask for Approval',
      },
      // ── Send Notification ──
      {
        displayName: 'Title',
        name: 'title',
        type: 'string',
        default: '',
        required: true,
        displayOptions: { show: { operation: ['sendNotification'] } },
        description: 'Notification title',
      },
      {
        displayName: 'Body',
        name: 'body',
        type: 'string',
        default: '',
        required: true,
        displayOptions: { show: { operation: ['sendNotification'] } },
        description: 'Notification body text',
      },
      {
        displayName: 'Link URL',
        name: 'url',
        type: 'string',
        default: '',
        displayOptions: { show: { operation: ['sendNotification'] } },
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
        displayOptions: { show: { operation: ['ask'] } },
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
        displayOptions: { show: { operation: ['ask'] } },
      },
      {
        displayName: 'Options',
        name: 'options',
        type: 'string',
        default: '',
        placeholder: 'main, develop, staging',
        displayOptions: { show: { operation: ['ask'], questionType: ['select'] } },
        description: 'Comma-separated choices (2 to 6) for a select question',
      },
      {
        displayName: 'Agent Name',
        name: 'agentName',
        type: 'string',
        default: '',
        placeholder: 'Marketing workflow',
        displayOptions: { show: { operation: ['ask'] } },
        description: 'Shown in the notification and the dashboard so you know which workflow is asking',
      },
      {
        displayName: 'Wait for Answer',
        name: 'waitForAnswer',
        type: 'boolean',
        default: true,
        displayOptions: { show: { operation: ['ask'] } },
        description: 'Whether to block this node until the person answers, then output their decision',
      },
      {
        displayName: 'Timeout (Seconds)',
        name: 'timeoutSeconds',
        type: 'number',
        default: 50,
        typeOptions: { minValue: 1, maxValue: 55 },
        displayOptions: { show: { operation: ['ask'], waitForAnswer: [true] } },
        description: 'How long to wait for an answer (max 55). Use Get Answer with the returned correlation ID to keep waiting without asking again.',
      },
      {
        displayName: 'Callback URL',
        name: 'callbackUrl',
        type: 'string',
        default: '',
        displayOptions: { show: { operation: ['ask'], waitForAnswer: [false] } },
        description: 'Optional HTTPS webhook Pushary POSTs the answer to when the person responds (signed with X-Pushary-Signature). Point an n8n Wait-for-webhook node here.',
      },
    ],
  }

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
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

        // operation === 'ask'
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
