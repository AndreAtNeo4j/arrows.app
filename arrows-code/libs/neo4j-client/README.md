# @arrows-code/neo4j-client

Host-side Neo4j connection for the VS Code extension. Reads a live database's
schema into the shape the extension turns into a `.arrows` graph.

- `fetchSchema(config)` — pulls labels, relationship types, property keys/types,
  and relationship endpoints via `db.schema.*` procedures. Read-only.
- `verifyConnectivity(config)` — auth + reachability check.
- `buildSchema(...)` — pure mapper from raw procedure rows to `SchemaResult`.

No `vscode` dependency; settings and secret handling live in the extension.
