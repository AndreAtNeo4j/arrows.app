# @arrows-code/graph-logic

Host-agnostic graph operations shared by every editor host: layout algorithms,
patch ops, and structural validation. Pure TypeScript, no editor SDK.

- `layout/` — force / hierarchical / radial / circular / grid
- `patch/` — `PatchOp` types + pure `apply()`
- `validator/` — structural + style-key validation

A host invokes these; it does not reimplement them.
