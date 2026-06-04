package app.arrows.intellij

import com.intellij.ide.DataManager
import com.intellij.openapi.ui.popup.JBPopupFactory
import com.intellij.ui.SimpleListCellRenderer
import javax.swing.JComponent

// Native list popup (type-to-filter, in-context) — the friendlier counterpart to a modal chooser dialog.
internal fun <T : Any> chooseInPopup(
    anchor: JComponent,
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
        .showInBestPositionFor(DataManager.getInstance().getDataContext(anchor))
}
