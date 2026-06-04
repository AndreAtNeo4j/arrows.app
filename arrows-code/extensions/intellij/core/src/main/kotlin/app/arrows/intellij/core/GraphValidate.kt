package app.arrows.intellij.core

import org.json.JSONArray
import org.json.JSONObject

// The style-key check is VS-Code-only: it needs the @neo4j-arrows/model style vocabulary, which
// stays single-sourced in the bundle rather than hand-copied here.

enum class Severity { ERROR, WARNING }

data class Diagnostic(val severity: Severity, val code: String, val message: String)

// Same codes as graph-logic/validator/types.ts — a diagnostic means the same in both hosts.
const val CODE_REF_INTEGRITY = "structural.ref-integrity"
const val CODE_DUPLICATE_ID = "structural.duplicate-id"
const val CODE_EMPTY_REQUIRED = "structural.empty-required-field"

private fun JSONArray.objects(): List<JSONObject> = (0 until length()).mapNotNull { optJSONObject(it) }

fun validateGraph(json: String): List<Diagnostic> {
    val root = runCatching { JSONObject(json) }.getOrNull() ?: return emptyList()
    val nodes = root.optJSONArray("nodes")?.objects() ?: emptyList()
    val rels = root.optJSONArray("relationships")?.objects() ?: emptyList()
    return checkDuplicateIds(nodes, rels) + checkRefIntegrity(nodes, rels) + checkRequiredFields(nodes, rels)
}

private fun checkDuplicateIds(nodes: List<JSONObject>, rels: List<JSONObject>): List<Diagnostic> {
    val out = mutableListOf<Diagnostic>()
    val seenNodes = mutableSetOf<String>()
    for (n in nodes) {
        val id = n.optString("id")
        if (!seenNodes.add(id)) out += Diagnostic(Severity.ERROR, CODE_DUPLICATE_ID, "Duplicate node id: $id")
    }
    val seenRels = mutableSetOf<String>()
    for (r in rels) {
        val id = r.optString("id")
        if (!seenRels.add(id)) out += Diagnostic(Severity.ERROR, CODE_DUPLICATE_ID, "Duplicate relationship id: $id")
    }
    return out
}

private fun checkRefIntegrity(nodes: List<JSONObject>, rels: List<JSONObject>): List<Diagnostic> {
    val nodeIds = nodes.map { it.optString("id") }.toSet()
    val out = mutableListOf<Diagnostic>()
    for (r in rels) {
        val id = r.optString("id")
        val from = r.optString("fromId")
        val to = r.optString("toId")
        if (from !in nodeIds) out += Diagnostic(Severity.ERROR, CODE_REF_INTEGRITY, "Relationship $id references unknown fromId \"$from\"")
        if (to !in nodeIds) out += Diagnostic(Severity.ERROR, CODE_REF_INTEGRITY, "Relationship $id references unknown toId \"$to\"")
    }
    return out
}

private fun checkRequiredFields(nodes: List<JSONObject>, rels: List<JSONObject>): List<Diagnostic> {
    val out = mutableListOf<Diagnostic>()
    for (n in nodes) {
        if (n.optString("id").isEmpty()) out += Diagnostic(Severity.ERROR, CODE_EMPTY_REQUIRED, "Node missing required id")
        if (n.optJSONObject("position") == null) {
            out += Diagnostic(Severity.ERROR, CODE_EMPTY_REQUIRED, "Node ${n.optString("id")} missing required position")
        }
    }
    for (r in rels) {
        val id = r.optString("id")
        if (id.isEmpty() || r.optString("fromId").isEmpty() || r.optString("toId").isEmpty() || r.optString("type").isEmpty()) {
            out += Diagnostic(Severity.ERROR, CODE_EMPTY_REQUIRED, "Relationship ${id.ifEmpty { "<no id>" }} missing required field(s) - id/fromId/toId/type")
        }
    }
    return out
}
