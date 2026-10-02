# n8n-nodes-pushary

Customer approval for AI workflows using [Pushary](https://pushary.com/human-in-the-loop-n8n?utm_source=github&utm_medium=oss-adapter&utm_campaign=pushary-n8n&utm_content=guide)'s durable Decisions API. An AI can propose an action; your workflow holds that action until the intended customer approves its exact details.

[Integration guide](https://pushary.com/human-in-the-loop-n8n?utm_source=github&utm_medium=oss-adapter&utm_campaign=pushary-n8n&utm_content=guide) · [Connect your first customer with Partner](https://pushary.com/sign-up?from=agent&plan=partner&utm_source=github&utm_medium=oss-adapter&utm_campaign=pushary-n8n&utm_content=partner-start)

## Install

Version 0.3.0 consolidates all operations into one **Pushary** node with a **Resource** selector: **Notification** or **Decision**.

On self-hosted n8n, open **Settings → Community Nodes → Install** and enter `n8n-nodes-pushary`. This package is not yet a verified node and is not available through the n8n Cloud verified-node catalog. Customer Decisions were introduced in 0.2.0; 0.1.0 only has legacy operator operations.

## Credentials

Create a **Pushary Decision API** credential with a Partner API key and the customer's **External ID**. Prefer a key bound to that same recipient. Keep both values in credentials, outside model-generated arguments. The customer must be enrolled and able to receive decisions. Known unreachable recipients cause creation to fail; unknown delivery state does not grant approval.

Use the default API URL. Only change it for a trusted development endpoint: your API key is sent there. The credential test checks key validity, not customer enrollment or Partner eligibility.

## Decision operations

Add a **Pushary** node and select **Resource → Decision**.

- **Create** requests a confirm decision asynchronously. Supply a trusted **Operation ID**, exact **Action** JSON, question, and expiration (60 seconds to 24 hours). The operation ID is the API idempotency key: retry with the same ID and identical inputs to reuse the decision. Changing the action requires a new operation version. Creation never returns `approved: true`, including replayed approvals.
- **Check Approval** reads the saved Decision ID. Supply the original Operation ID and Action from trusted workflow state. It verifies the saved customer and action snapshot, then returns `approved: true` only for an answered confirm with `value: "yes"`. Pending, denied, expired, cancelled and non-confirm answers are not approvals. Missing or mismatched identity, changed action, malformed response and HTTP errors fail the node. With **Continue On Fail**, errors explicitly return `approved: false`.
- **Cancel** cancels an existing decision. It never grants approval.

Action JSON contains 1–32 flat string, number or boolean fields. Field names are limited to 64 characters, string values to 200, and the complete saved snapshot to 2,000. Include every value that affects the action, including its immutable version. Do not include secrets. Server redaction that changes the snapshot causes verification to fail safely.

## Example: propose, wait, verify, act

Import [customer-approval.json](examples/customer-approval.json), then select your Decision credential on Create and Check. Run manually with an enrolled test customer. The final **Simulated Action** only outputs what would execute; it does not publish, charge, or send anything.

```text
Trusted Action → Create Decision → Check Approval → Approved? → Simulated Action
                                      ↑               ↓ no
                                    Wait ← Still Pending? → Stop
```

Use native Wait between reads, never another Create to poll. The example waits two minutes so n8n can persist the waiting execution. It checks again after resuming and stops on terminal state or its polling deadline. Keep n8n's execution database persistent across restarts.

For an AI workflow, have the model draft a proposal upstream of **Trusted Action**. Your application must validate it, resolve the authorized customer and target, assign the business operation/version, and freeze the exact action. Do not use `$fromAI()` for recipient, operation ID, Decision ID or the expected snapshot. Do not expose the protected action as another ungated AI tool. A prompt saying “ask first” does not enforce approval.

Connect the real action only to the true output of the strict `approved === true` condition. Execute the checked `action` output. The destination must enforce its own idempotency using `operationId`: replaying an approved workflow does not make an external side effect exactly once. If the draft changes, create a new version and request approval again.

Although the node can be used as an AI tool, this workflow composition is the approval boundary. Pushary is not a built-in channel in n8n's Human Review dropdown. The example does not trust webhook payloads and does not expose an API operation that answers on the customer's behalf.

Decision contents appear in n8n execution history. Configure access, retention and pruning for your customer data. Keep API keys in credentials and never in exported workflows.

## Existing workflows

Existing **Pushary** workflows keep their operations and **Pushary API** credential; an omitted Resource defaults to **Notification**.

Existing **Pushary Decision** nodes remain registered for compatibility and use the same decision execution and validation as **Pushary → Decision**. Saved workflows retain their node names, credentials, expressions, action snapshots and decision IDs; paused executions can continue checking the original decision. The legacy node is hidden from the picker.

To migrate voluntarily, back up workflows, let paused executions finish, then replace each **Pushary Decision** node with **Pushary**, select **Resource → Decision**, copy its operation and parameters, reconnect its inputs and outputs, and select the same **Pushary Decision API** credential. Keep the node name when downstream expressions reference it. Version 0.3.0 removed the legacy type; version 0.3.1 restores it. Upgrade 0.2.x workflows directly to 0.3.1 or later.

Under **Resource → Notification**:

- **Ask for Approval** uses the legacy operator `/ask` API for confirm, select or free-text questions. Partner customer decisions must use **Resource → Decision**. Its short HTTP wait is not durable customer orchestration.
- **Get Answer** reads an existing correlation ID without creating another question. Unanswered results and timeouts are not approval; only an answered confirm with `value: "yes"` may pass a confirmation gate.
- **Send Notification** sends a fire-and-forget operator alert.

Legacy Ask has no retry idempotency. Poll with Get Answer, not repeated Ask calls. If you use a callback, verify its signature and reread trusted server state before executing an action; receiving a callback alone is not approval.

## Development and releases

```bash
npm ci
npm run lint
npm run build
npm run typecheck
npm test
npm pack --dry-run
```

Canonical source: `integrations/n8n-nodes-pushary` in the Pushary monorepo, synced to [the public repository](https://github.com/Pushary/n8n-nodes-pushary). Contact: business@pushary.com. Report issues on GitHub.

Public GitHub Actions publishes with npm provenance. Configure the npm trusted publisher as owner `Pushary`, repository `n8n-nodes-pushary`, workflow `publish.yml`, without an environment. Run the workflow with `dry_run` enabled first. A matching version tag publishes the release.

After publication, run `npx @n8n/scan-community-package n8n-nodes-pushary` and submit through the [Creator Portal](https://creators.n8n.io/nodes). Submission and passing automated checks do not mean n8n has verified the package.

## References

- [n8n human review for AI tool calls](https://docs.n8n.io/build/integrate-ai/ai-examples/human-in-the-loop-for-tools)
- [n8n Wait node and persistence](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.wait)
- [n8n community-node verification guidelines](https://docs.n8n.io/connect/create-nodes/build-your-node/reference/verification-guidelines)
- [Connect Pushary](https://pushary.com/docs/agents/connect-any-agent)
