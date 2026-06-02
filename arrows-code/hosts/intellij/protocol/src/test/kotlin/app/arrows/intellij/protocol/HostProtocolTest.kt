package app.arrows.intellij.protocol

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * Mirrors the TypeScript host-protocol contract
 * (arrows-code/libs/host-protocol/src/lib/messages.spec.ts). A Kotlin host
 * cannot import the TS lib, so it must validate the same wire shapes itself.
 */
class HostProtocolTest {
    @Test
    fun parsesReadyIgnoringExtraFields() {
        assertEquals(
            InboundMessage.Ready,
            parseInboundMessage("""{"type":"ready","host":"intellij"}""")
        )
    }

    @Test
    fun parsesGraphChangedWithDocVersion() {
        assertEquals(
            InboundMessage.GraphChanged(GraphPayload(emptyList(), emptyList()), 7),
            parseInboundMessage("""{"type":"graph-changed","graph":{"nodes":[],"relationships":[]},"docVersion":7}""")
        )
    }

    @Test
    fun parsesGraphChangedWithoutDocVersion() {
        assertEquals(
            InboundMessage.GraphChanged(GraphPayload(listOf(mapOf("id" to "n0")), emptyList()), null),
            parseInboundMessage("""{"type":"graph-changed","graph":{"nodes":[{"id":"n0"}],"relationships":[]}}""")
        )
    }

    @Test
    fun rejectsGraphChangedWithBadGraph() {
        assertNull(parseInboundMessage("""{"type":"graph-changed","graph":{"nodes":"x"}}"""))
        assertNull(parseInboundMessage("""{"type":"graph-changed","graph":{}}"""))
        assertNull(parseInboundMessage("""{"type":"graph-changed"}"""))
    }

    @Test
    fun ignoresNonNumericDocVersion() {
        assertEquals(
            InboundMessage.GraphChanged(GraphPayload(emptyList(), emptyList()), null),
            parseInboundMessage("""{"type":"graph-changed","graph":{"nodes":[],"relationships":[]},"docVersion":"nope"}""")
        )
    }

    @Test
    fun parsesResponseWithRequestId() {
        assertEquals(
            InboundMessage.Response("svg-1", "<svg/>", null),
            parseInboundMessage("""{"type":"response","requestId":"svg-1","result":"<svg/>"}""")
        )
        assertEquals(
            InboundMessage.Response("svg-1", null, "boom"),
            parseInboundMessage("""{"type":"response","requestId":"svg-1","error":"boom"}""")
        )
    }

    @Test
    fun rejectsResponseWithoutStringRequestId() {
        assertNull(parseInboundMessage("""{"type":"response","result":"x"}"""))
        assertNull(parseInboundMessage("""{"type":"response","requestId":42}"""))
    }

    @Test
    fun parsesCommand() {
        assertEquals(
            InboundMessage.Command("arrows.validate"),
            parseInboundMessage("""{"type":"command","name":"arrows.validate"}""")
        )
    }

    @Test
    fun rejectsCommandWithoutName() {
        assertNull(parseInboundMessage("""{"type":"command"}"""))
    }

    @Test
    fun parsesOpenExternal() {
        assertEquals(
            InboundMessage.OpenExternal("https://neo4j.com"),
            parseInboundMessage("""{"type":"open-external","url":"https://neo4j.com"}""")
        )
    }

    @Test
    fun rejectsOpenExternalWithoutUrl() {
        assertNull(parseInboundMessage("""{"type":"open-external"}"""))
    }

    @Test
    fun parsesEmbedErrorWithOptionalFields() {
        assertEquals(
            InboundMessage.EmbedError("render failed", "stack"),
            parseInboundMessage("""{"type":"embed-error","message":"render failed","error":"stack"}""")
        )
        assertEquals(
            InboundMessage.EmbedError(null, null),
            parseInboundMessage("""{"type":"embed-error"}""")
        )
    }

    @Test
    fun returnsNullForUnknownAndNonObjectInput() {
        assertNull(parseInboundMessage("""{"type":"nope"}"""))
        assertNull(parseInboundMessage("""{}"""))
        assertNull(parseInboundMessage("null"))
        assertNull(parseInboundMessage("\"ready\""))
        assertNull(parseInboundMessage("not json"))
    }
}
