import type { MutableRefObject, ReactNode } from "react";
import type { AiSuggestion } from "@/ai/authoring/contracts/artifacts";
import type { AuthoringRouteDecision } from "@/ai/authoring/contracts/route";
import type {
  AuthoringDraftOutput,
  AuthoringWorkflowStage,
  AuthoringWorkflowSummary,
  AuthoringMessage,
} from "@/ai/authoring/contracts/tool-io";
import type { AuthoringTaskPayload } from "@/ai/authoring/contracts/task-state";
import type { ValidationIssue } from "@/contracts/validation";
import type { TranslateFn } from "@/web/i18n";
import type { PreviewState } from "@/web/authoring/state/preview-state";
import { isIncompleteToolPart } from "@/ai/authoring/messages/incomplete-tools";
export type AgentMessagePart = AuthoringMessage["parts"][number];
export type AgentReasoningPart = Extract<AgentMessagePart, { type: "reasoning" }>;
export type AgentToolPart = Extract<AgentMessagePart, { type: `tool-${string}` }>;

export interface AgentGuidance {
  message: string;
  placeholder: string;
}

export interface WorkspaceSummary {
  dashboardName: string;
  viewCount: number;
  bindingCount: number;
  activeStage: "chat" | "explore" | "author" | "approval";
}

export type TaskTimelineStatus = "active" | "attention" | "pending" | "complete";

export interface InterventionControls {
  selectedViewTitle: string | null;
  /** True when persisted task marks an active layout intervention (agent context). */
  isAdjustLayoutMode?: boolean;
  onOpenViewIntervention: () => void;
}

export interface AuthoringChatPanelStyles {
  [key: string]: string;
}

export function isReasoningPart(
  part: AgentMessagePart,
): part is AgentReasoningPart {
  return part.type === "reasoning";
}

export function isToolPart(part: AgentMessagePart): part is AgentToolPart {
  return part.type.startsWith("tool-");
}

export interface AuthoringChatTimelineProps {
  messages: AuthoringMessage[];
  showAgentProcess: boolean;
  classNames: Record<string, string>;
  t: TranslateFn;
  activeWorkflowStage: WorkspaceSummary["activeStage"];
  pendingPatchApproval: {
    approvalId: string;
    draftOutput: AuthoringDraftOutput;
  } | null;
  agentStatus: "submitted" | "streaming" | "ready" | "error";
  approvalSectionRef: MutableRefObject<HTMLElement | null>;
  onApprovePendingPatch: () => Promise<void>;
  onRejectPendingPatch: () => Promise<void>;
}

export function renderAuthoringMessageTimeline(
  props: AuthoringChatTimelineProps,
): ReactNode[] {
  const {
    messages,
    showAgentProcess,
    classNames,
    t,
    activeWorkflowStage,
    pendingPatchApproval,
    agentStatus,
    approvalSectionRef,
    onApprovePendingPatch,
    onRejectPendingPatch,
  } = props;

  const nodes: ReactNode[] = [];

  for (const message of messages) {
    if (message.role === "user") {
      const userTexts = message.parts
        .filter((part) => part.type === "text")
        .map((part) => sanitizeAssistantText((part as { text: string }).text))
        .filter(Boolean);
      if (userTexts.length === 0) {
        continue;
      }
      nodes.push(
        <div key={message.id} className={classNames.chatMessageGroup}>
          {userTexts.map((text, index) => (
            <div
              key={`${message.id}-user-${index}`}
              className={`${classNames.chatBubble} ${classNames.chatBubbleUser}`}
            >
              <strong>{t("authoring.chat.you")}</strong>
              <p>{text}</p>
            </div>
          ))}
        </div>,
      );
      continue;
    }

    if (message.role !== "assistant") {
      continue;
    }

    const inner = renderAssistantMessageInOrder({
      message,
      showAgentProcess,
      classNames,
      t,
      activeWorkflowStage,
      pendingPatchApproval,
      agentStatus,
      approvalSectionRef,
      onApprovePendingPatch,
      onRejectPendingPatch,
    });
    if (inner.length > 0) {
      nodes.push(
        <div key={message.id} className={classNames.chatMessageGroup}>
          {inner}
        </div>,
      );
    }
  }

  return nodes;
}

