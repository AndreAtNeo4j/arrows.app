package app.arrows.intellij.core

import org.json.JSONObject

data class GraphPayload(val raw: Map<String, Any?>)

// Embed→host half of the postMessage contract for the JVM host (mirrors the TS libs/messages shapes).
// parseInboundMessage is the trust boundary: untrusted JCEF JSON in, a closed InboundMessage out, null
// on anything malformed — callers branch on the sealed type and never see a partial or throwing parse.
sealed interface InboundMessage {
    data object Ready : InboundMessage
    data class GraphChanged(val graph: GraphPayload, val docVersion: Long?) : InboundMessage
    data class Response(val requestId: String, val result: String?, val error: String?) : InboundMessage
    data class Command(val name: String) : InboundMessage
    data class OpenExternal(val url: String) : InboundMessage
    data class EmbedError(val message: String?, val error: String?) : InboundMessage
}

private fun JSONObject.stringOrNull(key: String): String? =
    if (opt(key) is String) getString(key) else null

fun parseInboundMessage(raw: String): InboundMessage? {
    val obj = parseJsonObjectOrNull(raw) ?: return null
    return when (obj.opt("type")) {
        "ready" -> InboundMessage.Ready
        "graph-changed" -> {
            val graph = obj.optJSONObject("graph") ?: return null
            if (graph.optJSONArray("nodes") == null || graph.optJSONArray("relationships") == null) return null
            val docVersion = if (obj.opt("docVersion") is Number) obj.getLong("docVersion") else null
            InboundMessage.GraphChanged(GraphPayload(graph.toMap()), docVersion)
        }
        "response" -> obj.stringOrNull("requestId")?.let {
            InboundMessage.Response(it, obj.stringOrNull("result"), obj.stringOrNull("error"))
        }
        "command" -> obj.stringOrNull("name")?.let(InboundMessage::Command)
        "open-external" -> obj.stringOrNull("url")?.let(InboundMessage::OpenExternal)
        "embed-error" -> InboundMessage.EmbedError(obj.stringOrNull("message"), obj.stringOrNull("error"))
        else -> null
    }
}
