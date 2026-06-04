package app.arrows.intellij.core

import org.json.JSONObject
import kotlin.math.hypot
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

// Asserts the structural properties each layout guarantees, not exact coordinates (TS float parity isn't required).
class GraphLayoutTest {
    private val ids = LAYOUTS.map { it.id }

    private fun node(id: String, x: Int = 0, y: Int = 0, caption: String = "", labels: String = "[]", props: String = "{}") =
        """{"id":"$id","position":{"x":$x,"y":$y},"caption":"$caption","labels":$labels,"properties":$props,"style":{}}"""

    private fun graph(nodes: List<String>, rels: List<Triple<String, String, String>> = emptyList()): String {
        val r = rels.joinToString(",") { (id, f, t) -> """{"id":"$id","fromId":"$f","toId":"$t","type":"KNOWS","properties":{},"style":{}}""" }
        return """{"nodes":[${nodes.joinToString(",")}],"relationships":[$r],"style":{}}"""
    }

    private fun pos(out: String, id: String): Pair<Double, Double> {
        val nodes = JSONObject(out).getJSONArray("nodes")
        for (i in 0 until nodes.length()) {
            val n = nodes.getJSONObject(i)
            if (n.optString("id") == id) return n.getJSONObject("position").getDouble("x") to n.getJSONObject("position").getDouble("y")
        }
        error("node $id not found")
    }

    private fun aliceBob() = graph(listOf(node("a", -50, 0), node("b", 50, 0)), listOf(Triple("r0", "a", "b")))
    private fun hubAndSpoke() = graph(
        listOf(node("hub"), node("l1"), node("l2"), node("l3"), node("l4")),
        listOf(Triple("e1", "hub", "l1"), Triple("e2", "hub", "l2"), Triple("e3", "hub", "l3"), Triple("e4", "hub", "l4")),
    )

    @Test
    fun registryExposesFiveLayoutsInStableOrder() {
        assertEquals(listOf("force", "hierarchical", "radial", "circular", "grid"), ids)
    }

    @Test
    fun unknownLayoutIdReturnsNull() {
        assertEquals(null, layoutGraph(graph(listOf(node("a"))), "nope"))
    }

    @Test
    fun everyLayoutLeavesAnEmptyGraphUnchanged() {
        val empty = graph(emptyList())
        for (id in ids) assertEquals(empty, layoutGraph(empty, id), "layout $id")
    }

    @Test
    fun nonGridLayoutsCenterASingleNodeAtOrigin() {
        val g = graph(listOf(node("n0", 500, 700)))
        for (id in ids.filter { it != "grid" }) {
            assertEquals(0.0 to 0.0, pos(layoutGraph(g, id)!!, "n0"), "layout $id")
        }
    }

    @Test
    fun everyLayoutIsDeterministic() {
        for (id in ids) assertEquals(layoutGraph(aliceBob(), id), layoutGraph(aliceBob(), id), "layout $id")
    }

    @Test
    fun everyLayoutPreservesNonPositionFields() {
        val g = graph(
            listOf(
                node("a", 0, 0, caption = "Alice", labels = """["Person"]""", props = """{"name":"'Alice'"}"""),
                node("b", 100, 0, caption = "Bob", labels = """["Person"]"""),
            ),
            listOf(Triple("r0", "a", "b")),
        )
        for (id in ids) {
            val a = JSONObject(layoutGraph(g, id)!!).getJSONArray("nodes").getJSONObject(0)
            assertEquals("Alice", a.getString("caption"), "layout $id")
            assertEquals("Person", a.getJSONArray("labels").getString(0), "layout $id")
            assertEquals("'Alice'", a.getJSONObject("properties").getString("name"), "layout $id")
        }
    }

    @Test
    fun everyLayoutToleratesUnknownRefsAndSelfLoopsWithoutNaN() {
        val g = graph(listOf(node("a"), node("b")), listOf(Triple("ghost", "a", "missing"), Triple("r0", "a", "a")))
        for (id in ids) {
            val out = layoutGraph(g, id)!!
            for (n in listOf("a", "b")) {
                val (x, y) = pos(out, n)
                assertTrue(x.isFinite() && y.isFinite(), "layout $id produced NaN for $n")
            }
        }
    }

