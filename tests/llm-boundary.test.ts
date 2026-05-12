import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import type { AgentMessage } from "@mariozechner/pi-agent-core";

register("./ts-paths-loader.mjs", import.meta.url);

const { transformAuthoringContext } = await import(
  "../src/ai/authoring/runtime/llm-boundary.ts"
);

function asAgentMessage(value: Record<string, unknown>): AgentMessage {
  return value as unknown as AgentMessage;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

function makeUser(content: string): AgentMessage {
  return asAgentMessage({ role: "user", content, timestamp: 0 });
}

function makeAssistant(content: string, toolCallId?: string): AgentMessage {
  if (toolCallId) {
    return asAgentMessage({
      role: "assistant",
      content,
      toolCalls: [{ toolCallId, toolName: "getViews", args: {} }],
      timestamp: 0,
    });
  }
  return asAgentMessage({ role: "assistant", content, timestamp: 0 });
}

function makeToolResult(toolCallId: string, content: string): AgentMessage {
  return asAgentMessage({
    role: "toolResult",
    toolCallId,
    toolName: "getViews",
    content,
    timestamp: 0,
  });
}

test("transformAuthoringContext: 当前 turn 工具调用结果在消息总数超出 maxMessages 时不被截断", () => {
  // 构造 50 条历史消息（25 组 user+assistant）
  const history: AgentMessage[] = [];
  for (let i = 0; i < 25; i++) {
    history.push(makeUser(`历史消息 ${i}`));
    history.push(makeAssistant(`历史回复 ${i}`));
  }

  // 当前 turn：user 消息 + assistant 发起工具调用 + toolResult（共 3 条）
  const currentUser = makeUser("当前用户请求");
  const callId = "call-abc-123";
  const currentAssistant = makeAssistant("正在调用工具", callId);
  const currentToolResult = makeToolResult(callId, '{"views":["v1","v2"]}');

  const messages = [...history, currentUser, currentAssistant, currentToolResult];

  // 总消息 53 条，maxMessages=40，不保护 turn 时 toolResult 会被截掉
  const result = transformAuthoringContext({
    messages,
    contextMarkdown: "",
    maxMessages: 40,
  });

  // 当前 turn 的 toolResult 必须存在
  const hasToolResult = result.some(
    (m) =>
      asRecord(m).role === "toolResult" &&
      asRecord(m).toolCallId === callId,
  );
  assert.ok(hasToolResult, "当前 turn 的 toolResult 不应被截断");

  // 最后一条 user 消息必须存在
  const hasCurrentUser = result.some(
    (m) =>
      asRecord(m).role === "user" &&
      asRecord(m).content === "当前用户请求",
  );
  assert.ok(hasCurrentUser, "当前 turn 的 user 消息不应被截断");
});

test("transformAuthoringContext: 消息总数不足 maxMessages 时行为与之前一致", () => {
  const messages = [
    makeUser("用户 A"),
    makeAssistant("回复 A"),
    makeUser("用户 B"),
    makeAssistant("回复 B"),
  ];

  const result = transformAuthoringContext({
    messages,
    contextMarkdown: "",
    maxMessages: 40,
  });

  assert.equal(result.length, 4);
});

test("transformAuthoringContext: contextMarkdown 非空时在结果前插入 context 消息", () => {
  const messages = [makeUser("hello"), makeAssistant("world")];

  const result = transformAuthoringContext({
    messages,
    contextMarkdown: "# Context",
    maxMessages: 40,
  });

  assert.equal(asRecord(result[0]).role, "authoring");
  assert.equal(asRecord(result[0]).kind, "context");
  assert.equal(result.length, 3);
});

test("transformAuthoringContext: 历史预算用完时仅保留当前 turn", () => {
  // 当前 turn 本身就有 45 条消息（超过 maxMessages=40）
  const currentUser = makeUser("当前用户");
  const bigCurrentTurn: AgentMessage[] = [currentUser];
  for (let i = 0; i < 44; i++) {
    bigCurrentTurn.push(makeAssistant(`中间 ${i}`));
  }

  const result = transformAuthoringContext({
    messages: bigCurrentTurn,
    contextMarkdown: "",
    maxMessages: 40,
  });

  // 当前 turn 从 lastUserIndex 开始，全部保留（45 条）
  assert.equal(result.length, 45);
});
