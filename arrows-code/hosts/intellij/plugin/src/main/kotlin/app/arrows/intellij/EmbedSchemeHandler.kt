package app.arrows.intellij

import org.cef.browser.CefBrowser
import org.cef.browser.CefFrame
import org.cef.callback.CefCallback
import org.cef.callback.CefSchemeHandlerFactory
import org.cef.handler.CefResourceHandler
import org.cef.misc.IntRef
import org.cef.misc.StringRef
import org.cef.network.CefRequest
import org.cef.network.CefResponse
import java.io.InputStream
import java.net.URI

const val EMBED_HOST = "arrows.local"
const val EMBED_URL = "http://arrows.local/embed.html"

/**
 * Serves the embed bundle from the plugin classpath under /embed/. A custom
 * scheme gives the page a stable origin and fixes relative asset paths, which
 * file:// breaks (Chromium resolves relative URLs against the base + blocks CSP).
 */
class EmbedSchemeHandlerFactory : CefSchemeHandlerFactory {
    override fun create(browser: CefBrowser?, frame: CefFrame?, schemeName: String?, request: CefRequest?): CefResourceHandler =
        EmbedResourceHandler()
}

private class EmbedResourceHandler : CefResourceHandler {
    private var stream: InputStream? = null
    private var mime: String = "application/octet-stream"

    override fun processRequest(request: CefRequest, callback: CefCallback): Boolean {
        val path = URI(request.url).path.trimStart('/').ifEmpty { "embed.html" }
        stream = javaClass.getResourceAsStream("/embed/$path")
        mime = mimeFor(path)
        callback.Continue()
        return true
    }

    override fun getResponseHeaders(response: CefResponse, responseLength: IntRef, redirectUrl: StringRef) {
        if (stream == null) {
            response.status = 404
            responseLength.set(0)
            return
        }
        response.mimeType = mime
        response.status = 200
        responseLength.set(-1)
    }

    override fun readResponse(dataOut: ByteArray, bytesToRead: Int, bytesRead: IntRef, callback: CefCallback): Boolean {
        val s = stream ?: run { bytesRead.set(0); return false }
        val n = s.read(dataOut, 0, bytesToRead)
        return if (n <= 0) {
            bytesRead.set(0)
            s.close()
            stream = null
            false
        } else {
            bytesRead.set(n)
            true
        }
    }

    override fun cancel() {
        stream?.close()
        stream = null
    }
}

private fun mimeFor(path: String): String = when (path.substringAfterLast('.')) {
    "html" -> "text/html"
    "js" -> "text/javascript"
    "css" -> "text/css"
    "svg" -> "image/svg+xml"
    "png" -> "image/png"
    "ico" -> "image/x-icon"
    "woff2" -> "font/woff2"
    "woff" -> "font/woff"
    else -> "application/octet-stream"
}