function renderAssistantMessageInOrder(input: {
  message: AuthoringMessage;
  showAgentProcess: boolean;
  classNames: Record<string, string>;
  t: TranslateFn;
  activeWorkflowStage: WorkspaceSummary["activeStage"];
  pendingPatchApproval: {
    approvalId: string;
    draftOutput: AuthoringDraftOutput;
  } | null;
  agentStatus: "submitted" | "streaming" | "ready" | "error";
  approvalSectionRef: MutableRefObject<HTMLElement | null>;
  onApprovePendingPatch: () => Promise<void>;
  onRejectPendingPatch: () => Promise<void>;
}): ReactNode[] {
  const {
    message,
    showAgentProcess,
    classNames,
    t,
    activeWorkflowStage,
    pendingPatchApproval,
    agentStatus,
    approvalSectionRef: _approvalSectionRef,
    onApprovePendingPatch,
    onRejectPendingPatch,
  } = input;

  const blocks: ReactNode[] = [];
  let textBuf: string[] = [];
  let processBuf: Array<AgentReasoningPart | AgentToolPart> = [];

  const flushText = () => {
    if (textBuf.length === 0) {
      return;
    }
    const keyBase = `${message.id}-t-${blocks.length}`;
    blocks.push(
      <div key={keyBase} className={classNames.chatBubble}>
        <strong>{t("authoring.chat.agent")}</strong>
        <div className={classNames.chatMarkdown}>
          {renderMarkdownBlocks(textBuf.join("\n\n"), keyBase, classNames)}
        </div>
      </div>,
    );
    textBuf = [];
  };

  const flushProcess = () => {
    if (processBuf.length === 0) {
      return;
    }
    const visibleProcessParts = showAgentProcess
      ? processBuf
      : processBuf.filter(isToolPart);
    if (visibleProcessParts.length === 0) {
      processBuf = [];
      return;
    }
    const toolTraceOnly = !showAgentProcess;
    const keyBase = `${message.id}-p-${blocks.length}`;
    type ProcSeg =
      | { kind: "reasoning"; parts: AgentReasoningPart[] }
      | { kind: "tools"; parts: AgentToolPart[] };
    const segments: ProcSeg[] = [];
    for (const p of visibleProcessParts) {
      if (isReasoningPart(p)) {
        const last = segments[segments.length - 1];
        if (last?.kind === "reasoning") {
          last.parts.push(p);
        } else {
          segments.push({ kind: "reasoning", parts: [p] });
        }
      } else if (isToolPart(p)) {
        const last = segments[segments.length - 1];
        if (last?.kind === "tools") {
          last.parts.push(p);
        } else {
          segments.push({ kind: "tools", parts: [p] });
        }
      }
    }

    const innerBlocks = segments.map((seg, segIndex) => {
      if (seg.kind === "reasoning") {
        return (
          <div
            key={`${keyBase}-seg-${segIndex}`}
            className={classNames.processSection}
          >
            <strong>{t("authoring.chat.thinking")}</strong>
            {seg.parts.map((rp, index) => (
              <p key={`${keyBase}-rp-${index}`}>
                {rp.text || t("authoring.chat.reasoningFallback")}
              </p>
            ))}
          </div>
        );
      }
      return (
        <div
          key={`${keyBase}-seg-${segIndex}`}
          className={classNames.processSection}
        >
          {toolTraceOnly ? null : <strong>{t("authoring.chat.toolCalls")}</strong>}
          <div className={classNames.processList}>
            {seg.parts.map((tp, index) =>
              renderToolPart(message.id, tp, index, classNames, t, {
                streamActive:
                  agentStatus === "submitted" || agentStatus === "streaming",
              }),
            )}
          </div>
        </div>
      );
    });

    blocks.push(
      <details
        key={keyBase}
        className={classNames.processCard}
        open={showAgentProcess || visibleProcessParts.some(isToolPart)}
      >
        <summary className={classNames.processSummary}>
          <span>
            {showAgentProcess
              ? t("authoring.chat.agentProcess")
              : t("authoring.chat.toolCalls")}
          </span>
          {showAgentProcess ? <span>{t("authoring.chat.hide")}</span> : null}
        </summary>
        {innerBlocks}
      </details>,
    );
    processBuf = [];
  };

  for (const part of message.parts) {
    if (part.type === "text") {
      flushProcess();
      const cleaned = sanitizeAssistantText(part.text);
      if (cleaned) {
        textBuf.push(cleaned);
      }
      continue;
    }

    if (isReasoningPart(part) || isToolPart(part)) {
      flushText();
      processBuf.push(part);
      continue;
    }

    if (part.type.startsWith("data-")) {
      continue;
    }
  }

  flushText();
  flushProcess();

  if (
    pendingPatchApproval &&
    message.parts.some(
      (part) =>
        (part.type === "tool-applyPatch" &&
          part.state === "approval-requested" &&
          part.approval.id === pendingPatchApproval.approvalId) ||
        (part.type === "tool-composePatch" &&
          part.state === "output-available" &&
          (part.output as AuthoringDraftOutput | undefined)?.suggestion?.id ===
            pendingPatchApproval.draftOutput.suggestion.id),
    )
  ) {
    blocks.push(
      renderPendingPatchApprovalSection({
        approvalId: pendingPatchApproval.approvalId,
        draft: pendingPatchApproval.draftOutput,
        classNames,
        t,
        activeWorkflowStage,
        approvalSectionRef: _approvalSectionRef,
        onApprovePendingPatch,
        onRejectPendingPatch,
      }),
    );
  }

  return blocks;
}

