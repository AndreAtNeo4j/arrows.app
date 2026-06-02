package app.arrows.intellij.protocol

import org.json.JSONException
import org.json.JSONObject

data class GraphPayload(val nodes: List<Any?>, val relationships: List<Any?>)

sealed interface InboundMessage {
    data object Ready : InboundMessage
    data class GraphChanged(val graph: GraphPayload, val docVersion: Int?) : InboundMessage
    data class Response(val requestId: String, val result: String?, val error: String?) : InboundMessage
    data class Command(val name: String) : InboundMessage
    data class OpenExternal(val url: String) : InboundMessage
    data class EmbedError(val message: String?, val error: String?) : InboundMessage
}

private fun JSONObject.stringOrNull(key: String): String? =
    if (opt(key) is String) getString(key) else null

fun parseInboundMessage(raw: String): InboundMessage? {
    val obj = try {
        JSONObject(raw)
    } catch (_: JSONException) {
        return null
    }

    return when (obj.opt("type")) {
        "ready" -> InboundMessage.Ready

        "graph-changed" -> {
            val graph = obj.optJSONObject("graph") ?: return null
            val nodes = graph.optJSONArray("nodes") ?: return null
            val relationships = graph.optJSONArray("relationships") ?: return null
            val docVersion = if (obj.opt("docVersion") is Number) obj.getInt("docVersion") else null
            InboundMessage.GraphChanged(GraphPayload(nodes.toList(), relationships.toList()), docVersion)
        }

        "response" -> {
            val requestId = obj.stringOrNull("requestId") ?: return null
            InboundMessage.Response(requestId, obj.stringOrNull("result"), obj.stringOrNull("error"))
        }

        "command" -> obj.stringOrNull("name")?.let(InboundMessage::Command)

        "open-external" -> obj.stringOrNull("url")?.let(InboundMessage::OpenExternal)

        "embed-error" -> InboundMessage.EmbedError(obj.stringOrNull("message"), obj.stringOrNull("error"))

        else -> null
    }
}
