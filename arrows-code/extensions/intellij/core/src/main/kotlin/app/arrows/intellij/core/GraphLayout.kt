package app.arrows.intellij.core

import org.json.JSONObject
import kotlin.math.PI
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

// Force-directed layout is O(n^2); above this an untrusted .arrows file hangs the host. Keep in sync with format.ts.
const val MAX_LAYOUT_NODES = 2000

data class LayoutOption(val id: String, val label: String, val description: String)

// Order = picker order; first = default.
val LAYOUTS = listOf(
    LayoutOption("force", "Force-directed", "Organic spring layout. Good default."),
    LayoutOption("hierarchical", "Hierarchical", "Top-down layers. Best for DAGs and tier shapes."),
    LayoutOption("radial", "Radial", "Hub at center, rings outward. Best for hub-and-spoke."),
    LayoutOption("circular", "Circular", "All nodes on one ring."),
    LayoutOption("grid", "Grid", "Square grid, sorted by id. Visual reset."),
)

private const val NODE_BODY_RADIUS = 80.0
private const val LABEL_LINE_HEIGHT = 30.0

private data class XY(val x: Double, val y: Double)
private class NodeInfo(val id: String, val x: Double, val y: Double, val radius: Double)

private fun round1(v: Double): Double = Math.round(v * 10) / 10.0

private fun nodeInfo(o: JSONObject): NodeInfo {
    val pos = o.optJSONObject("position")
    val x = pos?.optDouble("x", 0.0)?.takeIf { it.isFinite() } ?: 0.0
    val y = pos?.optDouble("y", 0.0)?.takeIf { it.isFinite() } ?: 0.0
    val labelLines = o.optJSONArray("labels")?.length() ?: 0
    val propLines = o.optJSONObject("properties")?.length() ?: 0
    val captionExtra = if (o.optString("caption").isNotEmpty()) 1 else 0
    return NodeInfo(o.optString("id"), x, y, NODE_BODY_RADIUS + (labelLines + propLines + captionExtra) * LABEL_LINE_HEIGHT)
}

fun layoutGraph(json: String, layoutId: String): String? {
    val root = runCatching { JSONObject(json) }.getOrNull() ?: return null
    val nodesArr = root.optJSONArray("nodes") ?: return null
    val nodeObjs = (0 until nodesArr.length()).mapNotNull { nodesArr.optJSONObject(it) }
    if (nodeObjs.isEmpty()) return json
    val infos = nodeObjs.map(::nodeInfo)
    val rels = root.optJSONArray("relationships")?.let { arr ->
        (0 until arr.length()).mapNotNull { arr.optJSONObject(it) }.map { it.optString("fromId") to it.optString("toId") }
    } ?: emptyList()

    val positions = when (layoutId) {
        "force" -> forceDirected(infos, rels)
        "hierarchical" -> hierarchical(infos, rels)
        "radial" -> radial(infos, rels)
        "circular" -> circular(infos)
        "grid" -> grid(infos)
        else -> return null
    }
    for (obj in nodeObjs) {
        val p = positions[obj.optString("id")] ?: continue
        obj.put("position", JSONObject().put("x", p.x).put("y", p.y))
    }
    return root.toString(2)
}

private const val GRID_CELL = 320.0

private fun grid(infos: List<NodeInfo>): Map<String, XY> {
    val ids = infos.map { it.id }.sorted()
    val cols = ceil(sqrt(ids.size.toDouble())).toInt()
    val rows = ceil(ids.size.toDouble() / cols).toInt()
    val offsetX = -((cols - 1) * GRID_CELL) / 2
    val offsetY = -((rows - 1) * GRID_CELL) / 2
    return ids.withIndex().associate { (i, id) ->
        id to XY(round1(offsetX + (i % cols) * GRID_CELL), round1(offsetY + (i / cols) * GRID_CELL))
    }
}

private const val CIRC_MIN_RADIUS = 300.0
private const val CIRC_PER_NODE = 70.0

private fun circular(infos: List<NodeInfo>): Map<String, XY> {
    val ids = infos.map { it.id }.sorted()
    if (ids.size == 1) return mapOf(ids[0] to XY(0.0, 0.0))
    val radius = max(CIRC_MIN_RADIUS, ids.size * CIRC_PER_NODE)
    return ids.withIndex().associate { (i, id) ->
        val angle = (i.toDouble() / ids.size) * PI * 2 - PI / 2
        id to XY(round1(cos(angle) * radius), round1(sin(angle) * radius))
    }
}