function renderPendingPatchApprovalSection(input: {
  approvalId: string;
  draft: AuthoringDraftOutput;
  classNames: Record<string, string>;
  t: TranslateFn;
  activeWorkflowStage: WorkspaceSummary["activeStage"];
  approvalSectionRef: MutableRefObject<HTMLElement | null>;
  onApprovePendingPatch: () => Promise<void>;
  onRejectPendingPatch: () => Promise<void>;
}) {
  const {
    approvalId,
    draft,
    classNames,
    t,
    activeWorkflowStage,
    approvalSectionRef,
    onApprovePendingPatch,
    onRejectPendingPatch,
  } = input;
  const suggestion = draft.suggestion;
  const approvalProposal = getApprovalProposalSummary(suggestion, t);
  const approvalChangeList = getApprovalChangeList(
    suggestion,
    approvalProposal,
    t,
  );
  const approvalTimelineStatus = getApprovalTimelineStatus({
    approvalRequired: true,
    approvalSuggestion: suggestion,
    activeStage: activeWorkflowStage,
  });

  return (
    <section
      key={`pending-approval-${approvalId}`}
      ref={(el) => {
        approvalSectionRef.current = el;
      }}
      className={`${getTaskTimelineNodeClassName(
        approvalTimelineStatus,
        classNames,
      )} ${classNames.approvalDock} ${classNames.approvalDockAfterChat}`}
    >
      <div className={classNames.taskTimelineNodeHeader}>
        <div className={classNames.taskTimelineNodeTitle}>
          <strong>{t("authoring.chat.approvalGate")}</strong>
          <span>
            {getApprovalTimelineText(
              {
                approvalRequired: true,
                approvalSuggestion: suggestion,
                activeStage: activeWorkflowStage,
              },
              t,
            )}
          </span>
        </div>
        <span className={classNames.taskTimelineNodeStatus}>
          {formatTaskTimelineStatus(approvalTimelineStatus, t)}
        </span>
      </div>
      <div className={classNames.suggestionList}>
        <div className={classNames.suggestionItem}>
          <strong>{t("authoring.chat.proposal")}</strong>
          <span>{approvalProposal}</span>
        </div>
        {approvalChangeList.map((changeSummary, index) => (
          <div
            key={`pending-approval-${approvalId}-change-${index}`}
            className={classNames.suggestionItem}
          >
            <strong>{`${index + 1}.`}</strong>
            <span>{changeSummary}</span>
          </div>
        ))}
        {draft.runtime_check ? (
          <div className={classNames.suggestionItem}>
            <strong>{t("authoring.chat.runtimeCheck")}</strong>
            <span>{formatRuntimeCheckSummary(draft.runtime_check, t)}</span>
          </div>
        ) : null}
        {draft.repair ? (
          <div className={classNames.suggestionItem}>
            <strong>{t("authoring.chat.repair")}</strong>
            <span>{formatRepairSummary(draft.repair, t)}</span>
          </div>
        ) : null}
      </div>
      <div className={classNames.panelActions}>
        <button
          type="button"
          className={classNames.primaryAction}
          onClick={() => void onApprovePendingPatch()}
        >
          {t("authoring.chat.approveApply")}
        </button>
        <button
          type="button"
          className={classNames.secondaryAction}
          onClick={() => void onRejectPendingPatch()}
        >
          {t("authoring.chat.dismiss")}
        </button>
      </div>
    </section>
  );
}

export function renderToolPart(
  messageId: string,
  part: AgentToolPart,
  index: number,
  classNames: Record<string, string>,
  t: TranslateFn,
  options: { streamActive?: boolean } = {},
) {
  const label = getToolLabel(part.type, t);

  if (part.state === "approval-requested") {
    return (
      <div key={`${messageId}-tool-${index}`} className={classNames.toolEvent}>
        <strong>{label}</strong>
        <span>{t("authoring.chat.toolAwaitingApproval")}</span>
      </div>
    );
  }

  if (part.state === "approval-responded") {
    return (
      <div key={`${messageId}-tool-${index}`} className={classNames.toolEvent}>
        <strong>{label}</strong>
        <span>
          {part.approval.approved
            ? t("authoring.chat.toolApprovalGranted")
            : t("authoring.chat.toolApprovalDenied")}
        </span>
      </div>
    );
  }

  if (part.state === "output-available") {
    return (
      <div key={`${messageId}-tool-${index}`} className={classNames.toolEvent}>
        <strong>{label}</strong>
        <span>{getToolOutputSummary(part.output, t)}</span>
      </div>
    );
  }

  if (part.state === "output-error") {
    return (
      <div key={`${messageId}-tool-${index}`} className={classNames.toolEvent}>
        <strong>{label}</strong>
        <span>{getToolErrorSummary(part.type, part.errorText, t)}</span>
      </div>
    );
  }

  if (part.state === "output-denied") {
    return (
      <div key={`${messageId}-tool-${index}`} className={classNames.toolEvent}>
        <strong>{label}</strong>
        <span>
          {part.approval.reason?.trim() || t("authoring.chat.toolExecutionDenied")}
        </span>
      </div>
    );
  }

  if (isIncompleteToolPart(part) && !options.streamActive) {
    return (
      <div key={`${messageId}-tool-${index}`} className={classNames.toolEvent}>
        <strong>{label}</strong>
        <span>{t("authoring.chat.toolOutput.interrupted")}</span>
      </div>
    );
  }

  return (
    <div key={`${messageId}-tool-${index}`} className={classNames.toolEvent}>
      <strong>{label}</strong>
      <span>{t("authoring.chat.toolWorking")}</span>
    </div>
  );
}

