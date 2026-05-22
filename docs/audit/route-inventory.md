# API Route Inventory

| Route | HTTP method | Identity source | Target permission | Sprint 1 status |
|------|-------------|-----------------|-------------------|-----------------|
| `/api/auth/login` | POST | anonymous + CSRF origin | public | [x] |
| `/api/auth/logout` | POST | session | dashboard.read | [x] |
| `/api/auth/refresh` | POST | session cookie within refresh grace | public refresh | [x] |
| `/api/auth/session` | GET | session | dashboard.read | [x] |
| `/api/authoring/chat/[id]/steer` | POST | session.workspaceId + session.userId | dashboard.edit | [x] |
| `/api/authoring/chat/[id]/stream` | GET | session.workspaceId + session.userId | dashboard.read | [x] |
| `/api/authoring/chat` | POST | session.workspaceId + session.userId | dashboard.edit | [x] |
| `/api/authoring/checks` | PUT | session.workspaceId + session.userId | dashboard.edit | [x] |
| `/api/authoring/session/open` | POST | session.workspaceId + session.userId | dashboard.edit | [x] |
| `/api/authoring/session/save` | PUT | session.workspaceId + session.userId | dashboard.edit | [x] |
| `/api/authoring/settings` | GET | session.workspaceId + session.userId | dashboard.read | [x] |
| `/api/authoring/settings` | PUT | session.workspaceId + session.userId | dashboard.edit | [x] |
| `/api/authoring/task` | GET | session.workspaceId + session.userId | dashboard.read | [x] |
| `/api/authoring/task` | POST | session.workspaceId + session.userId | dashboard.edit | [x] |
| `/api/authoring/trace` | GET | session.workspaceId + session.userId | dashboard.read | [x] |
| `/api/authoring/ui-session` | GET | session.workspaceId + session.userId | dashboard.read | [x] |
| `/api/authoring/ui-session` | PUT | session.workspaceId + session.userId | dashboard.edit | [x] |
| `/api/dashboard/publish` | POST | session.workspaceId + session.userId | dashboard.publish | [x] |
| `/api/dashboard/save` | POST | session.workspaceId + session.userId | dashboard.edit | [x] |
| `/api/dashboards/[dashboardId]/publish` | DELETE | session.workspaceId + route.dashboardId | dashboard.publish | [x] |
| `/api/dashboards/[dashboardId]` | GET | session.workspaceId + route.dashboardId | dashboard.read | [x] |
| `/api/dashboards/[dashboardId]` | DELETE | session.workspaceId + route.dashboardId | dashboard.edit | [x] |
| `/api/dashboards` | GET | session.workspaceId | dashboard.read | [x] |
| `/api/dashboards` | POST | session.workspaceId + session.userId | dashboard.edit | [x] |
| `/api/datasources/[datasourceId]` | GET | session.workspaceId + route.datasourceId | datasource.manage | [x] |
| `/api/datasources/[datasourceId]` | DELETE | session.workspaceId + route.datasourceId | datasource.manage | [x] |
| `/api/datasources/[datasourceId]/schema` | GET | session.workspaceId + route.datasourceId | datasource.read | [x] |
| `/api/datasources` | GET | session.workspaceId | datasource.read | [x] |
| `/api/datasources` | POST | session.workspaceId | datasource.manage | [x] |
| `/api/datasources/test` | POST | session.workspaceId | datasource.manage | [x] |
| `/api/preview` | POST | session.workspaceId | dashboard.read | [x] |
| `/api/query/execute-batch` | POST | session.workspaceId | dashboard.read | [x] |
| `/api/workspace/context` | GET | session.workspaceId | dashboard.read | [x] |
| `/api/workspace/presence` | GET | session.workspaceId | dashboard.read | [x] |
