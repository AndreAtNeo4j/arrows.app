package app.arrows.intellij

import com.intellij.icons.AllIcons
import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.DefaultActionGroup
import com.intellij.openapi.command.WriteCommandAction
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.roots.ProjectRootManager
import com.intellij.openapi.ui.Messages
import com.intellij.openapi.ui.SimpleToolWindowPanel
import com.intellij.openapi.vfs.VfsUtil
import com.intellij.openapi.vfs.VfsUtilCore
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.ColoredTreeCellRenderer
import com.intellij.ui.DoubleClickListener
import com.intellij.ui.SimpleTextAttributes
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.treeStructure.Tree
import javax.swing.JTree
import javax.swing.tree.DefaultMutableTreeNode
import javax.swing.tree.DefaultTreeModel
import javax.swing.tree.TreeSelectionModel

private const val NEW_GRAPH_TEMPLATE = """{
  "nodes": [],
  "relationships": [],
  "style": {}
}
"""

// Bundled under plugin resources /examples/ (copied from fixtures/examples at build time).
private val EXAMPLE_NAMES = listOf(
    "citations", "iam-rbac", "lexical-graph", "microservices", "order-lifecycle", "social",
)

class ArrowsToolWindowFactory : ToolWindowFactory, DumbAware {
    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val panel = ArrowsToolWindowPanel(project)
        toolWindow.contentManager.addContent(
            com.intellij.ui.content.ContentFactory.getInstance().createContent(panel, "", false)
        )
    }
}

private sealed interface Node {
    data class Section(val label: String) : Node
    data class Action(val label: String, val run: () -> Unit) : Node
    data class FileEntry(val file: VirtualFile) : Node
    data class Example(val name: String) : Node
    data class Empty(val label: String) : Node
}

private class ArrowsToolWindowPanel(private val project: Project) : SimpleToolWindowPanel(true, true) {
    private val root = DefaultMutableTreeNode()
    private val model = DefaultTreeModel(root)
    private val tree = Tree(model).apply {
        isRootVisible = false
        showsRootHandles = true
        selectionModel.selectionMode = TreeSelectionModel.SINGLE_TREE_SELECTION
        cellRenderer = ArrowsCellRenderer()
    }

    init {
        object : DoubleClickListener() {
            override fun onDoubleClick(event: java.awt.event.MouseEvent): Boolean = activateSelection()
        }.installOn(tree)

        val actions = DefaultActionGroup().apply {
            add(simpleAction("New Graph", AllIcons.General.Add) { newGraph() })
            add(simpleAction("Refresh", AllIcons.Actions.Refresh) { rebuild() })
        }
        val bar = ActionManager.getInstance().createActionToolbar("ArrowsSidebar", actions, true)
        bar.targetComponent = tree
        toolbar = bar.component
        setContent(JBScrollPane(tree))
        rebuild()
    }

    private fun rebuild() {
        root.removeAllChildren()
        root.add(section("Quick actions", listOf(
            Node.Action("New graph") { newGraph() },
            Node.Action("New from example…") { newFromExample() },
        )))
        val files = workspaceArrowsFiles(project)
        root.add(section("In this workspace",
            if (files.isEmpty()) listOf(Node.Empty("No .arrows files yet — try New graph"))
            else files.map { Node.FileEntry(it) }
        ))
        root.add(section("Examples", EXAMPLE_NAMES.map { Node.Example(it) }))
        model.reload()
        com.intellij.util.ui.tree.TreeUtil.expandAll(tree)
    }

    private fun section(label: String, children: List<Node>): DefaultMutableTreeNode {
        val node = DefaultMutableTreeNode(Node.Section(label))
        children.forEach { node.add(DefaultMutableTreeNode(it)) }
        return node
    }

    private fun activateSelection(): Boolean {
        val node = (tree.lastSelectedPathComponent as? DefaultMutableTreeNode)?.userObject ?: return false
        when (node) {
            is Node.Action -> node.run()
            is Node.FileEntry -> FileEditorManager.getInstance(project).openFile(node.file, true)
            is Node.Example -> useExampleAsTemplate(node.name)
            else -> return false
        }
        return true
    }

    private fun newGraph() {
        val dir = ProjectRootManager.getInstance(project).contentRoots.firstOrNull() ?: return
        val name = promptFileName("graph.arrows") ?: return
        writeAndOpen(dir, name, NEW_GRAPH_TEMPLATE)
    }

    private fun newFromExample() {
        val choice = Messages.showEditableChooseDialog(
            "Pick an example to copy into your workspace", "New From Example", null,
            EXAMPLE_NAMES.toTypedArray(), EXAMPLE_NAMES.first(), null
        ) ?: return
        useExampleAsTemplate(choice)
    }

    private fun useExampleAsTemplate(name: String) {
        val content = javaClass.getResourceAsStream("/examples/$name.arrows")?.bufferedReader()?.use { it.readText() }
            ?: return
        val dir = ProjectRootManager.getInstance(project).contentRoots.firstOrNull() ?: return
        val target = promptFileName("$name.arrows") ?: return
        writeAndOpen(dir, target, content)
    }

    private fun promptFileName(default: String): String? {
        val name = Messages.showInputDialog(project, "File name", "Arrows", null, default, null)
            ?.takeIf { it.isNotBlank() } ?: return null
        return if (name.endsWith(".arrows")) name else "$name.arrows"
    }

    private fun writeAndOpen(dir: VirtualFile, fileName: String, content: String) {
        WriteCommandAction.runWriteCommandAction(project) {
            val existing = dir.findChild(fileName)
            val file = existing ?: dir.createChildData(this, fileName)
            if (existing == null) VfsUtil.saveText(file, content)
            FileEditorManager.getInstance(project).openFile(file, true)
        }
        rebuild()
    }

    private fun simpleAction(text: String, icon: javax.swing.Icon, run: () -> Unit) =
        object : AnAction(text, text, icon), DumbAware {
            override fun actionPerformed(e: AnActionEvent) = run()
        }
}

private class ArrowsCellRenderer : ColoredTreeCellRenderer() {
    override fun customizeCellRenderer(
        tree: JTree, value: Any?, selected: Boolean, expanded: Boolean,
        leaf: Boolean, row: Int, hasFocus: Boolean,
    ) {
        when (val node = (value as? DefaultMutableTreeNode)?.userObject) {
            is Node.Section -> { icon = AllIcons.Nodes.Folder; append(node.label, SimpleTextAttributes.REGULAR_BOLD_ATTRIBUTES) }
            is Node.Action -> { icon = AllIcons.General.Add; append(node.label) }
            is Node.FileEntry -> { icon = AllIcons.FileTypes.Json; append(node.file.name) }
            is Node.Example -> { icon = AllIcons.Nodes.PpLib; append(node.name); append("  bundled", SimpleTextAttributes.GRAYED_ATTRIBUTES) }
            is Node.Empty -> { icon = AllIcons.General.Information; append(node.label, SimpleTextAttributes.GRAYED_ATTRIBUTES) }
            else -> {}
        }
    }
}

private fun workspaceArrowsFiles(project: Project): List<VirtualFile> {
    val root = ProjectRootManager.getInstance(project).contentRoots.firstOrNull() ?: return emptyList()
    val result = mutableListOf<VirtualFile>()
    VfsUtilCore.iterateChildrenRecursively(root, { it.name != "node_modules" && it.name != "build" && it.name != "dist" }) { vf ->
        if (!vf.isDirectory && vf.extension == "arrows") result.add(vf)
        true
    }
    return result.sortedBy { it.path }
}
