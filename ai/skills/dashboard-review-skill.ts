import { summarizeContractState } from "../authoring/state";
import type { AgentSkillDefinition, AgentSkillResource } from "./types";
import type {
  DashboardAuthoringSkillContext,
  DashboardAuthoringToolSet,
} from "./dashboard-authoring-skill";

export function createDashboardReviewSkill(
  input: DashboardAuthoringSkillContext,
): AgentSkillDefinition<DashboardAuthoringToolSet> | null {
  const contractState = input.contractState ?? summarizeContractState(input.dashboard);
  const shouldActivate =
    input.runtimeMode === "inspection" ||
    input.routeDecision?.route === "approval" ||
    contractState.next_step === "repair" ||
    contractState.next_step === "review";

  if (!shouldActivate) {
    return null;
  }

  const reviewChecklist = buildReviewChecklist({
    nextStep: contractState.next_step,
    hasDatasource: Boolean(input.datasourceContext),
    approvalRequired: input.routeDecision?.route === "approval",
  });
  const resources: AgentSkillResource[] = [
    {
      id: "dashboard-review-checklist",
      title: "Review lane checklist",
      content: JSON.stringify(reviewChecklist, null, 2),
    },
  ];

  return {
    id: "dashboard-review",
    description: "Review, verification, and approval-lane guidance for dashboard authoring.",
    instructions: [
      "The dashboard-review skill is active.",
      "Prefer concise state summaries, runtime verification, and explicit risk calls over drafting new changes.",
      "Use inspectContractState and runRuntimeCheck before drafting when the user is asking for status, verification, repair, or approval help.",
      "If a proposal is pending approval, summarize what will change, what was verified, and wait for approval instead of starting a fresh authoring loop.",
    ],
    resources,
    approvalPolicy: {
      requiresApproval: false,
      summary: "Review guidance does not bypass the core dashboard approval gate.",
    },
  };
}

function buildReviewChecklist(input: {
  nextStep: "layout" | "data" | "repair" | "review";
  hasDatasource: boolean;
  approvalRequired: boolean;
}) {
  const checklistByStep: Record<
    typeof input.nextStep,
    string[]
  > = {
    layout: [
      "Confirm the dashboard still needs view and layout shaping before data authoring.",
      "Call out whether manual layout intervention is likely to help.",
    ],
    data: [
      input.hasDatasource
        ? "Validate that the datasource snapshot is sufficient for live query drafting."
        : "Note that live query drafting is blocked until datasource context exists; suggest mock mode or datasource onboarding.",
      "Check whether each visible view has a clear data intent before drafting queries.",
    ],
    repair: [
      "Run runtime verification and identify the smallest set of broken bindings or query issues.",
      "Prioritize repairing missing or mismatched bindings before any new authoring scope is added.",
    ],
    review: [
      "Confirm the contract is structurally complete and summarize remaining validation or approval work.",
      "Highlight any publish-readiness risks instead of reopening earlier stages without evidence.",
    ],
  };

  return {
    active_lane: input.nextStep,
    approval_required: input.approvalRequired,
    checklist: checklistByStep[input.nextStep],
  };
}
