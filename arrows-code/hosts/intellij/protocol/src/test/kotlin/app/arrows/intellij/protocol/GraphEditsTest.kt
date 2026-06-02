package app.arrows.intellij.protocol

import org.json.JSONObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

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
        assertEquals(listOf("User"), out.getJSONArray("nodes").getJSONObject(0).getJSONArray("labels").toList())
        assertEquals(listOf("User", "Admin"), out.getJSONArray("nodes").getJSONObject(1).getJSONArray("labels").toList())
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
        assertEquals(listOf("Person"), out.getJSONArray("nodes").getJSONObject(1).getJSONArray("labels").toList())
    }

    @Test
    fun editsLeaveJsonWellFormed() {
        assertTrue(renameLabelInGraph(graph, "Nope", "X").contains("\"nodes\""))
    }
}

private fun org.json.JSONArray.toList(): List<String> = (0 until length()).map { getString(it) }