export function getToolOutputSummary(output: unknown, t: TranslateFn): string {
  if (!output || typeof output !== "object") {
    return t("authoring.chat.toolOutput.completed");
  }

  if (
    "applied" in output &&
    output.applied === true &&
    "title" in output &&
    typeof output.title === "string"
  ) {
    return t("authoring.chat.toolOutput.draftApplied", { title: output.title });
  }

  if ("suggestion" in output) {
    const suggestionOutput = output as {
      suggestion: AiSuggestion;
      runtime_check?: { reason: string };
      repair?: { attempted: number; repaired: boolean };
    };
    const patchLine = t("authoring.chat.toolOutput.contractChanges", {
      count: suggestionOutput.suggestion.patch.operations.length,
    });
    const repairLine = suggestionOutput.repair?.repaired
      ? ` ${t("authoring.chat.toolOutput.autoRepairDone", {
          count: suggestionOutput.repair.attempted,
        })}`
      : suggestionOutput.repair?.attempted
        ? ` ${t("authoring.chat.toolOutput.autoRepairTried", {
            count: suggestionOutput.repair.attempted,
          })}`
        : "";
    return suggestionOutput.runtime_check
      ? `${suggestionOutput.suggestion.title}. ${patchLine} ${suggestionOutput.runtime_check.reason}${repairLine}`.trim()
      : `${suggestionOutput.suggestion.title}. ${patchLine}`;
  }

  if ("summary" in output && typeof output.summary === "string") {
    return output.summary;
  }

  if ("view_count" in output && typeof output.view_count === "number") {
    const draftOutput = output as {
      view_count: number;
      view_ids?: unknown;
    };
    if (!Array.isArray(draftOutput.view_ids)) {
      return t("authoring.chat.toolOutput.completed");
    }
    return summarizeDraftOutput(
      "view",
      draftOutput.view_count,
      draftOutput.view_ids as string[],
      t,
    );
  }

  if ("query_count" in output && typeof output.query_count === "number") {
    const draftOutput = output as {
      query_count: number;
      query_ids?: unknown;
    };
    if (!Array.isArray(draftOutput.query_ids)) {
      return t("authoring.chat.toolOutput.completed");
    }
    return summarizeDraftOutput(
      "query",
      draftOutput.query_count,
      draftOutput.query_ids as string[],
      t,
    );
  }

  if ("binding_count" in output && typeof output.binding_count === "number") {
    const draftOutput = output as {
      binding_count: number;
      binding_ids?: unknown;
      binding_mode?: "mock" | "live";
    };
    if (!Array.isArray(draftOutput.binding_ids)) {
      return t("authoring.chat.toolOutput.completed");
    }
    const bindingMode =
      draftOutput.binding_mode === "mock"
        ? t("authoring.chat.toolOutput.bindingModeMock")
        : draftOutput.binding_mode === "live"
          ? t("authoring.chat.toolOutput.bindingModeLive")
          : "";
    const base = summarizeDraftOutput(
      "binding",
      draftOutput.binding_count,
      draftOutput.binding_ids as string[],
      t,
    );
    return `${base}${bindingMode}.`;
  }

  if ("reason" in output && typeof output.reason === "string") {
    return output.reason;
  }

  if ("table_count" in output && typeof output.table_count === "number") {
    return t("authoring.chat.toolOutput.tablesInSnapshot", {
      count: output.table_count,
    });
  }

  return t("authoring.chat.toolOutput.completed");
}

export function getToolErrorSummary(
  toolType: string,
  errorText: string | undefined,
  t: TranslateFn,
): string {
  const text = `${toolType} ${errorText ?? ""}`.toLowerCase();
  if (
    text.includes("authoring_turn_interrupted") ||
    text.includes("interrupted") ||
    text.includes("wall-clock") ||
    text.includes("timeout")
  ) {
    return t("authoring.chat.toolOutput.interrupted");
  }
  if (text.includes("missing_skill") || text.includes("skill reference")) {
    return t("authoring.chat.toolOutput.needsSkill");
  }
  if (
    text.includes("binding_mismatch") ||
    text.includes("binding") ||
    text.includes("slot")
  ) {
    return t("authoring.chat.toolOutput.needsBinding");
  }
  if (
    text.includes("schema") ||
    text.includes("validation") ||
    text.includes("invalid") ||
    text.includes("contract")
  ) {
    return t("authoring.chat.toolOutput.needsRepair");
  }
  return t("authoring.chat.toolOutput.failed");
}

export function formatRuntimeCheckSummary(
  runtimeCheck: {
    status: "ok" | "warning" | "error";
    reason: string;
    counts: { ok: number; empty: number; error: number };
    errors: Array<{
      source?: "contract" | "runtime" | "renderer";
      view_id?: string;
      query_id?: string;
      binding_id?: string;
      code?: string;
      message?: string;
    }>;
  },
  t: TranslateFn,
) {
  const errorCount = runtimeCheck.errors.length;
  let countsPart = t("authoring.chat.runtimeCheckCounts", {
    ok: runtimeCheck.counts.ok,
    empty: runtimeCheck.counts.empty,
    err: runtimeCheck.counts.error,
  });
  if (errorCount === 1) {
    countsPart += t("authoring.chat.runtimeCheckDetailOne");
  } else if (errorCount > 1) {
    countsPart += t("authoring.chat.runtimeCheckDetailMany", { count: errorCount });
  }
  return `${runtimeCheck.status.toUpperCase()} - ${runtimeCheck.reason} (${countsPart})`;
}

export function formatRepairSummary(
  repair: {
    attempted: number;
    repaired: boolean;
    notes: string[];
  },
  t: TranslateFn,
) {
  const repairState = repair.repaired
    ? t("authoring.chat.repairSummary.completed")
    : t("authoring.chat.repairSummary.notCompleted");
  const rounds =
    repair.attempted === 0
      ? t("authoring.chat.repairSummary.noRounds")
      : repair.attempted === 1
        ? t("authoring.chat.repairSummary.round", { count: repair.attempted })
        : t("authoring.chat.repairSummary.rounds", { count: repair.attempted });
  const note = repair.notes[0];
  return `${repairState}, ${rounds}${note ? ` - ${note}` : ""}`;
}

function getApprovalProposalSummary(
  suggestion: AiSuggestion,
  t: TranslateFn,
): string {
  return t("authoring.chat.approvalProposalSummary", {
    count: suggestion.patch.operations.length,
  });
}

