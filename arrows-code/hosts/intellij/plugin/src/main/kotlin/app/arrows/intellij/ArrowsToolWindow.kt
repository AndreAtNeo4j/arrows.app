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
import com.intellij.openapi.vfs.VfsUtil
import com.intellij.openapi.vfs.VfsUtilCore
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.components.JBList
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.content.ContentFactory
import javax.swing.DefaultListModel
import javax.swing.ListSelectionModel

private const val NEW_GRAPH_TEMPLATE = """{
  "nodes": [],
  "relationships": [],
  "style": {}
}
"""

class ArrowsToolWindowFactory : ToolWindowFactory, DumbAware {
    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val panel = ArrowsToolWindowPanel(project)
        val content = ContentFactory.getInstance().createContent(panel, "", false)
        toolWindow.contentManager.addContent(content)
    }
}

private class ArrowsToolWindowPanel(private val project: Project) :
    com.intellij.openapi.ui.SimpleToolWindowPanel(true, true) {

    private val model = DefaultListModel<VirtualFile>()
    private val list = JBList(model).apply {
        selectionMode = ListSelectionModel.SINGLE_SELECTION
        cellRenderer = com.intellij.ui.dsl.listCellRenderer.textListCellRenderer { it.name }
    }

    init {
        object : com.intellij.ui.DoubleClickListener() {
            override fun onDoubleClick(event: java.awt.event.MouseEvent): Boolean = openSelected()
        }.installOn(list)

        val actions = DefaultActionGroup().apply {
            add(NewGraphAction())
            add(RefreshAction())
        }
        val bar = ActionManager.getInstance().createActionToolbar("ArrowsSidebar", actions, true)
        bar.targetComponent = list
        toolbar = bar.component
        setContent(JBScrollPane(list))
        refresh()
    }

    fun refresh() {
        model.clear()
        arrowsFiles(project).forEach(model::addElement)
    }

    private fun openSelected(): Boolean {
        val file = list.selectedValue ?: return false
        FileEditorManager.getInstance(project).openFile(file, true)
        return true
    }

    private inner class RefreshAction :
        AnAction("Refresh", "Rescan the project for .arrows files", AllIcons.Actions.Refresh), DumbAware {
        override fun actionPerformed(e: AnActionEvent) = refresh()
    }

    private inner class NewGraphAction :
        AnAction("New Graph", "Create a new .arrows graph", AllIcons.General.Add), DumbAware {
        override fun actionPerformed(e: AnActionEvent) {
            val dir = ProjectRootManager.getInstance(project).contentRoots.firstOrNull() ?: return
            val name = Messages.showInputDialog(project, "File name", "New Arrows Graph", null, "graph.arrows", null)
                ?.takeIf { it.isNotBlank() } ?: return
            val fileName = if (name.endsWith(".arrows")) name else "$name.arrows"
            WriteCommandAction.runWriteCommandAction(project) {
                val existing = dir.findChild(fileName)
                val file = existing ?: dir.createChildData(this, fileName)
                if (existing == null) VfsUtil.saveText(file, NEW_GRAPH_TEMPLATE)
                FileEditorManager.getInstance(project).openFile(file, true)
            }
            refresh()
        }
    }
}

private fun arrowsFiles(project: Project): List<VirtualFile> {
    val root = ProjectRootManager.getInstance(project).contentRoots.firstOrNull() ?: return emptyList()
    val result = mutableListOf<VirtualFile>()
    VfsUtilCore.iterateChildrenRecursively(root, { true }) { vf ->
        if (!vf.isDirectory && vf.extension == "arrows") result.add(vf)
        true
    }
    return result.sortedBy { it.name }
}
