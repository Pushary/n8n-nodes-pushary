const { test } = require('node:test')
const assert = require('node:assert/strict')
const { NodeHelpers } = require('n8n-workflow')
const { Pushary } = require('../dist/nodes/Pushary/Pushary.node.js')

test('polling reads the existing question without creating another approval', async () => {
  const requests = []
  const context = {
    getInputData: () => [{}], getCredentials: async () => ({ baseUrl: 'https://pushary.com/api/v1/server/' }),
    getNodeParameter: (name, _item, fallback) => ({ operation: 'getAnswer', correlationId: 'question/1' })[name] ?? fallback,
    helpers: { httpRequestWithAuthentication: async (_credential, request) => { requests.push(request); return { answered: false } } },
    continueOnFail: () => false,
  }
  const result = await Pushary.prototype.execute.call(context)
  assert.equal(result[0][0].json.answered, false)
  assert.equal(requests[0].method, 'GET')
  assert.equal(requests[0].url, 'https://pushary.com/api/v1/server/ask/question%2F1')
  assert.equal(requests.length, 1)
})

test('API failures become n8n errors and never return approval', async () => {
  const context = {
    getInputData: () => [{}], getCredentials: async () => ({}),
    getNodeParameter: (name, _item, fallback) => ({ operation: 'getAnswer', correlationId: 'missing' })[name] ?? fallback,
    getNode: () => ({ name: 'Pushary', type: 'pushary', typeVersion: 1, position: [0, 0], parameters: {} }),
    helpers: { httpRequestWithAuthentication: async () => { throw new Error('upstream unavailable') } },
    continueOnFail: () => false,
  }
  await assert.rejects(Pushary.prototype.execute.call(context), { name: 'NodeOperationError', message: 'upstream unavailable' })
})

test('durable decisions bind approval to the recipient and unchanged action, and fail closed', async () => {
  const params = { resource: 'decision', operation: 'create', operationId: 'draft-123:v1', action: '{"version":1,"draftId":"draft-123"}', question: 'Publish draft?', expiresInSeconds: 3600, decisionId: 'decision/1' }
  const requests = []
  let response = { decisionId: 'decision/1', status: 'pending', answered: false }
  let fail = false
  const context = {
    getInputData: () => [{}], getCredentials: async () => ({ externalId: 'customer-1' }),
    getNodeParameter: name => params[name],
    getNode: () => ({ name: 'Decision', type: 'pushary', typeVersion: 1, position: [0, 0], parameters: {} }),
    helpers: { httpRequestWithAuthentication: async (credential, request) => {
      assert.equal(credential, 'pusharyDecisionApi'); requests.push(request)
      if (fail) throw new Error('upstream unavailable')
      return response
    } }, continueOnFail: () => false,
  }
  const run = async () => (await Pushary.prototype.execute.call(context))[0][0].json
  assert.equal((await run()).approved, false)
  await run()
  assert.deepEqual(requests[0].body, requests[1].body)
  assert.equal(requests[0].body.idempotencyKey, params.operationId)
  assert.equal(requests[0].body.wait, false)
  const snapshot = requests[0].body.context
  params.operation = 'check'
  const valid = { decisionId: params.decisionId, externalId: 'customer-1', context: snapshot, type: 'confirm', status: 'answered', answered: true, value: 'yes' }
  response = valid
  assert.equal((await run()).approved, true)
  assert.equal(requests.at(-1).url, 'https://pushary.com/api/v1/server/decisions/decision%2F1')
  for (const change of [{ status: 'pending' }, { status: 'expired' }, { status: 'cancelled' }, { value: 'no' }, { answered: false }, { type: 'select' }, { type: 'input' }]) {
    response = { ...valid, ...change }; assert.equal((await run()).approved, false)
  }
  for (const change of [{ context: 'changed' }, { externalId: 'other' }, { externalId: null }, { decisionId: 'other' }, { status: 'unknown' }]) {
    response = { ...valid, ...change }; await assert.rejects(run)
  }
  response = valid
  params.action = '{"version":2,"draftId":"draft-123"}'
  await assert.rejects(run, /snapshot/)
  params.action = '{"nested":{"value":1}}'
  await assert.rejects(run, /scalar/)
  params.action = '{"version":1,"draftId":"draft-123"}'
  fail = true
  await assert.rejects(run, /unavailable/)
  context.continueOnFail = () => true
  assert.equal((await run()).approved, false)
  fail = false
  params.operation = 'cancel'
  response = { decisionId: params.decisionId, status: 'cancelled', cancelled: true }
  assert.equal((await run()).approved, false)
  assert.equal(requests.at(-1).method, 'DELETE')
})