function getApprovalChangeList(
  suggestion: AiSuggestion,
  proposalSummary: string,
  t: TranslateFn,
): string[] {
  const viewSummaries: string[] = [];
  let dataSourceChangeCount = 0;
  let dataConnectionChangeCount = 0;
  let layoutChanged = false;

  for (const operation of suggestion.patch.operations) {
    if (operation.path.startsWith("dashboard_spec.views.")) {
      const viewSummary = formatApprovalViewSummary(operation, t);
      if (viewSummary) {
        viewSummaries.push(viewSummary);
      }
      continue;
    }

    if (operation.path.startsWith("query_defs.")) {
      dataSourceChangeCount += 1;
      continue;
    }

    if (operation.path.startsWith("bindings.")) {
      dataConnectionChangeCount += 1;
      continue;
    }

    if (operation.path.startsWith("dashboard_spec.layout")) {
      layoutChanged = true;
    }
  }

  const summaries = Array.from(new Set(viewSummaries)).slice(0, 4);
  if (dataSourceChangeCount > 0) {
    summaries.push(
      t("authoring.chat.approvalChange.dataPrepared", {
        count: dataSourceChangeCount,
      }),
    );
  }
  if (dataConnectionChangeCount > 0) {
    summaries.push(
      t("authoring.chat.approvalChange.dataConnected", {
        count: dataConnectionChangeCount,
      }),
    );
  }
  if (layoutChanged) {
    summaries.push(t("authoring.chat.approvalChange.layoutUpdated"));
  }

  if (summaries.length > 0) {
    return summaries;
  }

  const patchSummary = normalizeApprovalSummary(suggestion.patch.summary);
  if (patchSummary && patchSummary !== proposalSummary) {
    return [patchSummary];
  }

  return [];
}

function formatApprovalViewSummary(
  operation: AiSuggestion["patch"]["operations"][number],
  t: TranslateFn,
) {
  const summary = normalizeApprovalSummary(operation.summary);
  if (!summary) {
    return summary;
  }

  const viewMatch = summary.match(/^(Add|Update|Remove) view "(.+)"\.$/);
  if (viewMatch) {
    const action = viewMatch[1];
    const title = viewMatch[2];
    if (action === "Add") {
      return t("authoring.chat.approvalChange.addView", { title });
    }
    if (action === "Update") {
      return t("authoring.chat.approvalChange.updateView", { title });
    }
    return t("authoring.chat.approvalChange.removeView", { title });
  }

  return "";
}

function normalizeApprovalSummary(summary: string | null | undefined): string {
  return typeof summary === "string" ? summary.trim() : "";
}

function renderMarkdownBlocks(
  source: string,
  keyBase: string,
  classNames: Record<string, string>,
): ReactNode[] {
  const nodes: ReactNode[] = [];
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  let paragraph: string[] = [];
  let listItems: string[] = [];
  let listKind: "ul" | "ol" | null = null;
  let codeLines: string[] = [];
  let inCodeBlock = false;

  const flushParagraph = () => {
    if (paragraph.length === 0) {
      return;
    }
    const text = paragraph.join(" ").trim();
    if (text) {
      nodes.push(
        <p key={`${keyBase}-p-${nodes.length}`}>
          {renderInlineMarkdown(text, `${keyBase}-p-${nodes.length}`, classNames)}
        </p>,
      );
    }
    paragraph = [];
  };

  const flushList = () => {
    if (!listKind || listItems.length === 0) {
      return;
    }
    const items = listItems.map((item, index) => (
      <li key={`${keyBase}-li-${nodes.length}-${index}`}>
        {renderInlineMarkdown(item, `${keyBase}-li-${nodes.length}-${index}`, classNames)}
      </li>
    ));
    nodes.push(
      listKind === "ol" ? (
        <ol key={`${keyBase}-ol-${nodes.length}`}>{items}</ol>
      ) : (
        <ul key={`${keyBase}-ul-${nodes.length}`}>{items}</ul>
      ),
    );
    listItems = [];
    listKind = null;
  };

  const flushCodeBlock = () => {
    nodes.push(
      <pre key={`${keyBase}-code-${nodes.length}`} className={classNames.chatMarkdownCodeBlock}>
        <code>{codeLines.join("\n")}</code>
      </pre>,
    );
    codeLines = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (line.trim().startsWith("```")) {
      flushParagraph();
      flushList();
      if (inCodeBlock) {
        flushCodeBlock();
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
        codeLines = [];
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(rawLine);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      nodes.push(
        <h4 key={`${keyBase}-h-${nodes.length}`}>
          {renderInlineMarkdown(headingMatch[2].trim(), `${keyBase}-h-${nodes.length}`, classNames)}
        </h4>,
      );
      continue;
    }

    const unorderedMatch = line.match(/^[-*]\s+(.+)$/);
    const orderedMatch = line.match(/^\d+[.)]\s+(.+)$/);
    if (unorderedMatch || orderedMatch) {
      flushParagraph();
      const nextKind = orderedMatch ? "ol" : "ul";
      if (listKind && listKind !== nextKind) {
        flushList();
      }
      listKind = nextKind;
      listItems.push((orderedMatch?.[1] ?? unorderedMatch?.[1] ?? "").trim());
      continue;
    }

    flushList();
    paragraph.push(line.trim());
  }

  if (inCodeBlock) {
    flushCodeBlock();
  }
  flushParagraph();
  flushList();

  return nodes.length > 0 ? nodes : [<p key={`${keyBase}-empty`}>{source}</p>];
}

function renderInlineMarkdown(
  source: string,
  keyBase: string,
  classNames: Record<string, string>,
): ReactNode[] {
  const nodes: ReactNode[] = [];
  const tokenPattern = /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenPattern.exec(source)) !== null) {
    if (match.index > cursor) {
      nodes.push(source.slice(cursor, match.index));
    }
    const token = match[0];
    if (token.startsWith("`")) {
      nodes.push(
        <code key={`${keyBase}-code-${nodes.length}`} className={classNames.chatMarkdownInlineCode}>
          {token.slice(1, -1)}
        </code>,
      );
    } else {
      nodes.push(
        <strong key={`${keyBase}-strong-${nodes.length}`}>
          {token.slice(2, -2)}
        </strong>,
      );
    }
    cursor = match.index + token.length;
  }

  if (cursor < source.length) {
    nodes.push(source.slice(cursor));
  }

  return nodes;
}

