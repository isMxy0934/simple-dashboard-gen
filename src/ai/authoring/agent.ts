import {
  AuthoringAgentSession,
  type AuthoringAgentSessionConfig,
} from "@/ai/authoring/agent/session";
import type { AuthoringAgentFinishPayload, AuthoringAgentProtocolEvent } from "@/ai/authoring/agent/protocol";

export type { AuthoringAgentFinishPayload, AuthoringAgentProtocolEvent };
export type { AuthoringAgentSessionConfig };

export async function createAuthoringAgentStream(input: AuthoringAgentSessionConfig) {
  const session = new AuthoringAgentSession(input);
  return session.startTurn();
}