test('registered nodes preserve legacy decisions and scope operations and credentials to each resource', () => {
  const manifest = require('../package.json')
  assert.deepEqual(manifest.n8n.nodes, ['dist/nodes/Pushary/Pushary.node.js', 'dist/nodes/Pushary/PusharyDecision.node.js'])
  const { description } = new Pushary()
  const legacy = NodeHelpers.getNodeParameters(description.properties, { operation: 'getAnswer', correlationId: 'q1' }, true, false)
  assert.equal(legacy.resource, 'notification')
  assert.equal(legacy.operation, 'getAnswer')
  const decision = NodeHelpers.getNodeParameters(description.properties, { resource: 'decision' }, true, false)
  assert.equal(decision.operation, 'create')
  const resource = description.properties.find(property => property.name === 'resource')
  assert.equal(resource.default, 'notification')
  assert.deepEqual(resource.options.map(option => option.value), ['decision', 'notification'])
  for (const value of ['decision', 'notification']) {
    const properties = description.properties.filter(property => property.displayOptions?.show?.resource?.includes(value))
    assert.equal(properties.filter(property => property.name === 'operation').length, 1)
    assert.equal(properties.filter(property => property.name === 'question').length, 1)
    const credentials = description.credentials.filter(credential => credential.displayOptions.show.resource.includes(value))
    assert.deepEqual(credentials.map(credential => credential.name), [value === 'decision' ? 'pusharyDecisionApi' : 'pusharyApi'])
  }
  const workflow = require('../examples/customer-approval.json')
  const pusharyNodes = workflow.nodes.filter(node => node.type.startsWith('n8n-nodes-pushary.'))
  assert.equal(pusharyNodes.length, 2)
  for (const node of pusharyNodes) {
    assert.equal(node.type, 'n8n-nodes-pushary.pushary')
    assert.equal(node.parameters.resource, 'decision')
  }
})

test('notification resource sends alerts and asks operator questions using its own credential', async () => {
  const params = { resource: 'notification', operation: 'sendNotification', title: 'Done', body: 'Workflow finished',
    question: 'Proceed?', questionType: 'confirm', waitForAnswer: false }
  const requests = []
  const context = {
    getInputData: () => [{}, {}],
    getCredentials: async name => { assert.equal(name, 'pusharyApi'); return {} },
    getNodeParameter: (name, _item, fallback) => params[name] ?? fallback,
    helpers: { httpRequestWithAuthentication: async (credential, request) => {
      assert.equal(credential, 'pusharyApi')
      requests.push(request)
      return { answered: false }
    } },
    continueOnFail: () => false,
  }
  const alerts = (await Pushary.prototype.execute.call(context))[0]
  assert.equal(alerts.length, 2)
  assert.deepEqual(alerts.map(item => item.pairedItem), [{ item: 0 }, { item: 1 }])
  assert.equal(requests[0].url, 'https://pushary.com/api/v1/server/send')
  assert.deepEqual(requests[0].body, { title: 'Done', body: 'Workflow finished' })
  params.operation = 'ask'
  await Pushary.prototype.execute.call(context)
  assert.equal(requests.at(-1).url, 'https://pushary.com/api/v1/server/ask')
  assert.deepEqual(requests.at(-1).body, { question: 'Proceed?', type: 'confirm', wait: false })
})

test('unsupported resources and notification operations never send a request', async () => {
  const params = { resource: 'unknown', operation: 'unknown' }
  const context = {
    getInputData: () => [{}], getCredentials: async () => ({}),
    getNodeParameter: name => params[name],
    getNode: () => ({ name: 'Pushary', type: 'pushary', typeVersion: 1, position: [0, 0], parameters: {} }),
    helpers: { httpRequestWithAuthentication: async () => assert.fail('No request is allowed') },
    continueOnFail: () => false,
  }
  await assert.rejects(Pushary.prototype.execute.call(context), /Unknown resource/)
  params.resource = 'notification'
  await assert.rejects(Pushary.prototype.execute.call(context), /Unknown operation/)
  context.continueOnFail = () => true
  const output = (await Pushary.prototype.execute.call(context))[0][0]
  assert.deepEqual(output, { json: { error: 'Unknown operation' }, pairedItem: { item: 0 } })
})


test('serialized legacy approval checks resume with original credentials and fail closed', async () => {
  const { PusharyDecision } = require('../dist/nodes/Pushary/PusharyDecision.node.js')
  const { description } = new PusharyDecision()
  const saved = JSON.parse(JSON.stringify({ name: 'Approve Publish', type: 'n8n-nodes-pushary.pusharyDecision',
    typeVersion: 1, position: [0, 0], credentials: { pusharyDecisionApi: { id: 'customer', name: 'Customer' } },
    parameters: { operation: 'check', operationId: 'draft:v1', decisionId: 'saved/decision', action: '{"version":1}' } }))
  const params = NodeHelpers.getNodeParameters(description.properties, saved.parameters, true, false)
  assert.equal(description.name, saved.type.split('.').at(-1))
  assert.equal(description.hidden, true)
  assert.equal(params.resource, undefined)
  assert.deepEqual(params, saved.parameters)
  let response = { decisionId: 'saved/decision', externalId: 'customer',
    context: '{"operationId":"draft:v1","externalId":"customer","action":{"version":1}}',
    type: 'confirm', status: 'answered', answered: true, value: 'yes' }
  const context = {
    getInputData: () => [{}], getNode: () => saved,
    getCredentials: async credential => { assert.equal(credential, 'pusharyDecisionApi'); return { externalId: 'customer' } },
    getNodeParameter: name => params[name], continueOnFail: () => false,
    helpers: { httpRequestWithAuthentication: async (credential, request) => {
      assert.equal(credential, 'pusharyDecisionApi'); assert.equal(request.method, 'GET')
      assert.equal(request.url, 'https://pushary.com/api/v1/server/decisions/saved%2Fdecision')
      return response
    } },
  }
  const run = async () => (await new PusharyDecision().execute.call(context))[0][0].json
  assert.equal((await run()).approved, true)
  for (const status of ['pending', 'expired', 'cancelled']) {
    response = { ...response, status }; assert.equal((await run()).approved, false)
  }
  response = { ...response, status: 'answered', externalId: 'other' }
  await assert.rejects(run, /recipient|customer/)
})