export function getToolLabel(type: string, t: TranslateFn): string {
  const explicitKeys: Record<string, string> = {
    "tool-loadSkill": "authoring.chat.toolLabels.loadSkill",
    "tool-loadSkillReference": "authoring.chat.toolLabels.loadSkillReference",
    "tool-getViews": "authoring.chat.toolLabels.getViews",
    "tool-getView": "authoring.chat.toolLabels.getView",
    "tool-getDatasources": "authoring.chat.toolLabels.getDatasources",
    "tool-getSchemaByDatasource":
      "authoring.chat.toolLabels.getSchemaByDatasource",
    "tool-getQuery": "authoring.chat.toolLabels.getQuery",
    "tool-getBinding": "authoring.chat.toolLabels.getBinding",
    "tool-runCheck": "authoring.chat.toolLabels.runCheck",
    "tool-upsertView": "authoring.chat.toolLabels.upsertView",
    "tool-upsertQuery": "authoring.chat.toolLabels.upsertQuery",
    "tool-upsertBinding": "authoring.chat.toolLabels.upsertBinding",
    "tool-deleteView": "authoring.chat.toolLabels.deleteView",
    "tool-deleteQuery": "authoring.chat.toolLabels.deleteQuery",
    "tool-deleteBinding": "authoring.chat.toolLabels.deleteBinding",
    "tool-composePatch": "authoring.chat.toolLabels.composePatch",
    "tool-applyPatch": "authoring.chat.toolLabels.applyPatch",
  };

  if (type in explicitKeys) {
    return t(explicitKeys[type]);
  }

  return type
    .replace("tool-", "")
    .replace(/([A-Z])/g, " $1")
    .toLowerCase();
}

export function summarizeDraftOutput(
  kind: "view" | "query" | "binding",
  count: number,
  ids: string[],
  t: TranslateFn,
): string {
  const itemKey =
    kind === "view"
      ? count === 1
        ? "authoring.chat.toolOutput.itemView"
        : "authoring.chat.toolOutput.itemViewPlural"
      : kind === "query"
        ? count === 1
          ? "authoring.chat.toolOutput.itemQuery"
          : "authoring.chat.toolOutput.itemQueryPlural"
        : count === 1
          ? "authoring.chat.toolOutput.itemBinding"
          : "authoring.chat.toolOutput.itemBindingPlural";
  const item = t(itemKey);
  const idSummary =
    ids.length > 0 ? ` ${ids.slice(0, 3).join(", ")}${ids.length > 3 ? "…" : ""}` : "";

  return t("authoring.chat.toolOutput.itemsPrepared", {
    count,
    item,
    ids: idSummary.trim() ? ` ${idSummary.trim()}` : "",
  });
}

export function sanitizeAssistantText(text: string) {
  return text
    .replace(/<｜DSML｜function_calls>[\s\S]*?<\/｜DSML｜function_calls>/g, "")
    .replace(/<\｜?DSML\｜?[^>]*>/g, "")
    .trim();
}

export function formatNextStepLabel(
  nextStep: WorkspaceSummary["activeStage"],
  t: TranslateFn,
) {
  switch (nextStep) {
    case "chat":
      return t("authoring.chat.nextStep.chat");
    case "explore":
      return t("authoring.chat.nextStep.explore");
    case "author":
      return t("authoring.chat.nextStep.author");
    case "approval":
      return t("authoring.chat.nextStep.approval");
    default:
      return nextStep;
  }
}

export function formatWorkflowHeadline(
  workflow: AuthoringWorkflowSummary,
  t: TranslateFn,
) {
  return t("authoring.chat.workflowHeadline", {
    route: formatRouteLabel(workflow.route, t),
    mode: formatWorkflowModeLabel(workflow.mode, t),
  });
}

export function buildFallbackWorkflowStages(
  activeStage: WorkspaceSummary["activeStage"],
  t: TranslateFn,
): AuthoringWorkflowStage[] {
  const stageCopy: Record<
    WorkspaceSummary["activeStage"],
    { title: string; description: string }
  > = {
    chat: {
      title: t("authoring.chat.workflowStage.chatTitle"),
      description: t("authoring.chat.workflowStage.chatDesc"),
    },
    explore: {
      title: t("authoring.chat.workflowStage.exploreTitle"),
      description: t("authoring.chat.workflowStage.exploreDesc"),
    },
    author: {
      title: t("authoring.chat.workflowStage.authorTitle"),
      description: t("authoring.chat.workflowStage.authorDesc"),
    },
    approval: {
      title: t("authoring.chat.workflowStage.approvalTitle"),
      description: t("authoring.chat.workflowStage.approvalDesc"),
    },
  };
  const orderedStages: WorkspaceSummary["activeStage"][] = [
    "explore",
    "author",
    "approval",
  ];
  const activeIndex = orderedStages.indexOf(activeStage);

  if (activeStage === "chat") {
    return [
      {
        id: "chat",
        title: stageCopy.chat.title,
        description: stageCopy.chat.description,
        status: "active",
      },
      {
        id: "explore",
        title: stageCopy.explore.title,
        description: stageCopy.explore.description,
        status: "pending",
      },
      {
        id: "author",
        title: stageCopy.author.title,
        description: stageCopy.author.description,
        status: "pending",
      },
      {
        id: "approval",
        title: stageCopy.approval.title,
        description: stageCopy.approval.description,
        status: "pending",
      },
    ];
  }

  return orderedStages.map((stageId, index) => ({
    id: stageId,
    title: stageCopy[stageId].title,
    description: stageCopy[stageId].description,
    status:
      index < activeIndex
        ? "complete"
        : index === activeIndex
          ? "active"
          : "pending",
  }));
}

