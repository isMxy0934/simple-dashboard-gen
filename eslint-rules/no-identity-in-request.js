const IDENTITY_KEYS = new Set(["userId", "workspaceId", "user_id", "workspace_id"]);
const REQUEST_BODY_OBJECT_NAMES = new Set(["body", "payload", "requestBody", "json", "input"]);

function isIdentityLiteral(node) {
  return node && node.type === "Literal" && IDENTITY_KEYS.has(String(node.value));
}

function isSearchParamsGet(node) {
  return (
    node?.type === "CallExpression" &&
    node.callee?.type === "MemberExpression" &&
    node.callee.property?.type === "Identifier" &&
    node.callee.property.name === "get" &&
    node.callee.object?.type === "Identifier" &&
    node.callee.object.name === "searchParams" &&
    isIdentityLiteral(node.arguments?.[0])
  );
}

function isIdentityMember(node) {
  return (
    node?.type === "MemberExpression" &&
    node.object?.type === "Identifier" &&
    REQUEST_BODY_OBJECT_NAMES.has(node.object.name) &&
    node.property?.type === "Identifier" &&
    IDENTITY_KEYS.has(node.property.name)
  );
}

export default {
  meta: {
    type: "problem",
    messages: {
      identityFromBody:
        "Do not read identity from request body in API routes; use requireServerSession(req).",
      identityFromQuery:
        "Do not read identity from query string in API routes; use requireServerSession(req).",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (isSearchParamsGet(node)) {
          context.report({ node, messageId: "identityFromQuery" });
        }
      },
      MemberExpression(node) {
        if (isIdentityMember(node)) {
          context.report({ node, messageId: "identityFromBody" });
        }
      },
    };
  },
};
