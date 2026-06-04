package app.arrows.intellij

import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.popup.JBPopupFactory
import com.intellij.ui.SimpleListCellRenderer

// Native list popup (type-to-filter) — the friendlier counterpart to a modal chooser dialog. Centered
// in the IDE window: these are triggered from the in-webview kebab, which has no caret to anchor to.
internal fun <T : Any> chooseInPopup(
    project: Project,
    title: String,
    items: List<T>,
    preselect: T? = null,
    render: (T) -> String,
    onChosen: (T) -> Unit,
) {
    if (items.isEmpty()) return
    JBPopupFactory.getInstance()
        .createPopupChooserBuilder(items)
        .setTitle(title)
        .setRenderer(SimpleListCellRenderer.create("") { render(it) })
        .setNamerForFiltering { render(it) }
        .apply { if (preselect != null) setSelectedValue(preselect, true) }
        .setItemChosenCallback(onChosen)
        .createPopup()
        .showCenteredInCurrentWindow(project)
}
