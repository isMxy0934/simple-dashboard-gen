import type {
  AgentEvent,
  AgentMessage,
} from "@mariozechner/pi-agent-core";

export interface AuthoringAgentProtocolEvent {
  protocol: "authoring-agent-v1";
  event: AgentEvent;
}

export interface AuthoringAgentFinishPayload {
  agentMessages: AgentMessage[];
}

const textEncoder = new TextEncoder();

export function encodeAuthoringAgentProtocolEvent(
  event: AuthoringAgentProtocolEvent,
): Uint8Array {
  return textEncoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}
