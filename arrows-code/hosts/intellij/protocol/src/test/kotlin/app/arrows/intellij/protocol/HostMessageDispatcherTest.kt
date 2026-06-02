package app.arrows.intellij.protocol

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

private class RecordingHost : HostActions {
    val calls = mutableListOf<String>()
    override fun onReady() { calls += "ready" }
    override fun onGraphChanged(graph: GraphPayload, docVersion: Int?) { calls += "graph:${graph.nodes.size}:${docVersion}" }
    override fun onResponse(requestId: String, result: String?, error: String?) { calls += "response:$requestId:$result:$error" }
    override fun onCommand(name: String) { calls += "command:$name" }
    override fun onOpenExternal(url: String) { calls += "open:$url" }
    override fun onEmbedError(message: String?, error: String?) { calls += "error:$message:$error" }
}

class HostMessageDispatcherTest {
    @Test
    fun routesReady() {
        val host = RecordingHost()
        assertTrue(dispatchInbound("""{"type":"ready"}""", host))
        assertEquals(listOf("ready"), host.calls)
    }

    @Test
    fun routesGraphChangedWithDocVersion() {
        val host = RecordingHost()
        assertTrue(dispatchInbound("""{"type":"graph-changed","graph":{"nodes":[{"id":"n0"}],"relationships":[]},"docVersion":3}""", host))
        assertEquals(listOf("graph:1:3"), host.calls)
    }

    @Test
    fun routesResponse() {
        val host = RecordingHost()
        assertTrue(dispatchInbound("""{"type":"response","requestId":"svg-1","result":"<svg/>"}""", host))
        assertEquals(listOf("response:svg-1:<svg/>:null"), host.calls)
    }

    @Test
    fun routesCommand() {
        val host = RecordingHost()
        assertTrue(dispatchInbound("""{"type":"command","name":"arrows.validate"}""", host))
        assertEquals(listOf("command:arrows.validate"), host.calls)
    }

    @Test
    fun routesOpenExternal() {
        val host = RecordingHost()
        assertTrue(dispatchInbound("""{"type":"open-external","url":"https://neo4j.com"}""", host))
        assertEquals(listOf("open:https://neo4j.com"), host.calls)
    }

    @Test
    fun routesEmbedError() {
        val host = RecordingHost()
        assertTrue(dispatchInbound("""{"type":"embed-error","message":"boom"}""", host))
        assertEquals(listOf("error:boom:null"), host.calls)
    }

    @Test
    fun returnsFalseAndDoesNothingForUnparseableMessage() {
        val host = RecordingHost()
        assertFalse(dispatchInbound("""{"type":"nope"}""", host))
        assertFalse(dispatchInbound("not json", host))
        assertTrue(host.calls.isEmpty())
    }
}
