plugins {
    kotlin("jvm")
    id("org.jetbrains.intellij.platform")
}

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

dependencies {
    implementation(project(":protocol"))
    implementation("org.json:json:20240303")
    intellijPlatform {
        intellijIdeaCommunity("2024.3")
    }
}

kotlin {
    jvmToolchain(21)
}

// Ship the shared embed bundle if it has been built. Same artifact the VS Code
// host bundles (dist/apps/arrows-ts); the real bundle overrides the placeholder.
val embedBundle = rootProject.file("../../../dist/apps/arrows-ts")
tasks.processResources {
    duplicatesStrategy = DuplicatesStrategy.INCLUDE
    if (embedBundle.exists()) {
        from(embedBundle) { into("embed") }
    }
}
