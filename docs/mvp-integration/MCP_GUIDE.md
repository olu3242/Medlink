# Governed MCP Preparation

`MvpMcpRegistry` permits only approved medicine, inventory, knowledge, workflow-status, notification, and audit capabilities. Registration fails closed for unapproved capabilities and duplicate tool names. Read/write intent is declared per tool. No public MCP transport is enabled in RC1; enabling one requires authentication, tenant propagation, per-tool authorization, schemas, audit, rate limits, and security review.
