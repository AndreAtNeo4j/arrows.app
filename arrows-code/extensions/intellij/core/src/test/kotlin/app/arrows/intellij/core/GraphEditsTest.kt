package app.arrows.intellij.core

import org.json.JSONObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class GraphEditsTest {
    private val graph = """
        {"nodes":[
          {"id":"n0","labels":["Person"],"position":{"x":0,"y":0}},
          {"id":"n1","labels":["Person","Admin"],"position":{"x":1,"y":1}}
        ],"relationships":[
          {"id":"r0","type":"KNOWS","fromId":"n0","toId":"n1"},
          {"id":"r1","type":"OWNS","fromId":"n1","toId":"n0"}
        ],"style":{}}
    """.trimIndent()

    @Test
    fun parsesRawGraphJson() {
        assertEquals(graph.trim(), parseImportInput(graph))
        assertNull(parseImportInput(""))
        assertNull(parseImportInput("{\"foo\":1}"))   // no nodes array
        assertNull(parseImportInput("not json"))
    }

    @Test
    fun roundTripsArrowsAppImportUrl() {
        val payload = """{"nodes":[],"relationships":[],"style":{}}"""
        val decoded = parseImportInput(arrowsAppImportUrl(payload))
        assertEquals(payload, decoded)
    }

    @Test
    fun listsLabelsAndRelTypesSortedAndDeduped() {
        assertEquals(listOf("Admin", "Person"), labelsInGraph(graph))
        assertEquals(listOf("KNOWS", "OWNS"), relTypesInGraph(graph))
    }

    @Test
    fun renamesLabelEverywhere() {
        val out = JSONObject(renameLabelInGraph(graph, "Person", "User"))
        assertEquals(listOf("User"), out.getJSONArray("nodes").getJSONObject(0).getJSONArray("labels").strings())
        assertEquals(listOf("User", "Admin"), out.getJSONArray("nodes").getJSONObject(1).getJSONArray("labels").strings())
    }

    @Test
    fun renamesRelTypeEverywhere() {
        val out = JSONObject(renameRelTypeInGraph(graph, "KNOWS", "FOLLOWS"))
        assertEquals("FOLLOWS", out.getJSONArray("relationships").getJSONObject(0).getString("type"))
        assertEquals("OWNS", out.getJSONArray("relationships").getJSONObject(1).getString("type"))
    }

    @Test
    fun renameDedupesWhenTargetAlreadyPresent() {
        val out = JSONObject(renameLabelInGraph(graph, "Admin", "Person"))
        assertEquals(listOf("Person"), out.getJSONArray("nodes").getJSONObject(1).getJSONArray("labels").strings())
    }

    @Test
    fun decodesArrowsAppShareUrlsAndRejectsJunk() {
        val payload = """{"nodes":[{"id":"n0","labels":["Person"]}],"relationships":[]}"""
        val url = arrowsAppImportUrl(payload)                                    // base64 here ends in '==' padding
        assertEquals(payload, parseImportInput(url))                             // exercises URLDecoder %3D path
        assertEquals(payload, parseImportInput(url.replace("https://", "http://"))) // http form accepted
        assertNull(parseImportInput("https://arrows.app/"))                      // no import fragment
        assertNull(parseImportInput("https://arrows.app/#/import/json=!!!notb64"))// invalid base64
        assertNull(parseImportInput("x".repeat(5 * 1024 * 1024)))                // over size cap
    }

    @Test
    fun rejectsShareUrlWhoseDecodedPayloadIsNotAGraph() {
        // The share-link branch writes the decoded bytes verbatim, so it must not accept a decode
        // that isn't actually a graph (no nodes array / not an object).
        assertNull(parseImportInput(arrowsAppImportUrl("\"just a string\"")))   // decodes to a JSON string
        assertNull(parseImportInput(arrowsAppImportUrl("""{"foo":1}""")))        // object, but no nodes array
    }
}

private fun org.json.JSONArray.strings(): List<String> = (0 until length()).map { getString(it) }
