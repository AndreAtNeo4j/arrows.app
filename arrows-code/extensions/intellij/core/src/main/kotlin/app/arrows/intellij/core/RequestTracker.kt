package app.arrows.intellij.core

import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

// Thread-safe: responses arrive on the JCEF thread, requests are created on the EDT.
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