private const val RADIAL_RING_GAP = 320.0
private const val RADIAL_LATERAL_GAP = 60.0

private fun radial(infos: List<NodeInfo>, rels: List<Pair<String, String>>): Map<String, XY> {
    val ids = infos.map { it.id }.sorted()
    if (ids.size == 1) return mapOf(ids[0] to XY(0.0, 0.0))
    val idSet = ids.toHashSet()
    val adj = ids.associateWith { mutableListOf<String>() }
    for ((from, to) in rels) {
        if (from == to || from !in idSet || to !in idSet) continue
        adj.getValue(from).add(to)
        adj.getValue(to).add(from)
    }

    var center = ids[0]
    var maxDeg = -1
    for (id in ids) {
        val deg = adj.getValue(id).size
        if (deg > maxDeg) { center = id; maxDeg = deg }
    }

    val ring = HashMap<String, Int>().apply { put(center, 0) }
    val queue = ArrayDeque<String>().apply { add(center) }
    while (queue.isNotEmpty()) {
        val id = queue.removeFirst()
        val r = ring.getValue(id)
        for (nb in adj.getValue(id)) if (nb !in ring) { ring[nb] = r + 1; queue.add(nb) }
    }
    val maxRing = ring.values.maxOrNull() ?: 0
    for (id in ids) if (id !in ring) ring[id] = maxRing + 1

    val byRing = sortedMapOf<Int, MutableList<String>>()
    for (id in ids) byRing.getOrPut(ring.getValue(id)) { mutableListOf() }.add(id)
    for (arr in byRing.values) arr.sort()

    // Ring radius accumulates so outer rings never sit inside inner ones.
    val ringRadius = HashMap<Int, Double>()
    var minOuter = 0.0
    for (r in byRing.keys) {
        if (r == 0) { ringRadius[r] = 0.0; continue }
        val arr = byRing.getValue(r)
        val chord = 2 * NODE_BODY_RADIUS + RADIAL_LATERAL_GAP
        val byCount = (arr.size * chord) / (2 * PI)
        val radius = max(max(byCount, r * RADIAL_RING_GAP), minOuter + RADIAL_RING_GAP)
        ringRadius[r] = radius
        minOuter = radius
    }

    val out = HashMap<String, XY>()
    for ((r, arr) in byRing) {
        if (r == 0 && arr.size == 1) { out[arr[0]] = XY(0.0, 0.0); continue }
        val radius = ringRadius.getValue(r)
        val angleStep = (PI * 2) / arr.size
        arr.forEachIndexed { i, id ->
            val angle = i * angleStep - PI / 2
            out[id] = XY(round1(cos(angle) * radius), round1(sin(angle) * radius))
        }
    }
    return out
}

private const val HIER_LAYER_HEIGHT = 280.0
private const val HIER_NODE_SPACING = 340.0

// Kahn topo sort; cyclic-safe — back-edges ignored, pure-cycle nodes land in a leftover layer.
private fun hierarchical(infos: List<NodeInfo>, rels: List<Pair<String, String>>): Map<String, XY> {
    val ids = infos.map { it.id }.sorted()
    val idSet = ids.toHashSet()
    val inDeg = HashMap<String, Int>()
    val edgesOut = HashMap<String, MutableList<String>>()
    for (id in ids) { inDeg[id] = 0; edgesOut[id] = mutableListOf() }
    for ((from, to) in rels) {
        if (from == to || from !in idSet || to !in idSet) continue
        inDeg[to] = inDeg.getValue(to) + 1
        edgesOut.getValue(from).add(to)
    }

    val remaining = HashMap(inDeg)
    val tentative = HashMap<String, Int>()
    val layer = HashMap<String, Int>()
    var frontier = ids.filter { remaining.getValue(it) == 0 }
    for (id in frontier) layer[id] = 0

    while (frontier.isNotEmpty()) {
        val next = mutableListOf<String>()
        for (id in frontier) {
            val l = layer.getValue(id)
            for (target in edgesOut.getValue(id)) {
                if (target in layer) continue
                tentative[target] = max(tentative[target] ?: 0, l + 1)
                val rem = remaining.getValue(target) - 1
                remaining[target] = rem
                if (rem <= 0) { layer[target] = tentative.getValue(target); next.add(target) }
            }
        }
        frontier = next
    }
    val maxLayer = layer.values.maxOrNull() ?: 0
    for (id in ids) if (id !in layer) layer[id] = maxLayer + 1

    val byLayer = sortedMapOf<Int, MutableList<String>>()
    for (id in ids) byLayer.getOrPut(layer.getValue(id)) { mutableListOf() }.add(id)
    for (arr in byLayer.values) arr.sort()

    val out = HashMap<String, XY>()
    for ((l, arr) in byLayer) {
        val offsetX = -((arr.size - 1) * HIER_NODE_SPACING) / 2
        arr.forEachIndexed { i, id ->
            out[id] = XY(round1(offsetX + i * HIER_NODE_SPACING), round1(l * HIER_LAYER_HEIGHT))
        }
    }
    return out
}

