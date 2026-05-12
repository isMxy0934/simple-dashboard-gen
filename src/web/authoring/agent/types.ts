export type AuthoringUiTextPart = {
  type: "text";
  text: string;
  [key: string]: unknown;
};

export type AuthoringUiReasoningPart = {
  type: "reasoning";
  text: string;
  [key: string]: unknown;
};

export type AuthoringUiStepStartPart = {
  type: "step-start";
  [key: string]: unknown;
};

export type AuthoringUiDataPart = {
  type: `data-${string}`;
  data: unknown;
  [key: string]: unknown;
};

export type AuthoringUiToolPart = {
  type: `tool-${string}`;
  state?:
    | "input-streaming"
    | "input-available"
    | "output-available"
    | "output-error"
    | "output-denied"
    | "approval-requested"
    | "approval-responded"
    | string;
  toolCallId?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  approval?: {
    id?: string;
    approved?: boolean;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export type AuthoringUiMessagePart =
  | AuthoringUiTextPart
  | AuthoringUiReasoningPart
  | AuthoringUiStepStartPart
  | AuthoringUiDataPart
  | AuthoringUiToolPart;

export interface AuthoringUiMessage {
  id: string;
  role: "system" | "user" | "assistant" | "tool";
  parts: AuthoringUiMessagePart[];
  [key: string]: unknown;
}

export type AgentStatus = "submitted" | "streaming" | "ready" | "error";
