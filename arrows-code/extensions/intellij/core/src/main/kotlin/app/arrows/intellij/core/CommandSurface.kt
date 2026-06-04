package app.arrows.intellij.core

import org.json.JSONArray
import org.json.JSONException

/** A kebab command; `icon` is a codicon name the embed renders. */
data class CommandEntry(val id: String, val title: String, val description: String, val icon: String)

// Parsed from the shared commands.json so both hosts render the same kebab.
fun parseCommandMenu(json: String): List<CommandEntry> {
    val arr = try { JSONArray(json) } catch (_: JSONException) { return emptyList() }
    return (0 until arr.length()).mapNotNull { arr.optJSONObject(it) }
        .filter { it.optBoolean("webview") && it.optJSONObject("surface")?.optBoolean("embedMenu") == true }
        .map { CommandEntry(it.getString("id"), it.getString("title"), it.optString("description"), it.optString("icon")) }
}

// openSource needs a 2nd editor on the file (platform NPE + per-file "open as JSON" drift), so
// it's the one kebab command dropped. validate/format/rename are reimplemented as Kotlin JSON ops.
val SUPPORTED_EMBED_COMMANDS = setOf(
    "arrows.validate", "arrows.format", "arrows.copyCypher", "arrows.exportCypher", "arrows.exportSvg",
    "arrows.exportGraphQL", "arrows.openInArrowsApp", "arrows.renameLabel", "arrows.renameRelType",
)

fun supportedEmbedMenu(entries: List<CommandEntry>): List<CommandEntry> =
    entries.filter { it.id in SUPPORTED_EMBED_COMMANDS }
