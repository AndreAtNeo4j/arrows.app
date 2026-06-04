package app.arrows.intellij.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

// Covers the three checks the Kotlin host implements; style-key validation is VS-Code-only.
class GraphValidateTest {
    private fun codes(json: String) = validateGraph(json).map { it.code }

    @Test
    fun cleanGraphProducesNoDiagnostics() {
        val g = """{"nodes":[
            {"id":"n0","position":{"x":0,"y":0}},
            {"id":"n1","position":{"x":1,"y":1}}
        ],"relationships":[
            {"id":"r0","fromId":"n0","toId":"n1","type":"R"}
        ],"style":{}}"""
        assertEquals(emptyList(), validateGraph(g))
    }

    @Test
    fun flagsDuplicateNodeIds() {
        val g = """{"nodes":[{"id":"dup","position":{"x":0,"y":0}},{"id":"dup","position":{"x":0,"y":0}}],"relationships":[]}"""
        assertTrue(CODE_DUPLICATE_ID in codes(g))
    }

    @Test
    fun flagsDuplicateRelationshipIds() {
        val g = """{"nodes":[{"id":"n0","position":{"x":0,"y":0}},{"id":"n1","position":{"x":0,"y":0}}],"relationships":[
            {"id":"r0","fromId":"n0","toId":"n1","type":"A"},
            {"id":"r0","fromId":"n1","toId":"n0","type":"B"}
        ]}"""
        assertTrue(CODE_DUPLICATE_ID in codes(g))
    }

    @Test
    fun flagsRefIntegrityOnBothEndpoints() {
        val g = """{"nodes":[{"id":"n0","position":{"x":0,"y":0}}],"relationships":[
            {"id":"r0","fromId":"n0","toId":"ghost","type":"R"},
            {"id":"r1","fromId":"unknown","toId":"n0","type":"R"}
        ]}"""
        assertEquals(2, validateGraph(g).count { it.code == CODE_REF_INTEGRITY })
    }

    @Test
    fun flagsBothDanglingEndpointsOnOneRelationship() {
        val g = """{"nodes":[],"relationships":[{"id":"r0","fromId":"ghostA","toId":"ghostB","type":"R"}]}"""
        assertEquals(2, validateGraph(g).count { it.code == CODE_REF_INTEGRITY })
    }

    @Test
    fun flagsMissingRequiredNodeId() {
        val g = """{"nodes":[{"id":"","position":{"x":0,"y":0}}],"relationships":[]}"""
        assertTrue(CODE_EMPTY_REQUIRED in codes(g))
    }

    @Test
    fun flagsMissingRequiredNodePosition() {
        val g = """{"nodes":[{"id":"n0"}],"relationships":[]}"""
        assertTrue(CODE_EMPTY_REQUIRED in codes(g))
    }

    @Test
    fun flagsRelationshipMissingType() {
        val g = """{"nodes":[{"id":"n0","position":{"x":0,"y":0}}],"relationships":[{"id":"r0","fromId":"n0","toId":"n0"}]}"""
        assertTrue(CODE_EMPTY_REQUIRED in codes(g))
    }

    @Test
    fun acceptsSelfLoops() {
        val g = """{"nodes":[{"id":"n0","position":{"x":0,"y":0}}],"relationships":[
            {"id":"r0","fromId":"n0","toId":"n0","type":"CONNECTS"}
        ]}"""
        assertEquals(emptyList(), validateGraph(g))
    }

    @Test
    fun acceptsMultiEdges() {
        val g = """{"nodes":[{"id":"n0","position":{"x":0,"y":0}},{"id":"n1","position":{"x":0,"y":0}}],"relationships":[
            {"id":"r0","fromId":"n0","toId":"n1","type":"KNOWS"},
            {"id":"r1","fromId":"n0","toId":"n1","type":"FOLLOWS"}
        ]}"""
        assertEquals(emptyList(), validateGraph(g))
    }

    @Test
    fun unparseableJsonYieldsNoDiagnostics() {
        assertEquals(emptyList(), validateGraph("not json"))
    }
}
