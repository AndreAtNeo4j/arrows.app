package app.arrows.intellij.protocol

import org.json.JSONArray
import org.json.JSONException

/** A kebab-menu command. `icon` is a codicon name the embed renders as text. */
data class CommandEntry(val id: String, val title: String, val description: String, val icon: String)

/**
 * Parse the shared command catalog (host-protocol/commands.json) and keep the
 * embed-menu entries. One source for both hosts, so their kebabs can't diverge.
 */
fun parseCommandMenu(json: String): List<CommandEntry> {
    val arr = try { JSONArray(json) } catch (_: JSONException) { return emptyList() }
    val result = mutableListOf<CommandEntry>()
    for (i in 0 until arr.length()) {
        val o = arr.optJSONObject(i) ?: continue
        val embedMenu = o.optJSONObject("surface")?.optBoolean("embedMenu") == true
        if (o.optBoolean("webview") && embedMenu) {
            result.add(
                CommandEntry(
                    o.getString("id"),
                    o.getString("title"),
                    o.optString("description"),
                    o.optString("icon"),
                )
            )
        }
    }
    return result
}
