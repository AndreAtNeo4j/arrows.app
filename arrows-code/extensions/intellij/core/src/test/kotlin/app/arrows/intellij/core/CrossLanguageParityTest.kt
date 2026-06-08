package app.arrows.intellij.core

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull

// The IntelliJ host can't import the TypeScript libs, so the layout catalog and node cap are
// hand-mirrored from graph-logic and format.ts (see the "keep in sync" notes on those constants).
// This test reads the canonical TS sources and fails the moment a copy drifts.
class CrossLanguageParityTest {
    private val repoRoot: File =
        generateSequence(File(System.getProperty("user.dir")).absoluteFile) { it.parentFile }
            .take(10)
            .firstOrNull { File(it, "libs/graph-logic/src/layout/index.ts").exists() }
            ?: error("parity test couldn't locate arrows-code root from ${System.getProperty("user.dir")}")

    @Test
    fun layoutIdsAndOrderMatchTypeScript() {
        val index = File(repoRoot, "libs/graph-logic/src/layout/index.ts").readText()
        val tsIds = Regex("""id:\s*'([a-z]+)'""").findAll(index).map { it.groupValues[1] }.toList()
        assertEquals(5, tsIds.size, "expected 5 layout ids in index.ts; regex matched ${tsIds.size}")
        assertEquals(tsIds, LAYOUTS.map { it.id }, "Kotlin LAYOUTS drifted from graph-logic/layout/index.ts (ids or order)")
    }

    @Test
    fun maxLayoutNodesMatchesTypeScript() {
        val formatTs = File(repoRoot, "extensions/vscode/src/commands/format.ts").readText()
        val tsMax = Regex("""MAX_LAYOUT_NODES\s*=\s*(\d+)""").find(formatTs)?.groupValues?.get(1)?.toInt()
        assertNotNull(tsMax, "couldn't find MAX_LAYOUT_NODES in format.ts")
        assertEquals(tsMax, MAX_LAYOUT_NODES, "Kotlin MAX_LAYOUT_NODES drifted from format.ts")
    }
}
