package app.arrows.intellij.protocol

/**
 * Host-side reactions to embed -> host messages. The IntelliJ FileEditor
 * implements this against the Document, JCEF browser, and platform services.
 * Mirrors the dispatch the VS Code PreviewProvider does inline.
 */
interface HostActions {
    fun onReady()
    fun onGraphChanged(graph: GraphPayload, docVersion: Int?)
    fun onResponse(requestId: String, result: String?, error: String?)
    fun onCommand(name: String)
    fun onOpenExternal(url: String)
    fun onEmbedError(message: String?, error: String?)
}

/** Parse one raw message and route it. Returns false if it wasn't a valid message. */
fun dispatchInbound(raw: String, actions: HostActions): Boolean {
    when (val msg = parseInboundMessage(raw) ?: return false) {
        is InboundMessage.Ready -> actions.onReady()
        is InboundMessage.GraphChanged -> actions.onGraphChanged(msg.graph, msg.docVersion)
        is InboundMessage.Response -> actions.onResponse(msg.requestId, msg.result, msg.error)
        is InboundMessage.Command -> actions.onCommand(msg.name)
        is InboundMessage.OpenExternal -> actions.onOpenExternal(msg.url)
        is InboundMessage.EmbedError -> actions.onEmbedError(msg.message, msg.error)
    }
    return true
}
