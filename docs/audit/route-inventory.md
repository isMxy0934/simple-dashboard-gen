# API Route Inventory

| Route | HTTP method | Current identity source | Target permission | Sprint 1 migration status |
|---|---:|---|---|---|
| `/api/authoring/chat/[id]/steer` | POST | resolveServerRequestContext + body workspace + body user | dashboard.edit | [ ] |
| `/api/authoring/chat/[id]/stream` | GET | none detected | dashboard.read | [ ] |
| `/api/authoring/chat` | POST | body workspace + body user | dashboard.edit | [ ] |
| `/api/authoring/checks` | PUT | none detected | dashboard.edit | [ ] |
| `/api/authoring/session/open` | POST | none detected | dashboard.edit | [ ] |
| `/api/authoring/session/save` | PUT | none detected | dashboard.edit | [ ] |
| `/api/authoring/settings` | GET | searchParams.workspaceId + searchParams.userId | dashboard.read | [ ] |
| `/api/authoring/settings` | PUT | body workspace + body user | dashboard.edit | [ ] |
| `/api/authoring/task` | GET | resolveServerRequestContext + searchParams.workspaceId + searchParams.userId | dashboard.read | [ ] |
| `/api/authoring/task` | POST | resolveServerRequestContext + body workspace + body user | dashboard.edit | [ ] |
| `/api/authoring/trace` | GET | searchParams.workspaceId + searchParams.userId | dashboard.read | [ ] |
| `/api/authoring/ui-session` | GET | searchParams.workspaceId + searchParams.userId | dashboard.read | [ ] |
| `/api/authoring/ui-session` | PUT | body workspace + body user | dashboard.edit | [ ] |
| `/api/dashboard/publish` | POST | none detected | dashboard.edit | [ ] |
| `/api/dashboard/save` | POST | none detected | dashboard.edit | [ ] |
| `/api/dashboards/[dashboardId]/publish` | DELETE | searchParams.workspaceId | dashboard.edit | [ ] |
| `/api/dashboards/[dashboardId]` | GET | searchParams.workspaceId | dashboard.read | [ ] |
| `/api/dashboards/[dashboardId]` | DELETE | searchParams.workspaceId | dashboard.edit | [ ] |
| `/api/dashboards` | GET | searchParams.workspaceId | dashboard.read | [ ] |
| `/api/dashboards` | POST | searchParams.workspaceId + searchParams.userId | dashboard.edit | [ ] |
| `/api/datasources/[datasourceId]` | DELETE | none detected | datasource.manage | [ ] |
| `/api/datasources/[datasourceId]/schema` | GET | none detected | datasource.read | [ ] |
| `/api/datasources` | GET | none detected | datasource.read | [ ] |
| `/api/datasources` | POST | none detected | datasource.manage | [ ] |
| `/api/datasources/test` | POST | none detected | datasource.manage | [ ] |
| `/api/preview` | POST | none detected | dashboard.read | [ ] |
| `/api/query/execute-batch` | POST | none detected | dashboard.read or dashboard.edit | [ ] |
| `/api/workspace/context` | GET | searchParams.workspaceId | workspace.read | [ ] |
| `/api/workspace/presence` | GET | searchParams.workspaceId | workspace.read | [ ] |
