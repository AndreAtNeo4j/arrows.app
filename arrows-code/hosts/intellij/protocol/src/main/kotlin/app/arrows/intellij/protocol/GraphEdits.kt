package app.arrows.intellij.protocol

import org.json.JSONArray
import org.json.JSONObject
import java.net.URLDecoder
import java.util.Base64

// Pure .arrows JSON edits (import, rename), reimplemented in Kotlin since the TS graph-logic can't be shared.

private val IMPORT_JSON = Regex("""[#/]?/?import/json=([^&\s]+)""")
private const val MAX_IMPORT_BYTES = 4 * 1024 * 1024

/** Inverse of [arrowsAppImportUrl]: decode an arrows.app share URL or accept raw graph JSON. */
fun parseImportInput(raw: String): String? {
    val trimmed = raw.trim()
    if (trimmed.isEmpty() || trimmed.length > MAX_IMPORT_BYTES) return null
    if (trimmed.startsWith("http://", true) || trimmed.startsWith("https://", true) || trimmed.contains("import/json=")) {
        val encoded = IMPORT_JSON.find(trimmed)?.groupValues?.get(1) ?: return null
        return runCatching { String(Base64.getDecoder().decode(URLDecoder.decode(encoded, "UTF-8"))) }.getOrNull()
    }
    if (trimmed.startsWith("{")) {
        return runCatching { if (JSONObject(trimmed).optJSONArray("nodes") != null) trimmed else null }.getOrNull()
    }
    return null
}

fun labelsInGraph(json: String): List<String> {
    val nodes = runCatching { JSONObject(json).optJSONArray("nodes") }.getOrNull() ?: return emptyList()
    val out = sortedSetOf<String>()
    for (i in 0 until nodes.length()) {
        val labels = nodes.optJSONObject(i)?.optJSONArray("labels") ?: continue
        for (j in 0 until labels.length()) labels.optString(j).takeIf { it.isNotEmpty() }?.let(out::add)
    }
    return out.toList()
}

fun relTypesInGraph(json: String): List<String> {
    val rels = runCatching { JSONObject(json).optJSONArray("relationships") }.getOrNull() ?: return emptyList()
    val out = sortedSetOf<String>()
    for (i in 0 until rels.length()) {
        rels.optJSONObject(i)?.optString("type")?.takeIf { it.isNotEmpty() }?.let(out::add)
    }
    return out.toList()
}

/** Replace a label across every node's `labels` array (matches graph-logic's renameLabel op). */
fun renameLabelInGraph(json: String, old: String, new: String): String {
    val root = JSONObject(json)
    val nodes = root.optJSONArray("nodes") ?: return json
    for (i in 0 until nodes.length()) {
        val node = nodes.optJSONObject(i) ?: continue
        val labels = node.optJSONArray("labels") ?: continue
        val renamed = JSONArray()
        val seen = mutableSetOf<String>()
        for (j in 0 until labels.length()) {
            val next = labels.optString(j).let { if (it == old) new else it }
            if (seen.add(next)) renamed.put(next)
        }
        node.put("labels", renamed)
    }
    return root.toString(2)
}

/** Replace a relationship type across every relationship (matches graph-logic's renameRelType op). */
fun renameRelTypeInGraph(json: String, old: String, new: String): String {
    val root = JSONObject(json)
    val rels = root.optJSONArray("relationships") ?: return json
    for (i in 0 until rels.length()) {
        val rel = rels.optJSONObject(i) ?: continue
        if (rel.optString("type") == old) rel.put("type", new)
    }
    return root.toString(2)
}
