package app.arrows.intellij

import app.arrows.intellij.protocol.GraphPayload
import app.arrows.intellij.protocol.HostActions
import app.arrows.intellij.protocol.dispatchInbound
import com.intellij.ide.BrowserUtil
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.command.WriteCommandAction
import com.intellij.openapi.diagnostic.thisLogger
import com.intellij.openapi.editor.Document
import com.intellij.openapi.editor.event.DocumentEvent
import com.intellij.openapi.editor.event.DocumentListener
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.fileEditor.FileEditor
import com.intellij.openapi.fileEditor.FileEditorState
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.util.UserDataHolderBase
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.ui.jcef.JBCefApp
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.ui.jcef.JBCefBrowserBase
import com.intellij.ui.jcef.JBCefJSQuery
import org.cef.CefApp
import org.cef.browser.CefBrowser
import org.cef.browser.CefFrame
import org.cef.handler.CefLoadHandlerAdapter
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.beans.PropertyChangeListener
import javax.swing.JComponent
import javax.swing.JLabel

/**
 * The arrows canvas in an editor tab. Loads the shared embed bundle in JCEF and
 * relays the same postMessage protocol the VS Code host uses, parsed by the
 * shared :protocol module. Feature logic lives in the bundle; this is transport.
 */
class ArrowsFileEditor(
    private val project: Project,
    private val file: VirtualFile,
) : UserDataHolderBase(), FileEditor, HostActions {

    private val document: Document? = FileDocumentManager.getInstance().getDocument(file)
    private val browser: JBCefBrowser? = if (JBCefApp.isSupported()) JBCefBrowser() else null
    private val jsQuery: JBCefJSQuery? = browser?.let { JBCefJSQuery.create(it as JBCefBrowserBase) }
    private val fallback = JLabel("JCEF is unavailable in this IDE runtime; cannot render the arrows canvas.")

    @Volatile private var applyingHostEdit = false

    init {
        val b = browser
        val q = jsQuery
        if (b != null && q != null) {
            registerSchemeHandler()
            q.addHandler { raw -> dispatchInbound(raw, this); null }
            b.jbCefClient.addLoadHandler(object : CefLoadHandlerAdapter() {
                override fun onLoadEnd(browser: CefBrowser?, frame: CefFrame?, httpStatusCode: Int) {
                    injectBridge()
                    sendLoad()
                }
            }, b.cefBrowser)
            document?.addDocumentListener(object : DocumentListener {
                override fun documentChanged(event: DocumentEvent) {
                    if (!applyingHostEdit) sendLoad()
                }
            }, this)
            b.loadURL(EMBED_URL)
        }
    }

    private fun injectBridge() {
        val q = jsQuery ?: return
        // Forward window.postMessage to the JVM; host->embed messages we post back are inert to the inbound parser, so no loop.
        val js = """
            window.__arrowsToHost = function(payload) { ${q.inject("payload")} };
            window.addEventListener('message', function(e) {
                try { window.__arrowsToHost(JSON.stringify(e.data)); } catch (err) {}
            });
        """.trimIndent()
        browser?.cefBrowser?.executeJavaScript(js, EMBED_URL, 0)
    }

    private fun sendLoad() {
        // JCEF callbacks fire off the EDT; hop to it before reading the Document.
        ApplicationManager.getApplication().invokeLater {
            val doc = document ?: return@invokeLater
            val graph = try { JSONObject(doc.text) } catch (e: JSONException) { return@invokeLater }
            val message = JSONObject()
                .put("type", "load")
                .put("graph", graph)
                .put("docVersion", doc.modificationStamp)
                .put("menu", JSONArray())
            browser?.cefBrowser?.executeJavaScript("window.postMessage($message, '*');", EMBED_URL, 0)
        }
    }

    override fun onReady() = sendLoad()

    override fun onGraphChanged(graph: GraphPayload, docVersion: Int?) {
        val doc = document ?: return
        // Write the graph back verbatim - preserves style and every top-level
        // field. (Canonical key ordering would need the bundle to emit it.)
        val nextText = JSONObject(graph.raw).toString(2)
        ApplicationManager.getApplication().invokeLater {
            if (project.isDisposed || doc.text == nextText) return@invokeLater
            applyingHostEdit = true
            try {
                WriteCommandAction.runWriteCommandAction(project) { doc.setText(nextText) }
            } finally {
                applyingHostEdit = false
            }
        }
    }

    override fun onResponse(requestId: String, result: String?, error: String?) {} // no outbound requests issued yet
    override fun onCommand(name: String) = thisLogger().warn("arrows: unhandled embed command '$name'")
    override fun onOpenExternal(url: String) = BrowserUtil.browse(url)
    override fun onEmbedError(message: String?, error: String?) =
        thisLogger().warn("arrows embed error: ${message.orEmpty()} ${error.orEmpty()}".trim())

    override fun getComponent(): JComponent = browser?.component ?: fallback
    override fun getPreferredFocusedComponent(): JComponent = component
    override fun getName(): String = "Arrows"
    override fun setState(state: FileEditorState) {}
    override fun isModified(): Boolean = false
    override fun isValid(): Boolean = true
    override fun addPropertyChangeListener(listener: PropertyChangeListener) {}
    override fun removePropertyChangeListener(listener: PropertyChangeListener) {}
    override fun getFile(): VirtualFile = file

    override fun dispose() {
        jsQuery?.let { Disposer.dispose(it) }
        browser?.let { Disposer.dispose(it) }
    }

    private companion object {
        @Volatile private var schemeRegistered = false

        fun registerSchemeHandler() {
            if (schemeRegistered) return
            synchronized(this) {
                if (schemeRegistered) return
                CefApp.getInstance().registerSchemeHandlerFactory("http", EMBED_HOST, EmbedSchemeHandlerFactory())
                schemeRegistered = true
            }
        }
    }
}
