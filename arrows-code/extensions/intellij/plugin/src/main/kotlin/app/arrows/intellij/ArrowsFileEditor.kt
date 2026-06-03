package app.arrows.intellij

import app.arrows.intellij.core.CommandEntry
import app.arrows.intellij.core.GraphPayload
import app.arrows.intellij.core.HostActions
import app.arrows.intellij.core.RequestTracker
import app.arrows.intellij.core.CYPHER_CLAUSES
import app.arrows.intellij.core.arrowsAppShare
import app.arrows.intellij.core.dispatchInbound
import app.arrows.intellij.core.isAllowedExternalUrl
import app.arrows.intellij.core.labelsInGraph
import app.arrows.intellij.core.parseCommandMenu
import app.arrows.intellij.core.relTypesInGraph
import app.arrows.intellij.core.renameLabelInGraph
import app.arrows.intellij.core.renameRelTypeInGraph
import app.arrows.intellij.core.supportedEmbedMenu
import app.arrows.intellij.core.TUTORIAL_URL
import com.intellij.ide.BrowserUtil
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.command.WriteCommandAction
import com.intellij.openapi.diagnostic.thisLogger
import com.intellij.openapi.fileChooser.FileChooserFactory
import com.intellij.openapi.fileChooser.FileSaverDescriptor
import com.intellij.openapi.editor.Document
import com.intellij.openapi.editor.event.DocumentEvent
import com.intellij.openapi.editor.event.DocumentListener
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.fileEditor.FileEditor
import com.intellij.openapi.fileEditor.FileEditorState
import com.intellij.openapi.ide.CopyPasteManager
import com.intellij.openapi.ui.Messages
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
import java.awt.datatransfer.StringSelection
import java.beans.PropertyChangeListener
import java.util.concurrent.CompletableFuture
import javax.swing.JComponent
import javax.swing.JLabel

