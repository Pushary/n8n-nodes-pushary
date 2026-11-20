const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { test } = require('node:test')
const { runInNewContext } = require('node:vm')

const workflow = (name) => JSON.parse(readFileSync(join(__dirname, '..', 'examples', `${name}.json`), 'utf8'))
const node = (flow, name) => flow.nodes.find((entry) => entry.name === name)
const runExpression = (expression, context) => runInNewContext(expression.slice(3, -2).trim(), context)

test('field-service workflow holds the draft for every result except an answered confirm yes', () => {
  const flow = workflow('field-estimate-review')
  const asJson = node(flow, 'Record Estimate Decision').parameters.jsonOutput
  const source = (name) => {
    assert.equal(name, 'Sample Estimate')
    return { first: () => ({ json: { estimateId: 'DEMO-42', version: 1 } }) }
  }
  for (const [result, expected] of [
    [{ status: 'answered', answered: true, value: 'yes', type: 'confirm' }, 'ready_for_owner'],
    [{ status: 'answered', answered: true, value: 'no', type: 'confirm' }, 'needs_changes'],
    [{ status: 'answered', answered: true, value: 'yes', type: 'input' }, 'held'],
    [{ status: 'pending', answered: false, value: 'yes', type: 'confirm' }, 'held'],
    [{ status: 'expired', answered: false, type: 'confirm' }, 'held'],
    [{}, 'held'],
  ]) {
    const output = JSON.parse(runExpression(asJson, { $json: result, $: source }))
    assert.equal(output.review, expected)
    assert.equal(output.estimateId, 'DEMO-42')
    assert.equal(output.estimateSent, false)
  }
  assert.equal(flow.active, false)
  assert.deepEqual(flow.nodes.filter((entry) => entry.type === 'n8n-nodes-pushary.pushary').map((entry) => entry.parameters.operation), ['ask', 'getAnswer'])
})

test('Gorgias note describes the checked decision without executing a refund', () => {
  const flow = workflow('gorgias-refund-review')
  const asJson = node(flow, 'Prepare Private Ticket Note').parameters.jsonOutput
  const source = (name) => {
    assert.equal(name, 'Sample Refund Proposal')
    return { first: () => ({ json: { action: { ticketId: 'T-42', orderId: 'DEMO-4471', amountCents: 480, currency: 'USD' } } }) }
  }
  for (const [result, expected] of [
    [{ approved: true, decisionId: 'd-42' }, 'approved'],
    [{ approved: false, status: 'answered', answered: true, value: 'no', type: 'confirm' }, 'denied'],
    [{ approved: false, status: 'pending' }, 'held'],
    [{ approved: false, status: 'expired' }, 'held'],
  ]) {
    const output = JSON.parse(runExpression(asJson, { $json: result, $: source }))
    assert.equal(output.ticketId, 'T-42')
    assert.equal(output.review, expected)
    assert.equal(output.refundExecuted, false)
    assert.match(output.privateNote, /USD 4\.80/)
  }
  assert.equal(flow.active, false)
  assert.deepEqual(flow.nodes.filter((entry) => entry.type === 'n8n-nodes-pushary.pushary').map((entry) => entry.parameters.operation), ['create', 'check'])
  assert.equal(flow.connections['Check Refund Decision'].main[0][0].node, 'Still Pending')
})
