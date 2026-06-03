package app.arrows.intellij.core

interface HostActions {
    fun onReady()
    fun onGraphChanged(graph: GraphPayload, docVersion: Long?)
    fun onResponse(requestId: String, result: String?, error: String?)
    fun onCommand(name: String)
    fun onOpenExternal(url: String)
    fun onEmbedError(message: String?, error: String?)
}

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