// The arrows canvas in a JCEF editor tab. Transport only — feature logic lives in the embed bundle.
class ArrowsFileEditor(
    private val project: Project,
    private val file: VirtualFile,
) : UserDataHolderBase(), FileEditor, HostActions {

    private val document: Document? = FileDocumentManager.getInstance().getDocument(file)
    // Windowed (native, GPU-composited): the default OSR bitmaps each frame onto the EDT — laggy dragging on HiDPI.
    private val browser: JBCefBrowser? =
        if (JBCefApp.isSupported()) JBCefBrowser.createBuilder().setOffScreenRendering(false).build() else null
    private val jsQuery: JBCefJSQuery? = browser?.let { JBCefJSQuery.create(it as JBCefBrowserBase) }
    private val fallback = JLabel("JCEF is unavailable in this IDE runtime; cannot render the arrows canvas.")

    private val requests = RequestTracker()
    private val commandMenu: List<CommandEntry> = loadCommandMenu()

    @Volatile private var applyingHostEdit = false

    init {
        val b = browser
        val q = jsQuery
        if (b != null && q != null) {
            registerSchemeHandler()
            q.addHandler { raw ->
                if (!dispatchInbound(raw, this)) thisLogger().warn("arrows: unrecognized message from embed: $raw")
                null
            }
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
        // host->embed messages we post back are inert to the inbound parser, so no loop.
        val js = """
            window.__arrowsToHost = function(payload) { ${q.inject("payload")} };
            window.addEventListener('message', function(e) {
                if (e.source !== window) return;
                try { window.__arrowsToHost(JSON.stringify(e.data)); } catch (err) {}
            });
        """.trimIndent()
        browser?.cefBrowser?.executeJavaScript(js, EMBED_URL, 0)
    }

    private fun sendLoad() {
        // JCEF callbacks fire off the EDT; hop to it before reading the Document.
        ApplicationManager.getApplication().invokeLater {
            val doc = document ?: return@invokeLater
            val graph = try { JSONObject(doc.text) } catch (e: JSONException) {
                thisLogger().warn("arrows: document is not valid JSON; canvas not updated"); return@invokeLater
            }
            val message = JSONObject()
                .put("type", "load")
                .put("graph", graph)
                .put("docVersion", doc.modificationStamp)
                .put("menu", menuPayload())
            browser?.cefBrowser?.executeJavaScript("window.postMessage($message, '*');", EMBED_URL, 0)
        }
    }

    private fun loadCommandMenu(): List<CommandEntry> {
        val json = javaClass.getResourceAsStream("/commands.json")
            ?.bufferedReader()?.use { it.readText() } ?: return emptyList()
        return supportedEmbedMenu(parseCommandMenu(json))
    }

    private fun menuPayload(): JSONArray = JSONArray(commandMenu.map {
        JSONObject().put("id", it.id).put("title", it.title).put("description", it.description).put("icon", it.icon)
    })

    private fun requestFromEmbed(kind: String, payload: JSONObject?): CompletableFuture<String> {
        val (id, future) = requests.create(kind)
        val msg = JSONObject().put("type", "request").put("kind", kind).put("requestId", id)
        if (payload != null) msg.put("payload", payload)
        browser?.cefBrowser?.executeJavaScript("window.postMessage($msg, '*');", EMBED_URL, 0)
        return future
    }

    private fun export(kind: String, payload: JSONObject?, ext: String, label: String) {
        requestFromEmbed(kind, payload).whenComplete { result, err ->
            ApplicationManager.getApplication().invokeLater {
                if (err != null || result == null) {
                    thisLogger().warn("arrows $label export failed: ${err?.message ?: "no result"}")
                    Messages.showErrorDialog(project, "Couldn't generate the $label export (the canvas didn't respond).", "Arrows")
                    return@invokeLater
                }
                val descriptor = FileSaverDescriptor("Save $label", "", ext)
                val wrapper = FileChooserFactory.getInstance()
                    .createSaveFileDialog(descriptor, project)
                    .save(file.parent, "${file.nameWithoutExtension}.$ext") ?: return@invokeLater
                wrapper.file.writeText(result)
            }
        }
    }

    private fun openInArrowsApp() {
        ApplicationManager.getApplication().invokeLater {
            val text = document?.text ?: return@invokeLater
            val share = arrowsAppShare(text) ?: run {
                Messages.showWarningDialog(project, "This graph doesn't parse cleanly; can't open it in arrows.app.", "Open in arrows.app")
                return@invokeLater
            }
            if (share.second && Messages.showOkCancelDialog(
                    project, "This graph is large; some browsers may reject the URL.",
                    "Open in arrows.app", "Open anyway", "Cancel", null,
                ) != Messages.OK
            ) return@invokeLater
            BrowserUtil.browse(share.first)
        }
    }

    override fun onReady() = sendLoad()

    override fun onGraphChanged(graph: GraphPayload, docVersion: Long?) {
        val doc = document ?: return
        // Write back verbatim to preserve style and top-level fields.
        val nextText = try { JSONObject(graph.raw).toString(2) } catch (e: JSONException) {
            thisLogger().warn("arrows: graph-changed payload didn't serialize; not written", e); return
        }
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

    override fun onResponse(requestId: String, result: String?, error: String?) = requests.resolve(requestId, result, error)

    override fun onCommand(name: String) {
        when (name) {
            "arrows.openInArrowsApp" -> openInArrowsApp()
            "arrows.openTutorial" -> onOpenExternal(TUTORIAL_URL)
            "arrows.exportSvg" -> export("svg", null, "svg", "SVG")
            "arrows.exportGraphQL" -> export("graphql", null, "graphql", "GraphQL")
            "arrows.exportCypher" -> withCypherClause { export("cypher", JSONObject().put("keyword", it), "cypher", "Cypher") }
            "arrows.copyCypher" -> withCypherClause { copyCypher(it) }
            "arrows.renameLabel" -> renameIn("Rename Label", "label", ::labelsInGraph, ::renameLabelInGraph)
            "arrows.renameRelType" -> renameIn("Rename Relationship Type", "relationship type", ::relTypesInGraph, ::renameRelTypeInGraph)
            else -> thisLogger().warn("arrows: unhandled embed command '$name'")
        }
    }

    private fun withCypherClause(then: (String) -> Unit) {
        ApplicationManager.getApplication().invokeLater {
            val clause = Messages.showEditableChooseDialog(
                "Cypher clause", "Cypher", null,
                CYPHER_CLAUSES.toTypedArray(), CYPHER_CLAUSES.first(), null,
            ) ?: return@invokeLater
            then(clause)
        }
    }

    // Rename a label / relationship type everywhere — a plain JSON edit (no graph-logic).
    private fun renameIn(
        title: String,
        noun: String,
        values: (String) -> List<String>,
        rewrite: (String, String, String) -> String,
    ) {
        ApplicationManager.getApplication().invokeLater {
            val doc = document ?: return@invokeLater
            val text = doc.text
            if (runCatching { JSONObject(text) }.isFailure) {
                Messages.showWarningDialog(project, "This graph doesn't parse cleanly.", title)
                return@invokeLater
            }
            val options = values(text)
            if (options.isEmpty()) {
                Messages.showInfoMessage(project, "No ${noun}s in this graph.", title)
                return@invokeLater
            }
            val old = Messages.showEditableChooseDialog(
                "$noun to rename", title, null, options.toTypedArray(), options.first(), null,
            ) ?: return@invokeLater
            val new = Messages.showInputDialog(project, "Rename \"$old\" to", title, null, old, null)
                ?.trim()?.takeIf { it.isNotEmpty() && it != old } ?: return@invokeLater
            val next = rewrite(text, old, new)
            if (next != text) WriteCommandAction.runWriteCommandAction(project) { doc.setText(next) }
        }
    }

    private fun copyCypher(clause: String) {
        requestFromEmbed("cypher", JSONObject().put("keyword", clause)).whenComplete { result, err ->
            ApplicationManager.getApplication().invokeLater {
                if (err != null || result == null) {
                    thisLogger().warn("arrows copy Cypher failed: ${err?.message ?: "no result"}")
                    Messages.showErrorDialog(project, "Couldn't copy Cypher (the canvas didn't respond).", "Arrows")
                } else CopyPasteManager.getInstance().setContents(StringSelection(result))
            }
        }
    }

    override fun onOpenExternal(url: String) {
        if (isAllowedExternalUrl(url)) BrowserUtil.browse(url)
        else thisLogger().warn("arrows: refusing to open external url: $url")
    }
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
