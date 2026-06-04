package app.arrows.intellij.core

import kotlin.test.Test
import kotlin.test.assertEquals

class CommandSurfaceTest {
    private val sample = """
        [
          {"id":"a","title":"A","description":"da","icon":"ia","webview":true,"surface":{"sidebar":false,"embedMenu":true}},
          {"id":"b","title":"B","description":"db","icon":"ib","webview":false,"surface":{"sidebar":true,"embedMenu":false}},
          {"id":"c","title":"C","description":"dc","icon":"ic","webview":true,"surface":{"sidebar":false,"embedMenu":false}}
        ]
    """.trimIndent()

    @Test
    fun keepsOnlyWebviewEmbedMenuCommandsInOrder() {
        val menu = parseCommandMenu(sample)
        assertEquals(listOf("a"), menu.map { it.id })
        assertEquals(CommandEntry("a", "A", "da", "ia"), menu[0])
    }

    @Test
    fun emptyForMalformedJson() {
        assertEquals(emptyList(), parseCommandMenu("not json"))
    }

    // Guard against catalog drift: the IntelliJ kebab is parsed from the SAME
    // commands.json the VS Code host uses. If the embed-menu set changes, this
    // fails until the expectation (and the IntelliJ handler) are updated.
    @Test
    fun realCatalogYieldsTheSharedEmbedMenu() {
        val json = javaClass.getResourceAsStream("/commands.json")!!.bufferedReader().use { it.readText() }
        assertEquals(
            listOf(
                "arrows.validate", "arrows.format", "arrows.openSource", "arrows.copyCypher",
                "arrows.exportCypher", "arrows.exportSvg", "arrows.exportGraphQL",
                "arrows.openInArrowsApp", "arrows.renameLabel", "arrows.renameRelType",
            ),
            parseCommandMenu(json).map { it.id },
        )
    }

    // The kebab advertises only commands the JVM host can service: validate/format
    // (graph-logic) and openSource (needs a 2nd editor) are dropped; rename is kept.
    // format (5 TS layout algorithms) and openSource (needs a 2nd editor) stay dropped; validate
    // is implemented in Kotlin (structural checks), so it survives the filter in catalog order.
    @Test
    fun supportedEmbedMenuDropsCommandsTheHostCannotRun() {
        val json = javaClass.getResourceAsStream("/commands.json")!!.bufferedReader().use { it.readText() }
        assertEquals(
            listOf(
                "arrows.validate", "arrows.copyCypher", "arrows.exportCypher", "arrows.exportSvg",
                "arrows.exportGraphQL", "arrows.openInArrowsApp",
                "arrows.renameLabel", "arrows.renameRelType",
            ),
            supportedEmbedMenu(parseCommandMenu(json)).map { it.id },
        )
    }

    @Test
    fun everySupportedCommandExistsInTheCatalog() {
        val json = javaClass.getResourceAsStream("/commands.json")!!.bufferedReader().use { it.readText() }
        val catalogIds = parseCommandMenu(json).map { it.id }.toSet()
        assertEquals(emptySet(), SUPPORTED_EMBED_COMMANDS - catalogIds)
    }
}
