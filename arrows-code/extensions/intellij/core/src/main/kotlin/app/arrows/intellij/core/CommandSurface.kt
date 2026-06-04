package app.arrows.intellij.core

import org.json.JSONArray
import org.json.JSONException

data class CommandEntry(val id: String, val title: String, val description: String, val icon: String)

fun parseCommandMenu(json: String): List<CommandEntry> {
    val arr = try { JSONArray(json) } catch (_: JSONException) { return emptyList() }
    return (0 until arr.length()).mapNotNull { arr.optJSONObject(it) }
        .filter { it.optBoolean("webview") && it.optJSONObject("surface")?.optBoolean("embedMenu") == true }
        .mapNotNull {
            val id = it.optString("id")
            val title = it.optString("title")
            if (id.isEmpty() || title.isEmpty()) null
            else CommandEntry(id, title, it.optString("description"), it.optString("icon"))
        }
}

// openSource is the one dropped command — a 2nd (text) editor trips a platform NPE (see ArrowsFileEditorProvider).
val SUPPORTED_EMBED_COMMANDS = setOf(
    "arrows.validate", "arrows.format", "arrows.copyCypher", "arrows.exportCypher", "arrows.exportSvg",
    "arrows.exportGraphQL", "arrows.openInArrowsApp", "arrows.renameLabel", "arrows.renameRelType",
)

fun supportedEmbedMenu(entries: List<CommandEntry>): List<CommandEntry> =
    entries.filter { it.id in SUPPORTED_EMBED_COMMANDS }
