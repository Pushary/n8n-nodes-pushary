const { test } = require('node:test')
const assert = require('node:assert/strict')
const { Pushary } = require('../dist/nodes/Pushary/Pushary.node.js')

test('polling reads the existing question without creating another approval', async () => {
  const requests = []
  const context = {
    getInputData: () => [{}], getCredentials: async () => ({ baseUrl: 'https://pushary.com/api/v1/server/' }),
    getNodeParameter: (name) => ({ operation: 'getAnswer', correlationId: 'question/1' })[name],
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
    getNodeParameter: (name) => ({ operation: 'getAnswer', correlationId: 'missing' })[name],
    getNode: () => ({ name: 'Pushary', type: 'pushary', typeVersion: 1, position: [0, 0], parameters: {} }),
    helpers: { httpRequestWithAuthentication: async () => { throw new Error('upstream unavailable') } },
    continueOnFail: () => false,
  }
  await assert.rejects(Pushary.prototype.execute.call(context), { name: 'NodeOperationError', message: 'upstream unavailable' })
})

const { PusharyDecision } = require('../dist/nodes/Pushary/PusharyDecision.node.js')

test('durable decisions bind approval to the recipient and unchanged action, and fail closed', async () => {
  const params = { operation: 'create', operationId: 'draft-123:v1', action: '{"version":1,"draftId":"draft-123"}', question: 'Publish draft?', expiresInSeconds: 3600, decisionId: 'decision/1' }
  const requests = []
  let response = { decisionId: 'decision/1', status: 'pending', answered: false }
  let fail = false
  const context = {
    getInputData: () => [{}], getCredentials: async () => ({ externalId: 'customer-1' }),
    getNodeParameter: name => params[name],
    getNode: () => ({ name: 'Decision', type: 'pusharyDecision', typeVersion: 1, position: [0, 0], parameters: {} }),
    helpers: { httpRequestWithAuthentication: async (credential, request) => {
      assert.equal(credential, 'pusharyDecisionApi'); requests.push(request)
      if (fail) throw new Error('upstream unavailable')
      return response
    } }, continueOnFail: () => false,
  }
  const run = async () => (await PusharyDecision.prototype.execute.call(context))[0][0].json
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
