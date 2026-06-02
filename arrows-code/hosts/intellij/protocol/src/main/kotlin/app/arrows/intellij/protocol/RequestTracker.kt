package app.arrows.intellij.protocol

import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * Correlates host -> embed `request` messages with their `response` replies,
 * the JVM counterpart of the VS Code makeRequester. Thread-safe: responses
 * arrive on the JCEF thread, requests are created on the EDT. Unanswered
 * requests fail after [timeoutMs] so a wedged embed can't leak futures forever.
 */
class RequestTracker(private val timeoutMs: Long = 10_000) {
    private val pending = ConcurrentHashMap<String, CompletableFuture<String>>()
    private val counter = AtomicInteger()

    fun create(kind: String): Pair<String, CompletableFuture<String>> {
        val id = "$kind-${counter.incrementAndGet()}"
        val future = CompletableFuture<String>()
        pending[id] = future
        if (timeoutMs > 0) future.orTimeout(timeoutMs, TimeUnit.MILLISECONDS)
        future.whenComplete { _, _ -> pending.remove(id) }
        return id to future
    }

    fun resolve(requestId: String, result: String?, error: String?) {
        val future = pending.remove(requestId) ?: return
        if (result != null) future.complete(result)
        else future.completeExceptionally(RuntimeException(error ?: "request failed"))
    }
}