private const val FD_COLLISION_GAP = 40.0
private const val FD_TARGET_EDGE = 360.0
private const val FD_REPULSE = 160_000.0
private const val FD_SPRING = 0.04
private const val FD_CENTER = 0.003
private const val FD_DAMPING = 0.82
private const val FD_ITERATIONS = 420

private class Body(val id: String, var x: Double, var y: Double, val r: Double) { var vx = 0.0; var vy = 0.0 }

private fun forceDirected(infos: List<NodeInfo>, rels: List<Pair<String, String>>): Map<String, XY> {
    if (infos.size == 1) return mapOf(infos[0].id to XY(0.0, 0.0))
    val sim = infos.sortedBy { it.id }.map { Body(it.id, it.x, it.y, it.radius) }
    val indexById = sim.withIndex().associate { (i, b) -> b.id to i }
    val edges = rels.mapNotNull { (from, to) ->
        val a = indexById[from]; val b = indexById[to]
        if (a == null || b == null || a == b) null else a to b
    }

    repeat(FD_ITERATIONS) {
        for (n in sim) { n.vx *= FD_DAMPING; n.vy *= FD_DAMPING }

        for (i in sim.indices) for (j in i + 1 until sim.size) {
            val a = sim[i]; val b = sim[j]
            var dx = b.x - a.x; var dy = b.y - a.y
            var dist2 = dx * dx + dy * dy
            if (dist2 < 1) { dx = (j - i).toDouble(); dy = (j + i).toDouble(); dist2 = dx * dx + dy * dy }
            val dist = sqrt(dist2)
            val force = FD_REPULSE / dist2
            val ux = dx / dist; val uy = dy / dist
            a.vx -= ux * force; a.vy -= uy * force
            b.vx += ux * force; b.vy += uy * force
        }

        for ((ai, bi) in edges) {
            val a = sim[ai]; val b = sim[bi]
            val dx = b.x - a.x; val dy = b.y - a.y
            val dist = sqrt(dx * dx + dy * dy).let { if (it == 0.0) 1.0 else it }
            val delta = dist - FD_TARGET_EDGE
            val fx = (dx / dist) * delta * FD_SPRING; val fy = (dy / dist) * delta * FD_SPRING
            a.vx += fx; a.vy += fy
            b.vx -= fx; b.vy -= fy
        }

        for (n in sim) { n.vx -= n.x * FD_CENTER; n.vy -= n.y * FD_CENTER }
        for (n in sim) { n.x += n.vx; n.y += n.vy }

        for (pass in 0 until 3) {
            for (i in sim.indices) for (j in i + 1 until sim.size) {
                val a = sim[i]; val b = sim[j]
                val minDist = a.r + b.r + FD_COLLISION_GAP
                val dx = b.x - a.x; val dy = b.y - a.y
                val dist = sqrt(dx * dx + dy * dy).let { if (it == 0.0) 0.01 else it }
                if (dist < minDist) {
                    val overlap = (minDist - dist) / 2
                    val ux = dx / dist; val uy = dy / dist
                    a.x -= ux * overlap; a.y -= uy * overlap
                    b.x += ux * overlap; b.y += uy * overlap
                }
            }
        }
    }

    var minX = Double.POSITIVE_INFINITY; var minY = Double.POSITIVE_INFINITY
    var maxX = Double.NEGATIVE_INFINITY; var maxY = Double.NEGATIVE_INFINITY
    for (n in sim) { minX = min(minX, n.x); minY = min(minY, n.y); maxX = max(maxX, n.x); maxY = max(maxY, n.y) }
    val cx = (minX + maxX) / 2; val cy = (minY + maxY) / 2
    return sim.associate { it.id to XY(round1(it.x - cx), round1(it.y - cy)) }
}
