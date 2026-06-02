package app.arrows.intellij.protocol

/** A kebab-menu command the embed offers and the host executes. `icon` is a codicon name rendered as text by the embed. */
data class CommandEntry(val id: String, val title: String, val description: String, val icon: String)

/** Commands the IntelliJ host actually implements (sent as the embed `menu`). Grows as more are wired. */
val ARROWS_COMMANDS: List<CommandEntry> = listOf(
    CommandEntry("arrows.openInArrowsApp", "Open in arrows.app", "Open this graph in arrows.app", "link-external"),
    CommandEntry("arrows.exportSvg", "Save as SVG…", "Save the canvas as an SVG file", "file-media"),
    CommandEntry("arrows.exportCypher", "Save as Cypher…", "Save the graph as a .cypher file", "database"),
)
