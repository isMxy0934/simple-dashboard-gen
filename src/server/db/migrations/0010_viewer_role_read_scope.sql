delete from workspace_role_permissions
where workspace_id = 'ws_default'
  and role_id = 'viewer'
  and permission = 'datasource.read';
