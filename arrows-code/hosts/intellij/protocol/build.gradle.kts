plugins {
    kotlin("jvm")
}

repositories {
    mavenCentral()
}

dependencies {
    implementation("org.json:json:20240303")
    testImplementation(kotlin("test"))
}

kotlin {
    jvmToolchain(21)
}

// Shared fixtures + catalog from host-protocol, so the Kotlin parser is tested
// against the same source of truth as the TypeScript host (no hand-copied cases).
tasks.processTestResources {
    from(rootProject.file("../../libs/host-protocol/fixtures")) { include("*.json") }
    from(rootProject.file("../../libs/host-protocol/src/lib")) { include("commands.json") }
}

tasks.test {
    useJUnitPlatform()
}