export function formatWorkflowModeLabel(
  mode: AuthoringWorkflowSummary["mode"],
  t: TranslateFn,
) {
  switch (mode) {
    case "chat":
      return t("authoring.chat.modeLabel.chat");
    case "explore":
      return t("authoring.chat.modeLabel.explore");
    case "author-dashboard":
      return t("authoring.chat.modeLabel.authorDashboard");
    case "author-focused":
      return t("authoring.chat.modeLabel.authorFocused");
    case "approval":
      return t("authoring.chat.modeLabel.approval");
    default:
      return mode;
  }
}

export function formatRouteLabel(route: AuthoringRouteDecision["route"], t: TranslateFn) {
  switch (route) {
    case "authoring":
      return t("authoring.chat.routeLabel.authoring");
    case "approval":
      return t("authoring.chat.routeLabel.approval");
    case "chat":
      return t("authoring.chat.routeLabel.chat");
    default:
      return route;
  }
}

export function formatWorkflowToolLabel(toolName: string, t: TranslateFn) {
  const toolType = toolName.startsWith("tool-") ? toolName : `tool-${toolName}`;
  return getToolLabel(toolType, t);
}

export function formatSkillLabel(skillId: string) {
  if (skillId === "echarts-skills") {
    return "ECharts Skills";
  }

  return skillId
    .split("-")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

export function formatWorkflowStageStatus(
  status: AuthoringWorkflowStage["status"],
  t: TranslateFn,
) {
  switch (status) {
    case "active":
      return t("authoring.chat.workflowStageStatus.active");
    case "complete":
      return t("authoring.chat.workflowStageStatus.complete");
    case "pending":
      return t("authoring.chat.workflowStageStatus.pending");
    default:
      return status;
  }
}

export function getWorkflowStageClassName(
  status: AuthoringWorkflowStage["status"],
  styles: AuthoringChatPanelStyles,
) {
  const classNames = [styles.workflowStageCard];

  if (status === "active") {
    classNames.push(styles.workflowStageCardActive);
  } else if (status === "complete") {
    classNames.push(styles.workflowStageCardComplete);
  } else {
    classNames.push(styles.workflowStageCardPending);
  }

  return classNames.join(" ");
}

export function getFlowTimelineStatus(
  workflow: AuthoringWorkflowSummary | null,
): TaskTimelineStatus {
  if (!workflow) {
    return "pending";
  }

  if (workflow.route === "approval") {
    return "attention";
  }

  if (workflow.route === "chat") {
    return "pending";
  }

  return "active";
}

export function getApprovalTimelineStatus(input: {
  approvalRequired: boolean;
  approvalSuggestion: AiSuggestion | null;
  activeStage: WorkspaceSummary["activeStage"];
}): TaskTimelineStatus {
  if (input.approvalRequired || input.approvalSuggestion) {
    return "attention";
  }

  if (input.activeStage === "approval") {
    return "active";
  }

  return "pending";
}

export function getApprovalTimelineText(
  input: {
    approvalRequired: boolean;
    approvalSuggestion: AiSuggestion | null;
    activeStage: WorkspaceSummary["activeStage"];
  },
  t: TranslateFn,
) {
  if (input.approvalRequired && input.approvalSuggestion) {
    return t("authoring.chat.approvalText.waiting");
  }

  if (input.activeStage === "approval") {
    return t("authoring.chat.approvalText.inReview");
  }

  return t("authoring.chat.approvalText.quiet");
}

export function getRuntimeTimelineStatus(input: {
  activeStage: WorkspaceSummary["activeStage"];
  previewState: PreviewState;
  agentError: Error | undefined;
  validationIssues: ValidationIssue[];
  runtimeSummaryOutput: AuthoringDraftOutput | null;
}): TaskTimelineStatus {
  if (
    input.agentError ||
    input.validationIssues.length > 0 ||
    input.previewState === "error" ||
    input.runtimeSummaryOutput?.runtime_check?.status === "error" ||
    input.runtimeSummaryOutput?.runtime_check?.status === "warning"
  ) {
    return "attention";
  }

  if (
    input.previewState === "loading" ||
    input.activeStage === "author" ||
    input.activeStage === "explore"
  ) {
    return "active";
  }

  if (
    input.previewState === "ready" ||
    input.runtimeSummaryOutput?.runtime_check?.status === "ok"
  ) {
    return "complete";
  }

  return "pending";
}

export function getRuntimeTimelineText(
  input: {
    activeStage: WorkspaceSummary["activeStage"];
    previewState: PreviewState;
    previewMessage: string;
    agentError: Error | undefined;
    validationIssues: ValidationIssue[];
    runtimeSummaryOutput: AuthoringDraftOutput | null;
  },
  t: TranslateFn,
) {
  if (input.agentError) {
    return t("authoring.chat.runtimeText.agentError");
  }

  if (input.runtimeSummaryOutput?.runtime_check) {
    return t("authoring.chat.runtimeRuntimePrefix", {
      status: input.runtimeSummaryOutput.runtime_check.status,
      reason: input.runtimeSummaryOutput.runtime_check.reason,
    });
  }

  if (input.previewState !== "idle") {
    return input.previewMessage;
  }

  if (input.validationIssues.length > 0) {
    return t("authoring.chat.runtimeText.validation", {
      count: input.validationIssues.length,
    });
  }

  if (
    input.activeStage === "author" ||
    input.activeStage === "explore" ||
    input.activeStage === "approval"
  ) {
    return t("authoring.chat.runtimeText.accumulate");
  }

  return t("authoring.chat.runtimeText.idle");
}

export function getInterventionTimelineStatus(
  interventionControls: InterventionControls,
): TaskTimelineStatus {
  if (
    interventionControls.isAdjustLayoutMode === true ||
    interventionControls.selectedViewTitle
  ) {
    return "active";
  }

  return "pending";
}

export function getInterventionTimelineText(
  interventionControls: InterventionControls,
  t: TranslateFn,
) {
  if (interventionControls.isAdjustLayoutMode === true) {
    return t("authoring.chat.interventionText.layout");
  }

  if (interventionControls.selectedViewTitle) {
    return t("authoring.chat.interventionText.selected", {
      title: interventionControls.selectedViewTitle,
    });
  }

  return t("authoring.chat.interventionText.default");
}

export function getTaskRecordTimelineStatus(
  authoringTask: AuthoringTaskPayload | null,
): TaskTimelineStatus {
  if (!authoringTask) {
    return "pending";
  }

  if (
    authoringTask.pendingApproval ||
    authoringTask.status === "awaiting_approval" ||
    authoringTask.runtimeStatus === "warning" ||
    authoringTask.runtimeStatus === "error"
  ) {
    return "attention";
  }

  if (
    authoringTask.status === "authoring" ||
    authoringTask.status === "repairing" ||
    authoringTask.status === "reviewing" ||
    authoringTask.status === "intervention"
  ) {
    return "active";
  }

  if (authoringTask.status === "published") {
    return "complete";
  }

  return authoringTask.events.length > 0 ? "complete" : "pending";
}

export function formatTaskTimelineStatus(status: TaskTimelineStatus, t: TranslateFn) {
  switch (status) {
    case "active":
      return t("authoring.chat.timeline.active");
    case "attention":
      return t("authoring.chat.timeline.attention");
    case "complete":
      return t("authoring.chat.timeline.complete");
    case "pending":
      return t("authoring.chat.timeline.pending");
    default:
      return status;
  }
}

export function getTaskTimelineNodeClassName(
  status: TaskTimelineStatus,
  styles: AuthoringChatPanelStyles,
) {
  const classNames = [styles.taskTimelineNode];

  if (status === "attention") {
    classNames.push(styles.taskTimelineNodeAttention);
  } else if (status === "active") {
    classNames.push(styles.taskTimelineNodeActive);
  } else if (status === "complete") {
    classNames.push(styles.taskTimelineNodeComplete);
  } else {
    classNames.push(styles.taskTimelineNodePending);
  }

  return classNames.join(" ");
}

export function formatWorkspaceSummaryText(
  nextStep: WorkspaceSummary["activeStage"],
  t: TranslateFn,
) {
  switch (nextStep) {
    case "chat":
      return t("authoring.chat.workspaceSummary.chat");
    case "explore":
      return t("authoring.chat.workspaceSummary.explore");
    case "author":
      return t("authoring.chat.workspaceSummary.author");
    case "approval":
      return t("authoring.chat.workspaceSummary.approval");
    default:
      return t("authoring.chat.workspaceSummary.default");
  }
}

export function formatPersistedTaskStatus(
  status: AuthoringTaskPayload["status"],
  t: TranslateFn,
) {
  switch (status) {
    case "awaiting_approval":
      return t("authoring.chat.persistedTask.awaiting");
    case "authoring":
      return t("authoring.chat.persistedTask.authoring");
    case "repairing":
      return t("authoring.chat.persistedTask.repairing");
    case "reviewing":
      return t("authoring.chat.persistedTask.reviewing");
    case "intervention":
      return t("authoring.chat.persistedTask.intervention");
    case "published":
      return t("authoring.chat.persistedTask.published");
    case "idle":
    default:
      return t("authoring.chat.persistedTask.idle");
  }
}

export function formatPersistedRuntimeStatus(
  status: AuthoringTaskPayload["runtimeStatus"],
  t: TranslateFn,
) {
  switch (status) {
    case "loading":
      return t("authoring.chat.persistedRuntime.loading");
    case "ok":
      return t("authoring.chat.persistedRuntime.ok");
    case "warning":
      return t("authoring.chat.persistedRuntime.warning");
    case "error":
      return t("authoring.chat.persistedRuntime.error");
    case "idle":
    default:
      return t("authoring.chat.persistedRuntime.idle");
  }
}

export function formatTaskTimestamp(value: string, localeTag: string, t: TranslateFn) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return t("authoring.chat.unknownTime");
  }

  const tag = localeTag === "zh" ? "zh-CN" : "en-US";
  return date.toLocaleString(tag, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatInterventionSummary(
  intervention: NonNullable<AuthoringTaskPayload["intervention"]>,
  t: TranslateFn,
) {
  if (intervention.kind === "layout") {
    return intervention.viewTitle
      ? t("authoring.chat.interventionSummary.layoutWithView", {
          title: intervention.viewTitle,
        })
      : t("authoring.chat.interventionSummary.layout");
  }

  return intervention.viewTitle
    ? t("authoring.chat.interventionSummary.contractWithView", {
        title: intervention.viewTitle,
      })
    : t("authoring.chat.interventionSummary.contract");
}
