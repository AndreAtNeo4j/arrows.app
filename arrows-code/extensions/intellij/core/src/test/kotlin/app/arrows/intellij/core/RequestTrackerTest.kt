package app.arrows.intellij.core

import java.util.concurrent.ExecutionException
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

class RequestTrackerTest {
    @Test
    fun resolvesByRequestId() {
        val tracker = RequestTracker()
        val (id, future) = tracker.create("svg")
        assertFalse(future.isDone)
        tracker.resolve(id, "<svg/>", null)
        assertEquals("<svg/>", future.get())
    }

    @Test
    fun resolveWithErrorCompletesExceptionally() {
        val tracker = RequestTracker()
        val (id, future) = tracker.create("cypher")
        tracker.resolve(id, null, "boom")
        val ex = assertFailsWith<ExecutionException> { future.get() }
        assertEquals("boom", ex.cause?.message)
    }

    @Test
    fun unknownRequestIdIsIgnored() {
        RequestTracker().resolve("nope", "x", null)
    }

    @Test
    fun idsAreUnique() {
        val tracker = RequestTracker()
        val (a, _) = tracker.create("svg")
        val (b, _) = tracker.create("svg")
        assertNotEquals(a, b)
    }

    @Test
    fun resolvingOneLeavesOthersInFlight() {
        val tracker = RequestTracker()
        val (a, fa) = tracker.create("svg")
        val (_, fb) = tracker.create("cypher")
        tracker.resolve(a, "done", null)
        assertEquals("done", fa.get())
        assertFalse(fb.isDone)
    }

    @Test
    fun unansweredRequestTimesOut() {
        val (_, future) = RequestTracker(timeoutMs = 50).create("svg")
        assertFailsWith<ExecutionException> { future.get() }
        assertTrue(future.isCompletedExceptionally)
    }
}
