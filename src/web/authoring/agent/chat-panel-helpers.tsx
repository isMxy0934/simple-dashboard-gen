import type { MutableRefObject, ReactNode } from "react";
import type { AiSuggestion } from "@/ai/dashboard-agent/tools/artifacts";
import type { DashboardAgentRouteDecision } from "@/ai/dashboard-agent/contracts/route";
import type {
  DashboardAgentDraftOutput,
  DashboardAgentPatchApprovalPayload,
  DashboardAgentWorkflowStage,
  DashboardAgentWorkflowSummary,
  DashboardAgentMessage,
} from "@/ai/dashboard-agent/contracts/agent-contract";
import { DASHBOARD_AGENT_PATCH_APPROVAL_PART_TYPE } from "@/ai/dashboard-agent/messages/client-parts";
import {
  findDraftOutputBySuggestionId,
  findLatestDraftOutput,
} from "@/ai/dashboard-agent/messages/message-inspection";
import type { DashboardAgentTaskPayload } from "@/ai/dashboard-agent/contracts/task-state";
import type { ValidationIssue } from "@/contracts/validation";
import type { TranslateFn } from "@/web/i18n";
import type { PreviewState } from "@/web/authoring/state/preview-state";

export type AgentMessagePart = DashboardAgentMessage["parts"][number];
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
  activeStage: "read" | "write" | "approval";
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
  messages: DashboardAgentMessage[];
  showAgentProcess: boolean;
  classNames: Record<string, string>;
  t: TranslateFn;
  activeWorkflowStage: WorkspaceSummary["activeStage"];
  pendingPatchApprovalId: string | null;
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
    pendingPatchApprovalId,
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
      messages,
      showAgentProcess,
      classNames,
      t,
      activeWorkflowStage,
      pendingPatchApprovalId,
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
  message: DashboardAgentMessage;
  messages: DashboardAgentMessage[];
  showAgentProcess: boolean;
  classNames: Record<string, string>;
  t: TranslateFn;
  activeWorkflowStage: WorkspaceSummary["activeStage"];
  pendingPatchApprovalId: string | null;
  approvalSectionRef: MutableRefObject<HTMLElement | null>;
  onApprovePendingPatch: () => Promise<void>;
  onRejectPendingPatch: () => Promise<void>;
}): ReactNode[] {
  const {
    message,
    messages,
    showAgentProcess,
    classNames,
    t,
    activeWorkflowStage,
    pendingPatchApprovalId,
    approvalSectionRef,
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
        {textBuf.map((text, index) => (
          <p key={`${keyBase}-${index}`}>{text}</p>
        ))}
      </div>,
    );
    textBuf = [];
  };

  const flushProcess = () => {
    if (processBuf.length === 0) {
      return;
    }
    const keyBase = `${message.id}-p-${blocks.length}`;
    type ProcSeg =
      | { kind: "reasoning"; parts: AgentReasoningPart[] }
      | { kind: "tools"; parts: AgentToolPart[] };
    const segments: ProcSeg[] = [];
    for (const p of processBuf) {
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
          <strong>{t("authoring.chat.toolCalls")}</strong>
          <div className={classNames.processList}>
            {seg.parts.map((tp, index) =>
              renderToolPart(message.id, tp, index, classNames, t),
            )}
          </div>
        </div>
      );
    });

    blocks.push(
      <details
        key={keyBase}
        className={classNames.processCard}
        open={showAgentProcess}
      >
        <summary className={classNames.processSummary}>
          <span>{t("authoring.chat.agentProcess")}</span>
          <span>
            {showAgentProcess ? t("authoring.chat.hide") : t("authoring.chat.show")}
          </span>
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

    if (part.type === DASHBOARD_AGENT_PATCH_APPROVAL_PART_TYPE) {
      flushText();
      flushProcess();
      const data = (part as { data: DashboardAgentPatchApprovalPayload }).data;
      const draft =
        data.suggestionId != null
          ? findDraftOutputBySuggestionId(messages, data.suggestionId)
          : findLatestDraftOutput(messages);
      if (!draft) {
        continue;
      }
      const suggestion = draft.suggestion;
      const approvalRequired = true;
      const approvalTimelineStatus = getApprovalTimelineStatus({
        approvalRequired,
        approvalSuggestion: suggestion,
        activeStage: activeWorkflowStage,
      });
      blocks.push(
        <section
          key={`${message.id}-approval-${data.approvalId}`}
          ref={(el) => {
            if (pendingPatchApprovalId !== data.approvalId) {
              return;
            }
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
                    approvalRequired,
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
              <span>{suggestion.summary}</span>
            </div>
            <div className={classNames.suggestionItem}>
              <strong>{t("authoring.chat.patch")}</strong>
              <span>{suggestion.patch.summary}</span>
            </div>
            {draft.runtime_check ? (
              <div className={classNames.suggestionItem}>
                <strong>{t("authoring.chat.runtimeCheck")}</strong>
                <span>
                  {formatRuntimeCheckSummary(draft.runtime_check, t)}
                </span>
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
        </section>,
      );
      continue;
    }

    if (part.type.startsWith("data-")) {
      continue;
    }
  }

  flushText();
  flushProcess();
  return blocks;
}

export function renderToolPart(
  messageId: string,
  part: AgentToolPart,
  index: number,
  classNames: Record<string, string>,
  t: TranslateFn,
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
        <span>{part.errorText}</span>
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
    case "read":
      return t("authoring.chat.nextStep.read");
    case "write":
      return t("authoring.chat.nextStep.write");
    case "approval":
      return t("authoring.chat.nextStep.approval");
    default:
      return nextStep;
  }
}

export function formatWorkflowHeadline(
  workflow: DashboardAgentWorkflowSummary,
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
): DashboardAgentWorkflowStage[] {
  const stageCopy: Record<
    WorkspaceSummary["activeStage"],
    { title: string; description: string }
  > = {
    read: {
      title: t("authoring.chat.workflowStage.readTitle"),
      description: t("authoring.chat.workflowStage.readDesc"),
    },
    write: {
      title: t("authoring.chat.workflowStage.writeTitle"),
      description: t("authoring.chat.workflowStage.writeDesc"),
    },
    approval: {
      title: t("authoring.chat.workflowStage.approvalTitle"),
      description: t("authoring.chat.workflowStage.approvalDesc"),
    },
  };
  const orderedStages: WorkspaceSummary["activeStage"][] = [
    "read",
    "write",
    "approval",
  ];
  const activeIndex = orderedStages.indexOf(activeStage);

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
  mode: DashboardAgentWorkflowSummary["mode"],
  t: TranslateFn,
) {
  switch (mode) {
    case "read":
      return t("authoring.chat.modeLabel.read");
    case "write":
      return t("authoring.chat.modeLabel.write");
    case "approval":
      return t("authoring.chat.modeLabel.approval");
    default:
      return mode;
  }
}

export function formatRouteLabel(route: DashboardAgentRouteDecision["route"], t: TranslateFn) {
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
  status: DashboardAgentWorkflowStage["status"],
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
  status: DashboardAgentWorkflowStage["status"],
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
  workflow: DashboardAgentWorkflowSummary | null,
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
  runtimeSummaryOutput: DashboardAgentDraftOutput | null;
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

  if (input.previewState === "loading" || input.activeStage === "write") {
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
    runtimeSummaryOutput: DashboardAgentDraftOutput | null;
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

  if (input.activeStage === "write" || input.activeStage === "approval") {
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
  authoringTask: DashboardAgentTaskPayload | null,
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
    case "read":
      return t("authoring.chat.workspaceSummary.read");
    case "write":
      return t("authoring.chat.workspaceSummary.write");
    case "approval":
      return t("authoring.chat.workspaceSummary.approval");
    default:
      return t("authoring.chat.workspaceSummary.default");
  }
}

export function formatPersistedTaskStatus(
  status: DashboardAgentTaskPayload["status"],
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
  status: DashboardAgentTaskPayload["runtimeStatus"],
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
  intervention: NonNullable<DashboardAgentTaskPayload["intervention"]>,
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