    @Test
    fun forceDirectedRespectsMinimumCollisionDistance() {
        val g = graph(
            listOf("doc", "c1", "c2", "c3", "c4", "e1", "e2", "e3", "e4").map { node(it) },
            listOf(
                Triple("a1", "c1", "doc"), Triple("a2", "c2", "doc"), Triple("a3", "c3", "doc"), Triple("a4", "c4", "doc"),
                Triple("b1", "c1", "c2"), Triple("b2", "c2", "c3"), Triple("b3", "c3", "c4"),
                Triple("m1", "c1", "e1"), Triple("m2", "c2", "e2"), Triple("m3", "c3", "e3"), Triple("m4", "c4", "e4"),
            ),
        )
        val out = layoutGraph(g, "force")!!
        val pts = listOf("doc", "c1", "c2", "c3", "c4", "e1", "e2", "e3", "e4").map { pos(out, it) }
        for (i in pts.indices) for (j in i + 1 until pts.size) {
            val d = hypot(pts[i].first - pts[j].first, pts[i].second - pts[j].second)
            assertTrue(d >= 199, "pair $i,$j only $d apart")
        }
    }

    @Test
    fun hierarchicalPlacesDagInIncreasingLayers() {
        val g = graph(listOf(node("a"), node("b"), node("c")), listOf(Triple("r0", "a", "b"), Triple("r1", "b", "c"), Triple("r2", "a", "c")))
        val out = layoutGraph(g, "hierarchical")!!
        assertTrue(pos(out, "a").second < pos(out, "b").second)
        assertTrue(pos(out, "b").second < pos(out, "c").second)
    }

    @Test
    fun hierarchicalCyclicGraphStaysFinite() {
        val g = graph(listOf(node("x"), node("y"), node("z")), listOf(Triple("r0", "x", "y"), Triple("r1", "y", "z"), Triple("r2", "z", "x")))
        val out = layoutGraph(g, "hierarchical")!!
        for (n in listOf("x", "y", "z")) { val (px, py) = pos(out, n); assertTrue(px.isFinite() && py.isFinite()) }
    }

    @Test
    fun radialPlacesHighestDegreeNodeAtOrigin() {
        assertEquals(0.0 to 0.0, pos(layoutGraph(hubAndSpoke(), "radial")!!, "hub"))
    }

    @Test
    fun radialLeavesSitOnOneRing() {
        val out = layoutGraph(hubAndSpoke(), "radial")!!
        val dists = listOf("l1", "l2", "l3", "l4").map { val (x, y) = pos(out, it); hypot(x, y) }
        for (d in dists) assertTrue(kotlin.math.abs(d - dists[0]) < 1)
    }

    @Test
    fun circularPlacesAllNodesEquidistantFromOrigin() {
        val out = layoutGraph(graph(listOf("a", "b", "c", "d").map { node(it) }), "circular")!!
        val dists = listOf("a", "b", "c", "d").map { val (x, y) = pos(out, it); hypot(x, y) }
        for (d in dists) assertTrue(kotlin.math.abs(d - dists[0]) < 1)
    }

    @Test
    fun gridLaysNineNodesInThreeColumns() {
        val out = layoutGraph(graph((0 until 9).map { node("n$it") }), "grid")!!
        val xs = (0 until 9).map { pos(out, "n$it").first }.toSet()
        assertEquals(3, xs.size)
    }

    @Test
    fun everyLayoutRewritesNodePositions() {
        val g = graph(listOf(node("a", 5000, 5000), node("b", 5100, 5000)), listOf(Triple("r0", "a", "b")))
        for (id in ids) {
            val out = layoutGraph(g, id)!!
            assertTrue(pos(out, "a") != (5000.0 to 5000.0), "layout $id left a unmoved")
            assertTrue(pos(out, "b") != (5100.0 to 5000.0), "layout $id left b unmoved")
        }
    }

    @Test
    fun radialCrowdedRingKeepsAdjacentLeavesApart() {
        val leaves = (0 until 24).map { "l$it" }
        val rels = leaves.mapIndexed { i, l -> Triple("e$i", "hub", l) }
        val out = layoutGraph(graph(listOf(node("hub")) + leaves.map { node(it) }, rels), "radial")!!
        val pts = leaves.map { pos(out, it) }.sortedBy { kotlin.math.atan2(it.second, it.first) }
        for (i in pts.indices) {
            val a = pts[i]; val b = pts[(i + 1) % pts.size]
            assertTrue(hypot(a.first - b.first, a.second - b.second) >= 199, "leaves too close on the ring")
        }
    }
}
