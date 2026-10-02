import { NodeConnectionTypes, type INodeProperties, type INodeType, type INodeTypeDescription } from 'n8n-workflow'
import { Pushary, executeDecision } from './Pushary.node'

const legacyDecisionProperty = (property: INodeProperties): INodeProperties => {
  const show = { ...property.displayOptions?.show }
  delete show.resource
  return { ...property, displayOptions: { ...property.displayOptions, show } }
}

export class PusharyDecision implements INodeType {
  description: INodeTypeDescription = {
    icon: { light: 'file:pushary.svg', dark: 'file:pushary.dark.svg' },
    usableAsTool: true,
    group: ['transform'],
    version: 1,
    subtitle: '={{$parameter["operation"]}}',
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    displayName: 'Pushary Decision',
    name: 'pusharyDecision',
    hidden: true,
    description: 'Request and verify durable customer approval for an action',
    defaults: { name: 'Pushary Decision' },
    credentials: [{ name: 'pusharyDecisionApi', required: true }],
    properties: new Pushary().description.properties
      .filter(property => property.displayOptions?.show?.resource?.includes('decision'))
      .map(legacyDecisionProperty),
  }

  execute = executeDecision
}
