"use client";

import type { ReactNode } from "react";

/**
 * Renders nested UIMessage content returned from delegateToViewAgent (streaming or final).
 */
export function SubagentActivityBlock({
  output,
  classNames,
}: {
  output: unknown;
  classNames: Record<string, string>;
}): ReactNode {
  if (!output || typeof output !== "object") {
    return null;
  }

  const message = output as {
    parts?: Array<{
      type: string;
      text?: string;
      toolName?: string;
      state?: string;
    }>;
  };

  const parts = message.parts;
  if (!Array.isArray(parts) || parts.length === 0) {
    return (
      <div className={classNames.subagentActivityEmpty}>
        …
      </div>
    );
  }

  return (
    <div className={classNames.subagentActivity}>
      {parts.map((part, index) => {
        if (part.type === "text" && part.text?.trim()) {
          return (
            <p key={index} className={classNames.subagentActivityText}>
              {part.text}
            </p>
          );
        }
        if (typeof part.type === "string" && part.type.startsWith("tool-")) {
          const name = part.toolName ?? part.type.replace(/^tool-/, "");
          return (
            <div key={index} className={classNames.subagentActivityTool}>
              <span className={classNames.subagentActivityToolName}>{name}</span>
              {part.state ? (
                <span className={classNames.subagentActivityToolState}>{part.state}</span>
              ) : null}
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}
