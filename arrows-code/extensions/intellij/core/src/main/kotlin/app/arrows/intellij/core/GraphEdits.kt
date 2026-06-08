package app.arrows.intellij.core

import org.json.JSONArray
import org.json.JSONObject
import java.net.URLDecoder
import java.util.Base64

private val IMPORT_JSON = Regex("""[#/]?/?import/json=([^&\s]+)""")
private const val MAX_IMPORT_BYTES = 4 * 1024 * 1024

private fun JSONArray.objects(): List<JSONObject> = (0 until length()).mapNotNull { optJSONObject(it) }
private fun JSONArray?.strings(): List<String> =
    if (this == null) emptyList() else (0 until length()).mapNotNull { optString(it).ifEmpty { null } }
private fun graphArray(json: String, key: String): JSONArray? =
    parseJsonObjectOrNull(json)?.optJSONArray(key)

fun parseImportInput(raw: String): String? {
    val trimmed = raw.trim()
    if (trimmed.isEmpty() || trimmed.length > MAX_IMPORT_BYTES) return null
    if (trimmed.startsWith("http", true) || "import/json=" in trimmed) {
        val encoded = IMPORT_JSON.find(trimmed)?.groupValues?.get(1) ?: return null
        val decoded = runCatching { String(Base64.getDecoder().decode(URLDecoder.decode(encoded, "UTF-8"))) }.getOrNull()
            ?: return null
        // The decoded base64 is fresh untrusted content written verbatim to disk by the caller:
        // re-apply the size cap to the decoded length and require it parses as a graph, matching
        // the raw-JSON branch (the encoded cap above bounds input, not the decoded output).
        return decoded.takeIf { it.length <= MAX_IMPORT_BYTES && it.trim().startsWith("{") && graphArray(it, "nodes") != null }
    }
    return if (trimmed.startsWith("{") && graphArray(trimmed, "nodes") != null) trimmed else null
}

fun labelsInGraph(json: String): List<String> =
    graphArray(json, "nodes")?.objects()?.flatMap { it.optJSONArray("labels").strings() }?.toSortedSet()?.toList() ?: emptyList()

fun relTypesInGraph(json: String): List<String> =
    graphArray(json, "relationships")?.objects()?.mapNotNull { it.optString("type").ifEmpty { null } }?.toSortedSet()?.toList() ?: emptyList()

private fun editGraph(json: String, key: String, edit: (JSONObject) -> Unit): String =
    JSONObject(json).also { it.optJSONArray(key)?.objects()?.forEach(edit) }.toString(2)

fun renameLabelInGraph(json: String, old: String, new: String): String = editGraph(json, "nodes") { node ->
    val labels = node.optJSONArray("labels") ?: return@editGraph
    node.put("labels", labels.strings().map { if (it == old) new else it }.distinct())
}

fun renameRelTypeInGraph(json: String, old: String, new: String): String = editGraph(json, "relationships") {
    if (it.optString("type") == old) it.put("type", new)
}
