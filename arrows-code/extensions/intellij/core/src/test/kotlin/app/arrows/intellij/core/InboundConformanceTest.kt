package app.arrows.intellij.core

import org.json.JSONArray
import org.json.JSONObject
import kotlin.test.Test
import kotlin.test.assertEquals

// Runs the Kotlin parser against the shared TS fixtures (messages/fixtures); fails if the two parsers drift.
class InboundConformanceTest {
    private fun coerce(o: JSONObject): Map<String, Any?> =
        o.keys().asSequence().associateWith { k ->
            val v = o.get(k)
            when {
                v === JSONObject.NULL -> null
                v is Number -> v.toLong()
                else -> v
            }
        }

    private fun normalize(m: InboundMessage?): Map<String, Any?>? = when (m) {
        null -> null
        is InboundMessage.Ready -> mapOf("type" to "ready")
        is InboundMessage.GraphChanged -> mapOf(
            "type" to "graph-changed",
            "nodeCount" to ((m.graph.raw["nodes"] as? List<*>)?.size?.toLong() ?: 0L),
            "relCount" to ((m.graph.raw["relationships"] as? List<*>)?.size?.toLong() ?: 0L),
            "docVersion" to m.docVersion?.toLong(),
        )
        is InboundMessage.Response -> mapOf("type" to "response", "requestId" to m.requestId, "result" to m.result, "error" to m.error)
        is InboundMessage.Command -> mapOf("type" to "command", "name" to m.name)
        is InboundMessage.OpenExternal -> mapOf("type" to "open-external", "url" to m.url)
        is InboundMessage.EmbedError -> mapOf("type" to "embed-error", "message" to m.message, "error" to m.error)
    }

    @Test
    fun matchesSharedFixtures() {
        val json = javaClass.getResourceAsStream("/inbound-messages.json")!!.bufferedReader().use { it.readText() }
        val cases = JSONArray(json)
        for (i in 0 until cases.length()) {
            val case = cases.getJSONObject(i)
            val expect = if (case.isNull("expect")) null else coerce(case.getJSONObject("expect"))
            val actual = normalize(parseInboundMessage(case.getJSONObject("raw").toString()))
            assertEquals(expect, actual, "fixture: ${case.getString("name")}")
        }
    }
}
