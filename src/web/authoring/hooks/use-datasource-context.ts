"use client";

import { useEffect, useState } from "react";
import type { DatasourceContext } from "../../../contracts";
import { loadAuthoringDatasourceContext } from "../api/datasource-context-client";

interface DatasourceContextState {
  datasourceContext: DatasourceContext | null;
  status: "loading" | "ready" | "error";
  message: string;
}

export function useDatasourceContext() {
  const [state, setState] = useState<DatasourceContextState>({
    datasourceContext: null,
    status: "loading",
    message: "Loading datasource context...",
  });

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const datasourceContext = await loadAuthoringDatasourceContext();

        if (!active) {
          return;
        }

        setState({
          datasourceContext,
          status: "ready",
          message: `Loaded datasource "${datasourceContext.datasource_id}".`,
        });
      } catch (error) {
        if (!active) {
          return;
        }

        setState({
          datasourceContext: null,
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "Datasource context is unavailable.",
        });
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, []);

  return state;
}
